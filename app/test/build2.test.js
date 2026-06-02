import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSiteV2 } from '../src/builder/build2.js';

test('buildSiteV2 renders the niche-matched theme and writes the page', async () => {
  const r = await buildSiteV2({
    name: 'QA Barbers',
    niche: 'barbershop',
    city: 'Austin, TX',
    details: JSON.stringify({ rating: 4.5, reviewCount: 40, primaryType: 'Barber shop', hours: ['Monday: 9 AM – 5 PM'] }),
  });
  assert.equal(r.slug, 'qa-barbers');
  assert.equal(r.requestedTheme, 'luxe'); // barbershop -> luxe (niche map)
  assert.equal(r.renderedTheme, 'luxe'); // luxe ships in Plan 1C, so it renders (no fallback)
  const html = readFileSync(r.htmlPath, 'utf8');
  assert.ok(!html.includes('{{'));
  assert.ok(html.includes('QA Barbers'));
});

test('buildSiteV2 selects bold for a food truck and editorial for a cafe', async () => {
  const bold = await buildSiteV2({
    name: 'Grid Tacos',
    niche: 'food truck',
    city: 'Austin, TX',
    details: JSON.stringify({ rating: 4.6, reviewCount: 50, primaryType: 'Food truck', hours: ['Friday: 11 AM – 9 PM'] }),
  });
  assert.equal(bold.renderedTheme, 'bold');

  const cafe = await buildSiteV2({
    name: 'Cafe Q',
    niche: 'cafe',
    city: 'Austin, TX',
    details: JSON.stringify({ rating: 4.6, reviewCount: 50, primaryType: 'Cafe', hours: ['Monday: 7 AM – 4 PM'] }),
  });
  assert.equal(cafe.renderedTheme, 'editorial');
});
