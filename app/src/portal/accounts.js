// Portal accounts: email+password auth (scrypt), the plan tiers + monthly quota, and the
// post-signup "one free change" carrot. Google login is a later seam — these are the primary path
// the founder can run today with no third-party creds. (design spec §7)
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const PLANS = {
  starter: { key: 'starter', label: 'Starter', price: 29, quota: 3 },
  pro: { key: 'pro', label: 'Pro', price: 49, quota: 15 },
  premium: { key: 'premium', label: 'Premium', price: 99, quota: Infinity, domainIncluded: true },
};
export const PLAN_LIST = [PLANS.starter, PLANS.pro, PLANS.premium];

// scrypt password hash, stored as `saltHex:hashHex`. Constant-time verify.
export function hashPassword(pw) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(pw), salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(String(pw), Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || ''));

// Create an account, optionally pre-bound to a lead's site (via the signed claim link).
// Returns { ok, account } or { ok:false, error }.
export function createAccount(db, { email, password, leadId = null }) {
  const e = String(email || '').toLowerCase().trim();
  if (!validEmail(e)) return { ok: false, error: 'a valid email is required' };
  if (!password || String(password).length < 8) return { ok: false, error: 'password must be at least 8 characters' };
  if (db.getAccountByEmail(e)) return { ok: false, error: 'an account with that email already exists' };
  const id = db.addAccount({ leadId, email: e, passwordHash: hashPassword(password) });
  return { ok: true, account: db.getAccount(id) };
}

export function authenticate(db, email, password) {
  const acct = db.getAccountByEmail(email);
  if (!acct || !verifyPassword(password, acct.password_hash)) return null;
  return acct;
}

// Quota = plan allowance this month + the one post-signup free change (until used). monthKey 'YYYY-MM'.
export function quota(db, account, monthKey) {
  const plan = PLANS[account.plan] || null;
  const allowance = plan ? plan.quota : 0;
  const used = db.changeRequestsThisMonth(account.id, monthKey);
  const remaining = allowance === Infinity ? Infinity : Math.max(0, allowance - used);
  return { plan: account.plan, allowance, used, remaining, freeAvailable: !account.free_change_used };
}

// May this account submit a change now? The free change is spent first; then the plan quota (which
// requires an active plan). Returns { ok, useFree } or { ok:false, reason }.
export function canRequestChange(db, account, monthKey) {
  const q = quota(db, account, monthKey);
  if (q.freeAvailable) return { ok: true, useFree: true };
  if (account.plan_status !== 'active') return { ok: false, reason: 'no active plan — pick a plan to keep requesting changes' };
  if (q.remaining > 0) return { ok: true, useFree: false };
  return { ok: false, reason: 'monthly change quota reached' };
}

export const monthKeyOf = (iso) => String(iso).slice(0, 7); // 'YYYY-MM'
