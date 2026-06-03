# 00 — System Overview (Source of Truth)

> **This is the index.** Storefronty is an autonomous cold-outreach + site-building system for US
> local businesses that have **no website**. This doc set documents **what the code actually does**
> (verified against source on 2026-06-03), not the original design plan.
> **Anchors:** [`ARCHITECTURE.md`](../../ARCHITECTURE.md) (original design), [`app/README.md`](../../app/README.md).

---

## The doc set

| # | Doc | Covers |
|---|---|---|
| 00 | **this** | the mental model, tech stack, module map, how to run, status |
| 01 | [End-to-End Flow](01-END-TO-END-FLOW.md) | the one canonical narrative — discovery → live portal customer |
| 02 | [Database](02-DATABASE.md) | every table, the helper API, the lead state machine |
| 03 | [Researcher & Discovery](03-RESEARCHER-AND-DISCOVERY.md) | finding no-website shops; identity-anchored verification |
| 04 | [Site Builder](04-SITE-BUILDER.md) | lead → themed site; the content contract, fill, QA, screenshots, deploy |
| 05 | [Email & Outreach](05-EMAIL-AND-OUTREACH.md) | the two emails, reply reading + classification, approval, CAN-SPAM |
| 06 | [Portal](06-PORTAL.md) | the SPA, the AI change console, dashboard, account, theming |
| 07 | [Billing & Payments](07-BILLING-AND-PAYMENTS.md) | plans, quota, top-ups, Stripe + Paddle |
| 08 | [Auth & Security](08-AUTH-AND-SECURITY.md) | signed tokens, sessions, Google OAuth, SSRF, escaping |

---

## 1. What it does (the product, in one pass)

> Find a shop with no website → build it a real, tailored site from its **own Google data** →
> email the owner **screenshots** (no link yet) → when they reply asking for a tweak, **rebuild**
> it with their change → (founder approves) → email back the **live 48h site** + a **signed
> account-claim link** → they sign up → a **portal** where they ask an AI for more changes →
> **billing** (plans + top-ups) funds ongoing changes.

The funnel was deliberately designed to **earn the reply before revealing a live link** — the cold
email carries screenshots; the working link only follows a real reply.

## 2. The mental model — an assembly line

Each capability is an **independent module** with a typed input → output. Modules **never call each
other**; they read/write a shared **SQLite database** (the single source of truth), and an
**orchestrator** state machine advances each lead one stage per "tick." That's what makes it
testable locally and liftable to the cloud (swap a provider behind a config flag, not a rewrite).

```
        ┌──────────────────────── ORCHESTRATOR (state machine, src/orchestrator.js) ────────────────────────┐
        │  each tick: for each lead in an actionable status, run its handler, advance it along an allowed edge │
        └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 RESEARCHER → BUILDER → (SCREENSHOT) → SALESMAN →  (wait)  → INBOX → CLASSIFIER → EDITOR → (APPROVE) → SALESMAN → PORTAL
 find no-site  build from   3 section    cold email          read    tag intent   Opus      founder      reply w/   ongoing AI
 shops         Google data  screenshots  (no link)           reply   + change     rebuild   (review)     live+claim  changes + billing
```

A single **`MODE`** switch governs the human-in-the-loop: **`review`** (the founder approves every
customer-facing send) vs **`auto`** (sends fire automatically; internal steps are always automatic).

## 3. Tech stack

- **Runtime:** Node (built for ≥ 22; this machine runs **Node 25**). **Near-zero dependencies** — the
  spine uses only built-ins: `node:sqlite` (DB), `node:crypto` (HMAC/scrypt), global `fetch`,
  `node:test`. The only runtime deps are **`nodemailer`** (SMTP, lazy) and **`playwright`** (QA +
  screenshots; `imapflow` is lazy-imported for live IMAP).
- **Portal SPA:** vanilla ES modules + a tiny hyperscript helper — **no framework, no build step**.
- **Data:** one SQLite file (`app/data/storefronty.db`, WAL).
- **DI everywhere:** every module takes its `db` + config as args and injects its transports, so each
  is unit-testable offline (the test suite needs no keys).

## 4. Module map (actual code → doc)

| Path | Role | Doc |
|---|---|---|
| `src/orchestrator.js`, `src/states.js` | the tick + per-status handlers + the state machine | [02](02-DATABASE.md), [01](01-END-TO-END-FLOW.md) |
| `src/db.js` | SQLite data layer (single source of truth) | [02](02-DATABASE.md) |
| `src/config.js` | `.env` loader + typed config | here |
| `src/cli.js` | the command-line entry | here |
| `src/server.js` | the HTTP server (portal + API + webhooks + sites) | [06](06-PORTAL.md) |
| `src/researcher/`, `src/discovery/`, `src/search/`, `src/socials/`, `src/email/`, `src/sweep/` | find no-website shops + verify identity + contact | [03](03-RESEARCHER-AND-DISCOVERY.md) |
| `src/builder/`, `src/contract/`, `src/themes/`, `src/fill/`, `src/qa/`, `src/screenshot/`, `src/deployer/` | lead → themed site → QA → screenshots → deploy | [04](04-SITE-BUILDER.md) |
| `src/salesman/`, `src/mailer/`, `src/inbox/`, `src/classifier/`, `src/approval/`, `src/notifier/` | the two emails, replies, approval | [05](05-EMAIL-AND-OUTREACH.md) |
| `src/portal/accounts.js`, `src/api/index.js`, `app/web/` | accounts, quota, the JSON API + the SPA | [06](06-PORTAL.md) |
| `src/portal/stripe.js`, `src/portal/paddle.js` | payment adapters | [07](07-BILLING-AND-PAYMENTS.md) |
| `src/auth/google.js`, `src/util/sign.js` | Google OAuth, signed tokens | [08](08-AUTH-AND-SECURITY.md) |
| `src/util/net.js`, `src/util/html.js`, `src/util/text.js` | SSRF-safe fetch, escaping, identity text helpers | [08](08-AUTH-AND-SECURITY.md), [03](03-RESEARCHER-AND-DISCOVERY.md) |

## 5. Directory layout

```
app/
  src/            the pipeline + API + server (above)
  web/            the portal SPA (app.js, api.js, ui.js, theme.js, pay.js, views/, styles.css)
  site/themes/    editorial | luxe | bold — each a template.html + theme.css
  public/         generated customer sites (<slug>/index.html), shots/, _outbox/ (dry-run email)
  data/           storefronty.db + uploads/ (gitignored)
  test/           node:test suites
  e2e.mjs         standalone Playwright end-to-end
docs/source-of-truth/   ← you are here
```

## 6. How to run (CLI — `app/package.json` scripts)

```bash
cd app
cp .env.example .env          # then fill in keys (all optional — everything degrades gracefully)

npm run init                  # create / migrate the database
npm run research -- --city "Austin, TX" --niche barbershop --limit 10 [--engine mock|places]
npm run cli sweep -- --niches "barbershop,nail salon" --cities "Round Rock, TX" --want 3
npm run cli socials -- <leadId> | --all
npm run tick                  # advance every actionable lead one stage
npm run leads                 # list leads + status counts
npm run lead <id>             # one lead + its full event history
npm run serve                 # the portal + API + sites on http://localhost:4173
npm test                      # the unit suite (no keys needed)
npm run e2e                   # the standalone Playwright end-to-end
```

## 7. The config switches (`src/config.js`, all via `app/.env`)

Each provider is chosen by config, so flipping mock→real or local→cloud is editing `.env`, not code.
**Everything is key-gated and degrades gracefully** — no key just means the offline/dry/deterministic
path.

| Concern | Off / default | Turns on with |
|---|---|---|
| Researcher engine | `mock` (offline fixtures) | `RESEARCHER_ENGINE=places` + `GOOGLE_PLACES_KEY` |
| Web search (discovery/socials/email) | off (Places-only) | `SERPER_API_KEY` *or* `SERPAPI_KEY` |
| Fresh-build copywriting | deterministic | `GEMINI_API_KEY` (Gemini 2.5 Flash-Lite) |
| Reply-edit copywriting | deterministic | `ANTHROPIC_API_KEY` (Claude Opus) |
| Sending mail | `dry` (writes `public/_outbox/`) | `GMAIL_USER` + `GMAIL_APP_PASSWORD` (+ `TEST_RECIPIENT`) |
| Reading replies | CLI/simulated | same Gmail creds (IMAP) |
| Approval mode | `review` (founder approves) | `MODE=auto` |
| Hosting | `local` | `HOSTING_ENGINE=cloudflare` + Cloudflare creds |
| Payments | `none` (graceful) | Paddle (`PADDLE_*`) or Stripe (`STRIPE_*`) |
| Google login | off (button hidden) | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` |
| Signing secret | dev placeholder ⚠️ | `SIGN_SECRET` (**must set in prod**) |

## 8. Status (2026-06-03)

**Built & working:** the full pipeline (research → build → screenshot → cold email), the reply
loop (inbox → classify → Opus rebuild → QA gate → founder approval → reply email with live + claim
links), and the **portal** (claim/signup/login, dashboard, AI change console with image upload,
account, quota + plans + top-ups). **Google login** is wired and verified up to Google's consent
screen. Provider-agnostic **Stripe + Paddle** are fully coded.

**Parked / pending:**
- **Payments** — code complete but the founder parked the provider decision (Paddle undecided) until
  the product is tested and near production. [07](07-BILLING-AND-PAYMENTS.md).
- **Google sign-in** — blocked on a Google Console `redirect_uri_mismatch`; `http://localhost:4173/auth/google/callback`
  was added and is propagating. [08](08-AUTH-AND-SECURITY.md).
- **Cloudflare hosting** — adapter stubbed; needs `CLOUDFLARE_API_TOKEN`. [04](04-SITE-BUILDER.md).
- **`reached_pricing → paid → live`** tail — states exist; the paid→live automation is future work.

## 9. Cross-cutting principles
- **Identity over name** — discovery only accepts a site/handle/email corroborated by
  location-unique signals (phone, ZIP, Google place_id). [03](03-RESEARCHER-AND-DISCOVERY.md)
- **A site always ships** — every LLM path falls back to the deterministic fill. [04](04-SITE-BUILDER.md)
- **Webhook = truth** — payments grant access only on the verified webhook. [07](07-BILLING-AND-PAYMENTS.md)
- **Earn the reply** — screenshots first, live link only after a reply. [05](05-EMAIL-AND-OUTREACH.md)
- **Signed, escaped, SSRF-checked** — stateless trust is HMAC-signed, output is escaped, egress is
  private-IP-guarded. [08](08-AUTH-AND-SECURITY.md)
- **Human-in-the-loop** — `review` mode gates every customer-facing send. [05](05-EMAIL-AND-OUTREACH.md)
