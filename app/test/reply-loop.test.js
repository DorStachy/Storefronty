import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { tick, handleReply } from '../src/orchestrator.js';
import { handleApproval } from '../src/approval/index.js';
import { signToken } from '../src/util/sign.js';
import { config } from '../src/config.js';

// Hermetic: never really send, force deterministic fill + deterministic Opus fallback (no keys),
// review mode, fake test inbox. node --test isolates this file's process.
config.mail.user = '';
config.mail.pass = '';
config.email = { resendKey: '', from: '' }; // also force dry-run (no Resend either) — tests never really send
config.mail.testRecipient = 'demo@local.test';
config.mode = 'review';
delete process.env.GEMINI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

test('reply loop: edit reply → Opus rebuild → QA → founder approve → 2-link reply email', async (t) => {
  // The rebuild step screenshots/QAs headlessly — skip without a browser.
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
    const b = await chromium.launch({ headless: true });
    await b.close();
  } catch (e) {
    t.skip(`no browser: ${String(e.message || e).split('\n')[0]}`);
    return;
  }

  const db = openDatabase(':memory:');
  const { id } = db.insertLead({
    name: 'Reply Cafe', niche: 'cafe', city: 'Austin, TX', email: 'demo@local.test',
    details: { rating: 4.6, reviewCount: 40, primaryType: 'Cafe', hours: ['Monday: 7 AM – 4 PM'] },
  });
  for (const s of ['built', 'deployed', 'emailed']) db.setStatus(id, s); // pretend the cold pitch went out

  const r = await handleReply(db, db.getLead(id), 'Could you make it navy and we close at 7 now?');
  assert.equal(r.intent, 'edit_request');
  assert.equal(db.getLead(id).status, 'replied');

  await tick(db); // replied → (editing) → pending_approval, founder notified
  assert.equal(db.getLead(id).status, 'pending_approval');
  assert.ok(db.getSiteForLead(id), 'the rebuilt site row exists');

  // founder approves via the signed endpoint (POST performs it)
  const token = signToken({ leadId: id, kind: 'approve' }, config.signSecret);
  handleApproval({ method: 'POST', urlPath: `/approve/${token}`, db, config });
  assert.equal(db.getLead(id).status, 'approved');

  await tick(db); // approved → deploy 48h + send the 2-link reply email → link_sent
  assert.equal(db.getLead(id).status, 'link_sent');
  const email2 = db.messagesFor(id).filter((m) => m.type === 'email2');
  assert.equal(email2.length, 1, 'exactly one reply email recorded');
  const site = db.getSiteForLead(id);
  assert.ok(site.preview_url, 'site is live');
  assert.ok(site.expires_at, 'with a 48h expiry');
  db.close();
});

test('reply loop: an opt-out reply suppresses the address and opts the lead out (rules, not LLM)', async () => {
  const db = openDatabase(':memory:');
  const { id } = db.insertLead({ name: 'Bye Cafe', niche: 'cafe', email: 'bye@local.test' });
  for (const s of ['built', 'deployed', 'emailed']) db.setStatus(id, s);
  const r = await handleReply(db, db.getLead(id), 'please unsubscribe me');
  assert.equal(r.intent, 'opt_out');
  assert.equal(db.getLead(id).status, 'opted_out');
  assert.equal(db.isSuppressed('bye@local.test'), true);
  db.close();
});
