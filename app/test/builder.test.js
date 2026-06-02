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
