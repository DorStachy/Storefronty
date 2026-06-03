// Stripe checkout + webhook adapter (portal/billing). Creates a SUBSCRIPTION Checkout Session for a
// Storefronty plan and verifies inbound Stripe webhook signatures. Mirrors the fill adapters' shape:
// makeStripe({ fetchForm, secretKey }) -> fns, key-gated, injected transport so it's offline-testable.
//
// Stripe's REST API is form-encoded (application/x-www-form-urlencoded) + Bearer-authed, so the prod
// transport is util/net.js postForm (NOT postJson). Webhook verification is PURE crypto (node:crypto
// HMAC-SHA256 + constant-time compare) — no network — so it works regardless of key/transport.
import crypto from 'node:crypto';
import { postForm } from '../util/net.js';

const CHECKOUT_ENDPOINT = 'https://api.stripe.com/v1/checkout/sessions';

// US monthly plans, amount in cents. Used to build inline price_data when no Stripe priceId is given.
export const PLAN_PRICES = { starter: 2900, pro: 4900, premium: 9900 };

// Human-facing product name for an inline (price_data) line item, e.g. "Storefronty Starter".
function planProductName(plan) {
  const p = String(plan || '');
  return `Storefronty ${p ? p.charAt(0).toUpperCase() + p.slice(1) : 'Plan'}`;
}

// Build the flat, bracket-keyed form fields for a subscription Checkout Session. When a Stripe priceId
// is supplied we reference it directly; otherwise we construct an inline price_data line item from
// PLAN_PRICES (usd, monthly, recurring). Only defined optional fields are included.
function checkoutFields({ plan, accountId, email, priceId, successUrl, cancelUrl }) {
  const fields = {
    mode: 'subscription',
    success_url: successUrl,
    cancel_url: cancelUrl,
    'line_items[0][quantity]': '1',
  };
  if (priceId) {
    fields['line_items[0][price]'] = priceId;
  } else {
    const amount = PLAN_PRICES[plan];
    if (amount == null) throw new Error(`UNKNOWN_PLAN:${plan}`);
    fields['line_items[0][price_data][currency]'] = 'usd';
    fields['line_items[0][price_data][product_data][name]'] = planProductName(plan);
    fields['line_items[0][price_data][unit_amount]'] = String(amount);
    fields['line_items[0][price_data][recurring][interval]'] = 'month';
  }
  if (accountId != null) {
    fields.client_reference_id = String(accountId);
    fields['metadata[accountId]'] = String(accountId);
  }
  if (email) fields.customer_email = email;
  if (plan) fields['metadata[plan]'] = String(plan);
  return fields;
}

/**
 * makeStripe({ fetchForm, secretKey }) -> { createCheckoutSession, verifyWebhook, parseSubscriptionEvent }
 * `fetchForm(url, fields, options)` is an injected async function returning the parsed JSON response
 * (tests pass a fake; prod wraps util/net.js postForm). createCheckoutSession is key-gated and THROWS on
 * misconfiguration/transport failure so the portal can render a "payments not configured yet" page; the
 * webhook fns are pure and never need a key.
 */
export function makeStripe({ fetchForm, secretKey } = {}) {
  return {
    // POST a subscription Checkout Session to Stripe and return { url, id } for the redirect.
    async createCheckoutSession({ plan, accountId, email, priceId, successUrl, cancelUrl } = {}) {
      if (!secretKey) throw new Error('STRIPE_SECRET_KEY not set');
      if (typeof fetchForm !== 'function') throw new Error('STRIPE_TRANSPORT_MISSING');
      const fields = checkoutFields({ plan, accountId, email, priceId, successUrl, cancelUrl });
      const resp = await fetchForm(CHECKOUT_ENDPOINT, fields, {
        headers: { authorization: `Bearer ${secretKey}` },
      });
      if (!resp || typeof resp !== 'object' || !resp.url) throw new Error('STRIPE_BAD_RESPONSE');
      return { url: resp.url, id: resp.id };
    },

    // Verify a Stripe webhook the way Stripe's SDK does: parse the Stripe-Signature header
    // (t=<unix>,v1=<hex-sig>[,v1=...]), recompute HMAC-SHA256(webhookSecret, "<t>.<rawBody>") and
    // constant-time compare against each provided v1. Returns the parsed JSON event on a match, else null.
    // Pure crypto — no network. (No timestamp-tolerance check here; the portal can add one if desired.)
    verifyWebhook(rawBody, sigHeader, webhookSecret) {
      return verifyWebhook(rawBody, sigHeader, webhookSecret);
    },

    // Normalize a parsed Stripe event into the small shape the portal acts on, or null if irrelevant.
    parseSubscriptionEvent(event) {
      return parseSubscriptionEvent(event);
    },
  };
}

// Standalone verifyWebhook (also exported) so callers can verify without constructing an adapter.
// rawBody MUST be the exact bytes/string Stripe signed (do not re-serialize a parsed object).
export function verifyWebhook(rawBody, sigHeader, webhookSecret) {
  if (typeof sigHeader !== 'string' || !webhookSecret) return null;
  const body = typeof rawBody === 'string' ? rawBody
    : Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : null;
  if (body == null) return null;

  // Parse "t=...,v1=...,v1=..." into the timestamp and the list of v1 signatures.
  let timestamp = null;
  const v1s = [];
  for (const part of sigHeader.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key === 't') timestamp = val;
    else if (key === 'v1') v1s.push(val);
  }
  if (!timestamp || v1s.length === 0) return null;

  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${body}`, 'utf8')
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');

  // Constant-time compare against each candidate v1 (lengths must match for timingSafeEqual).
  const matched = v1s.some((sig) => {
    const sigBuf = Buffer.from(sig, 'utf8');
    return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
  });
  if (!matched) return null;

  try { return JSON.parse(body); } catch { return null; }
}

// Standalone parseSubscriptionEvent (also exported). Maps the subscription-lifecycle events the portal
// cares about to { type, accountId, plan, customerId, status }. Returns null for unrelated events.
export function parseSubscriptionEvent(event) {
  if (!event || typeof event !== 'object' || typeof event.type !== 'string') return null;
  const obj = event.data && typeof event.data === 'object' ? event.data.object : null;
  if (!obj || typeof obj !== 'object') return null;

  switch (event.type) {
    case 'checkout.session.completed': {
      const md = obj.metadata && typeof obj.metadata === 'object' ? obj.metadata : {};
      return {
        type: event.type,
        accountId: obj.client_reference_id ?? md.accountId ?? null,
        plan: md.plan ?? null,
        customerId: obj.customer ?? null,
        status: obj.status ?? null,
      };
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const md = obj.metadata && typeof obj.metadata === 'object' ? obj.metadata : {};
      return {
        type: event.type,
        accountId: md.accountId ?? obj.client_reference_id ?? null,
        plan: md.plan ?? null,
        customerId: obj.customer ?? null,
        status: obj.status ?? (event.type === 'customer.subscription.deleted' ? 'canceled' : null),
      };
    }
    default:
      return null;
  }
}

/**
 * stripeCheckout(opts) -> { url, id }. Convenience that wires the real SSRF-safe prod transport
 * (util/net.js postForm) when STRIPE_SECRET_KEY is set; THROWS "STRIPE_SECRET_KEY not set" otherwise so
 * the portal can catch it and show a "payments not configured yet" page. Key-gated. `opts.fetchForm`
 * overrides the transport so this stays offline-testable.
 */
export async function stripeCheckout(opts = {}) {
  const secretKey = opts.secretKey ?? process.env.STRIPE_SECRET_KEY ?? '';
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY not set');
  const fetchForm = opts.fetchForm
    || ((url, fields, options) => postForm(url, fields, { headers: options.headers }));
  const stripe = makeStripe({ fetchForm, secretKey });
  return stripe.createCheckoutSession(opts);
}

// Build fields for a ONE-TIME (mode=payment) change-pack purchase. metadata.changes drives the
// credit the webhook grants. amountCents + changes come from the caller (accounts.TOPUPS).
function topupFields({ accountId, email, label, amountCents, changes, successUrl, cancelUrl }) {
  const fields = {
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product_data][name]': `Storefronty — ${label || `${changes} changes`}`,
    'line_items[0][price_data][unit_amount]': String(amountCents),
  };
  if (accountId != null) { fields.client_reference_id = String(accountId); fields['metadata[accountId]'] = String(accountId); }
  if (email) fields.customer_email = email;
  fields['metadata[changes]'] = String(changes);
  return fields;
}

/**
 * stripeTopup(opts) -> { url, id }. One-time Checkout Session for a change pack (mode=payment).
 * Same key-gating/transport as stripeCheckout; the webhook reads metadata.changes to grant credits.
 */
export async function stripeTopup(opts = {}) {
  const secretKey = opts.secretKey ?? process.env.STRIPE_SECRET_KEY ?? '';
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY not set');
  const fetchForm = opts.fetchForm
    || ((url, fields, options) => postForm(url, fields, { headers: options.headers }));
  const resp = await fetchForm(CHECKOUT_ENDPOINT, topupFields(opts), { headers: { authorization: `Bearer ${secretKey}` } });
  if (!resp || typeof resp !== 'object' || !resp.url) throw new Error('STRIPE_BAD_RESPONSE');
  return { url: resp.url, id: resp.id };
}
