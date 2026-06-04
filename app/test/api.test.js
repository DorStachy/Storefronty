import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { openDatabase } from '../src/db.js';
import { handleApi, handleStripeWebhook, handlePaddleWebhook, handleGoogleStart, handleGoogleCallback } from '../src/api/index.js';
import { signToken } from '../src/util/sign.js';
import { hashCode, trustToken, sessionToken } from '../src/portal/emailauth.js';

const config = {
  signSecret: 'sec', portalBaseUrl: 'http://localhost:4173', publicBaseUrl: 'http://localhost:4173',
  stripe: { secretKey: '', webhookSecret: 'whsec_test' },
  paddle: { env: 'sandbox', clientToken: '', webhookSecret: 'pdltest', prices: {} },
  google: { clientId: '', clientSecret: '' },
  payments: { provider: 'paddle' },
};
const J = (out) => JSON.parse(out.body);
const cookiesFrom = (out) => {
  const m = String(out.headers?.['set-cookie'] || '').match(/sf_session=([^;]+)/);
  return m ? { sf_session: decodeURIComponent(m[1]) } : {};
};

// Create a real account (signup binds the lead + hashes the password), mark it verified, and return a
// minted session cookie — a deterministic shortcut past the hashed email-code (the code flow itself is
// covered by its own tests below).
async function claimAndVerify(db, config, { email, leadId = null, password = 'longenough1' }) {
  const token = leadId ? signToken({ leadId, kind: 'claim' }, config.signSecret) : '';
  await handleApi({ method: 'POST', path: '/api/auth/signup', body: { email, password, token }, db, config });
  const acct = db.getAccountByEmail(email);
  db.setEmailVerified(acct.id);
  return { acctId: acct.id, cookies: { sf_session: sessionToken(acct.id, config.signSecret) } };
}
// Plant a KNOWN code (hashed with the test secret) so a test can exercise the real verify/2fa endpoint.
const plantCode = (db, config, accountId, purpose, code) =>
  db.createEmailCode({ accountId, purpose, codeHash: hashCode(code, config.signSecret), expiresAt: new Date(Date.now() + 600000).toISOString() });

test('claim returns the shop; a forged token is 400', async () => {
  const db = openDatabase(':memory:');
  const { id } = db.insertLead({ name: 'API Cafe', niche: 'cafe' });
  const token = signToken({ leadId: id, kind: 'claim' }, config.signSecret);
  let out = await handleApi({ method: 'POST', path: '/api/auth/claim', body: { token }, db, config });
  assert.equal(out.status, 200);
  assert.equal(J(out).shop.name, 'API Cafe');
  out = await handleApi({ method: 'POST', path: '/api/auth/claim', body: { token: `${token}x` }, db, config });
  assert.equal(out.status, 400);
  db.close();
});

test('signup requires email verification, then /api/me works + the free change re-enters the pipeline', async () => {
  const db = openDatabase(':memory:');
  const { id } = db.insertLead({ name: 'API Cafe', niche: 'cafe' });
  for (const s of ['built', 'deployed', 'emailed']) db.setStatus(id, s);
  const token = signToken({ leadId: id, kind: 'claim' }, config.signSecret);

  const su = await handleApi({ method: 'POST', path: '/api/auth/signup', body: { email: 'a@b.com', password: 'longenough1', token }, db, config });
  assert.equal(su.status, 200);
  assert.equal(J(su).needsVerify, true);
  assert.ok(!cookiesFrom(su).sf_session, 'no session until the email is verified');

  // verify with a planted (known) code → the REAL verify-email endpoint → session + trusted device
  const acctId = db.getAccountByEmail('a@b.com').id;
  plantCode(db, config, acctId, 'verify', '424242');
  const ve = await handleApi({ method: 'POST', path: '/api/auth/verify-email', body: { email: 'a@b.com', code: '424242' }, db, config });
  assert.equal(ve.status, 200);
  const cookies = cookiesFrom(ve);
  assert.ok(cookies.sf_session, 'session after verification');
  assert.equal(db.getAccountByEmail('a@b.com').email_verified, 1);

  assert.equal((await handleApi({ method: 'GET', path: '/api/me', cookies: {}, db, config })).status, 401);
  const me = J(await handleApi({ method: 'GET', path: '/api/me', cookies, db, config }));
  assert.equal(me.shop, 'API Cafe');
  assert.equal(me.quota.freeAvailable, true);

  const req = await handleApi({ method: 'POST', path: '/api/requests', body: { body: 'make it navy' }, cookies, db, config });
  assert.equal(req.status, 200);
  assert.match(J(req).reply, /rebuild your site/);
  assert.equal(db.getLead(id).status, 'replied'); // re-entered the rebuild loop
  assert.equal(db.getAccountByEmail('a@b.com').free_change_used, 1);
  db.close();
});

test('login: a verified account on a new device needs an email code; plans list; checkout gated', async () => {
  const db = openDatabase(':memory:');
  const { acctId } = await claimAndVerify(db, config, { email: 'l@b.com' });

  const login = await handleApi({ method: 'POST', path: '/api/auth/login', body: { email: 'l@b.com', password: 'longenough1' }, db, config });
  assert.equal(login.status, 200);
  assert.equal(J(login).needs2fa, true);                          // verified, new device → email a code
  const pendingToken = J(login).pendingToken;
  assert.ok(pendingToken, 'a pending token is issued only after the correct password');
  assert.ok(!cookiesFrom(login).sf_session, 'no session until the 2FA code is entered');
  assert.equal((await handleApi({ method: 'POST', path: '/api/auth/login', body: { email: 'l@b.com', password: 'nope' }, db, config })).status, 401);

  plantCode(db, config, acctId, 'login', '555000');
  const tfa = await handleApi({ method: 'POST', path: '/api/auth/2fa', body: { pendingToken, code: '555000' }, db, config });
  assert.equal(tfa.status, 200);
  const cookies = cookiesFrom(tfa);
  assert.ok(cookies.sf_session, 'session after the 2FA code');

  const plans = J(await handleApi({ method: 'GET', path: '/api/plans', db, config }));
  assert.equal(plans.plans.length, 3);
  assert.equal(plans.plans[2].price, 99);

  delete process.env.STRIPE_SECRET_KEY;
  const co = J(await handleApi({ method: 'POST', path: '/api/billing/checkout', body: { plan: 'pro' }, cookies, db, config }));
  assert.equal(co.configured, false);
  db.close();
});

test('a second change is blocked without a plan (402), allowed on an active plan', async () => {
  const db = openDatabase(':memory:');
  const { id } = db.insertLead({ name: 'Quota Cafe', niche: 'cafe' });
  for (const s of ['built', 'deployed', 'emailed']) db.setStatus(id, s);
  const { acctId, cookies } = await claimAndVerify(db, config, { email: 'q@b.com', leadId: id });

  await handleApi({ method: 'POST', path: '/api/requests', body: { body: 'one' }, cookies, db, config }); // free
  assert.equal((await handleApi({ method: 'POST', path: '/api/requests', body: { body: 'two' }, cookies, db, config })).status, 402); // no plan

  db.setAccountPlan(acctId, { plan: 'starter', planStatus: 'active' });
  assert.equal((await handleApi({ method: 'POST', path: '/api/requests', body: { body: 'two' }, cookies, db, config })).status, 200);
  db.close();
});

test('stripe webhook activates the plan on checkout.session.completed', async () => {
  const db = openDatabase(':memory:');
  const acctId = db.addAccount({ email: 'w@b.com', passwordHash: 'x' });
  const event = { type: 'checkout.session.completed', data: { object: { client_reference_id: String(acctId), customer: 'cus_1', status: 'complete', metadata: { plan: 'pro', accountId: String(acctId) } } } };
  const raw = JSON.stringify(event);
  const t = 1700000000;
  const sig = `t=${t},v1=${createHmac('sha256', config.stripe.webhookSecret).update(`${t}.${raw}`).digest('hex')}`;
  const out = await handleStripeWebhook({ rawBody: raw, signature: sig, db, config });
  assert.equal(out.status, 200);
  assert.equal(db.getAccount(acctId).plan, 'pro');
  assert.equal(db.getAccount(acctId).plan_status, 'active');
  db.close();
});

test('image upload: a request with photos is saved + counted on the change request', async () => {
  const db = openDatabase(':memory:');
  const { id } = db.insertLead({ name: 'Img Cafe', niche: 'cafe' });
  for (const s of ['built', 'deployed', 'emailed']) db.setStatus(id, s);
  const { cookies } = await claimAndVerify(db, config, { email: 'img@b.com', leadId: id });
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const r = await handleApi({ method: 'POST', path: '/api/requests', body: { body: 'add these photos', images: [{ name: 'a.png', dataUrl: png }] }, cookies, db, config });
  assert.equal(r.status, 200);
  assert.equal(J(r).request.images, 1);
  const reqs = db.changeRequestsFor(db.getAccountByEmail('img@b.com').id);
  assert.equal(reqs.length, 1);
  assert.equal(JSON.parse(reqs[0].images).length, 1); // the photo path was stored ("sent to us")
  db.close();
});

test('GET /api/requests surfaces the completion once the rebuild marks the request done', async () => {
  const db = openDatabase(':memory:');
  const { id } = db.insertLead({ name: 'Done Cafe', niche: 'cafe' });
  for (const s of ['built', 'deployed', 'emailed']) db.setStatus(id, s);
  const { cookies } = await claimAndVerify(db, config, { email: 'done@b.com', leadId: id });
  await handleApi({ method: 'POST', path: '/api/requests', body: { body: 'make it navy' }, cookies, db, config });

  let reqs = J(await handleApi({ method: 'GET', path: '/api/requests', cookies, db, config })).requests;
  assert.equal(reqs[0].done, false);     // still queued — no completion yet
  assert.equal(reqs[0].result, null);

  db.markChangeRequestsDoneForLead(id, 'All set — your site is updated.'); // the rebuild finishes
  reqs = J(await handleApi({ method: 'GET', path: '/api/requests', cookies, db, config })).requests;
  assert.equal(reqs[0].done, true);
  assert.match(reqs[0].result, /updated/);
  db.close();
});

test('top-up: the webhook grants credits, which allow a change after the quota is spent', async () => {
  const db = openDatabase(':memory:');
  const { id } = db.insertLead({ name: 'Topup Cafe', niche: 'cafe' });
  for (const s of ['built', 'deployed', 'emailed']) db.setStatus(id, s);
  const { cookies } = await claimAndVerify(db, config, { email: 'top@b.com', leadId: id });
  const acct = db.getAccountByEmail('top@b.com');

  await handleApi({ method: 'POST', path: '/api/requests', body: { body: 'free one' }, cookies, db, config }); // free
  assert.equal((await handleApi({ method: 'POST', path: '/api/requests', body: { body: 'blocked' }, cookies, db, config })).status, 402); // no plan/credits

  const ev = { type: 'checkout.session.completed', data: { object: { mode: 'payment', client_reference_id: String(acct.id), metadata: { accountId: String(acct.id), changes: '5' } } } };
  const raw = JSON.stringify(ev); const t = 1700000000;
  const sig = `t=${t},v1=${createHmac('sha256', config.stripe.webhookSecret).update(`${t}.${raw}`).digest('hex')}`;
  assert.equal((await handleStripeWebhook({ rawBody: raw, signature: sig, db, config })).status, 200);
  assert.equal(db.getAccount(acct.id).extra_changes, 5); // credited

  assert.equal((await handleApi({ method: 'POST', path: '/api/requests', body: { body: 'uses a credit' }, cookies, db, config })).status, 200);
  assert.equal(db.getAccount(acct.id).extra_changes, 4); // credit consumed

  delete process.env.STRIPE_SECRET_KEY;
  assert.equal(J(await handleApi({ method: 'POST', path: '/api/billing/topup', body: { pack: 'pack5' }, cookies, db, config })).configured, false);
  db.close();
});

test('paddle webhook: subscription.activated → active plan; transaction.completed → credits', async () => {
  const db = openDatabase(':memory:');
  const acctId = db.addAccount({ email: 'pad@b.com', passwordHash: 'x' });
  const sign = (raw) => { const t = 1700000000; return `ts=${t};h1=${createHmac('sha256', config.paddle.webhookSecret).update(`${t}:${raw}`).digest('hex')}`; };

  const sub = JSON.stringify({ event_type: 'subscription.activated', data: { status: 'active', customer_id: 'ctm_1', custom_data: { accountId: String(acctId), plan: 'pro' } } });
  assert.equal((await handlePaddleWebhook({ rawBody: sub, signature: sign(sub), db, config })).status, 200);
  assert.equal(db.getAccount(acctId).plan, 'pro');
  assert.equal(db.getAccount(acctId).plan_status, 'active');

  const tx = JSON.stringify({ event_type: 'transaction.completed', data: { customer_id: 'ctm_1', custom_data: { accountId: String(acctId), changes: '15' } } });
  assert.equal((await handlePaddleWebhook({ rawBody: tx, signature: sign(tx), db, config })).status, 200);
  assert.equal(db.getAccount(acctId).extra_changes, 15);

  assert.equal((await handlePaddleWebhook({ rawBody: sub, signature: 'ts=1;h1=bad', db, config })).status, 400); // forged
  db.close();
});

test('verify-email rejects wrong codes and burns the code after too many tries', async () => {
  const db = openDatabase(':memory:');
  const acctId = db.addAccount({ email: 'vc@b.com', passwordHash: 'x' });
  plantCode(db, config, acctId, 'verify', '111111');
  for (let i = 0; i < 5; i++) {
    assert.equal((await handleApi({ method: 'POST', path: '/api/auth/verify-email', body: { email: 'vc@b.com', code: '000000' }, db, config })).status, 400);
  }
  // 6th try: even the CORRECT code is rejected — the code is burned (attempt cap).
  const r6 = await handleApi({ method: 'POST', path: '/api/auth/verify-email', body: { email: 'vc@b.com', code: '111111' }, db, config });
  assert.equal(r6.status, 429);
  assert.equal(db.getAccount(acctId).email_verified, 0);
  db.close();
});

test('login locks the account after repeated bad passwords (brute-force defence)', async () => {
  const db = openDatabase(':memory:');
  await claimAndVerify(db, config, { email: 'bf@b.com' });
  for (let i = 0; i < 5; i++) {
    assert.equal((await handleApi({ method: 'POST', path: '/api/auth/login', body: { email: 'bf@b.com', password: 'wrong' }, db, config })).status, 401);
  }
  // even the CORRECT password is now locked out
  assert.equal((await handleApi({ method: 'POST', path: '/api/auth/login', body: { email: 'bf@b.com', password: 'longenough1' }, db, config })).status, 429);
  db.close();
});

test('a trusted-device cookie lets a verified user log in without an email code', async () => {
  const db = openDatabase(':memory:');
  const { acctId } = await claimAndVerify(db, config, { email: 'td@b.com' });
  const cookies = { sf_trust: trustToken(acctId, config.signSecret) };
  const r = await handleApi({ method: 'POST', path: '/api/auth/login', body: { email: 'td@b.com', password: 'longenough1' }, cookies, db, config });
  assert.equal(r.status, 200);
  assert.ok(J(r).account, 'logged straight in on a trusted device');
  assert.ok(!J(r).needs2fa);
  db.close();
});

test('resend never reveals whether an email exists (anti-enumeration)', async () => {
  const db = openDatabase(':memory:');
  const r = await handleApi({ method: 'POST', path: '/api/auth/resend', body: { email: 'nobody@nowhere.com', purpose: 'verify' }, db, config });
  assert.equal(r.status, 200);
  assert.equal(J(r).ok, true);
  db.close();
});

test('a trust token cannot be replayed as a session, and an expired session is rejected', async () => {
  const db = openDatabase(':memory:');
  const { acctId } = await claimAndVerify(db, config, { email: 'tc@b.com' });
  // wrong token CLASS in the session slot → rejected
  assert.equal((await handleApi({ method: 'GET', path: '/api/me', cookies: { sf_session: trustToken(acctId, config.signSecret) }, db, config })).status, 401);
  // an expired session token → rejected (exp baked into the token, not just the cookie)
  assert.equal((await handleApi({ method: 'GET', path: '/api/me', cookies: { sf_session: sessionToken(acctId, config.signSecret, 0, -1) }, db, config })).status, 401);
  db.close();
});

test('logout revokes the session server-side — the same cookie stops working', async () => {
  const db = openDatabase(':memory:');
  const { cookies } = await claimAndVerify(db, config, { email: 'rv@b.com' });
  assert.equal((await handleApi({ method: 'GET', path: '/api/me', cookies, db, config })).status, 200);
  await handleApi({ method: 'POST', path: '/api/auth/logout', cookies, db, config });
  assert.equal((await handleApi({ method: 'GET', path: '/api/me', cookies, db, config })).status, 401); // revoked, not just cleared
  db.close();
});

test('2FA cannot be completed without the pending token from a correct password', async () => {
  const db = openDatabase(':memory:');
  const { acctId } = await claimAndVerify(db, config, { email: 'pw@b.com' });
  plantCode(db, config, acctId, 'login', '123123');
  // a valid code alone (no / forged pending token) is refused — the email code can't bypass the password
  assert.equal((await handleApi({ method: 'POST', path: '/api/auth/2fa', body: { code: '123123' }, db, config })).status, 400);
  assert.equal((await handleApi({ method: 'POST', path: '/api/auth/2fa', body: { pendingToken: 'forged', code: '123123' }, db, config })).status, 400);
  // resend('login') without a pending token mints NO code (login codes require the password)
  const before = db.latestEmailCode(acctId, 'login').id;
  await handleApi({ method: 'POST', path: '/api/auth/resend', body: { purpose: 'login', email: 'pw@b.com' }, db, config });
  assert.equal(db.latestEmailCode(acctId, 'login').id, before, 'no login code minted without proving the password');
  db.close();
});

test('a verified account cannot use the verify path as an email-only login (no password bypass)', async () => {
  const db = openDatabase(':memory:');
  const { acctId } = await claimAndVerify(db, config, { email: 'vv@b.com' }); // already verified
  const before = db.latestEmailCode(acctId, 'verify');                        // the signup code
  await handleApi({ method: 'POST', path: '/api/auth/resend', body: { purpose: 'verify', email: 'vv@b.com' }, db, config });
  assert.equal(db.latestEmailCode(acctId, 'verify').id, before.id, 'resend mints no new verify code for a verified account');
  // even a planted, valid verify code is refused — the verify path grants no session once verified
  plantCode(db, config, acctId, 'verify', '999999');
  const r = await handleApi({ method: 'POST', path: '/api/auth/verify-email', body: { email: 'vv@b.com', code: '999999' }, db, config });
  assert.equal(r.status, 400);
  assert.ok(!cookiesFrom(r).sf_session, 'no session granted from the verify path for a verified account');
  db.close();
});

test('google: start redirects to consent when configured (else google_off); a forged callback state → err', async () => {
  const off = await handleGoogleStart({}, { ...config, google: { clientId: '' } });
  assert.equal(off.status, 302);
  assert.match(off.headers.location, /google_off/);

  const on = await handleGoogleStart({}, { ...config, google: { clientId: 'cid.apps.googleusercontent.com' } });
  assert.equal(on.status, 302);
  assert.match(on.headers.location, /accounts\.google\.com/);

  const db = openDatabase(':memory:');
  const bad = await handleGoogleCallback({ query: { code: 'x', state: 'forged' }, db, config });
  assert.equal(bad.status, 302);
  assert.match(bad.headers.location, /err=google/);
  db.close();
});
