// Production E2E — drives the WHOLE customer flow against REAL infra (Cloudflare KV, Opus 4.8, Gmail)
// on a fresh in-memory DB. SAFE BY CONSTRUCTION: a synthetic mock lead (no real business is contacted),
// the central sendEmail guard routes every email to TEST_RECIPIENT (the founder), and payments use the
// stub provider (no real money). Run:  node --experimental-sqlite e2e-prod.mjs   (from app/)
process.env.HOSTING_ENGINE = 'cloudflare'; // publish previews to the REAL Cloudflare KV (non-localhost)
process.env.PAYMENTS_STUB = '1';           // stub checkout — no real charge
process.env.MODE = 'review';               // founder-approval gate (approved programmatically here)

// Dynamic imports AFTER the env is set above — static `import` is hoisted and would load config.js
// (capturing HOSTING_ENGINE/PAYMENTS_STUB) before these assignments run.
const { readFileSync } = await import('node:fs');
const { config } = await import('./src/config.js');
const { openDatabase } = await import('./src/db.js');
const { tick, handleReply } = await import('./src/orchestrator.js');
const { handleApi } = await import('./src/api/index.js');
const { signToken } = await import('./src/util/sign.js');

const results = [];
const ok = (name, cond, detail = '') => { results.push({ name, pass: !!cond, detail }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); return !!cond; };
const step = async (name, fn) => { try { return await fn(); } catch (e) { ok(name, false, String((e && e.message) || e).split('\n')[0]); return null; } };

const db = openDatabase(':memory:');
let previewUrl = '(none)';

await step('run', async () => {
  // 1) Seed a realistic synthetic lead (no real business; mail routes to the founder regardless).
  const { id } = db.insertLead({
    name: 'Thornwood Coffee House', niche: 'cafe', city: 'Austin, TX',
    address: '210 Cypress Ave, Austin, TX 78701', phone: '512-555-0137', email: 'owner@thornwood.example',
    details: { rating: 4.8, reviewCount: 274, primaryType: 'Coffee shop', hours: ['Monday: 7 AM – 6 PM', 'Saturday: 8 AM – 4 PM'] },
  });
  ok('seed synthetic lead', !!id, `lead #${id}`);

  // 2) Cold-pitch pipeline: discovered -> built -> deployed (screenshots) -> emailed (Email 1, real send).
  for (let i = 0; i < 4; i++) await tick(db);
  ok('reached emailed (Email 1 sent to founder)', db.getLead(id).status === 'emailed', `status=${db.getLead(id).status}`);

  // 3) Owner replies -> wow-build (REAL Opus 4.8) -> founder-approval gate.
  await handleReply(db, db.getLead(id), 'Love it — make it warm and cozy, and add a line about our single-origin espresso.');
  ok('reply classified -> replied', db.getLead(id).status === 'replied');
  await tick(db); // replied: applyArtDirection (REAL Opus ~60-90s) -> writeSite(v3) -> QA -> pending_approval
  ok('wow-build -> pending_approval', db.getLead(id).status === 'pending_approval', `status=${db.getLead(id).status}`);
  const s1 = db.getSiteForLead(id);
  ok('site is theme-v3 with cached spec', !!(s1 && s1.engine === 'theme-v3' && s1.spec));

  // 4) Founder approves -> deploy to REAL Cloudflare KV (48h TTL) + Email 2 (real send).
  db.setStatus(id, 'approved', { via: 'e2e' });
  await tick(db);
  ok('approved -> link_sent (Email 2 sent)', db.getLead(id).status === 'link_sent', `status=${db.getLead(id).status}`);
  const live = db.getSiteForLead(id);
  previewUrl = live.preview_url || '(none)';
  ok('preview published to Cloudflare KV', /workers\.dev/.test(previewUrl), previewUrl);
  ok('trial expiry set (48h)', !!live.expires_at, `expires=${live.expires_at}`);

  // 5) The REAL KV URL serves the real site over HTTPS.
  const r = await fetch(previewUrl); const kv = await r.text();
  ok('KV preview serves HTTP 200', r.ok, `status=${r.status}`);
  ok('KV site shows the real shop name', kv.includes('Thornwood Coffee House'));

  // 6) CLAIM = TRIAL: account binds to the lead via the signed claim token; site stays a 48h trial.
  const token = signToken({ leadId: id, kind: 'claim' }, config.signSecret);
  const su = await handleApi({ method: 'POST', path: '/api/auth/signup', body: { email: 'founder+e2e@storefronty.test', password: 'longenough1', token }, cookies: {}, db, config });
  ok('signup via claim -> 200 + session', su.status === 200);
  const m = String(su.headers['set-cookie'] || '').match(/sf_session=([^;]+)/);
  const cookie = m ? { sf_session: decodeURIComponent(m[1]) } : {};
  const me1 = JSON.parse((await handleApi({ method: 'GET', path: '/api/me', cookies: cookie, db, config })).body);
  ok('claim keeps it a TRIAL (site still has expiry)', !!(me1.site && me1.site.expiresAt), `expiresAt=${me1.site && me1.site.expiresAt}`);
  ok('no active plan right after claim', !(me1.account && me1.account.planStatus === 'active'));
  ok('free change granted', !!(me1.quota && me1.quota.freeAvailable === true));

  // 7) Pick PREMIUM (stub pay) -> permanent + regenerate at the premium tier.
  const pay = await handleApi({ method: 'POST', path: '/api/billing/checkout', body: { plan: 'premium' }, cookies: cookie, db, config });
  ok('stub checkout ok', JSON.parse(pay.body).ok === true);
  const me2 = JSON.parse((await handleApi({ method: 'GET', path: '/api/me', cookies: cookie, db, config })).body);
  ok('plan active = premium after pay', !!(me2.account && me2.account.planStatus === 'active' && me2.plan && me2.plan.key === 'premium'));
  ok('site is now PERMANENT (no expiry)', !!(me2.site && !me2.site.expiresAt), `expiresAt=${me2.site && me2.site.expiresAt}`);
  const s2 = db.getSiteForLead(id);
  const local = (() => { try { return readFileSync(s2.html_path, 'utf8'); } catch { return ''; } })();
  ok('site regenerated at PREMIUM tier (WebGL hero present)', /hero-gl/.test(local), `engine=${s2.engine}`);

  // 8) Premium custom domain: store + verify (verify is pending — no real DNS, expected).
  const dom = JSON.parse((await handleApi({ method: 'POST', path: '/api/domain', body: { domain: 'thornwoodcoffee.com' }, cookies: cookie, db, config })).body);
  ok('custom domain accepted (premium-gated)', !!(dom.status === 'pending' && dom.cname && dom.cname.value), dom.cname && dom.cname.value);
  const ver = JSON.parse((await handleApi({ method: 'GET', path: '/api/domain/verify', cookies: cookie, db, config })).body);
  ok('domain verify returns a status', ['pending', 'verified'].includes(ver.status), `status=${ver.status}`);

  // 9) Public lead capture from the generated site (CORS endpoint).
  const cap = await handleApi({ method: 'POST', path: '/api/lead', body: { site: s2.slug, name: 'A Visitor', email: 'visitor@example.com', message: 'Table for 2 Friday?', kind: 'reservation' }, cookies: {}, db, config });
  ok('lead/reservation capture ok', JSON.parse(cap.body).ok === true);

  // 10) Conversion lifecycle: paying advanced the lead toward live.
  ok('lead advanced to paid/live', ['paid', 'live'].includes(db.getLead(id).status), `status=${db.getLead(id).status}`);
});

const passed = results.filter((r) => r.pass).length;
const total = results.length;
console.log(`\n=== E2E SUMMARY === ${passed}/${total} passed`);
for (const r of results.filter((x) => !x.pass)) console.log(`  FAIL: ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
console.log(`KV preview URL: ${previewUrl}`);
console.log(`=== ${passed === total ? 'ALL PASS' : 'HAS FAILURES'} ===`);
db.close();
process.exit(passed === total ? 0 : 1);
