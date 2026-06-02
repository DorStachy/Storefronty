# Storefronty — Product Improvement Plan (Design Spec)

**Status:** Design — approved phase-by-phase with the founder (2026-06-03). Ready to turn into implementation plans.
**Author:** Michael (founder) + Claude
**Supersedes/clarifies:** ARCHITECTURE.md §6 (M-ladder is stale) and the UK-flavored parts of BLUEPRINT.md (we are US-only — see Phase 0).

---

## 1. What we're building

An autonomous cold-outreach + site-building machine for **US local businesses with no website**. We silently build a tailored demo, pitch it by a personal cold email with screenshots, let the owner reshape it for free, then sell a done-for-you monthly subscription (site hosted on their domain, unlimited-within-tier changes).

**Core principle — money follows interest.** The cold-pitch (sent to everyone, mostly ignored) must be **cheap**; the real spend (Opus build, hosting, AI imagery) only happens once a shop **replies**. Quality comes from the **design system**, not from an expensive model — "structure it so even a cheap model produces a beautiful, truthful site."

**Baseline already proven (on `prove-real-send`):** identity-anchored discovery + sweep + email-finding; a real cold email sent via Gmail SMTP landed in the test inbox's **Primary** tab. This plan is about making every section excellent and closing the loop to paying customers.

---

## 2. The funnel (corrected, end-to-end)

```
sweep finds a NO_WEBSITE shop (verified: Knowledge Panel + place_id)
   → cheap-fill its REAL Google data into the right niche THEME (Gemini Flash-Lite → content-contract JSON, never HTML)
   → Playwright renders it → 3 section screenshots (hero · services/menu · reviews)
   → personal "Michael, UI designer" cold email (niche variant) goes out with the screenshots
        ──────── (99% never reply → cost so far ≈ $0, no hosting) ────────
   → shop REPLIES with changes + maybe photos
   → classify reply (cheap-LLM intent + change-extraction; rules for opt-out)
   → OPUS builds the real, fully-clickable customized site (their changes + photos + premium imagery)
   → Playwright QA gate (no broken links/images, mobile OK) → founder ✅ (review mode)
   → site deployed LIVE for EXACTLY 48h (Cloudflare Workers, shopname.preview.ourbrand.com)
   → reply email with TWO links:
        (1) the live site (click through it, up 48h)
        (2) a SIGNED account-claim link → our portal (pre-bound to his site)
   → he creates a secured account (Google login) → gets ONE more free change (the carrot)
   → picks a plan → pays (Stripe) → picks a domain (included on Premium)
   → site published on his domain; he logs in any time to manage plan/site/requests (quota by tier)
```

---

## 3. Phased roadmap

Depth-first: make **one** lead convert end-to-end before scaling volume (matches the blueprint's "validate before you spend on infra").

| Phase | Outcome | Status |
|---|---|---|
| **0 · US reconcile** | Docs reconciled to the US launch (CAN-SPAM / $ / Google Maps / .com). Quick. | planned |
| **1 · The wow demo + the pitch** | 3-theme design system + cheap-fill + cold-pitch imagery + Playwright screenshots + the personal email. **Finish line: a real end-to-end cold-pitch send** (like Job 1). | planned |
| **2 · Catch the reply → Opus → hosted 48h link** | Reply→classify→Opus build→QA→founder ✅→hosted 48h→reply email with 2 links. | planned |
| **3 · Sell & take money (the portal)** | The web app: Google auth (site pre-bound), dashboard, one free edit, plans, Stripe, domain, publish. | planned |
| **4 · Volume** | Lift email-find-rate + HIGH-confidence gate; multi-inbox deliverability; 3-touch sequence; SPA-renderer. Start tiny, scale on results. | planned |
| **5 · Our marketing site** | Public storefronty.com explaining the service (separate from the portal). | planned |
| **6 · Plan-tier polish** | Per-tier features (Premium = scroll animation + more pages + bespoke imagery + SEO/analytics). | planned |
| **7 · Scale & autonomy** | Flip `review → auto` per piece; batch sending; monitoring; cloud lift. | planned |

Each phase gets its **own** implementation plan (via writing-plans) when we reach it. This doc details 1–3 and outlines 4–7.

---

## 4. Phase 0 — US reconciliation (quick)

The code is already US-aligned (CAN-SPAM email, Google Places, no ltd-company filter). The **docs** are not: BLUEPRINT §0 commits to the US, but §1–§16 still describe the UK/PECR playbook (£ pricing, Companies House, sole-trader exclusion, `.co.uk`). ARCHITECTURE §6's M1–M7 ladder no longer matches what's built (identity/discovery/sweep/email-finding grew past it).

**Work:** rewrite the UK-specific blueprint sections to US (CAN-SPAM, Google-Maps sourcing, $ pricing, US LLC, `.com`/US domains, US email infra); replace the stale M-ladder with this roadmap. No code.

---

## 5. Phase 1 — The wow demo + the pitch (DETAILED)

End state: the sweep finds a no-website shop, we build it a gorgeous tailored demo, screenshot it, and send a personal cold email — **end-to-end, a real send** (to the test inbox, like Job 1).

### 5.1 The design system — 3 distinct niche themes

Distinct look per niche (founder's call), all driven by **one shared content contract** so a single fill-pipeline serves every theme. v1 ships **three** themes; niche auto-selects one. (Full token/component specs from research are the implementation reference; essentials below.)

**Niche → theme map:**
- **Editorial** (warm): hair salon, nail salon, beauty/spa, café/coffee, bakery, florist, boutique/gift
- **Luxe** (dark/gold): barbershop, tattoo, steakhouse, bar/lounge, fine dining
- **Bold** (electric): gym/fitness, food truck, trades (plumber/electrician/landscaper/cleaner), auto repair, modern retail
- **Default** (unknown niche): Editorial
- **v1 build/sweep niches:** barbershop, hair/nail salon, café/coffee, food truck, gym (covers all three themes).

**Theme A — Editorial** (validated by the founder on the visual board). Cream/bone surfaces, espresso ink, terracotta accent, **Fraunces** (italic display serif) + **Inter**; signature = top-arched hero imagery + mixed upright/italic headlines; restrained scroll-reveal motion. Palette: `--bone #FAF6EF · --cream #F4ECE0 · --espresso #2B2018 · --terracotta #C0623E · --rust #8C3F22 (text-safe accent) · --gold #C9A24B`. WCAG-AA verified (never terracotta *text* on cream — use rust).

**Theme B — Luxe.** Near-black charcoal, warm gold, **Fraunces** + **Bebas Neue** (condensed caps) + Inter; signature = gold corner-ticks + slow heavy motion + gold foil-sheen CTA. Palette: `--ink-900 #0B0B0D · --smoke-100 #E8E3DA · --gold-500 #C9A24B`. Restraint = expensive.

**Theme C — Bold Modern.** White, near-black ink, ONE electric accent, heavy **Archivo** (Expanded for hero) + Inter; signature = hard offset block-shadows + a visible grid + snappy motion. Palette: `--paper #FFFFFF · --ink-900 #0E0E10 · --accent #0A5BFF` (electric, swappable per vertical; lime only on dark). Poster, not webpage.

**All themes:** plain semantic HTML + one CSS file + ≤2 KB vanilla JS (IntersectionObserver reveals + sticky-nav). `prefers-reduced-motion` + no-JS fallbacks shipped verbatim. AA contrast, ≥44px tap targets, visible focus. Deliberately lightweight so a screenshot/page renders identically and fast.

**Components (every theme):** sticky nav · hero · trust/rating strip · services-or-menu cards · hours · gallery · **reviews/testimonials** · location/map (static, click-to-load) · CTA band · footer.

### 5.2 Content contract + cheap-fill (the "structure beats the model" engine)

**Invariant:** the model emits **only** a validated `ContentContract` JSON object — **never HTML/CSS**. A deterministic renderer slots it into the chosen theme. Themes may ignore optional fields but never require fields outside the contract.

**Contract (abridged):** `{ schemaVersion, shopName, eyebrow?, tagline, about{paragraphs[]}, services[{name,desc,price?}], hours{display[]}, rating{stars,count,blurb?}, reviewHighlights[{quote,author?}]?, contact{addressLines[],phone?,areaServed?}, cta{label,kind?}, galleryQueries[], accentHint?, toneHint?, seo? }`. Every string length-bounded; galleries are **search queries, not URLs**.

**Grounding (anti-hallucination):** the model gets a **fact sheet** ("these are the ONLY facts that exist") built from the shop's Google Places record + a few review snippets + an allowed-services whitelist derived from Places `types[]`. Copied fields (name, hours, rating, address) are **overwritten from ground truth** by the validator; review quotes must be near-verbatim of a provided snippet; banned superlatives/URLs stripped. **No invented services, prices, awards, or history.**

**Model stack:** primary **Gemini 2.5 Flash-Lite** ($0.10/$0.40 per M, native `responseSchema`); fallback **GPT-5 nano** ($0.05/$0.40, strict Structured Outputs); final fallback **deterministic template** (never fails → a site always ships). ≤1 retry with a specific correction line. **Cost ≈ $0.0008/site, ~$24/mo even at 1,000 sites/day before caching.** Cache by `place_id + sha256(normalized facts) + schema/prompt/model version`; theme change = no refill (contract is theme-agnostic).

### 5.3 Copy + social proof (words sell as hard as design)

Copy must **sell the shop's product/service** — benefit-led, concrete, grounded in their real reviews. Testimonials (`reviewHighlights`) are first-class conversion components in every theme, pulled near-verbatim from their **real Google reviews** (no fabrication, no invented authors).

### 5.4 Imagery — cold-pitch tier

Curated **Pexels/Pixabay** (permissive license, **not Unsplash** — its API forces attribution + hotlinking onto the client's page). Pre-curated per-niche pools (refresh quarterly), color/vibe-matched at build time with **zero live API call**. **Hard rule:** never imply a stock photo is the shop's real storefront — imagery is atmospheric/illustrative; possessive "our shop/team" copy is reserved for owner-photo slots (later tiers). No identifiable faces in the cold-pitch pool (model-release risk). (Premium/owner-photo tiers live in Phase 2.)

### 5.5 Screenshots — Playwright

Render the cheap-filled themed site headless (Playwright, now available) and capture **three section screenshots** for the email: **(1) hero, (2) services/menu, (3) reviews.** SSRF-safe, budgeted, timeout-bounded. Deliverability: keep them compressed + properly sized with real alt text, keep enough body text, and **A/B** three-separate vs one tall composite vs the proven single shot — let inbox-placement data decide.

### 5.6 The cold email — personal, human, per-niche

Hand-typed voice, **no emojis, no AI tells.** One **clean base + per-niche-family variants** (base + small overrides, not N full copies) so a barber/café/gym each get fitting wording. CAN-SPAM clean (real identity, US postal address, working unsubscribe). **Approved copy:**

> **Subject:** a website for {Shop}
>
> Hi {First},
>
> My name's Michael and I'm a web designer. I was looking at {Shop} online, saw you didn't have a website, and put one together to show you what it could look like. A few screenshots are below.
>
> **[ the top of the site ]  [ your services / menu ]  [ your reviews ]**
>
> Everything on it is your real info: your hours, your services, and the reviews people have left you on Google. I do these for local businesses because most don't have a proper site, and a good one makes a real difference to how many people walk in or book.
>
> If you'd want it, just reply and tell me what to change. The usual things people ask for:
> - send me a few photos of your place and I'll add them in
> - change the colors, fonts, or layout
> - fix any of the wording, prices, or hours
>
> I'll make those changes for free, so you can see I'm serious, and then send you a link to the real working site to click around and share. You're not signing up for anything.
>
> Let me know what you think.
>
> Michael
> {Brand} — websites for local businesses
> {Postal address} · Reply STOP to unsubscribe

### 5.7 Builder refactor (the code change)

Evolve today's two hardcoded templates into: **themes** (template + tokens + CSS per theme) + a **content-contract validator** (Zod) + a **fill adapter** (fake for tests, Gemini in prod) + the **renderer** + the **screenshotter** (Playwright). All dependency-injected so unit tests stay **offline** (fake fill + fake renderer); add real-engine smoke tests. Keeps `npm test` green; TDD throughout.

### 5.8 Phase-1 model/cost summary

| Step | Tool | Cost |
|---|---|---|
| Cheap-fill (per site) | Gemini 2.5 Flash-Lite → contract | ~$0.0008 |
| Cold-pitch imagery | curated Pexels/Pixabay | $0 marginal |
| Screenshot | Playwright (self-hosted) | $0 |
| Send | Gmail SMTP (test) → ESP later | ~$0 |

---

## 6. Phase 2 — Catch the reply → Opus → hosted 48h link (DETAILED)

### 6.1 Inbox + classify
Poll the reply inbox (IMAP). Classify each reply with a **cheap-LLM** (Gemini Flash-Lite): intent (`interested / change-request / question / opt-out / angry`) **and** extract the exact requested changes ("make it navy", "we close at 7 now") + detect attached photos. **Hard-coded rules sit in front for opt-out/STOP** → instant, deterministic suppression (never trust an LLM with an unsubscribe).

### 6.2 Opus build
**Opus** rebuilds the real, fully-customized site applying their changes + their photos, with **premium imagery** (AI hero: **Imagen 4 Fast $0.02** cheapest / **Nano Banana Pro ~$0.13** for signage-text wow; owner photos enhanced via **Real-ESRGAN ~$0.002**). Everything clickable, nothing broken. Same content-contract/theme system — richer fill, no rewrite.

### 6.3 QA gate (don't ship broken)
A **Playwright auto-QA pass** on the built preview before it reaches the founder: crawl it, assert no broken links/images, no console errors, every button has a real target, renders on mobile. Fail → goes to the review queue, not out. (This is the founder's "everything clickable, nothing broken," enforced.)

### 6.4 Hosting (Cloudflare Workers)
Deploy live for **exactly 48h** at `shopname.preview.ourbrand.com`. **Cloudflare Workers** (primary; CF Pages fallback): one **wildcard domain = one cert** for all previews; expiry is a **KV TTL flag** (no delete-API churn / orphans); the contact/booking **form runs in the same Worker** (POST → MailChannels/Resend/SES). **<$0.01/preview.** Avoid Cloudflare-for-SaaS here (not needed — previews are on our own wildcard).

### 6.5 Review-mode approval
In `MODE=review`, the reply-driven build **waits for the founder's ✅** before the reply email sends — a **signed, POST-only** approve/reject endpoint on `src/server.js` using the existing HMAC `util/sign.js` (GET shows a confirm page; POST performs the action — no state-changing GET).

### 6.6 The reply email — TWO links
Same hand-typed voice. **Approved copy:**

> **Subject:** re: a website for {Shop}
>
> Hi {First},
>
> Thanks for getting back to me. I made the changes you asked for — *{the changes they requested}* — and your site's ready. Two links below.
>
> Have a click through it here (it'll be up for 48 hours):
> **{link to the site we built him}**
>
> If you like it, create your account here and I'll do one more change for you, free — that's also what saves the site to you before the 48 hours are up:
> **{link to our site — create account}**
>
> Any trouble, just reply.
>
> Michael
> {Brand}
> {Postal address} · Reply STOP to unsubscribe

- **Link 1** = the live 48h site.
- **Link 2** = a **signed account-claim link** (HMAC `sign.js`) unique to him; creating the account *through it* auto-binds the new account to his exact site (no "find your site" step). The carrot: account = **one more free change** + saves it before the 48h expire.

---

## 7. Phase 3 — Sell & take money: the portal (DETAILED)

The portal (our web app) is the conversion engine the reply email hands off to. **Biggest single build.** Exact stack (framework, DB, hosting) is pinned down in Phase 3's own implementation plan.

**Flow:** clicks the signed account link → **creates a secured account** (already bound to his site) → gets his **one more free change** → **picks a plan → pays → picks + registers a domain** → site goes live on it. Afterwards he logs in any time to **manage his plan, his site, and submit change-requests — quota by tier.**

| Aspect | Decision |
|---|---|
| **Auth** | **"Log in with Google"** (primary), plain email+password as fallback. Account pre-bound to his site via the signed claim link. Persistent/secured. |
| **Pricing (US)** | **Starter $29 / Pro $49 / Premium $99** per month. |
| **Request quota / tier** | **Starter 3 changes/mo · Pro 15/mo · Premium unlimited** (fair-use ~10/day). The post-signup "one more free change" is the pre-purchase carrot. |
| **Payment** | **Form a US LLC + Stripe** (doola/Firstbase). Gives native Stripe (lowest fees) **and** the US postal address CAN-SPAM requires in the cold emails, plus "real US company" trust. |
| **Domain** | Register on **Porkbun** (cheap, API, markup allowed — not Cloudflare Registrar); attach via **Cloudflare for SaaS** custom hostnames (100 free, then $0.10/domain/mo, SSL). **Included on Premium**; ~$25–35/yr add-on on Starter/Pro (markup = profit). |
| **Publish** | Move the site from the 48h preview Worker to permanent hosting on the customer's domain. |

---

## 8. Phases 4–7 (OUTLINE — each gets its own plan later)

**Phase 4 · Volume (lead supply + deliverability).** Lift the low email-find-rate (more sources + verification); **send only to HIGH-confidence emails** (medium ones are likely not the shop's). Scale sending properly: **separate lookalike sending domains** (never the brand/preview domain), multi-inbox via Smartlead/Instantly, SPF/DKIM/DMARC + 14–21d warmup, ~30–40 sends/inbox/day, the **3-touch follow-up** (Day 0/3/8, auto-stop on reply/opt-out), spam-complaint **kill-switch <0.3%**. Plug the real Playwright **SPA-renderer** into the discovery `render()` seam for precision. **Start tiny (1–2 inboxes, measure reply rate), scale on results.**

**Phase 5 · Our marketing site.** Public storefronty.com explaining the service (separate from the customer portal).

**Phase 6 · Plan-tier polish.** What each tier gets: **Premium** = scroll animations + more pages + bespoke AI imagery + SEO/analytics; **Pro** = mid; **Starter** = the clean one-pager.

**Phase 7 · Scale & autonomy.** Flip `review → auto` per piece once each step is trusted; batch sending; monitoring; cloud lift.

---

## 9. Prerequisites (founder real-world actions — don't block building, do block going live)

- **US LLC** (doola/Firstbase) → Stripe + the real CAN-SPAM postal address (replaces the `.env` placeholder `123 Main St`). Needed before **real** outreach + payments.
- **Brand domain** (verify `storefronty.com` availability or pick a name) on Cloudflare → previews on `*.preview.<brand>` ; **separate** sending domains for Phase 4.
- **API keys:** Gemini (fill + classify + imagery), an image model (Imagen/Nano Banana), Stripe, Cloudflare, Porkbun. (Google Places + SerpApi + Gmail already set.)

---

## 10. Decisions log (locked with the founder)

1. Phase order 0→7 as above; **depth-first** (convert one before scaling volume).
2. Distinct per-niche **themes** (Editorial/Luxe/Bold), one shared content contract.
3. Cold-pitch site = **cheap-fill** (Gemini Flash-Lite) into a theme; **Opus** on reply; premium imagery on reply; plan-tier polish on purchase.
4. Imagery: all three tiers, **sequenced** — curated stock (cold-pitch) → AI + owner photos (reply) → enhanced owner photos (purchase). Never real Google photos on the cold-pitch.
5. Cold-pitch deliverable = **3 screenshots** in a **personal email**, *not* a live link. Live link only **after reply**.
6. Email: hand-typed voice, no emojis/AI-tells; per-niche variants; the two approved drafts (§5.6, §6.6).
7. Hosting: **Cloudflare Workers**, exactly **48h**, wildcard subdomain, KV-TTL expiry.
8. Reply email = **two links** (live site + signed account-claim link that pre-binds the site).
9. Portal: **Google auth**; **$29/$49/$99**; quotas **3 / 15 / unlimited**; **US LLC + Stripe**; **Porkbun + Cloudflare-for-SaaS** domains, **included on Premium**.
10. Classifier = cheap-LLM intent + change-extraction, **rules for opt-out**.
11. QA: **Playwright** gate (no broken links/images, mobile) before founder ✅.
12. Volume: **HIGH-confidence emails only**; start tiny.

**Open / to decide later:** exact brand name + domain; sending-ESP + inbox provider choice (Phase 4); portal stack (Phase 3 plan); image-model final pick (Imagen 4 Fast default); screenshot A/B outcome.

---

## 11. Engineering standards (apply to every phase)

TDD (failing test first); dependency-inject all network/IO (fill / renderer / mailer / search) so logic is offline-testable; every outbound fetch via the SSRF-safe fetcher; escape every value rendered into HTML/email; the model **never** emits HTML; no secrets in git; CAN-SPAM on every commercial email; commit small, keep `npm test` green; after a meaningful slice, do a **live run** and report what real data revealed.
