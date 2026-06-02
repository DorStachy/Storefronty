// Real shops via Google Places API (Text Search, v1). Pulls a RICH profile so the builder can
// make a tailored site: real description, opening hours, rating, review count, price level, type.
// (No email field exists in Places — email discovery / manual entry happens later; during local
// tests the salesman sends to your test inbox anyway.)
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
  'places.editorialSummary', 'places.googleMapsUri',
].join(',');

export async function search({ niche, city, limit = 20, apiKey }) {
  if (!apiKey) throw new Error('GOOGLE_PLACES_KEY is not set (set it in app/.env or use RESEARCHER_ENGINE=mock)');
  const textQuery = `${NICHE_QUERY[niche] || niche} in ${city}`;
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': FIELD_MASK },
    body: JSON.stringify({ textQuery, pageSize: Math.min(limit, 20) }),
  });
  if (!res.ok) throw new Error(`Places API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.places || []).map((p) => ({
    name: p.displayName?.text || 'Unknown',
    niche,
    city,
    address: p.formattedAddress || null,
    phone: p.nationalPhoneNumber || null,
    email: null,
    instagram: null,
    websiteUri: p.websiteUri || null,
    hasWebsite: !!p.websiteUri,
    vibe: p.primaryTypeDisplayName?.text || (p.types || [])[0] || niche,
    source: `places:${p.id}`,
    // the rich profile the builder (and later the AI builder) can draw on:
    details: {
      summary: p.editorialSummary?.text || null,
      rating: p.rating ?? null,
      reviewCount: p.userRatingCount ?? null,
      priceLevel: p.priceLevel || null,
      primaryType: p.primaryTypeDisplayName?.text || null,
      hours: p.regularOpeningHours?.weekdayDescriptions || null,
      mapsUri: p.googleMapsUri || null,
    },
  }));
}
