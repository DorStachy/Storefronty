// The "art-direction north star" injected into the Opus prompt — distilled design DNA (the patterns
// behind Awwwards / Land-book / Mobbin / Dribbble local-business sites), made niche-aware. We do NOT
// fetch those galleries at runtime; we encode the principles. Returns a prompt fragment, never UI.
const UNIVERSAL = [
  'Design like a top studio, not a template: one confident accent color, generous whitespace, a strong',
  'editorial type hierarchy (big confident display headings, calm body), and the shop\'s REAL photography',
  'carrying the hero. Restraint over decoration. High contrast, tasteful. Choose a palette from the',
  'business\'s real vibe and its photos. Pick fonts that match the mood. Avoid generic "bootstrap" looks,',
  'rainbow colors, clip-art, and emoji.',
].join(' ');

const NICHE = {
  restaurant: 'Fine-dining/editorial: moody, warm, appetite-driving. Let food photos dominate; menu reads like a printed card; serif display, deep background.',
  barber: 'Bold, masculine, high-contrast: heavy condensed display, grain/texture, sharp corners, confident accent. Think premium grooming brand.',
  yoga: 'Calm, airy, light: off-white background, soft sage/earth accent, elegant serif display, lots of breathing room.',
  cafe: 'Cozy, hand-made warmth: cream tones, friendly rounded shapes, inviting photography.',
};

export function designBrief(niche) {
  const n = String(niche || '').toLowerCase();
  const specific = NICHE[n] || 'Tailor the palette, type, and density to this specific business and its photos.';
  return `${UNIVERSAL}\n\nFor a ${n || 'local business'}: ${specific}`;
}
