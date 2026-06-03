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

## Phase 2 — (next flow step — to be defined)

*We walk the next step together; the decisions + improvements land here.*

---

## Implementation strategy (executed only after the whole flow is approved)
Multiple agents, Claude orchestrating: independent phases/files in parallel (worktree-isolated), coupled work sequential; tests per unit; then a Codex adversarial-review gate; then the real E2E with the user's Gmail as the customer.
