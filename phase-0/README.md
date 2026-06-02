# Phase 0 — Concierge Proof (USA / English / cold email)

> **Goal:** Prove that US local shop owners will **pay** for a done-for-you website, by doing everything
> **by hand** for ~100 shops — and walk away with the winning template, the winning email, and real
> funnel numbers.
>
> **Budget:** ~$50–150 (1–2 warmed inboxes) + ~$300 one-time US-LLC setup if you go that route.
> **Timeline:** ~2–4 weeks. **Channel:** cold B2B email (CAN-SPAM). **Language:** English.

---

## Decision gate (when do we go to Phase 1?)

From ~100–300 cold emails:
- **≥ 3 paying customers**, OR
- a repeatable signal: **≥ ~3% reply rate** AND **≥ 1–3 sales**.

→ then we automate (Phase 1). If not, we change the offer / niche / email before spending on automation.

---

## Before you send a single email — the setup

1. **Entity + payments (pick one):**
   - **US LLC** (doola / Firstbase, ~$300) → unlocks native **Stripe**, gives you the **US postal address
     CAN-SPAM requires**, and makes you "a real US company." *(Recommended.)*
   - **Merchant-of-Record** (Paddle / Lemon Squeezy) → accepts you as an Israeli seller, handles US sales
     tax, near-zero setup, slightly higher fees. *(Fastest to start.)*
2. **Sending domain:** buy a **separate** `.com` (not your main brand domain), set up **SPF + DKIM +
   DMARC**, and **warm it up ~2–3 weeks** at low volume before real sends.
3. **A real physical US address** for the email footer (your LLC's registered-agent address works).

---

## The split-test

Same channel, two niches — to learn which converts better:

| Half | Niche | Template |
|---|---|---|
| A (~50) | Barbershops / salons / beauty | `site/templates/barbershop.html` |
| B (~50) | Cafés / restaurants | `site/templates/cafe.html` |

Track each half separately. Same emails, niche-swapped wording.

---

## The funnel (every step manual in Phase 0)

1. **Find** a US shop with **no website** (Google Maps; see `sourcing-checklist.md`) + grab a real email.
2. **Pre-build** a demo site from public info → screenshot it.
3. **Cold email** (CAN-SPAM-compliant) with the screenshot → *"reply with one change and I'll send you the live link."*
4. **They reply** → apply their change (Claude regenerates) → send the **live link**.
5. Link → the **pricing page** (`site/pricing.html`): one more free edit + **"Make it yours"** → **Stripe link**.
6. **They pay** → register their domain (Porkbun) + point it at the live site → done.
7. **Follow up** at Day 3 and Day 8 (auto-stop on reply or unsubscribe).

**Principle — money follows interest.** The expensive/polished work only happens for people who reply.

---

## ⚖️ Compliance — CAN-SPAM (easy, just do it)

Every email must have: ✅ accurate From/headers · ✅ a non-deceptive subject · ✅ a valid **physical
postal address** · ✅ a clear **working unsubscribe**, honored within **10 business days**. No prior
consent needed. Keep a permanent **suppression list** and check it before every send.

---

## Pricing ($ — positioning, not cost-recovery; adjust freely)

| | **Starter** | **Pro** ⭐ | **Premium** |
|---|---|---|---|
| Monthly | **$29/mo** | **$49/mo** | **$99/mo** |
| Annual | $290/yr | $490/yr | $990/yr |
| Best for | barbers, trades | restaurants, cafés, salons | boutiques, brands |
| Pages | polished 1-page | multi-section | full multi-page |
| Edits | unlimited | priority | priority + SEO |
| Domain | free `.com`-class | free / upgraded | premium domain incl. |

> Pro ($49) is **half of Hibu's $99 floor** → frames us as the bargain done-for-you option.
> Setup free; 14-day "love it or leave it" guarantee.

---

## Who does what

**You (Michael):** set up the LLC/MoR + sending domain · source leads (`sourcing-checklist.md` +
`lead-tracker.csv`) · send the emails · reply to & close interested owners (I can draft replies) ·
click "buy" on the Stripe links I set up.

**Me (Claude):** built the two templates (`site/templates/`) + the pricing/Wizard-of-Oz page
(`site/pricing.html`) · the cold-email sequence (`outreach-en.md`) · this tracker & checklist ·
I generate each shop's demo site + screenshot + apply edit requests when you feed me the shop info.

---

## Files in this kit

- `README.md` — this plan
- `outreach-en.md` — the cold-email sequence + reply handling + objection answers
- `sourcing-checklist.md` — how to find + qualify 100 US no-website leads (and their emails)
- `lead-tracker.csv` — the spreadsheet to run the whole operation
- `../site/templates/barbershop.html`, `../site/templates/cafe.html` — the two demo templates
- `../site/pricing.html` — the pricing + "one more free edit" (Wizard-of-Oz) page
