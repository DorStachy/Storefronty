// Google Places Photos — the shop's OWN photos for the hero + gallery, so the demo site shows their
// real place instead of placeholders. Two parts:
//   - placePhotoUrl(name, {apiKey, maxWidthPx}) → the Places Photo media-endpoint URL.
//   - downloadPhotos(names, outDir, {...})       → save the JPEGs to disk, return the saved paths.
//
// The media endpoint 302-redirects to Google's image CDN (lh3.googleusercontent.com); we follow it
// with a plain fetch. (safeFetch is NOT used here — it's built for HTML pages: it caps at 1.5MB and
// only returns html/json/text bodies, so it would discard image bytes. The URL host is Google's own,
// constructed from a Places photo resource name, so the SSRF surface is negligible.)
//
// Each download is a billable Places Photo request, so `max` bounds how many we pull per build.
// NOTE: Google requires attribution for Places photos on PUBLIC pages; fine for the owner-facing
// demo/screenshots, but revisit before any long-lived public hosting (TODO: surface authorAttributions).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PLACES_BASE = 'https://places.googleapis.com/v1';

// name looks like "places/<PLACE_ID>/photos/<PHOTO_REF>" (the resource name from places.photos).
export function placePhotoUrl(name, { apiKey, maxWidthPx = 1400 } = {}) {
  return `${PLACES_BASE}/${name}/media?maxWidthPx=${maxWidthPx}&key=${encodeURIComponent(apiKey || '')}`;
}

// Download up to `max` photos into outDir as photo-0.jpg, photo-1.jpg, … Returns the saved absolute
// paths (in order). `fetchImpl` is injected for offline tests. Skips any photo that fails — a build
// must never break on a bad image.
export async function downloadPhotos(names, outDir, { apiKey, max = 5, maxWidthPx = 1400, fetchImpl = fetch } = {}) {
  if (!apiKey || !Array.isArray(names) || !names.length) return [];
  mkdirSync(outDir, { recursive: true });
  const saved = [];
  for (const name of names.slice(0, max)) {
    try {
      const res = await fetchImpl(placePhotoUrl(name, { apiKey, maxWidthPx }), { redirect: 'follow' });
      if (!res || !res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) continue;
      const file = join(outDir, `photo-${saved.length}.jpg`);
      writeFileSync(file, buf);
      saved.push(file);
    } catch { /* skip a bad photo, keep the rest */ }
  }
  return saved;
}
