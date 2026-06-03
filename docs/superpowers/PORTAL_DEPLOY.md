# Storefronty — Deploy & Infrastructure Guide

Cheapest reliable setup, and exactly how to ship it. Decided + built 2026-06-03.

## The shape

```
            ┌──────────────────────────────────────────────┐
  owner ──► │  Storefronty backend (ONE Node box, Fly.io)  │
            │   • portal SPA  (/, /login, /dashboard, …)    │
            │   • JSON API    (/api/*)  + Stripe webhook    │
            │   • the site-building pipeline (Playwright)   │
            │   • the 48h customer preview sites (/<slug>/) │
            │   • SQLite on a Fly volume  (/data)           │
            └──────────────────────────────────────────────┘
```

**v1 = one box serves everything.** Simplest + cheapest to launch (~$5/mo). The pipeline needs a real
browser (Playwright) + persistent SQLite, so it can't be pure edge — one small always-on Node box is the
right tool. The SPA, API, webhooks, and the preview sites are all the same Node server (verified end-to-end).

**Later optimization (optional):** move the static SPA (`app/web/`) to **Cloudflare Pages** (free) and point it
at the API with `window.STOREFRONTY_API="https://api.yourbrand.com"`. The only change is the asset path prefix
in `index.html` (`/portal/…` → `/…`) and a `_redirects` rule `/* /index.html 200`. Not needed to launch.

## Deploy the backend (Fly.io)

From `app/`:

```bash
fly launch --no-deploy            # creates the app from fly.toml (pick a name/region)
fly volumes create sf_data --size 1
fly secrets set \
  SIGN_SECRET="$(openssl rand -hex 32)" \
  GMAIL_USER=... GMAIL_APP_PASSWORD=... \
  GOOGLE_PLACES_KEY=... SERPER_API_KEY=... \
  GEMINI_API_KEY=...        # optional: richer AI copy (else truthful deterministic fill) \
  ANTHROPIC_API_KEY=...     # optional: Opus reply rebuilds \
  STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=...   # optional: live payments
fly deploy
```

Then set `PUBLIC_BASE_URL` / `PORTAL_BASE_URL` in `fly.toml` to your real domain (or the `*.fly.dev` URL)
and `fly deploy` again — the cold/reply emails and claim links use those.

**Stripe webhook:** in the Stripe dashboard, add an endpoint → `https://<your-domain>/stripe/webhook`,
copy its signing secret into `STRIPE_WEBHOOK_SECRET`.

## The 48h preview sites (Cloudflare KV — free, built)

Each built site is published as one self-contained HTML to **Cloudflare KV** with a native 48h TTL
(auto-expires, no cleanup), served by a tiny Worker at `…workers.dev/<slug>/`. Free, no domain needed;
when the owner signs up the TTL is dropped and the site becomes permanent. **One-time setup:
[`app/worker/README.md`](../../app/worker/README.md).** Backend env: `HOSTING_ENGINE=cloudflare` +
`CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` (Workers KV Edit) / `CLOUDFLARE_KV_NAMESPACE_ID` /
`CLOUDFLARE_PREVIEW_HOST`. (`HOSTING_ENGINE=local` still serves previews from the box for dev.)

## Custom domains for customers (Premium)

Register on **Porkbun** (API, cheap, markup allowed) + attach via **Cloudflare for SaaS** custom hostnames
(100 free). Set `PORKBUN_API_KEY` / `PORKBUN_SECRET`. (Wired in the Account → Domain section's seam.)

## Reply polling (IMAP)

Replies are fed via the CLI today (`npm run cli reply`). For live Gmail IMAP polling, install once:
`cera install-package --ecosystem npm --package imapflow` (the `inbox.poll()` path lazy-loads it).

## Local dev

```bash
cd app
node --experimental-sqlite --test     # the whole suite (212+)
npm run serve                         # http://localhost:4173  (SPA + API + sites)
```

## Cost summary

| | |
|---|---|
| Fly.io shared-cpu-1x (1GB) always-on | ~$5/mo |
| SQLite (Fly volume 1GB) | ~$0.15/mo |
| Cloudflare Pages (if you split the SPA) | $0 |
| 48h preview Workers | <$0.01 each |
| **Fixed total** | **≈ $5/mo** |
