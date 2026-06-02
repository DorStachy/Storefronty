import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  makeStripe,
  stripeCheckout,
  verifyWebhook,
  parseSubscriptionEvent,
  PLAN_PRICES,
} from '../src/portal/stripe.js';

// A fake Stripe response for a created Checkout Session.
const fakeSession = { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' };

// Build a VALID Stripe-Signature header for a body using the same scheme the adapter verifies,
// so the test is fully self-contained (no network). t.<body> signed with HMAC-SHA256.
function signStripe(body, secret, ts = Math.floor(Date.now() / 1000)) {
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.${body}`, 'utf8').digest('hex');
  return `t=${ts},v1=${sig}`;
}

test('PLAN_PRICES are the US monthly amounts in cents', () => {
  assert.deepEqual(PLAN_PRICES, { starter: 2900, pro: 4900, premium: 9900 });
});

test('createCheckoutSession: posts a subscription session and returns the url/id', async () => {
  let captured = null;
  const fetchForm = async (url, fields, options) => { captured = { url, fields, options }; return fakeSession; };
  const stripe = makeStripe({ fetchForm, secretKey: 'sk_test_123' });

  const out = await stripe.createCheckoutSession({
    plan: 'pro',
    accountId: 42,
    email: 'owner@example.com',
    successUrl: 'https://app.storefronty.com/billing/success',
    cancelUrl: 'https://app.storefronty.com/billing/cancel',
  });

  // Returned shape comes straight from the Stripe response.
  assert.deepEqual(out, { url: fakeSession.url, id: fakeSession.id });

  // Endpoint + Bearer auth.
  assert.equal(captured.url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(captured.options.headers.authorization, 'Bearer sk_test_123');

  // Subscription-mode session with the plan's inline price (no priceId given).
  assert.equal(captured.fields.mode, 'subscription');
  assert.equal(captured.fields['line_items[0][price_data][currency]'], 'usd');
  assert.equal(captured.fields['line_items[0][price_data][unit_amount]'], String(PLAN_PRICES.pro));
  assert.equal(captured.fields['line_items[0][price_data][recurring][interval]'], 'month');
  assert.equal(captured.fields['line_items[0][price_data][product_data][name]'], 'Storefronty Pro');
  assert.equal(captured.fields['line_items[0][quantity]'], '1');

  // Account linkage + metadata + customer email + redirect urls.
  assert.equal(captured.fields.client_reference_id, '42');
  assert.equal(captured.fields['metadata[accountId]'], '42');
  assert.equal(captured.fields['metadata[plan]'], 'pro');
  assert.equal(captured.fields.customer_email, 'owner@example.com');
  assert.equal(captured.fields.success_url, 'https://app.storefronty.com/billing/success');
  assert.equal(captured.fields.cancel_url, 'https://app.storefronty.com/billing/cancel');
});

test('createCheckoutSession: a Stripe priceId is referenced instead of inline price_data', async () => {
  let captured = null;
  const fetchForm = async (url, fields) => { captured = { url, fields }; return fakeSession; };
  const stripe = makeStripe({ fetchForm, secretKey: 'sk_test_123' });

  await stripe.createCheckoutSession({
    plan: 'premium',
    accountId: 'acct_7',
    priceId: 'price_LIVE_abc',
    successUrl: 'https://x/s',
    cancelUrl: 'https://x/c',
  });

  assert.equal(captured.fields['line_items[0][price]'], 'price_LIVE_abc');
  // No inline price_data when a priceId is supplied.
  assert.equal(captured.fields['line_items[0][price_data][unit_amount]'], undefined);
  // Plan metadata still flows through for our own bookkeeping.
  assert.equal(captured.fields['metadata[plan]'], 'premium');
  assert.equal(captured.fields.mode, 'subscription');
});

test('createCheckoutSession: throws without a secret key (portal shows not-configured)', async () => {
  const stripe = makeStripe({ fetchForm: async () => fakeSession, secretKey: '' });
  await assert.rejects(
    () => stripe.createCheckoutSession({ plan: 'starter', accountId: 1, successUrl: 'https://x/s', cancelUrl: 'https://x/c' }),
    /STRIPE_SECRET_KEY not set/,
  );
});

test('verifyWebhook: a valid signature returns the parsed event', () => {
  const secret = 'whsec_test_secret';
  const event = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1' } } };
  const body = JSON.stringify(event);
  const header = signStripe(body, secret);

  const stripe = makeStripe({ fetchForm: async () => fakeSession, secretKey: 'sk_test' });
  const verified = stripe.verifyWebhook(body, header, secret);
  assert.ok(verified, 'a valid signature must verify');
  assert.equal(verified.id, 'evt_1');
  assert.equal(verified.type, 'checkout.session.completed');

  // Standalone export agrees.
  assert.deepEqual(verifyWebhook(body, header, secret), event);
});

test('verifyWebhook: a tampered body returns null', () => {
  const secret = 'whsec_test_secret';
  const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: {} } });
  const header = signStripe(body, secret);
  // Body changed after signing => signature no longer matches.
  const tamperedBody = body.replace('evt_1', 'evt_HACKED');
  assert.equal(verifyWebhook(tamperedBody, header, secret), null);
});

test('verifyWebhook: the wrong secret returns null', () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: {} } });
  const header = signStripe(body, 'whsec_real');
  assert.equal(verifyWebhook(body, header, 'whsec_WRONG'), null);
});

test('verifyWebhook: a malformed header returns null', () => {
  const body = '{}';
  assert.equal(verifyWebhook(body, 'not-a-stripe-sig-header', 'whsec'), null);
  assert.equal(verifyWebhook(body, '', 'whsec'), null);
});

test('parseSubscriptionEvent: checkout.session.completed normalizes correctly', () => {
  const event = {
    id: 'evt_2',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_2',
        client_reference_id: '42',
        customer: 'cus_ABC',
        status: 'complete',
        metadata: { plan: 'pro', accountId: '42' },
      },
    },
  };
  const norm = parseSubscriptionEvent(event);
  assert.deepEqual(norm, {
    type: 'checkout.session.completed',
    accountId: '42',
    plan: 'pro',
    customerId: 'cus_ABC',
    status: 'complete',
  });
});

test('parseSubscriptionEvent: subscription.deleted carries a canceled status', () => {
  const event = {
    type: 'customer.subscription.deleted',
    data: { object: { customer: 'cus_X', metadata: { accountId: '7', plan: 'starter' } } },
  };
  const norm = parseSubscriptionEvent(event);
  assert.equal(norm.type, 'customer.subscription.deleted');
  assert.equal(norm.accountId, '7');
  assert.equal(norm.customerId, 'cus_X');
  assert.equal(norm.status, 'canceled');
});

test('parseSubscriptionEvent: an unrelated event type returns null', () => {
  assert.equal(parseSubscriptionEvent({ type: 'invoice.paid', data: { object: {} } }), null);
  assert.equal(parseSubscriptionEvent(null), null);
  assert.equal(parseSubscriptionEvent({ type: 'checkout.session.completed' }), null); // no data.object
});

test('stripeCheckout: throws clearly when STRIPE_SECRET_KEY is unset', async () => {
  const saved = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  try {
    await assert.rejects(
      () => stripeCheckout({ plan: 'starter', accountId: 1, successUrl: 'https://x/s', cancelUrl: 'https://x/c' }),
      /STRIPE_SECRET_KEY not set/,
    );
  } finally {
    if (saved !== undefined) process.env.STRIPE_SECRET_KEY = saved;
  }
});

test('stripeCheckout: an injected fetchForm keeps it offline-testable', async () => {
  const saved = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'sk_test_env';
  try {
    let captured = null;
    const fetchForm = async (url, fields, options) => { captured = { url, fields, options }; return fakeSession; };
    const out = await stripeCheckout({
      plan: 'starter', accountId: 9, email: 'a@b.com',
      successUrl: 'https://x/s', cancelUrl: 'https://x/c', fetchForm,
    });
    assert.deepEqual(out, { url: fakeSession.url, id: fakeSession.id });
    assert.equal(captured.options.headers.authorization, 'Bearer sk_test_env');
    assert.equal(captured.fields['line_items[0][price_data][unit_amount]'], String(PLAN_PRICES.starter));
  } finally {
    if (saved === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = saved;
  }
});
