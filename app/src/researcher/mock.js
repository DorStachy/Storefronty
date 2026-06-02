// Offline fake shops for building/testing without any API key or network.
// A couple include a rich "details" block so the enriched builder path is testable offline.
const DATA = [
  { name: 'Fade Theory', niche: 'barbershop', city: 'Austin, TX', address: '120 E 6th St', phone: '(512) 555-0148', instagram: 'https://instagram.com/fadetheory', hasWebsite: false, vibe: 'skin fades, classic shop feel',
    details: { summary: 'Neighborhood barbershop known for precise skin fades and hot-towel shaves.', rating: 4.8, reviewCount: 214, priceLevel: 'PRICE_LEVEL_MODERATE', primaryType: 'Barber shop',
      hours: ['Monday: 9:00 AM – 8:00 PM', 'Tuesday: 9:00 AM – 8:00 PM', 'Wednesday: 9:00 AM – 8:00 PM', 'Thursday: 9:00 AM – 8:00 PM', 'Friday: 9:00 AM – 8:00 PM', 'Saturday: 10:00 AM – 4:00 PM', 'Sunday: Closed'] } },
  { name: 'Sharp & Co Barbers', niche: 'barbershop', city: 'Austin, TX', address: '900 S Lamar Blvd', phone: '(512) 555-0167', instagram: 'https://instagram.com/sharpandco', hasWebsite: false, vibe: 'modern, appointment-only' },
  { name: 'Capital Cuts', niche: 'barbershop', city: 'Austin, TX', address: '55 Congress Ave', phone: '(512) 555-0110', hasWebsite: true, vibe: 'has a wix site already' },
  { name: 'Morning Ember', niche: 'cafe', city: 'Austin, TX', address: '88 E Cesar Chavez St', phone: '(512) 555-0192', instagram: 'https://instagram.com/morningember', hasWebsite: false, vibe: 'single-origin pour-overs',
    details: { summary: 'Cozy corner cafe pouring single-origin coffee with pastries baked in-house each morning.', rating: 4.6, reviewCount: 132, priceLevel: 'PRICE_LEVEL_INEXPENSIVE', primaryType: 'Coffee shop',
      hours: ['Monday: 7:30 AM – 7:00 PM', 'Tuesday: 7:30 AM – 7:00 PM', 'Wednesday: 7:30 AM – 7:00 PM', 'Thursday: 7:30 AM – 7:00 PM', 'Friday: 7:30 AM – 7:00 PM', 'Saturday: 8:00 AM – 4:00 PM', 'Sunday: 8:00 AM – 2:00 PM'] } },
  { name: 'Live Oak Coffee', niche: 'cafe', city: 'Austin, TX', address: '210 W 4th St', phone: '(512) 555-0175', instagram: 'https://instagram.com/liveoakcoffee', hasWebsite: false, vibe: 'cozy brunch spot' },
  { name: 'Chain Coffee Co', niche: 'cafe', city: 'Austin, TX', address: '1 Mall Dr', phone: '(512) 555-0100', hasWebsite: true, vibe: 'franchise, has site' },
];

export async function search({ niche, limit = 20 }) {
  return DATA
    .filter((d) => !niche || d.niche === niche)
    .slice(0, limit)
    .map((d) => ({ ...d, source: 'mock' }));
}
