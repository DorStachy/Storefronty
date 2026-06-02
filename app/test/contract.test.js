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
  const long = 'x '.repeat(80).trim();
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
