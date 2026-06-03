# 08 — Auth & Security (Source of Truth)

> **Scope:** the cross-cutting security model — HMAC-signed tokens, cookie sessions, password
> hashing, Google OAuth, SSRF-safe egress, output escaping, and webhook signature verification.
> **Code:** [`util/sign.js`](../../app/src/util/sign.js), [`util/net.js`](../../app/src/util/net.js),
> [`util/html.js`](../../app/src/util/html.js), [`auth/google.js`](../../app/src/auth/google.js),
> [`portal/accounts.js`](../../app/src/portal/accounts.js), [`api/index.js`](../../app/src/api/index.js),
> [`approval/index.js`](../../app/src/approval/index.js).
> **Last verified against code:** 2026-06-03.

---

## 1. The model in one line

> **Anything stateless that must be trusted is HMAC-signed; anything rendered is escaped; anything
> fetched is SSRF-checked.** No third-party auth dependency — Node `crypto` built-ins only.

---

## 2. Signed tokens (`util/sign.js`)

The whole trust model rests here. `signToken(payload, secret)` → `base64url(JSON).HMAC` where the
signature is `HMAC-SHA256(base64url(JSON), secret)` (base64url). `verifyToken(token, secret)`
recomputes the HMAC, **constant-time compares** (`timingSafeEqual`, length-guarded), and only then
parses the payload — returns `null` on any tampering. A forged or edited token can't verify.

> ⚠️ The signing secret is `config.signSecret` (`SIGN_SECRET` env). It defaults to
> **`'dev-sign-secret-change-me'`** — a dev placeholder. **It MUST be set to a strong random value
> in production**; every session, claim, approval, and OAuth-state token is only as safe as this
> secret.

### Token kinds (the `kind` field namespaces them)
`verifyToken` callers always check `kind`, so a token minted for one purpose can't be replayed for
another.

| kind | payload | minted by | used by |
|---|---|---|---|
| `claim` | `{leadId, kind:'claim'}` | `salesman/replyEmail.claimUrl` | `/claim/<token>`, signup, Google state |
| `approve` / `reject` | `{leadId, kind}` | `notifier.approvalUrls` | `approval.handleApproval` (POST-only) |
| `gstate` | `{n, claim, kind:'gstate'}` | `handleGoogleStart` | `handleGoogleCallback` (CSRF) |
| *(session)* | `{accountId}` | `sessionCookie` | the `sf_session` cookie |

---

## 3. Sessions (`api/index.js`)

A logged-in browser carries an **`sf_session`** cookie = `signToken({accountId}, secret)`. Set with
`Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000` (30 days). `sessionAccount(db, cookies, config)`
verifies it and loads the account; an unauthenticated `/api/*` (authed section) returns **401**.
Logout sends `clearCookie()` (`Max-Age=0`). `safeAccount(a)` is the only account shape sent to the
client — `{id, email, plan, planStatus, freeChangeUsed}` — never the password hash or
`stripe_customer`.

---

## 4. Passwords (`portal/accounts.js`)

`hashPassword` = **scrypt**, stored as `saltHex:hashHex` (16-byte random salt, 32-byte hash).
`verifyPassword` re-derives with the stored salt and **constant-time compares** (`timingSafeEqual`).
`createAccount` validates: a well-formed email, password ≥ 8 chars, and a unique email. **Google-only
accounts have a `null` password_hash** and can never pass `verifyPassword`.

---

## 5. Google OAuth (`auth/google.js` + the API handlers)

Server-side **Authorization Code** flow (no browser-exposed secret):

1. **Start** (`handleGoogleStart`, route `/auth/google`): mint a signed `gstate` token (a nonce + any
   carried `claim` token) as the OAuth `state`, then 302 to `googleAuthUrl(...)` —
   `accounts.google.com/o/oauth2/v2/auth` with scope `openid email profile`, `access_type=online`,
   `prompt=select_account`. The **`redirect_uri`** is `<portalBaseUrl>/auth/google/callback`.
2. **Callback** (`handleGoogleCallback`, route `/auth/google/callback`):
   - **CSRF:** `verifyToken(state)` must be a valid `gstate`, and a `code` must be present, else
     redirect `/login?err=google`.
   - `googleLogin({code, redirectUri, clientId, clientSecret})` → `exchangeCode` POSTs to
     `oauth2.googleapis.com/token` (the **client secret** travels here, server→Google, never the
     browser) → `parseIdToken` reads the profile.
   - Find/create the account **by email**; if new, bind it to the `claim`'s `leadId` (so a Google
     signup still attaches to the lead's site) with `authProvider:'google'`, `passwordHash:null`.
   - Set the `sf_session` cookie and 302 to `/dashboard`.

> **Security note — `parseIdToken` DECODES, does not verify, the id_token signature.** That is safe
> **only** here because the id_token is received **directly from Google's token endpoint over TLS**
> in the Authorization Code flow — there is no untrusted intermediary, so no JWKS check is needed. Do
> NOT reuse `parseIdToken` on an id_token that arrived via the browser (implicit/front-channel) —
> that requires full signature + issuer + audience verification.

**Config gotcha (live):** the `redirect_uri` we send must be registered **exactly** in the Google
Console's *Authorized redirect URIs*, or Google returns `Error 400: redirect_uri_mismatch` before
sign-in. (We hit this on 2026-06-03: `http://localhost:4173/auth/google/callback` had to be added.)
A new OAuth app in "Testing" status also only admits listed **test users**.

---

## 6. The account-claim flow

The reply email (Email 2) carries a signed `/claim/<token>` link. The token binds a *future* account
to a *specific* lead's site — so signing up *through it* needs no "find your site" step:
- `POST /api/auth/claim` validates the token and returns the shop name (to greet the user).
- `POST /api/auth/signup` re-validates the claim token and passes its `leadId` to `createAccount`.
- Google signup carries the claim token inside the `gstate`, so it binds the same way.

A change submitted in the portal re-enters the pipeline: it records an `edit_request` event on the
bound lead and transitions it to `replied` (→ rebuild → QA → approval). See [01 — Flow](01-END-TO-END-FLOW.md).

## 7. Signed approve/reject endpoint (`approval/index.js`)

`/approve/<token>` and `/reject/<token>` carry a signed `{leadId, kind}`. **State changes only on
POST** — a `GET` shows a confirm page whose button POSTs (so a link-prefetch or crawler can't
approve anything). The action only fires when the lead is still `pending_approval`. See
[05 — Email & Outreach](05-EMAIL-AND-OUTREACH.md) §7.

---

## 8. SSRF-safe egress (`util/net.js`)

**Every outbound request the system makes** goes through these — never bare `fetch`:

- **`safeFetch`** (discovery page fetches, email/socials scraping): blocks any hostname that resolves
  to **private / loopback / link-local / CGNAT** ranges (IPv4 + IPv6, incl. IPv4-mapped), follows
  redirects **manually, re-validating every hop** (`redirect:'manual'`), enforces a scheme allowlist
  (`http`/`https` only), and caps body size (1.5 MB) + time (8 s). Returns a result object, never
  throws.
- **`postJson`** (LLM calls — Gemini fill, Opus edit): same private-IP guard + timeout + body cap,
  JSON body/reply, no redirect-following. Throws on failure so callers fall back deterministically.
- **`postForm`** (Stripe REST — form-encoded + Bearer): same guard, `application/x-www-form-urlencoded`
  body, JSON reply.

> **Accepted limitation:** a residual DNS-rebinding TOCTOU window exists (resolve-then-connect).
> Acceptable for probing public business sites and far safer than `redirect:'follow'` to
> attacker-derived domains.

---

## 9. Output escaping (XSS / email-injection) (`util/html.js`)

Lead fields (name, address, etc.) come from Google and the LLM — **untrusted**. Every value
interpolated into a generated **site** ([render.js](../../app/src/builder/render.js)) or an outbound
**email** ([salesman](../../app/src/salesman/), [notifier](../../app/src/notifier/index.js),
[approval](../../app/src/approval/index.js)) passes through:
- **`escapeHtml`** — escapes `& < > " '`.
- **`safeUrl`** — allows only `http: / https: / tel: / mailto:` hrefs; anything else (e.g.
  `javascript:`) is neutralized to `#`.

The content contract's *shape* is validated but its string *values* are treated as untrusted at
render time — defense in depth.

---

## 10. Webhook signature verification (recap)

Both payment webhooks verify with **pure crypto over the raw body** (no network), constant-time,
length-guarded:
- **Stripe:** `Stripe-Signature: t=<unix>,v1=<hex>` → `HMAC-SHA256(secret, "<t>.<rawBody>")`.
- **Paddle:** `Paddle-Signature: ts=<unix>;h1=<hex>` → `HMAC-SHA256(secret, "<ts>:<rawBody>")`.

The server must hand the **exact raw bytes** (the routes read the raw body before JSON parsing). See
[07 — Billing & Payments](07-BILLING-AND-PAYMENTS.md). *No timestamp-tolerance/replay check yet* —
noted in the code as a future addition.

---

## 11. Other safeguards
- **Suppression list** — checked before every send, forever ([05](05-EMAIL-AND-OUTREACH.md)).
- **Image upload caps** — data-URL MIME allowlist (`jpeg/png/webp/gif`), ≤ 6 MB/image, ≤ 6 images,
  written under `data/uploads/<accountId>/` (`data/` is gitignored). See `saveImages` in `api/index.js`.
- **Idempotency** — the salesman won't re-send `email1`; `setStatus` is transition-checked.
- **Secrets** — live in `app/.env` (gitignored). Never echoed to chat or logs. Provider keys, Gmail
  app password, `SIGN_SECRET`, API keys all belong there.

## 12. Production checklist (security)
- [ ] Set a strong random `SIGN_SECRET` (not the dev default).
- [ ] Register the exact OAuth `redirect_uri`; move the consent screen out of "Testing" (or add test
      users) before inviting real users.
- [ ] Connect a payment provider's webhook over a public HTTPS endpoint; consider adding webhook
      timestamp-tolerance.
- [ ] Confirm `data/` (DB + uploads + outbox) stays out of version control and off any public path.

## 13. Related docs
- [06 — Portal](06-PORTAL.md) — where sessions + Google login are used in the SPA.
- [07 — Billing & Payments](07-BILLING-AND-PAYMENTS.md) — webhook handlers.
- [03 — Researcher & Discovery](03-RESEARCHER-AND-DISCOVERY.md) — `safeFetch` in the wild.
