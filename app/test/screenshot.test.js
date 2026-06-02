import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planShots, SECTION_SELECTORS } from '../src/screenshot/index.js';

// --- pure shot-planning (offline) ---------------------------------------
test('planShots: reviews when present, gallery fallback when not', () => {
  const withReviews = planShots({ hasReviews: true }).map((s) => s.name);
  const noReviews = planShots({ hasReviews: false }).map((s) => s.name);
  assert.deepEqual(withReviews, ['hero', 'services', 'reviews']);
  assert.deepEqual(noReviews, ['hero', 'services', 'gallery']);
  // every planned shot resolves to a real selector
  for (const shot of planShots({ hasReviews: true })) assert.ok(shot.selector === SECTION_SELECTORS[shot.name]);
});

// --- real-engine smoke (skips if Playwright/browser unavailable) ---------
test('captureSections renders a built site and writes 3 section PNGs', async (t) => {
  // is a browser available? if not, skip (keeps `npm test` green without browsers)
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
    const b = await chromium.launch({ headless: true });
    await b.close();
  } catch (e) {
    t.skip(`no browser: ${String(e.message || e).split('\n')[0]}`);
    return;
  }

  const { buildSiteV2 } = await import('../src/builder/build2.js');
  const { screenshotForEmail } = await import('../src/screenshot/index.js');

  const built = await buildSiteV2({
    name: 'Shot Test Barbers',
    niche: 'barbershop',
    city: 'Austin, TX',
    address: '99 Test St, Austin, TX 78701',
    phone: '(512) 555-0000',
    details: JSON.stringify({ rating: 4.7, reviewCount: 88, primaryType: 'Barber shop', hours: ['Monday: 9 AM – 6 PM', 'Tuesday: 9 AM – 6 PM'] }),
  });

  const outDir = mkdtempSync(join(tmpdir(), 'sf-shots-'));
  const results = await screenshotForEmail({ htmlPath: built.htmlPath, outDir, hasReviews: false });

  assert.equal(results.length, 3);
  for (const r of results) {
    assert.ok(r.ok, `shot ${r.name} failed: ${r.reason}`);
    assert.ok(existsSync(r.path), `missing ${r.path}`);
    assert.ok(statSync(r.path).size > 1000, `${r.name}.png too small (${statSync(r.path).size}b)`);
  }
  assert.deepEqual(results.map((r) => r.name), ['hero', 'services', 'gallery']);
});
