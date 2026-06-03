# 01 — End-to-End Flow (Source of Truth)

> **Scope:** the one canonical narrative — how a shop goes from "discovered with no website" to a
> paying portal customer asking the AI for changes — naming the exact module, file, and **lead state
> transition** at every step.
> **Drivers:** [`orchestrator.js`](../../app/src/orchestrator.js) (the tick + per-status handlers),
> [`states.js`](../../app/src/states.js) (allowed edges), [`api/index.js`](../../app/src/api/index.js)
> (the portal path).
> **Last verified against code:** 2026-06-03.

---

## The whole funnel at a glance

```
 RESEARCH         discovered
    │  orchestrator.HANDLERS.discovered → buildSiteV2 (fillLead)            [build the site]
    ▼
  built
    │  HANDLERS.built → screenshotForEmail (3 sections)                     [capture screenshots]
    ▼
 deployed
    │  HANDLERS.deployed → sendColdEmail (Email 1: screenshots, NO link)    [cold email]
    ▼
 emailed ───────────────── (owner replies) ─────────────────────┐
                                                                 │ inbox.poll/injectReply → handleReply → classify
                          opt_out → suppress + opted_out ◄───────┤
                          angry/question → needs_human ◄─────────┤
                                                                 ▼ edit_request
                                                              replied  ◄───────────────┐
    │  HANDLERS.replied → applyOpusEdit → writeSite → qaCheck                           │ (portal change request
    │      QA fail → needs_human                                                        │  re-enters here)
    ▼                                                                                   │
  editing ──(review)→ notifyFounder → pending_approval ──/approve POST──┐               │
          └─(auto)──────────────────────────────────────────► approved ◄┘               │
    │  HANDLERS.approved → deploy (48h) → composeReplyEmail (Email 2: live + claim)      │
    ▼                                                                                    │
 link_sent                                                                               │
    │  owner clicks the signed /claim/<token> → signup/Google → account bound to lead    │
    ▼                                                                                    │
 PORTAL ── dashboard · AI console: POST /api/requests → records edit_request, lead→replied ┘
        └─ billing: pick plan / buy top-up → webhook → plan active / credits
                                          … reached_pricing → paid → live (future tail)
```

---

## Step-by-step

### A. Research → `discovered`
- **CLI** `npm run research` (or `sweep`) → `seedFromResearch` → `research()`
  ([researcher](../../app/src/researcher/index.js)): an engine (`mock`/`places`) reports candidates;
  for each non-`hasWebsite` one, `discoverWebsite` confirms it's truly **NO_WEBSITE** (identity-
  anchored). Survivors are `insertLead`'d (dedup-guarded) at status **`discovered`**.
- Full detail: [03 — Researcher & Discovery](03-RESEARCHER-AND-DISCOVERY.md).

### B. Build the site → `built`
- `tick()` runs `HANDLERS.discovered`: `buildSiteV2(lead, {fill: fillLead})` — the cheap-LLM fill
  (Gemini, key-gated; deterministic fallback) produces a validated **ContentContract**, rendered
  into the niche theme and written to `app/public/<slug>/`. `db.addSite(...)`, then
  `setStatus → built`. Detail: [04 — Site Builder](04-SITE-BUILDER.md).

### C. Capture screenshots → `deployed`
- `HANDLERS.built`: `screenshotForEmail` captures **3 section screenshots** (hero, services,
  reviews|gallery) into a `shots/` dir. Requires ≥ 1 to succeed. `setSiteScreenshot`, then
  `setStatus → deployed`. (Note: "deployed" here means *ready to pitch with screenshots* — there is
  **no live link yet**.)

### D. Cold email (Email 1) → `emailed`
- `HANDLERS.deployed`: `sendColdEmail` reads the shots and sends **Email 1** — founder-approved copy
  + the 3 inline screenshots, **no live link**, CAN-SPAM compliant. Recipient = `TEST_RECIPIENT ||
  lead.email`; suppression-checked; idempotent (won't double-send). Logs an `email1` message, then
  `setStatus → emailed`. Detail: [05 — Email & Outreach](05-EMAIL-AND-OUTREACH.md).
  *(Follow-ups `followup_1/followup_2` are modeled states; the cold sequence can extend here.)*

### E. The owner replies → `handleReply` routes it
- A reply arrives via `inbox.poll` (real Gmail IMAP, matched by sender email) or `injectReply`
  (CLI/test). `extractText` strips quotes/signature; `classify` tags intent; `handleReply` routes:

| intent | transition |
|---|---|
| `opt_out` | `addSuppression` + `setStatus → opted_out` (terminal) |
| `angry` | `setStatus → needs_human` |
| `question` (pricing) | `setStatus → needs_human` |
| `auto_reply` / `other` (ack) | log `reply_noop`, no change |
| `edit_request` | record `edit_request` event + `setStatus → replied` |

### F. Rebuild with the change → `editing` → approval gate
- `HANDLERS.replied`: `applyOpusEdit(lead, {baseContract: fillDeterministic(lead), change})` — Claude
  Opus applies the owner's change (key-gated; deterministic fallback) → `writeSite` → **`qaCheck`**
  (Playwright: console errors, broken images, bad links, leftover tokens, mobile overflow).
  - **QA fails →** `setStatus → needs_human` (reason `qa_failed`) — never ship broken.
  - **QA passes →** `addSite`, `setStatus → editing`, then:
    - **`MODE=auto`:** `setStatus → approved` directly.
    - **`MODE=review`:** `notifyFounder(composeFounderApproval(...))` (signed Approve/Reject links) +
      `setStatus → pending_approval`.

### G. Founder approves → `approved`
- The founder clicks the signed link; `handleApproval` ([approval](../../app/src/approval/index.js))
  shows a confirm page (GET) and acts only on **POST**, only while `pending_approval`:
  approve → `setStatus → approved`; reject → `setStatus → needs_human`.

### H. Deploy live + reply email (Email 2) → `link_sent`
- `HANDLERS.approved`: `deploy(...)` makes the site live for **48h** (`setSiteLive` with
  `expiresAt`), then `composeReplyEmail` sends **Email 2** with **two links** — the **live 48h site**
  and a **signed `/claim/<token>`** account-claim link. Logs an `email2` message, then
  `setStatus → link_sent`.

### I. Claim + sign up → a portal account bound to the site
- The owner opens `/claim/<token>`: the SPA calls `POST /api/auth/claim` (greets with the shop
  name), then `POST /api/auth/signup` (or **Continue with Google**) — `createAccount` binds the new
  account to the lead via the claim's `leadId`. A session cookie is set. Detail:
  [06 — Portal](06-PORTAL.md), [08 — Auth & Security](08-AUTH-AND-SECURITY.md).

### J. Portal usage → the rebuild loop, re-entered
- In the portal the owner uses the **AI console**: `POST /api/requests` with text (+ optional
  photos). `canRequestChange` decides free / plan-quota / top-up / blocked (402). On success it
  saves photos, records the `change_request`, and — for the bound lead — records an `edit_request`
  event and **`setStatus → replied`**. That drops the lead **back into step F** — the *same* Opus
  rebuild → QA → approval loop the email reply uses. (The two entry points converge.)

### K. Billing → plan active / credits granted
- `/billing` → pick a plan or buy a top-up → Paddle overlay or Stripe redirect → the provider's
  **verified webhook** (`handlePaddleWebhook` / `handleStripeWebhook`) grants access:
  `setAccountPlan(active)` or `addExtraChanges(n)`. Detail: [07 — Billing & Payments](07-BILLING-AND-PAYMENTS.md).

### L. The tail (future) → `reached_pricing → paid → live`
- These states exist in the machine; `link_sent → reached_pricing → paid → live` is the
  monetization tail. The paid→live automation (e.g. provisioning a permanent domain on Premium) is
  future work — see [00 §8](00-SYSTEM-OVERVIEW.md).

---

## The two ways into the rebuild loop (important)

A change can originate from **two** places, and they converge on the **same** `replied → editing →
(approval) → approved` machinery:

1. **Email reply** — `handleReply` classifies an `edit_request` → `replied`.
2. **Portal request** — `POST /api/requests` records an `edit_request` event → `replied`.

Both then run `HANDLERS.replied` (Opus rebuild + QA + approval). This is why the portal's "ask the
AI to change my site" feels identical to replying to the cold email — it *is* the same pipeline.

## Side-exits (reachable from almost anywhere)
`opted_out` (unsubscribe), `bounced`, `dead` (no reply after the sequence), and `needs_human`
(angry / pricing question / QA failure / rejection / **error-cap quarantine**). The tick quarantines
a lead to `needs_human` after `errorCap` (3) consecutive errors at the same stage, instead of
retrying forever. See [02 — Database §5](02-DATABASE.md).

## Modes
- **`review`** (default): every customer-facing send (the reply email) is gated by founder approval.
- **`auto`**: the same sends fire automatically; internal steps (research/build/classify/QA) are
  always automatic.

## Related docs
- [00 — System Overview](00-SYSTEM-OVERVIEW.md) · [02 — Database](02-DATABASE.md) (the state machine)
- Each step links to its subsystem doc above.
