// The customer portal (design spec §7) — the conversion app the reply email hands off to.
// Flow: signed claim link → create account (pre-bound to his site) → dashboard → one free change →
// pick a plan → pay (Stripe) → manage site + submit changes (quota by tier).
//
// Server-rendered, sessions via a signed cookie (HMAC, util/sign.js). handlePortal() is pure given
// (ctx) — the server does the IO (read body, parse cookies, apply headers). Returns null when the
// path is not a portal route, so the caller falls through to static serving.
import { verifyToken, signToken } from '../util/sign.js';
import { escapeHtml as esc, safeUrl } from '../util/html.js';
import { createAccount, authenticate, quota, canRequestChange, monthKeyOf, PLAN_LIST, PLANS } from './accounts.js';
import { canTransition } from '../states.js';

const SESSION_COOKIE = 'sf_session';
const PORTAL_ROUTES = ['/claim/', '/signup', '/login', '/logout', '/dashboard', '/request-change', '/choose-plan', '/checkout', '/stripe/webhook'];
export const isPortalRoute = (path) => PORTAL_ROUTES.some((r) => (r.endsWith('/') ? path.startsWith(r) : path === r));

// --- response + session helpers -------------------------------------------------------------
const html = (status, body, headers = {}) => ({ status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers }, body: layout(body) });
const redirect = (to, headers = {}) => ({ status: 303, headers: { location: to, ...headers }, body: '' });
const sessionCookie = (accountId, config) => `${SESSION_COOKIE}=${signToken({ accountId }, config.signSecret)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
const clearCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`;

function sessionAccount(db, cookies, config) {
  const tok = cookies[SESSION_COOKIE];
  if (!tok) return null;
  const p = verifyToken(tok, config.signSecret);
  return p && p.accountId ? db.getAccount(p.accountId) : null;
}

const layout = (inner) =>
  `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Storefronty</title><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:46px auto;padding:0 22px;color:#1c1a17;line-height:1.6;background:#FAF6EF"><div style="font-family:Georgia,serif;font-weight:600;font-size:20px;color:#8C3F22;margin-bottom:4px">Storefronty</div><hr style="border:none;border-top:1px solid #DACBB6;margin:10px 0 26px">${inner}</body>`;
const btn = (label, color = '#2B2018') => `<button type="submit" style="background:${color};color:#FAF6EF;border:0;padding:11px 20px;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer">${esc(label)}</button>`;
const field = (name, type, ph) => `<input name="${name}" type="${type}" placeholder="${esc(ph)}" required style="display:block;width:100%;box-sizing:border-box;padding:11px 13px;margin:0 0 12px;border:1px solid #DACBB6;border-radius:8px;font-size:15px">`;
const note = (m) => (m ? `<p style="background:#F4ECE0;border:1px solid #DACBB6;border-radius:8px;padding:10px 13px;color:#5b4d42">${esc(m)}</p>` : '');

function signupPage(claimToken, lead, msg) {
  const who = lead ? ` for <b>${esc(lead.name)}</b>` : '';
  return html(200, `<h2 style="font-family:Georgia,serif">Create your account${who}</h2>
<p>This saves the site to you and unlocks <b>one more change, free</b>.</p>${note(msg)}
<form method="POST" action="/signup">
  <input type="hidden" name="claim" value="${esc(claimToken || '')}">
  ${field('email', 'email', 'you@email.com')}${field('password', 'password', 'a password (8+ characters)')}
  ${btn('Create account')}
</form>
<p style="color:#8a8278;font-size:14px;margin-top:14px">Already have an account? <a href="/login" style="color:#8C3F22">Log in</a></p>`);
}

function dashboardPage(db, account, config, flash) {
  const lead = account.lead_id ? db.getLead(account.lead_id) : null;
  const site = account.lead_id ? db.getSiteForLead(account.lead_id) : null;
  const q = quota(db, account, monthKeyOf(new Date().toISOString()));
  const planLabel = PLANS[account.plan] ? PLANS[account.plan].label : 'No plan yet';
  const remaining = q.allowance === Infinity ? 'unlimited' : `${q.remaining} of ${q.allowance}`;
  const liveLink = site && site.preview_url ? `<p>Your site: <a href="${esc(safeUrl(site.preview_url))}" style="color:#8C3F22">${esc(site.preview_url)}</a></p>` : '';
  const canChange = canRequestChange(db, account, monthKeyOf(new Date().toISOString()));
  return html(200, `<h2 style="font-family:Georgia,serif">${esc(lead ? lead.name : 'Your account')}</h2>${note(flash)}
${liveLink}
<div style="background:#fff;border:1px solid #DACBB6;border-radius:10px;padding:16px 18px;margin:14px 0">
  <p style="margin:0"><b>Plan:</b> ${esc(planLabel)} ${account.plan_status === 'active' ? '<span style="color:#1e8e5a">(active)</span>' : ''}</p>
  <p style="margin:6px 0 0"><b>Changes this month:</b> ${esc(String(remaining))}${q.freeAvailable ? ' &middot; +1 free change available' : ''}</p>
  <p style="margin:10px 0 0"><a href="/choose-plan" style="color:#8C3F22">${account.plan_status === 'active' ? 'Change plan' : 'Pick a plan'}</a></p>
</div>
<h3 style="font-family:Georgia,serif">Request a change</h3>
${canChange.ok ? '' : note(canChange.reason)}
<form method="POST" action="/request-change">
  <textarea name="body" required placeholder="e.g. make the header navy, add my patio photos, we close at 7 now" style="display:block;width:100%;box-sizing:border-box;min-height:90px;padding:11px 13px;margin:0 0 12px;border:1px solid #DACBB6;border-radius:8px;font-size:15px"></textarea>
  ${canChange.ok ? btn(canChange.useFree ? 'Send my free change' : 'Send change') : '<span style="color:#8a8278">Pick a plan to request more changes.</span>'}
</form>
<form method="POST" action="/logout" style="margin-top:24px"><button type="submit" style="background:none;border:0;color:#8a8278;cursor:pointer;text-decoration:underline">Log out</button></form>`);
}

function choosePlanPage(account) {
  const cards = PLAN_LIST.map((p) => `<div style="flex:1;background:#fff;border:1px solid ${account.plan === p.key ? '#8C3F22' : '#DACBB6'};border-radius:10px;padding:16px">
    <div style="font-family:Georgia,serif;font-size:18px">${esc(p.label)}</div>
    <div style="font-size:26px;font-weight:700;margin:6px 0">$${p.price}<span style="font-size:14px;font-weight:400;color:#8a8278">/mo</span></div>
    <div style="color:#5b4d42;font-size:14px;margin-bottom:12px">${p.quota === Infinity ? 'Unlimited changes' : p.quota + ' changes / month'}${p.domainIncluded ? '<br>Domain included' : ''}</div>
    <form method="POST" action="/checkout"><input type="hidden" name="plan" value="${p.key}">${btn('Choose ' + p.label, '#8C3F22')}</form>
  </div>`).join('');
  return html(200, `<h2 style="font-family:Georgia,serif">Pick a plan</h2><p>Cancel anytime. Premium includes a domain.</p>
<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:16px">${cards}</div>
<p style="margin-top:18px"><a href="/dashboard" style="color:#8C3F22">Back</a></p>`);
}

// --- the router ------------------------------------------------------------------------------
export async function handlePortal(ctx) {
  const { method, path, query = {}, body = {}, cookies = {}, db, config } = ctx;
  if (!isPortalRoute(path)) return null;

  // claim link: /claim/<token> → signup pre-bound to the lead
  if (path.startsWith('/claim/')) {
    const token = decodeURIComponent(path.slice('/claim/'.length));
    const payload = verifyToken(token, config.signSecret);
    if (!payload || payload.kind !== 'claim' || !payload.leadId) return html(403, '<h2>That link is invalid or has expired.</h2>');
    return signupPage(token, db.getLead(payload.leadId));
  }

  if (path === '/signup' && method === 'POST') {
    const claim = verifyToken(body.claim || '', config.signSecret);
    const leadId = claim && claim.kind === 'claim' ? claim.leadId : null;
    const r = createAccount(db, { email: body.email, password: body.password, leadId });
    if (!r.ok) return signupPage(body.claim, leadId ? db.getLead(leadId) : null, r.error);
    return redirect('/dashboard', { 'set-cookie': sessionCookie(r.account.id, config) });
  }

  if (path === '/login') {
    if (method === 'GET') {
      return html(200, `<h2 style="font-family:Georgia,serif">Log in</h2>
<form method="POST" action="/login">${field('email', 'email', 'you@email.com')}${field('password', 'password', 'your password')}${btn('Log in')}</form>`);
    }
    const acct = authenticate(db, body.email, body.password);
    if (!acct) return html(401, '<h2>Wrong email or password.</h2><p><a href="/login" style="color:#8C3F22">Try again</a></p>');
    return redirect('/dashboard', { 'set-cookie': sessionCookie(acct.id, config) });
  }

  if (path === '/logout' && method === 'POST') return redirect('/login', { 'set-cookie': clearCookie() });

  // everything below requires a session
  const account = sessionAccount(db, cookies, config);
  if (!account) return redirect('/login');

  if (path === '/dashboard') return dashboardPage(db, account, config, query.flash);
  if (path === '/choose-plan') return choosePlanPage(account);

  if (path === '/request-change' && method === 'POST') {
    const decision = canRequestChange(db, account, monthKeyOf(new Date().toISOString()));
    if (!decision.ok) return redirect('/dashboard?flash=' + encodeURIComponent(decision.reason));
    db.addChangeRequest({ accountId: account.id, leadId: account.lead_id, body: body.body || '', kind: decision.useFree ? 'free' : 'change' });
    if (decision.useFree) db.markFreeChangeUsed(account.id);
    // Feed it back into the pipeline: record the edit + re-enter the rebuild loop if the lead can.
    if (account.lead_id) {
      db.recordEvent(account.lead_id, 'edit_request', { change: body.body || '', via: 'portal' });
      const lead = db.getLead(account.lead_id);
      if (lead && canTransition(lead.status, 'replied')) db.setStatus(account.lead_id, 'replied', { via: 'portal' });
    }
    return redirect('/dashboard?flash=' + encodeURIComponent('Got it — I\'ll make that change and update your site.'));
  }

  if (path === '/checkout' && method === 'POST') {
    const plan = PLANS[body.plan] ? body.plan : null;
    if (!plan) return redirect('/choose-plan');
    try {
      const { stripeCheckout } = await import('./stripe.js');
      const base = (config.portalBaseUrl || '').replace(/\/$/, '');
      const { url } = await stripeCheckout({
        plan, accountId: account.id, email: account.email,
        successUrl: `${base}/dashboard?flash=${encodeURIComponent('Payment received — your plan is active.')}`,
        cancelUrl: `${base}/choose-plan`,
      });
      return redirect(url);
    } catch (e) {
      return html(200, `<h2 style="font-family:Georgia,serif">Payments aren't switched on yet</h2>
<p>Card payments turn on once Stripe is connected. Your plan choice (<b>${esc(PLANS[plan].label)}</b>) is noted.</p>
<p style="color:#8a8278;font-size:13px">(${esc(String(e.message || e))})</p><p><a href="/dashboard" style="color:#8C3F22">Back</a></p>`);
    }
  }

  return null;
}

// Stripe webhook (no session; verified by signature). Separate entry so the server can pass the raw body.
export async function handleStripeWebhook({ rawBody, signature, db, config }) {
  try {
    const { makeStripe } = await import('./stripe.js');
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
