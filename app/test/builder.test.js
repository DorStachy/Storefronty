import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSite } from '../src/builder/index.js';
import { openDatabase } from '../src/db.js';
import { tick } from '../src/orchestrator.js';

const cfg = { mail: { user: '' }, postalAddress: 'X LLC, Austin, TX', publicBaseUrl: 'http://localhost:4173' };

test('renderSite fills a barbershop with no leftover tokens', async () => {
  const { indexHtml, slug } = await renderSite(
    { name: 'Fade Theory', niche: 'barbershop', city: 'Austin, TX', phone: '(512) 555-0148', address: '120 E 6th St' }, cfg);
  assert.equal(slug, 'fade-theory');
  assert.ok(!indexHtml.includes('{{'), 'no unfilled tokens');
  assert.ok(indexHtml.includes('Fade Theory'));
  assert.ok(indexHtml.includes('Austin, TX'));
  assert.ok(indexHtml.includes('Beard trim'));            // default service applied
});

test('renderSite picks the cafe template for cafe niche', async () => {
  const { indexHtml } = await renderSite({ name: 'Morning Ember', niche: 'cafe', city: 'Austin' }, cfg);
  assert.ok(indexHtml.includes('From the menu'));         // cafe-only copy
  assert.ok(!indexHtml.includes('{{'));
});

test('pricing page is personalized and points styles at ../styles.css', async () => {
  const { pricingHtml } = await renderSite({ name: 'Fade Theory', niche: 'barbershop' }, cfg);
  assert.ok(pricingHtml.includes("Fade Theory's site is live"));
  assert.ok(pricingHtml.includes('href="../styles.css"'));
  assert.ok(!pricingHtml.includes('{{'));
});

test('builder escapes an untrusted shop name and neutralizes a bad instagram URL (no XSS)', async () => {
  const { indexHtml } = await renderSite({ name: '<script>alert(1)</script>', niche: 'cafe', instagram: 'javascript:alert(1)' }, cfg);
  assert.ok(!indexHtml.includes('<script>alert(1)'), 'raw script must not appear');
  assert.ok(indexHtml.includes('&lt;script&gt;'), 'name is HTML-escaped');
  assert.ok(!indexHtml.includes('javascript:alert(1)'), 'javascript: URL is neutralized');
});

test('builder renders a "Check our socials" section from verified socials (escaped + URL-validated)', async () => {
  const lead = { name: 'Fade Theory', niche: 'barbershop',
    socials: { instagram: 'https://instagram.com/fadetheory', tiktok: 'https://tiktok.com/@fadetheory' } };
  const { indexHtml } = await renderSite(lead, cfg);
  assert.ok(indexHtml.includes('https://instagram.com/fadetheory'));
  assert.ok(indexHtml.includes('https://tiktok.com/@fadetheory'));
  assert.ok(/Instagram/i.test(indexHtml) && /TikTok/i.test(indexHtml));
  assert.ok(!indexHtml.includes('{{socialsHtml}}'));
  assert.ok(!indexHtml.includes('{{instagram}}'));        // old placeholder fully replaced
});

test('builder socials section: tolerates JSON-string socials and neutralizes a bad URL', async () => {
  const lead = { name: 'Fade Theory', niche: 'cafe',
    socials: JSON.stringify({ instagram: 'javascript:alert(1)', facebook: 'https://facebook.com/fadetheory' }) };
  const { indexHtml } = await renderSite(lead, cfg);
  assert.ok(!indexHtml.includes('javascript:alert(1)'), 'bad social URL neutralized');
  assert.ok(indexHtml.includes('https://facebook.com/fadetheory'));
});

test('builder omits the socials section entirely when there are none', async () => {
  const { indexHtml } = await renderSite({ name: 'No Socials Shop', niche: 'cafe' }, cfg);
  assert.ok(!indexHtml.includes('{{socialsHtml}}'));
  assert.ok(!/Instagram|TikTok|Facebook/i.test(indexHtml));
});

test('orchestrator tick: discovered → built → deployed (+beyond), with a correct preview URL', async () => {
  const db = openDatabase(':memory:');
  const { id } = db.insertLead({ name: 'QA Tick Shop', niche: 'cafe', city: 'Austin, TX' });
  await tick(db);                                         // builds, deploys, (and emails) in one pass
  const site = db.getSiteForLead(id);
  assert.ok(site, 'a site row exists');
  assert.match(site.preview_url, /qa-tick-shop\/$/);     // not "/undefined/"
  // the lead must have advanced past build/deploy (exact end depends on email config)
  assert.ok(['deployed', 'emailed', 'needs_human'].includes(db.getLead(id).status));
  db.close();
});
