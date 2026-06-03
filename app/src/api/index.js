// Portal JSON API (the SPA's data layer). Cookie-session auth (HMAC, util/sign.js). Reuses the
// account/quota/Stripe logic + the orchestrator pipeline. handleApi() is pure given (ctx); the server
// does the IO. Returns { status, headers, body } | null (null → not an /api route).
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signToken, verifyToken } from '../util/sign.js';
import { createAccount, authenticate, quota, canRequestChange, monthKeyOf, PLANS, PLAN_LIST, TOPUPS, TOPUP_LIST } from '../portal/accounts.js';
import { canTransition } from '../states.js';
import { shotsFromDir } from '../screenshot/index.js';
import { googleAuthUrl, googleLogin } from '../auth/google.js';
import { verifyPaddleWebhook, parsePaddleEvent } from '../portal/paddle.js';
import { PUBLIC_DIR } from '../builder/build2.js';
import { keepPreview } from '../deployer/cloudflare.js';

const here = dirname(fileURLToPath(import.meta.url));
const UPLOADS = resolve(here, '..', '..', 'data', 'uploads'); // private (data/ is gitignored)
const IMG_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const safeLen = (j) => { try { const a = JSON.parse(j); return Array.isArray(a) ? a.length : 0; } catch { return 0; } };

// Save the owner's attached photos (data URLs) to disk; return saved paths. Capped + validated, so
// a request "actually gets sent to us" — the founder/rebuild step reads these off the change request.
function saveImages(accountId, images) {
  if (!Array.isArray(images) || !images.length) return [];
  const dir = join(UPLOADS, String(accountId));
  mkdirSync(dir, { recursive: true });
  const saved = [];
  const stamp = Date.now();
  images.slice(0, 6).forEach((img, i) => {
    const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(String((img && img.dataUrl) || ''));
    if (!m) return;
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > 6_000_000) return; // 6MB/image cap
    const path = join(dir, `${stamp}-${i}.${IMG_EXT[m[1]] || 'jpg'}`);
    try { writeFileSync(path, buf); saved.push(path); } catch { /* skip a bad one */ }
  });
  return saved;
}

const SESSION_COOKIE = 'sf_session';
const json = (status, obj, headers = {}) => ({ status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers }, body: JSON.stringify(obj) });
const redirect302 = (to, headers = {}) => ({ status: 302, headers: { location: to, ...headers }, body: '' });
const sessionCookie = (accountId, config) => `${SESSION_COOKIE}=${signToken({ accountId }, config.signSecret)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
const clearCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`;

function sessionAccount(db, cookies, config) {
  const tok = (cookies || {})[SESSION_COOKIE];
  if (!tok) return null;
  const p = verifyToken(tok, config.signSecret);
  return p && p.accountId ? db.getAccount(p.accountId) : null;
}

const safeAccount = (a) => ({ id: a.id, email: a.email, plan: a.plan, planStatus: a.plan_status, freeChangeUsed: !!a.free_change_used });

// A natural, human-feeling acknowledgement of a change request (LLM-backed later; templated now).
export function replyText(text, useFree, photos = 0) {
  const s = String(text || '').replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '');
  const opener = useFree ? "Love it — and this first one's on me. " : 'On it. ';
  const what = s ? `I'll take care of that — “${s}”` : "I'll get your photos added in";
  const pics = photos ? ` I've got your ${photos} photo${photos === 1 ? '' : 's'} too.` : '';
  return `${opener}${what} and rebuild your site now.${pics} It'll update here in a moment. Anything else you'd like changed?`;
}

function shotUrls(site, config) {
  if (!site || !site.screenshot_path || !site.slug) return [];
  const base = (config.publicBaseUrl || '').replace(/\/$/, '');
  try { return shotsFromDir(site.screenshot_path).map((s) => `${base}/${site.slug}/shots/${s.name}.png`); } catch { return []; }
}

// Re-publish a lead's site to Cloudflare KV WITHOUT a TTL → permanent (cloudflare hosting only; a no-op
// locally + in tests). keepPreview re-inlines the site from disk, so calling this AFTER a tier rebuild
// publishes the richer site permanently. Never throws — permanence is best-effort.
async function makePreviewPermanentKv(db, leadId, config) {
  const cf = config.cloudflare || {};
  if (!leadId || (config.hosting && config.hosting.engine) !== 'cloudflare' || !cf.kvNamespace) return;
  try {
    const site = db.getSiteForLead(leadId);
    if (site && site.slug) await keepPreview(join(PUBLIC_DIR, site.slug), site.slug, { accountId: cf.accountId, apiToken: cf.apiToken, namespaceId: cf.kvNamespace });
  } catch { /* the plan is granted regardless — KV can be re-kept later */ }
}

// The shop's already-downloaded Google photos (relative urls) for a tier rebuild — read off disk so a
// regenerate never re-bills the Places API. Returns [] on none.
function existingImages(slug) {
  try {
    return readdirSync(join(PUBLIC_DIR, slug, 'img')).filter((f) => /^photo-\d+\.jpg$/.test(f)).sort().map((f) => `img/${f}`);
  } catch { return []; }
}

// Regenerate the bespoke site at a richer tier (Pro/Premium) from the cached { contract, design } and
// re-publish it permanently. The cached spec carries the tailored copy + palette; the tier layer adds
// the motion / WebGL / forms / catalogue (builder/build2.js honours the `tier` option). No Opus call.
// Never throws (the existing site still stands on any failure).
async function regenerateAtTier(db, leadId, tier, config) {
  try {
    const site = db.getSiteForLead(leadId);
    if (!site || !site.spec) return;
    let spec; try { spec = JSON.parse(site.spec); } catch { return; }
    if (!spec || !spec.contract) return;
    const lead = db.getLead(leadId);
    const { writeSite } = await import('../builder/build2.js');
    const built = await writeSite(lead, spec.contract, { design: spec.design, tier, images: existingImages(site.slug) });
    // New (permanent — expires_at defaults NULL) site row carrying the spec + the live preview URL.
    db.addSite(leadId, { slug: built.slug, engine: built.engine, htmlPath: built.htmlPath, spec: site.spec, previewUrl: site.preview_url });
    await makePreviewPermanentKv(db, leadId, config);
  } catch { /* the prior site remains live */ }
}

// Best-effort: walk the lead lifecycle toward 'live' to reflect the conversion (only valid edges).
function advanceLeadToPaid(db, leadId) {
  for (const s of ['reached_pricing', 'paid', 'live']) {
    const lead = db.getLead(leadId);
    if (!lead || lead.status === s) continue;
    if (!canTransition(lead.status, s)) break;
    try { db.setStatus(leadId, s, { via: 'payment' }); } catch { break; }
  }
}

// Apply a paid plan: activate it, and (when active) convert the 48h TRIAL preview into a PERMANENT site
// (drop the DB expiry + the KV TTL) and advance the lead toward 'live'. Pro/Premium also regenerate the
// site at the richer tier. Shared by the Stripe + Paddle webhooks AND the stub provider, so flipping to
// live Paddle changes nothing about how access is granted. Never throws.
async function applyPaidPlan(db, accountId, { plan, status = 'active', customerId = null }, config) {
  const active = status === 'active';
  db.setAccountPlan(accountId, { plan, planStatus: active ? 'active' : 'canceled', stripeCustomer: customerId });
  if (!active) return;
  try {
    const account = db.getAccount(accountId);
    const leadId = account && account.lead_id;
    if (!leadId) return;
    db.setSitePermanent(leadId);                                    // DB: drop the trial expiry
    if (plan === 'pro' || plan === 'premium') await regenerateAtTier(db, leadId, plan, config); // richer rebuild + permanent re-publish
    else await makePreviewPermanentKv(db, leadId, config);          // starter: keep the current calm site permanent
    advanceLeadToPaid(db, leadId);
  } catch (e) {
    db.recordEvent(null, 'apply_paid_error', { accountId, message: String(e.message || e) });
  }
}

// --- custom domain (Premium) helpers ---
function normalizeDomain(raw) {
  let d = String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/^www\./, '');
  if (d.length > 253 || !/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(d)) return null;
  return d;
}
function domainTarget(config) {
  try { return new URL(config.portalBaseUrl || 'https://storefronty.fly.dev').host; } catch { return 'storefronty.fly.dev'; }
}
const domainCname = (config) => ({ type: 'CNAME', name: 'www (and a CNAME flattening / ALIAS at the root)', value: domainTarget(config) });
// Best-effort DNS check: does the domain CNAME to our host? (No registrar needed; the last-mile DNS is
// the customer's. Returns false on any error → status stays 'pending'.)
async function verifyDomain(domain, config) {
  try {
    const target = domainTarget(config).toLowerCase();
    const dns = await import('node:dns/promises');
    for (const host of [domain, `www.${domain}`]) {
      const cnames = await dns.resolveCname(host).catch(() => []);
      if (cnames.some((c) => String(c).toLowerCase().includes(target))) return true;
    }
    return false;
  } catch { return false; }
}

// Payment config the SPA needs (provider + whether it's configured). Only PUBLIC values — the Paddle
// client-side token + price IDs are safe in the browser; the API key/webhook secret are never exposed.
function payConfig(config) {
  const provider = (config.payments && config.payments.provider) || 'none';
  if (provider === 'paddle') {
    const p = config.paddle || {};
    return { provider, ready: !!(p.clientToken && p.prices && p.prices.starter), env: p.env || 'sandbox', clientToken: p.clientToken || '', prices: p.prices || {} };
  }
  if (provider === 'stripe') return { provider, ready: !!(config.stripe && config.stripe.secretKey) };
  // Stub: checkout completes server-side with no real money (PAYMENTS_STUB=1). The keys mirror the plan
  // keys so the SPA can show the same buttons; the server grants access via applyPaidPlan.
  if (provider === 'stub') return { provider: 'stub', ready: true, prices: { starter: 'starter', pro: 'pro', premium: 'premium', pack5: 'pack5', pack15: 'pack15' } };
  return { provider: 'none', ready: false };
}

function mePayload(db, account, config) {
  const lead = account.lead_id ? db.getLead(account.lead_id) : null;
  const site = account.lead_id ? db.getSiteForLead(account.lead_id) : null;
  const mk = monthKeyOf(new Date().toISOString());
  const q = quota(db, account, mk);
  const plan = PLANS[account.plan] || null;
  return {
    account: safeAccount(account),
    shop: lead ? lead.name : null,
    plan: plan ? { key: plan.key, label: plan.label, price: plan.price, quota: plan.quota === Infinity ? null : plan.quota, domainIncluded: !!plan.domainIncluded, exampleUrl: plan.exampleUrl || null } : null,
    quota: { used: q.used, remaining: q.remaining === Infinity ? null : q.remaining, allowance: q.allowance === Infinity ? null : q.allowance, extra: q.extra, freeAvailable: q.freeAvailable },
    site: site ? { previewUrl: site.preview_url || null, screenshots: shotUrls(site, config), expiresAt: site.expires_at || null, status: site.preview_url ? 'live' : 'building' } : null,
    domain: account.custom_domain ? { name: account.custom_domain, status: account.domain_status || 'pending', cname: domainCname(config) } : null,
    pay: payConfig(config),
  };
}

export const isApiRoute = (path) => String(path || '').startsWith('/api/');

export async function handleApi({ method, path, body = {}, cookies = {}, db, config }) {
  if (!isApiRoute(path)) return null;

  // --- public ---
  if (path === '/api/auth/claim' && method === 'POST') {
    const p = verifyToken(body.token || '', config.signSecret);
    if (!p || p.kind !== 'claim' || !p.leadId) return json(400, { error: 'this link is invalid or has expired' });
    const lead = db.getLead(p.leadId);
    return json(200, { valid: true, shop: { name: lead ? lead.name : null } });
  }
  if (path === '/api/auth/signup' && method === 'POST') {
    const claim = verifyToken(body.token || '', config.signSecret);
    const leadId = claim && claim.kind === 'claim' ? claim.leadId : null;
    const r = createAccount(db, { email: body.email, password: body.password, leadId });
    if (!r.ok) return json(400, { error: r.error });
    // Claim = TRIAL: the account binds to the site, but the 48h preview stays a trial. Only PAYING for a
    // plan makes it permanent (see applyPaidPlan). We intentionally do NOT drop the TTL here.
    return json(200, { account: safeAccount(r.account) }, { 'set-cookie': sessionCookie(r.account.id, config) });
  }
  if (path === '/api/auth/login' && method === 'POST') {
    const acct = authenticate(db, body.email, body.password);
    if (!acct) return json(401, { error: 'wrong email or password' });
    return json(200, { account: safeAccount(acct) }, { 'set-cookie': sessionCookie(acct.id, config) });
  }
  if (path === '/api/auth/logout' && method === 'POST') return json(200, { ok: true }, { 'set-cookie': clearCookie() });
  if (path === '/api/plans' && method === 'GET') {
    return json(200, { plans: PLAN_LIST.map((p) => ({ key: p.key, label: p.label, price: p.price, quota: p.quota === Infinity ? null : p.quota, domainIncluded: !!p.domainIncluded, exampleUrl: p.exampleUrl || null })) });
  }
  if (path === '/api/topups' && method === 'GET') {
    return json(200, { topups: TOPUP_LIST.map((t) => ({ key: t.key, label: t.label, changes: t.changes, price: t.price })) });
  }
  if (path === '/api/auth/config' && method === 'GET') {
    return json(200, { google: !!(config.google && config.google.clientId) });
  }

  // Public lead / reservation / order capture from a generated Pro/Premium site. The preview is served
  // cross-origin (Cloudflare KV), so this route is CORS-open. Resolves the shop by slug and notifies the
  // owner (routed to testRecipient in dev/E2E). Never throws — a visitor must never see a crash.
  if (path === '/api/lead') {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
    if (method === 'OPTIONS') return { status: 204, headers: cors, body: '' };
    if (method !== 'POST') return json(405, { error: 'method not allowed' }, cors);
    try {
      const site = body.site ? db.getSiteBySlug(String(body.site)) : null;
      const lead = site && site.lead_id ? db.getLead(site.lead_id) : null;
      const name = String(body.name || '').slice(0, 120);
      const email = String(body.email || '').slice(0, 160);
      const message = String(body.message || body.note || body.details || '').slice(0, 2000);
      const kind = body.kind === 'order' || body.kind === 'reservation' ? body.kind : 'lead';
      if (!name && !email && !message) return json(400, { error: 'tell us how to reach you' }, cors);
      if (lead) db.recordEvent(lead.id, 'site_lead', { kind, name, email, message });
      try {
        const { sendEmail } = await import('../mailer/index.js');
        const to = (lead && lead.email) || config.mail.testRecipient || config.mail.founderEmail;
        if (to) await sendEmail({ to, subject: `New ${kind} from your website${lead ? ` — ${lead.name}` : ''}`, text: `Name: ${name}\nEmail: ${email}\nKind: ${kind}\n\n${message}` }, config);
      } catch { /* delivery best-effort */ }
      return json(200, { ok: true }, cors);
    } catch { return json(200, { ok: true }, cors); }
  }

  // --- authed ---
  const account = sessionAccount(db, cookies, config);
  if (!account) return json(401, { error: 'not signed in' });

  if (path === '/api/me' && method === 'GET') return json(200, mePayload(db, account, config));

  if (path === '/api/requests' && method === 'GET') {
    const reqs = db.changeRequestsFor(account.id).map((r) => {
      const imgs = r.images ? safeLen(r.images) : 0;
      return { id: r.id, body: r.body, kind: r.kind, status: r.status, createdAt: r.created_at, images: imgs, reply: replyText(r.body, r.kind === 'free', imgs) };
    });
    return json(200, { requests: reqs });
  }

  if (path === '/api/requests' && method === 'POST') {
    const text = String(body.body || '').trim();
    const incoming = Array.isArray(body.images) ? body.images : [];
    if (!text && !incoming.length) return json(400, { error: 'tell me what to change, or attach a photo' });
    const mk = monthKeyOf(new Date().toISOString());
    const decision = canRequestChange(db, account, mk);
    if (!decision.ok) return json(402, { error: decision.reason, needsPlan: !!decision.needsPlan, needsTopup: !!decision.needsTopup });
    const saved = saveImages(account.id, incoming);
    const kind = decision.useFree ? 'free' : decision.useExtra ? 'extra' : 'change';
    db.addChangeRequest({ accountId: account.id, leadId: account.lead_id, body: text, kind, images: saved.length ? saved : null });
    if (decision.useFree) db.markFreeChangeUsed(account.id);
    else if (decision.useExtra) db.consumeExtraChange(account.id);
    if (account.lead_id) {
      db.recordEvent(account.lead_id, 'edit_request', { change: text, photos: saved.length, via: 'portal' });
      const lead = db.getLead(account.lead_id);
      if (lead && canTransition(lead.status, 'replied')) db.setStatus(account.lead_id, 'replied', { via: 'portal' });
    }
    const q = quota(db, db.getAccount(account.id), mk);
    return json(200, {
      request: { body: text, status: 'queued', images: saved.length },
      reply: replyText(text, decision.useFree, saved.length),
      quota: { remaining: q.remaining === Infinity ? null : q.remaining, extra: q.extra, freeAvailable: q.freeAvailable },
    });
  }

  if (path === '/api/billing/checkout' && method === 'POST') {
    const plan = PLANS[body.plan] ? body.plan : null;
    if (!plan) return json(400, { error: 'pick a plan' });
    // Stub provider: grant the plan + make the site permanent immediately, no real money. The SPA then
    // refreshes (sf:paid). Real Stripe/Paddle keep their existing redirect/overlay flow below.
    if ((config.payments && config.payments.provider) === 'stub') {
      await applyPaidPlan(db, account.id, { plan, status: 'active' }, config);
      return json(200, { ok: true, stub: true });
    }
    try {
      const { stripeCheckout } = await import('../portal/stripe.js');
      const base = (config.portalBaseUrl || '').replace(/\/$/, '');
      const { url } = await stripeCheckout({ plan, accountId: account.id, email: account.email, successUrl: `${base}/billing?paid=1`, cancelUrl: `${base}/billing` });
      return json(200, { url });
    } catch {
      return json(200, { configured: false, message: 'Card payments switch on once Stripe is connected.' });
    }
  }

  if (path === '/api/billing/topup' && method === 'POST') {
    const pack = TOPUPS[body.pack];
    if (!pack) return json(400, { error: 'pick a pack' });
    if ((config.payments && config.payments.provider) === 'stub') {
      db.addExtraChanges(account.id, pack.changes);
      return json(200, { ok: true, stub: true });
    }
    try {
      const { stripeTopup } = await import('../portal/stripe.js');
      const base = (config.portalBaseUrl || '').replace(/\/$/, '');
      const { url } = await stripeTopup({ accountId: account.id, email: account.email, label: pack.label, amountCents: pack.price * 100, changes: pack.changes, successUrl: `${base}/billing?topped=1`, cancelUrl: `${base}/billing` });
      return json(200, { url });
    } catch {
      return json(200, { configured: false, message: 'Card payments switch on once Stripe is connected.' });
    }
  }

  // Custom domain (Premium). Save a hostname (status → pending) and verify its CNAME points at us.
  if (path === '/api/domain' && method === 'POST') {
    if (account.plan !== 'premium' || account.plan_status !== 'active') return json(402, { error: 'Custom domains are part of the Premium plan.', needsPlan: true });
    const domain = normalizeDomain(body.domain);
    if (!domain) return json(400, { error: 'Enter a valid domain like example.com' });
    db.setCustomDomain(account.id, domain);
    return json(200, { domain, status: 'pending', cname: domainCname(config) });
  }
  if (path === '/api/domain/verify' && method === 'GET') {
    const acct = db.getAccount(account.id);
    if (!acct.custom_domain) return json(400, { error: 'no domain set yet' });
    const ok = await verifyDomain(acct.custom_domain, config);
    db.setDomainStatus(account.id, ok ? 'verified' : 'pending');
    return json(200, { domain: acct.custom_domain, status: ok ? 'verified' : 'pending', cname: domainCname(config) });
  }

  return json(404, { error: 'not found' });
}

// Stripe webhook (signature-verified; no session). The server passes the RAW body.
export async function handleStripeWebhook({ rawBody, signature, db, config }) {
  try {
    const { makeStripe } = await import('../portal/stripe.js');
    const stripe = makeStripe({ secretKey: config.stripe?.secretKey || '' });
    const event = stripe.verifyWebhook(rawBody, signature, config.stripe?.webhookSecret || '');
    if (!event) return { status: 400, body: 'bad signature' };
    // one-time change-pack purchase → grant credits (must run BEFORE the subscription path, which
    // would otherwise set plan=null active on a payment-mode session).
    const obj = event.data && event.data.object;
    if (event.type === 'checkout.session.completed' && obj && obj.mode === 'payment' && obj.metadata && obj.metadata.changes) {
      const acctId = Number(obj.metadata.accountId || obj.client_reference_id);
      const n = Number(obj.metadata.changes) || 0;
      if (acctId && n) db.addExtraChanges(acctId, n);
      return { status: 200, body: 'ok' };
    }
    const norm = stripe.parseSubscriptionEvent(event);
    if (norm && norm.accountId) {
      const active = norm.type === 'checkout.session.completed' || norm.status === 'active';
      await applyPaidPlan(db, Number(norm.accountId), { plan: norm.plan, status: active ? 'active' : 'canceled', customerId: norm.customerId }, config);
    }
    return { status: 200, body: 'ok' };
  } catch (e) {
    return { status: 500, body: String(e.message || e) };
  }
}

// Paddle webhook → activate a plan / grant top-up credits (signature-verified; no session).
export async function handlePaddleWebhook({ rawBody, signature, db, config }) {
  try {
    const event = verifyPaddleWebhook(rawBody, signature, config.paddle?.webhookSecret || '');
    if (!event) return { status: 400, body: 'bad signature' };
    const norm = parsePaddleEvent(event);
    if (norm && norm.accountId) {
      const id = Number(norm.accountId);
      if (norm.type === 'topup') db.addExtraChanges(id, norm.changes);
      else if (norm.type === 'subscription') {
        const active = norm.status === 'active' || norm.status === 'trialing';
        await applyPaidPlan(db, id, { plan: norm.plan, status: active ? 'active' : 'canceled', customerId: norm.customerId }, config);
      }
    }
    return { status: 200, body: 'ok' };
  } catch (e) {
    return { status: 500, body: String(e.message || e) };
  }
}

// Google login (server-side Authorization Code). Start → redirect to Google's consent screen.
export async function handleGoogleStart(query, config) {
  if (!config.google || !config.google.clientId) return redirect302('/login?err=google_off');
  const state = signToken({ n: Date.now(), claim: (query && query.claim) || '', kind: 'gstate' }, config.signSecret);
  const redirectUri = `${(config.portalBaseUrl || '').replace(/\/$/, '')}/auth/google/callback`;
  return redirect302(googleAuthUrl({ clientId: config.google.clientId, redirectUri, state }));
}

// Callback → exchange the code, find/create the account by email, set the session, land on the dashboard.
export async function handleGoogleCallback({ query, db, config }) {
  const q = query || {};
  const payload = verifyToken(q.state || '', config.signSecret);
  if (!payload || payload.kind !== 'gstate' || !q.code) return redirect302('/login?err=google');
  const redirectUri = `${(config.portalBaseUrl || '').replace(/\/$/, '')}/auth/google/callback`;
  let profile;
  try {
    profile = await googleLogin({ code: q.code, redirectUri, clientId: config.google.clientId, clientSecret: config.google.clientSecret });
  } catch { return redirect302('/login?err=google'); }
  if (!profile || !profile.email) return redirect302('/login?err=google');
  let account = db.getAccountByEmail(profile.email);
  if (!account) {
    const claim = verifyToken(payload.claim || '', config.signSecret);
    const leadId = claim && claim.kind === 'claim' ? claim.leadId : null;
    account = db.getAccount(db.addAccount({ leadId, email: profile.email, passwordHash: null, authProvider: 'google' }));
  }
  // Claim via Google = TRIAL too (mirrors /api/auth/signup): no TTL drop here; paying makes it permanent.
  return redirect302('/dashboard', { 'set-cookie': sessionCookie(account.id, config) });
}
