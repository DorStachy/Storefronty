// Real shops via Google Places API (Text Search, v1). Returns normalized leads.
// Needs GOOGLE_PLACES_KEY. Note: Places has no email field — email discovery / manual entry
// happens later; during local tests the salesman sends to your test inbox anyway.
const NICHE_QUERY = {
  barbershop: 'barber shop',
  salon: 'hair salon',
  cafe: 'coffee shop',
  restaurant: 'restaurant',
};

export async function search({ niche, city, limit = 20, apiKey }) {
  if (!apiKey) throw new Error('GOOGLE_PLACES_KEY is not set (set it in app/.env or use RESEARCHER_ENGINE=mock)');
  const textQuery = `${NICHE_QUERY[niche] || niche} in ${city}`;
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.types',
    },
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
    hasWebsite: !!p.websiteUri,
    vibe: (p.types || []).slice(0, 3).join(', '),
    source: `places:${p.id}`,
  }));
}
