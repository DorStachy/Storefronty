# Storefronty — Business Blueprint

> **Status:** Design + research complete. Not yet built.
> **Last updated:** 2026-06-02
> **Founder / sender identity:** Michael Gabay
> **Working name:** Storefronty *(verify `storefronty.com` / `storefronty.co.uk` availability + trademark before buying)*

---

## 1. The one-liner

Find UK limited-company local shops that have **no website**, **build them a beautiful one before they ask**, pitch it by cold email with a screenshot, let them shape it for free, then sell it as a **£15–45/month done-for-you service with unlimited changes**.

The wedge: the market is saturated with cheap **self-serve** builders (Wix, Squarespace, Durable) but **underserved for cheap *done-for-you*** — the only done-for-you players (Hibu) charge £99–159/mo+. We sit in that gap, and we convert skeptics by **showing them their own shop** instead of selling them on the idea of a website.

---

## 2. The funnel

| Stage | Trigger | What happens | Marginal cost |
|---|---|---|---|
| **0. Silent build** | every lead | Free OSM/Companies House data → fill a gorgeous **template** with their name + category-matched **free stock photo** → self-hosted screenshot. *No AI site-build yet.* | **~£0.005** |
| **1. Cold email** | — | Screenshot + *"reply with one thing you'd change and I'll do it and send you the live link."* From Michael Gabay. | ~£0 (fixed infra) |
| **2. They reply** 🎣 | first prompt | Now there's interest. Build the real, customized live site (Claude **Sonnet**, Batch API), deploy to a temp URL. **"Ready to view within 48 hours."** | **~£0.05–0.31** |
| **3. Magic registration link** | — | Email them the live link + a **"Make it yours"** button → one-click passwordless account that **pre-binds their site** to it. | ~£0 |
| **4. In the portal** | — | One more **free edit** to *feel* the product — **or** buy now + choose domain. | ~£0.005/edit |
| **5. Buy** | payment | Choose domain: cheap `.co.uk` vs premium/marked-up `.com`. We register & **hold it while subscribed**. Premium polish pass (Claude **Opus** + bespoke AI imagery). | **~£3 one-time** |
| **6. Live + ongoing** | — | Site live on their domain; portal is home for **unlimited fair-use edits** (~10/day cap). | ~£1.40/mo to serve |

**Principle — money follows interest.** No reply = we spent half a penny. The expensive, beautiful work only happens for people who raise their hand. This is what keeps the downside at **~£20/month** to validate.

---

## 3. Target market

- **Geography:** United Kingdom first (PECR permits B2B cold email to corporate subscribers).
- **Who:** **limited companies / LLPs** that are local consumer-facing shops with **no website** — cafés/restaurants/takeaways, salons/beauty, gyms/clinics, small retail, and incorporated trades.
- **Targeting decision:** **Email limited companies only**, filtered via free **Companies House** data (see §11 Compliance). Sole-trader channels (post/phone) are a later expansion.
- **TAM:** ~1.75M UK businesses have no website (32%). Local consumer-facing no-website pool ≈ **200k–500k**; of those, only ~40% are "willing-but-stuck" (cost/skills/time) rather than actively uninterested. The limited-company-only subset is smaller again — **plan for a serviceable pool in the low hundreds of thousands**, and plan market expansion (all no-website businesses → Ireland → other English markets) before it's exhausted.

### Shop-type tiers (build effort vs. willingness to pay)

| Tier | Shop types | Needs | Build effort | Verdict |
|---|---|---|---|---|
| **1 — Brochure** | barbers, salons, cleaners, cafés, incorporated trades | hero, services, photos, hours, map, click-to-call | Lowest (1-page) | **Launch here** |
| **2 — Brochure + 1 function** | restaurants, takeaways, gyms, clinics | + menu / booking *link* / reviews | Low–med | Fast follow |
| **3 — Light e-commerce** | boutiques, gift shops, bakeries | + catalog + checkout (Stripe Payment Links) | High + support | **Defer** until 1–2 proven |

---

## 4. Product: plans & pricing

Good/better/best ladder, each with a **reusable live demo** on the pricing page (built once, reused — not per customer). **Monthly is the default**; **annual is a post-purchase upsell** (defends against micro-subscription churn).

| | **Starter** | **Pro** ⭐ | **Premium** |
|---|---|---|---|
| Price | £15/mo · £150/yr | £25/mo · £250/yr | £45/mo · £450/yr |
| Best for | trades, barbers, cleaners | restaurants, salons, gyms | boutiques, online sellers |
| Pages | polished 1-page | multi-section | full multi-page |
| Imagery | template + curated stock | + bespoke AI + enhanced photos | + full custom treatment |
| Features | hours, map, click-to-call, form | + menu/booking link, reviews | + light e-commerce/ordering |
| Design pass | Sonnet | Sonnet + Opus polish | Opus, premium |
| Domain | free `.co.uk` | free `.co.uk` or discounted premium | premium `.com` included |
| Edits | unlimited fair-use | priority | priority + SEO & analytics |

- **Upsell:** premium `.com` / chosen name at marked-up retail (cost ~£9 → charge ~£25–35/yr).
- **Guarantee:** 14-day "love it or leave it" to kill purchase hesitation.
- Pricing is **positioning, not cost-recovery** — marginal cost is £1–3/mo at every tier.

---

## 5. Tech stack (shoestring, local-first)

Everything except LLM calls runs **free locally during development**. Infra spend is deferred until the funnel is validated and scales with revenue.

| Job | Pick | Notes / cost |
|---|---|---|
| Lead discovery | OpenStreetMap Overpass (free) + Companies House data | verify "no website" via absent website field; filter out FB/IG-only |
| Lead qualification | Gemini Flash-Lite / GPT-5 nano | ~£0.0002/lead |
| Pitch render | shadcn/Tailwind template + free stock (Pexels) + self-hosted Playwright screenshot | ~£0.005/lead |
| Site copy & code | **Claude Sonnet** (pitch/reply) → **Claude Opus** (polish) | see §6 |
| Imagery | Pexels/Pixabay (free) → FLUX 1.1 pro / Google Nano Banana (bespoke) → enhance owner photos | see §7 |
| Hosting | Cloudflare Pages / Workers + **Cloudflare for SaaS** custom hostnames | 100 domains free, then $0.10/domain/mo |
| Domain registration | **Porkbun** or Namecheap (markup allowed); *not* Cloudflare Registrar (at-cost only) | `.co.uk` ~£4–5/yr |
| Outbound email | multi-inbox via Maildoso/Zapmail + Smartlead/Instantly rotation | see §8 |
| Inbound (edit replies) | **Cloudflare Email Routing + Email Workers** | free |
| Edit apply | Gemini Flash-Lite / Sonnet | ~£0.005/edit |
| Orchestration | BullMQ + Redis or cron (local) → Inngest free tier | — |
| Database | SQLite local → Supabase free tier | — |
| Billing | **Stripe** | 1.5% + 20p (+0.7% on subscriptions), no monthly fee |

---

## 6. Model selection (the core "wow" decision)

**Claude is #1 at web design *and* costs pennies** (WebDev Arena #1; GPT-class rated weakest at visual polish). Use the best where it sells, cheap models everywhere else. Per-site assumes ~10k in / 50k out (output dominates), £0.79/$1.

| Pipeline step | Model | Why | Cost |
|---|---|---|---|
| Lead qualification | GPT-5 nano / Gemini Flash-Lite | dirt-cheap classification | ~£0.0002/lead |
| **Pitch build** (every reply) | **Claude Sonnet 4.x** + Batch API | near-top design at half price; the screenshot that sells | ~£0.31 (£0.31; £0.16 batch) |
| **Premium polish** (converting) | **Claude Opus 4.x** | undisputed best — the "wow upgrade" | ~£0.51–1.03 |
| Edits (unlimited fair-use) | Gemini Flash-Lite | tiny per-edit | ~£0.005/edit |

- **Fallback / A-B contender:** Gemini 3.x Pro (the only real design rival).
- **Open-source escape hatch** (near-zero marginal if self-hosted later): **Kimi K2.5** (best open for UI) or **GLM-4.6** (front-end-tuned, agentic).
- **Templates:** shadcn/ui (free MIT) + Tailwind Plus (£240 one-time) for components; generation, not licensing, is the marginal cost.

---

## 7. Imagery strategy

Biggest visual "wow" lever. **Mix three, tiered by stage:**
- **Pitch (free):** Pexels/Pixabay stock matched to shop type. *(Do NOT use the shop's real Google photos in the mockup — licensing/misrepresentation risk.)*
- **Bespoke (on conversion):** AI generation for shop-specific hero shots — **FLUX 1.1 pro** (~$0.04/img) or **Google Nano Banana**. ~£1–2/site.
- **Authentic (customer-supplied):** enhance/upscale the owner's own photos (~£0.02/op) once they're aboard. Best for trust.
- **Licensing gotchas:** Pexels API needs a visible credit link; AI image rights vary by ToS — verify for client resale; never pass AI shots off as the real storefront.

---

## 8. Email infrastructure & deliverability

**There is no way past ~30–40 cold sends/inbox/day.** You scale by adding inboxes; you protect deliverability obsessively.

| Daily send | Inboxes / domains | Est. infra/mo |
|---|---|---|
| Validation (1–2 inboxes) | 1–2 / 1 | **~£15–30** |
| 1,000/day | ~30 / ~10 | ~£180 |
| 2,000/day | ~57 / ~19 | ~£320 |
| 5,000/day | ~143 / ~48 | ~£750 |

- **Architecture:** multiple **lookalike sending domains** (never the main brand domain), ~3 inboxes each, rotated by **Smartlead/Instantly** (unlimited inboxes, flat ~$39–174/mo).
- **Inbox providers:** Maildoso (~£1.80/inbox at scale), Zapmail (~£3), or Google Workspace (~£6, warms fastest).
- **Trust signals (ranked):** SPF/DKIM/DMARC alignment → branded-domain "from" → domain aging + 14–21 day warmup → custom tracking subdomain → real business address in signature (PECR) → BIMI.
- **NOT free webmail** — Proton/Gmail cap sending, can't pass DKIM alignment, and a `@proton.me`/`@gmail.com` from-line kills trust.
- **Burn & replace:** 10–20% of sending domains burn per month — budget continuous replacement; rotate every 6–9 months even when healthy.
- **Kill-switch:** keep spam complaints **< 0.3%** (Google/Yahoo bulk-sender rule). One sloppy month torches domains.
- **Ceiling reality:** a solo operator sustainably runs ~1,000–3,000/day. "Non-stop" 10k–20k/day exhausts the entire UK niche in weeks *and* is a full-time infra job — don't.

---

## 9. Domain automation

- **Register cheapest available domain using the shop's name**, programmatically, **only on purchase** (never for cold leads).
- **Registrar:** Porkbun (cheap, free DNS API) or Namecheap — both allow markup. **Cloudflare Registrar is at-cost and forbids reselling** → not for the upsell.
- **Attach many custom domains:** Cloudflare for SaaS custom hostnames — **100 free, then $0.10/domain/mo**, SSL included.
- **Prices (2026):** `.co.uk`/`.uk` ~£4–5/yr; `.com` ~£8–10/yr. We hold the domain while subscribed; release/transfer on churn after a grace period.

---

## 10. Unit economics & cost structure

**Per paying customer:**
- Revenue: blended **~£24/mo** (+ ~£10 one-off domain-markup profit on upgraders)
- Cost to serve: hosting £0.10 + domain amortized £0.40 + unlimited edits ~£0.10 + Stripe ~£0.70 + auto-support ~£0.10 = **~£1.40/mo**
- **Gross margin ~94%** · **CAC ~£10–15** · **LTV (~12 mo) ~£290** · **LTV:CAC ~20:1**

**Cost floor if ZERO customers buy (downside):** essentially just the fixed email infra you choose — **~£15–30/mo in validation mode** (1–2 inboxes), ~£200/mo at 1,000/day. Per-email marginal cost is ~£0.005, so volume barely moves the floor.

---

## 11. Compliance (PECR / UK-GDPR)

- **Cold email is legal to corporate subscribers** (limited companies, LLPs, PLCs) with: (1) undisguised sender identity, (2) a valid opt-out/unsubscribe, (3) honoured opt-outs.
- **Sole traders & ordinary partnerships = "individual subscribers"** → **cannot** be cold-emailed without consent/soft opt-in. **→ We email limited companies only** (Companies House filter). Reach sole traders later via post/phone (PECR doesn't restrict business post).
- **UK-GDPR:** maintain a **privacy notice** + **legitimate-interest assessment (LIA)**; honour suppression permanently.
- **Every email** carries Michael Gabay's identity, the Storefronty business name + registered postal address, and a one-click unsubscribe.
- **Suppression list checked before every send, forever.**

---

## 12. Realistic projections

Reconciled from benchmarks (showing a finished demo lifts conversion ~3.2x) **and** the sobering reality that this audience *chose* not to have a website + PECR limits the channel.

| | Realistic planning range |
|---|---|
| New customers/mo, months 1–6 | **~20–50** |
| New customers/mo, by month 12 | ~50–100 *(needs follow-ups + referrals + multi-channel)* |
| Net conversion (emails → paid) | ~0.15–0.4% |
| 12-month trajectory | **£5–12k MRR solo business, ~90% margin** |

- **Profitable from month 1** even at the conservative end (£480–720 new MRR vs ~£150 cost), compounding monthly.
- **Biggest swing factor:** conversion rate — which is why the free-edit, show-don't-tell funnel matters most.
- **Real limits:** lead supply, founder time, deliverability discipline — *not* cash.

---

## 13. Cold-email + follow-up sequence

3 touches over ~8 days, auto-stopped on any reply or opt-out. Personalized (biggest lever) and from a real person. *(Edit angles A/B against these.)*

### Email 1 — Day 0
> **Subject:** a website for [Shop Name] 👀
>
> Hi [First name],
>
> I noticed [Shop Name] doesn't have a website yet — so I went ahead and built you one. Here's a peek:
>
> [📸 screenshot]
>
> It's a real, working site, not a mockup. If you tell me one thing you'd change — different photos, your opening hours, a section about [their specialty] — I'll make the change and send you the live link so you can click around the real thing.
>
> No catch, no charge to look. Just reply and tell me what you'd tweak 🙂
>
> Michael
> *Storefronty — websites for local shops*
> [registered address] · [unsubscribe]

### Email 2 — Day 3 (gentle bump)
> **Subject:** re: a website for [Shop Name]
>
> Hi [First name], just checking you saw the site I put together for [Shop Name]? Happy to change anything — photos, wording, colours — whatever you'd want. Reply and it's done.
>
> Michael · Storefronty · [unsubscribe]

### Email 3 — Day 8 (soft close / scarcity)
> **Subject:** should I keep [Shop Name]'s site up?
>
> Hi [First name], I'll take the preview I built for [Shop Name] down soon to free up space — want me to keep it live for you? Just say the word and I'll send you the link to make it yours.
>
> Michael · Storefronty · [unsubscribe]

---

## 14. Operations

- **Inbound classification:** cheap LLM tags every reply → `interested / edit-request / opt-out / angry / legal`.
  - `opt-out` / `angry` → instant permanent suppression + brief apology.
  - `legal` → suppress + human review queue, no auto-reply.
- **Edit-by-email** is the entry; the **portal** is the home (magic-link auth pre-binds their site).
- **Churn:** offer "pause" instead of cancel; push annual upsell; domain lock-in.
- **Content guardrails:** auto-skip prohibited/regulated businesses at discovery.
- **Metrics:** funnel = Discovered → Pitched → Delivered → Replied → Claimed → Free-edit → **Purchased** → Retained. Guardrails = spam-complaint < 0.3%, bounce rate, inbox placement > 90%. Obsess over **reply rate × conversion vs. build-cost-per-lead**.

---

## 15. Open questions / next steps

- [ ] Verify `storefronty.com` / `.co.uk` availability + trademark.
- [ ] Validate the funnel cheaply: ~1–2 warmed inboxes, a few hundred hand-picked limited-company leads, measure reply rate before any infra spend.
- [ ] Build the **discover → generate → screenshot** prototype locally (the riskiest "does the wow land?" piece).
- [ ] Confirm live model pricing/benchmarks on official dashboards before committing budget.
- [ ] Decide annual-upsell discount and the exact free-edit allowance.

---

## 16. Research confidence & sources

This blueprint is synthesized from multi-source web research (June 2026). **High confidence:** Cloudflare for SaaS pricing, CF Email Routing (free), ESP cold-email bans, PECR corporate-subscriber rule, Stripe UK fee, Claude's design-quality lead, the shape of LLM pricing, UK no-website stats (gov.uk Business Data Survey 2024). **Verify before committing budget:** exact Google Places/SES per-unit pricing, exact GPT-5-tier/Gemini-3 prices, live LMArena/SWE-bench standings, and all conversion-rate/customers-per-month figures (derived estimates, not measured studies). Domain availability for "Storefronty" was a best-effort check — confirm at a registrar.

*Key sources captured across research runs: developers.cloudflare.com, platform.claude.com/pricing, ai.google.dev, openai.com/api/pricing, porkbun.com, ico.org.uk (PECR B2B), gov.uk Business Population Estimates 2024 + UK Business Data Survey 2024, instantly.ai & hunter.io (cold-email benchmarks), lmarena.ai (WebDev Arena), durable.com/hibu (competitor pricing).*
