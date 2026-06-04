// The "art-direction north star" injected into the Opus prompt — distilled design DNA (the patterns
// behind Awwwards / Land-book / Mobbin / Dribbble local-business sites), made niche-aware. We do NOT
// fetch those galleries at runtime; we encode the principles. Returns a prompt fragment, never UI.
const UNIVERSAL = [
  'Design like a top studio with a real point of view — never a template. Commit to ONE confident,',
  'memorable aesthetic and execute it precisely: a dominant brand color carried across large areas with',
  'ONE sharp accent (not a timid, evenly-spread palette); a distinctive display + body type pairing with',
  'a strong editorial hierarchy (big confident headings, calm readable body); generous whitespace and',
  'rhythm; and atmosphere/depth — subtle gradient washes, fine grain, layered transparency, soft shadows',
  '— so the page feels alive, not flat. The shop\'s REAL photography carries the hero and gallery.',
  '',
  'PALETTE — light by default. Choose a bright, airy, inviting palette (warm off-white / cream / a softly',
  'tinted background with deep, readable ink) for most local businesses: salons, cafes, bakeries,',
  'florists, boutiques, yoga, clinics, and most restaurants. Reserve dark / moody palettes ONLY for places',
  'whose real vibe is genuinely dark — cocktail bars, steakhouses, tattoo parlors, late-night venues. When',
  'in doubt, go light. Always keep AA contrast. Avoid generic "bootstrap" looks, purple-on-white gradients,',
  'rainbow colors, clip-art, and emoji.',
].join(' ');

const NICHE = {
  restaurant: 'Appetite-driving and warm: let real food photos dominate, menu reads like a printed card, expressive serif display. Light and airy for a brunch or cafe room; deep and moody only for an upscale dinner room.',
  barber: 'Bold, confident, high-contrast: heavy condensed display, a strong accent, crisp structure. Clean and modern (light) or premium-grooming dark — match the actual shop.',
  salon: 'Fresh, modern beauty: a bright, airy off-white background, one elegant accent (soft blush, terracotta, sage, or muted gold), a refined high-contrast serif display, lots of breathing room; the work + interior photos lead. Polished and inviting — never dark or clinical.',
  yoga: 'Calm, airy, light: off-white background, soft sage/earth accent, elegant serif display, lots of breathing room.',
  cafe: 'Cozy, hand-made warmth: cream and latte tones, friendly rounded shapes, bright inviting photography.',
};

// Resolve a free-form niche string to a brief key by substring (so 'nail salon', 'hair salon',
// 'coffee shop' all resolve), mirroring themes/map.js. First match wins.
const NICHE_MATCH = [
  [/barber/, 'barber'],
  [/nail|hair|salon|spa|beauty|lash|brow|wax/, 'salon'],
  [/restaurant|steak|grill|dining|bistro|eatery|taqueria|bbq|barbecue|pizz|kitchen/, 'restaurant'],
  [/cafe|coffee|espresso|bakery|brunch|patisserie|\btea\b/, 'cafe'],
  [/yoga|pilates|wellness|meditation/, 'yoga'],
];

export function designBrief(niche) {
  const n = String(niche || '').toLowerCase();
  const key = NICHE_MATCH.find(([re]) => re.test(n))?.[1];
  const specific = (key && NICHE[key]) || 'Tailor the palette, type, and density to this specific business and its photos — and default to a light, bright, welcoming look unless its real vibe is genuinely dark.';
  return `${UNIVERSAL}\n\nFor a ${n || 'local business'}: ${specific}`;
}
