// The Builder: a lead -> a finished website + pricing page.
// Uses the lead's RICH profile (details: real description, hours, rating) when available, and
// falls back to niche-appropriate defaults so a site always renders. renderSite() is pure;
// build() writes the files into app/public/<slug>/.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml, safeUrl } from '../util/html.js';

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

// "Monday: 9:00 AM – 8:00 PM" -> "9:00 AM – 8:00 PM" (or "Closed"); null if that day isn't listed.
function pickDay(weekdayDescriptions, day) {
  if (!Array.isArray(weekdayDescriptions)) return null;
  const line = weekdayDescriptions.find((x) => x.startsWith(day));
  return line ? line.split(/:\s(.+)/)[1] || 'Closed' : null;
}

function parseDetails(lead) {
  if (!lead.details) return {};
  return typeof lead.details === 'string' ? JSON.parse(lead.details) : lead.details;
}

const SOCIAL_LABELS = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok' };

// Render the verified "Check our socials" footer fragment. Reads lead.socials (object or JSON
// string), falls back to a lead-level instagram, and drops any link whose URL doesn't pass safeUrl.
// Returns '' when there's nothing to show (so the section disappears cleanly).
function renderSocials(lead) {
  let socials = {};
  if (lead.socials) {
    try { socials = typeof lead.socials === 'string' ? JSON.parse(lead.socials) : lead.socials; } catch { socials = {}; }
  }
  if (!socials.instagram && lead.instagram) socials = { ...socials, instagram: lead.instagram };
  const links = [];
  for (const [key, label] of Object.entries(SOCIAL_LABELS)) {
    const safe = safeUrl(socials[key]);
    if (!socials[key] || safe === '#') continue;           // missing or neutralized → skip
    links.push(`<a href="${escapeHtml(safe)}">${label}</a>`);
  }
  return links.length ? ` · ${links.join(' · ')}` : '';
}

export async function renderSite(lead, config, overrides = {}) {
  const d = DEFAULTS[lead.niche] || DEFAULTS.barbershop;
  const det = parseDetails(lead);
  const tpl = readFileSync(join(SITE, 'templates', TEMPLATE[lead.niche] || 'barbershop.html'), 'utf8');
  const pricingTpl = readFileSync(join(SITE, 'pricing.html'), 'utf8');
  const s = d.services;

  // Tagline: real Google description > human "vibe" > niche default.
  const niceVibe = lead.vibe && !lead.vibe.includes('_') ? cap(lead.vibe) : '';
  const tagline = det.summary || niceVibe || d.tagline;

  // Hours: real weekday hours when we have them, else niche defaults.
  const weekday = pickDay(det.hours, 'Monday') || d.hours[0];
  const sat = pickDay(det.hours, 'Saturday') || d.hours[1];
  const sun = pickDay(det.hours, 'Sunday') ?? d.hours[2];

  // Real Google rating becomes a trust badge in the hero (empty if we have none).
  const ratingBadge = det.rating
    ? `<div class="rating">★ ${escapeHtml(det.rating)}${det.reviewCount ? ` · ${escapeHtml(det.reviewCount)} Google reviews` : ''}</div>`
    : '';

  // Every interpolated value is escaped (untrusted lead fields → stored-XSS otherwise).
  const map = {
    shopName: escapeHtml(lead.name), city: escapeHtml(lead.city || ''), phone: escapeHtml(lead.phone || ''),
    address: escapeHtml(lead.address || ''), socialsHtml: renderSocials(lead),
    tagline: escapeHtml(tagline), ratingBadge,
    headlineTop: d.headlineTop, headlineBottom: d.headlineBottom,
    hoursWeekday: escapeHtml(weekday), hoursSat: escapeHtml(sat), hoursSun: escapeHtml(sun),
    svc1Name: escapeHtml(s[0][0]), svc1Desc: escapeHtml(s[0][1]), svc1Price: escapeHtml(s[0][2]),
    svc2Name: escapeHtml(s[1][0]), svc2Desc: escapeHtml(s[1][1]), svc2Price: escapeHtml(s[1][2]),
    svc3Name: escapeHtml(s[2][0]), svc3Desc: escapeHtml(s[2][1]), svc3Price: escapeHtml(s[2][2]),
    ownerEmail: escapeHtml(config.mail?.user || 'you@storefronty.com'),
    postalAddress: escapeHtml(config.postalAddress || ''),
    // Editor overrides (e.g. an accent-colour <style>). Built from a fixed palette, not raw user
    // text, so it is safe to inject unescaped. Empty string when there's no override.
    injectHeadHtml: overrides.injectHeadHtml || '',
  };
  return {
    slug: slugify(lead.name) || `lead-${lead.id}`,
    indexHtml: fill(tpl, map),
    pricingHtml: fill(pricingTpl, map).replace('href="styles.css"', 'href="../styles.css"'),
  };
}

export async function build(lead, config, overrides = {}) {
  const { slug, indexHtml, pricingHtml } = await renderSite(lead, config, overrides);
  const dir = join(PUBLIC_DIR, slug);
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(SITE, 'styles.css'), join(PUBLIC_DIR, 'styles.css'));
  const htmlPath = join(dir, 'index.html');
  const pricingPath = join(dir, 'pricing.html');
  writeFileSync(htmlPath, indexHtml);
  writeFileSync(pricingPath, pricingHtml);
  return { engine: 'template', slug, htmlPath, pricingPath, screenshotPath: null };
}
