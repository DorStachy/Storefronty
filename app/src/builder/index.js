// The Builder: a lead -> a finished website + pricing page (deterministic template fill).
// renderSite() is pure (returns HTML); build() writes the files into app/public/<slug>/.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '..', '..', '..');
const SITE = join(REPO, 'site');
export const PUBLIC_DIR = resolve(here, '..', '..', 'public');

const TEMPLATE = { barbershop: 'barbershop.html', salon: 'barbershop.html', cafe: 'cafe.html', restaurant: 'cafe.html' };

const DEFAULTS = {
  barbershop: {
    headlineTop: 'A cut you', headlineBottom: 'come back for.',
    tagline: 'Skilled barbers, sharp cuts, and a chair you can sink into.',
    hours: ['9:00 AM – 8:00 PM', '9:00 AM – 2:00 PM', 'Closed'],
    services: [
      ['Men’s haircut', 'A personalized cut, classic to modern.', '35'],
      ['Beard trim', 'Shape-up, line-up, and precise styling.', '20'],
      ['VIP package', 'Haircut + beard + a hot-towel facial.', '60'],
    ],
  },
  cafe: {
    headlineTop: 'The best coffee', headlineBottom: 'in the neighborhood.',
    tagline: 'Quality coffee, fresh pastries, and a room that invites you to stay.',
    hours: ['7:30 AM – 7:00 PM', '8:00 AM – 4:00 PM', 'Closed'],
    services: [
      ['Pour-over coffee', 'Freshly roasted beans, brewed to order.', '5'],
      ['Fresh pastries', 'Croissants and sweet bakes from the oven.', '4'],
      ['Breakfast plate', 'A treat to start your day right.', '12'],
    ],
  },
};
DEFAULTS.salon = DEFAULTS.barbershop;
DEFAULTS.restaurant = DEFAULTS.cafe;

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fill = (tpl, map) => tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in map ? map[k] : m));

export async function renderSite(lead, config) {
  const d = DEFAULTS[lead.niche] || DEFAULTS.barbershop;
  const tpl = readFileSync(join(SITE, 'templates', TEMPLATE[lead.niche] || 'barbershop.html'), 'utf8');
  const pricingTpl = readFileSync(join(SITE, 'pricing.html'), 'utf8');
  const s = d.services;
  // Use the lead's "vibe" as the tagline only when it's human text (Places returns type codes with "_").
  const niceVibe = lead.vibe && !lead.vibe.includes('_') ? cap(lead.vibe) : '';
  const map = {
    shopName: lead.name, city: lead.city || '', phone: lead.phone || '',
    address: lead.address || '', instagram: lead.instagram || '#',
    tagline: niceVibe || d.tagline,
    headlineTop: d.headlineTop, headlineBottom: d.headlineBottom,
    hoursWeekday: d.hours[0], hoursSat: d.hours[1], hoursSun: d.hours[2],
    svc1Name: s[0][0], svc1Desc: s[0][1], svc1Price: s[0][2],
    svc2Name: s[1][0], svc2Desc: s[1][1], svc2Price: s[1][2],
    svc3Name: s[2][0], svc3Desc: s[2][1], svc3Price: s[2][2],
    ownerEmail: config.mail?.user || 'you@storefronty.com',
    postalAddress: config.postalAddress || '',
  };
  return {
    slug: slugify(lead.name) || `lead-${lead.id}`,
    indexHtml: fill(tpl, map),
    pricingHtml: fill(pricingTpl, map).replace('href="styles.css"', 'href="../styles.css"'),
  };
}

export async function build(lead, config) {
  const { slug, indexHtml, pricingHtml } = await renderSite(lead, config);
  const dir = join(PUBLIC_DIR, slug);
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(SITE, 'styles.css'), join(PUBLIC_DIR, 'styles.css'));
  const htmlPath = join(dir, 'index.html');
  const pricingPath = join(dir, 'pricing.html');
  writeFileSync(htmlPath, indexHtml);
  writeFileSync(pricingPath, pricingHtml);
  return { engine: 'template', slug, htmlPath, pricingPath, screenshotPath: null };
}
