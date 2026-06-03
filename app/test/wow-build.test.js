import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { writeSite, PUBLIC_DIR, slugFor } from '../src/builder/build2.js';
import { fillDeterministic } from '../src/fill/deterministic.js';
import { designForNiche } from '../src/design/spec.js';
import { staticQa } from '../src/qa/index.js'; // NEW pure helper (no browser) for fact + self-contained checks
import { escapeHtml } from '../src/util/html.js';
import { applyArtDirection } from '../src/fill/artdirect.js';
import { openDatabase } from '../src/db.js';
import { tick, handleReply } from '../src/orchestrator.js';
import { config } from '../src/config.js';

test('writeSite with a design writes the v3 site + generated theme.css (bespoke palette)', async () => {
  const lead = { name: 'Thicket Food Park', niche: 'restaurant', city: 'Austin', address: '9 Oak, Austin, TX', details: JSON.stringify({ rating: 4.7, reviewCount: 88, hours: ['Monday: 11 AM – 9 PM'] }) };
  const design = designForNiche('restaurant');
  const r = await writeSite(lead, fillDeterministic(lead), { design });
  const dir = join(PUBLIC_DIR, slugFor(lead));
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const css = readFileSync(join(dir, 'theme.css'), 'utf8');
  assert.match(html, /Thicket Food Park/);
  assert.match(html, /fonts\.googleapis\.com/);          // fonts link injected
  assert.match(css, new RegExp(design.palette.accent));  // generated CSS carries the chosen accent
  assert.equal(r.engine, 'theme-v3');
  rmSync(dir, { recursive: true, force: true });
});

test('staticQa flags missing facts and external scripts', () => {
  const ok = staticQa('<h1>Olde Soul Barbershop</h1>', { mustInclude: ['Olde Soul Barbershop'] });
  assert.equal(ok.ok, true);
  const bad = staticQa('<h1>Wrong</h1><script src="https://evil.example/x.js"></script>', { mustInclude: ['Olde Soul Barbershop'] });
  assert.equal(bad.ok, false);
  assert.ok(bad.issues.some((i) => i.type === 'missing_fact'));
  assert.ok(bad.issues.some((i) => i.type === 'external_script'));
});

test('staticQa matches HTML-escaped facts (shop name with &)', () => {
  // The renderer escapes the shop name into the page, so a raw-string check alone would falsely flag a
  // correct site (e.g. "Côte & Cendre" renders as "Côte &amp; Cendre"). staticQa must match the escaped form.
  const name = 'Côte & Cendre';
  const html = `<h1>${escapeHtml(name)}</h1>`;
  const qa = staticQa(html, { mustInclude: [name] });
  assert.equal(qa.ok, true, `escaped name must satisfy staticQa; issues: ${JSON.stringify(qa.issues)}`);
});

// --- Task 7: the orchestrator's `replied` handler now art-directs (applyArtDirection → {contract,
// design}) and builds the token-driven v3 site, instead of the old applyOpusEdit small-edit. With
// ANTHROPIC_API_KEY unset the deterministic always-ships pair runs (grounded contract + niche design),
// so the path is fully offline. The rebuild's QA crawl needs a real browser (qaCheck launches
// Playwright internally) — skip when one isn't installed, mirroring reply-loop.test.js.
test('replied handler art-directs → v3 site (theme-v3, generated CSS), QA passes, → pending_approval', async (t) => {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
    const b = await chromium.launch({ headless: true });
    await b.close();
  } catch (e) {
    t.skip(`no browser: ${String(e.message || e).split('\n')[0]}`);
    return;
  }

  // Hermetic: deterministic fill + deterministic art-director fallback (no keys), review mode, fake
  // inbox so notifyFounder writes to the dry-run outbox instead of really sending.
  config.mode = 'review';
  config.mail.testRecipient = 'demo@local.test';
  delete process.env.GEMINI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  const db = openDatabase(':memory:');
  const { id } = db.insertLead({
    name: 'Olde Soul Barbershop', niche: 'barber', city: 'Austin, TX', email: 'demo@local.test',
    details: { rating: 4.8, reviewCount: 210, primaryType: 'Barber shop', hours: ['Monday: 9 AM – 6 PM'] },
  });
  for (const s of ['built', 'deployed', 'emailed']) db.setStatus(id, s); // pretend the cold pitch went out

  const r = await handleReply(db, db.getLead(id), 'Make it bold and dark, please.');
  assert.equal(r.intent, 'edit_request');
  assert.equal(db.getLead(id).status, 'replied');

  await tick(db); // replied → applyArtDirection → writeSite({design}) → QA → (editing) → pending_approval

  // The swap's observable effects: the rebuilt site is the token-driven v3 engine (NOT the legacy
  // theme), QA passed (a fail would quarantine to needs_human), and review mode parked it at the
  // founder-approval gate.
  assert.notEqual(db.getLead(id).status, 'needs_human', 'QA did not quarantine the lead');
  assert.equal(db.getLead(id).status, 'pending_approval');
  const site = db.getSiteForLead(id);
  assert.ok(site, 'the rebuilt site row exists');
  assert.equal(site.engine, 'theme-v3', 'built via the art-director v3 path');

  // The generated stylesheet (not a copied static theme.css) carries the niche design's accent, and the
  // grounded contract snapped the REAL shop name back into the page.
  const dir = join(PUBLIC_DIR, slugFor(db.getLead(id)));
  assert.ok(existsSync(join(dir, 'theme.css')), 'generated theme.css written');
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const css = readFileSync(join(dir, 'theme.css'), 'utf8');
  assert.match(html, /Olde Soul Barbershop/);
  assert.match(html, /fonts\.googleapis\.com/);
  assert.match(css, new RegExp(designForNiche('barber').palette.accent));

  db.close();
  rmSync(dir, { recursive: true, force: true });
});

// --- Task 8: the "always ships, grounded, self-contained" invariant ---------------------------
// The whole pipeline's safety net: with NO ANTHROPIC_API_KEY (so applyArtDirection takes its
// deterministic always-ships branch), three real golden leads — a steakhouse, a barbershop, and a
// yoga studio (the spec's §Testing trio) — must each still produce a valid, GROUNDED (states the
// real shop name) and fully SELF-CONTAINED (no external <script>, no non-font external <link>) v3
// site, with a non-empty generated theme.css. This is offline and deterministic (no network, no
// browser): it guarantees the fallback alone always yields a shippable site, no matter what Opus
// (or the lack of it) does upstream.
const GOLDEN = [
  { name: 'The Gilded Ox Steakhouse', niche: 'restaurant', city: 'Austin, TX', address: '210 Congress Ave, Austin, TX 78701', phone: '512-555-0142',
    details: JSON.stringify({ rating: 4.8, reviewCount: 364, primaryType: 'Steak house', hours: ['Monday: 5 PM – 10 PM', 'Tuesday: 5 PM – 10 PM'] }) },
  { name: 'Ironside Barbershop', niche: 'barber', city: 'Portland, OR', address: '88 Hawthorne Blvd, Portland, OR 97214', phone: '503-555-0188',
    details: JSON.stringify({ rating: 4.9, reviewCount: 512, primaryType: 'Barber shop', hours: ['Tuesday: 9 AM – 7 PM', 'Wednesday: 9 AM – 7 PM'] }) },
  { name: 'Still Point Yoga Studio', niche: 'yoga', city: 'Boulder, CO', address: '47 Pearl St, Boulder, CO 80302', phone: '303-555-0173',
    details: JSON.stringify({ rating: 5.0, reviewCount: 129, primaryType: 'Yoga studio', hours: ['Monday: 6 AM – 8 PM', 'Saturday: 8 AM – 2 PM'] }) },
];

for (const lead of GOLDEN) {
  test(`always-ships invariant: ${lead.name} → grounded, self-contained v3 site (no key)`, async () => {
    delete process.env.ANTHROPIC_API_KEY; // force the deterministic always-ships branch

    // Art-direct (no key → deterministic { contract, design } pair), then build the token-driven site.
    const { contract, design } = await applyArtDirection(lead, { change: 'make it beautiful' });
    assert.equal(contract.shopName, lead.name, 'the grounded contract carries the REAL shop name');

    const built = await writeSite(lead, contract, { design });
    assert.equal(built.engine, 'theme-v3', 'built via the art-director v3 path');

    const dir = join(PUBLIC_DIR, slugFor(lead));
    const html = readFileSync(join(dir, 'index.html'), 'utf8');
    const css = readFileSync(join(dir, 'theme.css'), 'utf8');

    // GROUNDED + SELF-CONTAINED: the real shop name (and phone, when known) is present, and there is
    // no external <script>/non-font <link> — the single staticQa pass asserts all of it.
    const mustInclude = [contract.shopName, contract.contact?.phone].filter(Boolean);
    const qa = staticQa(html, { mustInclude });
    assert.ok(qa.ok, `staticQa must pass; issues: ${JSON.stringify(qa.issues)}`);

    // The generated stylesheet is real (non-empty) — proving theme.css was written from the DesignSpec,
    // not left blank or a 404'd static copy.
    assert.ok(css.trim().length > 0, 'theme.css is non-empty');

    rmSync(dir, { recursive: true, force: true });
  });
}
