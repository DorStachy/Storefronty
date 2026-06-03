# 06 — Portal (Source of Truth)

> **Scope:** the customer portal — the vanilla-ESM SPA, its JSON API, the AI change console, the
> dashboard, account, theming, and image upload.
> **Code (SPA):** [`app/web/`](../../app/web/) — `app.js`, `api.js`, `ui.js`, `theme.js`, `pay.js`,
> `views/{auth,dashboard,console,billing,account}.js`, `styles.css`.
> **Code (backend):** [`api/index.js`](../../app/src/api/index.js), [`server.js`](../../app/src/server.js),
> [`portal/accounts.js`](../../app/src/portal/accounts.js).
> **Last verified against code:** 2026-06-03.

---

## 1. What it is

The portal is where a shop owner lands after clicking the **account-claim link** in the reply email
(Email 2). It's a **single-page app with zero npm dependencies** (vanilla ES modules + a tiny
hyperscript helper) talking to a **zero-dependency JSON API** on the same Node server. Cookie-session
auth, full light/dark theming, and a conversational "ask the AI to change my site" console.

```
Browser (SPA, app/web) ──fetch /api/*──▶ handleApi (app/src/api/index.js) ──▶ DB + pipeline
        cookie: sf_session                returns { status, headers, body }
```

---

## 2. Serving + routing (`server.js`)

| URL | Served |
|---|---|
| `/portal/*` | SPA static assets from `app/web/` |
| `/`, `/login`, `/signup`, `/dashboard`, `/requests`, `/billing`, `/account`, `/claim/*` | the SPA shell (`index.html`) — the SPA routes internally |
| `/api/*` | the JSON API (`handleApi`) |
| `/auth/google`, `/auth/google/callback` | Google OAuth ([08](08-AUTH-AND-SECURITY.md)) |
| `/stripe/webhook`, `/paddle/webhook` | payment webhooks ([07](07-BILLING-AND-PAYMENTS.md)) |
| `/approve/*`, `/reject/*` | the signed founder-approval endpoint ([05](05-EMAIL-AND-OUTREACH.md)) |
| `/<slug>/...` | the **generated customer sites** from `app/public/` (incl. `_outbox/`) |

`PORT` defaults to **4173**. `readBody` caps request bodies at **12 MB** (image uploads). The SPA's
API base is same-origin by default; `window.STOREFRONTY_API` can point it at another host for a
static (Cloudflare Pages) build.

---

## 3. SPA architecture (`app.js`, `ui.js`)

- **Hyperscript** (`ui.js` `h(tag, props, ...children)`) builds DOM; **views are
  `function(ctx) → DOM node`** (some `async`). No framework, no build step, no virtual DOM.
- **Router** (`app.js`): `APP_ROUTES` maps `/dashboard /requests /billing /account` →
  `{title, icon, view}`. `navigate(path)` pushes history + re-renders; `popstate` re-renders.
- **Auth gate:** `/login /signup /claim/*` render `AuthView`; everything else requires a session —
  `render()` fetches `/api/me`, and on failure redirects to `/login`.
- **`ctx`** passed to every view: `{ me, api, navigate, toast, refresh }`. `refresh()` re-fetches
  `/api/me` and re-renders.
- **Shell** (`Shell`): a sidebar (brand, nav, account footer) + a topbar (mobile menu button, page
  title, the **theme toggle**, and a "View live site" button when the site is live) + the view.

### The `me` payload (`GET /api/me` → `mePayload`)
```
{ account:{id,email,plan,planStatus,freeChangeUsed},
  shop,                                   // the bound lead's name | null
  plan:{key,label,price,quota,domainIncluded} | null,
  quota:{used,remaining,allowance,extra,freeAvailable},   // Infinity → null on the wire
  site:{previewUrl,screenshots[],expiresAt,status} | null,
  pay:{provider,ready,...} }              // PUBLIC payment config only
```

### The API client (`api.js`)
Thin `fetch` wrapper (`credentials:'include'`, JSON, error-throwing). Methods: `authConfig`, `claim`,
`signup`, `login`, `logout`, `me`, `requests`, `sendRequest(payload)`, `plans`, `topups`,
`checkout`, `topup`. `sendRequest` accepts a string or `{body, images}`.

---

## 4. Auth views (`views/auth.js`)

Login / signup / claim in one `AuthView`. `/claim/<token>` calls `api.claim` to greet the user with
their shop name, then shows a signup form pre-bound to the lead. A **"Continue with Google"** button
(`googleBlock`) is injected only when `GET /api/auth/config` reports `{google:true}` — it carries any
claim token so a Google signup still binds the site. A `?err=` query (from a failed OAuth round-trip)
shows a toast. The actual auth mechanics are in [08 — Auth & Security](08-AUTH-AND-SECURITY.md).

---

## 5. Dashboard (`views/dashboard.js`) — a bento layout

- **Hero card** — time-based greeting, the shop name, the signature **orb**, a Live/Building badge
  (live shows `Live · until <date>` from the 48h expiry), and actions (Request a change / View live
  site).
- **Preview card** — a browser-chrome-framed **iframe of the live site** (falls back to the first
  cold-email screenshot, then a "being built…" placeholder).
- **Usage card** — a **conic-gradient ring** showing changes used / left this month (∞ for Premium,
  the free change counted in), plus a "Buy more changes" link and any `+N credits` badge.
- **Plan card** — current plan + price + Active badge, "Manage plan" / "Pick a plan".
- **Recent requests** — an activity timeline of the last 6 change requests (`GET /api/requests`),
  status dot + text + date, linking to the console.

---

## 6. The AI console (`views/console.js`) — the core feature

A chat surface where the owner types what they want changed in plain words; the assistant replies and
the request **re-enters the rebuild pipeline**.

- **Thread** — prior requests (`GET /api/requests`) rendered as user/AI message pairs; an empty state
  with suggestion chips ("Make the header navy", "Add my photos", …).
- **Composer** — an auto-resizing textarea (`autoResize`, 24–168px — the post-mount call fixes the
  earlier clipped-text bug), an **attach-photos** button, and send. Enter sends, Shift+Enter newlines.
  A quota line ("1 free change ready" / "N changes left" / "Unlimited").
- **Image upload** — chosen photos are **downscaled client-side** (`fileToDataUrl`: canvas resize to
  ≤ 1400px, JPEG quality 0.82) to compact data URLs, thumbnailed with a remove button, up to 5 at a
  time. Sent as `{body, images:[{name, dataUrl}]}`.
- **Send flow** — append the user message, show a typing indicator, `POST /api/requests`, then
  **typewriter-render** the assistant reply (`replyText` server-side), and update the quota line
  in place. A **402** (out of changes) renders an inline "get more changes" link to `/billing`.

### What a submit does server-side (`POST /api/requests`)
1. Reject empty (no text and no photo).
2. `canRequestChange` decides free / plan / extra / blocked (402 with `needsPlan|needsTopup`).
3. `saveImages` writes the photos under `data/uploads/<accountId>/` (so "they actually get sent to
   us" — the rebuild/founder step reads them off the change request). MIME + size capped ([08](08-AUTH-AND-SECURITY.md)).
4. Record the `change_request` (with `kind` = free/extra/change) and decrement the right counter.
5. If bound to a lead, record an `edit_request` event and transition the lead to **`replied`** — the
   next tick rebuilds (Opus) → QA → founder approval → reply email. (See [01](01-END-TO-END-FLOW.md).)

So a portal change and an email-reply change converge on the **same** rebuild pipeline.

---

## 7. Billing (`views/billing.js`)
Plan cards + top-up packs + current-status panel; `startPay` opens the Paddle overlay or the Stripe
redirect (or a graceful "switch on soon" toast). Fully covered in
[07 — Billing & Payments](07-BILLING-AND-PAYMENTS.md).

## 8. Account (`views/account.js`)
- **Profile** — email + shop, plan badge. "Change password" is disabled ("Coming soon").
- **Your site** — the live preview URL + expiry note.
- **Domain** — Premium shows a (disabled, "coming soon") domain-connect field; other plans see a
  "custom domain is included on Premium" upsell linking to billing.
- **Sign out** — `api.logout()` → `/login`.

---

## 9. Theming (`theme.js`, `ui.js`, `styles.css`)

- **Mechanism:** `document.documentElement.dataset.theme` = `light` | `dark`, persisted in
  `localStorage['sf-theme']`. The **initial value is applied by a tiny inline script in
  `index.html`** so there's no flash of the wrong theme before the app boots; `theme.js`
  (`getTheme/setTheme/toggleTheme`) flips it at runtime.
- **Toggle:** `themeToggle()` (in the topbar + auth pages) shows the icon of the theme it switches
  *to* (moon in light, sun in dark) and repaints on click.
- **Design system ("clean bright tech", approved):** a CSS-variable system in `styles.css` — light
  canvas, vivid indigo `--primary`, an iridescent `--iris` gradient, and the signature **orb**
  (`ui.js` `orb()` — conic-gradient + glossy highlight + spin) used as the AI avatar and dashboard
  hero. Dark mode (`[data-theme="dark"]`) overrides the tokens (deep navy canvas, aurora glow). All
  components are theme-correct in both modes (hardcoded colors were swept out in favor of tokens /
  `color-mix`).

---

## 10. Related docs
- [08 — Auth & Security](08-AUTH-AND-SECURITY.md) — sessions, claim, Google login, upload caps.
- [07 — Billing & Payments](07-BILLING-AND-PAYMENTS.md) — the billing view + quota.
- [01 — End-to-End Flow](01-END-TO-END-FLOW.md) — how a portal change feeds the pipeline.
- [04 — Site Builder](04-SITE-BUILDER.md) — what a change request triggers.
