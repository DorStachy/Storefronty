import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { tick } from '../src/orchestrator.js';
import { config } from '../src/config.js';

// Hermetic: never really send (no SMTP creds), never call Gemini (force the deterministic fill),
// deliver to a fake test inbox. node --test isolates each file in its own process, so these
// singleton/env mutations don't leak to other suites.
config.mail.user = '';
config.mail.pass = '';
config.mail.testRecipient = 'demo@local.test';
delete process.env.GEMINI_API_KEY;

test('cold-pitch funnel: discovered → built → deployed → emailed (real build + screenshots, dry-run send)', async (t) => {
  // The build step screenshots headlessly — skip if no browser (keeps `npm test` green everywhere).
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
    name: 'Funnel Fades',
    niche: 'barbershop',
    city: 'Austin, TX',
    address: '1 Test St, Austin, TX 78701',
    phone: '(512) 555-0001',
    email: 'demo@local.test',
    details: { rating: 4.7, reviewCount: 51, primaryType: 'Barber shop', hours: ['Monday: 9 AM – 6 PM', 'Tuesday: 9 AM – 6 PM'] },
  });

  // discovered → built → deployed → emailed (one stage per tick)
  for (let i = 0; i < 6 && db.getLead(id).status !== 'emailed'; i++) await tick(db);

  const lead = db.getLead(id);
  assert.equal(lead.status, 'emailed', `funnel should reach emailed (got ${lead.status})`);

  const site = db.getSiteForLead(id);
  assert.equal(site.engine, 'theme');
  assert.ok(site.html_path, 'site html persisted');
  assert.ok(site.screenshot_path, 'screenshots dir persisted');

  const email1 = db.messagesFor(id).filter((m) => m.type === 'email1');
  assert.equal(email1.length, 1, 'exactly one cold email recorded');
  assert.equal(email1[0].subject, 'a website for Funnel Fades');
  db.close();
});
