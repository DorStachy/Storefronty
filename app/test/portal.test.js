import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { openDatabase } from '../src/db.js';
import { handlePortal, handleStripeWebhook } from '../src/portal/index.js';
import { signToken } from '../src/util/sign.js';

const config = {
  signSecret: 'sec', portalBaseUrl: 'http://localhost:4173',
  stripe: { secretKey: '', webhookSecret: 'whsec_test' },
};

const cookiesFrom = (out) => {
  const m = String(out.headers?.['set-cookie'] || '').match(/sf_session=([^;]+)/);
  return m ? { sf_session: decodeURIComponent(m[1]) } : {};
};

test('claim link shows a signup page bound to the lead; forged token → 403', async () => {
  const db = openDatabase(':memory:');
  const { id: leadId } = db.insertLead({ name: 'Claim Co', niche: 'cafe' });
  const token = signToken({ leadId, kind: 'claim' }, config.signSecret);
  const out = await handlePortal({ method: 'GET', path: `/claim/${token}`, db, config });
  assert.equal(out.status, 200);
  assert.match(out.body, /Create your account/);
  assert.match(out.body, /Claim Co/);
  assert.equal((await handlePortal({ method: 'GET', path: `/claim/${token}x`, db, config })).status, 403);
  db.close();
});

test('signup → session → dashboard; the free change re-enters the rebuild pipeline', async () => {
  const db = openDatabase(':memory:');
  const { id: leadId } = db.insertLead({ name: 'Claim Co', niche: 'cafe' });
  for (const s of ['built', 'deployed', 'emailed']) db.setStatus(leadId, s);
  const claim = signToken({ leadId, kind: 'claim' }, config.signSecret);

  const signup = await handlePortal({ method: 'POST', path: '/signup', body: { email: 'o@co.com', password: 'longenough1', claim }, db, config });
  assert.equal(signup.status, 303);
  assert.equal(signup.headers.location, '/dashboard');
  const cookies = cookiesFrom(signup);
  assert.ok(cookies.sf_session, 'session cookie set');
  const acct = db.getAccountByEmail('o@co.com');
  assert.equal(acct.lead_id, leadId); // pre-bound to his site

  const dash = await handlePortal({ method: 'GET', path: '/dashboard', cookies, db, config });
  assert.equal(dash.status, 200);
  assert.match(dash.body, /Claim Co/);
  assert.match(dash.body, /free change available/);

  const chg = await handlePortal({ method: 'POST', path: '/request-change', body: { body: 'make it navy' }, cookies, db, config });
  assert.equal(chg.status, 303);
  assert.equal(db.getAccount(acct.id).free_change_used, 1);
  assert.equal(db.getLead(leadId).status, 'replied'); // back into the rebuild loop
  assert.equal(db.changeRequestsFor(acct.id).length, 1);
  db.close();
});

test('dashboard requires a session (redirects to /login)', async () => {
  const db = openDatabase(':memory:');
  const out = await handlePortal({ method: 'GET', path: '/dashboard', cookies: {}, db, config });
  assert.equal(out.status, 303);
  assert.equal(out.headers.location, '/login');
  db.close();
});

test('login with right vs wrong creds', async () => {
  const db = openDatabase(':memory:');
  await handlePortal({ method: 'POST', path: '/signup', body: { email: 'l@co.com', password: 'longenough1', claim: '' }, db, config });
  const ok = await handlePortal({ method: 'POST', path: '/login', body: { email: 'l@co.com', password: 'longenough1' }, db, config });
  assert.equal(ok.status, 303);
  assert.ok(cookiesFrom(ok).sf_session);
  assert.equal((await handlePortal({ method: 'POST', path: '/login', body: { email: 'l@co.com', password: 'nope' }, db, config })).status, 401);
  db.close();
});

test('choose-plan lists tiers; checkout without a Stripe key shows a friendly page', async () => {
  const db = openDatabase(':memory:');
  await handlePortal({ method: 'POST', path: '/signup', body: { email: 'p@co.com', password: 'longenough1', claim: '' }, db, config });
  const cookies = cookiesFrom(await handlePortal({ method: 'POST', path: '/login', body: { email: 'p@co.com', password: 'longenough1' }, db, config }));
  const plans = await handlePortal({ method: 'GET', path: '/choose-plan', cookies, db, config });
  assert.match(plans.body, /Starter/);
  assert.match(plans.body, /\$99/);
  delete process.env.STRIPE_SECRET_KEY; // ensure unconfigured
  const co = await handlePortal({ method: 'POST', path: '/checkout', body: { plan: 'pro' }, cookies, db, config });
  assert.equal(co.status, 200);
  assert.match(co.body, /Payments aren't switched on/);
  db.close();
});

test('stripe webhook activates the plan on checkout.session.completed', async () => {
  const db = openDatabase(':memory:');
  const acctId = db.addAccount({ email: 'w@co.com', passwordHash: 'x' });
  const event = { type: 'checkout.session.completed', data: { object: { client_reference_id: String(acctId), customer: 'cus_1', status: 'complete', metadata: { plan: 'pro', accountId: String(acctId) } } } };
  const raw = JSON.stringify(event);
  const t = 1700000000;
  const sig = `t=${t},v1=${createHmac('sha256', config.stripe.webhookSecret).update(`${t}.${raw}`).digest('hex')}`;
  const out = await handleStripeWebhook({ rawBody: raw, signature: sig, db, config });
  assert.equal(out.status, 200);
  const acct = db.getAccount(acctId);
  assert.equal(acct.plan, 'pro');
  assert.equal(acct.plan_status, 'active');
  db.close();
});
