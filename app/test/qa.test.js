import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// QA gate smoke tests. The QA crawl is a thin Playwright integration, so both cases use the
// browser-skip idiom (skip when chromium can't launch) to keep `npm test` green without browsers.

// Probe once: is a real browser available? Returns true, or skips the test and returns false.
async function browserOrSkip(t) {
  try {
    const { chromium } = await import('playwright');
    const b = await chromium.launch({ headless: true });
    await b.close();
    return true;
  } catch (e) {
    t.skip(`no browser: ${String(e.message || e).split('\n')[0]}`);
    return false;
  }
}

// --- passing case: a real built site is clean ----------------------------
test('qaCheck passes a freshly built barbershop site', async (t) => {
  if (!(await browserOrSkip(t))) return;

  const { buildSiteV2 } = await import('../src/builder/build2.js');
  const { qaCheck } = await import('../src/qa/index.js');

  const built = await buildSiteV2({
    name: 'QA Test Barbers',
    niche: 'barbershop',
    city: 'Austin, TX',
    address: '99 Test St, Austin, TX 78701',
    phone: '(512) 555-0000',
    details: JSON.stringify({ rating: 4.7, reviewCount: 88, primaryType: 'Barber shop', hours: ['Monday: 9 AM – 6 PM', 'Tuesday: 9 AM – 6 PM'] }),
  });

  const res = await qaCheck({ htmlPath: built.htmlPath });
  assert.equal(res.ok, true, `expected clean site, got issues: ${JSON.stringify(res.issues)}`);
  assert.deepEqual(res.issues, []);
  // checked summary is populated
  assert.ok(res.checked && typeof res.checked === 'object');
  assert.ok(res.checked.links >= 1, 'should have crawled the internal nav anchors');
});

// --- failing case: a deliberately broken page is caught ------------------
test('qaCheck flags a broken page (image, link, leftover token)', async (t) => {
  if (!(await browserOrSkip(t))) return;

  const { qaCheck } = await import('../src/qa/index.js');

  const dir = mkdtempSync(join(tmpdir(), 'sf-qa-'));
  const htmlPath = join(dir, 'broken.html');
  writeFileSync(
    htmlPath,
    `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" /><title>Broken</title></head>
<body>
  <h1>Broken page</h1>
  <img src="/does-not-exist.png" alt="missing" />
  <a href="#">bad</a>
  <a href="#services">ok internal anchor</a>
  <p>{{leftover}}</p>
</body></html>`,
  );

  const res = await qaCheck({ htmlPath });
  assert.equal(res.ok, false, 'broken page must not pass');
  const types = res.issues.map((i) => i.type);
  assert.ok(types.includes('broken_image'), `missing broken_image in ${JSON.stringify(types)}`);
  assert.ok(types.includes('bad_link'), `missing bad_link in ${JSON.stringify(types)}`);
  assert.ok(types.includes('leftover_token'), `missing leftover_token in ${JSON.stringify(types)}`);
  // the valid internal anchor must NOT be flagged
  const badLinkDetails = res.issues.filter((i) => i.type === 'bad_link').map((i) => i.detail);
  assert.ok(!badLinkDetails.some((d) => String(d).includes('#services')), 'internal anchor wrongly flagged');
});
