import { test } from 'node:test';
import assert from 'node:assert/strict';
import { designToCss } from '../src/design/css.js';
import { designForNiche, validateDesignSpec } from '../src/design/spec.js';

test('emits the palette as CSS custom properties', () => {
  const css = designToCss(validateDesignSpec({ palette: { bg: '#101010', accent: '#ff8800' } }));
  assert.match(css, /--bg:\s*#101010/);
  assert.match(css, /--accent:\s*#ff8800/);
  assert.match(css, /font-family/);
});

test('is self-contained: no external url() references', () => {
  const css = designToCss(designForNiche('restaurant'));
  assert.doesNotMatch(css, /url\(\s*['"]?https?:/i); // fonts come via <link>, never @import/url in CSS
});

test('motion:none emits no transitions/animations', () => {
  const css = designToCss(validateDesignSpec({ motion: 'none' }));
  assert.doesNotMatch(css, /transition:/);
});

import { designBrief } from '../src/design/playbook.js';
test('designBrief is niche-aware and non-empty', () => {
  const b = designBrief('restaurant');
  assert.ok(b.length > 200);
  assert.match(b, /restaurant|dining|menu/i);
  assert.doesNotMatch(b, /\{\{/); // no leftover template holes
});
