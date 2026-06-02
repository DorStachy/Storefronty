// Niche -> theme name. Default editorial (most versatile). See spec design doc 5.1.
const MAP = {
  editorial: ['hair salon', 'nail salon', 'salon', 'beauty', 'spa', 'cafe', 'coffee', 'bakery', 'florist', 'boutique', 'gift'],
  luxe: ['barbershop', 'barber', 'tattoo', 'steakhouse', 'bar', 'lounge', 'fine dining'],
  bold: ['gym', 'fitness', 'food truck', 'plumber', 'electrician', 'landscaper', 'cleaner', 'auto', 'trade', 'contractor'],
};
export function themeForNiche(niche) {
  const n = String(niche || '').toLowerCase();
  for (const [theme, keys] of Object.entries(MAP)) if (keys.some((k) => n.includes(k))) return theme;
  return 'editorial';
}
export const THEMES = ['editorial', 'luxe', 'bold'];
