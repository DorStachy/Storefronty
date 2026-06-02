# Storefronty — Overnight Build Report

**Run:** 2026-06-03 overnight, autonomous (orchestrator + multi-agent + self-verified).
**Branch:** `phase-1a-impl` (will rename/PR at the end).
**Mandate:** finish the plan, build + test + verify everything end-to-end, production-ready by morning — only external credentials/domains left for the founder.

> This doc is the live tracker. It is updated continuously through the night. The **Status board** and
> **What I need from you** sections are the two to read first when you wake up.

---

## Status board

| Plan / Phase | What it is | Status |
|---|---|---|
| **1A** Fill→render core + Editorial theme | contract · deterministic fill · niche map · Editorial theme · renderer · buildSiteV2 | ✅ DONE — browser-verified |
| **1B** Cheap-fill adapter (Gemini) | grounding fact-sheet + Gemini REST adapter (key-gated) + anti-hallucination + fake | ✅ DONE — 19 tests; deterministic until you add `GEMINI_API_KEY` |
| **1C** Luxe + Bold themes | two more themes on the same slot contract | ✅ DONE — both browser-verified, AA-checked |
| **1D** Playwright screenshotter | headless render → 3 section screenshots for the email | ✅ DONE — real browser smoke |
| **1E** Per-niche cold email | approved §5.6 copy + per-niche variants, 3 inline screenshots, CAN-SPAM | ✅ DONE — assembled email eyeballed |
| **1F** Pipeline wiring + real send | orchestrator: fill→build→screenshot→email; real end-to-end cold-pitch send | ✅ DONE — **real send verified** (see below) |
| **2** Reply → Opus → hosted 48h | classify · Opus rebuild · QA gate · signed approval · 48h deploy · 2-link reply email | ✅ DONE — full loop tested (189/189); Opus/Cloudflare/IMAP are key-gated seams |
| **3** Portal (sell + take money) | claim-binding · accounts/auth · plans/quota · Stripe · dashboard | ⏳ in progress |

Phases 4–7 (volume, marketing site, tier polish, autonomy) are outlined in the design spec; they depend on
real sending infra + accounts and are scoped for after launch.

### ✅ PHASE 1 COMPLETE — the wow demo + the cold pitch works end-to-end

The whole top of the funnel runs: a no-website shop → a gorgeous **theme-matched** demo built from its **real
Google data** (barber→Luxe dark/gold, café/salon→Editorial warm, food-truck/gym→Bold electric) → **3 section
screenshots** → a **personal, hand-typed cold email** (approved §5.6 copy, no emojis, no link) with those
screenshots attached. **166/166 tests pass.** I ran one **real SMTP send** of Silva's themed demo through the
exact production orchestrator — it landed in your test inbox `1dorlove1@gmail.com` (`dry:false`, messageId
returned). The real shop is never emailed (TEST_RECIPIENT override). Three themes + the email were verified by
me in the browser; screenshots are in the transcript.

### ✅ PHASE 2 COMPLETE — the reply loop (build it, gate it, host it, hand it off)

When an owner replies: rules-based compliance first (opt-out → instant suppression; angry/legal → your queue),
otherwise it's an edit. The site is **rebuilt** applying their words (Opus when `ANTHROPIC_API_KEY` is set, a
truthful deterministic rebuild otherwise — with edit-aware grounding so an owner *can* correct a fact but the
model can't silently change one they didn't), passed through a **Playwright QA gate** (no broken links/images,
no console errors, mobile-safe), then it waits for your **✅ on a signed, POST-only approve/reject link** (review
mode). On approve it deploys for **48h** (local stub now; Cloudflare Workers seam ready) and sends the
**two-link reply email** (the live site + a tamper-proof account-claim link that pre-binds the new account to
his site). Cred-gated pieces (Opus, Cloudflare, IMAP polling) fall back gracefully and are flagged below.

---

## What I need from you (the only things not buildable overnight)

These gate **going live**, not building. Everything is built + tested to run the moment these land.

- [ ] **Gemini API key** → cheap-fill + reply classification + (later) imagery. Put in `app/.env` as `GEMINI_API_KEY=`.
- [ ] **Anthropic API key** → the Opus reply-build adapter. `ANTHROPIC_API_KEY=`.
- [ ] **US LLC + Stripe** (doola/Firstbase) → real payments + the CAN-SPAM postal address that replaces the `.env` placeholder. `STRIPE_SECRET_KEY=`, `STRIPE_WEBHOOK_SECRET=`.
- [ ] **Google OAuth client** (for "Log in with Google" on the portal) → `GOOGLE_CLIENT_ID=`, `GOOGLE_CLIENT_SECRET=`.
- [ ] **Cloudflare account + API token** → 48h preview hosting (Workers) + domain attach. `CLOUDFLARE_API_TOKEN=`, account/zone ids.
- [ ] **Porkbun API key** → domain registration. `PORKBUN_API_KEY=`, `PORKBUN_SECRET=`.
- [ ] **Brand domain** decision (e.g. is `storefronty.com` the name?) → previews on `*.preview.<brand>`, and the portal URL.

Until each arrives, that path runs against a **fake/stub** in tests so the logic is fully verified offline.

---

## How to see what's built right now

```bash
cd C:\Users\Owner\Documents\Storefronty\app
node --experimental-sqlite --test        # full suite, must be green
npm run serve                            # http://localhost:4173
# open http://localhost:4173/silva-s/    (barbershop → editorial fallback until Luxe ships)
# open http://localhost:4173/bloom-vine/ (florist → editorial native)
```

---

## Decisions / deviations I made autonomously (review these)

- **1A render test assertion fix:** the plan's `!includes('styles')` check falsely matched `rel="stylesheet"`. Replaced with the correct intent — links `theme.css`, not the legacy global `styles.css`. (commit `40725ba`)
- **Editorial rating star** wrapped in `<span class="star">` so the CSS can gold it (test still green).
- **Zero-dep external calls:** Gemini / Anthropic / Stripe / Cloudflare / Porkbun are all called via the existing SSRF-safe `util/net.js` over REST — **no new npm dependencies** (keeps the cera supply-chain surface minimal and tests offline). Playwright is the only added package (needed for headless screenshots).

---

## Commit log (this run)

- `23c5af8` editorial theme template + css
- `40725ba` contract→theme renderer
- `d1b413c` buildSiteV2 wires fill→validate→render→write
- _(continued below as the night progresses)_
