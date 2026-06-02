import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderContract } from '../src/builder/render.js';
import { fillDeterministic } from '../src/fill/deterministic.js';
import { validateContract } from '../src/contract/contract.js';

const contract = validateContract(
  fillDeterministic({
    name: 'Fade Theory',
    niche: 'barbershop',
    city: 'Austin, TX',
    phone: '(512) 555-0148',
    details: JSON.stringify({ rating: 4.8, reviewCount: 214, primaryType: 'Barber shop', hours: ['Monday: 9 AM – 7 PM'] }),
  }),
).value;

test('renders editorial with real data and no leftover tokens', async () => {
  const { html } = await renderContract(contract, 'editorial');
  assert.ok(!html.includes('{{'), 'no unfilled tokens');
  assert.ok(html.includes('Fade Theory'));
  assert.ok(html.includes('4.8')); // rating surfaced
  assert.ok(/Fades?/.test(html)); // a service surfaced
  assert.ok(html.includes('href')); // stylesheet linked
  assert.ok(html.includes('theme.css')); // css linked via the theme...
  assert.ok(!html.includes('styles.css')); // ...not the legacy global stylesheet
});

test('escapes an untrusted shop name (no XSS)', async () => {
  const evil = validateContract(fillDeterministic({ name: '<script>alert(1)</script>', niche: 'cafe', city: 'Austin' })).value;
  const { html } = await renderContract(evil, 'editorial');
  assert.ok(!html.includes('<script>alert(1)'));
  assert.ok(html.includes('&lt;script&gt;'));
});
