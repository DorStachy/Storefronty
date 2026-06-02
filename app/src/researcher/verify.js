// Website verifier. Google Places' websiteUri is blank when a business never linked its site on
// Google — but the site can still exist. So for each "no-website" candidate we derive likely
// domains from the business name and probe them. ANY HTTP response (200/301/401/403/…) means a
// server is hosting that domain → the business already has a website → drop the lead.
// (Conservative on purpose: we'd rather skip a real lead than email a shop that already has a site.)

const STOP = new Set([
  'the', 'a', 'an', 'and', 'of', 'cafe', 'café', 'coffee', 'barber', 'barbershop', 'shop', 'salon',
  'beauty', 'bar', 'co', 'llc', 'inc', 'restaurant', 'kitchen', 'house', 'grill', 'bakery', 'studio',
  'hair', 'nails', 'nail', 'spa',
]);

export function tokens(name) {
  return (name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
}

export function candidateDomains(name) {
  const t = tokens(name);
  if (!t.length) return [];
  const core = t.filter((w) => !STOP.has(w));
  const bases = [];
  const addBase = (arr) => { if (arr.length) { bases.push(arr.join('')); bases.push(arr.join('-')); } };
  addBase(t);                                    // full name (most specific)
  if (core.length && core.length !== t.length) addBase(core);  // without category words
  const seen = new Set(), out = [];
  for (const base of bases) for (const tld of ['com', 'net', 'co']) {
    const d = `${base}.${tld}`;
    if (!seen.has(d)) { seen.add(d); out.push(d); }
  }
  return out.slice(0, 8);
}

async function alive(domain) {
  for (const scheme of ['https://', 'http://']) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(scheme + domain, {
        method: 'GET', redirect: 'follow', signal: ctrl.signal,
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; StorefrontyBot/1.0)' },
      });
      clearTimeout(timer);
      if (res && typeof res.status === 'number') return res.url || (scheme + domain);
    } catch { /* DNS/connection failure → this domain isn't hosting anything */ }
  }
  return null;
}

// Returns the URL of an existing website for this business, or null if none found.
export async function findWebsite(lead) {
  for (const d of candidateDomains(lead.name)) {
    const url = await alive(d);
    if (url) return url;
  }
  return null;
}
