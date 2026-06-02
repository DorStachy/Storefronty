import { test } from 'node:test';
import assert from 'node:assert/strict';
import { last10, distinctiveTokens, host, registrable, nameCoverage, areaCode, parseAddress } from '../src/util/text.js';
import { escapeHtml, safeUrl } from '../src/util/html.js';

test('phone helpers', () => {
  assert.equal(last10('(512) 555-0199'), '5125550199');
  assert.equal(areaCode('+1 (512) 555-0199'), '512');
});

test('distinctiveTokens drops generic category words (incl. food) and ≤2-char tokens', () => {
  assert.deepEqual(distinctiveTokens('Cielito Lindo Cafe'), ['cielito', 'lindo']);
  assert.deepEqual(distinctiveTokens("Fade Theory Barbershop"), ['fade', 'theory']);
  assert.deepEqual(distinctiveTokens('Tacos El Guero'), ['guero']);          // "tacos" generic, "el" too short
  assert.deepEqual(distinctiveTokens('AB Fadez'), ['fadez']);                // "ab" dropped (≤2 chars)
});

test('host + registrable', () => {
  assert.equal(host('https://www.Example.com/x?y=1'), 'example.com');
  assert.equal(registrable('shop.example.com'), 'example.com');
});

test('nameCoverage', () => {
  assert.equal(nameCoverage('Cielito Lindo Cafe', 'cielito lindo cafe austin'), 1);
  assert.ok(nameCoverage('Cielito Lindo', 'totally unrelated') === 0);
});

test('escapeHtml neutralizes markup and quotes', () => {
  assert.equal(escapeHtml(`<script>"x"&'y'`), '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;');
});

test('safeUrl allows http(s)/tel/mailto, blocks javascript:', () => {
  assert.equal(safeUrl('https://instagram.com/x'), 'https://instagram.com/x');
  assert.equal(safeUrl('javascript:alert(1)'), '#');
  assert.equal(safeUrl(''), '#');
});

test('parseAddress: street + zip from a US Places-style string, strips apt/ste tails', () => {
  assert.deepEqual(
    parseAddress('411 Brazos St APT 101, Austin, TX 78701, USA'),
    { street: '411 Brazos St', zip: '78701' });
  assert.deepEqual(
    parseAddress('210 W 4th St Suite 200, Austin, TX 78701'),
    { street: '210 W 4th St', zip: '78701' });
  assert.deepEqual(parseAddress(''), { street: '', zip: '' });
  assert.deepEqual(parseAddress('No commas no digits'), { street: 'No commas no digits', zip: '' });
});
