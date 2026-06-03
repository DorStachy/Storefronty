# Stage 2 "Wow-Build" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Note for this project:** the author (Claude, this session) implements it directly — not via subagents — with user checkpoints, per the user's standing preference.

**Goal:** After a local-business owner replies, generate a bespoke, grounded, self-contained website with **Claude Opus 4.8** as an art director — every site looks designed-for-this-business, never templated.

**Architecture:** Opus emits, in one grounded tool call, a `ContentContract` (facts/copy, validated by the existing `validateContract`) **plus** a `DesignSpec` (validated design tokens — palette, fonts, layout, mood). A token→CSS engine generates a full stylesheet from the `DesignSpec`; one semantic template renders the content. Grounding, self-containment (Cloudflare KV), QA, and the deterministic always-ships fallback are all preserved.

**Tech Stack:** Vanilla ESM, Node 22 built-ins, `node:test`. Zero new runtime deps (Anthropic call via the existing `util/net.js` `postJson`, like `fill/opus.js`). Spec: [`docs/superpowers/specs/2026-06-03-stage2-wow-build-design.md`](../specs/2026-06-03-stage2-wow-build-design.md).

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/design/spec.js` | **new** | `DesignSpec` token enums + `FONTS` allow-list + `validateDesignSpec()` (coerce off-list → default) + `DEFAULT_DESIGN` + `designForNiche(niche)` + `googleFontsHref(fonts)`. |
| `src/design/css.js` | **new** | `designToCss(design)` → a complete stylesheet (CSS custom properties + rules for the v3 template's markup), driven entirely by validated tokens. No external `url()` except none (fonts come via `<link>`). |
| `src/design/playbook.js` | **new** | `designBrief(niche)` → a niche-aware design-direction string (distilled Awwwards/Land-book/Mobbin/Dribbble DNA) injected into the Opus prompt. |
| `site/themes/v3/template.html` | **new** | One semantic, token-driven template (hero, story, menu/services, gallery, hours, reviews, contact, CTA). Same `{{token}}` fill convention as the existing themes; `data-layout` on `<body>` toggles structural variants. |
| `src/fill/artdirect.js` | **new** | `applyArtDirection(lead, {change, photos, fetchJson})` → `{ contract, design }`. Mirrors `fill/opus.js`: forced tool-use emitting BOTH objects, key-gated, never throws, deterministic fallback. |
| `src/builder/render.js` | **modify** | Add `renderSiteV3(contract, design, {images})` → `{ html, css }` (fills `v3/template.html`, calls `designToCss`). Leave `renderContract` untouched. |
| `src/builder/build2.js` | **modify** | `writeSite(lead, contract, { design, images })`: when `design` is present, render via `renderSiteV3` and **write the generated CSS** as `theme.css` (instead of copying a static file). |
| `src/qa/index.js` | **modify** | Extend `qaCheck` with: real-facts-present + self-contained (no external `<script>`/non-font `<link>`) checks. |
| `src/orchestrator.js` | **modify** | `replied` handler: swap `applyOpusEdit` → `applyArtDirection`; `writeSite(lead, contract, { design, images })`. |
| `test/design-spec.test.js`, `test/design-css.test.js`, `test/artdirect.test.js`, `test/wow-build.test.js` | **new** | Per-task tests + the end-to-end "always ships, self-contained, grounded" invariant. |

**Test commands:** single file `node --test test/<name>.test.js`; full suite `npm test` (`node --experimental-sqlite --test`).

---

### Task 1: DesignSpec — tokens, allow-list, validator, defaults

**Files:** Create `src/design/spec.js`, `test/design-spec.test.js`.

- [ ] **Step 1: Write the failing test** (`test/design-spec.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDesignSpec, DEFAULT_DESIGN, designForNiche, googleFontsHref, FONTS } from '../src/design/spec.js';

test('valid spec passes through', () => {
  const r = validateDesignSpec({ layout: 'luxe', palette: { bg: '#0b0b0d', ink: '#f5f3ee', accent: '#c8a24a' }, fonts: { display: 'Fraunces', body: 'Inter' }, scale: 'spacious', radius: 'soft', shadow: 'lifted', motion: 'subtle', texture: 'gradient' });
  assert.equal(r.layout, 'luxe');
  assert.equal(r.fonts.display, 'Fraunces');
  assert.equal(r.palette.accent, '#c8a24a');
});

test('off-list values coerce to defaults (never throws)', () => {
  const r = validateDesignSpec({ layout: 'spaceship', fonts: { display: 'Comic Sans MS', body: 'x' }, palette: { bg: 'red', accent: 'javascript:alert(1)' }, motion: 'wild' });
  assert.equal(r.layout, DEFAULT_DESIGN.layout);          // unknown enum → default
  assert.ok(FONTS.display.includes(r.fonts.display));      // off-list font → allowed default
  assert.match(r.palette.bg, /^#[0-9a-f]{3,8}$/i);         // non-hex → default hex
  assert.equal(r.motion, DEFAULT_DESIGN.motion);
});

test('garbage input → full default', () => {
  assert.deepEqual(validateDesignSpec(null), DEFAULT_DESIGN);
});

test('designForNiche gives a complete, valid spec', () => {
  const r = designForNiche('barber');
  assert.deepEqual(validateDesignSpec(r), r); // idempotent → already valid
});

test('googleFontsHref builds a fonts.googleapis link for allowed fonts only', () => {
  const href = googleFontsHref({ display: 'Fraunces', body: 'Inter' });
  assert.match(href, /^https:\/\/fonts\.googleapis\.com\/css2\?/);
  assert.match(href, /Fraunces/);
});
```

- [ ] **Step 2: Run → fail** `node --test test/design-spec.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement** (`src/design/spec.js`)

```js
// Validated design tokens (the "look"). Every field is allow-listed/typed → the model can pick freely
// but can never inject unsafe CSS or non-self-contained references. Off-list/garbage → coerced to a
// sensible default (a spec ALWAYS validates; it never throws). Mirrors the repair-not-reject ethos of
// contract.js.
export const LAYOUTS = ['editorial', 'luxe', 'bold'];
export const SCALES = ['compact', 'comfortable', 'spacious'];
export const RADII = ['sharp', 'soft', 'round'];
export const SHADOWS = ['none', 'subtle', 'lifted'];
export const MOTIONS = ['none', 'subtle'];
export const TEXTURES = ['flat', 'grain', 'gradient'];

// Curated, tasteful Google-Fonts pairings (real, loadable). Index 0 of each is the default.
export const FONTS = {
  display: ['Fraunces', 'Playfair Display', 'Cormorant Garamond', 'Space Grotesk', 'Archivo', 'Bricolage Grotesque', 'Libre Caslon Text'],
  body: ['Inter', 'Source Sans 3', 'Work Sans', 'Newsreader', 'Libre Franklin', 'IBM Plex Sans'],
};

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const DEFAULT_PALETTE = { bg: '#0b0b0d', surface: '#15151a', ink: '#f5f3ee', muted: '#a39e95', accent: '#c8a24a', accentInk: '#0b0b0d' };

export const DEFAULT_DESIGN = {
  layout: 'editorial', palette: { ...DEFAULT_PALETTE },
  fonts: { display: FONTS.display[0], body: FONTS.body[0] },
  scale: 'comfortable', radius: 'soft', shadow: 'subtle', motion: 'subtle', texture: 'flat',
};

const pick = (list, v, dflt) => (list.includes(v) ? v : dflt);
const hex = (v, dflt) => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toLowerCase() : dflt);

export function validateDesignSpec(input) {
  const o = input && typeof input === 'object' ? input : {};
  const p = o.palette && typeof o.palette === 'object' ? o.palette : {};
  const f = o.fonts && typeof o.fonts === 'object' ? o.fonts : {};
  return {
    layout: pick(LAYOUTS, o.layout, DEFAULT_DESIGN.layout),
    palette: {
      bg: hex(p.bg, DEFAULT_PALETTE.bg), surface: hex(p.surface, DEFAULT_PALETTE.surface),
      ink: hex(p.ink, DEFAULT_PALETTE.ink), muted: hex(p.muted, DEFAULT_PALETTE.muted),
      accent: hex(p.accent, DEFAULT_PALETTE.accent), accentInk: hex(p.accentInk, DEFAULT_PALETTE.accentInk),
    },
    fonts: { display: pick(FONTS.display, f.display, FONTS.display[0]), body: pick(FONTS.body, f.body, FONTS.body[0]) },
    scale: pick(SCALES, o.scale, DEFAULT_DESIGN.scale),
    radius: pick(RADII, o.radius, DEFAULT_DESIGN.radius),
    shadow: pick(SHADOWS, o.shadow, DEFAULT_DESIGN.shadow),
    motion: pick(MOTIONS, o.motion, DEFAULT_DESIGN.motion),
    texture: pick(TEXTURES, o.texture, DEFAULT_DESIGN.texture),
  };
}

// A sensible default look per niche (the deterministic fallback's design, and a starting point the
// model can override). Kept small + obviously-valid; validateDesignSpec is idempotent on these.
const NICHE_DESIGN = {
  barber:     { layout: 'bold', palette: { bg: '#101013', surface: '#18181c', ink: '#f3f1ec', muted: '#9b958b', accent: '#c0894a', accentInk: '#101013' }, fonts: { display: 'Archivo', body: 'Work Sans' }, radius: 'sharp', texture: 'grain' },
  restaurant: { layout: 'luxe', palette: { bg: '#0d0b09', surface: '#171310', ink: '#f6efe6', muted: '#b0a394', accent: '#c8a24a', accentInk: '#0d0b09' }, fonts: { display: 'Fraunces', body: 'Newsreader' }, radius: 'soft', texture: 'gradient' },
  yoga:       { layout: 'editorial', palette: { bg: '#faf7f2', surface: '#ffffff', ink: '#23211d', muted: '#6f6a61', accent: '#7c8a6a', accentInk: '#ffffff' }, fonts: { display: 'Cormorant Garamond', body: 'Inter' }, radius: 'round', texture: 'flat' },
};
export function designForNiche(niche) {
  return validateDesignSpec(NICHE_DESIGN[String(niche || '').toLowerCase()] || DEFAULT_DESIGN);
}

export function googleFontsHref({ display, body } = {}) {
  const fam = (n) => `family=${encodeURIComponent(pick([...FONTS.display, ...FONTS.body], n, FONTS.body[0]))}:wght@400;500;600;700`;
  return `https://fonts.googleapis.com/css2?${fam(display)}&${fam(body)}&display=swap`;
}
```

- [ ] **Step 4: Run → pass** `node --test test/design-spec.test.js` → PASS (5/5).
- [ ] **Step 5: Commit** `feat(design): DesignSpec tokens, allow-list, validator, niche defaults`.

---

### Task 2: Token → CSS engine

**Files:** Create `src/design/css.js`, `test/design-css.test.js`.

- [ ] **Step 1: Failing test** (`test/design-css.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { designToCss } from '../src/design/css.js';
import { designForNiche, validateDesignSpec } from '../src/design/spec.js';

test('emits the palette as CSS custom properties', () => {
  const css = designToCss(validateDesignSpec({ palette: { bg: '#101010', accent: '#ff8800' } }));
  assert.match(css, /--bg:\s*#101010/);
  assert.match(css, /--accent:\s*#ff8800/);
  assert.match(css, /font-family/);
});

test('is self-contained: no external url() references', () => {
  const css = designToCss(designForNiche('restaurant'));
  assert.doesNotMatch(css, /url\(\s*['"]?https?:/i); // fonts come via <link>, never @import/url in CSS
});

test('motion:none emits no transitions/animations', () => {
  const css = designToCss(validateDesignSpec({ motion: 'none' }));
  assert.doesNotMatch(css, /transition:/);
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** (`src/design/css.js`) — a complete first version. *Visual polish iterates via the QA screenshot loop (Task 6/8); the structure below is the contract.*

```js
// Generate a full, self-contained stylesheet for site/themes/v3/template.html from validated tokens.
// CSS custom properties hold the palette/scale/radius/shadow; rules below style every element the
// template emits (hero, .menu .item, .gallery .tile, .hours li, blockquote, etc.). No @import / url()
// — fonts arrive via a <link> the renderer injects, keeping the inlined KV blob self-contained.
const SCALE = { compact: { unit: '6px', h1: '2.6rem', pad: '56px' }, comfortable: { unit: '8px', h1: '3.2rem', pad: '88px' }, spacious: { unit: '10px', h1: '4rem', pad: '120px' } };
const RADIUS = { sharp: '0px', soft: '14px', round: '28px' };
const SHADOW = { none: 'none', subtle: '0 1px 2px rgba(0,0,0,.18)', lifted: '0 24px 60px -28px rgba(0,0,0,.55)' };

export function designToCss(d) {
  const s = SCALE[d.scale] || SCALE.comfortable;
  const motion = d.motion === 'subtle';
  const grad = d.texture === 'gradient'
    ? `radial-gradient(1200px 600px at 70% -10%, color-mix(in srgb, var(--accent) 18%, transparent), transparent), var(--bg)`
    : 'var(--bg)';
  return `:root{
  --bg:${d.palette.bg}; --surface:${d.palette.surface}; --ink:${d.palette.ink};
  --muted:${d.palette.muted}; --accent:${d.palette.accent}; --accent-ink:${d.palette.accentInk};
  --radius:${RADIUS[d.radius]}; --shadow:${SHADOW[d.shadow]}; --unit:${s.unit};
  --font-display:'${d.fonts.display}',Georgia,serif; --font-body:'${d.fonts.body}',system-ui,sans-serif;
}
*{box-sizing:border-box} html{scroll-behavior:smooth}
body{margin:0;background:${grad};color:var(--ink);font-family:var(--font-body);line-height:1.6;-webkit-font-smoothing:antialiased}
h1,h2,h3{font-family:var(--font-display);font-weight:600;letter-spacing:-.02em;line-height:1.05;margin:0}
h1{font-size:${s.h1}} a{color:inherit}
.wrap{max-width:1100px;margin:0 auto;padding:0 24px}
section{padding:${s.pad} 0}
.eyebrow{text-transform:uppercase;letter-spacing:.22em;font-size:.72rem;color:var(--accent);font-weight:600}
.hero{min-height:86vh;display:grid;align-items:end;position:relative;overflow:hidden}
.hero-photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero-scrim{position:absolute;inset:0;background:linear-gradient(180deg,transparent,color-mix(in srgb,var(--bg) 92%,transparent))}
.hero .wrap{position:relative;padding-bottom:${s.pad}}
.btn{display:inline-block;background:var(--accent);color:var(--accent-ink);padding:14px 28px;border-radius:999px;text-decoration:none;font-weight:600${motion ? ';transition:transform .2s ease,filter .2s ease' : ''}}
${motion ? '.btn:hover{transform:translateY(-2px);filter:brightness(1.05)}' : ''}
.menu{display:grid;gap:calc(var(--unit)*2)} .item{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid color-mix(in srgb,var(--ink) 12%,transparent);padding:calc(var(--unit)*2) 0}
.item h3{font-size:1.15rem} .item .price{color:var(--accent);font-variant-numeric:tabular-nums;white-space:nowrap}
.gallery{display:grid;grid-template-columns:repeat(3,1fr);gap:calc(var(--unit)*1.5)} .tile{aspect-ratio:4/5;border-radius:var(--radius);overflow:hidden;background:var(--surface);box-shadow:var(--shadow)}
.tile img{width:100%;height:100%;object-fit:cover}
.hours{list-style:none;padding:0;margin:0} .hours li{display:flex;justify-content:space-between;border-bottom:1px solid color-mix(in srgb,var(--ink) 10%,transparent);padding:calc(var(--unit)*1.2) 0}
blockquote{margin:0;background:var(--surface);border-radius:var(--radius);padding:calc(var(--unit)*3);box-shadow:var(--shadow)} cite{display:block;margin-top:12px;color:var(--muted);font-style:normal}
.muted{color:var(--muted)}
@media(max-width:720px){.gallery{grid-template-columns:1fr 1fr}h1{font-size:2.4rem}section{padding:56px 0}}
`;
}
```

- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** `feat(design): token→CSS engine for the v3 template`.

---

### Task 3: The v3 template + niche design playbook

**Files:** Create `site/themes/v3/template.html`, `src/design/playbook.js`, add a render path in `src/builder/render.js`.

- [ ] **Step 1: Create `site/themes/v3/template.html`** — one semantic template using the same `{{token}}` fill, styled entirely by the generated CSS. Tokens: `shopName, eyebrow, tagline, ctaLabel, heroImageHtml, aboutHtml, servicesHtml, hoursHtml, ratingHtml, reviewsHtml, galleryHtml, contactHtml, cssHref, fontsHref, layout`.

```html
<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{shopName}}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="{{fontsHref}}" rel="stylesheet"><link href="{{cssHref}}" rel="stylesheet">
</head><body data-layout="{{layout}}">
<header class="hero">{{heroImageHtml}}<div class="wrap"><p class="eyebrow">{{eyebrow}}</p><h1>{{shopName}}</h1><p class="tagline">{{tagline}}</p><p>{{ratingHtml}}</p><a class="btn" href="#contact">{{ctaLabel}}</a></div></header>
<main class="wrap">
<section id="about">{{aboutHtml}}</section>
<section id="menu"><h2>What we offer</h2><div class="menu">{{servicesHtml}}</div></section>
<section id="gallery"><div class="gallery">{{galleryHtml}}</div></section>
<section id="reviews">{{reviewsHtml}}</section>
<section id="hours"><h2>Hours</h2><ul class="hours">{{hoursHtml}}</ul></section>
<section id="contact"><h2>Visit</h2><div class="muted">{{contactHtml}}</div><a class="btn" href="#">{{ctaLabel}}</a></section>
</main></body></html>
```

- [ ] **Step 2: Failing test** for the playbook (`test/design-css.test.js`, append):

```js
import { designBrief } from '../src/design/playbook.js';
test('designBrief is niche-aware and non-empty', () => {
  const b = designBrief('restaurant');
  assert.ok(b.length > 200);
  assert.match(b, /restaurant|dining|menu/i);
  assert.doesNotMatch(b, /\{\{/); // no leftover template holes
});
```

- [ ] **Step 3: Implement `src/design/playbook.js`**

```js
// The "art-direction north star" injected into the Opus prompt — distilled design DNA (the patterns
// behind Awwwards / Land-book / Mobbin / Dribbble local-business sites), made niche-aware. We do NOT
// fetch those galleries at runtime; we encode the principles. Returns a prompt fragment, never UI.
const UNIVERSAL = [
  'Design like a top studio, not a template: one confident accent color, generous whitespace, a strong',
  'editorial type hierarchy (big confident display headings, calm body), and the shop\'s REAL photography',
  'carrying the hero. Restraint over decoration. High contrast, tasteful. Choose a palette from the',
  'business\'s real vibe and its photos. Pick fonts that match the mood. Avoid generic "bootstrap" looks,',
  'rainbow colors, clip-art, and emoji.',
].join(' ');

const NICHE = {
  restaurant: 'Fine-dining/editorial: moody, warm, appetite-driving. Let food photos dominate; menu reads like a printed card; serif display, deep background.',
  barber: 'Bold, masculine, high-contrast: heavy condensed display, grain/texture, sharp corners, confident accent. Think premium grooming brand.',
  yoga: 'Calm, airy, light: off-white background, soft sage/earth accent, elegant serif display, lots of breathing room.',
  cafe: 'Cozy, hand-made warmth: cream tones, friendly rounded shapes, inviting photography.',
};

export function designBrief(niche) {
  const n = String(niche || '').toLowerCase();
  const specific = NICHE[n] || 'Tailor the palette, type, and density to this specific business and its photos.';
  return `${UNIVERSAL}\n\nFor a ${n || 'local business'}: ${specific}`;
}
```

- [ ] **Step 4: Add `renderSiteV3` to `src/builder/render.js`** (leave `renderContract` untouched):

```js
import { designToCss } from '../design/css.js';
import { googleFontsHref } from '../design/spec.js';

// Token-driven render: same content tokens as renderContract, but the look comes from the DesignSpec
// (generated CSS + Google-Fonts link). Returns { html, css } so writeSite can write the generated CSS.
export async function renderSiteV3(contract, design, { images = [] } = {}) {
  const tpl = await readFile(resolve(THEME_DIR, 'v3', 'template.html'), 'utf8');
  const c = contract;
  const imgs = (Array.isArray(images) ? images : []).filter(Boolean);
  const hero = imgs[0] || null;
  const galleryImgs = (imgs.length > 1 ? imgs.slice(1) : imgs).slice(0, 6);
  const map = {
    shopName: e(c.shopName), eyebrow: e(c.eyebrow || ''), tagline: e(c.tagline),
    cssHref: './theme.css', fontsHref: e(googleFontsHref(design.fonts)), layout: e(design.layout),
    ctaLabel: e(c.cta.label),
    heroImageHtml: hero ? `<img class="hero-photo" src="${e(hero)}" alt="${e(c.shopName)}" loading="eager"><span class="hero-scrim" aria-hidden="true"></span>` : '',
    aboutHtml: c.about.paragraphs.map((p) => `<p>${e(p)}</p>`).join(''),
    servicesHtml: c.services.map((s) => `<div class="item"><div><h3>${e(s.name)}</h3><p class="muted">${e(s.desc)}</p></div>${s.price ? `<span class="price">${e(s.price)}</span>` : ''}</div>`).join(''),
    hoursHtml: c.hours.display.map((d) => `<li><span>${e(d.day)}</span><span>${e(d.value)}</span></li>`).join(''),
    ratingHtml: c.rating.count ? `<span class="star">★</span> ${e(c.rating.stars)} · ${e(c.rating.count)} Google reviews` : '',
    reviewsHtml: (c.reviewHighlights || []).map((r) => `<blockquote>${e(r.quote)}${r.author ? `<cite>${e(r.author)}</cite>` : ''}</blockquote>`).join(''),
    galleryHtml: galleryImgs.length ? galleryImgs.map((src, i) => `<div class="tile"><img src="${e(src)}" alt="${e(c.galleryQueries[i] || c.shopName)}" loading="lazy"></div>`).join('') : c.galleryQueries.slice(0, 3).map((q) => `<div class="tile"><span class="cap">${e(q)}</span></div>`).join(''),
    contactHtml: `${c.contact.addressLines.map((l) => `<div>${e(l)}</div>`).join('')}${c.contact.phone ? `<div><a href="tel:${e(c.contact.phone)}">${e(c.contact.phone)}</a></div>` : ''}`,
  };
  return { html: fill(tpl, map), css: designToCss(design) };
}
```

- [ ] **Step 5: Run → pass; Commit** `feat(design): v3 template + niche playbook + renderSiteV3`.

---

### Task 4: Opus art-director (`fill/artdirect.js`)

**Files:** Create `src/fill/artdirect.js`, `test/artdirect.test.js`. **Reference:** `src/fill/opus.js` (same transport, tool-use, grounding-snapback, key-gating pattern).

- [ ] **Step 1: Failing test** (offline; injected `fetchJson` returns a canned Opus tool-use response)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyArtDirection } from '../src/fill/artdirect.js';
import { validateDesignSpec } from '../src/design/spec.js';

const LEAD = { name: 'Olde Soul Barbershop', niche: 'barber', city: 'Austin', address: '5 Elm St, Austin, TX', phone: '512-555-0100', details: JSON.stringify({ rating: 4.8, reviewCount: 210, hours: ['Monday: 9 AM – 6 PM'] }) };
const fakeOpus = (contract, design) => async () => ({ content: [{ type: 'tool_use', name: 'emit_site', input: { contract, design } }] });

test('parses {contract, design} and validates both', async () => {
  const out = await applyArtDirection(LEAD, { change: 'make it bold and navy', apiKey: 'x',
    fetchJson: fakeOpus(
      { shopName: 'X', tagline: 'Sharp cuts', about: { paragraphs: ['We cut hair well enough to talk about.'] }, services: [{ name: 'Haircut', desc: 'A precise, clean cut tailored to you.' }], hours: { display: [{ day: 'Mon', value: '9–6' }] }, rating: { stars: 4.8, count: 210 }, contact: { addressLines: ['5 Elm St'] }, cta: { label: 'Book' }, galleryQueries: ['barber interior', 'fade', 'beard'] },
      { layout: 'bold', palette: { bg: '#0a0f1a', accent: '#3b6ea5' }, fonts: { display: 'Archivo', body: 'Work Sans' } }) });
  assert.equal(out.contract.shopName, 'Olde Soul Barbershop'); // grounding snaps the real name back
  assert.equal(out.design.layout, 'bold');
  assert.deepEqual(out.design, validateDesignSpec(out.design)); // design is validated
});

test('no key → deterministic fallback (contract + niche design), never throws', async () => {
  const out = await applyArtDirection(LEAD, { change: 'x' }); // no apiKey
  assert.equal(out.contract.shopName, 'Olde Soul Barbershop');
  assert.equal(out.design.layout, validateDesignSpec(out.design).layout);
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement `src/fill/artdirect.js`** — structurally a clone of `fill/opus.js` with a two-property tool schema. Key points (full code written at implementation, mirroring opus.js exactly):
  - System prompt = `buildFactSheet(lead).sheet` + the edit-mode grounding rules (copied from `opus.js` `systemPrompt`) **+** `designBrief(lead.niche)` **+** "emit BOTH a grounded `contract` and a `design` via the `emit_site` tool."
  - Tool `emit_site` with `input_schema = { type:'object', properties:{ contract: <contractSchema from opus.js>, design: <designSchema> }, required:['contract','design'] }`, `tool_choice:{type:'tool',name:'emit_site'}`.
  - `designSchema` enumerates the DesignSpec (string enums for layout/scale/radius/shadow/motion/texture; `palette` object of hex strings; `fonts` object). It only STEERS; `validateDesignSpec` is the gate.
  - On response: `extractTool('emit_site')` → `{ contract, design }`. Then: `applyGroundTruth(contract, facts, mentionedFacts(change))` + `contract.schemaVersion = CONTRACT_VERSION` + `validateContract` (reuse opus.js helpers — extract them to a shared `fill/anthropic.js` if cleaner) and `validateDesignSpec(design)`.
  - Any failure (no key, network, no tool_use, invalid contract) → `{ contract: fillDeterministic(lead), design: designForNiche(lead.niche) }`.
  - Public `applyArtDirection(lead, { change, photos=[], ...opts })`: reads `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL` (default `claude-opus-4-8`), wires `postJson`, `opts.fetchJson` override for tests.

```js
// (skeleton — mirror fill/opus.js for the transport + grounding helpers)
import { buildFactSheet } from './grounding.js';
import { fillDeterministic } from './deterministic.js';
import { validateContract, CONTRACT_VERSION } from '../contract/contract.js';
import { validateDesignSpec, designForNiche, LAYOUTS, SCALES, RADII, SHADOWS, MOTIONS, TEXTURES } from '../design/spec.js';
import { designBrief } from '../design/playbook.js';
import { postJson } from '../util/net.js';
// ... ENDPOINT, ANTHROPIC_VERSION, contractSchema(), systemPrompt(), userMessage(), applyGroundTruth(),
//     mentionedFacts(), extractTool() — same as opus.js, with the emit_site two-property tool.
export async function applyArtDirection(lead, { change, photos = [], ...opts } = {}) {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
  const fallback = () => ({ contract: fillDeterministic(lead), design: designForNiche(lead.niche) });
  if (!apiKey) return fallback();
  try {
    const { sheet, allowedServices, facts } = buildFactSheet(lead);
    const fetchJson = opts.fetchJson || ((url, o) => postJson(url, JSON.parse(o.body), { headers: o.headers }));
    const resp = await fetchJson(ENDPOINT, { method: 'POST', headers: HEADERS(apiKey), body: JSON.stringify(buildBody({ sheet, allowedServices, niche: lead.niche, change, photos, model: opts.model ?? process.env.ANTHROPIC_MODEL })) });
    const tool = extractTool(resp, 'emit_site');
    if (!tool || typeof tool !== 'object') return fallback();
    const cRaw = tool.contract && typeof tool.contract === 'object' ? tool.contract : {};
    applyGroundTruth(cRaw, facts, mentionedFacts(change));
    cRaw.schemaVersion = CONTRACT_VERSION;
    const cv = validateContract(cRaw);
    return { contract: cv.ok ? cv.value : fillDeterministic(lead), design: validateDesignSpec(tool.design) };
  } catch { return fallback(); }
}
```

- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** `feat(fill): Opus art-director — emits grounded {contract, design}`.

---

### Task 5: writeSite renders via DesignSpec (generated CSS)

**Files:** Modify `src/builder/build2.js`. **Test:** `test/wow-build.test.js` (new).

- [ ] **Step 1: Failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { writeSite, PUBLIC_DIR, slugFor } from '../src/builder/build2.js';
import { fillDeterministic } from '../src/fill/deterministic.js';
import { designForNiche } from '../src/design/spec.js';

test('writeSite with a design writes the v3 site + generated theme.css (bespoke palette)', async () => {
  const lead = { name: 'Thicket Food Park', niche: 'restaurant', city: 'Austin', address: '9 Oak, Austin, TX', details: JSON.stringify({ rating: 4.7, reviewCount: 88, hours: ['Monday: 11 AM – 9 PM'] }) };
  const design = designForNiche('restaurant');
  const r = await writeSite(lead, fillDeterministic(lead), { design });
  const dir = join(PUBLIC_DIR, slugFor(lead));
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const css = readFileSync(join(dir, 'theme.css'), 'utf8');
  assert.match(html, /Thicket Food Park/);
  assert.match(html, /fonts\.googleapis\.com/);          // fonts link injected
  assert.match(css, new RegExp(design.palette.accent));  // generated CSS carries the chosen accent
  assert.equal(r.engine, 'theme-v3');
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run → fail** (writeSite ignores `design`).

- [ ] **Step 3: Implement** — extend `writeSite` in `build2.js`:

```js
import { renderSiteV3 } from './render.js';
import { validateDesignSpec } from '../design/spec.js';

export async function writeSite(lead, contract, { theme, design, images = [] } = {}) {
  const r = validateContract(contract);
  if (!r.ok) throw new Error(`contract invalid: ${r.errors.join(', ')}`);
  const slug = slugFor(lead);
  const dir = join(PUBLIC_DIR, slug);
  mkdirSync(dir, { recursive: true });
  const htmlPath = join(dir, 'index.html');

  if (design) {                                   // Phase-2 wow-build: token-driven, generated CSS
    const d = validateDesignSpec(design);
    const { html, css } = await renderSiteV3(r.value, d, { images });
    writeFileSync(join(dir, 'theme.css'), css);
    writeFileSync(htmlPath, html);
    return { engine: 'theme-v3', slug, layout: d.layout, theme: 'v3', htmlPath };
  }

  // Legacy path (cold-build Stage 1) — unchanged.
  const requestedTheme = theme || themeForNiche(lead.niche);
  const renderedTheme = existsSync(join(THEME_DIR, requestedTheme, 'template.html')) ? requestedTheme : 'editorial';
  const { html } = await renderContract(r.value, renderedTheme, { cssHref: './theme.css', images });
  copyFileSync(join(THEME_DIR, renderedTheme, 'theme.css'), join(dir, 'theme.css'));
  writeFileSync(htmlPath, html);
  return { engine: 'theme', slug, requestedTheme, renderedTheme, theme: renderedTheme, htmlPath };
}
```

- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** `feat(builder): writeSite renders via DesignSpec with generated CSS`.

---

### Task 6: QA — facts-present + self-contained checks

**Files:** Modify `src/qa/index.js` (current interface: `qaCheck({ htmlPath }) -> { ok, issues:[{type,...}] }`, used at `orchestrator.js:128`).

- [ ] **Step 1: Failing test** (`test/wow-build.test.js`, append) — read the built HTML, assert qaCheck catches a missing shop name and an external script. Use a tiny temp HTML fixture for the negative cases so the test is fast/offline (no real browser needed for the static checks).

```js
import { staticQa } from '../src/qa/index.js'; // NEW pure helper (no browser) for fact + self-contained checks
test('staticQa flags missing facts and external scripts', () => {
  const ok = staticQa('<h1>Olde Soul Barbershop</h1>', { mustInclude: ['Olde Soul Barbershop'] });
  assert.equal(ok.ok, true);
  const bad = staticQa('<h1>Wrong</h1><script src="https://evil.example/x.js"></script>', { mustInclude: ['Olde Soul Barbershop'] });
  assert.equal(bad.ok, false);
  assert.ok(bad.issues.some((i) => i.type === 'missing_fact'));
  assert.ok(bad.issues.some((i) => i.type === 'external_script'));
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** — add a pure `staticQa(html, { mustInclude })` helper to `qa/index.js` and call it from `qaCheck` after the existing render check:
  - `missing_fact` — any `mustInclude` string (the shop name; the phone if present) not found in the HTML.
  - `external_script` — any `<script ... src="http...">` present (the site must be self-contained; legit inlined `<script>` with no `src` is allowed but the v3 template has none).
  - `external_link` — any `<link ... href="http...">` whose host is NOT `fonts.googleapis.com`/`fonts.gstatic.com` (fonts are the only allowed external).
  - `qaCheck` passes `mustInclude:[contract.shopName, contract.contact.phone].filter(Boolean)` — wire the caller (orchestrator) to pass them, OR have qaCheck read them from an optional `{ facts }` arg. Keep `qaCheck`'s existing browser render check intact; `staticQa` is additive.

```js
export function staticQa(html, { mustInclude = [] } = {}) {
  const issues = [];
  for (const f of mustInclude) if (f && !html.includes(f)) issues.push({ type: 'missing_fact', fact: f });
  if (/<script\b[^>]*\bsrc=["']https?:/i.test(html)) issues.push({ type: 'external_script' });
  for (const m of html.matchAll(/<link\b[^>]*\bhref=["'](https?:\/\/[^"']+)["']/gi)) {
    if (!/^https:\/\/fonts\.(googleapis|gstatic)\.com/i.test(m[1])) issues.push({ type: 'external_link', href: m[1] });
  }
  return { ok: issues.length === 0, issues };
}
```

- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** `feat(qa): static facts-present + self-contained checks`.

---

### Task 7: Orchestrator — swap the `replied` handler to the art-director

**Files:** Modify `src/orchestrator.js` (`replied` handler, lines 124–139).

- [ ] **Step 1: Failing test** (`test/wow-build.test.js`, append) — drive the `replied` handler with an in-memory DB + a stubbed `applyArtDirection` (inject via the handler's existing DI, or test through `tick` with `ANTHROPIC_API_KEY` unset so it uses the deterministic fallback) and assert: a site is built (v3 engine), QA passes, and the lead advances to `pending_approval` (review mode). Mirror the existing replied-path tests.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** — in the `replied` handler, replace:

```js
const change = latestChange(db, lead.id);
const { contract, design } = await applyArtDirection(lead, { change, photos: [], ...{} });
const built = await writeSite(lead, contract, { design, images: await leadImages(lead, config) });
const facts = [contract.shopName, contract.contact?.phone].filter(Boolean);
const qa = await qaCheck({ htmlPath: built.htmlPath, mustInclude: facts });
if (!qa.ok) { db.setStatus(lead.id, 'needs_human', { reason: 'qa_failed', issues: qa.issues.map((i) => i.type) }); return; }
db.addSite(lead.id, { slug: built.slug, engine: built.engine, htmlPath: built.htmlPath });
db.setStatus(lead.id, 'editing', { change });
if (config.mode === 'auto') { db.setStatus(lead.id, 'approved', { change }); return; }
const previewPath = `${(config.publicBaseUrl || '').replace(/\/$/, '')}/${built.slug}/`;
await notifyFounder(composeFounderApproval(lead, { change, previewPath, config }), config);
db.setStatus(lead.id, 'pending_approval', { change });
```

(Imports: `import { applyArtDirection } from './fill/artdirect.js';` replaces the `applyOpusEdit`/`fillDeterministic`/`writeSite`-only edit path. `writeSite` already imported.)

- [ ] **Step 4: Run → pass.** Then full suite `npm test` → all green (confirm no Stage-1 cold-build regression).
- [ ] **Step 5: Commit** `feat(orchestrator): reply → Opus art-director wow-build`.

---

### Task 8: End-to-end invariant + golden builds

**Files:** `test/wow-build.test.js` (append).

- [ ] **Step 1: "Always ships, grounded, self-contained" test** — for 3 golden leads (steakhouse, barber, yoga), with `ANTHROPIC_API_KEY` unset (deterministic path): `applyArtDirection` → `writeSite({design})` → assert the built `index.html` contains the real shop name + has no external `<script>` and no non-font external `<link>` (via `staticQa`), and `theme.css` is non-empty. Guarantees the fallback always yields a valid, self-contained, grounded site.

- [ ] **Step 2: Run → pass.**

- [ ] **Step 3: Manual visual pass (not a unit test).** With `ANTHROPIC_API_KEY` set, build the 3 golden leads, screenshot via the existing `screenshotForEmail`, eyeball them. Iterate `design/css.js` + `v3/template.html` until they look genuinely premium. (Design is iterative — the QA loop is where the CSS gets its polish.)

- [ ] **Step 4: Commit** `test(wow-build): always-ships + grounded + self-contained invariant`.

---

## Self-Review

**Spec coverage:** ✅ Art-director (T4) · DesignSpec validated tokens (T1) · token→CSS engine (T2) · v3 template + niche playbook (T3) · grounding snap-back reused (T4) · self-contained (generated CSS + fonts-link only; T2/T6) · QA (T6) · deterministic fallback (T4/T8) · orchestrator swap (T7) · richer sections present in v3 template (T3). Plan-gated B-lite/B-full = out of scope (spec §non-goals). ✅

**Placeholder scan:** Visual CSS polish in T8 step 3 is explicitly an iterative design step (screenshot loop), not a code placeholder — every code file has a complete first version. The `artdirect.js` body references helpers "same as opus.js"; those are real, named functions in the existing file — at implementation, factor the shared ones (`contractSchema`, `systemPrompt`, `applyGroundTruth`, `mentionedFacts`, `extractTool`) into `fill/anthropic.js` and import in both, to stay DRY.

**Type consistency:** `DesignSpec` fields (`layout/palette/fonts/scale/radius/shadow/motion/texture`) are identical across spec.js, css.js, render.js, artdirect.js, build2.js. `writeSite(lead, contract, { design, images })` and `qaCheck({ htmlPath, mustInclude })` signatures match across T5/T6/T7. `engine:'theme-v3'` consistent (T5/T7).

## Risks / notes
- **DRY:** extract the shared Anthropic helpers from `opus.js` into `fill/anthropic.js` (T4) so `opus.js` (legacy small-edit, still used elsewhere?) and `artdirect.js` don't duplicate. Confirm `applyOpusEdit` has no other callers before removing it (grep).
- **CSS polish is iterative** — Tasks 1–7 deliver a *correct, bespoke, self-contained* site; Task 8 step 3 is where it becomes *beautiful*. Budget real time there with screenshots.
- **No new runtime deps.**
