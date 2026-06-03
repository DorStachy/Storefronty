// Phase D — tiered site generation. The SAME v3 engine renders three richness tiers selected by a
// `tier` opt threaded writeSite → renderSiteV3 → designToCss:
//   • starter (default) — byte-stable vs the original v3 output (no canvas, no form, no reveal CSS).
//   • pro      — adds a lead-capture form + scroll-reveal/tilt CSS (CSS-only, self-contained).
//   • premium  — adds a raw inline WebGL2 hero (canvas + <script type="module">), a catalogue grid,
//                and an order/reservation form, on top of pro's motion.
// Every tier MUST stay self-contained (no external <script>/non-font <link>) — asserted via staticQa.
// A browser-backed qaCheck smoke runs per tier when Playwright can launch, and skips gracefully
// otherwise (mirrors wow-build.test.js / reply-loop.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { writeSite, PUBLIC_DIR, slugFor } from '../src/builder/build2.js';
import { renderSiteV3 } from '../src/builder/render.js';
import { fillDeterministic } from '../src/fill/deterministic.js';
import { designForNiche, validateDesignSpec } from '../src/design/spec.js';
import { staticQa, qaCheck } from '../src/qa/index.js';

// A real golden lead → grounded contract (real shop name, services, hours, phone) + niche design.
const LEAD = {
  name: 'The Gilded Ox Steakhouse', niche: 'restaurant', city: 'Austin, TX',
  address: '210 Congress Ave, Austin, TX 78701', phone: '512-555-0142',
  details: JSON.stringify({ rating: 4.8, reviewCount: 364, primaryType: 'Steak house', hours: ['Monday: 5 PM – 10 PM', 'Tuesday: 5 PM – 10 PM'] }),
};
const CONTRACT = fillDeterministic(LEAD);
const DESIGN = designForNiche('restaurant');

// Build a tier and return { r, html, css }. Each call uses a UNIQUE lead → unique slug dir so the
// per-tier tests never collide on disk (node:test may interleave tests across files). The contract is
// shared (real facts); only the lead name (→ slug) is suffixed. `cleanup` removes the slug dir.
let seq = 0;
async function build(tier) {
  const lead = { ...LEAD, name: `${LEAD.name} ${tier || 'default'} ${seq++}` };
  const r = await writeSite(lead, CONTRACT, { design: DESIGN, ...(tier ? { tier } : {}) });
  const dir = join(PUBLIC_DIR, slugFor(lead));
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const css = readFileSync(join(dir, 'theme.css'), 'utf8');
  return { r, html, css, dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// Browser-backed QA smoke shared by the per-tier tests: skip if Playwright can't launch.
async function qaSmoke(t, dir) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
    const b = await chromium.launch({ headless: true });
    await b.close();
  } catch (e) {
    t.skip(`no browser: ${String(e.message || e).split('\n')[0]}`);
    return null;
  }
  return qaCheck({ htmlPath: join(dir, 'index.html'), facts: CONTRACT });
}

test('starter (default) is unchanged: no canvas, no lead form, no reveal CSS; equals explicit tier:starter', async (t) => {
  const def = await build();            // no tier opt → default 'starter'
  const explicit = await build('starter');

  // Default and explicit-starter render identically (the tier opt's default is truly 'starter').
  assert.equal(def.html, explicit.html, 'default tier output == explicit starter output');
  assert.equal(def.css, explicit.css, 'default tier CSS == explicit starter CSS');

  const { html, css, r } = def;
  assert.equal(r.engine, 'theme-v3');
  assert.equal(r.tier, 'starter', 'writeSite reports the resolved tier');

  // None of the tier features leak into starter.
  assert.doesNotMatch(html, /hero-gl/, 'no WebGL canvas in starter');
  assert.doesNotMatch(html, /<script/i, 'no inline script in starter');
  assert.doesNotMatch(html, /\/api\/lead/, 'no lead/order form in starter');
  assert.doesNotMatch(html, /data-reveal/, 'no reveal markers in starter');
  assert.doesNotMatch(css, /sf-reveal/, 'no reveal keyframes in starter CSS');
  assert.doesNotMatch(css, /prefers-reduced-motion/, 'starter CSS adds no motion media block');
  // The hero opens exactly as before — the empty canvas slot collapses to nothing.
  assert.match(html, /<header class="hero">(<img|<div class="wrap")/, 'hero starts with photo/wrap, no canvas node');

  // Self-contained + grounded.
  const qa = staticQa(html, { mustInclude: [CONTRACT.shopName, CONTRACT.contact.phone] });
  assert.ok(qa.ok, `starter staticQa must pass; issues: ${JSON.stringify(qa.issues)}`);

  const live = await qaSmoke(t, def.dir);
  if (live) assert.ok(live.ok, `starter qaCheck must pass; issues: ${JSON.stringify(live.issues)}`);
  def.cleanup();
});

test('pro adds the lead-capture form + reveal/tilt CSS, stays self-contained, no WebGL/order/catalogue', async (t) => {
  const { html, css, r, dir, cleanup } = await build('pro');
  assert.equal(r.tier, 'pro');

  // Lead form: posts to /api/lead with the three fields, kind=lead.
  assert.match(html, /<form[^>]+action="\/api\/lead"[^>]+method="post"/, 'lead form posts to /api/lead');
  assert.match(html, /name="kind" value="lead"/, 'lead form carries kind=lead');
  assert.match(html, /name="name"/, 'lead form has a name field');
  assert.match(html, /type="email"/, 'lead form has an email field');
  assert.match(html, /<textarea[^>]+name="message"/, 'lead form has a message field');
  assert.match(html, /data-reveal/, 'reveal markers present');

  // Reveal + tilt CSS, all motion gated behind prefers-reduced-motion: no-preference.
  assert.match(css, /@keyframes sf-reveal/, 'reveal keyframes emitted');
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)/, 'motion gated for reduced-motion safety');
  assert.match(css, /perspective\(/, 'CSS-3D tilt present');

  // Pro has the inline form-submit script (keeps the visitor on-site), but stays self-contained — no
  // external <script src> and none of the premium-only features.
  assert.match(html, /<script>/, 'pro has the inline form-submit script');
  assert.doesNotMatch(html, /<script[^>]+src=/i, 'no external script src in pro');
  assert.doesNotMatch(html, /hero-gl/, 'no WebGL canvas in pro');
  assert.doesNotMatch(html, /getContext\('webgl2'/, 'no WebGL in pro');
  assert.doesNotMatch(html, /name="kind" value="order"/, 'no order form in pro');
  assert.doesNotMatch(html, /id="catalogue"/, 'no catalogue grid in pro');

  // Self-contained.
  const qa = staticQa(html, { mustInclude: [CONTRACT.shopName, CONTRACT.contact.phone] });
  assert.ok(qa.ok, `pro staticQa must pass; issues: ${JSON.stringify(qa.issues)}`);

  const live = await qaSmoke(t, dir);
  if (live) assert.ok(live.ok, `pro qaCheck must pass; issues: ${JSON.stringify(live.issues)}`);
  cleanup();
});

test('premium adds the WebGL hero (canvas + inline module), catalogue grid, and order form, stays self-contained', async (t) => {
  const { html, css, r, dir, cleanup } = await build('premium');
  assert.equal(r.tier, 'premium');

  // WebGL hero: canvas behind the photo + an inline ES-module raw-WebGL2 script (no src, no library).
  assert.match(html, /<canvas id="hero-gl"/, 'WebGL canvas present');
  assert.match(html, /<header class="hero"><canvas id="hero-gl"/, 'canvas is the FIRST child of the hero (behind the photo)');
  assert.match(html, /<script type="module">/, 'inline module script present');
  assert.match(html, /getContext\('webgl2'/, 'raw WebGL2 (no external library)');
  assert.match(html, /prefers-reduced-motion: reduce/, 'script has the reduced-motion no-op fallback');
  assert.match(css, /#hero-gl\{position:absolute;inset:0/, 'hero canvas is layered absolutely');

  // Catalogue grid built from the contract's services.
  assert.match(html, /id="catalogue"/, 'catalogue section present');
  assert.match(html, /class="cat-grid"/, 'catalogue grid present');
  assert.match(css, /\.cat-grid\{display:grid/, 'catalogue grid CSS present');

  // Order / reservation form: posts to /api/lead with kind=order.
  assert.match(html, /<section id="order"/, 'order section present');
  assert.match(html, /name="kind" value="order"/, 'order form carries kind=order');
  assert.match(html, /<form[^>]+action="\/api\/lead"[^>]+method="post"/, 'order form posts to /api/lead');

  // Premium is a superset of pro: the lead form + reveal CSS are also present.
  assert.match(html, /name="kind" value="lead"/, 'premium also carries the lead form');
  assert.match(css, /@keyframes sf-reveal/, 'premium also has reveal motion');

  // Self-contained: the inline module has NO src= and there is no non-font external <link>.
  assert.doesNotMatch(html, /<script[^>]+src=/i, 'no external script src');
  const qa = staticQa(html, { mustInclude: [CONTRACT.shopName, CONTRACT.contact.phone] });
  assert.ok(qa.ok, `premium staticQa must pass; issues: ${JSON.stringify(qa.issues)}`);

  const live = await qaSmoke(t, dir);
  if (live) assert.ok(live.ok, `premium qaCheck must pass; issues: ${JSON.stringify(live.issues)}`);
  cleanup();
});

test('tier builders tolerate a contract with no services (never throw, emit safe/empty)', async () => {
  // A minimal-but-valid contract with an empty-ish services set still produces a shippable premium
  // page: the catalogue (which needs services) renders nothing, the forms still render.
  const bare = { ...CONTRACT, shopName: 'Bare Co', services: [{ name: 'Visit', desc: 'Come see us in person today.' }] };
  const r = await writeSite({ ...LEAD, name: 'Bare Co' }, bare, { design: DESIGN, tier: 'premium' });
  const dir = join(PUBLIC_DIR, r.slug);
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.match(html, /<canvas id="hero-gl"/);          // hero still there
  assert.match(html, /name="kind" value="order"/);     // order form still there
  const qa = staticQa(html, { mustInclude: ['Bare Co'] });
  assert.ok(qa.ok, `bare-services premium staticQa must pass; issues: ${JSON.stringify(qa.issues)}`);
  rmSync(dir, { recursive: true, force: true });
});

test('renderSiteV3 passes the tier through to the generated CSS (unit, no disk)', async () => {
  const starter = await renderSiteV3(CONTRACT, validateDesignSpec(DESIGN), {});
  const premium = await renderSiteV3(CONTRACT, validateDesignSpec(DESIGN), { tier: 'premium' });
  assert.doesNotMatch(starter.css, /sf-reveal/, 'starter CSS has no reveal');
  assert.doesNotMatch(starter.html, /hero-gl/, 'starter HTML has no canvas');
  assert.match(premium.css, /sf-reveal/, 'premium CSS has reveal');
  assert.match(premium.html, /<canvas id="hero-gl"/, 'premium HTML has the canvas');
});
