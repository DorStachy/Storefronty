import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFactSheet } from '../src/fill/grounding.js';

const lead = {
  name: 'Silva’s', niche: 'barbershop', city: 'San Marcos, TX',
  address: '1138 Invasion St c, San Marcos, TX 78666, USA', phone: '(512) 392-3050',
  details: JSON.stringify({ rating: 4.6, reviewCount: 103, primaryType: 'Barber shop',
    hours: ['Monday: Closed', 'Tuesday: 7:15 AM – 6:00 PM', 'Saturday: 8:00 AM – 3:00 PM', 'Sunday: Closed'] }),
};

test('buildFactSheet returns structured facts + a human-readable sheet', () => {
  const { facts, allowedServices, sheet } = buildFactSheet(lead);
  assert.equal(typeof sheet, 'string');
  assert.equal(facts.name, 'Silva’s');
  assert.equal(facts.category, 'Barber shop');
  assert.equal(facts.city, 'San Marcos, TX');
  assert.equal(facts.rating, 4.6);
  assert.equal(facts.reviewCount, 103);
  assert.equal(facts.phone, '(512) 392-3050');
  assert.ok(Array.isArray(facts.addressLines) && facts.addressLines.length >= 1);
  assert.ok(Array.isArray(allowedServices) && allowedServices.length >= 1);
});

test('allowedServices come from the niche whitelist (no invention)', () => {
  const { allowedServices } = buildFactSheet(lead);
  // barbershop whitelist from deterministic.js
  assert.deepEqual(allowedServices, ['Haircuts', 'Fades', 'Beard Trim', 'Hot Towel Shave']);
});

test('the human-readable sheet embeds the REAL rating, hours, city, phone', () => {
  const { sheet } = buildFactSheet(lead);
  assert.ok(sheet.includes('4.6'), 'sheet should mention the real rating');
  assert.ok(sheet.includes('103'), 'sheet should mention the real review count');
  assert.ok(sheet.includes('San Marcos'), 'sheet should mention the real city');
  assert.ok(sheet.includes('(512) 392-3050'), 'sheet should mention the real phone');
  assert.ok(sheet.includes('7:15'), 'sheet should mention the real opening hours');
  assert.ok(sheet.includes('Haircuts'), 'sheet should list the allowed services');
});

test('the sheet never contains invented facts (no fabricated prices/awards)', () => {
  const { sheet } = buildFactSheet(lead);
  // Nothing in the lead implies a price or an award; the sheet must not invent them.
  assert.ok(!/\$\d/.test(sheet), 'no invented dollar prices');
  assert.ok(!/award|voted|best of|#1/i.test(sheet), 'no invented awards/superlatives');
});

test('parsed hours map full day names to 3-letter labels and keep the value', () => {
  const { facts } = buildFactSheet(lead);
  const tue = facts.hours.find((h) => h.day === 'Tue');
  assert.ok(tue && tue.value.includes('7:15'));
  const mon = facts.hours.find((h) => h.day === 'Mon');
  assert.ok(mon && /closed/i.test(mon.value));
});

test('review snippets, when present, are surfaced verbatim for near-verbatim quoting', () => {
  const withReviews = {
    ...lead,
    details: JSON.stringify({
      rating: 4.6, reviewCount: 103, primaryType: 'Barber shop',
      hours: ['Monday: Closed'],
      reviews: [{ text: 'Best fade in town, friendly staff.', author: 'Jordan M.' }],
    }),
  };
  const { facts, sheet } = buildFactSheet(withReviews);
  assert.ok(Array.isArray(facts.reviewSnippets));
  assert.equal(facts.reviewSnippets[0].text, 'Best fade in town, friendly staff.');
  assert.ok(sheet.includes('Best fade in town'), 'review snippet should appear in the sheet');
});

test('a sparse lead (no details) still yields a usable, invention-free fact sheet', () => {
  const { facts, allowedServices, sheet } = buildFactSheet({ name: 'Plain Co', niche: 'cafe', city: 'Austin, TX' });
  assert.equal(facts.name, 'Plain Co');
  assert.equal(facts.category, 'Cafe'); // titleCased niche fallback
  assert.deepEqual(allowedServices, ['Coffee', 'Pastries', 'Breakfast', 'Lunch']);
  assert.equal(facts.rating, null, 'no rating known => null, not a fabricated number');
  assert.ok(!sheet.includes('undefined'));
  assert.ok(!sheet.includes('NaN'));
});

test('an unknown niche falls back to a generic (non-fabricated) services note', () => {
  const { allowedServices, facts } = buildFactSheet({ name: 'Mystery LLC', niche: 'taxidermy', city: 'Reno, NV' });
  // No niche-specific whitelist: allowedServices is empty (the model must not invent specific services).
  assert.deepEqual(allowedServices, []);
  assert.equal(facts.category, 'Taxidermy');
});
