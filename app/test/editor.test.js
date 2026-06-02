import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { overridesFromChange, applyEdit } from '../src/editor/index.js';
import { renderSite, PUBLIC_DIR } from '../src/builder/index.js';
import { openDatabase } from '../src/db.js';

const cfg = { mail: { user: '' }, postalAddress: 'X LLC, Austin, TX', publicBaseUrl: 'http://localhost:4173' };

test('overridesFromChange maps a colour word to an accent override', () => {
  const o = overridesFromChange('please make the colors navy');
  assert.equal(o.appliedColor, 'navy');
  assert.match(o.injectHeadHtml, /--accent:#1e3a5f/);
});

test('overridesFromChange returns nothing for a change with no known colour', () => {
  assert.deepEqual(overridesFromChange('add a photo of the patio'), {});
});

test('renderSite injects overrides.injectHeadHtml into the <head> (was a silent no-op)', async () => {
  const { indexHtml } = await renderSite(
    { name: 'Fade Theory', niche: 'barbershop' }, cfg,
    { injectHeadHtml: '<style id="ovr">:root{--accent:#1e3a5f}</style>' });
  assert.ok(indexHtml.includes('<style id="ovr">'), 'override style is present');
  assert.ok(indexHtml.indexOf('<style id="ovr">') < indexHtml.indexOf('</head>'), 'injected inside <head>');
  assert.ok(!indexHtml.includes('{{injectHeadHtml}}'));
});

test('renderSite without overrides leaves no leftover injectHeadHtml token', async () => {
  const { indexHtml } = await renderSite({ name: 'Fade Theory', niche: 'cafe' }, cfg);
  assert.ok(!indexHtml.includes('{{injectHeadHtml}}'));
});

test('applyEdit actually writes the requested colour into the built site (end-to-end)', async () => {
  const db = openDatabase(':memory:');
  const { id } = db.insertLead({ name: 'Edit Loop Cafe', niche: 'cafe', city: 'Austin, TX' });
  const r = await applyEdit(db, db.getLead(id), 'make it navy please', cfg);
  assert.match(r.applied, /navy/);
  const html = readFileSync(join(PUBLIC_DIR, 'edit-loop-cafe', 'index.html'), 'utf8');
  assert.match(html, /--accent:#1e3a5f/, 'the navy accent is actually in the output file');
  db.close();
});
