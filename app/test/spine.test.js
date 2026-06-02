import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { research } from '../src/researcher/index.js';
import { seedFromResearch } from '../src/orchestrator.js';
import { canTransition } from '../src/states.js';

test('schema + insert/get roundtrip', () => {
  const db = openDatabase(':memory:');
  const { id, inserted } = db.insertLead({ name: 'Fade Theory', niche: 'barbershop', city: 'Austin, TX', address: '120 E 6th St' });
  assert.equal(inserted, true);
  const lead = db.getLead(id);
  assert.equal(lead.name, 'Fade Theory');
  assert.equal(lead.status, 'discovered');
  db.close();
});

test('dedup: inserting the same shop twice does not duplicate', () => {
  const db = openDatabase(':memory:');
  const a = db.insertLead({ name: 'Sharp & Co', niche: 'barbershop', address: '900 S Lamar' });
  const b = db.insertLead({ name: 'Sharp & Co', niche: 'barbershop', address: '900 S Lamar' });
  assert.equal(a.inserted, true);
  assert.equal(b.inserted, false);
  assert.equal(a.id, b.id);
  assert.equal(db.listLeads().length, 1);
  db.close();
});

test('state machine: legal vs illegal transitions', () => {
  assert.equal(canTransition('discovered', 'built'), true);
  assert.equal(canTransition('discovered', 'paid'), false);     // can't skip ahead
  assert.equal(canTransition('emailed', 'opted_out'), true);    // side-exit allowed
  assert.equal(canTransition('live', 'emailed'), false);        // terminal
});

test('setStatus enforces transitions + logs an event', () => {
  const db = openDatabase(':memory:');
  const { id } = db.insertLead({ name: 'X', niche: 'cafe' });
  db.setStatus(id, 'built');
  assert.equal(db.getLead(id).status, 'built');
  assert.throws(() => db.setStatus(id, 'paid'));                // illegal jump
  const types = db.eventsFor(id).map((e) => e.type);
  assert.ok(types.includes('status:built'));
  db.close();
});

test('researcher (mock) returns only no-website leads, respects niche + limit', async () => {
  const all = await research({ niche: 'cafe', engine: 'mock', limit: 10 });
  assert.ok(all.length >= 1);
  assert.ok(all.every((l) => l.niche === 'cafe'));
  assert.ok(all.every((l) => l.hasWebsite === false));         // the with-website chain is filtered out
});

test('suppression list', () => {
  const db = openDatabase(':memory:');
  assert.equal(db.isSuppressed('a@b.com'), false);
  db.addSuppression('A@B.com', 'opt_out');
  assert.equal(db.isSuppressed('a@b.com'), true);              // case-insensitive
  db.close();
});

test('seedFromResearch persists and dedups across runs', async () => {
  const db = openDatabase(':memory:');
  const r1 = await seedFromResearch(db, { niche: 'barbershop', engine: 'mock', limit: 10 });
  const r2 = await seedFromResearch(db, { niche: 'barbershop', engine: 'mock', limit: 10 });
  assert.ok(r1.inserted >= 1);
  assert.equal(r2.inserted, 0);          // second run: all dups
  assert.equal(r2.skipped, r1.inserted);
  db.close();
});
