import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { tick } from '../src/orchestrator.js';

test('errorsSinceLastStatus counts errors since the last status change, and resets on advance', () => {
  const db = openDatabase(':memory:');
  const { id } = db.insertLead({ name: 'X', niche: 'cafe' });
  assert.equal(db.errorsSinceLastStatus(id), 0);
  db.recordEvent(id, 'error', { status: 'discovered' });
  db.recordEvent(id, 'error', { status: 'discovered' });
  assert.equal(db.errorsSinceLastStatus(id), 2);
  db.setStatus(id, 'built');                       // an advance resets the window
  assert.equal(db.errorsSinceLastStatus(id), 0);
  db.close();
});

test('tick quarantines a lead to needs_human after N consecutive errors (no infinite retries)', async () => {
  const db = openDatabase(':memory:');
  const { id } = db.insertLead({ name: 'Cursed Lead', niche: 'cafe' });
  const handlers = { discovered: async () => { throw new Error('boom'); } };  // always fails

  await tick(db, { handlers, errorCap: 3 });
  await tick(db, { handlers, errorCap: 3 });
  assert.equal(db.getLead(id).status, 'discovered');   // still retrying (2 errors)
  const acted = await tick(db, { handlers, errorCap: 3 });

  assert.equal(db.getLead(id).status, 'needs_human');  // 3rd error → quarantined
  assert.ok(acted.some((a) => a.id === id && a.quarantined));
  const ev = db.eventsFor(id).find((e) => e.type === 'status:needs_human');
  assert.match(ev.payload, /error_cap/);
  db.close();
});

test('tick stops touching a quarantined lead on subsequent passes', async () => {
  const db = openDatabase(':memory:');
  const { id } = db.insertLead({ name: 'Cursed', niche: 'cafe' });
  let calls = 0;
  const handlers = { discovered: async () => { calls++; throw new Error('boom'); } };
  for (let i = 0; i < 6; i++) await tick(db, { handlers, errorCap: 3 });
  assert.equal(db.getLead(id).status, 'needs_human');
  assert.equal(calls, 3, 'handler is not invoked again once quarantined');
  db.close();
});
