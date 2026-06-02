import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSite } from '../src/builder/index.js';
import { composeColdEmail, sendColdEmail } from '../src/salesman/index.js';
import { openDatabase } from '../src/db.js';

const shots = [
  { name: 'hero', path: '/tmp/hero.png' },
  { name: 'services', path: '/tmp/services.png' },
  { name: 'gallery', path: '/tmp/gallery.png' },
];

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

test('composeColdEmail = approved §5.6 copy, 3 inline screenshots, NO live link', () => {
  const { subject, html, text, attachments } = composeColdEmail({ name: 'Fade Theory', niche: 'barbershop' }, { shots, config: cfg });
  assert.equal(subject, 'a website for Fade Theory');
  assert.ok(text.includes("My name's Michael and I'm a web designer"));
  assert.ok(text.includes("I'll make those changes for free, so you can see I'm serious"));
  assert.ok(text.includes("You're not signing up for anything."));
  assert.ok(!/https?:\/\//.test(text), 'the cold email carries NO live link (link only comes after a reply)');
  assert.ok(!/[\u{1F300}-\u{1FAFF}☀-➿←-⇿]/u.test(text), 'hand-typed: no emojis');
  assert.equal(attachments.length, 3); // 3 section screenshots attached
  assert.ok(html.includes('cid:shot0@storefronty') && html.includes('cid:shot2@storefronty')); // inline
  assert.ok(html.includes('Storefronty LLC')); // physical address (CAN-SPAM)
  assert.ok(text.toLowerCase().includes('unsubscribe'));
  assert.ok(!html.includes('{{'));
});

test('composeColdEmail per-niche variant: services/menu wording + action phrase', () => {
  const barber = composeColdEmail({ name: 'Fade Theory', niche: 'barbershop' }, { shots, config: cfg }).text;
  assert.ok(barber.includes('your services'));
  assert.ok(barber.includes('walk in or book'));
  const cafe = composeColdEmail({ name: 'Bean There', niche: 'coffee shop' }, { shots, config: cfg }).text;
  assert.ok(cafe.includes('your menu'));
  assert.ok(cafe.includes('how many people walk in.')); // 'walk in' (food), ends the sentence
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

test('composeColdEmail HTML-escapes an untrusted shop name (no XSS into the email body)', () => {
  const { subject, html, text } = composeColdEmail({ name: '<script>alert(1)</script>Bad Cafe', niche: 'cafe' }, { shots, config: cfg });
  assert.ok(!html.includes('<script>alert(1)'), 'raw script tag must not appear in HTML');
  assert.ok(html.includes('&lt;script&gt;'), 'name is HTML-escaped in the body');
  // plain text is fine — text/plain rendering doesn't execute markup
  assert.ok(subject.includes('<script>'));
  assert.ok(text.includes('<script>'));
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
