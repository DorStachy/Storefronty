// Real shops via Google Places API (Text Search, v1). Pulls a RICH profile so the builder can
// make a tailored site: real description, opening hours, rating, review count, price level, type.
// (No email field exists in Places — email discovery / manual entry happens later; during local
// tests the salesman sends to your test inbox anyway.)
import { host as urlHost } from '../util/text.js';
import { isAggregator } from '../discovery/index.js';

const NICHE_QUERY = {
  barbershop: 'barber shop',
  salon: 'hair salon',
  cafe: 'coffee shop',
  restaurant: 'restaurant',
};

const FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.nationalPhoneNumber',
  'places.websiteUri', 'places.types', 'places.primaryTypeDisplayName', 'places.rating',
  'places.userRatingCount', 'places.priceLevel', 'places.regularOpeningHours',
  'places.editorialSummary', 'places.googleMapsUri', 'places.location', 'places.photos',
].join(',');

// Map one raw Places result into our lead shape. Exported for unit-testing the websiteUri
// filtering rule (aggregator URIs don't count as "they have a website").
export function mapPlace(p, { niche, city }) {
  const wu = p.websiteUri || null;
  const wuHost = wu ? urlHost(wu) : '';
  const wuIsAggregator = wuHost ? isAggregator(wuHost) : false;
  return {
    name: p.displayName?.text || 'Unknown',
    niche,
    city,
    address: p.formattedAddress || null,
    phone: p.nationalPhoneNumber || null,
    email: null,
    instagram: null,
    websiteUri: wu,
    // Places' websiteUri sometimes points at an aggregator (linktr.ee, instagram.com, a
    // facebook page). That's not a real "they have their own site" signal — let discovery
    // verify properly. hasWebsite is true only when the URI is a non-aggregator host.
    hasWebsite: !!wu && !wuIsAggregator,
    vibe: p.primaryTypeDisplayName?.text || (p.types || [])[0] || niche,
    source: `places:${p.id}`,
    details: {
      summary: p.editorialSummary?.text || null,
      rating: p.rating ?? null,
      reviewCount: p.userRatingCount ?? null,
      priceLevel: p.priceLevel || null,
      primaryType: p.primaryTypeDisplayName?.text || null,
      hours: p.regularOpeningHours?.weekdayDescriptions || null,
      mapsUri: p.googleMapsUri || null,
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
      // The shop's OWN Google photos (resource names) — downloaded at build time for the hero +
      // gallery so the demo site shows their real place, not placeholders. See src/photos/.
      photos: (Array.isArray(p.photos) ? p.photos : []).map((ph) => ph.name).filter(Boolean).slice(0, 10),
    },
  };
}

// Text Search v1 returns ≤20 places/page + a nextPageToken; we page through (up to ~60 total) until
// `limit` is reached or the pages run out. fetchImpl is injectable so pagination is unit-tested offline.
export async function search({ niche, city, limit = 20, apiKey, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('GOOGLE_PLACES_KEY is not set (set it in app/.env or use RESEARCHER_ENGINE=mock)');
  const textQuery = `${NICHE_QUERY[niche] || niche} in ${city}`;
  const fieldMask = `${FIELD_MASK},nextPageToken`;
  const out = [];
  let pageToken;
  do {
    const body = { textQuery, pageSize: Math.min(limit - out.length, 20) };
    if (pageToken) body.pageToken = pageToken;
    const res = await fetchImpl('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': fieldMask },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Places API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    for (const p of (data.places || [])) out.push(mapPlace(p, { niche, city }));
    pageToken = data.nextPageToken;
  } while (pageToken && out.length < limit);
  return out.slice(0, limit);
}
