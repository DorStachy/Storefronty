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

const parseDetails = (lead) => {
  if (!lead.details) return {};
  return typeof lead.details === 'string' ? (() => { try { return JSON.parse(lead.details); } catch { return {}; } })() : lead.details;
};

// The FULL identity we hand to discovery for THIS exact shop — never the name alone. Same-name
// shops elsewhere are defeated by these location-unique fields (phone, street/ZIP, place_id/cid,
// lat/lng). `cityArg` is the research city; the lead's own city wins when present.
export function buildIdentity(lead, cityArg = '') {
  const det = parseDetails(lead);
  const region = String(lead.city || cityArg || '');
  const { street, zip } = parseAddress(lead.address);
  const placeId = String(lead.source || '').startsWith('places:') ? lead.source.slice(7) : null;
  return {
    name: lead.name,
    city: region.split(',')[0].trim(),
    state: region.split(',')[1]?.trim() || '',
    phone: lead.phone || null,
    street, zip,
    placeId,
    lat: det.lat ?? null,
    lng: det.lng ?? null,
    mapsUri: det.mapsUri || null,
    websiteUri: lead.websiteUri || null,
  };
}

export async function research(
  { niche, city, limit = 20, engine = 'mock', apiKey = '', searchFn = null } = {},
  { discover = discoverWebsite } = {},
) {
  const mod = ENGINES[engine];
  if (!mod) throw new Error(`unknown researcher engine: ${engine}`);
  const found = await mod.search({ niche, city, limit, apiKey });
  const candidates = found.filter((l) => !l.hasWebsite);

  if (!searchFn) return candidates.map((l) => ({ ...l, website_status: 'unknown' }));

  const kept = [];
  for (const l of candidates) {
    let r;
    try {
      r = await discover(buildIdentity(l, city), { searchFn });
    } catch { r = { status: 'UNCERTAIN' }; }
    if (r.status === 'NO_WEBSITE') {
      kept.push({ ...l, website_status: 'none' });
    } else {
      console.log(`    ✗ ${r.status}: ${l.name}${r.website ? ` → ${r.website}` : ''}`);
    }
  }
  return kept;
}
