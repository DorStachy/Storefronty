import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The two hand-built upsell showcase sites are static files under app/web (so they ship in the Fly
// image — app/public is .dockerignore'd — and are committed; app/public is .gitignore'd).
// app/web/showcase-pro/index.html      ->  served at /portal/showcase-pro/
// app/web/showcase-premium/index.html  ->  served at /portal/showcase-premium/
// These are pure string assertions so the suite runs without a browser/Playwright.

const here = dirname(fileURLToPath(import.meta.url));
const WEB = join(here, '..', 'web');

function readShowcase(slug) {
  return readFileSync(join(WEB, slug, 'index.html'), 'utf8');
}

// ---- shared structural guarantees for BOTH showcases ----------------------
for (const slug of ['showcase-pro', 'showcase-premium']) {
  test(`${slug}: exists, non-empty, valid finished static page`, () => {
    const html = readShowcase(slug);
    assert.ok(html.length > 4000, `${slug} should be a substantial page (got ${html.length} bytes)`);

    const lower = html.toLowerCase();
    // valid doctype
    assert.ok(lower.includes('<!doctype html'), `${slug} missing <!doctype html`);

    // finished page: no leftover template tokens
    assert.ok(!html.includes('{{'), `${slug} contains a leftover {{ template token`);

    // hard constraint: no external <script src="http..."> (inline JS only)
    assert.ok(!/<script\b[^>]*\bsrc\s*=\s*["']?https?:/i.test(html),
      `${slug} must not load an external <script src="http...">`);

    // real, accessible structure
    assert.ok(/<main\b/i.test(html), `${slug} missing a <main> landmark`);
    assert.ok(/<footer\b/i.test(html), `${slug} missing a <footer>`);
    // lead / order capture form
    assert.ok(/<form\b/i.test(html), `${slug} missing a <form> for lead/order capture`);
    assert.ok(/type=["']?email/i.test(html), `${slug} form should capture an email`);
    assert.ok(/<button\b[^>]*type=["']?submit/i.test(html), `${slug} form missing a submit button`);

    // reduced-motion safety
    assert.ok(html.includes('prefers-reduced-motion'),
      `${slug} must guard motion behind prefers-reduced-motion`);
  });
}

// ---- Pro-specific (warm/light café, Pro feature set) ----------------------
test('showcase-pro: warm café content + Pro features (reveal, tilt)', () => {
  const html = readShowcase('showcase-pro');
  assert.ok(html.includes('Marigold Kitchen'), 'pro should be the Marigold Kitchen demo');
  // Pro feature set: scroll-reveal + CSS-3D tilt + smooth scroll
  assert.ok(html.includes('class="reveal"') || html.includes('reveal'), 'pro missing scroll-reveal');
  assert.ok(html.includes('data-tilt'), 'pro missing tilt cards');
  assert.ok(/scroll-behavior\s*:\s*smooth/i.test(html), 'pro missing smooth scroll');
  // key sections present
  for (const id of ['menu', 'gallery', 'book']) {
    assert.ok(html.includes(`id="${id}"`), `pro missing #${id} section`);
  }
});

// ---- Premium-specific (dark/cinematic, real inline WebGL2 hero) -----------
test('showcase-premium: cinematic content + inline WebGL2 hero', () => {
  const html = readShowcase('showcase-premium');
  assert.ok(html.includes('Maison'), 'premium should be the Maison Noir demo');

  // the WebGL hero canvas
  assert.ok(html.includes('id="hero-gl"'), 'premium missing the id="hero-gl" canvas');
  assert.ok(/<canvas\b[^>]*id=["']hero-gl/i.test(html), 'premium hero-gl should be a <canvas>');

  // a real, INLINE WebGL2 context (raw, no external lib)
  assert.ok(/<script\b[^>]*type=["']module["']/i.test(html),
    'premium should drive the hero from an inline <script type="module">');
  assert.ok(/getContext\(\s*["']webgl2["']/.test(html),
    'premium must request a raw webgl2 context inline');
  assert.ok(html.includes('#version 300 es'), 'premium should contain inline GLSL ES 3.00 shaders');

  // graceful fallback path exists (no GPU / reduced-motion no-ops to CSS)
  assert.ok(/if\s*\(\s*!\s*gl\s*\)/.test(html), 'premium must handle a null webgl2 context');

  // key sections present
  for (const id of ['menu', 'reserve']) {
    assert.ok(html.includes(`id="${id}"`), `premium missing #${id} section`);
  }
});
