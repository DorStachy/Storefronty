// Validated design tokens (the "look"). Every field is allow-listed/typed → the model can pick freely
// but can never inject unsafe CSS or non-self-contained references. Off-list/garbage → coerced to a
// sensible default (a spec ALWAYS validates; it never throws). Mirrors the repair-not-reject ethos of
// contract.js.
export const LAYOUTS = ['editorial', 'luxe', 'bold'];
export const SCALES = ['compact', 'comfortable', 'spacious'];
export const RADII = ['sharp', 'soft', 'round'];
export const SHADOWS = ['none', 'subtle', 'lifted'];
export const MOTIONS = ['none', 'subtle'];
export const TEXTURES = ['flat', 'grain', 'gradient'];

// Curated, tasteful Google-Fonts pairings (real, loadable). Index 0 of each is the default.
export const FONTS = {
  display: ['Fraunces', 'Playfair Display', 'Cormorant Garamond', 'Space Grotesk', 'Archivo', 'Bricolage Grotesque', 'Libre Caslon Text'],
  body: ['Inter', 'Source Sans 3', 'Work Sans', 'Newsreader', 'Libre Franklin', 'IBM Plex Sans'],
};

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const DEFAULT_PALETTE = { bg: '#0b0b0d', surface: '#15151a', ink: '#f5f3ee', muted: '#a39e95', accent: '#c8a24a', accentInk: '#0b0b0d' };

export const DEFAULT_DESIGN = {
  layout: 'editorial', palette: { ...DEFAULT_PALETTE },
  fonts: { display: FONTS.display[0], body: FONTS.body[0] },
  scale: 'comfortable', radius: 'soft', shadow: 'subtle', motion: 'subtle', texture: 'flat',
};

const pick = (list, v, dflt) => (list.includes(v) ? v : dflt);
const hex = (v, dflt) => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toLowerCase() : dflt);

export function validateDesignSpec(input) {
  const o = input && typeof input === 'object' ? input : {};
  const p = o.palette && typeof o.palette === 'object' ? o.palette : {};
  const f = o.fonts && typeof o.fonts === 'object' ? o.fonts : {};
  return {
    layout: pick(LAYOUTS, o.layout, DEFAULT_DESIGN.layout),
    palette: {
      bg: hex(p.bg, DEFAULT_PALETTE.bg), surface: hex(p.surface, DEFAULT_PALETTE.surface),
      ink: hex(p.ink, DEFAULT_PALETTE.ink), muted: hex(p.muted, DEFAULT_PALETTE.muted),
      accent: hex(p.accent, DEFAULT_PALETTE.accent), accentInk: hex(p.accentInk, DEFAULT_PALETTE.accentInk),
    },
    fonts: { display: pick(FONTS.display, f.display, FONTS.display[0]), body: pick(FONTS.body, f.body, FONTS.body[0]) },
    scale: pick(SCALES, o.scale, DEFAULT_DESIGN.scale),
    radius: pick(RADII, o.radius, DEFAULT_DESIGN.radius),
    shadow: pick(SHADOWS, o.shadow, DEFAULT_DESIGN.shadow),
    motion: pick(MOTIONS, o.motion, DEFAULT_DESIGN.motion),
    texture: pick(TEXTURES, o.texture, DEFAULT_DESIGN.texture),
  };
}

// A sensible default look per niche (the deterministic fallback's design, and a starting point the
// model can override). Kept small + obviously-valid; validateDesignSpec is idempotent on these.
const NICHE_DESIGN = {
  barber:     { layout: 'bold', palette: { bg: '#101013', surface: '#18181c', ink: '#f3f1ec', muted: '#9b958b', accent: '#c0894a', accentInk: '#101013' }, fonts: { display: 'Archivo', body: 'Work Sans' }, radius: 'sharp', texture: 'grain' },
  restaurant: { layout: 'luxe', palette: { bg: '#0d0b09', surface: '#171310', ink: '#f6efe6', muted: '#b0a394', accent: '#c8a24a', accentInk: '#0d0b09' }, fonts: { display: 'Fraunces', body: 'Newsreader' }, radius: 'soft', texture: 'gradient' },
  yoga:       { layout: 'editorial', palette: { bg: '#faf7f2', surface: '#ffffff', ink: '#23211d', muted: '#6f6a61', accent: '#7c8a6a', accentInk: '#ffffff' }, fonts: { display: 'Cormorant Garamond', body: 'Inter' }, radius: 'round', texture: 'flat' },
};
export function designForNiche(niche) {
  return validateDesignSpec(NICHE_DESIGN[String(niche || '').toLowerCase()] || DEFAULT_DESIGN);
}

export function googleFontsHref({ display, body } = {}) {
  const fam = (n) => `family=${encodeURIComponent(pick([...FONTS.display, ...FONTS.body], n, FONTS.body[0]))}:wght@400;500;600;700`;
  return `https://fonts.googleapis.com/css2?${fam(display)}&${fam(body)}&display=swap`;
}
