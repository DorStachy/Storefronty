import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractEmails, scoreEmail, discoverEmail } from '../src/email/index.js';

const id = { name: 'Cielito Lindo Cafe', city: 'Austin', state: 'TX', phone: '(512) 555-0199' };

test('extractEmails pulls addresses from text + mailto links, lowercased + deduped', () => {
  const got = extractEmails('Email us: Hello@Shop.com or <a href="mailto:hello@shop.com">here</a>; also x@y.io');
  assert.deepEqual(got.sort(), ['hello@shop.com', 'x@y.io']);
});

test('scoreEmail: an own-domain email (name in the domain) is high confidence', () => {
  const sc = scoreEmail(id, 'hello@cielitolindocafe.com', 'Contact hello@cielitolindocafe.com');
  assert.ok(sc.accept);
  assert.equal(sc.confidence, 'high');
  assert.ok(sc.reasons.includes('domain_name'));
});

test('scoreEmail: a gmail address co-located with the shop PHONE is high confidence', () => {
  const sc = scoreEmail(id, 'cielitolindoatx@gmail.com',
    'Cielito Lindo Cafe — call (512) 555-0199 — cielitolindoatx@gmail.com');
  assert.ok(sc.accept);
  assert.equal(sc.confidence, 'high');
  assert.ok(sc.reasons.includes('phone'));
});

test('scoreEmail: name + city (no phone, generic domain) is medium and acceptable', () => {
  const sc = scoreEmail(id, 'cielitolindo@gmail.com', 'Cielito Lindo Cafe in Austin, TX — cielitolindo@gmail.com');
  assert.equal(sc.confidence, 'medium');
  assert.ok(sc.accept);
});

test('scoreEmail: a DIFFERENT city (ours absent) → conflict, rejected', () => {
  const sc = scoreEmail(id, 'info@gmail.com', 'Cielito Lindo Cafe — San Diego, CA — info@gmail.com');
  assert.ok(!sc.accept);
  assert.ok(sc.reasons.includes('-conflict_city'));
});

test('scoreEmail: junk/platform/no-reply addresses are rejected outright', () => {
  for (const e of ['no-reply@cielitolindocafe.com', 'support@sentry.io', 'you@example.com', 'logo@thing.png']) {
    assert.ok(!scoreEmail(id, e, 'Cielito Lindo Cafe (512) 555-0199').accept, `${e} should be rejected`);
  }
});

test('scoreEmail: name-only with no location and a generic domain is NOT enough', () => {
  const sc = scoreEmail(id, 'info@somerandomhost.com', 'Cielito Lindo Cafe great coffee info@somerandomhost.com');
  assert.ok(!sc.accept);
});

test('discoverEmail: finds + verifies an email from a fetched contact page (mailto + phone)', async () => {
  const PAGE = 'https://listing.example/cielito';
  const searchFn = async () => ({ organic: [{ url: PAGE, title: 'Cielito Lindo Cafe', snippet: 'contact info', position: 1 }] });
  const fetchPage = async (u) => (u === PAGE
    ? { ok: true, status: 200, contentType: 'text/html',
        body: '<html><body>Cielito Lindo Cafe · (512) 555-0199 · <a href="mailto:cielitolindoatx@gmail.com">email</a></body></html>' }
    : { ok: false, status: 'FAILED' });
  const r = await discoverEmail(id, { searchFn, fetchPage });
  assert.equal(r.email, 'cielitolindoatx@gmail.com');
  assert.equal(r.confidence, 'high');
});

test('discoverEmail: returns null when nothing verifiable is found', async () => {
  const searchFn = async () => ({ organic: [{ url: 'https://x.example', title: 'unrelated', snippet: 'nothing', position: 1 }] });
  const r = await discoverEmail(id, { searchFn, fetchPage: async () => ({ ok: true, status: 200, contentType: 'text/html', body: 'no emails here' }) });
  assert.equal(r.email, null);
});
