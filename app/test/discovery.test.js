import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverWebsite, scoreCandidate, isAggregator, parsePage } from '../src/discovery/index.js';
const parseFixture = (html) => parsePage(html);

const biz = { name: 'Cielito Lindo Cafe', city: 'Austin', state: 'TX', zip: '78702', phone: '(512) 555-0199' };

const LOCAL = 'https://cielitolindocafe.com';
const FOREIGN = 'https://cielitolindo-madrid.com';
const pages = {
  [LOCAL]: { ok: true, status: 200, contentType: 'text/html',
    body: '<html><body>Cielito Lindo Cafe — 88 E Cesar Chavez St, Austin TX 78702 <a href="tel:+15125550199">Call us</a></body></html>' },
  [FOREIGN]: { ok: true, status: 200, contentType: 'text/html',
    body: '<html><head><script type="application/ld+json">{"@type":"Restaurant","telephone":"+34915550000","address":{"addressLocality":"Madrid"}}</script></head><body>Cielito Lindo Cafe Madrid</body></html>' },
};
const fetchPage = async (url) => pages[url] || { ok: false, status: 'FAILED' };

test('scoreCandidate: the shop\'s own phone on the page is a strong, accepting signal', () => {
  const page = { text: 'call us tel +1 512 555 0199 austin', tels: ['5125550199'], jsonld: [], mapsLinks: [] };
  const sc = scoreCandidate(biz, { host: 'cielitolindocafe.com', title: 'Cielito Lindo Cafe' }, page);
  assert.ok(sc.strong);
  assert.ok(sc.score >= 6);
});

test('isAggregator flags social/directory hosts (incl. mapping aggregators)', () => {
  assert.ok(isAggregator('facebook.com'));
  assert.ok(isAggregator('m.facebook.com'));
  assert.ok(isAggregator('yelp.com'));
  assert.ok(isAggregator('maps.apple.com'));   // Apple Maps place pages aren't a shop's own site
  assert.ok(isAggregator('maps.google.com'));
  assert.ok(!isAggregator('cielitolindocafe.com'));
  assert.ok(!isAggregator('apple.com'));        // apple.com itself is not denied (a hypothetical Apple Store listing)
});

test('SAME NAME, DIFFERENT LOCATION: picks the local site, never the foreign same-name one', async () => {
  const searchFn = async () => [
    { url: LOCAL, title: 'Cielito Lindo Cafe Austin', position: 1 },
    { url: FOREIGN, title: 'Cielito Lindo Cafe Madrid', position: 2 },
  ];
  const r = await discoverWebsite(biz, { searchFn, fetchPage });
  assert.equal(r.status, 'HAS_WEBSITE');
  assert.match(r.website, /cielitolindocafe\.com/);          // the Austin one, anchored by phone
});

test('Only a foreign same-name site exists → we are NOT fooled (NO_WEBSITE, lead kept)', async () => {
  const searchFn = async () => [{ url: FOREIGN, title: 'Cielito Lindo Cafe Madrid', position: 1 }];
  const r = await discoverWebsite(biz, { searchFn, fetchPage });
  assert.notEqual(r.status, 'HAS_WEBSITE');                  // the Madrid site is not ours
  assert.equal(r.status, 'NO_WEBSITE');
});

test('No candidates at all → NO_WEBSITE', async () => {
  const r = await discoverWebsite(biz, { searchFn: async () => [], fetchPage });
  assert.equal(r.status, 'NO_WEBSITE');
});

test('Socials-only result → NO_WEBSITE (no own site) and captures the social profile', async () => {
  // A shop active on Facebook/Instagram but with NO real website is exactly our BEST lead — they
  // clearly care about their online presence and have nowhere to send customers. We must KEEP it
  // (not drop it as uncertain) and flag the social profile we found.
  const searchFn = async () => [{ url: 'https://facebook.com/cielitolindo', title: 'Cielito Lindo', position: 1 }];
  const r = await discoverWebsite(biz, { searchFn, fetchPage });
  assert.equal(r.status, 'NO_WEBSITE');
  assert.ok(Array.isArray(r.socials) && r.socials.some((u) => /facebook\.com\/cielitolindo/.test(u)),
    'the name-matched social profile is captured');
});

test('Google "website" that is really their Instagram → NO_WEBSITE + socials (not counted as a site)', async () => {
  // The exact case: Google shows a clickable "website" link that opens their Instagram, not a real
  // site. mapPlace already sets hasWebsite=false; discovery must confirm NO_WEBSITE and flag the IG.
  const r = await discoverWebsite({ ...biz, websiteUri: 'https://instagram.com/cielitolindocafe' },
    { searchFn: async () => [], fetchPage });
  assert.equal(r.status, 'NO_WEBSITE');
  assert.ok(r.socials.some((u) => /instagram\.com\/cielitolindocafe/.test(u)));
});

test('a real site PLUS socials → HAS_WEBSITE, and the socials are still reported', async () => {
  const searchFn = async () => [
    { url: LOCAL, title: 'Cielito Lindo Cafe Austin', position: 1 },
    { url: 'https://instagram.com/cielitolindocafe', title: 'Cielito Lindo Cafe', position: 2 },
  ];
  const r = await discoverWebsite(biz, { searchFn, fetchPage });
  assert.equal(r.status, 'HAS_WEBSITE');
  assert.ok(r.socials.some((u) => /instagram\.com\/cielitolindocafe/.test(u)));
});

test('a social handle that does NOT carry the shop name is not mis-attributed (still NO_WEBSITE)', async () => {
  // facebook.com/totallyunrelated has no name match → not flagged as theirs, but it is still
  // aggregator presence with no own site found → NO_WEBSITE (we keep the lead, with empty socials).
  const searchFn = async () => [{ url: 'https://facebook.com/totallyunrelatedpage', title: 'Some Page', position: 1 }];
  const r = await discoverWebsite(biz, { searchFn, fetchPage });
  assert.equal(r.status, 'NO_WEBSITE');
  assert.deepEqual(r.socials, []);
});

test('A bot-blocked (403) candidate → UNCERTAIN, never auto-dropped', async () => {
  const searchFn = async () => [{ url: 'https://blocked.example', title: 'Cielito Lindo Cafe', position: 1 }];
  const r = await discoverWebsite(biz, { searchFn, fetchPage: async () => ({ ok: false, status: 403 }) });
  assert.equal(r.status, 'UNCERTAIN');
});

test('Places websiteUri is verified, not blindly trusted (phone match accepts it)', async () => {
  const r = await discoverWebsite({ ...biz, websiteUri: LOCAL }, { searchFn: null, fetchPage });
  assert.equal(r.status, 'HAS_WEBSITE');
  assert.match(r.website, /cielitolindocafe\.com/);
});

test('directory-listing guard: shop phone + city on an unrelated domain is NOT accepted as their site', async () => {
  // A wanderboat/postcard-style directory: the shop's phone and city are on the page (because
  // they're listing every cafe in town), but the domain has nothing to do with the shop. Without
  // this guard we used to ACCEPT it as HAS_WEBSITE and drop the lead. With the guard: UNCERTAIN.
  const DIRECTORY = 'https://postcard.inc/places/cielito-lindo-cafe-austin-xyz';
  const dirPages = {
    [DIRECTORY]: { ok: true, status: 200, contentType: 'text/html',
      body: '<html><body>Austin TX restaurants and cafes <a href="tel:+15125550199">(512) 555-0199</a></body></html>' },
  };
  const dirFetch = async (url) => dirPages[url] || { ok: false, status: 'FAILED' };
  const searchFn = async () => [{ url: DIRECTORY, title: 'Restaurants in Austin · postcard.inc', position: 1 }];
  const r = await discoverWebsite(biz, { searchFn, fetchPage: dirFetch });
  assert.notEqual(r.status, 'HAS_WEBSITE');                  // must NOT be accepted as their site
  assert.equal(r.status, 'UNCERTAIN');                       // we are not sure — needs a human
});

test('search-API failures surface via onSearchError AND degrade to UNCERTAIN (never NO_WEBSITE)', async () => {
  const seen = [];
  const onSearchError = (query, err) => seen.push({ query, msg: String(err.message || err) });
  const boom = async () => { throw new Error('Serper 503: backend down'); };
  const r = await discoverWebsite(biz, { searchFn: boom, fetchPage, cfg: { onSearchError } });
  assert.ok(seen.length >= 1, 'onSearchError was called');
  assert.match(seen[0].msg, /Serper 503/);
  assert.ok(seen.every((s) => s.query.includes(biz.name)));
  // If we couldn't verify, we must NOT confidently claim NO_WEBSITE — that would put a shop
  // with a real site into outreach. The researcher will then drop UNCERTAIN leads, not email them.
  assert.equal(r.status, 'UNCERTAIN');
});

// ─── Identity / location disambiguation: link-back to the SAME Google listing ───────────────
// A page that links back to OUR exact Google listing (place_id or cid) is owner-attested identity
// — the single most reliable signal short of the phone. It must NOT be matchable by a same-name
// shop elsewhere (their site links to THEIR listing, a different place_id/cid).
const PLACE_ID = 'ChIJrTLr-GyuEmsRBfy61i59si0';
const noPhone = { name: 'Cielito Lindo Cafe', city: 'Austin', state: 'TX', zip: '78702', phone: null };

test('maps back-reference via place_id is a strong accepting signal even with no phone', () => {
  const page = parseFixture(`<html><body><h1>Cielito Lindo Cafe</h1>
    <a href="https://www.google.com/maps/place/?q=place_id:${PLACE_ID}">Find us on Google</a></body></html>`);
  const sc = scoreCandidate({ ...noPhone, placeId: PLACE_ID },
    { host: 'cielitolindocafe.com', title: 'Cielito Lindo Cafe' }, page);
  assert.ok(sc.reasons.includes('maps_backref'));
  assert.ok(sc.strong);
  assert.ok(sc.score >= 6);
});

test('maps back-reference via decimal cid (from the shop\'s googleMapsUri) accepts', () => {
  const cid = '1234567890123456789';
  const page = parseFixture(`<html><body><h1>Cielito Lindo Cafe</h1>
    <a href="https://maps.google.com/?cid=${cid}">View on Google Maps</a></body></html>`);
  const sc = scoreCandidate({ ...noPhone, placeId: null, mapsUri: `https://maps.google.com/?cid=${cid}` },
    { host: 'cielitolindocafe.com', title: 'Cielito Lindo Cafe' }, page);
  assert.ok(sc.reasons.includes('maps_backref'));
  assert.ok(sc.strong);
  assert.ok(sc.score >= 6);
});

test('a maps link to a DIFFERENT listing is NOT our back-reference (no false accept)', () => {
  const page = parseFixture(`<html><body><h1>Cielito Lindo Cafe</h1>
    <a href="https://www.google.com/maps/place/?q=place_id:ChIJ_SOME_OTHER_PLACE_zzzzzzz">Map</a></body></html>`);
  const sc = scoreCandidate({ ...noPhone, placeId: PLACE_ID },
    { host: 'cielitolindocafe.com', title: 'Cielito Lindo Cafe' }, page);
  assert.ok(!sc.reasons.includes('maps_backref'), 'a different listing must not count as our back-reference');
});

test('back-reference defeats a same-name shop: only the page linking OUR listing is accepted', async () => {
  const OURS = 'https://cielitolindo-austin.com';
  const THEIRS = 'https://cielitolindo-elsewhere.com';
  const idPages = {
    [OURS]: { ok: true, status: 200, contentType: 'text/html',
      body: `<html><body>Cielito Lindo Cafe <a href="https://maps.google.com/?cid=999000111222">Google</a></body></html>` },
    [THEIRS]: { ok: true, status: 200, contentType: 'text/html',
      body: `<html><body>Cielito Lindo Cafe <a href="https://maps.google.com/?cid=555555555555">Google</a></body></html>` },
  };
  const idFetch = async (url) => idPages[url] || { ok: false, status: 'FAILED' };
  const searchFn = async () => [
    { url: THEIRS, title: 'Cielito Lindo Cafe', position: 1 },
    { url: OURS, title: 'Cielito Lindo Cafe', position: 2 },
  ];
  const r = await discoverWebsite(
    { ...noPhone, mapsUri: 'https://maps.google.com/?cid=999000111222' }, { searchFn, fetchPage: idFetch });
  assert.equal(r.status, 'HAS_WEBSITE');
  assert.match(r.website, /cielitolindo-austin\.com/);   // the one linking OUR cid, not the same-name other
});

test('a rich directory that republishes our phone + Google back-link is NOT our site (generic domain)', () => {
  // alotoday.vn-style (found in a LIVE run on Cosmic Saltillo): scrapes the shop's full Google
  // profile — phone, full address, even the place_id back-link — and puts the shop NAME in the
  // page title. Every location signal is present, yet it is NOT the shop's site. The one thing a
  // directory can't fake: the shop's distinctive name in ITS OWN domain. So a generic domain ⇒
  // never a strong/own-site accept, no matter how much scraped identity it carries.
  const page = parseFixture(`<html><head>
    <script type="application/ld+json">{"@type":"Restaurant","name":"Cosmic Saltillo","telephone":"+15127637216","address":{"addressLocality":"Austin","addressRegion":"TX","postalCode":"78702","streetAddress":"1300 E 4th St"}}</script>
    </head><body>Cosmic Saltillo — 1300 E 4th St, Austin TX 78702 <a href="tel:+15127637216">call</a>
    <a href="https://www.google.com/maps/place/?q=place_id:ChIJcosmicsaltillo0000000">Google</a></body></html>`);
  const bizCS = { name: 'Cosmic Saltillo', city: 'Austin', state: 'TX', zip: '78702', street: '1300 E 4th St',
    phone: '(512) 763-7216', placeId: 'ChIJcosmicsaltillo0000000' };
  const sc = scoreCandidate(bizCS, { host: 'alotoday.vn', title: 'Cosmic Saltillo - Austin | alotoday' }, page);
  assert.ok(!sc.strong, 'a generic-domain directory must not be a strong/own-site accept');
  assert.ok(sc.reasons.includes('-not_own_domain'));
});

test('conflicting state in JSON-LD is penalized (a CA listing is not our TX shop)', () => {
  const page = parseFixture(`<html><head><script type="application/ld+json">
    {"@type":"Restaurant","name":"Sunrise Diner","address":{"addressRegion":"CA","addressLocality":"San Diego"}}
    </script></head><body>Sunrise Diner</body></html>`);
  const sc = scoreCandidate(
    { name: 'Sunrise Diner', city: 'Austin', state: 'TX', phone: null },
    { host: 'sunrisediner.com', title: 'Sunrise Diner' }, page);
  assert.ok(sc.reasons.includes('-conflict_state'));
  assert.ok(!sc.strong);
  assert.ok(sc.score < 6);
});

// ─── Cheap SPA signals + pluggable JS-renderer fallback ─────────────────────────────────────
test('parsePage surfaces og/meta + <title> content into the searchable text (cheap SPA signal)', () => {
  const p = parsePage(`<html><head><title>Fade Theory</title>
    <meta property="og:description" content="Barbershop at 120 E 6th St, Austin TX 78702"></head>
    <body><div id="app"></div></body></html>`);
  assert.match(p.text, /fade theory/);
  assert.match(p.text, /78702/);                      // meta content reached the blob despite an empty body
});

const SPA = 'https://terriblelove.com';               // own-domain (name token), but a JS SPA
const bizTL = { name: 'Terrible Love', city: 'Austin', state: 'TX', zip: '78702', street: '1300 E 4th St', phone: '(512) 555-0148' };
const emptyShell = { ok: true, status: 200, contentType: 'text/html', body: '<html><body><div id="app"></div></body></html>' };
const hydrated = '<html><body>Terrible Love — 1300 E 4th St, Austin TX 78702 <a href="tel:+15125550148">call</a></body></html>';

test('renderer fallback: an empty-shell SPA on the shop\'s own domain → UNCERTAIN without render', async () => {
  const fetchPage = async (u) => (u === SPA ? emptyShell : { ok: false, status: 'FAILED' });
  const searchFn = async () => [{ url: SPA, title: 'Terrible Love', position: 1 }];
  const r = await discoverWebsite(bizTL, { searchFn, fetchPage });
  assert.equal(r.status, 'UNCERTAIN');                // static HTML carries no anchors
});

test('renderer fallback: the SAME SPA is confirmed HAS_WEBSITE once a renderer yields the DOM', async () => {
  const fetchPage = async (u) => (u === SPA ? emptyShell : { ok: false, status: 'FAILED' });
  const render = async (u) => (u === SPA ? { ok: true, status: 200, html: hydrated } : { ok: false });
  const searchFn = async () => [{ url: SPA, title: 'Terrible Love', position: 1 }];
  const r = await discoverWebsite(bizTL, { searchFn, fetchPage, render });
  assert.equal(r.status, 'HAS_WEBSITE');              // re-scored rendered DOM, SAME identity rules
  assert.match(r.website, /terriblelove\.com/);
});

test('renderer is NOT spent on a domain that is not plausibly the shop\'s own (budget guard)', async () => {
  let calls = 0;
  const render = async () => { calls++; return { ok: true, html: hydrated }; };
  const DIR = 'https://randomdir.io/listing/x';
  const fetchPage = async () => ({ ok: true, status: 200, contentType: 'text/html', body: '<html><body>directory</body></html>' });
  const searchFn = async () => [{ url: DIR, title: 'A directory page', position: 1 }];
  await discoverWebsite(bizTL, { searchFn, fetchPage, render });
  assert.equal(calls, 0, 'no name token in the domain → not worth a render');
});

test('renderer is NOT spent when the static page already strongly confirms (budget guard)', async () => {
  let calls = 0;
  const render = async () => { calls++; return { ok: true, html: hydrated }; };
  const confirmed = { ok: true, status: 200, contentType: 'text/html', body: hydrated };
  const fetchPage = async (u) => (u === SPA ? confirmed : { ok: false });
  const searchFn = async () => [{ url: SPA, title: 'Terrible Love', position: 1 }];
  const r = await discoverWebsite(bizTL, { searchFn, fetchPage, render });
  assert.equal(r.status, 'HAS_WEBSITE');
  assert.equal(calls, 0, 'static already strong → no render needed');
});

test('a throwing renderer is caught and falls back to the static verdict', async () => {
  const fetchPage = async (u) => (u === SPA ? emptyShell : { ok: false });
  const render = async () => { throw new Error('chromium crashed'); };
  const searchFn = async () => [{ url: SPA, title: 'Terrible Love', position: 1 }];
  const r = await discoverWebsite(bizTL, { searchFn, fetchPage, render });
  assert.equal(r.status, 'UNCERTAIN');                // render failed → same as no-render
});

// ─── Google Knowledge Panel: identity-anchored by place_id (Google's own website answer) ─────
// searchFn may return { organic, knowledge } (rich) or a plain array (back-compat). The knowledge
// panel is trusted ONLY when its place_id equals THIS shop's place_id — Google's own entity id,
// the strongest disambiguation there is. This closes the JS-SPA gap with no browser.
const OURS_PID = 'ChIJP8p2kJC1RIYR2qrGoXZtZCk';
const kgBiz = { name: 'Terrible Love', city: 'Austin', state: 'TX', placeId: OURS_PID };
const failFetch = async () => ({ ok: false, status: 'FAILED' });

test('KP (place_id match) with a website → HAS_WEBSITE even if the page is an empty SPA', async () => {
  const SPA2 = 'https://terriblelovecoffee.com';
  const fetchPage = async () => ({ ok: true, status: 200, contentType: 'text/html', body: '<html><body><div id="app"></div></body></html>' });
  const searchFn = async () => ({
    organic: [{ url: SPA2, title: 'Terrible Love', position: 1 }],
    knowledge: { placeId: OURS_PID, website: 'http://terriblelovecoffee.com/', title: 'Terrible Love' },
  });
  const r = await discoverWebsite(kgBiz, { searchFn, fetchPage });
  assert.equal(r.status, 'HAS_WEBSITE');
  assert.match(r.website, /terriblelovecoffee\.com/);
  assert.ok(r.reasons.includes('place_id_match'));
});

test('KP website is trusted ONLY when its place_id matches our shop (different entity ⇒ not authoritative)', async () => {
  const searchFn = async () => ({ organic: [], knowledge: { placeId: 'ChIJ_DIFFERENT_ENTITY', website: 'https://some-samename.com' } });
  const r = await discoverWebsite(kgBiz, { searchFn, fetchPage: failFetch });
  assert.notEqual(r.status, 'HAS_WEBSITE');
});

test('KP (place_id match) reporting NO website + only aggregator presence → NO_WEBSITE (keep the lead)', async () => {
  const searchFn = async () => ({
    organic: [{ url: 'https://facebook.com/terriblelove', title: 'Terrible Love', position: 1 }],
    knowledge: { placeId: OURS_PID, website: null, phone: '(512) 555-0148' },
  });
  const r = await discoverWebsite(kgBiz, { searchFn, fetchPage: failFetch });
  assert.equal(r.status, 'NO_WEBSITE');               // Google: no site for OUR entity; FB doesn't override
});

test('KP "no website" does NOT override real uncertainty (a bot-blocked own-domain candidate)', async () => {
  const searchFn = async () => ({
    organic: [{ url: 'https://terriblelove.com', title: 'Terrible Love', position: 1 }],
    knowledge: { placeId: OURS_PID, website: null },
  });
  const r = await discoverWebsite(kgBiz, { searchFn, fetchPage: async () => ({ ok: false, status: 403 }) });
  assert.equal(r.status, 'UNCERTAIN');                // a real site we couldn't read — stay unsure
});

test('KP "no website" overrides DIRECTORY noise (not an own domain) → NO_WEBSITE (keep the lead)', async () => {
  // The đậm-coffee-bar case from a live run: Google KP (place_id matched) says no website, but a
  // directory that lists the shop's phone+address scores high enough to look "uncertain". A
  // directory is not a plausibly-own domain, so it must NOT suppress a genuine no-website lead.
  const DIR = 'https://citylistings.example/austin/terrible-love';
  const fetchPage = async (u) => (u === DIR
    ? { ok: true, status: 200, contentType: 'text/html',
        body: '<html><body>Terrible Love — 3908 Avenue B, Austin TX 78751 <a href="tel:+15125550148">call</a></body></html>' }
    : { ok: false, status: 'FAILED' });
  const searchFn = async () => ({
    organic: [{ url: DIR, title: 'Terrible Love | City Listings', position: 1 }],
    knowledge: { placeId: OURS_PID, website: null, phone: '(512) 555-0148' },
  });
  const biz = { name: 'Terrible Love', city: 'Austin', state: 'TX', zip: '78751', street: '3908 Avenue B', phone: '(512) 555-0148', placeId: OURS_PID };
  const r = await discoverWebsite(biz, { searchFn, fetchPage });
  assert.equal(r.status, 'NO_WEBSITE');
  assert.ok(r.reasons.includes('knowledge_panel_no_site'));
});

test('KP phone backfills a missing phone, letting an own-domain page confirm', async () => {
  const biz5 = { name: 'Sunrise Diner', city: 'Austin', state: 'TX', placeId: OURS_PID, phone: null };
  const SITE = 'https://sunrisediner.com';
  const searchFn = async () => ({
    organic: [{ url: SITE, title: 'Sunrise Diner', position: 1 }],
    knowledge: { placeId: OURS_PID, website: null, phone: '(512) 555-0148' },
  });
  const fetchPage = async (u) => (u === SITE
    ? { ok: true, status: 200, contentType: 'text/html', body: '<html><body>Sunrise Diner <a href="tel:+15125550148">call</a></body></html>' }
    : { ok: false, status: 'FAILED' });
  const r = await discoverWebsite(biz5, { searchFn, fetchPage });
  assert.equal(r.status, 'HAS_WEBSITE');              // backfilled phone matched the page
  assert.match(r.website, /sunrisediner\.com/);
});
