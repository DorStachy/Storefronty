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

test('approved: a CLAIMED owner is answered IN THE PORTAL CHAT, not sent another claim email', async () => {
  const db = openDatabase(':memory:');
  const { id } = db.insertLead({ name: 'Claimed Cafe', niche: 'cafe', email: 'demo@local.test' });
  for (const s of ['built', 'deployed', 'emailed', 'replied', 'editing', 'approved']) db.setStatus(id, s);
  db.addSite(id, { slug: 'claimed-cafe', engine: 'llm-html', htmlPath: '/tmp/x/index.html' }); // deploy is local (just a URL)
  const acctId = db.addAccount({ leadId: id, email: 'demo@local.test', passwordHash: 'x' });   // they've claimed
  db.addChangeRequest({ accountId: acctId, leadId: id, body: 'add a gallery of my 5 photos', kind: 'free' });
  db.recordEvent(id, 'edit_request', { change: 'add a gallery of my 5 photos', via: 'portal' });

  await tick(db); // the 'approved' handler runs

  assert.equal(db.getLead(id).status, 'link_sent');
  assert.equal(db.messagesFor(id).filter((m) => m.type === 'email2').length, 0, 'no claim email to an already-claimed owner');
  assert.equal(db.messagesFor(id).filter((m) => m.type === 'update').length, 1, 'a brief no-claim "it\'s live" email is sent too');
  const reqs = db.changeRequestsFor(acctId);
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0].status, 'done');
  assert.match(reqs[0].result, /updated your site/i); // the completion the chat shows
  db.close();
});

test('approved: a claimed owner who replied by EMAIL still sees it answered in the chat (mirrored)', async () => {
  const db = openDatabase(':memory:');
  const { id } = db.insertLead({ name: 'Mirror Cafe', niche: 'cafe', email: 'demo@local.test' });
  for (const s of ['built', 'deployed', 'emailed', 'replied', 'editing', 'approved']) db.setStatus(id, s);
  db.addSite(id, { slug: 'mirror-cafe', engine: 'llm-html', htmlPath: '/tmp/y/index.html' });
  const acctId = db.addAccount({ leadId: id, email: 'demo@local.test', passwordHash: 'x' });
  db.recordEvent(id, 'edit_request', { change: 'make the header green', via: 'email' }); // NO portal change_request

  await tick(db);

  const reqs = db.changeRequestsFor(acctId);
  assert.equal(reqs.length, 1, 'the email change is mirrored into the chat thread');
  assert.equal(reqs[0].status, 'done');
  assert.match(reqs[0].body, /header green/);
  assert.equal(db.messagesFor(id).filter((m) => m.type === 'email2').length, 0);
  assert.equal(db.messagesFor(id).filter((m) => m.type === 'update').length, 1); // brief no-claim confirmation
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
