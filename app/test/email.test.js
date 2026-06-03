import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractEmails, scoreEmail, discoverEmail, verifyEmailDeliverable } from '../src/email/index.js';

// A fake MX resolver so email tests stay offline/hermetic (no real DNS).
const mxOk = async () => [{ exchange: 'mx.google.com', priority: 10 }];

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

test('scoreEmail: a free-mail address whose local part carries the shop name is high', () => {
  const sc = scoreEmail(id, 'cielitolindocafe@gmail.com', 'reach us at cielitolindocafe@gmail.com');
  assert.ok(sc.accept);
  assert.equal(sc.confidence, 'high');
  assert.ok(sc.reasons.includes('local_name'));
});

test('scoreEmail: a plain free-mail address with name + city (no phone) is medium and acceptable', () => {
  const sc = scoreEmail(id, 'hello@gmail.com', 'Cielito Lindo Cafe in Austin, TX — hello@gmail.com');
  assert.equal(sc.confidence, 'medium');
  assert.ok(sc.accept);
});

test('scoreEmail: a booking/platform email is rejected even next to the shop phone (the Fresha bug)', () => {
  // Live sweep accepted hello@fresha.com for "AB fadez" because the shop's phone was on the Fresha
  // booking page. Fresha's address is NOT the shop's — platform/aggregator domains are never theirs.
  for (const e of ['hello@fresha.com', 'info@booksy.com', 'team@vagaro.com', 'no@squareup.com']) {
    const sc = scoreEmail(id, e, 'AB fadez — call (512) 555-0199 — book now');
    assert.ok(!sc.accept, `${e} (platform) must be rejected`);
  }
});

test('scoreEmail: a random NON-free-mail domain on name+city alone is rejected (the faisalman bug)', () => {
  const sc = scoreEmail(id, 'f@faisalman.com', 'Cielito Lindo Cafe Austin TX f@faisalman.com');
  assert.ok(!sc.accept);   // not own-domain, not free-mail, no phone → not confidently theirs
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

test('extractEmails sanitizes trailing junk (the mapquest backslash bug)', () => {
  assert.deepEqual(extractEmails('contact <a href="mailto:help@mapquest.com\\\\\\">x</a>'), ['help@mapquest.com']);
});

test('scoreEmail: a generic niche word in a 3rd-party domain is NOT the shop (the apporder/tacos bug)', () => {
  const tacos = { name: 'Tacos El Guero', city: 'San Marcos', state: 'TX', phone: '(512) 555-0001' };
  const sc = scoreEmail(tacos, 'mifavorito@apporder777minitacos.com', 'Tacos El Guero · (512) 555-0001 · order online');
  assert.ok(!sc.accept, '"tacos" is generic — an ordering domain is not the shop\'s own email');
});

test('scoreEmail: a mapquest (aggregator) address is rejected once sanitized', () => {
  const sc = scoreEmail({ name: 'El Patroncito', city: 'San Marcos', state: 'TX' }, 'help@mapquest.com', 'El Patroncito San Marcos');
  assert.ok(!sc.accept);
});

test('discoverEmail: finds + verifies an email from a fetched contact page (mailto + phone)', async () => {
  const PAGE = 'https://listing.example/cielito';
  const searchFn = async () => ({ organic: [{ url: PAGE, title: 'Cielito Lindo Cafe', snippet: 'contact info', position: 1 }] });
  const fetchPage = async (u) => (u === PAGE
    ? { ok: true, status: 200, contentType: 'text/html',
        body: '<html><body>Cielito Lindo Cafe · (512) 555-0199 · <a href="mailto:cielitolindoatx@gmail.com">email</a></body></html>' }
    : { ok: false, status: 'FAILED' });
  const r = await discoverEmail(id, { searchFn, fetchPage, cfg: { resolveMx: mxOk } });
  assert.equal(r.email, 'cielitolindoatx@gmail.com');
  assert.equal(r.confidence, 'high');
  assert.equal(r.deliverable, true);   // domain's MX confirmed → we can contact them
});

test('discoverEmail: returns null when nothing verifiable is found', async () => {
  const searchFn = async () => ({ organic: [{ url: 'https://x.example', title: 'unrelated', snippet: 'nothing', position: 1 }] });
  const r = await discoverEmail(id, { searchFn, fetchPage: async () => ({ ok: true, status: 200, contentType: 'text/html', body: 'no emails here' }) });
  assert.equal(r.email, null);
});

test('verifyEmailDeliverable: a domain with MX records is deliverable', async () => {
  assert.equal(await verifyEmailDeliverable('hi@cielitolindocafe.com', { resolveMx: mxOk }), true);
});

test('verifyEmailDeliverable: a domain that can\'t receive mail (no MX / does not exist) → false', async () => {
  const noMx = async () => { const e = new Error('no data'); e.code = 'ENODATA'; throw e; };
  const missing = async () => { const e = new Error('not found'); e.code = 'ENOTFOUND'; throw e; };
  assert.equal(await verifyEmailDeliverable('hi@nomx.example', { resolveMx: noMx }), false);
  assert.equal(await verifyEmailDeliverable('hi@missing.example', { resolveMx: missing }), false);
  assert.equal(await verifyEmailDeliverable('hi@empty.example', { resolveMx: async () => [] }), false);
});

test('verifyEmailDeliverable: a transient DNS error is unknown (null), not a false negative', async () => {
  const flaky = async () => { const e = new Error('temp'); e.code = 'ESERVFAIL'; throw e; };
  assert.equal(await verifyEmailDeliverable('hi@flaky.example', { resolveMx: flaky }), null);
});

test('verifyEmailDeliverable: a malformed address is not deliverable', async () => {
  assert.equal(await verifyEmailDeliverable('notanemail', { resolveMx: mxOk }), false);
});
