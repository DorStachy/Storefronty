// Full-stack E2E: spawns the Node server + drives a real browser through the whole portal flow.
// Run: npm run e2e   (exits 0 and skips if Playwright/a browser isn't available).
// It's a standalone script (not a node:test) so it can process.exit cleanly after closing the
// browser + server — node:test won't release those handles on Windows and would hang on exit.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { openDatabase } from './src/db.js';
import { createAccount } from './src/portal/accounts.js';

const here = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(here, 'src', 'server.js');
const PORT = 4198;
const BASE = `http://localhost:${PORT}`;
const log = (...a) => console.log('  •', ...a);

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.log('SKIP e2e — playwright not installed'); process.exit(0); }

const dir = mkdtempSync(join(tmpdir(), 'sf-e2e-'));
const dbPath = join(dir, 'e2e.db');
const db = openDatabase(dbPath);
const { id: leadId } = db.insertLead({ name: 'E2E Barbers', niche: 'barbershop', city: 'Austin, TX' });
for (const s of ['built', 'deployed', 'emailed']) db.setStatus(leadId, s);
const sid = db.addSite(leadId, { slug: 'e2e-barbers', engine: 'theme', htmlPath: 'x' });
db.setSiteLive(sid, { previewUrl: `${BASE}/e2e-barbers/`, expiresAt: '2026-12-31T00:00:00Z' });
assert.ok(createAccount(db, { email: 'e2e@test.com', password: 'longenough1', leadId }).ok);
db.close();

const srv = spawn(process.execPath, ['--experimental-sqlite', SERVER], {
  env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, GMAIL_USER: '', GMAIL_APP_PASSWORD: '', SIGN_SECRET: 'e2e-secret' },
  stdio: 'ignore',
});

let code = 0;
try {
  let up = false;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/login`)).ok) { up = true; break; } } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 150)); }
  assert.ok(up, 'server did not start'); log('server up');

  const b = await chromium.launch({ headless: true });
  const page = await (await b.newContext()).newPage();

  await page.goto(`${BASE}/login`, { waitUntil: 'load' });
  await page.fill('input[type=email]', 'e2e@test.com');
  await page.fill('input[type=password]', 'longenough1');
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard', { timeout: 8000 });
  await page.waitForSelector('text=E2E Barbers', { timeout: 5000 });
  log('login → dashboard (site-bound)');

  await page.goto(`${BASE}/requests`, { waitUntil: 'load' });
  await page.waitForSelector('.composer textarea');
  await page.fill('.composer textarea', 'Please make the header navy');
  await page.click('.composer .send');
  await page.waitForSelector('.msg.ai .bubble', { timeout: 6000 });
  // the reply types in with a typewriter reveal — wait for it to finish before asserting
  await page.waitForFunction(() => {
    const b = document.querySelector('.msg.ai .bubble');
    return b && b.textContent.includes('rebuild your site');
  }, { timeout: 6000 });
  assert.match(await page.textContent('.msg.ai .bubble'), /rebuild your site/);
  log('AI request → assistant reply');

  await page.goto(`${BASE}/billing`, { waitUntil: 'load' });
  await page.waitForSelector('.plan', { timeout: 5000 });
  assert.equal(await page.$$eval('.plan', (e) => e.length), 3);
  log('billing → 3 plans');

  await page.goto(`${BASE}/requests`, { waitUntil: 'load' });
  await page.waitForSelector('.msg.user .bubble', { timeout: 5000 });
  assert.match(await page.textContent('.msg.user .bubble'), /header navy/);
  log('change persisted (shows in history on reload)');

  await b.close();
  console.log('\n  ✅ E2E PASSED — login → dashboard → AI request → billing → persistence\n');
} catch (e) {
  code = 1;
  console.error('\n  ❌ E2E FAILED:', e.message, '\n');
} finally {
  try { srv.kill(); } catch { /* already gone */ }
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }); } catch { /* temp; OS reaps it */ }
  process.exit(code);
}
