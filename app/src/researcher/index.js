// The Researcher: city + niche -> shops with NO website (the leads we want).
// Two-stage "no website" check: (1) the engine reports no Places websiteUri, then (2) the verifier
// probes name-derived domains to catch sites Google didn't know about.
import * as mock from './mock.js';
import * as places from './places.js';
import { findWebsite as defaultFindWebsite } from './verify.js';

const ENGINES = { mock, places };

export async function research({ niche, city, limit = 20, engine = 'mock', apiKey = '', verify, findWebsite = defaultFindWebsite } = {}) {
  const mod = ENGINES[engine];
  if (!mod) throw new Error(`unknown researcher engine: ${engine}`);
  const found = await mod.search({ niche, city, limit, apiKey });
  const candidates = found.filter((l) => !l.hasWebsite);

  const shouldVerify = verify ?? (engine === 'places');
  if (!shouldVerify) return candidates;

  const kept = [];
  for (const l of candidates) {
    const url = await findWebsite(l);
    if (url) {
      l.hasWebsite = true;
      l.foundWebsite = url;
      console.log(`    ✗ skipped (already has a site): ${l.name} → ${url}`);
    } else {
      kept.push(l);
    }
  }
  return kept;
}
