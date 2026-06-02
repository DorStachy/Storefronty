import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverWebsite, scoreCandidate, isAggregator } from '../src/discovery/index.js';

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

test('isAggregator flags social/directory hosts', () => {
  assert.ok(isAggregator('facebook.com'));
  assert.ok(isAggregator('m.facebook.com'));
  assert.ok(isAggregator('yelp.com'));
  assert.ok(!isAggregator('cielitolindocafe.com'));
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

test('Aggregator-only result → UNCERTAIN (online presence, not their own site)', async () => {
  const searchFn = async () => [{ url: 'https://facebook.com/cielitolindo', title: 'Cielito Lindo', position: 1 }];
  const r = await discoverWebsite(biz, { searchFn, fetchPage });
  assert.equal(r.status, 'UNCERTAIN');
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
