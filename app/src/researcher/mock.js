// Offline fake shops for building/testing without any API key or network.
const DATA = [
  { name: 'Fade Theory', niche: 'barbershop', city: 'Austin, TX', address: '120 E 6th St', phone: '(512) 555-0148', instagram: 'https://instagram.com/fadetheory', hasWebsite: false, vibe: 'skin fades, classic shop feel' },
  { name: 'Sharp & Co Barbers', niche: 'barbershop', city: 'Austin, TX', address: '900 S Lamar Blvd', phone: '(512) 555-0167', instagram: 'https://instagram.com/sharpandco', hasWebsite: false, vibe: 'modern, appointment-only' },
  { name: 'Capital Cuts', niche: 'barbershop', city: 'Austin, TX', address: '55 Congress Ave', phone: '(512) 555-0110', hasWebsite: true, vibe: 'has a wix site already' },
  { name: 'Morning Ember', niche: 'cafe', city: 'Austin, TX', address: '88 E Cesar Chavez St', phone: '(512) 555-0192', instagram: 'https://instagram.com/morningember', hasWebsite: false, vibe: 'single-origin pour-overs, pastries' },
  { name: 'Live Oak Coffee', niche: 'cafe', city: 'Austin, TX', address: '210 W 4th St', phone: '(512) 555-0175', instagram: 'https://instagram.com/liveoakcoffee', hasWebsite: false, vibe: 'cozy brunch spot' },
  { name: 'Chain Coffee Co', niche: 'cafe', city: 'Austin, TX', address: '1 Mall Dr', phone: '(512) 555-0100', hasWebsite: true, vibe: 'franchise, has site' },
];

export async function search({ niche, limit = 20 }) {
  return DATA
    .filter((d) => !niche || d.niche === niche)
    .slice(0, limit)
    .map((d) => ({ ...d, source: 'mock' }));
}
