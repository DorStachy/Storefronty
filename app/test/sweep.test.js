import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { sweep } from '../src/sweep/index.js';
import { buildIdentity } from '../src/researcher/index.js';

// A controllable place set: one with a site (engine-drop), one sendable, one UNCERTAIN, one no-email.
const PLACES = {
  cafe: [
    { name: 'Has Site Co', niche: 'cafe', city: 'Pflugerville, TX', hasWebsite: true, source: 'places:1' },
    { name: 'Sendable Cafe', niche: 'cafe', city: 'Pflugerville, TX', phone: '(512) 555-0101', hasWebsite: false, source: 'places:2' },
    { name: 'Unsure Cafe', niche: 'cafe', city: 'Pflugerville, TX', hasWebsite: false, source: 'places:3' },
    { name: 'NoEmail Cafe', niche: 'cafe', city: 'Pflugerville, TX', hasWebsite: false, source: 'places:4' },
  ],
};
const deps = {
  placesSearch: async ({ niche }) => PLACES[niche] || [],
  buildIdentity,
  discover: async (id) => {
    if (/Sendable/.test(id.name)) return { status: 'NO_WEBSITE', reasons: ['knowledge_panel_no_site'] };
    if (/NoEmail/.test(id.name)) return { status: 'NO_WEBSITE', reasons: ['knowledge_panel_no_site'] };
    return { status: 'UNCERTAIN' };
  },
  discoverEmail: async (id) => (/Sendable/.test(id.name) ? { email: 'sendable@gmail.com', confidence: 'high', source: 'serp' } : { email: null }),
};

test('sweep funnel: only NO_WEBSITE + email qualifies; counts are right; lead is persisted', async () => {
  const db = openDatabase(':memory:');
  const r = await sweep(db, { niches: ['cafe'], cities: ['Pflugerville, TX'], perCity: 10, want: 5 }, deps);
  assert.equal(r.scanned, 4);
  assert.equal(r.noWebsite, 2);     // Sendable + NoEmail
  assert.equal(r.hasEmail, 1);      // only Sendable
  assert.equal(r.sendable.length, 1);
  assert.equal(r.sendable[0].name, 'Sendable Cafe');
  assert.equal(r.sendable[0].email, 'sendable@gmail.com');
  const lead = db.getLead(r.sendable[0].leadId);
  assert.equal(lead.email, 'sendable@gmail.com');             // persisted with the discovered email
  assert.equal(lead.status, 'discovered');
  db.close();
});

test('sweep stops early once `want` sendable leads are found', async () => {
  const db = openDatabase(':memory:');
  let discoverCalls = 0;
  const countingDeps = { ...deps, discover: async (id) => { discoverCalls++; return deps.discover(id); } };
  const r = await sweep(db, { niches: ['cafe'], cities: ['Pflugerville, TX'], perCity: 10, want: 1 }, countingDeps);
  assert.equal(r.sendable.length, 1);
  assert.ok(discoverCalls <= 2, 'stopped scanning right after the first sendable lead');
  db.close();
});
