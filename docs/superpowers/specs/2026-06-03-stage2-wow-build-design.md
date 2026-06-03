# Stage 2 "Wow-Build" — Bespoke Site Generation (Design Spec)

**Date:** 2026-06-03
**Status:** Draft — awaiting user review
**Component:** `app/` (Storefronty pipeline)

## Goal

After a local-business owner **replies** to the cold email, generate a fully functional\*, amazing-looking, **tailored** website — not a small edit — using **Claude Opus 4.8** as an "art director," while preserving the three hard guarantees: **grounded** (real facts only), **self-contained HTML** (Cloudflare KV 48h hosting), and **always-ships** (deterministic fallback).

> \*v1 "functional" = beautiful + content-rich + **working links** (click-to-call, email, Google Maps, menu/catalog display, gallery). Submitting forms and online ordering are **later, plan-gated** features (see Tiering).

## Where it fits (the funnel)

`cold email (Gemini template) → owner replies → THIS wow-build → live 48h link + claim link (Email 2) → claim (free account) → pay`

This **replaces the current small-edit rebuild** (`applyOpusEdit`) at the orchestrator's `replied` stage. The reply email (Email 2), the founder-approval gate (review mode), the Cloudflare KV hosting, and the claim flow are all **unchanged**.

## Plan tiering (business context — drives what's gated later, not v1)

| | Free (claim) | Starter $29 | Pro $49 | Premium $99 |
|---|---|---|---|---|
| Beautiful tailored site (A) | ✅ | ✅ | ✅ | ✅ |
| Lead-capture form (B-lite) — emails the owner | — | — | ✅ | ✅ |
| Ordering / reservations (B-full) | — | — | — | ✅ |
| Custom domain | — | — | — | ✅ |
| Monthly changes | 1 free | 3 | 15 | unlimited |

**v1 builds A only** (everyone gets it — it's the sales demo they play with before paying). B-lite and B-full are future phases.

## Architecture — Approach 3 (hybrid)

In **one grounded Opus call**, the model returns two things via forced tool-use:

1. **ContentContract** — the grounded content (their real menu, hours, reviews, story). Same contract as today.
2. **DesignSpec** — the *bespoke look*, chosen for this specific business, as **validated tokens** (not raw CSS).

A **design-system renderer** composes `ContentContract + DesignSpec` into self-contained HTML. **Opus designs; our system guarantees the facts and the safety.**

### Components

| # | File | Status | Responsibility |
|---|---|---|---|
| 1 | `fill/grounding.js` (`buildFactSheet`) | reuse | Real facts + allowed-services whitelist + review snippets + photo refs. |
| 2 | `fill/artdirect.js` | **new** (mirrors `fill/opus.js`) | Opus(facts + owner change + niche playbook) → `{ contract, design }` via forced tool-use. Key-gated (`ANTHROPIC_API_KEY`, model `claude-opus-4-8`). NEVER throws → falls back to deterministic contract + default DesignSpec. |
| 3 | `design/spec.js` | **new** | DesignSpec schema + validator. Every value allow-listed: palette = hex; fonts = curated Google-Fonts set; layout/mood = enums. Off-list → coerced to default. XSS- and self-contained-safe **by construction**. |
| 4 | `design/playbook.js` | **new** | Curated, **niche-aware design DNA** distilled from Awwwards / Land-book / Mobbin / Dribbble principles. Maps niche → tone, palette direction, type pairing guidance, layout family, do/don'ts. Fed to Opus as its north star (we do NOT fetch those galleries at runtime). |
| 5 | `builder/render.js` | **extend** | `(contract, design)` → CSS custom properties (`--bg/--ink/--accent`, font families, spacing scale, radii, shadow depth, motion) + section composition per layout variant → HTML. The 3 existing themes become **layout families** the DesignSpec selects and recolors/retypes. |
| 6 | sections (in renderer) | **extend** | hero (real photo + scrim) · menu/catalog · gallery (real photos) · story/about · hours + "open now" · reviews wall · strong CTA. Composed per DesignSpec. |
| 7 | grounding enforcement (`applyGroundTruth` pattern) | reuse/extend | Content fields snap back to verified facts (model can't invent a price/hour); DesignSpec tokens validated against allowlists. Facts come ONLY from the contract; design ONLY from validated tokens. |
| 8 | `deployer/inline.js` (`inlineSite`) | reuse | CSS inlined, real photos → data-URLs, Google-Fonts `<link>` left external → one HTML blob for KV. |
| 9 | `qa/index.js` | **extend** | Headless render + checks: renders, responsive (mobile + desktop), real facts present, images load, no console errors, valid/closed HTML. Fail → fallback (or `needs_human` in review mode). |
| 10 | `fill/deterministic.js` + default DesignSpec | reuse/extend | Opus fail / invalid output / QA fail → deterministic contract + niche-default DesignSpec. **A site always ships.** |

### Data flow

```
lead(replied)
  → buildFactSheet(lead)
  → artDirect(facts, ownerChange, playbook)        # Opus 4.8, one call
  → { contract, design }
  → validate(contract ground-snap, design allowlist)
  → render(contract, design, realPhotos)           # design-system renderer
  → inlineSite(...)                                 # self-contained HTML
  → qaCheck(html)
       pass → writeSite + advance to approval gate (review) / approved (auto)
       fail → render(deterministicContract, defaultDesign) → needs_human (review) / ship default (auto)
```

### Orchestrator change

The `replied` handler ([orchestrator.js:124](../../../app/src/orchestrator.js)) swaps `applyOpusEdit(...)` for `artDirect(...)` (returning `{contract, design}`), then `writeSite(lead, contract, { design, images })`, then the existing QA → `editing` → `pending_approval` (review) / `approved` (auto) path. **Nothing downstream changes** (approval, Email 2, KV deploy, claim).

## Error handling

- Every LLM / render / QA failure degrades to the **deterministic fallback** — a valid, self-contained site always ships.
- Opus errors are caught; invalid/garbage `contract` or `design` → defaults.
- Token-allowlist validation structurally prevents unsafe or non-self-contained output (no arbitrary CSS, no external calls).
- QA fail in **review mode** → `needs_human` (founder fixes); **auto mode** → ship the deterministic default.

## Testing

- **Unit:** DesignSpec validation (good/bad hex, off-list fonts, bad enums → coerced to default); renderer (tokens → CSS vars, section composition); grounding snap-back (a design change can't alter a fact); each fallback path.
- **Integration:** golden leads (steakhouse, barbershop, yoga studio) → build → assert **self-contained** (no external `src` except the fonts link), **real facts present**, valid HTML, QA passes. Offline via injected `fetchJson` returning a canned Opus response.
- **Invariant — "a site always ships":** no key / network error / garbage Opus output / QA fail → still a valid HTML site out.
- **Visual (manual):** screenshot a few golden builds for an eyeball pass during the build.

## v1 scope / non-goals

- **In:** Opus art-director (`contract` + `DesignSpec`), token-driven design-system renderer, the richer sections, grounding / self-contained / QA / fallback, niche-aware inspiration playbook.
- **Out (later, plan-gated):** B-lite lead forms (Pro), B-full ordering/reservations (Premium), custom domains, multi-page sites, raw-CSS bespoke ("3b"). **One gorgeous page for v1.**

## Future / open

- **"3b" raw sanitized CSS** as an optional future toggle if validated tokens ever feel limiting (~90% of the wow is in the tokens; revisit only if needed).
- Expand the niche playbook over time as we see real outputs.
