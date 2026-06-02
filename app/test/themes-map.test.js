import { test } from 'node:test';
import assert from 'node:assert/strict';
import { themeForNiche } from '../src/themes/map.js';

test('niches map to the right theme; unknown -> editorial', () => {
  assert.equal(themeForNiche('barbershop'), 'luxe');
  assert.equal(themeForNiche('Nail Salon'), 'editorial');
  assert.equal(themeForNiche('food truck'), 'bold');
  assert.equal(themeForNiche('cafe'), 'editorial');
  assert.equal(themeForNiche('something weird'), 'editorial');
});
