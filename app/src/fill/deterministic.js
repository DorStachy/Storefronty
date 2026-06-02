// lead -> ContentContract using ONLY the lead's real fields. Never invents specifics.
import { CONTRACT_VERSION } from '../contract/contract.js';

// Exported so the grounding layer reuses the SAME niche whitelists (single source of truth — no
// duplicated lists to drift). DAY3/titleCase/safeJson are shared parsing helpers.
export const DAY3 = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };
export const SERVICES = {
  barbershop: ['Haircuts', 'Fades', 'Beard Trim', 'Hot Towel Shave'],
  'nail salon': ['Manicure', 'Pedicure', 'Gel Nails', 'Nail Art'],
  'hair salon': ['Haircuts', 'Color', 'Styling', 'Blowouts'],
  cafe: ['Coffee', 'Pastries', 'Breakfast', 'Lunch'],
  'food truck': ['Tacos', 'Sides', 'Drinks'],
  gym: ['Memberships', 'Personal Training', 'Group Classes'],
};
export const GALLERY = {
  barbershop: ['barbershop interior', 'fade haircut', 'hot towel shave', 'vintage barber chair'],
  cafe: ['cafe interior morning light', 'latte art', 'fresh pastries', 'coffee beans'],
};
const fallbackServices = ['Our Services', 'What We Offer', 'Visit Us'];

const desc = (name) => `${name} for our customers.`;

export function fillDeterministic(lead) {
  const det = lead.details ? (typeof lead.details === 'string' ? safeJson(lead.details) : lead.details) : {};
  const niche = (lead.niche || '').toLowerCase();
  const category = det.primaryType || titleCase(niche) || 'Local Business';
  const city = lead.city || '';

  const services = (SERVICES[niche] || fallbackServices).slice(0, 5).map((n) => ({ name: n, desc: desc(n) }));

  const display = (Array.isArray(det.hours) ? det.hours : [])
    .map((line) => { const m = String(line).match(/^([A-Za-z]+):\s*(.+)$/); return m && DAY3[m[1].toLowerCase()] ? { day: DAY3[m[1].toLowerCase()], value: m[2] } : null; })
    .filter(Boolean);

  return {
    schemaVersion: CONTRACT_VERSION,
    shopName: lead.name,
    eyebrow: city ? `${category} in ${city.split(',')[0]}` : category,
    tagline: `${category}${city ? ` in ${city.split(',')[0]}` : ''}.`,
    about: { paragraphs: [
      `${lead.name} is a ${category.toLowerCase()}${city ? ` in ${city}` : ''}.` +
      (det.rating ? ` Rated ${det.rating} stars across ${det.reviewCount || 0} reviews.` : ''),
    ] },
    services,
    hours: { display: display.length ? display : [{ day: 'Mon', value: 'Call for hours' }] },
    rating: { stars: Number(det.rating) || 0, count: Number(det.reviewCount) || 0 },
    contact: { addressLines: addrLines(lead.address, city), ...(lead.phone ? { phone: lead.phone } : {}), ...(city ? { areaServed: city } : {}) },
    cta: { label: 'Get in Touch', kind: 'call' },
    galleryQueries: GALLERY[niche] || [`${niche || 'local business'} interior`, `${niche || 'local business'} detail`, 'storefront'],
  };
}

function addrLines(address, city) {
  if (!address) return [city || 'Contact us'];
  const parts = String(address).split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 2 ? [parts[0], parts.slice(1, 3).join(', ')] : parts.length ? parts : [city || 'Contact us'];
}
export const titleCase = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
export const safeJson = (s) => { try { return JSON.parse(s); } catch { return {}; } };
