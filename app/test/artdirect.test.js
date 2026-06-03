import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyArtDirection } from '../src/fill/artdirect.js';
import { validateDesignSpec } from '../src/design/spec.js';

const LEAD = { name: 'Olde Soul Barbershop', niche: 'barber', city: 'Austin', address: '5 Elm St, Austin, TX', phone: '512-555-0100', details: JSON.stringify({ rating: 4.8, reviewCount: 210, hours: ['Monday: 9 AM – 6 PM'] }) };
const fakeOpus = (contract, design) => async () => ({ content: [{ type: 'tool_use', name: 'emit_site', input: { contract, design } }] });

test('parses {contract, design} and validates both', async () => {
  const out = await applyArtDirection(LEAD, { change: 'make it bold and navy', apiKey: 'x',
    fetchJson: fakeOpus(
      { shopName: 'X', tagline: 'Sharp cuts', about: { paragraphs: ['We cut hair well enough to talk about.'] }, services: [{ name: 'Haircut', desc: 'A precise, clean cut tailored to you.' }], hours: { display: [{ day: 'Mon', value: '9–6' }] }, rating: { stars: 4.8, count: 210 }, contact: { addressLines: ['5 Elm St'] }, cta: { label: 'Book' }, galleryQueries: ['barber interior', 'fade', 'beard'] },
      { layout: 'bold', palette: { bg: '#0a0f1a', accent: '#3b6ea5' }, fonts: { display: 'Archivo', body: 'Work Sans' } }) });
  assert.equal(out.contract.shopName, 'Olde Soul Barbershop'); // grounding snaps the real name back
  assert.equal(out.design.layout, 'bold');
  assert.deepEqual(out.design, validateDesignSpec(out.design)); // design is validated
});

test('no key → deterministic fallback (contract + niche design), never throws', async () => {
  const out = await applyArtDirection(LEAD, { change: 'x' }); // no apiKey
  assert.equal(out.contract.shopName, 'Olde Soul Barbershop');
  assert.equal(out.design.layout, validateDesignSpec(out.design).layout);
});
