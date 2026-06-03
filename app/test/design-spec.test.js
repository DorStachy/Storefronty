import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDesignSpec, DEFAULT_DESIGN, designForNiche, googleFontsHref, FONTS } from '../src/design/spec.js';

test('valid spec passes through', () => {
  const r = validateDesignSpec({ layout: 'luxe', palette: { bg: '#0b0b0d', ink: '#f5f3ee', accent: '#c8a24a' }, fonts: { display: 'Fraunces', body: 'Inter' }, scale: 'spacious', radius: 'soft', shadow: 'lifted', motion: 'subtle', texture: 'gradient' });
  assert.equal(r.layout, 'luxe');
  assert.equal(r.fonts.display, 'Fraunces');
  assert.equal(r.palette.accent, '#c8a24a');
});

test('off-list values coerce to defaults (never throws)', () => {
  const r = validateDesignSpec({ layout: 'spaceship', fonts: { display: 'Comic Sans MS', body: 'x' }, palette: { bg: 'red', accent: 'javascript:alert(1)' }, motion: 'wild' });
  assert.equal(r.layout, DEFAULT_DESIGN.layout);          // unknown enum → default
  assert.ok(FONTS.display.includes(r.fonts.display));      // off-list font → allowed default
  assert.match(r.palette.bg, /^#[0-9a-f]{3,8}$/i);         // non-hex → default hex
  assert.equal(r.motion, DEFAULT_DESIGN.motion);
});

test('garbage input → full default', () => {
  assert.deepEqual(validateDesignSpec(null), DEFAULT_DESIGN);
});

test('designForNiche gives a complete, valid spec', () => {
  const r = designForNiche('barber');
  assert.deepEqual(validateDesignSpec(r), r); // idempotent → already valid
});

test('googleFontsHref builds a fonts.googleapis link for allowed fonts only', () => {
  const href = googleFontsHref({ display: 'Fraunces', body: 'Inter' });
  assert.match(href, /^https:\/\/fonts\.googleapis\.com\/css2\?/);
  assert.match(href, /Fraunces/);
});
