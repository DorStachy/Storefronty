import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidateDomains, tokens } from '../src/researcher/verify.js';
import { research } from '../src/researcher/index.js';

test('candidateDomains derives the real hyphenated domain (the Cielito case)', () => {
  const d = candidateDomains('Cielito Lindo Cafe');
  assert.ok(d.includes('cielito-lindo-cafe.com'), `expected cielito-lindo-cafe.com in ${d.join(',')}`);
});

test('candidateDomains covers joined + hyphenated for a two-word name', () => {
  const d = candidateDomains('Fade Theory');
  assert.ok(d.includes('fadetheory.com'));
  assert.ok(d.includes('fade-theory.com'));
});

test('tokens strips punctuation and lowercases', () => {
  assert.deepEqual(tokens("Marshall's Barber Shop"), ['marshall', 's', 'barber', 'shop']);
});

test('research drops a candidate when the verifier finds a website (injected verifier)', async () => {
  const fakeVerifier = async (lead) => (lead.name === 'Morning Ember' ? 'https://morningember.com' : null);
  const leads = await research({ niche: 'cafe', engine: 'mock', verify: true, findWebsite: fakeVerifier });
  assert.ok(!leads.some((l) => l.name === 'Morning Ember'), 'shop with a found site is dropped');
  assert.ok(leads.some((l) => l.name === 'Live Oak Coffee'), 'shop with no site is kept');
});

test('research with verify=false keeps all no-website candidates (offline path)', async () => {
  const leads = await research({ niche: 'cafe', engine: 'mock', verify: false });
  assert.ok(leads.some((l) => l.name === 'Morning Ember'));
});
