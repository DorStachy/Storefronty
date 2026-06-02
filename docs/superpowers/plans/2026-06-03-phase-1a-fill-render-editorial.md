# Phase 1A — Fill→Render Core (Content Contract + Editorial Theme) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a shop's real Google data into a beautiful, truthful **Editorial**-theme HTML page, entirely offline (no LLM, no network), behind a strict content contract — the foundation every other Phase-1 piece plugs into.

**Architecture:** A theme-agnostic **content contract** (plain JS object, validated + repaired by a hand-rolled validator — no new deps) is produced by a **deterministic fill** (`lead → contract`) and slotted into a **theme** (HTML template + CSS) by a **renderer** (`contract + theme → html`). Phase 1B later swaps the deterministic fill for a cheap LLM, keeping this one as the fallback. The model never writes HTML; the theme owns all quality.

**Tech Stack:** Node 22 (ESM, built-ins only — no new runtime deps), `node:test`, the existing `app/src/util/html.js` (`escapeHtml`/`safeUrl`). Design reference: the spec's theme tokens (`docs/superpowers/specs/2026-06-03-storefronty-improvement-plan-design.md` §5.1) + the Editorial research spec.

**Reuse / conventions:** Follow existing `app/src/*` patterns — small focused modules, dependency-injected IO, `escapeHtml` on every interpolated value, `node:test` + `assert/strict`. Run tests with `node --experimental-sqlite --test` (the cera npm shim is not involved — `node` is the real binary).

---

### Task 1: Content contract — schema + validate/repair

**Files:**
- Create: `app/src/contract/contract.js`
- Test: `app/test/contract.test.js`

The contract is the single shape every theme renders from. We hand-roll a tiny field-spec validator (no Zod — keep zero deps). Validation **repairs** where it can (truncate over-length strings at a word boundary; drop invalid array items) and reports what it changed.

- [ ] **Step 1: Write the failing test**

```js
// app/test/contract.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateContract, CONTRACT_VERSION } from '../src/contract/contract.js';

const good = {
  schemaVersion: CONTRACT_VERSION,
  shopName: 'Silva’s',
  tagline: 'Sharp fades and classic cuts in San Marcos.',
  about: { paragraphs: ['A neighborhood barbershop in San Marcos, known for clean fades.'] },
  services: [{ name: 'Haircut', desc: 'A personalized cut, classic to modern.' }],
  hours: { display: [{ day: 'Tue', value: '7:15 AM – 6:00 PM' }] },
  rating: { stars: 4.6, count: 103 },
  contact: { addressLines: ['1138 Invasion St', 'San Marcos, TX 78666'] },
  cta: { label: 'Book a Cut' },
  galleryQueries: ['barbershop interior', 'fade haircut', 'beard trim'],
};

test('a well-formed contract validates unchanged', () => {
  const r = validateContract(good);
  assert.equal(r.ok, true);
  assert.equal(r.value.shopName, 'Silva’s');
  assert.equal(r.repairs.length, 0);
});

test('over-length strings are truncated at a word boundary, not rejected', () => {
  const long = 'x '.repeat(80).trim(); // ~160 chars, tagline max is 90
  const r = validateContract({ ...good, tagline: long });
  assert.equal(r.ok, true);
  assert.ok(r.value.tagline.length <= 90);
  assert.ok(r.repairs.some((m) => m.includes('tagline')));
});

test('a missing required field fails', () => {
  const { shopName, ...noName } = good;
  const r = validateContract(noName);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('shopName')));
});

test('invalid service items are dropped, valid ones kept', () => {
  const r = validateContract({ ...good, services: [{ name: 'OK', desc: 'A real description here.' }, { name: '' }] });
  assert.equal(r.ok, true);
  assert.equal(r.value.services.length, 1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --experimental-sqlite --test app/test/contract.test.js`
Expected: FAIL — `Cannot find module '../src/contract/contract.js'`.

- [ ] **Step 3: Write the minimal implementation**

```js
// app/src/contract/contract.js
// The theme-agnostic content contract + a tiny hand-rolled validator/repairer (no deps).
// Strings are length-bounded; over-length is truncated at a word boundary (repaired, not rejected).
export const CONTRACT_VERSION = '1.0';

const truncate = (s, max) => {
  s = String(s).trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trim() + '…';
};

// Field spec: [required, maxLen]. Arrays + nested objects handled explicitly below.
export function validateContract(input) {
  const repairs = [];
  const errors = [];
  const o = input && typeof input === 'object' ? input : {};
  const out = { schemaVersion: CONTRACT_VERSION };

  const str = (key, val, max, required) => {
    if (val == null || val === '') { if (required) errors.push(`missing ${key}`); return undefined; }
    const t = truncate(val, max);
    if (t !== String(val).trim()) repairs.push(`${key} truncated to ${max}`);
    return t;
  };

  out.shopName = str('shopName', o.shopName, 80, true);
  if (o.eyebrow) out.eyebrow = str('eyebrow', o.eyebrow, 40);
  out.tagline = str('tagline', o.tagline, 90, true);

  const paras = Array.isArray(o.about?.paragraphs) ? o.about.paragraphs.filter((p) => p && String(p).trim()) : [];
  if (!paras.length) errors.push('missing about.paragraphs');
  out.about = { paragraphs: paras.slice(0, 3).map((p) => truncate(p, 320)) };
  if (o.about?.heading) out.about.heading = str('about.heading', o.about.heading, 60);

  const svc = (Array.isArray(o.services) ? o.services : [])
    .filter((s) => s && String(s.name || '').trim().length >= 2 && String(s.desc || '').trim().length >= 10)
    .slice(0, 8)
    .map((s) => {
      const item = { name: truncate(s.name, 48), desc: truncate(s.desc, 160) };
      if (s.price) item.price = truncate(s.price, 24);
      return item;
    });
  if (!svc.length) errors.push('services must have at least 1 valid item');
  out.services = svc;

  const days = Array.isArray(o.hours?.display) ? o.hours.display.filter((d) => d?.day && d?.value).slice(0, 7) : [];
  if (!days.length) errors.push('missing hours.display');
  out.hours = { display: days.map((d) => ({ day: d.day, value: truncate(d.value, 40) })) };

  if (!o.rating || typeof o.rating.stars !== 'number' || typeof o.rating.count !== 'number') errors.push('missing rating');
  else { out.rating = { stars: Math.round(o.rating.stars * 10) / 10, count: Math.trunc(o.rating.count) };
         if (o.rating.blurb) out.rating.blurb = str('rating.blurb', o.rating.blurb, 100); }

  if (Array.isArray(o.reviewHighlights)) {
    out.reviewHighlights = o.reviewHighlights.filter((q) => q?.quote && String(q.quote).trim().length >= 10)
      .slice(0, 3).map((q) => { const h = { quote: truncate(q.quote, 200) }; if (q.author) h.author = truncate(q.author, 40); return h; });
  }

  const addr = Array.isArray(o.contact?.addressLines) ? o.contact.addressLines.filter(Boolean).slice(0, 3) : [];
  if (!addr.length) errors.push('missing contact.addressLines');
  out.contact = { addressLines: addr.map((l) => truncate(l, 80)) };
  if (o.contact?.phone) out.contact.phone = truncate(o.contact.phone, 24);
  if (o.contact?.areaServed) out.contact.areaServed = truncate(o.contact.areaServed, 80);

  if (!o.cta?.label) errors.push('missing cta.label');
  else out.cta = { label: truncate(o.cta.label, 28), ...(o.cta.kind ? { kind: o.cta.kind } : {}) };

  const gq = (Array.isArray(o.galleryQueries) ? o.galleryQueries : []).filter((q) => q && String(q).trim().length >= 3).slice(0, 8);
  if (gq.length < 3) errors.push('galleryQueries needs at least 3');
  out.galleryQueries = gq.map((q) => truncate(q, 60));

  if (o.accentHint) out.accentHint = o.accentHint;
  if (o.toneHint) out.toneHint = o.toneHint;

  return errors.length ? { ok: false, errors, repairs } : { ok: true, value: out, repairs };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --experimental-sqlite --test app/test/contract.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/contract/contract.js app/test/contract.test.js
git commit -m "feat(contract): theme-agnostic content contract + hand-rolled validate/repair"
```

---

### Task 2: Deterministic fill — `lead → contract`

**Files:**
- Create: `app/src/fill/deterministic.js`
- Test: `app/test/fill-deterministic.test.js`

Builds a valid contract from a DB lead using only its real fields (Places `details` JSON: rating, reviewCount, hours, primaryType; plus name/city/address/phone). Niche-default services come from a small allow-list (truthful: generic category services, never invented specifics). This is also Phase 1B's fallback.

- [ ] **Step 1: Write the failing test**

```js
// app/test/fill-deterministic.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillDeterministic } from '../src/fill/deterministic.js';
import { validateContract } from '../src/contract/contract.js';

const lead = {
  name: 'Silva’s', niche: 'barbershop', city: 'San Marcos, TX',
  address: '1138 Invasion St c, San Marcos, TX 78666, USA', phone: '(512) 392-3050',
  details: JSON.stringify({ rating: 4.6, reviewCount: 103, primaryType: 'Barber shop',
    hours: ['Monday: Closed', 'Tuesday: 7:15 AM – 6:00 PM', 'Saturday: 8:00 AM – 3:00 PM', 'Sunday: Closed'] }),
};

test('deterministic fill yields a valid, truthful contract', () => {
  const c = fillDeterministic(lead);
  const r = validateContract(c);
  assert.equal(r.ok, true, r.errors?.join(', '));
  assert.equal(r.value.shopName, 'Silva’s');               // copied verbatim
  assert.equal(r.value.rating.stars, 4.6);                       // copied
  assert.equal(r.value.rating.count, 103);
  assert.ok(r.value.services.length >= 1);
  assert.ok(r.value.hours.display.some((d) => d.value.includes('7:15')));  // real hours
  assert.ok(r.value.galleryQueries.length >= 3);
});

test('missing details still produces a valid contract', () => {
  const r = validateContract(fillDeterministic({ name: 'Plain Co', niche: 'cafe', city: 'Austin, TX' }));
  assert.equal(r.ok, true, r.errors?.join(', '));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --experimental-sqlite --test app/test/fill-deterministic.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the minimal implementation**

```js
// app/src/fill/deterministic.js
// lead -> ContentContract using ONLY the lead's real fields. Never invents specifics.
import { CONTRACT_VERSION } from '../contract/contract.js';

const DAY3 = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };
const SERVICES = {
  barbershop: ['Haircuts', 'Fades', 'Beard Trim', 'Hot Towel Shave'],
  'nail salon': ['Manicure', 'Pedicure', 'Gel Nails', 'Nail Art'],
  'hair salon': ['Haircuts', 'Color', 'Styling', 'Blowouts'],
  cafe: ['Coffee', 'Pastries', 'Breakfast', 'Lunch'],
  'food truck': ['Tacos', 'Sides', 'Drinks'],
  gym: ['Memberships', 'Personal Training', 'Group Classes'],
};
const GALLERY = {
  barbershop: ['barbershop interior', 'fade haircut', 'hot towel shave', 'vintage barber chair'],
  cafe: ['cafe interior morning light', 'latte art', 'fresh pastries', 'coffee beans'],
};
const fallbackServices = ['Our Services', 'What We Offer', 'Visit Us'];

const desc = (name) => `${name} for our customers.`;

export function fillDeterministic(lead) {
  const det = lead.details ? (typeof lead.details === 'string' ? safeJson(lead.details) : lead.details) : {};
  const niche = (lead.niche || '').toLowerCase();
  const category = det.primaryType || titleCase(niche) || 'Local Business';
  const city = lead.city || '';

  const services = (SERVICES[niche] || fallbackServices).slice(0, 5).map((n) => ({ name: n, desc: desc(n) }));

  const display = (Array.isArray(det.hours) ? det.hours : [])
    .map((line) => { const m = String(line).match(/^([A-Za-z]+):\s*(.+)$/); return m && DAY3[m[1].toLowerCase()] ? { day: DAY3[m[1].toLowerCase()], value: m[2] } : null; })
    .filter(Boolean);

  return {
    schemaVersion: CONTRACT_VERSION,
    shopName: lead.name,
    eyebrow: city ? `${category} in ${city.split(',')[0]}` : category,
    tagline: `${category}${city ? ` in ${city.split(',')[0]}` : ''}.`,
    about: { paragraphs: [
      `${lead.name} is a ${category.toLowerCase()}${city ? ` in ${city}` : ''}.` +
      (det.rating ? ` Rated ${det.rating} stars across ${det.reviewCount || 0} reviews.` : ''),
    ] },
    services,
    hours: { display: display.length ? display : [{ day: 'Mon', value: 'Call for hours' }] },
    rating: { stars: Number(det.rating) || 0, count: Number(det.reviewCount) || 0 },
    contact: { addressLines: addrLines(lead.address, city), ...(lead.phone ? { phone: lead.phone } : {}), ...(city ? { areaServed: city } : {}) },
    cta: { label: 'Get in Touch', kind: 'call' },
    galleryQueries: GALLERY[niche] || [`${niche || 'local business'} interior`, `${niche || 'local business'} detail`, 'storefront'],
  };
}

function addrLines(address, city) {
  if (!address) return [city || 'Contact us'];
  const parts = String(address).split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 2 ? [parts[0], parts.slice(1, 3).join(', ')] : parts.length ? parts : [city || 'Contact us'];
}
const titleCase = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const safeJson = (s) => { try { return JSON.parse(s); } catch { return {}; } };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --experimental-sqlite --test app/test/fill-deterministic.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/fill/deterministic.js app/test/fill-deterministic.test.js
git commit -m "feat(fill): deterministic lead->contract fill (truthful, zero-dep, the LLM fallback)"
```

---

### Task 3: Niche → theme map

**Files:**
- Create: `app/src/themes/map.js`
- Test: `app/test/themes-map.test.js`

- [ ] **Step 1: Write the failing test**

```js
// app/test/themes-map.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { themeForNiche } from '../src/themes/map.js';

test('niches map to the right theme; unknown -> editorial', () => {
  assert.equal(themeForNiche('barbershop'), 'luxe');
  assert.equal(themeForNiche('Nail Salon'), 'editorial');
  assert.equal(themeForNiche('food truck'), 'bold');
  assert.equal(themeForNiche('cafe'), 'editorial');
  assert.equal(themeForNiche('something weird'), 'editorial');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --experimental-sqlite --test app/test/themes-map.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Write the minimal implementation**

```js
// app/src/themes/map.js
// Niche -> theme name. Default editorial (most versatile). See spec design doc 5.1.
const MAP = {
  editorial: ['hair salon', 'nail salon', 'salon', 'beauty', 'spa', 'cafe', 'coffee', 'bakery', 'florist', 'boutique', 'gift'],
  luxe: ['barbershop', 'barber', 'tattoo', 'steakhouse', 'bar', 'lounge', 'fine dining'],
  bold: ['gym', 'fitness', 'food truck', 'plumber', 'electrician', 'landscaper', 'cleaner', 'auto', 'trade', 'contractor'],
};
export function themeForNiche(niche) {
  const n = String(niche || '').toLowerCase();
  for (const [theme, keys] of Object.entries(MAP)) if (keys.some((k) => n.includes(k))) return theme;
  return 'editorial';
}
export const THEMES = ['editorial', 'luxe', 'bold'];
```

- [ ] **Step 4: Run it to verify it passes** — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/themes/map.js app/test/themes-map.test.js
git commit -m "feat(themes): niche->theme mapping"
```

---

### Task 4: The Editorial theme (template + CSS)

**Files:**
- Create: `app/site/themes/editorial/template.html` (the HTML skeleton with `{{token}}` slots + `{{#each}}`-style section markers rendered by Task 5)
- Create: `app/site/themes/editorial/theme.css`
- Test: covered by Task 5's renderer test (no unfilled tokens, AA tokens present).

This is the design-heavy task. **Build it during execution using the `frontend-design` (or `ui-ux-pro-max`) skill**, against the exact tokens in the spec design doc §5.1 (Theme A — Editorial) and the full Editorial research spec. Hard requirements the renderer test will assert:

- The template uses **only** these top-level slots: `{{shopName}} {{eyebrow}} {{tagline}} {{aboutHtml}} {{servicesHtml}} {{hoursHtml}} {{ratingHtml}} {{reviewsHtml}} {{galleryHtml}} {{contactHtml}} {{ctaLabel}} {{cssHref}}` (Task 5 produces the `*Html` fragments).
- CSS variables in `theme.css` match the spec palette exactly: `--bone:#FAF6EF; --cream:#F4ECE0; --espresso:#2B2018; --terracotta:#C0623E; --rust:#8C3F22; --gold:#C9A24B; --line:#DACBB6;` plus the Fraunces+Inter `@import`/`<link>`, the type scale, spacing scale, and the `prefers-reduced-motion` + `html:not(.js)` fallbacks (ship verbatim from the research spec).
- Sections: sticky nav · type-led hero (eyebrow + italic Fraunces headline + rating line + CTA) · trust strip · services cards · hours · gallery · reviews · location · CTA band · footer.
- AA contrast, ≥44px tap targets, visible focus, mobile-first.

- [ ] **Step 1:** Invoke `frontend-design` and build `template.html` + `theme.css` to the tokens/structure above. Render a sample in the browser (`npm run serve`) and eyeball against the spec until it reads premium.
- [ ] **Step 2: Commit**

```bash
git add app/site/themes/editorial/
git commit -m "feat(themes): editorial theme template + css (warm editorial, per spec 5.1)"
```

---

### Task 5: Renderer — `contract + theme → html`

**Files:**
- Create: `app/src/builder/render.js`
- Test: `app/test/render.test.js`

Slots a validated contract into a theme template. Builds the `*Html` fragments (services cards, hours rows, reviews, gallery placeholders, etc.), escaping every interpolated value with the existing `escapeHtml`. Gallery slots render as labeled placeholders for now (Phase 1's imagery wiring fills real URLs later); the renderer must leave **no** `{{token}}` behind.

- [ ] **Step 1: Write the failing test**

```js
// app/test/render.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderContract } from '../src/builder/render.js';
import { fillDeterministic } from '../src/fill/deterministic.js';
import { validateContract } from '../src/contract/contract.js';

const contract = validateContract(fillDeterministic({
  name: 'Fade Theory', niche: 'barbershop', city: 'Austin, TX', phone: '(512) 555-0148',
  details: JSON.stringify({ rating: 4.8, reviewCount: 214, primaryType: 'Barber shop', hours: ['Monday: 9 AM – 7 PM'] }),
})).value;

test('renders editorial with real data and no leftover tokens', async () => {
  const { html } = await renderContract(contract, 'editorial');
  assert.ok(!html.includes('{{'), 'no unfilled tokens');
  assert.ok(html.includes('Fade Theory'));
  assert.ok(html.includes('4.8'));            // rating surfaced
  assert.ok(/Fades?/.test(html));             // a service surfaced
  assert.ok(html.includes('href') && html.toLowerCase().includes('styles') === false); // css linked via theme
});

test('escapes an untrusted shop name (no XSS)', async () => {
  const evil = validateContract(fillDeterministic({ name: '<script>alert(1)</script>', niche: 'cafe', city: 'Austin' })).value;
  const { html } = await renderContract(evil, 'editorial');
  assert.ok(!html.includes('<script>alert(1)'));
  assert.ok(html.includes('&lt;script&gt;'));
});
```

- [ ] **Step 2: Run it to verify it fails** — Expected: FAIL (module not found).

- [ ] **Step 3: Write the minimal implementation**

```js
// app/src/builder/render.js
// contract + theme -> a complete HTML page. The contract is trusted-shape (validated) but its
// string VALUES are untrusted (from Google/the model), so every value is escapeHtml'd.
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml } from '../util/html.js';

const here = dirname(fileURLToPath(import.meta.url));
const THEME_DIR = resolve(here, '..', '..', 'site', 'themes');

const e = escapeHtml;
const fill = (tpl, map) => tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in map ? map[k] : ''));

export async function renderContract(contract, theme = 'editorial', { cssHref = './theme.css' } = {}) {
  const tpl = await readFile(resolve(THEME_DIR, theme, 'template.html'), 'utf8');
  const c = contract;
  const map = {
    shopName: e(c.shopName), eyebrow: e(c.eyebrow || ''), tagline: e(c.tagline), cssHref: e(cssHref),
    ctaLabel: e(c.cta.label),
    aboutHtml: c.about.paragraphs.map((p) => `<p>${e(p)}</p>`).join(''),
    servicesHtml: c.services.map((s) =>
      `<div class="card"><h3>${e(s.name)}</h3>${s.price ? `<span class="price">${e(s.price)}</span>` : ''}<p>${e(s.desc)}</p></div>`).join(''),
    hoursHtml: c.hours.display.map((d) => `<li><span>${e(d.day)}</span><span>${e(d.value)}</span></li>`).join(''),
    ratingHtml: c.rating.count ? `★ ${e(c.rating.stars)} · ${e(c.rating.count)} Google reviews` : '',
    reviewsHtml: (c.reviewHighlights || []).map((r) =>
      `<blockquote>${e(r.quote)}${r.author ? `<cite>${e(r.author)}</cite>` : ''}</blockquote>`).join(''),
    galleryHtml: c.galleryQueries.slice(0, 3).map((q) =>
      `<div class="tile" data-query="${e(q)}"><span class="cap">${e(q)}</span></div>`).join(''),
    contactHtml: `${c.contact.addressLines.map((l) => `<div>${e(l)}</div>`).join('')}${c.contact.phone ? `<div>${e(c.contact.phone)}</div>` : ''}`,
  };
  return { html: fill(tpl, map), theme };
}
```

- [ ] **Step 4: Run it to verify it passes** — Expected: PASS (2 tests). (Requires Task 4's template to exist.)

- [ ] **Step 5: Commit**

```bash
git add app/src/builder/render.js app/test/render.test.js
git commit -m "feat(builder): contract->theme renderer (escaped, no leftover tokens)"
```

---

### Task 6: `buildSiteV2(lead)` — wire fill + render, write files

**Files:**
- Create: `app/src/builder/build2.js`
- Test: `app/test/build2.test.js`

A drop-in that mirrors the current `build()` shape (`{ slug, htmlPath, ... }`) but goes through fill→render. Keeps the existing `build()` untouched for now (Phase 1F switches the orchestrator over). Writes to `app/public/<slug>/index.html` + copies the theme css.

- [ ] **Step 1: Write the failing test**

```js
// app/test/build2.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSiteV2 } from '../src/builder/build2.js';

test('buildSiteV2 writes a rendered editorial page for a barbershop lead', async () => {
  const r = await buildSiteV2({ name: 'QA Barbers', niche: 'barbershop', city: 'Austin, TX',
    details: JSON.stringify({ rating: 4.5, reviewCount: 40, primaryType: 'Barber shop', hours: ['Monday: 9 AM – 5 PM'] }) });
  assert.equal(r.slug, 'qa-barbers');
  assert.equal(r.theme, 'luxe');                          // barbershop -> luxe
  const html = readFileSync(r.htmlPath, 'utf8');
  assert.ok(!html.includes('{{'));
  assert.ok(html.includes('QA Barbers'));
});
```

> Note: `theme` is `'luxe'` for a barbershop, but Luxe's template ships in Plan 1C. For 1A, **fall back to the editorial template when a theme's template file is missing**, and assert `r.requestedTheme === 'luxe'` while `r.renderedTheme === 'editorial'`. Adjust the test to those field names.

- [ ] **Step 2: Run it to verify it fails** — Expected: FAIL (module not found).

- [ ] **Step 3: Write the minimal implementation**

```js
// app/src/builder/build2.js
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fillDeterministic } from '../fill/deterministic.js';
import { validateContract } from '../contract/contract.js';
import { themeForNiche } from '../themes/map.js';
import { renderContract } from './render.js';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(here, '..', '..', 'public');
const THEME_DIR = resolve(here, '..', '..', 'site', 'themes');
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function buildSiteV2(lead, { fill = fillDeterministic } = {}) {
  const requestedTheme = themeForNiche(lead.niche);
  const renderedTheme = existsSync(join(THEME_DIR, requestedTheme, 'template.html')) ? requestedTheme : 'editorial';
  const r = validateContract(fill(lead));
  if (!r.ok) throw new Error(`contract invalid: ${r.errors.join(', ')}`);
  const { html } = await renderContract(r.value, renderedTheme, { cssHref: './theme.css' });

  const slug = slugify(lead.name) || `lead-${lead.id || 'x'}`;
  const dir = join(PUBLIC_DIR, slug);
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(THEME_DIR, renderedTheme, 'theme.css'), join(dir, 'theme.css'));
  const htmlPath = join(dir, 'index.html');
  writeFileSync(htmlPath, html);
  return { engine: 'theme', slug, requestedTheme, renderedTheme, theme: renderedTheme, htmlPath };
}
```

- [ ] **Step 4: Run it to verify it passes** — Expected: PASS.

- [ ] **Step 5: Run the FULL suite to confirm no regressions**

Run: `node --experimental-sqlite --test`
Expected: all green (existing 133 + the new tests).

- [ ] **Step 6: Commit**

```bash
git add app/src/builder/build2.js app/test/build2.test.js
git commit -m "feat(builder): buildSiteV2 wires fill->validate->render->write (editorial fallback)"
```

---

### Task 7: Live smoke — render Silva's real data and eyeball it

**Files:** none (manual verification)

- [ ] **Step 1:** From `app/`, run a one-off:

```bash
node --experimental-sqlite -e "import('./src/builder/build2.js').then(async m => { const r = await m.buildSiteV2({ name: \"Silva's\", niche: 'barbershop', city: 'San Marcos, TX', address: '1138 Invasion St, San Marcos, TX 78666', phone: '(512) 392-3050', details: JSON.stringify({ rating: 4.6, reviewCount: 103, primaryType: 'Barber shop', hours: ['Tuesday: 7:15 AM – 6:00 PM','Saturday: 8:00 AM – 3:00 PM'] }) }); console.log(r.htmlPath, r.renderedTheme); })"
```

- [ ] **Step 2:** `npm run serve`, open `http://localhost:4173/silva-s/`, confirm it renders premium, real data present, no broken layout. (Note: until Plan 1C, the barbershop renders in the **editorial** fallback theme — that's expected.)
- [ ] **Step 3:** Report what the live render revealed (the brief's "every live run catches something").

---

## Self-Review

- **Spec coverage (§5.1, §5.2, §5.7):** content contract ✓ (T1), deterministic fill = the truthful fallback ✓ (T2), niche→theme map ✓ (T3), Editorial theme ✓ (T4), renderer (model never writes HTML; values escaped) ✓ (T5), builder refactor wired DI + offline-testable ✓ (T6). Cheap-LLM fill, Luxe/Bold, screenshots, email, pipeline are **out of scope for 1A by design** (Plans 1B–1F).
- **No placeholders:** every code step has complete code; Task 4 is explicitly a design-skill execution task with exact token/slot requirements + a renderer test that enforces "no leftover tokens."
- **Type consistency:** `validateContract → {ok,value,errors,repairs}` used consistently (T1/T2/T6); `renderContract(contract, theme) → {html, theme}` (T5/T6); `buildSiteV2 → {slug, requestedTheme, renderedTheme, htmlPath}` (T6/T7); contract field names identical across fill, validator, renderer.
- **DI / offline:** fill is injectable into `buildSiteV2` (lets 1B drop in the LLM fill); no network in any 1A test.

---
```
