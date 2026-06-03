# Storefronty Portal — Real SaaS (Architecture + Design Spec)

**Status:** Building (2026-06-03 overnight, autonomous). Supersedes the server-rendered portal stub (`app/src/portal/index.js` HTML pages) — the backend logic (accounts, quota, Stripe, sessions, pipeline) is reused; the UI becomes a real SPA.

**Goal:** A high-end, sharp, AI-native customer portal where a local-business owner manages their site: previews it, talks to an AI to request changes, picks a plan, pays, and manages billing — feeling like a real, premium product.

---

## 1. Infrastructure (cheapest reliable — decided)

| Layer | Choice | Why | Cost |
|---|---|---|---|
| **Frontend (SPA)** | Cloudflare Pages | Static, global CDN, SSL, custom domain, instant rollbacks | $0 |
| **Backend (API + pipeline + Playwright + DB)** | One small Node box (Fly.io shared-cpu-1x) | The pipeline needs a real browser (Playwright) + persistent SQLite — impossible on pure edge | ~$5/mo |
| **DB** | SQLite on a Fly volume; Litestream → Cloudflare R2 backups | Cheapest durable store; we already use `node:sqlite` | ~$0 |
| **48h preview sites** | Cloudflare Workers + KV TTL | One wildcard cert, expiry = KV TTL, form runs in the Worker | <$0.01 each |
| **Email** | Gmail SMTP now → Resend/SES later | Already working | ~$0 |

**Total fixed ≈ $5/mo.** The frontend and backend deploy independently; the SPA talks to the API over HTTPS (`API_BASE` env at build time; same-origin in local dev).

## 2. Stack (decided)

- **Frontend:** vanilla ES-modules SPA, **zero npm dependencies.** A ~100-line reactive/component helper (`ui.js`), a hash-or-history router, an API client (`api.js`), and a sharp custom **design system** (`styles.css`). Deliberately dependency-free: faster, cheaper to host, and **zero supply-chain surface** (the product's whole thesis). The three site themes prove vanilla can be high-end.
- **Backend:** the existing zero-dep Node service exposes a **JSON API** (`/api/*`) reusing `accounts.js` / `stripe.js` / the orchestrator pipeline. Auth = the existing signed HTTP-only cookie (`util/sign.js`). The Node server also serves the SPA static files in local/single-box mode.

## 3. Design language (high-end, sharp, warm-but-product)

Editorial-meets-product. The owners are local-business people, not developers — so it's **warm, confident, and calm**, not a techy dark dashboard. Brand palette carried in: `--bone #FAF6EF` canvas, `--espresso #2B2018` ink, `--terracotta/#C0623E` + `--rust #8C3F22` accents, `--gold #C9A24B` hairlines. Type: **Fraunces** (display, headings) + **Inter** (UI/body) — same as the brand. Generous whitespace, a refined left **sidebar** nav, soft cards, crisp focus states, tasteful motion (page transitions, the AI console's typing reveal). Mobile-first responsive. AA contrast.

## 4. The sections

1. **Auth** — `/claim/<token>` (signed, pre-bound "create your account for {Shop}"), `/login`, `/signup`. Sharp, minimal, trustworthy.
2. **Dashboard** — the shop's **live site preview** (responsive iframe of the built site + the 3 screenshots), site status (live / 48h countdown), plan + remaining changes at a glance, quick "request a change" entry.
3. **AI request console** (the centerpiece) — a Gemini-style conversation. The owner types what they want ("make the header navy, add my patio photos, we close at 7 now"); it appears as a message; the assistant **responds conversationally** (LLM when keyed, an intelligent templated reply otherwise) with a typing reveal, confirms what it'll change, and the request enters the rebuild pipeline. Shows the live "rebuilding… → ready" status and a history of past requests. Quota-aware (the one free change first, then the plan).
4. **Billing & plans** — sharp plan cards (Starter $29 / Pro $49 / Premium $99 · 3/15/∞ changes · Premium = domain), current plan + usage, Stripe checkout, manage/cancel.
5. **Account** — email, password, domain (when on Premium), sign out.

## 5. API contract (JSON, cookie-auth)

```
POST /api/auth/claim      { token }                 -> { shop:{name}, valid }
POST /api/auth/signup     { email, password, token }-> set-cookie; { account }
POST /api/auth/login      { email, password }       -> set-cookie; { account }
POST /api/auth/logout                               -> clear cookie
GET  /api/me                                        -> { account, plan, quota, site:{previewUrl,screenshots,expiresAt,status} }
GET  /api/requests                                  -> { requests:[{id,body,reply,status,createdAt}] }
POST /api/requests        { body }                  -> { request, reply, quota }   (quota-checked; re-enters pipeline)
GET  /api/plans                                     -> { plans:[...] }
POST /api/billing/checkout{ plan }                  -> { url } | { configured:false }
POST /api/stripe/webhook   (raw)                    -> 200
```
All non-auth routes require the session cookie → 401 otherwise. Untrusted output escaped; quota enforced server-side (never trust the client).

## 6. Testing

- Unit (node:test): API handlers (auth, me, requests/quota, checkout-gating, webhook) — offline, in-memory DB.
- **E2E (Playwright):** boot the Node server, drive a real browser through claim → signup → dashboard → submit an AI request (see the reply + the lead re-enter the pipeline) → open billing → checkout fallback. Browser-skip-guarded.

## 7. Deploy

- `app/web/` builds to static (no build step — it's ES modules) → Cloudflare Pages (`API_BASE` injected). 
- Backend → Fly.io: `Dockerfile` (Node 22 + Playwright chromium) + `fly.toml` + a volume for SQLite. Env: all the keys from the morning report.
- Docs: `docs/superpowers/PORTAL_DEPLOY.md` with exact commands.

---

## 8. Build order

1. Design system (`styles.css`) + SPA shell (`index.html`, `ui.js`, `api.js`, `app.js`) + auth views — establishes the bar + contracts. *(me)*
2. Backend JSON API (`src/api/index.js`) + server wiring (serve SPA + `/api/*`). *(me)*
3. Sections (against the established design + API): dashboard+preview, **AI console**, billing, account. *(agents, I integrate + browser-verify)*
4. E2E Playwright + deploy config + docs. *(me)*

Reuses: `accounts.js`, `stripe.js`, `db.js`, `orchestrator` (handleReply/pipeline), `sign.js`, `screenshot`. Keeps `npm test` green; commit per slice.
