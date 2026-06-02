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
  assert.equal(r.value.shopName, 'Silva’s');
  assert.equal(r.value.rating.stars, 4.6);
  assert.equal(r.value.rating.count, 103);
  assert.ok(r.value.services.length >= 1);
  assert.ok(r.value.hours.display.some((d) => d.value.includes('7:15')));
  assert.ok(r.value.galleryQueries.length >= 3);
});

test('missing details still produces a valid contract', () => {
  const r = validateContract(fillDeterministic({ name: 'Plain Co', niche: 'cafe', city: 'Austin, TX' }));
  assert.equal(r.ok, true, r.errors?.join(', '));
});
