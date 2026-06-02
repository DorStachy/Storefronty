import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSiteV2 } from '../src/builder/build2.js';

test('buildSiteV2 writes a rendered page for a barbershop lead (luxe requested, editorial fallback in 1A)', async () => {
  const r = await buildSiteV2({
    name: 'QA Barbers',
    niche: 'barbershop',
    city: 'Austin, TX',
    details: JSON.stringify({ rating: 4.5, reviewCount: 40, primaryType: 'Barber shop', hours: ['Monday: 9 AM – 5 PM'] }),
  });
  assert.equal(r.slug, 'qa-barbers');
  assert.equal(r.requestedTheme, 'luxe'); // barbershop -> luxe (per niche map)
  assert.equal(r.renderedTheme, 'editorial'); // luxe template ships in Plan 1C; fall back for now
  const html = readFileSync(r.htmlPath, 'utf8');
  assert.ok(!html.includes('{{'));
  assert.ok(html.includes('QA Barbers'));
});
