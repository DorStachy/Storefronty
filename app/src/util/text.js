// Shared text/identity helpers used by discovery, socials, and verification.
export const digits = (s) => String(s ?? '').replace(/\D/g, '');
export const last10 = (s) => digits(s).slice(-10);
export const areaCode = (phone) => { const d = last10(phone); return d.length === 10 ? d.slice(0, 3) : ''; };

export function host(u) {
  try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}
// Approximate registrable domain (eTLD+1). Good enough for .com/.net/.org; imprecise for
// multi-label TLDs like .co.uk (treated as 2 labels) — acceptable for our matching/denylist use.
export function registrable(h) {
  const parts = String(h || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  return parts.length <= 2 ? parts.join('.') : parts.slice(-2).join('.');
}

const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'llc', 'inc', 'co', 'ltd', 'corp']);
const GENERIC = new Set(['barber', 'barbershop', 'salon', 'cafe', 'coffee', 'restaurant', 'kitchen', 'bar', 'shop', 'beauty', 'hair', 'nails', 'nail', 'spa', 'grill', 'bakery', 'studio', 'house']);

export function normalizeName(s) {
  return String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}
export function nameTokens(s, { keepGeneric = true } = {}) {
  return normalizeName(s).split(' ').filter((t) => t && !STOP.has(t) && (keepGeneric || !GENERIC.has(t)));
}
export const distinctiveTokens = (s) => nameTokens(s, { keepGeneric: false });

// fraction of distinctive business-name tokens present in the given haystacks (0..1)
export function nameCoverage(name, ...haystacks) {
  const toks = distinctiveTokens(name);
  if (!toks.length) return 0;
  const hay = haystacks.join(' ').toLowerCase();
  return toks.filter((t) => hay.includes(t)).length / toks.length;
}

// Parse a Places-style "street address, city, state ZIP, country" string into the bits
// discovery's scoreCandidate consumes (street + zip). Best-effort — sloppy addresses are fine,
// we just won't extract as much. Strips "apt/ste/unit/#" suffixes from the street so the prefix
// matches what real shop websites actually print on contact pages.
export function parseAddress(address) {
  const s = String(address || '').trim();
  if (!s) return { street: '', zip: '' };
  const zipMatch = s.match(/\b(\d{5})(?:-\d{4})?\b/);
  const zip = zipMatch ? zipMatch[1] : '';
  const firstPart = s.split(',')[0].trim();
  // Drop apt/ste/unit/# tails: "411 Brazos St APT 101" → "411 Brazos St"
  const street = firstPart.replace(/\s+(apt|ste|suite|unit|#)\.?\s*\S+.*$/i, '').trim();
  return { street, zip };
}
