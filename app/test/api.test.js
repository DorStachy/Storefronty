import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { openDatabase } from '../src/db.js';
import { handleApi, handleStripeWebhook } from '../src/api/index.js';
import { signToken } from '../src/util/sign.js';

const config = {
  signSecret: 'sec', portalBaseUrl: 'http://localhost:4173', publicBaseUrl: 'http://localhost:4173',
  stripe: { secretKey: '', webhookSecret: 'whsec_test' },
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
