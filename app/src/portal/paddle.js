// Paddle (Billing) webhook adapter (portal/billing). Paddle is a MERCHANT OF RECORD and the checkout is
// opened CLIENT-SIDE via Paddle.js, so unlike the Stripe adapter there is NO server-created checkout
// session here — the SERVER side is purely webhook verification + event normalization. Mirrors the shape
// of stripe.js's verifyWebhook/parseSubscriptionEvent: PURE crypto (node:crypto HMAC-SHA256 + constant-
// time compare, length-guarded) — no network — so it works regardless of any key/transport.
import crypto from 'node:crypto';

// Paddle Billing REST API base URLs. Not used server-side yet (checkout is client-side via Paddle.js);
// kept for reference for any future server-to-Paddle calls (e.g. subscription management).
export const PADDLE_API = {
  sandbox: 'https://sandbox-api.paddle.com',
  production: 'https://api.paddle.com',
};

/**
 * verifyPaddleWebhook(rawBody, signatureHeader, webhookSecret) -> parsed event | null.
 * Verifies a Paddle Billing webhook the way Paddle's SDK does: parse the `Paddle-Signature` header
 * (`ts=<unixSeconds>;h1=<hexHmac>` — semicolon-separated key=val pairs; tolerate multiple `h1`),
 * recompute HMAC-SHA256(webhookSecret, "<ts>:<rawBody>") and constant-time compare against each `h1`.
 * Returns the parsed JSON event on a match, else null. Returns null on missing/garbage inputs.
 * Pure crypto — no network. rawBody MUST be the exact request body string Paddle signed (do not
 * re-serialize a parsed object). (No timestamp-tolerance/replay check here; the portal can add one.)
 */
export function verifyPaddleWebhook(rawBody, signatureHeader, webhookSecret) {
  if (typeof signatureHeader !== 'string' || !webhookSecret) return null;
  const body = typeof rawBody === 'string' ? rawBody
    : Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : null;
  if (body == null) return null;

  // Parse "ts=...;h1=...;h1=..." into the timestamp and the list of h1 signatures.
  let ts = null;
  const h1s = [];
  for (const part of signatureHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key === 'ts') ts = val;
    else if (key === 'h1') h1s.push(val);
  }
  if (!ts || h1s.length === 0) return null;

  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(`${ts}:${body}`, 'utf8')
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');

  // Constant-time compare against each candidate h1 (lengths must match for timingSafeEqual).
  const matched = h1s.some((sig) => {
    const sigBuf = Buffer.from(sig, 'utf8');
    return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
  });
  if (!matched) return null;

  try { return JSON.parse(body); } catch { return null; }
}

/**
 * parsePaddleEvent(event) -> normalized portal shape | null.
 * Paddle Billing events look like `{ event_type, data: { ... } }`; `custom_data` passed at checkout time
 * lives on `data.custom_data`. Maps the lifecycle events the portal acts on to the small shape it uses:
 *   - subscription.activated|created|updated -> { type:'subscription', accountId, plan, status, customerId }
 *   - subscription.canceled                  -> same, status:'canceled'
 *   - transaction.completed|paid (with custom_data.changes) -> { type:'topup', accountId, changes, customerId }
 *     (a transaction WITHOUT custom_data.changes is a subscription's transaction — handled via the
 *      subscription event — so we return null for it)
 *   - anything else                          -> null
 * Defensive about missing data/custom_data.
 */
export function parsePaddleEvent(event) {
  if (!event || typeof event !== 'object' || typeof event.event_type !== 'string') return null;
  const data = event.data && typeof event.data === 'object' ? event.data : null;
  if (!data) return null;
  const custom = data.custom_data && typeof data.custom_data === 'object' ? data.custom_data : {};

  switch (event.event_type) {
    case 'subscription.activated':
    case 'subscription.created':
    case 'subscription.updated':
      return {
        type: 'subscription',
        accountId: custom.accountId ?? null,
        plan: custom.plan ?? null,
        status: data.status ?? 'active',
        customerId: data.customer_id ?? null,
      };
    case 'subscription.canceled':
      return {
        type: 'subscription',
        accountId: custom.accountId ?? null,
        plan: custom.plan ?? null,
        status: 'canceled',
        customerId: data.customer_id ?? null,
      };
    case 'transaction.completed':
    case 'transaction.paid':
      // Only one-time change-pack purchases carry custom_data.changes. A subscription's transaction
      // has no changes and is handled via the subscription event, so return null for it.
      if (custom.changes == null) return null;
      return {
        type: 'topup',
        accountId: custom.accountId ?? null,
        changes: Number(custom.changes) || 0,
        customerId: data.customer_id ?? null,
      };
    default:
      return null;
  }
}
