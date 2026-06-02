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
  'mapquest.com', 'google.com', 'maps.google.com', 'maps.apple.com', 'duckduckgo.com', 'bing.com', 'waze.com',
  'doordash.com', 'ubereats.com', 'grubhub.com', 'nextdoor.com', 'wanderboat.ai',
  'foursquare.com', 'bbb.org', 'yellowpages.com', 'twitter.com', 'x.com', 'tiktok.com', 'linkedin.com', 'youtube.com'];
export const isAggregator = (h) => DENY.some((d) => h === d || h.endsWith('.' + d) || registrable(h) === d);

// Parse a raw HTML string into the signals scoreCandidate consumes. Exported for unit-testing.
// placeIds/cids are Google-listing identifiers found anywhere in the raw markup — used to match a
// page's "view us on Google" link back to OUR exact Place (identity-anchored, not name-based).
export function parsePage(html) {
  const s = String(html || '');
  const tels = [...s.matchAll(/tel:([+\d().\-\s]{7,})/gi)].map((m) => last10(m[1])).filter(Boolean);
  const jsonld = [...s.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean)
    .flatMap((x) => (Array.isArray(x) ? x : [x]));
  const mapsLinks = [...s.matchAll(/https?:\/\/(?:www\.)?google\.[^"'\s]*\/maps[^"'\s]*/gi)].map((m) => m[0]);
  const placeIds = [...s.matchAll(/(ChIJ[A-Za-z0-9_-]{10,})/g)].map((m) => m[1]);
  const cids = [...s.matchAll(/[?&]cid=(\d{6,})/gi)].map((m) => m[1]);
  // Cheap SPA signal: og/meta `content` attributes + <title> are often server-rendered even when
  // the body is a JS shell, so fold them into the searchable text before any render fallback.
  const metas = [...s.matchAll(/<meta[^>]+content=["']([^"']*)["'][^>]*>/gi)].map((m) => m[1]);
  const titleTag = (s.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const visible = s.replace(/<[^>]+>/g, ' ');
  return { text: `${visible} ${metas.join(' ')} ${titleTag}`.toLowerCase(), tels, jsonld, mapsLinks, placeIds, cids };
}

// The shop's own Google-listing identifiers (from Places): the place_id and the decimal cid that
// its googleMapsUri encodes. A candidate page that references either is linking back to US.
function ownGoogleIds(biz) {
  const placeId = biz.placeId || null;
  const cid = (String(biz.mapsUri || '').match(/[?&]cid=(\d+)/i) || [])[1] || null;
  return { placeId, cid };
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
  // --- owner-attested Google back-reference (strong) --- the page links to OUR exact listing.
  // Identity-anchored: a same-name shop elsewhere links to a DIFFERENT place_id/cid, so this can
  // never match them. This is why we thread placeId + the shop's googleMapsUri (cid) into discovery.
  const { placeId, cid } = ownGoogleIds(biz);
  const backref = (placeId && (page?.placeIds || []).includes(placeId))
    || (cid && (page?.cids || []).includes(cid));
  if (backref) { score += 4; strong = true; reasons.push('maps_backref'); }
  // --- location corroboration ---
  if (biz.zip && blob.includes(String(biz.zip).toLowerCase())) { score += 2; reasons.push('zip'); }
  if (biz.street && blob.includes(String(biz.street).toLowerCase())) { score += 3; reasons.push('street'); }
  if (biz.city && blob.includes(String(biz.city).toLowerCase())) { score += 1; reasons.push('city'); }
  if (areaCode(biz.phone) && page?.tels?.some((t) => t.startsWith(areaCode(biz.phone)))) { score += 1; reasons.push('area_code'); }
  // A bare maps link (not matched to our listing) is weak presence, never identity — and never
  // strong on its own (the directory guard below still requires name evidence).
  if (!backref && page?.mapsLinks?.length) { score += 1; reasons.push('maps_link'); }
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
  // State conflict — only when both are 2-letter codes (schema.org US convention); full state
  // names ("Texas") are skipped to avoid false penalties on abbreviation/spelling mismatches.
  const ldRegion = String(ld?.address?.addressRegion || '').trim().toLowerCase();
  const bizState = String(biz.state || '').trim().toLowerCase();
  if (/^[a-z]{2}$/.test(ldRegion) && /^[a-z]{2}$/.test(bizState) && ldRegion !== bizState && !blob.includes(bizState)) {
    score -= 3; reasons.push('-conflict_state');
  }

  // Directory guard (hardened by a live finding). Rich directories — alotoday.vn, postcard.inc,
  // wanderboat.ai — republish the shop's FULL Google profile: phone, street/ZIP, even the place_id
  // back-link, with the shop NAME in the page title. So phone, address, JSON-LD, back-reference,
  // AND title-name are ALL directory-spoofable. The one thing a directory cannot fake is putting
  // THIS shop's distinctive name in its OWN registrable domain. So a strong/own-site accept
  // REQUIRES domain_token; everything else is corroboration of WHICH shop, not WHOSE site.
  if (strong && !reasons.includes('domain_token')) {
    strong = false; reasons.push('-not_own_domain');
  }
  return { score, ownSite: true, strong, presence: false, reasons };
}

// Does the registrable domain carry the shop's distinctive name? The cheap "this could be THEIR
// own site" test — used to decide whether a candidate is worth an (expensive) JS render.
const domainHasName = (name, h) => distinctiveTokens(name).some((t) => registrable(h).includes(t));

// Discover and classify. searchFn(query)->[{url,title,snippet,position}]; fetchPage defaults to safeFetch.
// Optional `render(url,{timeoutMs})->{ok,html}` is a pluggable JS-renderer (headless browser / render
// API). It is used ONLY as a budgeted fallback: when a candidate is plausibly the shop's own domain
// (name token in the host) but its STATIC HTML lacks a strong anchor, we render once and re-score the
// DOM with the SAME identity rules. cfg.onSearchError(query,err) surfaces search outages.
export async function discoverWebsite(biz, { searchFn = null, fetchPage = safeFetch, render = null, cfg = {} } = {}) {
  const acceptScore = cfg.acceptScore ?? 6;
  const uncertainScore = cfg.uncertainScore ?? 3;
  const onSearchError = cfg.onSearchError || ((q, err) => console.warn(`[discovery] search failed for ${q}: ${err.message || err}`));
  const onRenderError = cfg.onRenderError || ((u, err) => console.warn(`[discovery] render failed for ${u}: ${err.message || err}`));
  let renderBudget = render ? (cfg.renderBudget ?? 1) : 0;   // at most N JS renders per discovery call
  let searchFailed = false;          // if true, we cannot claim NO_WEBSITE confidently
  const seen = new Set();
  const candidates = [];
  const add = (c) => { const h = host(c.url); if (h && !seen.has(h)) { seen.add(h); candidates.push({ ...c, host: h }); } };

  if (biz.websiteUri) add({ url: biz.websiteUri, title: biz.name, snippet: '', source: 'places' });

  let knowledge = null;              // Google Knowledge-Panel facts, when searchFn supplies them
  if (searchFn) {
    const region = [biz.city, biz.state].filter(Boolean).join(' ');
    const queries = [
      { q: `"${biz.name}" ${region}`.trim() },
      ...(biz.phone ? [{ q: `"${biz.name}" "${biz.phone}"`, phone: true }] : []),
    ];
    for (const { q, phone } of queries) {
      let raw;
      try { raw = await searchFn(q); }
      catch (err) { onSearchError(q, err); raw = null; searchFailed = true; }
      // searchFn may return a plain array (organic) or { organic, knowledge } (rich).
      const results = Array.isArray(raw) ? raw : (raw?.organic || []);
      if (!knowledge && !Array.isArray(raw) && raw?.knowledge) knowledge = raw.knowledge;
      for (const r of results) add({ url: r.url, title: r.title, snippet: r.snippet, position: r.position, fromPhoneQuery: !!phone, source: 'search' });
    }
  }

  // Identity-anchored Knowledge-Panel facts: trusted ONLY when the panel's place_id equals THIS
  // shop's place_id (Google's own entity id — unspoofable disambiguation). Backfill a missing phone
  // (Places text-search often omits it) so candidate scoring gets the strongest anchor.
  const kgUs = !!(knowledge && knowledge.placeId && biz.placeId && String(knowledge.placeId) === String(biz.placeId));
  if (kgUs && !biz.phone && knowledge.phone) biz = { ...biz, phone: knowledge.phone };

  let best = null, uncertain = searchFailed, presence = false, ownDomainUncertain = false;
  for (const cand of candidates) {
    if (isAggregator(cand.host)) { presence = true; continue; }
    const ownish = domainHasName(biz.name, cand.host);   // plausibly THEIR domain (not a directory)
    let page = null;
    const fr = await fetchPage(cand.url, { timeoutMs: cfg.timeoutMs ?? 8000 });
    if (fr?.ok && /html/i.test(fr.contentType || '')) page = parsePage(fr.body);
    else if (fr && (fr.status === 'TIMEOUT' || [403, 429, 503].includes(fr.status))) { uncertain = true; if (ownish) ownDomainUncertain = true; } // a server is there, just blocked
    let sc = scoreCandidate(biz, cand, page);

    // JS-render fallback. Only when: a renderer is available + budget left, this is plausibly the
    // shop's OWN domain, the static page didn't already strong-confirm, and it lacked the anchors a
    // render could add (phone / back-reference). Re-score the rendered DOM with the SAME rules.
    const lacksStrongAnchor = !sc.reasons.includes('phone') && !sc.reasons.includes('maps_backref');
    if (renderBudget > 0 && !(sc.strong && sc.score >= acceptScore) && lacksStrongAnchor && domainHasName(biz.name, cand.host)) {
      renderBudget--;
      try {
        const rr = await render(cand.url, { timeoutMs: cfg.renderTimeoutMs ?? 12000 });
        if (rr?.ok && rr.html) {
          const rsc = scoreCandidate(biz, cand, parsePage(rr.html));
          if (rsc.score > sc.score) sc = rsc;
        }
      } catch (err) { onRenderError(cand.url, err); }
    }

    if (sc.presence) { presence = true; continue; }
    if (sc.strong && sc.score >= acceptScore) { if (!best || sc.score > best.score) best = { url: cand.url, score: sc.score, reasons: sc.reasons }; }
    else if (sc.score >= uncertainScore) { uncertain = true; if (ownish) ownDomainUncertain = true; }
  }

  // Google's own answer for OUR exact entity (place_id matched) is authoritative for the
  // has-a-website question — and closes the JS-SPA gap with no rendering:
  //  • website present (non-aggregator) → HAS_WEBSITE, even if the page is an empty SPA shell.
  //  • no website → NO_WEBSITE. Directory/aggregator presence does NOT suppress this (a no-website
  //    shop is exactly the kind that's only listed in directories). But a plausibly-OWN domain we
  //    couldn't read (a bot-blocked SPA) still keeps us UNCERTAIN, since Google can omit a real site.
  const kgSite = kgUs && knowledge.website && !isAggregator(host(knowledge.website)) ? knowledge.website : null;
  const kgNoSite = !!(kgUs && !knowledge.website);

  if (best) return { status: 'HAS_WEBSITE', website: best.url, score: best.score, reasons: best.reasons };
  if (kgSite) return { status: 'HAS_WEBSITE', website: kgSite, reasons: ['knowledge_panel', 'place_id_match'] };
  if (kgNoSite && !ownDomainUncertain && !searchFailed) return { status: 'NO_WEBSITE', website: null, reasons: ['knowledge_panel_no_site', 'place_id_match'] };
  if (uncertain || presence) return { status: 'UNCERTAIN', website: null };
  return { status: 'NO_WEBSITE', website: null };
}
