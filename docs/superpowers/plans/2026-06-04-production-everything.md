# Storefronty — Production Everything (the whole customer flow, shippable)

> Overnight autonomous build. Goal: a **production-ready product** covering the entire customer flow
> start→finish, deployed to prod (Fly + Cloudflare), full test suite green, and verified by a real
> end-to-end run with the founder's Gmail as the customer. No localhost in the final state.

**Branch:** `feat/production-everything` (off `phase-1a-impl` @ `6a7a404`, which carries the wow-build).
**Merges to:** `main` after tests + Codex review + E2E pass, then deploy.

## Standing decisions (locked by the founder; do NOT re-ask)
- **Claim = trial, not ownership.** Clicking claim creates the account (Google or email) + grants **one free change** so they taste it. The site stays a **48h trial preview**. Only **buying a plan** makes it permanent. (Inverts today's signup→permanent behavior.)
- **No permanent free tier.** Starter $29 is the entry paid tier. Free = the 48h preview + register + 1 change.
- **Tiered "living site" = the upsell ladder.** Starter = calm (subtle fade-ins, no 3D, single page, self-contained). Pro = alive (scroll-reveal, smooth-scroll, tasteful CSS-3D tilt) + lead-capture form. Premium = showpiece (cinematic, real WebGL hero, catalogue, ordering form) + custom domain. **The per-customer rich site is generated only when they pay** — no per-customer preview spend.
- **Upsell via 2 generic showcase sites** (one Pro, one Premium), built ONCE, reused for all customers, served as routes on our own Fly box. **Original work** (inspired-not-copied): Pro = warm/light "Foodie" restaurant vibe; Premium = dark/cinematic "Nixtio" modern-French-dining vibe. Generic content (a demo restaurant/cafe/barber), never a customer's data.
- **"Add to Google" activation.** Dashboard card prompts the owner to paste the 48h preview URL into their Google Business Profile so real customers feel it for 48h → FOMO → convert. Expired state degrades gracefully.
- **Payments:** Paddle (Merchant of Record) is the live path. Tonight ships a **stub provider** so the full checkout→paid→permanent flow runs end-to-end with no real money; flip-to-live = add Paddle keys only.
- **Model:** Opus 4.8 (`claude-opus-4-8`) for art-direction. Live key set. (Reminder: Opus 4.8 rejects `temperature`; calls need ~90s timeout — already fixed in the wow-build.)

## Architecture deltas (grounded in the code maps)
1. **Permanence inversion** — remove `stopPreviewExpiry` from signup (api/index.js:126) + Google callback (:285). Add a shared `applyPaidPlan(db, accountId, {plan,status,customerId}, config)` that (a) `setAccountPlan`, (b) when active: `keepPreview` (KV TTL→permanent) + new `db.setSitePermanent(leadId)` (`expires_at`→NULL), (c) advances the lead `reached_pricing→paid→live`. Call it from the Stripe webhook, Paddle webhook, **and** the stub.
2. **Stub payment provider** — `config.payments.provider` gains `'stub'` (via `PAYMENTS_PROVIDER=stub`, default in dev/E2E when no real keys + `PAYMENTS_STUB=1`). `payConfig` → `{provider:'stub',ready:true,prices:{starter:'starter',...}}`. New authed endpoint `POST /api/billing/checkout` already exists — extend it: when provider is stub, call `applyPaidPlan` directly and return `{ok:true,stub:true}`. SPA `startPay` gains a stub branch → calls `api.checkout(key)` → on `{ok}` fires `sf:paid` + refresh. Top-up stub: extend `/api/billing/topup` → `db.addExtraChanges`.
3. **Tier threading** — `tier:'starter'|'pro'|'premium'` flows through the opts-bag chain: `orchestrator` → `writeSite(build2.js)` → `renderSiteV3(render.js)` → `designToCss(css.js)`; template gains backward-safe `{{leadFormHtml}}`/`{{catalogueHtml}}`/`{{orderFormHtml}}`/`{{heroCanvasHtml}}`/`{{heroScriptHtml}}` slots (empty for Starter). Tier originates from the account's plan at generation time; default `'starter'`.
4. **On-paid regeneration** — when a customer pays Pro/Premium, regenerate their site at the new tier (reuse the cached `{contract,design}` + add tier features) and re-publish permanent. Implemented as an orchestrator path keyed off the `paid`/`live` transition, or directly in `applyPaidPlan` via a `regenerateAtTier` helper. Always-ships fallback preserved.
5. **Central email safety** — add `const realTo = config.mail.testRecipient || to;` inside `sendEmail` so EVERY email is force-routed to the founder's inbox during E2E. (Belt-and-suspenders with the 3 call sites.)
6. **Showcases** — static files under `app/public/showcase-pro/` + `app/public/showcase-premium/`, served by the existing static handler at `/showcase-pro/` + `/showcase-premium/`. No server changes. Linked from billing plan cards via a new `exampleUrl` field on `PLANS` → `/api/plans` → `planCard`.
7. **Custom domain (Premium)** — `accounts` gains `custom_domain` + `domain_status`; portal Account view (already plan-gated) becomes functional: enter domain → store → show CNAME instructions → `GET /api/domain/verify` does a DNS/HTTP check. Last-mile DNS is customer-side; no registrar needed.

---

## Phase A — Claim-as-trial + permanence model  (I implement directly; coupled backend)
**Files:** `app/src/api/index.js`, `app/src/db.js`, `app/src/salesman/replyEmail.js`, `app/worker/preview.js`, tests.
- `db.js`: add `setSitePermanent(leadId)` → `UPDATE sites SET expires_at = NULL WHERE lead_id = ?` (most-recent row). Keep `setSiteLive`.
- `api/index.js`: remove the two `stopPreviewExpiry` calls (signup:126, google:285). Rename/repurpose `stopPreviewExpiry` → reused inside `applyPaidPlan` (Phase B).
- `replyEmail.js`: rewrite the claim-link copy. New framing (text + html): the live link is a **48-hour preview**; "create your account to keep editing it and get one more change free — then pick a plan to keep it live for good." Remove "saves the site to you before the 48 hours are up."
- `worker/preview.js`: expired-page CTA copy points at picking a plan (still "Claim your site" button → portal).
**Acceptance:** signup/claim no longer clears TTL; `expires_at` persists post-claim; reply-email tests updated to the trial copy; `funnel.test.js`/`reply-*.test.js` green.

## Phase B — Payment seam (stub) + pricing→paid→live  (I implement directly)
**Files:** `app/src/config.js`, `app/src/api/index.js`, `app/web/views/billing.js`, `app/web/api.js`, `app/web/app.js`, `app/src/states.js` (verify edges), tests.
- `config.js`: `payments.provider` honors `PAYMENTS_PROVIDER`; add stub auto-default: `… : (E.PAYMENTS_STUB==='1' ? 'stub' : 'none')`.
- `api/index.js`:
  - `payConfig`: add `provider==='stub'` → `{provider:'stub',ready:true,prices:{starter:'starter',pro:'pro',premium:'premium',pack5:'pack5',pack15:'pack15'}}`.
  - New `applyPaidPlan(db, accountId, {plan,status='active',customerId=null}, config)` near `stopPreviewExpiry`: `setAccountPlan` → if active: resolve `acct.lead_id` → `keepPreview(...)` + `db.setSitePermanent(lead_id)` → advance lead state toward `live` if transitionable → if plan is pro/premium, `regenerateAtTier(db, lead, plan, config)` (Phase D helper). Idempotent + never throws (wrap in try/catch, log event).
  - Refactor both webhooks' subscription branches to call `applyPaidPlan`.
  - `/api/billing/checkout`: when `config.payments.provider==='stub'`, call `applyPaidPlan(db, account.id, {plan:body.plan, status:'active'}, config)` and return `{ok:true,stub:true}`. (Real Stripe/Paddle path unchanged.)
  - `/api/billing/topup`: when stub, `db.addExtraChanges(account.id, TOPUPS[body.pack].changes)` → `{ok:true,stub:true}`.
- `billing.js` `startPay`: add stub branch (provider==='stub') → `await ctx.api.checkout(opts.key)` (or topup) → on `{ok}` `window.dispatchEvent(new CustomEvent('sf:paid'))` + toast "Plan active — your site is now permanent." (Place BEFORE the Paddle branch.)
**Acceptance:** with `PAYMENTS_STUB=1`, picking a plan activates it, makes the site permanent (`expires_at` NULL + KV kept when cloudflare), and advances the lead to `paid`/`live`; api.test.js covers stub checkout + permanence; flip-to-live unaffected (real webhooks still call `applyPaidPlan`).

## Phase C — Portal conversion surface  (I implement directly; frontend additive)
**Files:** `app/src/portal/accounts.js`, `app/src/api/index.js` (`/api/plans` + `mePayload.plan`), `app/web/views/dashboard.js`, `app/web/views/billing.js`, `app/web/views/account.js`, `app/web/ui.js` (icons), `app/web/styles.css` (only if a new class is needed), tests.
- `accounts.js` `PLANS`: add `exampleUrl` — `pro: {…, exampleUrl:'/showcase-pro/'}`, `premium:{…, exampleUrl:'/showcase-premium/'}`, `starter:{…, exampleUrl:null}` (Starter's example IS their own preview).
- `/api/plans` (api/index.js:135) + `mePayload` plan block: include `exampleUrl`.
- `billing.js` `planCard`: add a "See an example" link when `p.exampleUrl` (`target:_blank rel:noopener`, `icon('ext')`), placed under the features list.
- `dashboard.js`: add **`addToGoogleCard(ctx)`** to the `.bento-side` column (gated on `me.site?.previewUrl` AND still-trial i.e. `me.site.expiresAt`): `.card pad`, `.eyebrow` "Get more out of it", copy explaining the Google Business Profile trick, a read-only copyable field with `me.site.previewUrl`, a "Copy link" button (`navigator.clipboard`), and a muted "pick a plan before it expires to keep it live" line. Reuse the `googleG()` SVG from auth.js (lift into ui.js `icon('google')`).
- Keep existing "View live site" (topbar/hero/account) — just confirm label.
**Acceptance:** plan cards show "See an example" → showcase routes; dashboard shows the Add-to-Google card with a working copy button; dark mode correct (tokens only); existing tests green + a small dashboard/billing render test.

## Phase D — Tiered generation engine  (AGENT — complex/creative; disjoint files)
**Files:** `app/src/design/spec.js`, `app/src/design/css.js`, `app/src/builder/render.js`, `app/src/builder/build2.js`, `app/site/themes/v3/template.html`, `app/src/qa/index.js` (only if needed), NEW `app/src/design/tier.js` (tier feature/section HTML builders + vendored WebGL boot), NEW `app/public/vendor/three.module.js` (vendored, relative-src), tests. **Does NOT touch orchestrator.js / api / db** (the orchestrator wiring is mine in Phase E-wire).
- Thread `tier` through `writeSite → renderSiteV3 → designToCss` (default `'starter'`).
- `designToCss(d,{tier})`: keep Starter calm. Pro/Premium add (CSS-only, reduced-motion-safe via `@media (prefers-reduced-motion:no-preference)`): scroll-reveal keyframes for `[data-reveal]`, smooth tasteful 3D tilt on `.tile`/cards, cinematic hero treatment for Premium.
- `template.html`: add backward-safe slots `{{heroCanvasHtml}}` (inside `.hero`), `{{leadFormHtml}}`, `{{catalogueHtml}}`, `{{orderFormHtml}}` (new sections), `{{heroScriptHtml}}` (before `</body>`). Starter leaves them empty.
- `tier.js`: builders for the lead-capture form (Pro), catalogue grid + order/reservation form (Premium), and the WebGL hero (`<canvas id="hero-gl">` + a vendored relative-src Three.js boot that renders a tasteful, brand-tinted 3D hero with a **photo/gradient fallback** if WebGL/`prefers-reduced-motion`). Forms POST to a backend endpoint (stub: `/api/lead` writes a row + emails the owner via the safe mailer; can be a no-op-safe stub tonight that still renders + validates). Self-contained for KV (Starter/Pro inline; Premium served from Fly with vendored `./three.module.js`).
- QA: vendored relative-src + inline module scripts must keep `staticQa` green; if Premium needs a relaxed gate, add a `tier`-aware param (don't weaken Starter/Pro).
**Acceptance:** `writeSite(lead, contract, {design, tier:'pro'})` emits the reveal/tilt CSS + lead form; `tier:'premium'` emits the WebGL hero (with fallback) + catalogue + order form; Starter output byte-stable vs today; all three pass `staticQa` + a headless `qaCheck` (no console errors, no overflow, fallback renders under reduced-motion); new `tier-generation.test.js` green; **281 existing tests still green.**

## Phase E — 2 showcase sites  (AGENT — creative; new files only)
**Files:** NEW `app/public/showcase-pro/index.html` (+ assets), NEW `app/public/showcase-premium/index.html` (+ assets), NEW `app/test/showcase.test.js`. Served by the existing static handler — no server change.
- **Pro showcase** ("Marigold Kitchen" or similar generic): warm, light, food-forward; scroll-reveal animations, smooth scroll, tasteful CSS-3D, a lead-capture form. Polished to perfection.
- **Premium showcase** ("Maison Noir" or similar generic): dark, candle-lit, cinematic, elegant serif; a real WebGL hero (vendored Three.js, graceful fallback), a catalogue/menu grid, multi-section, an ordering/reservation form, a "custom domain" flourish.
- ORIGINAL work — channel the Awwwards/Dribbble *vibe*, never copy a specific site. Generic demo content only. Fully self-contained or vendored-relative assets. Mobile-clean, fast, accessible, reduced-motion-safe.
**Acceptance:** both routes render standalone (open in a new tab), no external scripts except vendored/inline, no console errors headless, mobile no-overflow; `showcase.test.js` asserts each file exists, contains no `{{token}}`, no `http(s)://`-`src` script, and renders key sections.

## Phase F — Custom domain flow (Premium)  (I implement directly; additive)
**Files:** `app/src/db.js` (migration + helpers), `app/src/api/index.js` (domain endpoints), `app/web/views/account.js` (functional domain card), `app/web/api.js`, tests.
- `db.js`: `ALTER TABLE accounts ADD COLUMN custom_domain TEXT` + `ADD COLUMN domain_status TEXT DEFAULT 'none'` (guarded). Helpers `setCustomDomain(accountId, domain)`, `setDomainStatus(accountId, status)`.
- `api/index.js` (authed, Premium-gated): `POST /api/domain {domain}` → validate hostname, store `pending`; `GET /api/domain/verify` → resolve DNS/HTTP for a CNAME to our host, set `verified`/`pending`; expose `domain` in `mePayload`.
- `account.js`: replace the disabled domain input with a functional one (enter domain → save → show CNAME target + "Verify" button → status badge). Non-Premium keeps the upsell.
**Acceptance:** Premium account can save a domain, sees CNAME instructions, verify endpoint returns a status; non-Premium sees the upsell; tests cover store + gate + verify-stub.

---

## Integration wiring (mine, after D lands)
- `orchestrator.js` `replied` handler: thread `tier` into `writeSite` (read the account's plan for this lead; default `'starter'` pre-purchase — previews are always Starter-calm). Add `regenerateAtTier(db, lead, plan, config)` used by `applyPaidPlan` to rebuild at Pro/Premium on purchase and re-publish permanent.
- Wire the Pro/Premium lead/order forms' POST endpoint (`/api/lead`) into `api/index.js` (safe mailer, testRecipient-guarded).

## Test + review gate (Task 15)
- Full suite: `node --test` (or `node node_modules/.../test runner`) from `app/`. All green (target: ≥ the prior 281 + new).
- Self-review (me) → **Codex adversarial review** on the diff (worktree cwd, unstaged, `MSYS_NO_PATHCONV=1`, read the `Score: N/100`). Iterate to ≥90; accept env-blocked caps per standing guidance.

## Deploy + E2E (Task 16) — production, not localhost
- **Fly backend:** set secrets (ANTHROPIC_API_KEY, SIGN_SECRET, GMAIL creds, TEST_RECIPIENT=founder Gmail, GOOGLE_*, CLOUDFLARE_*, HOSTING_ENGINE=cloudflare, PAYMENTS_STUB=1, PUBLIC/PORTAL_BASE_URL=https://storefronty.fly.dev, TICK/POLL intervals). Deploy. Verify 200 + schema + `/api/me` 401 + `/api/plans`.
- **Cloudflare worker:** confirm KV + worker live (cf-selftest).
- **E2E (founder Gmail as the customer):** seed a synthetic lead (real-ish Google data) → tick: build → screenshots → Email 1 (lands in founder Gmail) → inject a reply ("make it warm and add a patio photo") → wow-build (live Opus) → approval → Email 2 with live 48h KV link + claim + Add-to-Google hint → open the live preview over HTTPS (assert it serves) → claim (account, still trial, `expires_at` intact) → portal renders → "See an example" → showcase routes load → pick a plan (stub) → site goes permanent (TTL removed) + regenerates at tier → premium → custom-domain flow. Where a human click is otherwise required (the actual reply, the actual plan click), drive it programmatically and **label it** in the report. Verify each stage's artifacts live (DB state, KV HTTP, emails in Gmail/outbox, portal HTML).
- **Safety:** TEST_RECIPIENT forces every email to the founder; central `sendEmail` guard added; no real business is ever contacted; payments are stubbed (no real money). Prohibited actions (real charges, credentials) are never performed.

## Execution waves
1. **Wave 1 (parallel agents, background):** Phase D (engine) + Phase E (showcases) — disjoint files.
2. **Wave 2 (me, concurrent):** Phase A + Phase B backend spine.
3. **Wave 3 (me):** integrate D (orchestrator tier + regenerate), Phase C frontend, Phase F.
4. **Wave 4:** full tests, fix integration bugs (esp. live-only), Codex review, commit.
5. **Wave 5:** deploy + production E2E + verify; merge to main; final report.

## Commit discipline (overnight)
Commit at each wave/phase boundary with a clear message (resumability for an unattended long run). Final squash-free merge to `main` after E2E.
