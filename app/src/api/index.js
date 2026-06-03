// Portal JSON API (the SPA's data layer). Cookie-session auth (HMAC, util/sign.js). Reuses the
// account/quota/Stripe logic + the orchestrator pipeline. handleApi() is pure given (ctx); the server
// does the IO. Returns { status, headers, body } | null (null → not an /api route).
import { signToken, verifyToken } from '../util/sign.js';
import { createAccount, authenticate, quota, canRequestChange, monthKeyOf, PLANS, PLAN_LIST } from '../portal/accounts.js';
import { canTransition } from '../states.js';
import { shotsFromDir } from '../screenshot/index.js';

const SESSION_COOKIE = 'sf_session';
const json = (status, obj, headers = {}) => ({ status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers }, body: JSON.stringify(obj) });
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
export function replyText(text, useFree) {
  const s = String(text || '').replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '');
  const opener = useFree ? "Love it — and this first one's on me. " : 'On it. ';
  return `${opener}I'll take care of that${s ? ` — “${s}”` : ''} and rebuild your site now. It'll update here in a moment. Anything else you'd like changed?`;
}

function shotUrls(site, config) {
  if (!site || !site.screenshot_path || !site.slug) return [];
  const base = (config.publicBaseUrl || '').replace(/\/$/, '');
  try { return shotsFromDir(site.screenshot_path).map((s) => `${base}/${site.slug}/shots/${s.name}.png`); } catch { return []; }
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
    plan: plan ? { key: plan.key, label: plan.label, price: plan.price, quota: plan.quota === Infinity ? null : plan.quota, domainIncluded: !!plan.domainIncluded } : null,
    quota: { used: q.used, remaining: q.remaining === Infinity ? null : q.remaining, allowance: q.allowance === Infinity ? null : q.allowance, freeAvailable: q.freeAvailable },
    site: site ? { previewUrl: site.preview_url || null, screenshots: shotUrls(site, config), expiresAt: site.expires_at || null, status: site.preview_url ? 'live' : 'building' } : null,
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
    return json(200, { account: safeAccount(r.account) }, { 'set-cookie': sessionCookie(r.account.id, config) });
  }
  if (path === '/api/auth/login' && method === 'POST') {
    const acct = authenticate(db, body.email, body.password);
    if (!acct) return json(401, { error: 'wrong email or password' });
    return json(200, { account: safeAccount(acct) }, { 'set-cookie': sessionCookie(acct.id, config) });
  }
  if (path === '/api/auth/logout' && method === 'POST') return json(200, { ok: true }, { 'set-cookie': clearCookie() });
  if (path === '/api/plans' && method === 'GET') {
    return json(200, { plans: PLAN_LIST.map((p) => ({ key: p.key, label: p.label, price: p.price, quota: p.quota === Infinity ? null : p.quota, domainIncluded: !!p.domainIncluded })) });
  }

  // --- authed ---
  const account = sessionAccount(db, cookies, config);
  if (!account) return json(401, { error: 'not signed in' });

  if (path === '/api/me' && method === 'GET') return json(200, mePayload(db, account, config));

  if (path === '/api/requests' && method === 'GET') {
    const reqs = db.changeRequestsFor(account.id).map((r) => ({
      id: r.id, body: r.body, kind: r.kind, status: r.status, createdAt: r.created_at, reply: replyText(r.body, r.kind === 'free'),
    }));
    return json(200, { requests: reqs });
  }

  if (path === '/api/requests' && method === 'POST') {
    const text = String(body.body || '').trim();
    if (!text) return json(400, { error: 'tell me what to change' });
    const mk = monthKeyOf(new Date().toISOString());
    const decision = canRequestChange(db, account, mk);
    if (!decision.ok) return json(402, { error: decision.reason, needsPlan: true });
    db.addChangeRequest({ accountId: account.id, leadId: account.lead_id, body: text, kind: decision.useFree ? 'free' : 'change' });
    if (decision.useFree) db.markFreeChangeUsed(account.id);
    if (account.lead_id) {
      db.recordEvent(account.lead_id, 'edit_request', { change: text, via: 'portal' });
      const lead = db.getLead(account.lead_id);
      if (lead && canTransition(lead.status, 'replied')) db.setStatus(account.lead_id, 'replied', { via: 'portal' });
    }
    const q = quota(db, db.getAccount(account.id), mk);
    return json(200, {
      request: { body: text, status: 'queued' },
      reply: replyText(text, decision.useFree),
      quota: { remaining: q.remaining === Infinity ? null : q.remaining, freeAvailable: q.freeAvailable },
    });
  }

  if (path === '/api/billing/checkout' && method === 'POST') {
    const plan = PLANS[body.plan] ? body.plan : null;
    if (!plan) return json(400, { error: 'pick a plan' });
    try {
      const { stripeCheckout } = await import('../portal/stripe.js');
      const base = (config.portalBaseUrl || '').replace(/\/$/, '');
      const { url } = await stripeCheckout({ plan, accountId: account.id, email: account.email, successUrl: `${base}/billing?paid=1`, cancelUrl: `${base}/billing` });
      return json(200, { url });
    } catch {
      return json(200, { configured: false, message: 'Card payments switch on once Stripe is connected.' });
    }
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
    const norm = stripe.parseSubscriptionEvent(event);
    if (norm && norm.accountId) {
      const active = norm.type === 'checkout.session.completed' || norm.status === 'active';
      db.setAccountPlan(Number(norm.accountId), { plan: norm.plan, planStatus: active ? 'active' : 'canceled', stripeCustomer: norm.customerId });
    }
    return { status: 200, body: 'ok' };
  } catch (e) {
    return { status: 500, body: String(e.message || e) };
  }
}
