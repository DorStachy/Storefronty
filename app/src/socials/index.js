// Socials discovery — find a shop's Instagram / Facebook / TikTok, gated by the SAME location-aware
// identity rules as website discovery. A profile is attached as "theirs" only when the handle carries
// their distinctive name AND nothing places it in a different city (defeating same-name shops).
// Three tiers (highest confidence first):
//   1. their OWN site's JSON-LD `sameAs` + footer anchors (owner-attested)   → socialsFromSite()
//   2. a per-platform web search                                             → discoverSocials()
//   3. verify each candidate belongs to THIS shop                            → scoreSocial()
import { safeFetch } from '../util/net.js';
import { host, digits, last10, distinctiveTokens, normalizeName, nameCoverage } from '../util/text.js';

const PLATFORMS = {
  instagram: { host: 'instagram.com', word: 'instagram' },
  facebook: { host: 'facebook.com', word: 'facebook' },
  tiktok: { host: 'tiktok.com', word: 'tiktok' },
};
const IG_SKIP = new Set(['p', 'reel', 'reels', 'explore', 'stories', 'tv', 'accounts', 'about']);
const FB_SKIP = new Set(['pages', 'profile.php', 'people', 'groups', 'events', 'watch', 'marketplace', 'sharer', 'login']);
const sameHost = (h, base) => h === base || h.endsWith('.' + base);

// A social URL → { platform, handle, canonical url } or null (posts/listings/non-social → null).
export function parseSocial(rawUrl) {
  const h = host(rawUrl);
  let u;
  try { u = new URL(rawUrl); } catch { return null; }
  const seg = u.pathname.split('/').filter(Boolean);
  if (sameHost(h, 'instagram.com')) {
    const handle = (seg[0] || '').replace(/^@/, '');
    if (!handle || IG_SKIP.has(handle.toLowerCase())) return null;
    return { platform: 'instagram', handle, url: `https://instagram.com/${handle}` };
  }
  if (sameHost(h, 'tiktok.com')) {
    const seg0 = seg.find((s) => s.startsWith('@'));
    if (!seg0) return null;
    const handle = seg0.slice(1);
    return { platform: 'tiktok', handle, url: `https://tiktok.com/@${handle}` };
  }
  if (sameHost(h, 'facebook.com')) {
    const handle = seg[0] || '';
    if (!handle || FB_SKIP.has(handle.toLowerCase())) return null;
    return { platform: 'facebook', handle, url: `https://facebook.com/${handle}` };
  }
  return null;
}

// Is there an explicit "City, ST" in the blob that ISN'T ours (and our city absent)? → conflict.
function locationConflict(identity, blob) {
  const ourCity = String(identity.city || '').toLowerCase();
  if (ourCity && blob.includes(ourCity)) return false;        // our city present → not a conflict
  return /[a-z][a-z .'\-]+,\s*[a-z]{2}\b/i.test(blob);          // some other explicit place, ours absent
}

// Score one social candidate against the shop identity. accept requires the shop's distinctive name
// in the handle AND no location conflict. `corroborated` = a positive location anchor (phone/city/
// link-back) that disambiguates a same-name shop elsewhere.
export function scoreSocial(identity, cand) {
  const dt = distinctiveTokens(identity.name);
  const hn = normalizeName(cand.handle || '');
  const handleHasName = dt.length > 0 && dt.every((t) => hn.includes(t));
  const blob = `${cand.title || ''} ${cand.snippet || ''} ${cand.handle || ''}`.toLowerCase();
  const dg = digits(blob);
  const reasons = [];
  let score = 0;

  if (handleHasName) { score += 3; reasons.push('handle_name'); }
  else if (nameCoverage(identity.name, cand.title || '') >= 0.7) { score += 1; reasons.push('title_name'); }

  const ourPhone = last10(identity.phone);
  if (ourPhone && dg.includes(ourPhone)) { score += 3; reasons.push('phone'); }
  if (identity.city && blob.includes(String(identity.city).toLowerCase())) { score += 2; reasons.push('city'); }
  if (identity.websiteHost && blob.includes(String(identity.websiteHost).toLowerCase())) { score += 3; reasons.push('linkback'); }

  const conflict = locationConflict(identity, blob);
  if (conflict) { score -= 5; reasons.push('-conflict_city'); }

  const corroborated = reasons.some((r) => r === 'phone' || r === 'city' || r === 'linkback');
  const accept = handleHasName && !conflict;
  return { platform: cand.platform, url: cand.url, handle: cand.handle, score, accept, corroborated, reasons };
}

// Per platform: the best accepted candidate. A location-corroborated one always wins; otherwise we
// attach the sole accepted candidate, but NEVER guess between same-name rivals with no location signal.
function pickBest(scored) {
  const ok = scored.filter((s) => s.accept).sort((a, b) => b.score - a.score);
  if (!ok.length) return null;
  if (ok[0].corroborated) return ok[0];
  if (ok.length === 1) return ok[0];
  return null;
}

// Tier 1 — the shop's own site is the highest-confidence source (owner-attested): JSON-LD sameAs +
// any social anchors. Returns { instagram?, facebook?, tiktok? } of canonical URLs.
export function socialsFromSite(html) {
  const s = String(html || '');
  const out = {};
  const consider = (url) => {
    const p = parseSocial(url);
    if (p && !out[p.platform]) out[p.platform] = p.url;
  };
  for (const m of s.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data; try { data = JSON.parse(m[1]); } catch { continue; }
    for (const node of (Array.isArray(data) ? data : [data])) {
      const same = node?.sameAs;
      for (const u of (Array.isArray(same) ? same : same ? [same] : [])) consider(u);
    }
  }
  for (const m of s.matchAll(/href=["']([^"']+)["']/gi)) consider(m[1]);
  return out;
}

// Tier 2+3 — search each missing platform, verify each candidate belongs to THIS shop, attach the
// verified one. searchFn(query) -> [organic] | { organic }. Optional ownSiteHtml seeds Tier 1.
export async function discoverSocials(identity, { searchFn = null, fetchPage = safeFetch, ownSiteHtml = null, cfg = {} } = {}) {
  const out = ownSiteHtml ? socialsFromSite(ownSiteHtml) : {};
  if (!searchFn) return out;
  const region = [identity.city, identity.state].filter(Boolean).join(' ');
  for (const [platform, meta] of Object.entries(PLATFORMS)) {
    if (out[platform]) continue;                               // already owner-attested (Tier 1)
    const q = `"${identity.name}" ${region} ${meta.word}`.trim();
    let raw;
    try { raw = await searchFn(q); } catch { continue; }
    const results = Array.isArray(raw) ? raw : (raw?.organic || []);
    const scored = [];
    for (const r of results) {
      const h = host(r.url);
      if (!sameHost(h, meta.host)) continue;
      const parsed = parseSocial(r.url);
      if (!parsed || parsed.platform !== platform) continue;
      scored.push(scoreSocial(identity, { ...parsed, title: r.title, snippet: r.snippet }));
    }
    const chosen = pickBest(scored);
    if (chosen) out[platform] = chosen.url;
  }
  return out;
}
