# Storefronty — Unified Build Plan (Phased)

**Status:** Living document. We walk the customer flow step by step; each step — plus the user's reviews/improvements — becomes a **Phase** here. When the whole flow is covered and every step is approved, the entire plan is implemented at once via **multiple agents (Claude orchestrating)**, then tested. **No end-to-end test until everything is built and ready.**

## How we work
1. Walk the flow one step at a time — Claude explains what happens, how it's placed, how it's displayed.
2. User reviews → requests improvements/changes.
3. Claude folds every decision + improvement into this plan as a Phase (and amends earlier phases if feedback touches them).
4. Repeat until the entire flow is covered and approved.
5. **Then** Claude implements the whole plan with as many agents as it warrants (orchestrating, parallel where independent / sequential where coupled), each with tests → a Codex adversarial review gate → and only then the real E2E.

> **Why this shape:** building one phase mid-conversation is best done directly, but implementing the *entire finished multi-phase plan* at the end is broad, parallelizable work across many files — exactly where multi-agent orchestration excels. Walking the flow first also externalizes every decision into this durable doc, immune to conversation length.

## The flow (status map)
| Stage | Status |
|---|---|
| 1. Researcher — find no-website businesses (+ socials/email verify) | ✅ built + reviewed |
| 2. Cold-build template (Stage 1, Gemini) | ✅ built |
| 3. Screenshots + Cold email (Email 1 — screenshots, no link) | ✅ built + reviewed |
| 4. Hosting — Cloudflare KV 48h previews + Fly backend | ✅ built + deployed + verified |
| 5. Reply handling — IMAP poll + intent classify | ✅ built |
| **6. Stage 2 Wow-Build — bespoke, grounded site** | **▶ PHASE 1** (designed; implement at end) |
| 7. Founder approval (review mode, signed link) | ✅ built |
| 8. Email 2 — live 48h link + claim + free change | ✅ built + reviewed |
| 9. Claim → Google signup → permanent site | ✅ built |
| 10. Pricing / plans (Starter $29 / Pro $49 / Premium $99) | ✅ built; tiering refined (Pro=leads, Premium=orders) |
| 11. Payment (Paddle) | ⏸ parked (do last) |
| 12. Portal / change requests (ongoing) | ✅ built |
| 13. B-lite lead-capture forms (Pro) | ⬜ future phase |
| 14. B-full ordering / reservations (Premium) | ⬜ future phase |
| 15. Custom domains (Premium) | ⬜ future phase |

*A "built" stage can still earn a phase here if a review wants it improved.*

---

## Phase 1 — Stage 2 "Wow-Build" (bespoke, grounded site generation)

**Status:** ✅ **IMPLEMENTED + committed** (`6a7a404`, 281 tests) via an 8-agent Opus workflow + live verification. Two **live-only bugs** caught & fixed (offline tests inject a fake transport, so they couldn't): Opus 4.8 deprecated `temperature` → HTTP 400; `postJson`'s 12s timeout is too short for Opus → 90s. Both would have silently shipped the deterministic fallback for **every** site. Live Opus output verified excellent (tailored copy + self-art-directed design). ⬜ Pending: visual polish (the no-photo hero; a with-real-photos pass).

**Flow step:** #6 — after the owner replies, generate the gorgeous tailored site (the conversion artifact the customer plays with before paying).

**Decisions locked (this session):**
- **Approach 3 (hybrid):** Opus 4.8 art-directs — one grounded call emits a `ContentContract` (facts/copy) **+** a validated `DesignSpec` (palette · fonts · layout · scale · radius · shadow · motion · texture). A token→CSS engine generates the stylesheet onto one semantic template. **Opus designs; the system guarantees the facts + safety.**
- **Validated tokens, not raw CSS** — XSS-safe + self-contained by construction. (Raw-CSS "3b" deferred.)
- **Niche-aware inspiration playbook** — distilled Awwwards / Land-book / Mobbin / Dribbble DNA, encoded into the prompt (not fetched at runtime), so each niche feels distinct.
- **Guarantees preserved:** grounding (truthful facts snap back), self-contained HTML (Cloudflare KV), QA gate (facts present + self-contained + renders), deterministic **always-ships** fallback.
- **Model:** Opus 4.8 (`ANTHROPIC_API_KEY` live + verified; staged on Fly).
- **Plan tiering** (gates *future* phases, not v1): everyone gets the site (A); **Pro $49** = lead-capture form (B-lite); **Premium $99** = ordering/reservations (B-full) + custom domain.

**Scope (v1):** the **A generator only.** B-lite / B-full / custom domains / multi-page = later phases.

**Full detail:**
- Spec → [`specs/2026-06-03-stage2-wow-build-design.md`](../specs/2026-06-03-stage2-wow-build-design.md)
- Code-complete task plan (8 tasks) → [`2026-06-03-stage2-wow-build.md`](2026-06-03-stage2-wow-build.md)

**Tasks (summary):** ① DesignSpec validator · ② token→CSS engine · ③ v3 template + niche playbook · ④ Opus art-director `{contract, design}` · ⑤ writeSite generates CSS · ⑥ QA facts + self-contained · ⑦ orchestrator `replied` swap · ⑧ always-ships invariant + visual polish loop.

---

## Phase 2 — Post-claim portal + the tiered "living site" upsell (in discussion)

**Flow step:** #9–#12 — what the customer experiences after clicking the live link, signing in with Google, and becoming an owner.

**Captured requirements (this session):**
- **Claim = register + 1 free change (a TRIAL, not the site):** clicking claim creates the account (Google) + grants **one free change** so they taste the service. **They do NOT keep the website until they choose (pay for) a plan.** No permanent free tier — the free 48h preview + register + 1 change is the hook; **Starter $29 is the entry paid tier that keeps the (calm) site live.** ⚠️ **CHANGES current behavior:** today claim drops the 48h TTL → permanent-free (`keepPreview`/`stopPreviewExpiry`); under this model claim keeps it a TRIAL preview, and only **buying a plan** makes it permanent.
- **"Add to Google" activation (conversion hack):** a dashboard card prompts the owner to set their **Google Business Profile** website field to the 48h preview URL → real customers click it → they *feel* the site working on their real listing → FOMO to keep it → convert. ⚠️ Real customers may click it, so the **expired state must degrade gracefully** (business basics / "coming soon," NOT a salesy page); the dashboard warns *"pick a plan before 48h so the link stays live."* Can also be seeded in Email 2.
- **Portal "view my live site" link:** a button to open the site standalone in a new tab. *(User said a temporary ~14h link — CONFIRM duration + purpose vs the 48h preview.)*
- **The "living site" — tiered richness IS the product ladder (the upsell engine):**
  - **Base (free/Starter, incl. the 48h preview):** high-quality *design* — real photos, sharp grounded copy, beautiful modern layout — but **calm**: minimal motion, no 3D, single page, self-contained. Wins the reply/claim on design + "this is my business, free." ← Phase 1's wow-build produces THIS.
  - **Pro:** the site comes *alive* — scroll-reveal animations, smooth scroll, tasteful CSS-3D, an extra page/section (+ lead forms, B-lite).
  - **Premium:** the showpiece — real WebGL/Spline 3D, cinematic scroll, a full **catalogue**, multi-page (+ ordering/reservations B-full + custom domain).
  - **Upsell mechanism:** the portal shows **2 hand-designed showcase demo sites — one Pro, one Premium** — *generic* (a demo business, NOT the customer's), built ONCE and reused for all customers. They see how stunning each tier is → they upgrade. We generate the customer's OWN animated/3D site **only when they actually pay** (no per-customer preview generation = no wasted spend). Bonus: the 2 showcases double as marketing assets. **Reserving the motion/3D for paid is the whole point — give it away free and no one upgrades.**
- **Stacks with the functional tiering:** Pro also = lead forms (B-lite); Premium also = ordering/reservations (B-full) + custom domain. Richness ladder + functional ladder compound.

**Decisions locked (corrected — richness is the upgrade ladder, NOT a freebie):**
- ✅ **Free base / 48h preview = high-quality but CALM** — beautiful design, real photos, great copy; **a touch of tasteful subtle polish** (gentle scroll fade-ins, nothing showy); no 3D, single page, self-contained. Putting the real animations/3D on the free site would gut the upsell.
- ✅ **Animation = Pro; real WebGL 3D + catalogue + multi-page = Premium.** Upsell via **2 fixed, hand-built showcase sites (one Pro, one Premium), generic + reused for ALL customers** — cheaper than per-customer preview generation AND higher-quality (we polish 2 sites to perfection); they double as marketing assets. The customer's real upgraded site is generated only on purchase.
- ✅ **Phase 1 unchanged** — its wow-build produces the polished, calm, self-contained base (NOT "alive for everyone"; the earlier amendment is reverted).
- ✅ **Hosting** — base stays self-contained KV; richer hosting (Fly / Pages + R2) lives with the Pro-motion / Premium-WebGL phases (post-purchase).

- ✅ **The 2 showcase sites = ORIGINAL, not copied** — inspired by Awwwards/Land-book/Mobbin/Dribbble aesthetics but original work (copying a specific designer's site = copyright + brand risk for a company that *sells* websites). Generic content (barbershop = Pro feel, cafe/restaurant = Premium feel). Built ONCE — AI-generated (≈ free, same capability as the wow-build) or adapted from a permissively-licensed template.

- ✅ **Showcase demos + "view my site" = simple one-page routes on our OWN portal/domain/machine (Fly)**, opened in a new tab. No separate temporary/14h-link infra (that idea is dropped — over-engineered).

- ✅ **Showcase directions chosen** — **Pro** = *Foodie Restaurant* vibe (xgenious: warm, friendly, food-forward, light/clean); **Premium** = *Nixtio – Modern French Dining* vibe (dark, candle-lit, cinematic, elegant serif). Generic restaurant content; build ORIGINAL sites channeling these vibes (NOT copies). Reference shots saved from Dribbble; pull full detail at build time.

**Still open:**
- **Pro vs Premium exact levels** — settled when we design those tiers' own phases.

---

## Phase 3 — (next flow step — to be defined)

*We continue walking; the decisions + improvements land here.*

---

## Implementation strategy (executed only after the whole flow is approved)
Multiple agents, Claude orchestrating: independent phases/files in parallel (worktree-isolated), coupled work sequential; tests per unit; then a Codex adversarial-review gate; then the real E2E with the user's Gmail as the customer.
