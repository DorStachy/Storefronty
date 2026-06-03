# 07 — Billing & Payments (Source of Truth)

> **Scope:** the plans, the top-up packs, the quota model that decides whether a change is allowed,
> and the two provider-agnostic payment adapters (Paddle + Stripe) with their webhooks.
> **Code:** [`portal/accounts.js`](../../app/src/portal/accounts.js),
> [`portal/stripe.js`](../../app/src/portal/stripe.js), [`portal/paddle.js`](../../app/src/portal/paddle.js),
> [`api/index.js`](../../app/src/api/index.js), [`web/views/billing.js`](../../app/web/views/billing.js),
> [`web/pay.js`](../../app/web/pay.js).
> **Last verified against code:** 2026-06-03.

---

## 0. Current status (2026-06-03)
- **Code is complete and provider-agnostic.** Both Paddle and Stripe are fully wired; the active
  provider is auto-detected from whichever keys are in `app/.env`.
- **No provider is connected yet.** Billing **degrades gracefully**: plan/top-up buttons show a
  friendly "card payments switch on once checkout is connected" and the API returns
  `{configured:false}` — no errors, nothing breaks.
- **Decision pending:** the founder is undecided on **Paddle** and chose to **park payments until
  the rest of the product is tested and we're near production**. Stripe doesn't onboard Israeli
  sellers (kept for a future US-LLC path); **Paddle** (Merchant of Record) is the Israel-friendly
  option but not committed. See [CREDENTIALS_SETUP.md](../superpowers/CREDENTIALS_SETUP.md).

---

## 1. Plans (`accounts.js` `PLANS`)

| key | label | price | monthly change quota | extras |
|---|---|---|---|---|
| `starter` | Starter | $29 | 3 | |
| `pro` | Pro | $49 | 15 | |
| `premium` | Premium | $99 | ∞ (`Infinity`) | custom domain included |

`PLAN_LIST` is the ordered array the `/api/plans` endpoint serializes (with `Infinity → null` for
the wire). The billing UI marks the highest-priced tier "Recommended" — **derived from the data**, so
it stays truthful if prices change.

## 2. Top-up packs (`accounts.js` `TOPUPS`)

| key | label | changes | price | per change |
|---|---|---|---|---|
| `pack5` | 5 changes | 5 | $19 | $3.80 |
| `pack15` | 15 changes | 15 | $45 | $3.00 |

One-time purchases that add **non-expiring credits** (`accounts.extra_changes`), consumed **after**
the monthly plan quota is spent. Priced around the Pro per-unit; the bigger pack is the better value.

---

## 3. The quota model (the heart of it)

Two functions in `accounts.js`:

### `quota(db, account, monthKey)` → the current picture
```
allowance     = plan ? plan.quota : 0           // monthly plan allowance
used          = changeRequestsThisMonth(...)     // only kind='change' rows in 'YYYY-MM'
remaining     = max(0, allowance - used)         // (∞ stays ∞)
extra         = account.extra_changes            // bought credits
freeAvailable = !account.free_change_used        // the post-signup freebie
```

### `canRequestChange(db, account, monthKey)` → may they submit now?
Checked **in this priority order**:
1. **Free change** — if `freeAvailable` → `{ok:true, useFree:true}` (the post-signup carrot).
2. **Active plan quota** — if `plan_status === 'active'` and `remaining > 0` → `{ok:true}`.
3. **Top-up credits** — if `extra > 0` → `{ok:true, useExtra:true}`.
4. **Blocked** — `{ok:false, reason, needsPlan|needsTopup}`:
   - no active plan → `needsPlan` ("pick a plan or buy a change pack"),
   - active but out of quota → `needsTopup` ("buy a pack to keep going").

### The change-kind taxonomy (what each request consumes)
When a change is accepted (`POST /api/requests`), its `change_requests.kind` records which bucket
paid for it, and the right counter is decremented:

| `kind` | when | side effect |
|---|---|---|
| `free` | `useFree` | `markFreeChangeUsed(account)` (sets `free_change_used = 1`) |
| `extra` | `useExtra` | `consumeExtraChange(account)` (decrements `extra_changes`) |
| `change` | active-plan quota | nothing extra — counted by `changeRequestsThisMonth` for the month |

Only `kind = 'change'` rows count against the monthly allowance, so `free` and `extra` requests
never burn plan quota. `monthKeyOf(iso)` = the `'YYYY-MM'` prefix — the rolling monthly window.

A blocked request returns **HTTP 402** with `{needsPlan|needsTopup}`; the AI console turns that into
a "get more changes" link to `/billing` (see [06 — Portal](06-PORTAL.md)).

---

## 4. Provider selection + the public config

`config.payments.provider` is auto-detected (`config.js`): `paddle` if `PADDLE_CLIENT_TOKEN` is set,
else `stripe` if `STRIPE_SECRET_KEY` is set, else `none` (overridable via `PAYMENTS_PROVIDER`).

`payConfig(config)` in `api/index.js` exposes **only PUBLIC values** to the SPA (in `/api/me`'s
`pay`): the provider, a `ready` flag, and — for Paddle — the **client-side token**, environment, and
**price IDs** (all safe in the browser). The **API key and webhook secret are never exposed.**

---

## 5. Stripe adapter (`portal/stripe.js`) — server-created checkout

Stripe's REST API is **form-encoded + Bearer-authed**, so the prod transport is `util/net.js`
`postForm` (not `postJson`). Key-gated by `STRIPE_SECRET_KEY`.

- **`stripeCheckout(opts)`** — a **subscription** Checkout Session (`mode: subscription`). References
  a Stripe `priceId` if given, else builds an inline `price_data` line item from `PLAN_PRICES`
  (`starter 2900`, `pro 4900`, `premium 9900` cents, monthly). Stamps `client_reference_id` +
  `metadata[accountId]` + `metadata[plan]`. Returns `{url}` for a redirect.
- **`stripeTopup(opts)`** — a **one-time** Checkout Session (`mode: payment`) with
  `metadata[changes]` (drives the credit grant). Returns `{url}`.
- **`verifyWebhook(rawBody, sigHeader, secret)`** — **pure crypto, no network**. Parses
  `Stripe-Signature: t=<unix>,v1=<hex>[,v1=…]`, recomputes `HMAC-SHA256(secret, "<t>.<rawBody>")`,
  constant-time compares each `v1`. Returns the parsed event or `null`.
- **`parseSubscriptionEvent(event)`** → `{type, accountId, plan, customerId, status}` for
  `checkout.session.completed`, `customer.subscription.updated|deleted`, else `null`.

## 6. Paddle adapter (`portal/paddle.js`) — Merchant of Record, webhook-only

Paddle is a **Merchant of Record** (handles tax/VAT, pays an Israeli bank) and its checkout opens
**client-side via Paddle.js** — so there is **no server-created checkout session**. The server side
is **purely webhook verification + normalization** (pure crypto, no network):

- **`verifyPaddleWebhook(rawBody, sigHeader, secret)`** — parses `Paddle-Signature:
  ts=<unixSeconds>;h1=<hexHmac>`, recomputes `HMAC-SHA256(secret, "<ts>:<rawBody>")`, constant-time
  compares each `h1`. Returns the parsed event or `null`.
- **`parsePaddleEvent(event)`** — Paddle events are `{event_type, data:{…, custom_data}}`:
  - `subscription.activated|created|updated` → `{type:'subscription', accountId, plan, status,
    customerId}` (`custom_data` carries `accountId`+`plan`),
  - `subscription.canceled` → same with `status:'canceled'`,
  - `transaction.completed|paid` **with `custom_data.changes`** → `{type:'topup', accountId,
    changes}` (a transaction *without* `changes` is a subscription's transaction → `null`),
  - anything else → `null`.
- `PADDLE_API` holds the sandbox/production REST base URLs (kept for future server-to-Paddle calls).

---

## 7. The webhook handlers (`api/index.js`) — the source of truth for access

The server passes the **raw body** to these (signature verification needs the exact bytes).

- **`handleStripeWebhook`** — verify → then **top-up check runs BEFORE the subscription path** (a
  `mode:payment` session with `metadata.changes` → `addExtraChanges`; otherwise
  `parseSubscriptionEvent` → `setAccountPlan(active|canceled)`).
- **`handlePaddleWebhook`** — verify → `parsePaddleEvent`: `topup` → `addExtraChanges`;
  `subscription` → `setAccountPlan` (active for `active`/`trialing`, else canceled).

Routes: `POST /stripe/webhook` (header `stripe-signature`), `POST /paddle/webhook` (header
`paddle-signature`) — see [`server.js`](../../app/src/server.js).

> **Webhook = truth.** The client overlay/redirect just *starts* a payment; access (plan / credits)
> is only granted when the **verified webhook** lands. Local webhook testing needs a tunnel (ngrok)
> or the provider's "simulate" button — the provider must reach your machine.

---

## 8. The client flow (`web/views/billing.js` + `web/pay.js`)

`BillingView` renders the status card, plan cards (flagship = "Recommended"), and the top-up
section. `startPay(ctx, {key, kind, changes?})` is **provider-aware**:
- **Paddle + ready:** look up the `priceId` from `pay.prices[key]`, build `customData`
  (`{accountId, plan}` or `{accountId, changes}`), and open the Paddle overlay
  (`pay.js` `paddleCheckout` → lazy-loads `cdn.paddle.com/paddle/v2/paddle.js`, sets the env,
  `Paddle.Initialize({token, eventCallback})`, `Paddle.Checkout.open(...)` with the current theme).
- **Otherwise:** call `api.checkout(key)` / `api.topup(key)`; if a `{url}` comes back, redirect
  (Stripe); else toast the "switch on soon" message.

When the Paddle overlay fires `checkout.completed`, `pay.js` dispatches a **`sf:paid`** window event;
`app.js` listens, toasts, and re-fetches `/api/me` so the new plan/credits show. (The Stripe redirect
returns to `/billing?paid=1` or `?topped=1`, which toasts + refreshes.)

The `/api` endpoints: `GET /api/plans`, `GET /api/topups`, `POST /api/billing/checkout`,
`POST /api/billing/topup` — the last two return `{configured:false}` when no provider key is set.

---

## 9. Related docs
- [02 — Database](02-DATABASE.md) — the `accounts` quota columns + `change_requests.kind`.
- [06 — Portal](06-PORTAL.md) — the billing UI + the 402 → "get more changes" console link.
- [08 — Auth & Security](08-AUTH-AND-SECURITY.md) — webhook signature verification.
