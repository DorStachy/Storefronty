import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSiteHtml, extractHtmlDocument } from '../src/builder/sanitizeHtml.js';

test('strips all <script> tags (inline + external) — no JS reaches the public page', () => {
  const out = sanitizeSiteHtml('<head><script src="https://evil.cdn/x.js"></script><script>alert(1)</script></head><body>hi</body>');
  assert.doesNotMatch(out, /<script/i);
  assert.ok(out.includes('hi'));
});

test('strips external <link> but keeps Google Fonts + inline <style>', () => {
  const out = sanitizeSiteHtml('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"><link rel="stylesheet" href="https://evil.cdn/x.css"><style>body{color:red}</style>');
  assert.match(out, /fonts\.googleapis\.com/);
  assert.doesNotMatch(out, /evil\.cdn/);
  assert.match(out, /body\{color:red\}/);
});

test('strips on*= handlers and javascript: URLs, keeps image refs', () => {
  const out = sanitizeSiteHtml('<a href="javascript:alert(1)" onclick="x()">a</a><img src="img/photo-0.jpg" onerror="y()">');
  assert.doesNotMatch(out, /onclick=/i);
  assert.doesNotMatch(out, /onerror=/i);
  assert.doesNotMatch(out, /javascript:/i);
  assert.match(out, /src="img\/photo-0\.jpg"/);
});

test('heals placeholder/broken anchors (empty / "#" / hrefless) so QA never discards a good page', () => {
  const out = sanitizeSiteHtml(
    '<a href="#">menu</a><a href="">logo</a><a class="x">bare</a>' +
    '<a href="#gallery">Gallery</a><a href="tel:+15551234">Call</a><a href="https://instagram.com/shop">IG</a>',
  );
  assert.doesNotMatch(out, /href="#"/);                       // no bare "#" survives (QA bad_link)
  assert.equal((out.match(/href="#main"/g) || []).length, 3); // the 3 placeholders are healed to an inert fragment
  assert.match(out, /class="x" href="#main"|href="#main" class="x"|<a href="#main" class="x">/); // hrefless <a> got one
  // real, working links are preserved verbatim
  assert.match(out, /href="#gallery"/);
  assert.match(out, /href="tel:\+15551234"/);
  assert.match(out, /href="https:\/\/instagram\.com\/shop"/);
});

test('strips iframe/object/embed/base', () => {
  const out = sanitizeSiteHtml('<iframe src="https://x"></iframe><object></object><embed><base href="https://x">ok');
  assert.doesNotMatch(out, /<iframe|<object|<embed|<base/i);
  assert.ok(out.includes('ok'));
});

test('keeps inline data:image URLs (our base64 photos survive)', () => {
  const out = sanitizeSiteHtml('<img src="data:image/png;base64,AAAA">');
  assert.match(out, /data:image\/png;base64,AAAA/);
});

test('extractHtmlDocument pulls the doc out of a fenced model reply', () => {
  const doc = extractHtmlDocument('Sure!\n```html\n<!doctype html><html><body>x</body></html>\n```\nDone');
  assert.match(doc, /^<!doctype html>/i);
  assert.match(doc, /<\/html>$/i);
});

test('extractHtmlDocument returns "" when there is no html', () => {
  assert.equal(extractHtmlDocument('no html here'), '');
});
