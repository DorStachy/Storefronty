# 04 — Site Builder (Source of Truth)

> **Scope:** how a `lead` becomes a finished, themed website on disk — the content contract, the
> three fill layers (deterministic / cheap-LLM / Opus-edit), grounding, themes, rendering, the QA
> gate, the section screenshotter, and the deployer.
> **Code:** [`builder/`](../../app/src/builder/), [`fill/`](../../app/src/fill/),
> [`contract/contract.js`](../../app/src/contract/contract.js), [`themes/map.js`](../../app/src/themes/map.js),
> [`qa/`](../../app/src/qa/index.js), [`screenshot/`](../../app/src/screenshot/index.js),
> [`deployer/`](../../app/src/deployer/index.js), [`util/html.js`](../../app/src/util/html.js).
> **Last verified against code:** 2026-06-03.

---

## 1. The pipeline

```
lead ──fill──▶ ContentContract ──validate──▶ render(theme) ──▶ app/public/<slug>/index.html + theme.css
        (3 layers)     (contract.js gate)      (render.js)             (build2.writeSite)
```

Two entry points, both ending in `writeSite`:

- **Fresh build** (orchestrator `discovered` handler): `buildSiteV2(lead, {fill: fillLead})` —
  cheap-LLM copywriting from the shop's real Google data.
- **Reply-edit rebuild** (orchestrator `replied` handler): `applyOpusEdit(lead, {baseContract:
  fillDeterministic(lead), change})` → `writeSite(lead, revisedContract)` — Claude Opus applies the
  owner's requested change.

**Invariant: a site ALWAYS ships.** Every LLM path falls back to `fillDeterministic` on any failure
(no key, network error, malformed JSON, invalid contract). The validator is the real gate, not the
model.

---

## 2. The ContentContract (`contract/contract.js`)

A **theme-agnostic intermediate representation** of a site's content — the contract between "what
to say" (fill) and "how it looks" (render). `CONTRACT_VERSION = '1.0'`.

Shape (required ✦): `shopName✦`, `eyebrow`, `tagline✦`, `about✦{heading?, paragraphs[≤3]}`,
`services✦[≤8]{name, desc, price?}`, `hours✦{display[≤7]{day, value}}`, `rating✦{stars, count,
blurb?}`, `reviewHighlights[≤3]{quote, author?}`, `contact✦{addressLines[≤3], phone?, areaServed?}`,
`cta✦{label, kind?}`, `galleryQueries✦[≥3,≤8]`, `accentHint?`, `toneHint?`.

`validateContract(input)` is a **dependency-free validator/repairer**:
- **Repairs, doesn't reject, over-length strings** — truncates at a word boundary (each field has a
  max length, e.g. `shopName` 80, `tagline` 90, `about.paragraphs` 320, `service.desc` 160).
- **Filters junk** — services need a name ≥ 2 chars and a desc ≥ 10 chars; review quotes ≥ 10 chars.
- **Rejects only on missing required fields** → `{ok:false, errors}`. Otherwise `{ok:true, value,
  repairs}`.

`galleryQueries` are **search queries** ("barbershop interior"), never URLs — the renderer turns
them into captioned tiles.

---

## 3. The three fill layers (`fill/`)

### 3.1 `fillDeterministic(lead)` — the floor (always works, never lies)
`lead → ContentContract` using **only the lead's real fields**; invents nothing. Uses the
`SERVICES` whitelist (per-niche service names) and `GALLERY` query lists, parses Google hours lines
(`"Monday: 7 AM – 6 PM"` → `{day:'Mon', value:'7 AM – 6 PM'}`), and builds address lines. This is
the fallback for both LLM layers and the base contract for edits.

### 3.2 `fillLead(lead)` — fresh-build copywriting (Gemini 2.5 Flash-Lite)
`fill/llm.js`. Key-gated by **`GEMINI_API_KEY`** (no key → `fillDeterministic`, no network). Sends a
**fact sheet** + an **allowed-services whitelist** and a JSON `responseSchema` mirroring the
contract; the model emits **JSON only** (never HTML). Then:
1. `applyGroundTruth` overwrites the **copied** fields (name/hours/rating/address/phone) from the
   verified facts — a model hallucination in those can never reach the page.
2. `validateContract` truncates/length-bounds and structurally checks.
3. On any failure → `fillDeterministic`.

### 3.3 `applyOpusEdit(lead, {baseContract, change, photos})` — reply-edit (Claude Opus)
`fill/opus.js`. Key-gated by **`ANTHROPIC_API_KEY`** (model `ANTHROPIC_MODEL`, default
`claude-opus-4-8`). The owner replied asking for a change; Opus edits the **current** contract via a
forced `emit_contract` tool call, keeping everything not mentioned.

The subtle part is **edit-aware grounding**. A reply can *legitimately correct* a truthful fact
("we close at 7 now"). So:
- `mentionedFacts(change)` keyword-detects which fact groups (`hours`, `rating`, `contact`, `name`)
  the owner referenced.
- `applyGroundTruth` snaps **untouched** truthful fields back to ground truth (the model can't
  silently lie), but **keeps the model's owner-corrected value** for any group the owner mentioned.
- On any failure → `fillDeterministic` (the change is then left for the founder to tune in review
  mode).

### 3.4 Grounding (`fill/grounding.js`)
`buildFactSheet(lead)` → `{facts, allowedServices, sheet}`. The `sheet` is a human-readable
"VERIFIED FACTS (the ONLY facts that exist)" block; **unknown values become explicit "unknown (do
not state …)" lines** rather than being omitted ambiguously. `allowedServices` is reused verbatim
from `deterministic.js` (one source of truth — no drift). Review snippets, when present, are passed
so the model can quote **near-verbatim** and is told to fabricate nothing.

> Anti-hallucination is enforced in **three** places: the prompt (grounding rules), `applyGroundTruth`
> (stamp ground truth over copied fields), and `validateContract` (structure + length). A site that
> can't be validated falls back to deterministic — it never ships broken or invented.

---

## 4. Themes (`themes/map.js`) + assets

`themeForNiche(niche)` picks one of three themes by keyword, defaulting to **editorial**:

| Theme | Niches |
|---|---|
| `editorial` (default, most versatile) | salons, beauty, spa, cafe, coffee, bakery, florist, boutique, gift |
| `luxe` | barbershop, barber, tattoo, steakhouse, bar, lounge, fine dining |
| `bold` | gym, fitness, food truck, trades (plumber, electrician, landscaper, auto, contractor) |

Theme assets live at **`app/site/themes/<theme>/`** — a `template.html` (with `{{token}}`
placeholders) + a `theme.css`. `writeSite` defensively falls back to `editorial` if a requested
theme's `template.html` is missing.

---

## 5. Rendering (`builder/render.js`)

`renderContract(contract, theme, {cssHref})` reads the theme's `template.html` and fills `{{token}}`
placeholders. **Every interpolated value is `escapeHtml`'d** — the contract's *shape* is validated
but its string *values* are untrusted (from Google / the model), so this prevents stored XSS via a
lead field. It builds section HTML fragments: `aboutHtml`, `servicesHtml` (cards with optional
price), `hoursHtml`, `ratingHtml` (`★ N · M Google reviews`, hidden when count is 0), `reviewsHtml`
(blockquotes), `galleryHtml` (`.tile[data-query]` — the first 3 gallery queries as captioned
placeholders), `contactHtml`.

## 6. Writing files (`builder/build2.js`)

`writeSite(lead, contract, {theme?})`:
1. Resolve the theme (`themeForNiche` or override), defensively fall back to `editorial`.
2. `validateContract` — **throws** if invalid (the caller's fill layer should have produced a valid
   one; deterministic always does).
3. `renderContract` → HTML.
4. `slug = slugify(lead.name)`; write `app/public/<slug>/index.html` and copy the theme's
   `theme.css` next to it.
5. Return `{engine:'theme', slug, requestedTheme, renderedTheme, htmlPath}`.

`buildSiteV2(lead, {fill})` = `writeSite(lead, await fill(lead))`. The older `builder/index.js`
`build()` is the legacy generator this superseded; the orchestrator uses `buildSiteV2`.

---

## 7. QA gate (`qa/index.js`) — Playwright

Before a customized (reply-edit) site ships, `qaCheck({htmlPath})` crawls the built page headlessly
and returns `{ok, issues, checked}`. Issue types:

| type | check |
|---|---|
| `console_error` | any `console.error` or uncaught page exception during load |
| `broken_image` | an `<img>` whose `naturalWidth` is 0 |
| `bad_link` | an `<a href>` that's empty, a lone `#`, or `javascript:` (internal `#anchor` is fine) |
| `leftover_token` | rendered HTML still contains `{{` |
| `mobile_overflow` | horizontal scroll at 390px width (2px slack) |

A **broken page is a normal RESULT** (`ok:false`), not an exception — only an infra error (no
browser) propagates. In the `replied` handler, **`qa.ok === false` quarantines the lead to
`needs_human`** rather than shipping broken. Offline Google-Fonts do *not* trip `console_error`
(failed subresources are network events, not console errors).

---

## 8. Section screenshotter (`screenshot/index.js`) — Playwright

The cold email carries **screenshots, not a live link**. `screenshotForEmail({htmlPath, outDir,
hasReviews})` captures 3 section shots:
- **`planShots`** picks `hero`, `services`, and a third of `reviews` (strongest social proof) or
  `gallery` (fallback when the deterministic fill produced no reviews).
- **`captureSections`** launches Chromium (injectable `launch` for tests), navigates `file://`,
  waits for `document.fonts.ready`, and screenshots each section element (selectors in
  `SECTION_SELECTORS` — every theme keeps these ids/classes). Returns `[{name, path, ok}]`.
- **`shotsFromDir(dir)`** reads already-captured shots back in canonical order (hero, services,
  reviews|gallery) so the email step attaches them without re-running the browser.

The orchestrator `built` handler runs this, requires ≥ 1 shot to succeed, stores the dir on the
site, and advances to `deployed`.

---

## 9. Deployer (`deployer/index.js`)

`deploy(lead, site, config)` returns `{previewUrl, expiresAt, engine}`:
- **`local`** (default, `HOSTING_ENGINE=local`): files already live under `app/public/<slug>/`; it
  just computes the URL the static server exposes (`<publicBaseUrl>/<slug>/`).
- **`cloudflare`**: real Cloudflare Workers + KV-TTL expiry — **same contract, swapped internals** —
  throws until `CLOUDFLARE_API_TOKEN` + zone are set (see [PORTAL_DEPLOY.md](../superpowers/PORTAL_DEPLOY.md)).

`expiresAt` = now + `HOSTING_ENGINE` `previewHours` (default **48h**) — the bounded preview window.
The orchestrator `approved` handler calls this and stamps `setSiteLive(siteId, {previewUrl,
expiresAt})`.

---

## 10. Security touchpoints
- `escapeHtml` on every rendered value; `safeUrl` neutralizes non-`http/https/tel/mailto` hrefs to
  `#` ([`util/html.js`](../../app/src/util/html.js)).
- All outbound LLM calls go through SSRF-safe `postJson` ([`util/net.js`](../../app/src/util/net.js)).
- See [08 — Auth & Security](08-AUTH-AND-SECURITY.md).

## 11. Related docs
- [03 — Researcher & Discovery](03-RESEARCHER-AND-DISCOVERY.md) — produces the enriched `lead`.
- [05 — Email & Outreach](05-EMAIL-AND-OUTREACH.md) — consumes the screenshots + live URL.
- [01 — End-to-End Flow](01-END-TO-END-FLOW.md) — where each step sits.
