# Phase 0 — Concierge Proof (Israel / Hebrew / hyper-local)

> **Goal:** Prove that real local shop owners will **pay** for a done-for-you website, by doing
> everything **by hand** for ~100 shops in one city — and walk away with the winning template,
> the winning script, and real funnel numbers.
>
> **Budget:** ~₪0 until someone buys (then ~₪20–40 domain + Stripe fee per sale).
> **Timeline:** ~2–3 weeks. **Channel:** in-person + phone + consented WhatsApp. **Language:** Hebrew, RTL.

---

## The decision gate (when do we go to Phase 1?)

From ~100 *real conversations/pitches*:
- **≥ 3 paying customers**, **OR**
- a clearly repeatable "yes" rate (≥ ~15% say "send me the link", ≥ ~5% reach payment)

→ then we automate (Phase 1). If not, we change the offer/niche/city before spending on automation.

---

## The split-test

Same city, same founder, two niches — to learn which converts better:

| Half | Niche | Hebrew | Template |
|---|---|---|---|
| A (~50) | Barbershops / salons / beauty | מספרות, מכוני יופי, ציפורניים | `site/templates/barbershop.html` |
| B (~50) | Cafés / restaurants | בתי קפה, מסעדות | `site/templates/cafe.html` |

Track each half separately in the tracker. Same scripts, niche-swapped wording.

---

## The funnel (every step is manual in Phase 0)

1. **Find** an Instagram-only / no-website shop in your city *(see `sourcing-checklist.md`)*.
2. **Pre-build** a site from public info → take a screenshot on your phone.
3. **Walk in / call** → show them the screenshot → **"reply with one change and I'll send you the live link."**
   - **Capture consent** to message them (required by law — see below) and log it.
4. **Apply their one change** (Claude regenerates) → send the **live link** by WhatsApp.
5. Link → the **pricing page** (`site/pricing.html`) with one more free edit + **"קחו את האתר"** button → **Stripe payment link**.
6. **They pay** → you register their domain (Porkbun) + point it at the live site → done.
7. **Follow up** (only the consented ones) at Day 3 and Day 8.

**Principle — money follows interest.** You only do the expensive/polished work for people who raise their hand.

---

## ⚖️ Compliance (do this — it's the law)

Israel Amendment 40 §30A: **no commercial message without prior consent.** So:
- First contact is **in person or a personal phone call** (both allowed — not "advertisement-by-system").
- Before sending **any** WhatsApp/SMS/email, **ask and get a clear "yes"** ("אפשר לשלוח לך בוואטסאפ את הקישור והעדכונים?") and **log it** in the tracker (date + "consent: yes").
- Every message includes a way to **opt out** ("אם לא מעניין, תכתוב לי 'הסר' ולא אטריד יותר"). Honor it instantly and forever.
- Keep it personal and low-volume; do **not** blast.

---

## Pricing (₪ — positioning, not cost-recovery; adjust freely)

| | **בסיסי / Starter** | **מקצועי / Pro** ⭐ | **פרימיום / Premium** |
|---|---|---|---|
| Monthly | **₪49/חודש** | **₪99/חודש** | **₪159/חודש** |
| Annual | ₪490/שנה | ₪990/שנה | ₪1,590/שנה |
| Best for | מספרות, ברברים | מסעדות, בתי קפה, מכוני יופי | בוטיקים, מותגים |
| Pages | עמוד אחד מלוטש | מרובה-מקטעים | אתר מלא רב-עמודי |
| Edits | שינויים ללא הגבלה | בעדיפות | בעדיפות + SEO |
| Domain | `.co.il` חינם | `.co.il` חינם / `.com` מוזל | `.com` כלול |

> Setup is free (you eat the small domain cost on conversion). 14-day "love it or leave it" guarantee.
> One-time domain markup on `.com` upgraders (~₪35–60/yr) is extra margin.

---

## Who does what

**You (Michael — founder):** confirm city · source the leads (`sourcing-checklist.md` + `lead-tracker.csv`) ·
do the walk-ins/calls · capture consent · talk to & close repliers · click "buy" on Stripe links I set up.

**Me (Claude):** built the two RTL templates (`site/templates/`) + the pricing/Wizard-of-Oz page
(`site/pricing.html`) · the Hebrew scripts (`outreach-he.md`) · this tracker & checklist ·
I generate each shop's site + apply edit requests when you feed me the shop info · set up the Stripe link structure.

---

## Files in this kit

- `README.md` — this plan
- `outreach-he.md` — all the Hebrew scripts (walk-in, phone, consent, WhatsApp reveal, follow-ups, objections)
- `sourcing-checklist.md` — how to find + qualify 100 leads in your city
- `lead-tracker.csv` — the spreadsheet to run the whole operation
- `../site/templates/barbershop.html`, `../site/templates/cafe.html` — the two demo templates
- `../site/pricing.html` — the pricing + "one more free edit" (Wizard-of-Oz) page
