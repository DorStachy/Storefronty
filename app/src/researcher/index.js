// The Researcher: city + niche -> shops with NO website.
// Two-stage: (1) the engine reports candidates (Places filters its own websiteUri), then
// (2) location-anchored web DISCOVERY confirms each truly has no site of its own.
// Discovery only runs when a real search function is available (Serper/SerpApi key); otherwise
// we keep the Places-only signal so offline/mock runs still work.
import * as mock from './mock.js';
import * as places from './places.js';
import { discoverWebsite } from '../discovery/index.js';
import { parseAddress } from '../util/text.js';

const ENGINES = { mock, places };

export async function research({ niche, city, limit = 20, engine = 'mock', apiKey = '', searchFn = null } = {}) {
  const mod = ENGINES[engine];
  if (!mod) throw new Error(`unknown researcher engine: ${engine}`);
  const found = await mod.search({ niche, city, limit, apiKey });
  const candidates = found.filter((l) => !l.hasWebsite);

  if (!searchFn) return candidates.map((l) => ({ ...l, website_status: 'unknown' }));

  const cityName = String(city || '').split(',')[0].trim();
  const state = String(city || '').split(',')[1]?.trim() || '';
  const kept = [];
  for (const l of candidates) {
    const { street, zip } = parseAddress(l.address);   // boosts discovery accuracy when phone is missing
    let r;
    try {
      r = await discoverWebsite(
        { name: l.name, city: cityName, state, phone: l.phone, street, zip, websiteUri: l.websiteUri || null },
        { searchFn });
    } catch { r = { status: 'UNCERTAIN' }; }
    if (r.status === 'NO_WEBSITE') {
      kept.push({ ...l, website_status: 'none' });
    } else {
      console.log(`    ✗ ${r.status}: ${l.name}${r.website ? ` → ${r.website}` : ''}`);
    }
  }
  return kept;
}
