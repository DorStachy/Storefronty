import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { openDatabase } from '../src/db.js';
import { handleApi, handleStripeWebhook, handlePaddleWebhook, handleGoogleStart, handleGoogleCallback } from '../src/api/index.js';
import { signToken } from '../src/util/sign.js';

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

test('signup sets a session; /api/me needs it; the free change re-enters the pipeline', async () => {
  const db = openDatabase(':memory:');
  const { id } = db.insertLead({ name: 'API Cafe', niche: 'cafe' });
  for (const s of ['built', 'deployed', 'emailed']) db.setStatus(id, s);
  const token = signToken({ leadId: id, kind: 'claim' }, config.signSecret);

  const su = await handleApi({ method: 'POST', path: '/api/auth/signup', body: { email: 'a@b.com', password: 'longenough1', token }, db, config });
  assert.equal(su.status, 200);
  const cookies = cookiesFrom(su);
  assert.ok(cookies.sf_session, 'session cookie set');

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

test('login works; plans list; checkout gated without a Stripe key', async () => {
  const db = openDatabase(':memory:');
  await handleApi({ method: 'POST', path: '/api/auth/signup', body: { email: 'l@b.com', password: 'longenough1', token: '' }, db, config });
  const login = await handleApi({ method: 'POST', path: '/api/auth/login', body: { email: 'l@b.com', password: 'longenough1' }, db, config });
  assert.equal(login.status, 200);
  const cookies = cookiesFrom(login);
  assert.equal((await handleApi({ method: 'POST', path: '/api/auth/login', body: { email: 'l@b.com', password: 'nope' }, db, config })).status, 401);

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
  const token = signToken({ leadId: id, kind: 'claim' }, config.signSecret);
  const cookies = cookiesFrom(await handleApi({ method: 'POST', path: '/api/auth/signup', body: { email: 'q@b.com', password: 'longenough1', token }, db, config }));

  await handleApi({ method: 'POST', path: '/api/requests', body: { body: 'one' }, cookies, db, config }); // free
  assert.equal((await handleApi({ method: 'POST', path: '/api/requests', body: { body: 'two' }, cookies, db, config })).status, 402); // no plan

  const acct = db.getAccountByEmail('q@b.com');
  db.setAccountPlan(acct.id, { plan: 'starter', planStatus: 'active' });
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
  const token = signToken({ leadId: id, kind: 'claim' }, config.signSecret);
  const cookies = cookiesFrom(await handleApi({ method: 'POST', path: '/api/auth/signup', body: { email: 'img@b.com', password: 'longenough1', token }, db, config }));
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const r = await handleApi({ method: 'POST', path: '/api/requests', body: { body: 'add these photos', images: [{ name: 'a.png', dataUrl: png }] }, cookies, db, config });
  assert.equal(r.status, 200);
  assert.equal(J(r).request.images, 1);
  const reqs = db.changeRequestsFor(db.getAccountByEmail('img@b.com').id);
  assert.equal(reqs.length, 1);
  assert.equal(JSON.parse(reqs[0].images).length, 1); // the photo path was stored ("sent to us")
  db.close();
});

test('top-up: the webhook grants credits, which allow a change after the quota is spent', async () => {
  const db = openDatabase(':memory:');
  const { id } = db.insertLead({ name: 'Topup Cafe', niche: 'cafe' });
  for (const s of ['built', 'deployed', 'emailed']) db.setStatus(id, s);
  const token = signToken({ leadId: id, kind: 'claim' }, config.signSecret);
  const cookies = cookiesFrom(await handleApi({ method: 'POST', path: '/api/auth/signup', body: { email: 'top@b.com', password: 'longenough1', token }, db, config }));
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
