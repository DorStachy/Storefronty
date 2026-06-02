import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSite } from '../src/builder/index.js';
import { composeEmail1, sendColdEmail } from '../src/salesman/index.js';
import { openDatabase } from '../src/db.js';

const cfg = {
  mail: { user: '', pass: '', fromName: 'Michael', testRecipient: 'demo@local.test' },
  brand: 'Storefronty', postalAddress: 'Storefronty LLC, Austin, TX', publicBaseUrl: 'http://localhost:4173',
};

test('builder uses REAL details: summary→tagline, rating badge, real hours', async () => {
  const lead = {
    name: 'Fade Theory', niche: 'barbershop', city: 'Austin, TX',
    details: {
      summary: 'Known for precise skin fades and hot-towel shaves.', rating: 4.8, reviewCount: 214,
      hours: ['Monday: 9:00 AM – 8:00 PM', 'Saturday: 10:00 AM – 4:00 PM', 'Sunday: Closed'],
    },
  };
  const { indexHtml } = await renderSite(lead, cfg);
  assert.ok(indexHtml.includes('Known for precise skin fades'));   // summary became the tagline
  assert.ok(indexHtml.includes('★ 4.8'));                          // rating trust badge
  assert.ok(indexHtml.includes('214 Google reviews'));
  assert.ok(indexHtml.includes('10:00 AM – 4:00 PM'));             // real Saturday hours
  assert.ok(!indexHtml.includes('{{'));
});

test('builder still renders fine when there are no details (fallback defaults)', async () => {
  const { indexHtml } = await renderSite({ name: 'Plain Shop', niche: 'cafe' }, cfg);
  assert.ok(!indexHtml.includes('{{'));
  assert.ok(!indexHtml.includes('class="rating"'));               // no badge without a rating
  assert.ok(indexHtml.includes('From the menu'));
});

test('composeEmail1 builds a CAN-SPAM email with the preview link', () => {
  const { subject, html, text } = composeEmail1(
    { name: 'Fade Theory' }, { preview_url: 'http://localhost:4173/fade-theory/' }, cfg);
  assert.match(subject, /Fade Theory/);
  assert.ok(html.includes('http://localhost:4173/fade-theory/'));  // the preview link
  assert.ok(html.includes('Storefronty LLC'));                     // physical address (CAN-SPAM)
  assert.ok(text.toLowerCase().includes('unsubscribe'));
  assert.ok(!html.includes('{{'));
});

test('sendColdEmail (dry-run) records an outbound message', async () => {
  const db = openDatabase(':memory:');
  const { id } = db.insertLead({ name: 'Fade Theory', niche: 'barbershop' });
  const r = await sendColdEmail(db, db.getLead(id), cfg);
  assert.equal(r.sent, true);
  assert.equal(r.dry, true);                                       // no creds -> dry
  assert.equal(db.messagesFor(id).length, 1);
  assert.equal(db.messagesFor(id)[0].direction, 'out');
  db.close();
});

test('sendColdEmail respects the suppression list', async () => {
  const db = openDatabase(':memory:');
  const { id } = db.insertLead({ name: 'X', niche: 'cafe' });
  db.addSuppression('demo@local.test', 'opt_out');
  const r = await sendColdEmail(db, db.getLead(id), cfg);
  assert.equal(r.skipped, 'suppressed');
  assert.equal(db.messagesFor(id).length, 0);
  db.close();
});

test('composeEmail1 HTML-escapes an untrusted shop name (no XSS into the email body)', () => {
  const { subject, html, text } = composeEmail1(
    { name: '<script>alert(1)</script>Bad Cafe' },
    { preview_url: 'http://localhost:4173/x/' }, cfg);
  assert.ok(!html.includes('<script>alert(1)'), 'raw script tag must not appear in HTML');
  assert.ok(html.includes('&lt;script&gt;'), 'name is HTML-escaped in the body');
  // plain text is fine — text/plain rendering doesn't execute markup
  assert.ok(subject.includes('<script>'));
  assert.ok(text.includes('<script>'));
});

test('composeEmail1 neutralizes a javascript: preview link (button href is "#")', () => {
  const { html } = composeEmail1(
    { name: 'Fade Theory' },
    { preview_url: 'javascript:alert(1)' }, cfg);
  assert.ok(!html.includes('href="javascript:'), 'javascript: scheme rejected from href');
  assert.ok(html.includes('href="#"'), 'href falls back to "#"');
});

test('sendColdEmail does NOT re-send if an outbound email1 already exists', async () => {
  const db = openDatabase(':memory:');
  const { id } = db.insertLead({ name: 'Twice', niche: 'cafe' });
  const r1 = await sendColdEmail(db, db.getLead(id), cfg);
  assert.equal(r1.sent, true);
  const r2 = await sendColdEmail(db, db.getLead(id), cfg);
  assert.equal(r2.skipped, 'already_emailed');
  assert.equal(db.messagesFor(id).length, 1);  // still just the one
  db.close();
});
