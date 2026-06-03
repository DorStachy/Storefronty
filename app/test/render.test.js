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

test('real photos: hero uses the first image + the gallery renders real <img> tiles (no placeholders)', async () => {
  const { html } = await renderContract(contract, 'editorial', { images: ['img/photo-0.jpg', 'img/photo-1.jpg', 'img/photo-2.jpg', 'img/photo-3.jpg'] });
  assert.ok(html.includes('class="hero-photo"'), 'hero uses the shop\'s first photo');
  assert.ok(html.includes('src="img/photo-0.jpg"'));
  assert.ok((html.match(/<div class="tile"><img /g) || []).length === 3, 'three real gallery tiles');
  assert.ok(!html.includes('data-query'), 'no placeholder tiles when real photos exist');
  assert.ok(!html.includes('{{'));
});

test('no images → decorative fallback (no hero photo, placeholder gallery tiles)', async () => {
  const { html } = await renderContract(contract, 'editorial', { images: [] });
  assert.ok(!html.includes('class="hero-photo"'));
  assert.ok(html.includes('data-query'), 'placeholder tiles when there are no photos');
});
