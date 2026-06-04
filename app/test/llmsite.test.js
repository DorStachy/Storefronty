import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateSiteHtml, systemPrompt } from '../src/builder/llmsite.js';
import { writeLlmSite, slugFor, PUBLIC_DIR } from '../src/builder/build2.js';

const LEAD = {
  name: 'TJ Nails Spa', niche: 'nail salon', city: 'Leander, TX', phone: '(512) 337-7377',
  details: JSON.stringify({ rating: 4.8, reviewCount: 294, hours: ['Monday: 9 AM – 7 PM'] }),
};
const fakeReply = (html) => async () => ({ content: [{ type: 'text', text: html }] });

test('generateSiteHtml returns a SANITIZED full HTML document from the model reply', async () => {
  const html = await generateSiteHtml(LEAD, {
    change: 'dark and elegant', imageFiles: ['img/photo-0.jpg'], apiKey: 'x',
    fetchJson: fakeReply('<!doctype html><html><head><style>body{background:#111}</style><script src="https://evil/x.js"></script></head><body><h1>TJ Nails Spa</h1><img src="img/photo-0.jpg"></body></html>'),
  });
  assert.match(html, /^<!doctype html>/i);
  assert.doesNotMatch(html, /<script/i);            // sanitized
  assert.ok(html.includes('TJ Nails Spa'));
  assert.ok(html.includes('img/photo-0.jpg'));
});

test('generateSiteHtml: no apiKey → null (caller falls back to the token engine)', async () => {
  assert.equal(await generateSiteHtml(LEAD, { change: 'x' }), null);
});

test('generateSiteHtml: reply with no html document → null', async () => {
  const out = await generateSiteHtml(LEAD, { change: 'x', apiKey: 'x', fetchJson: fakeReply('I cannot do that') });
  assert.equal(out, null);
});

test('systemPrompt frees the designer on an edit (genuinely ADD, never just swap) but keeps honesty + safety', () => {
  const edit = systemPrompt('nail salon', ['img/photo-0.jpg', 'img/photo-1.jpg'], '<!doctype html><html></html>');
  // FREED: an "add" must build a real new section, not collapse into a swap — and the old cage is gone.
  assert.match(edit, /genuinely ADD/i);
  assert.match(edit, /never collapse an "add"/i);
  assert.doesNotMatch(edit, /keep everything else identical/i);
  assert.match(edit, /BUILD that section for real/i);
  assert.match(edit, /img\/photo-0\.jpg/);              // exact image paths still pinned
  // The ONE guardrail that stays: never fabricate facts about the business.
  assert.match(edit, /use ONLY the verified facts/i);
  assert.match(edit, /never\s+fabricate/i);
  // Hard safety rails remain (single self-contained public file).
  assert.match(edit, /NO JavaScript/i);
  assert.match(edit, /Google Fonts/i);
  // Single-page + working-links rule (prevents the bad_link → token-fallback that ate real changes).
  assert.match(edit, /ONE single self-contained page/i);
  assert.match(edit, /new SECTION in THIS document/i);
  assert.match(edit, /NEVER output/i);
  assert.match(edit, /separate \.html file/i);
  // A fresh build (no baseHtml) carries no edit paragraph.
  assert.doesNotMatch(systemPrompt('cafe', [], null), /This is an EDIT/i);
});

test('writeLlmSite writes index.html under the slug dir', async () => {
  const lead = { id: 1, name: 'Write Test Salon', niche: 'nail salon' };
  const out = await writeLlmSite(lead, { html: '<!doctype html><html><body>X</body></html>' });
  assert.equal(out.engine, 'llm-html');
  assert.match(out.htmlPath.replace(/\\/g, '/'), /write-test-salon\/index\.html$/);
  assert.ok(readFileSync(join(PUBLIC_DIR, slugFor(lead), 'index.html'), 'utf8').includes('<body>X'));
});
