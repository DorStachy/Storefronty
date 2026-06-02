// Website discovery + LOCATION-ANCHORED identity verification.
// A candidate site is only accepted as "this shop's website" when corroborated by location-unique
// signals (the shop's own phone on the page is strongest; plus ZIP/street/city/area-code), and is
// penalized when a DIFFERENT phone or city appears. This defeats same-name-different-location sites:
// a café with the same name in another country can never be accepted, because its page won't carry
// THIS shop's phone/address — while the `name + phone` query surfaces the correct local site.
import { safeFetch } from '../util/net.js';
import { last10, digits, host, registrable, distinctiveTokens, areaCode } from '../util/text.js';

const DENY = ['facebook.com', 'instagram.com', 'linktr.ee', 'linktree.com', 'yelp.com', 'tripadvisor.com',
  'opentable.com', 'resy.com', 'fresha.com', 'booksy.com', 'vagaro.com', 'sites.google.com', 'business.site',
  'mapquest.com', 'google.com', 'maps.google.com', 'doordash.com', 'ubereats.com', 'grubhub.com', 'nextdoor.com',
  'foursquare.com', 'bbb.org', 'yellowpages.com', 'twitter.com', 'x.com', 'tiktok.com', 'linkedin.com', 'youtube.com'];
export const isAggregator = (h) => DENY.some((d) => h === d || h.endsWith('.' + d) || registrable(h) === d);

function parsePage(html) {
  const s = String(html || '');
  const tels = [...s.matchAll(/tel:([+\d().\-\s]{7,})/gi)].map((m) => last10(m[1])).filter(Boolean);
  const jsonld = [...s.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean)
    .flatMap((x) => (Array.isArray(x) ? x : [x]));
  const mapsLinks = [...s.matchAll(/https?:\/\/(?:www\.)?google\.[^"'\s]*\/maps[^"'\s]*/gi)].map((m) => m[0]);
  return { text: s.replace(/<[^>]+>/g, ' ').toLowerCase(), tels, jsonld, mapsLinks };
}

const businessLd = (jsonld) => (jsonld || []).find((x) => x && /LocalBusiness|Restaurant|Salon|Barber|Cafe|Store|FoodEstablishment/i.test(JSON.stringify(x['@type'] || '')));

// Score one candidate against the business identity. Returns {score, ownSite, strong, presence, reasons}.
export function scoreCandidate(biz, cand, page) {
  const h = cand.host;
  if (isAggregator(h)) return { score: 0, ownSite: false, presence: true, reasons: ['aggregator'] };

  const reasons = [];
  let score = 0, strong = false;
  const phone = last10(biz.phone);
  const blob = `${page?.text || ''} ${cand.title || ''} ${cand.snippet || ''}`.toLowerCase();
  const dg = digits(blob);
  const ld = businessLd(page?.jsonld);

  // --- location-unique (strong) --- check both visible text and extracted tel: links
  if (phone && (dg.includes(phone) || (page?.tels || []).includes(phone))) { score += 5; strong = true; reasons.push('phone'); }
  if (ld?.telephone && phone && last10(ld.telephone) === phone) { score += 2; strong = true; reasons.push('jsonld_phone'); }
  // --- location corroboration ---
  if (biz.zip && blob.includes(String(biz.zip).toLowerCase())) { score += 2; reasons.push('zip'); }
  if (biz.street && blob.includes(String(biz.street).toLowerCase())) { score += 3; reasons.push('street'); }
  if (biz.city && blob.includes(String(biz.city).toLowerCase())) { score += 1; reasons.push('city'); }
  if (areaCode(biz.phone) && page?.tels?.some((t) => t.startsWith(areaCode(biz.phone)))) { score += 1; reasons.push('area_code'); }
  if (page?.mapsLinks?.length) { score += 2; reasons.push('maps_link'); }
  // --- name (never enough alone to accept) ---
  const dt = distinctiveTokens(biz.name);
  const cov = dt.length ? dt.filter((t) => (cand.title || '').toLowerCase().includes(t) || registrable(h).includes(t)).length / dt.length : 0;
  if (cov >= 0.7) { score += 2; reasons.push('name'); }
  if (dt.some((t) => registrable(h).includes(t))) { score += 1; reasons.push('domain_token'); }
  if (cand.fromPhoneQuery && cand.position === 1) { score += 2; reasons.push('serp_phone_top'); }

  // --- conflicts (different location/identity) ---
  if (ld?.telephone && phone && last10(ld.telephone) !== phone && !dg.includes(phone)) { score -= 4; reasons.push('-conflict_phone'); }
  const ldCity = ld?.address?.addressLocality;
  if (ldCity && biz.city && ldCity.toLowerCase() !== String(biz.city).toLowerCase() && !blob.includes(String(biz.city).toLowerCase())) {
    score -= 3; reasons.push('-conflict_city');
  }
  return { score, ownSite: true, strong, presence: false, reasons };
}

// Discover and classify. searchFn(query)->[{url,title,snippet,position}]; fetchPage defaults to safeFetch.
// cfg.onSearchError(query, err) is called per failed query (default: console.warn) so a Serper
// outage doesn't degrade silently into UNCERTAIN noise that looks like organic uncertainty.
export async function discoverWebsite(biz, { searchFn = null, fetchPage = safeFetch, cfg = {} } = {}) {
  const acceptScore = cfg.acceptScore ?? 6;
  const uncertainScore = cfg.uncertainScore ?? 3;
  const onSearchError = cfg.onSearchError || ((q, err) => console.warn(`[discovery] search failed for ${q}: ${err.message || err}`));
  let searchFailed = false;          // if true, we cannot claim NO_WEBSITE confidently
  const seen = new Set();
  const candidates = [];
  const add = (c) => { const h = host(c.url); if (h && !seen.has(h)) { seen.add(h); candidates.push({ ...c, host: h }); } };

  if (biz.websiteUri) add({ url: biz.websiteUri, title: biz.name, snippet: '', source: 'places' });

  if (searchFn) {
    const region = [biz.city, biz.state].filter(Boolean).join(' ');
    const queries = [
      { q: `"${biz.name}" ${region}`.trim() },
      ...(biz.phone ? [{ q: `"${biz.name}" "${biz.phone}"`, phone: true }] : []),
    ];
    for (const { q, phone } of queries) {
      let results = [];
      try { results = await searchFn(q); }
      catch (err) { onSearchError(q, err); results = []; searchFailed = true; }
      for (const r of results) add({ url: r.url, title: r.title, snippet: r.snippet, position: r.position, fromPhoneQuery: !!phone, source: 'search' });
    }
  }

  let best = null, uncertain = searchFailed, presence = false;
  for (const cand of candidates) {
    if (isAggregator(cand.host)) { presence = true; continue; }
    let page = null;
    const fr = await fetchPage(cand.url, { timeoutMs: cfg.timeoutMs ?? 8000 });
    if (fr?.ok && /html/i.test(fr.contentType || '')) page = parsePage(fr.body);
    else if (fr && (fr.status === 'TIMEOUT' || [403, 429, 503].includes(fr.status))) uncertain = true; // a server is there, just blocked
    const sc = scoreCandidate(biz, cand, page);
    if (sc.presence) { presence = true; continue; }
    if (sc.strong && sc.score >= acceptScore) { if (!best || sc.score > best.score) best = { url: cand.url, score: sc.score, reasons: sc.reasons }; }
    else if (sc.score >= uncertainScore) uncertain = true;
  }

  if (best) return { status: 'HAS_WEBSITE', website: best.url, score: best.score, reasons: best.reasons };
  if (uncertain || presence) return { status: 'UNCERTAIN', website: null };
  return { status: 'NO_WEBSITE', website: null };
}
