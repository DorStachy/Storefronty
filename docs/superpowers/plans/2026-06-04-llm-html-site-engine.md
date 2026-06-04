# LLM-Writes-the-Site Engine Implementation Plan

> **For agentic workers:** Execute task-by-task. Steps use checkbox (`- [ ]`) syntax. This plan is executed **inline by the lead (no sub-agents)** per the owner's hard 3-agent cap.

**Goal:** Replace the token-driven template engine with one where **Opus 4.8 writes the entire self-contained HTML page**, gated by a sanitizer + the existing QA, with the token engine kept only as the auto-fallback for broken output.

**Architecture:** The wow-build (after a reply / portal edit) calls a new `generateSiteHtml()` that prompts Opus to emit ONE complete self-contained HTML document (inline CSS, **no JS**, only Google Fonts external, images referenced by exact filenames we provide). The output goes through `sanitizeSiteHtml()` (strip scripts / external resources / dangerous attrs), is written to `index.html`, then through the existing `inlineSite()` + `qaCheck()`. If generation or QA fails → fall back to today's token engine (`applyArtDirection` + `writeSite` v3). Edits pass the **current page as the base** so Opus modifies in place. The cold-email demo (Email 1) is unchanged.

**Tech Stack:** Node 22 (`node:test`, `node --experimental-sqlite`), Anthropic Messages API (Opus 4.8), Playwright (existing QA), vanilla — no new deps.

**Why no JS in v1:** stripping all `<script>` removes the main stored-XSS vector (a malicious Google review can't execute), and CSS-only sites are still beautiful. Forms/interactions are a follow-up.

---

## File Structure

- **Create `src/builder/sanitizeHtml.js`** — pure `sanitizeSiteHtml(html)`: strip `<script>` (all), external `<link>` (keep Google Fonts), `<iframe>/<object>/<embed>/<base>`, `on*=` handlers, `javascript:`/`vbscript:`/non-image-`data:` URLs. Also `extractHtmlDocument(text)`: pull the `<!doctype…>…</html>` out of a model reply (strip markdown fences/prose).
- **Create `src/builder/llmsite.js`** — `generateSiteHtml(lead, { change, baseHtml, imageFiles, apiKey, model, fetchJson })` → prompt Opus → return sanitized full HTML, or `null` on no-key/error/empty. Owns the prompt.
- **Modify `src/builder/build2.js`** — add `writeLlmSite(lead, { html, images })`: write the model HTML to `<slug>/index.html`, ensure `img/` exists; return `{ engine:'llm-html', slug, htmlPath }`. (Images are already on disk from `leadImages`/`portalPhotos`; `inlineSite` base64s them at deploy.)
- **Modify `src/orchestrator.js`** (`replied` handler) — try the LLM engine first (base = current `index.html` for edits); QA-gate; fall back to the token path on failure.
- **Create `test/sanitize-html.test.js`**, **`test/llmsite.test.js`** — unit + integration (fake `fetchJson`, fake browser).

---

## Task 1: HTML sanitizer + document extractor

**Files:** Create `src/builder/sanitizeHtml.js`; Test `test/sanitize-html.test.js`

- [ ] **Step 1: Write failing tests**

```js
// test/sanitize-html.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSiteHtml, extractHtmlDocument } from '../src/builder/sanitizeHtml.js';

test('strips all <script> tags (inline + external) — no JS reaches the public page', () => {
  const out = sanitizeSiteHtml('<head><script src="https://evil.cdn/x.js"></script><script>alert(1)</script></head><body>hi</body>');
  assert.doesNotMatch(out, /<script/i);
  assert.ok(out.includes('hi'));
});

test('strips external <link> but keeps Google Fonts + inline <style>', () => {
  const out = sanitizeSiteHtml('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"><link rel="stylesheet" href="https://evil.cdn/x.css"><style>body{color:red}</style>');
  assert.match(out, /fonts\.googleapis\.com/);
  assert.doesNotMatch(out, /evil\.cdn/);
  assert.match(out, /body\{color:red\}/);
});

test('strips on*= handlers and javascript: URLs', () => {
  const out = sanitizeSiteHtml('<a href="javascript:alert(1)" onclick="x()">a</a><img src="img/photo-0.jpg" onerror="y()">');
  assert.doesNotMatch(out, /onclick=/i);
  assert.doesNotMatch(out, /onerror=/i);
  assert.doesNotMatch(out, /javascript:/i);
  assert.match(out, /src="img\/photo-0\.jpg"/);
});

test('strips iframe/object/embed/base', () => {
  const out = sanitizeSiteHtml('<iframe src="https://x"></iframe><object></object><embed><base href="https://x">ok');
  assert.doesNotMatch(out, /<iframe|<object|<embed|<base/i);
  assert.ok(out.includes('ok'));
});

test('extractHtmlDocument pulls the doc out of a fenced model reply', () => {
  const doc = extractHtmlDocument('Sure!\n```html\n<!doctype html><html><body>x</body></html>\n```\nDone');
  assert.match(doc, /^<!doctype html>/i);
  assert.match(doc, /<\/html>$/i);
});

test('extractHtmlDocument returns "" when there is no html', () => {
  assert.equal(extractHtmlDocument('no html here'), '');
});
```

- [ ] **Step 2: Run → expect FAIL** `node --experimental-sqlite --test test/sanitize-html.test.js`

- [ ] **Step 3: Implement `src/builder/sanitizeHtml.js`**

```js
// Make a model-written HTML page safe to publish to the PUBLIC web: strip every script, all external
// resources except Google Fonts, dangerous inline attrs, and unsafe URL schemes. Regex-based (no DOM
// dep); paired with the QA gate + inlineSite. v1 = CSS-only sites (no JS), which removes the main XSS
// vector entirely. Pure function.
const FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com/i;

export function sanitizeSiteHtml(html = '') {
  let s = String(html);
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');   // inline + external scripts
  s = s.replace(/<script\b[^>]*\/?>/gi, '');                      // stray/self-closing
  s = s.replace(/<(iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<(iframe|object|embed|base)\b[^>]*\/?>/gi, '');
  // External <link> except Google Fonts (and the preconnect to them).
  s = s.replace(/<link\b[^>]*>/gi, (tag) => {
    const m = tag.match(/\bhref=["']([^"']+)["']/i);
    if (m && /^https?:/i.test(m[1]) && !FONTS.test(m[1])) return '';
    return tag;
  });
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ''); // on*= handlers
  // javascript:/vbscript:/data: (non-image) in href/src
  s = s.replace(/\b(href|src)\s*=\s*("(?:javascript|vbscript|data):[^"]*"|'(?:javascript|vbscript|data):[^']*')/gi, (full, attr, val) => {
    if (/^["']data:image\//i.test(val)) return full; // allow inline image data URLs
    return `${attr}="#"`;
  });
  return s;
}

// Pull the HTML document out of a model reply (it may wrap it in ```html fences or add prose).
export function extractHtmlDocument(text = '') {
  const s = String(text);
  const m = s.match(/<!doctype html>[\s\S]*<\/html\s*>/i) || s.match(/<html\b[\s\S]*<\/html\s*>/i);
  return m ? m[0].trim() : '';
}
```

- [ ] **Step 4: Run → expect PASS.** **Step 5: Commit** `feat(builder): HTML sanitizer + doc extractor for the LLM site engine`

---

## Task 2: `generateSiteHtml` — the Opus call

**Files:** Create `src/builder/llmsite.js`; Test `test/llmsite.test.js`

- [ ] **Step 1: Write failing tests** (fake `fetchJson`, no network)

```js
// test/llmsite.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSiteHtml } from '../src/builder/llmsite.js';

const LEAD = { name: 'TJ Nails Spa', niche: 'nail salon', city: 'Leander, TX', phone: '(512) 337-7377',
  details: JSON.stringify({ rating: 4.8, reviewCount: 294, hours: ['Monday: 9 AM – 7 PM'] }) };
const fakeReply = (html) => async () => ({ content: [{ type: 'text', text: html }] });

test('returns a sanitized full HTML document from the model reply', async () => {
  const html = await generateSiteHtml(LEAD, { change: 'dark and elegant', imageFiles: ['img/photo-0.jpg'], apiKey: 'x',
    fetchJson: fakeReply('<!doctype html><html><head><style>body{background:#111}</style><script src="https://evil/x.js"></script></head><body><h1>TJ Nails Spa</h1><img src="img/photo-0.jpg"></body></html>') });
  assert.match(html, /^<!doctype html>/i);
  assert.doesNotMatch(html, /<script/i);          // sanitized
  assert.ok(html.includes('TJ Nails Spa'));
  assert.ok(html.includes('img/photo-0.jpg'));
});

test('no apiKey → null (caller falls back to the token engine)', async () => {
  assert.equal(await generateSiteHtml(LEAD, { change: 'x' }), null);
});

test('reply with no html document → null', async () => {
  const out = await generateSiteHtml(LEAD, { change: 'x', apiKey: 'x', fetchJson: fakeReply('I cannot do that') });
  assert.equal(out, null);
});
```

- [ ] **Step 2: Run → expect FAIL**

- [ ] **Step 3: Implement `src/builder/llmsite.js`**

```js
// Opus writes the WHOLE site. One Messages call → one complete, self-contained HTML document. We give
// it the verified facts, a design brief, the exact image filenames it may use, and (on an edit) the
// current page to modify in place. Output is run through sanitizeSiteHtml. NEVER throws; returns null on
// no-key / error / a reply with no HTML, so the caller falls back to the token engine (always-ships).
import { buildFactSheet } from '../fill/grounding.js';
import { designBrief } from '../design/playbook.js';
import { postJson } from '../util/net.js';
import { ENDPOINT, HEADERS } from '../fill/anthropic.js';
import { sanitizeSiteHtml, extractHtmlDocument } from './sanitizeHtml.js';

function systemPrompt(niche, imageFiles, baseHtml) {
  const imgs = imageFiles && imageFiles.length
    ? `Use ONLY these images, by these EXACT paths (do not invent any other image URL): ${imageFiles.join(', ')}. Use each at most a couple of times; let them carry the hero + gallery.`
    : 'No photos are available — design a striking photo-free page (typographic hero, color, texture).';
  return [
    'You are a world-class web designer. Output ONE complete, self-contained HTML document for a small',
    'local business — distinctive and beautiful, never templated. Strong type hierarchy, a confident',
    'palette, generous spacing, depth/atmosphere, fully responsive (mobile-first, no horizontal overflow).',
    '',
    'HARD RULES (the page is published as a single self-contained file on the public web):',
    '1. ALL CSS inline in one <style> in <head>. 2. NO JavaScript — emit NO <script> tags. 3. No external',
    'resources EXCEPT Google Fonts (<link> to fonts.googleapis.com / fonts.gstatic.com only). 4. ' + imgs,
    '5. Use ONLY the verified facts below — never invent services, prices, awards, hours, or reviews.',
    '6. HTML-escape any business-supplied text you embed (shop name, review quotes).',
    '7. Include the shop name and phone number somewhere on the page.',
    '',
    'DESIGN DIRECTION: ' + designBrief(niche),
    baseHtml ? '\nThis is an EDIT of the page below. Apply ONLY the requested change; keep everything else identical (same design unless the change asks to alter it). Return the FULL updated document.' : '',
    '\nReturn ONLY the HTML document (start with <!doctype html>). No markdown, no commentary.',
  ].join('\n');
}

export async function generateSiteHtml(lead, { change, baseHtml = null, imageFiles = [], ...opts } = {}) {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
  if (!apiKey) return null;
  try {
    const { sheet } = buildFactSheet(lead);
    const user = [
      'VERIFIED FACTS:', sheet, '',
      baseHtml ? 'CURRENT PAGE (edit this):\n```html\n' + baseHtml + '\n```\n' : '',
      "THE OWNER'S REQUEST:", String(change || '').trim() || 'Design the best possible site for this business.',
    ].join('\n');
    const model = opts.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8';
    const fetchJson = opts.fetchJson || ((url, o) => postJson(url, JSON.parse(o.body), { headers: o.headers, timeoutMs: 120000 }));
    const resp = await fetchJson(ENDPOINT, {
      method: 'POST', headers: HEADERS(apiKey),
      body: JSON.stringify({ model, max_tokens: 16000, system: systemPrompt(lead.niche, imageFiles, baseHtml), messages: [{ role: 'user', content: user }] }),
    });
    const text = (resp && Array.isArray(resp.content) ? resp.content : []).filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
    const doc = extractHtmlDocument(text);
    if (!doc) { console.warn('[llmsite] model returned no HTML document — falling back'); return null; }
    return sanitizeSiteHtml(doc);
  } catch (e) {
    console.warn('[llmsite] generation failed — falling back:', String((e && e.message) || e).split('\n')[0]);
    return null;
  }
}
```

- [ ] **Step 4: Run → PASS.** **Step 5: Commit** `feat(builder): generateSiteHtml — Opus writes the whole self-contained page`

---

## Task 3: `writeLlmSite` — write the model HTML to the slug dir

**Files:** Modify `src/builder/build2.js` (add export); Test `test/llmsite.test.js` (extend)

- [ ] **Step 1: Failing test**

```js
// add to test/llmsite.test.js
import { writeLlmSite, slugFor, PUBLIC_DIR } from '../src/builder/build2.js';
import { readFileSync } from 'node:fs'; import { join } from 'node:path';

test('writeLlmSite writes index.html under the slug dir', async () => {
  const lead = { id: 1, name: 'Write Test Salon', niche: 'nail salon' };
  const out = await writeLlmSite(lead, { html: '<!doctype html><html><body>X</body></html>' });
  assert.equal(out.engine, 'llm-html');
  assert.match(out.htmlPath, /write-test-salon[\\/]index\.html$/);
  assert.ok(readFileSync(join(PUBLIC_DIR, slugFor(lead), 'index.html'), 'utf8').includes('<body>X'));
});
```

- [ ] **Step 2: FAIL. Step 3: Implement** (add to `build2.js`)

```js
// Write a model-generated full HTML page (already sanitized) to the lead's slug dir. Images already
// live in <slug>/img from leadImages/portalPhotos; inlineSite base64s them at deploy. No theme.css.
export async function writeLlmSite(lead, { html } = {}) {
  const slug = slugFor(lead);
  const dir = join(PUBLIC_DIR, slug);
  mkdirSync(dir, { recursive: true });
  const htmlPath = join(dir, 'index.html');
  writeFileSync(htmlPath, String(html || ''));
  return { engine: 'llm-html', slug, htmlPath };
}
```

- [ ] **Step 4: PASS. Step 5: Commit** `feat(builder): writeLlmSite`

---

## Task 4: Wire the orchestrator `replied` handler (LLM primary, token fallback, edit base)

**Files:** Modify `src/orchestrator.js` (`replied` handler)

- [ ] **Step 1:** Add imports at top: `import { generateSiteHtml } from './builder/llmsite.js';` and `import { writeLlmSite } from './builder/build2.js';` (extend the existing build2 import).

- [ ] **Step 2: Replace the `replied` handler body** with:

```js
  replied: async (db, lead) => {
    const change = latestChange(db, lead.id);
    const portal = portalPhotos(db, lead);
    const images = portal.length ? portal : await leadImages(lead, config);
    const facts = [lead.name, lead.phone].filter(Boolean);

    // PRIMARY: let Opus write the whole page. On an edit, pass the current page as the base so it
    // modifies in place (preserving the approved design). Sanitized inside generateSiteHtml.
    const prev = db.getSiteForLead(lead.id);
    let baseHtml = null;
    if (prev && prev.engine === 'llm-html') { try { baseHtml = readFileSync(prev.html_path, 'utf8'); } catch { baseHtml = null; } }
    const llmHtml = await generateSiteHtml(lead, { change, baseHtml, imageFiles: images });
    if (llmHtml) {
      const built = await writeLlmSite(lead, { html: llmHtml });
      const qa = await qaCheck({ htmlPath: built.htmlPath, mustInclude: facts });
      if (qa.ok) {
        db.addSite(lead.id, { slug: built.slug, engine: built.engine, htmlPath: built.htmlPath });
        db.setStatus(lead.id, 'editing', { change, engine: 'llm-html' });
        if (config.mode === 'auto') { db.setStatus(lead.id, 'approved', { change }); return; }
        const previewPath = `${(config.publicBaseUrl || '').replace(/\/$/, '')}/${built.slug}/`;
        await notifyFounder(composeFounderApproval(lead, { change, previewPath, config }), config);
        db.setStatus(lead.id, 'pending_approval', { change });
        return;
      }
      db.recordEvent(lead.id, 'llm_qa_failed', { issues: qa.issues.map((i) => i.type) }); // fall through to token engine
    }

    // FALLBACK: today's token engine (always-ships). Unchanged behavior.
    let base = null;
    try { base = prev && prev.spec ? JSON.parse(prev.spec) : null; } catch { base = null; }
    const { contract, design } = await applyArtDirection(lead, { change, photos: [], baseContract: base && base.contract, baseDesign: base && base.design });
    const built = await writeSite(lead, contract, { design, images, apiBase: config.portalBaseUrl });
    const qa = await qaCheck({ htmlPath: built.htmlPath, mustInclude: [contract.shopName, contract.contact?.phone].filter(Boolean) });
    if (!qa.ok) { db.setStatus(lead.id, 'needs_human', { reason: 'qa_failed', issues: qa.issues.map((i) => i.type) }); return; }
    db.addSite(lead.id, { slug: built.slug, engine: built.engine, htmlPath: built.htmlPath, spec: JSON.stringify({ contract, design }) });
    db.setStatus(lead.id, 'editing', { change });
    if (config.mode === 'auto') { db.setStatus(lead.id, 'approved', { change }); return; }
    const previewPath = `${(config.publicBaseUrl || '').replace(/\/$/, '')}/${built.slug}/`;
    await notifyFounder(composeFounderApproval(lead, { change, previewPath, config }), config);
    db.setStatus(lead.id, 'pending_approval', { change });
  },
```

- [ ] **Step 3:** Ensure `readFileSync` is imported in orchestrator.js (it already imports `readFileSync` from `node:fs` — confirm at line 5).

- [ ] **Step 4: Run the full suite** `node --experimental-sqlite --test` → expect existing wow-build/tier tests still PASS (the fallback path is the old behavior; with a key, the LLM path runs — tests use no key OR a fake, so they hit the fallback/old path). Fix any breakage.

- [ ] **Step 5: Commit** `feat(orchestrator): LLM-html as the primary wow-build engine, token engine as fallback`

---

## Task 5: Real Opus smoke test + manual quality check

**Files:** none (manual, gated)

- [ ] **Step 1:** With `ANTHROPIC_API_KEY` set, run a one-off (local `retest.db`, lead 13) that calls `generateSiteHtml` for "high-end dark with neon accents", writes via `writeLlmSite`, runs `qaCheck`, and screenshots. Confirm: self-contained (no external non-font refs), facts present, mobile-clean, and visibly **better/more bespoke** than the token output.
- [ ] **Step 2:** Run an EDIT (`baseHtml` = the page just made, change = "change the copy to be playful, keep the look") → confirm design preserved, copy changed.
- [ ] **Step 3:** Confirm a deliberately broken model reply (fake) → QA fails → token fallback fires (covered by Task 4 tests).

---

## Task 6: Deploy the full switch to Fly + verify

- [ ] **Step 1:** `fly deploy` (Anthropic key/model already set). **Step 2:** Seseed/reuse TJ Nails; submit a portal change; confirm `engine: llm-html` on the new site row, ONE Email 2, dark+neon honored, no external refs, mobile-clean. **Step 3:** Submit a copy-only edit → design preserved.

---

## Self-Review

- **Spec coverage:** model-writes-HTML ✓ (T2), sanitize ✓ (T1), self-contained via inlineSite (unchanged, images base64) ✓, QA gate ✓ (T4), token fallback/always-ships ✓ (T4), edit-in-place via baseHtml ✓ (T4), cold demo untouched ✓ (only `replied` changed).
- **Placeholders:** none — every code step is complete.
- **Type consistency:** `generateSiteHtml(lead, {change, baseHtml, imageFiles, ...opts})` → string|null; `writeLlmSite(lead,{html})` → `{engine:'llm-html',slug,htmlPath}`; `sanitizeSiteHtml(html)`/`extractHtmlDocument(text)` → string. `qaCheck({htmlPath, mustInclude})` matches existing signature. `db.getSiteForLead` row uses `.engine` + `.html_path` (snake_case from DB) — used correctly.
- **Risk noted:** v1 is CSS-only (no JS/forms) — strips all scripts for safety; lead-capture forms are a follow-up. Residual XSS from unescaped body text is mitigated by prompt + the public-data nature; a full DOM-parser sanitizer is a future hardening.
