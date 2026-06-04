// Portal accounts: email+password auth (scrypt), the plan tiers + monthly quota, and the
// post-signup "one free change" carrot. Google login is a later seam — these are the primary path
// the founder can run today with no third-party creds. (design spec §7)
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// `exampleUrl` points at the generic, hand-built showcase demo for that tier (one Pro, one Premium,
// reused for every customer) — the portal's "See an example" link. Starter's example is the owner's
// own live preview, so it has none.
export const PLANS = {
  starter: { key: 'starter', label: 'Starter', price: 29, quota: 3, exampleUrl: null },
  pro: { key: 'pro', label: 'Pro', price: 49, quota: 15, exampleUrl: '/portal/showcase-pro/' },
  premium: { key: 'premium', label: 'Premium', price: 99, quota: Infinity, domainIncluded: true, exampleUrl: '/portal/showcase-premium/' },
};
export const PLAN_LIST = [PLANS.starter, PLANS.pro, PLANS.premium];

// One-time "buy more changes" packs. Priced around the Pro per-unit ($49/15 ≈ $3.27); the bigger
// pack is the better value. They add non-expiring credits used after the monthly plan quota.
export const TOPUPS = {
  pack5: { key: 'pack5', label: '5 changes', changes: 5, price: 19 },
  pack15: { key: 'pack15', label: '15 changes', changes: 15, price: 45 },
};
export const TOPUP_LIST = [TOPUPS.pack5, TOPUPS.pack15];

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

// A fixed valid-format hash to compare against when the account is missing or Google-only (no password),
// so authenticate ALWAYS runs one scrypt — no timing tell for "does this email exist / have a password".
const DUMMY_HASH = hashPassword('storefronty-timing-equalizer');

export function authenticate(db, email, password) {
  const acct = db.getAccountByEmail(email);
  const stored = acct && acct.password_hash ? acct.password_hash : DUMMY_HASH;
  const ok = verifyPassword(password, stored);                 // constant work either way
  return acct && acct.password_hash && ok ? acct : null;
}

// Quota = plan allowance this month + the post-signup free change + bought top-up credits. 'YYYY-MM'.
export function quota(db, account, monthKey) {
  const plan = PLANS[account.plan] || null;
  const allowance = plan ? plan.quota : 0;
  const used = db.changeRequestsThisMonth(account.id, monthKey);
  const remaining = allowance === Infinity ? Infinity : Math.max(0, allowance - used);
  const extra = Number(account.extra_changes) || 0;
  return { plan: account.plan, allowance, used, remaining, extra, freeAvailable: !account.free_change_used };
}

// May this account submit a change now? Order: the post-signup free change → the monthly plan quota
// (active plan) → bought top-up credits. Returns { ok, useFree?, useExtra? } or { ok:false, reason }.
export function canRequestChange(db, account, monthKey) {
  const q = quota(db, account, monthKey);
  if (q.freeAvailable) return { ok: true, useFree: true };
  if (account.plan_status === 'active' && q.remaining > 0) return { ok: true };
  if (q.extra > 0) return { ok: true, useExtra: true };
  if (account.plan_status !== 'active') return { ok: false, reason: 'pick a plan or buy a change pack to keep going', needsPlan: true };
  return { ok: false, reason: "you've used this month's changes — buy a pack to keep going", needsTopup: true };
}

export const monthKeyOf = (iso) => String(iso).slice(0, 7); // 'YYYY-MM'
