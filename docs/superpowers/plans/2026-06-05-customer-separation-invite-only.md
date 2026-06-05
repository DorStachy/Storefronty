# Customer Separation — Invite-Only, One Owner Per Site

> **For agentic workers:** implement task-by-task (TDD). Pure Node built-ins; tests via
> `node --experimental-sqlite --test`. NO new dependencies.

**Goal:** Make the portal strictly multi-tenant: every site (lead) is owned by exactly ONE account, the
portal is invite-only (a valid claim link is required to create an account), and a claim link is
single-use + expiring — so ten customers each reach only their own site, and a forwarded/reused link can
never land a second person on someone else's portal.

**Architecture:** Ownership is enforced at the data layer with a partial UNIQUE index on
`accounts.lead_id` plus an explicit "is this site already claimed?" check in `createAccount` (race-closed
by the index). Claim tokens become kind-tagged + expiring (`kind:'claim'`, `exp`), consumed implicitly:
once a lead has an owner, no other claim of its link can create an account. Invite-less signup is refused.
A startup migration de-dupes any existing many-accounts-per-lead rows (keep the oldest owner) before the
index is added.

**Tech Stack:** node:sqlite, node:crypto (existing HMAC tokens), vanilla SPA.

**Root cause being fixed (evidence):** `accounts.lead_id` is not unique (db.js); `createAccount` never
checks prior ownership (accounts.js); `claimUrl` is a non-expiring reusable bearer token
(salesman/replyEmail.js). Signing up N emails through one claim link → N accounts on one lead → one shared
site. The public storefront is intentionally public; only the PORTAL needs the tenant boundary.

---

## File structure

- **Modify** `src/db.js` — dedupe migration + partial unique index on `accounts.lead_id`; `isLeadClaimed`.
- **Modify** `src/portal/emailauth.js` — `claimToken()` / `verifyClaim()` (kind-tagged, expiring). `CLAIM_TTL_SEC`.
- **Modify** `src/salesman/replyEmail.js` — `claimUrl` uses `claimToken` (so emailed links carry `exp`).
- **Modify** `src/portal/accounts.js` — `createAccount`: invite-required + one-owner + race-safe insert.
- **Modify** `src/db.js` — `addAccount` surfaces the UNIQUE-constraint error (so createAccount can map it).
- **Modify** `src/api/index.js` — claim preview returns `claimed`; signup/Google use `verifyClaim` +
  invite-only + already-claimed handling.
- **Modify** `src/web/views/auth.js` — "already claimed → log in" view; invite-only `/signup` message.
- **Modify** `test/api.test.js`, `test/accounts.test.js`, `test/emailauth.test.js` — coverage.

---

## Task 1: One-owner data model + migration (`src/db.js`)

**Files:** Modify `src/db.js`

- [ ] **Step 1: Write the failing test** (`test/accounts.test.js` — add)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';

test('migration de-dupes many-accounts-per-lead and enforces one owner thereafter', () => {
  const db = openDatabase(':memory:');
  const { id: leadId } = db.insertLead({ name: 'Shared Cafe', niche: 'cafe' });
  const a = db.addAccount({ leadId, email: 'first@b.com', passwordHash: 'x' });   // oldest → owner
  // Force a pre-existing duplicate the way the OLD buggy code did (direct insert), then re-run migration.
  db.raw.prepare("INSERT INTO accounts (lead_id,email,password_hash,auth_provider,created_at) VALUES (?,?,?,?,?)")
    .run(leadId, 'second@b.com', 'x', 'password', new Date().toISOString());
  db.dedupeLeadOwners();                                  // idempotent; keeps the oldest
  assert.ok(db.getAccountByLead(leadId));
  assert.equal(db.getAccountByLead(leadId).email, 'first@b.com'); // oldest kept as owner
  assert.equal(db.getAccountByEmail('second@b.com').lead_id, null); // extra detached
  assert.equal(db.isLeadClaimed(leadId), true);
  db.close();
});
```

- [ ] **Step 2: Run, expect FAIL** (`dedupeLeadOwners`/`isLeadClaimed` missing).

- [ ] **Step 3: Implement.** In `openDatabase`, after the existing account ALTERs, add the dedupe +
  partial unique index (order matters: dedupe BEFORE the index or index creation fails on dupes):

```js
// Tenant isolation: a lead (site) has exactly ONE owner account. De-dupe any legacy rows (keep the
// OLDEST account per lead; detach the rest) BEFORE adding the partial-unique index, then enforce it.
const dedupeLeadOwners = () => {
  db.exec(`UPDATE accounts SET lead_id = NULL
           WHERE lead_id IS NOT NULL
             AND id NOT IN (SELECT MIN(id) FROM accounts WHERE lead_id IS NOT NULL GROUP BY lead_id)`);
};
try { dedupeLeadOwners(); db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_lead ON accounts(lead_id) WHERE lead_id IS NOT NULL'); } catch { /* already enforced */ }
```

  And expose helpers on the `api` object (near the account helpers):

```js
dedupeLeadOwners,                                   // re-runnable de-dupe (used by the migration + tests)
isLeadClaimed: (leadId) => !!db.prepare('SELECT 1 FROM accounts WHERE lead_id = ? LIMIT 1').get(leadId),
```

  (Note: `dedupeLeadOwners` is defined inside `openDatabase` where `db` is in scope; reference it from
  both the migration block and the returned `api`.)

- [ ] **Step 4: Run, expect PASS.**

---

## Task 2: `addAccount` surfaces the unique-constraint error (`src/db.js`)

**Files:** Modify `src/db.js`

So `createAccount` can map a race (two simultaneous claims) to a friendly "already claimed". node:sqlite
throws on the partial-unique violation; we let it propagate (addAccount already just runs the INSERT).

- [ ] **Step 1:** Confirm `addAccount` does not swallow errors (it doesn't — plain `.run`). Add a test:

```js
test('a second account cannot bind to an already-owned lead (DB-enforced)', () => {
  const db = openDatabase(':memory:');
  const { id: leadId } = db.insertLead({ name: 'Solo', niche: 'cafe' });
  db.addAccount({ leadId, email: 'owner@b.com', passwordHash: 'x' });
  assert.throws(() => db.addAccount({ leadId, email: 'intruder@b.com', passwordHash: 'x' }), /UNIQUE|constraint/i);
  db.close();
});
```

- [ ] **Step 2: Run → PASS** (the index from Task 1 enforces it). No code change if it already throws.

---

## Task 3: Expiring, kind-tagged claim tokens (`src/portal/emailauth.js` + `replyEmail.js`)

**Files:** Modify `src/portal/emailauth.js`, `src/salesman/replyEmail.js`

- [ ] **Step 1: Test** (`test/emailauth.test.js` — add)

```js
import { claimToken, verifyClaim } from '../src/portal/emailauth.js';
test('claim token is account-scoped to a lead, expiring, and kind-isolated', () => {
  const t = claimToken(42, SECRET, 1000, 0);            // leadId 42, exp 0+1000
  assert.equal(verifyClaim(t, SECRET, 0), 42);
  assert.equal(verifyClaim(t, SECRET, 1001), null);     // expired
  assert.equal(verifyClaim(sessionToken(1, SECRET, 0, 1000, 0), SECRET, 0), null); // session ≠ claim
});
```

- [ ] **Step 2: Implement** in `emailauth.js`:

```js
export const CLAIM_TTL_SEC = 30 * 24 * 3600; // a customer has 30 days to claim their site
export function claimToken(leadId, secret, ttl = CLAIM_TTL_SEC, now = nowSec()) {
  return signToken({ kind: 'claim', leadId, exp: now + ttl }, secret);
}
// Returns the leadId, or null. Backward-compatible: a legacy claim token with NO exp is still accepted
// (the one-owner DB lock is the real guard); only kind + (when present) expiry are enforced here.
export function verifyClaim(token, secret, now = nowSec()) {
  const p = verifyToken(token, secret);
  if (!(p && p.kind === 'claim' && p.leadId)) return null;
  if (typeof p.exp === 'number' && p.exp <= now) return null;
  return p.leadId;
}
```

- [ ] **Step 3:** Point `claimUrl` at `claimToken` (`src/salesman/replyEmail.js`):

```js
import { signToken } from '../util/sign.js';
import { claimToken } from '../portal/emailauth.js';
export function claimUrl(lead, config) {
  const base = (config.portalBaseUrl || '').replace(/\/$/, '');
  return `${base}/claim/${claimToken(lead.id, config.signSecret)}`;
}
```

- [ ] **Step 4: Run emailauth + reply-email tests → PASS.**

---

## Task 4: Invite-only + one-owner in `createAccount` (`src/portal/accounts.js`)

**Files:** Modify `src/portal/accounts.js`

- [ ] **Step 1: Test** (`test/accounts.test.js`)

```js
import { createAccount } from '../src/portal/accounts.js';
test('createAccount is invite-only and one-owner', () => {
  const db = openDatabase(':memory:');
  const { id: leadId } = db.insertLead({ name: 'Cafe', niche: 'cafe' });
  // invite-less → refused
  assert.equal(createAccount(db, { email: 'a@b.com', password: 'longenough1', leadId: null }).ok, false);
  // first claim → owner
  assert.equal(createAccount(db, { email: 'owner@b.com', password: 'longenough1', leadId }).ok, true);
  // second claim of the SAME site → refused (already claimed), even with a new email
  const r = createAccount(db, { email: 'intruder@b.com', password: 'longenough1', leadId });
  assert.equal(r.ok, false);
  assert.match(r.error, /already (been )?claimed/i);
  db.close();
});
```

- [ ] **Step 2: Implement.** Replace `createAccount`:

```js
export function createAccount(db, { email, password, leadId = null }) {
  const e = String(email || '').toLowerCase().trim();
  if (!validEmail(e)) return { ok: false, error: 'a valid email is required' };
  if (!password || String(password).length < 8) return { ok: false, error: 'password must be at least 8 characters' };
  if (leadId == null) return { ok: false, error: 'You need an invite link to create an account. Check your email for your link.' };
  if (db.getAccountByEmail(e)) return { ok: false, error: 'an account with that email already exists' };
  if (db.isLeadClaimed(leadId)) return { ok: false, error: 'This site has already been claimed — please log in instead.' };
  try {
    const id = db.addAccount({ leadId, email: e, passwordHash: hashPassword(password) });
    return { ok: true, account: db.getAccount(id) };
  } catch (err) {
    // lost a race to the unique index → someone else just claimed it
    if (/UNIQUE|constraint/i.test(String(err && err.message))) return { ok: false, error: 'This site has already been claimed — please log in instead.' };
    throw err;
  }
}
```

- [ ] **Step 3: Run → PASS.**

---

## Task 5: API — claim preview, signup, Google (`src/api/index.js`)

**Files:** Modify `src/api/index.js`

- [ ] **Claim preview** (`/api/auth/claim`): use `verifyClaim`, and tell the SPA if it's already claimed:

```js
if (path === '/api/auth/claim' && method === 'POST') {
  const leadId = verifyClaim(body.token || '', config.signSecret);
  if (!leadId) return json(400, { error: 'this link is invalid or has expired' });
  const lead = db.getLead(leadId);
  return json(200, { valid: true, claimed: db.isLeadClaimed(leadId), shop: { name: lead ? lead.name : null } });
}
```

- [ ] **Signup** (`/api/auth/signup`): resolve the leadId via `verifyClaim` (invite-only enforced inside
  `createAccount`):

```js
if (path === '/api/auth/signup' && method === 'POST') {
  const leadId = verifyClaim(body.token || '', config.signSecret);
  const r = createAccount(db, { email: body.email, password: body.password, leadId });
  if (!r.ok) return json(400, { error: r.error });
  await issueCode(db, r.account, 'verify', config);
  return json(200, { needsVerify: true, email: r.account.email });
}
```

- [ ] **Google callback** (`handleGoogleCallback`): invite-only + one-owner for NEW accounts; existing
  accounts just log in:

```js
let account = db.getAccountByEmail(profile.email);
if (!account) {
  const claim = verifyToken(payload.claim || '', config.signSecret);
  const leadId = (claim && claim.kind === 'claim' && claim.leadId && !(typeof claim.exp === 'number' && claim.exp <= Math.floor(Date.now()/1000))) ? claim.leadId : null;
  if (!leadId) return redirect302('/login?err=invite');          // invite-only
  if (db.isLeadClaimed(leadId)) return redirect302('/login?err=claimed');
  try { account = db.getAccount(db.addAccount({ leadId, email: profile.email, passwordHash: null, authProvider: 'google' })); }
  catch { return redirect302('/login?err=claimed'); }
}
if (!account.email_verified) db.setEmailVerified(account.id);
return redirect302('/dashboard', { 'set-cookie': [sessionCookie(account, config), trustCookie(account.id, config)] });
```

  (Import `verifyClaim` alongside the other emailauth imports; `verifyToken` is still used for the gstate.)

- [ ] **Run `test/api.test.js` → adjust existing claim/signup tests to expect the new shapes; PASS.**

---

## Task 6: SPA — already-claimed + invite-only views (`src/web/views/auth.js`)

**Files:** Modify `src/web/views/auth.js`

- [ ] **Claim route:** when `api.claim(token)` returns `claimed:true`, render a "this site is already
  claimed" card with a **Log in** button instead of the signup form:

```js
api.claim(token)
  .then((r) => r.claimed
    ? show(h('div', {},
        brand(),
        h('h1', {}, 'This site is already claimed'),
        h('p', { class: 'sub' }, `${(r.shop && r.shop.name) || 'This site'} already has an owner. If that's you, log in.`),
        h('a', { class: 'btn', href: '/login', onClick: (e) => { e.preventDefault(); navigate('/login'); } }, 'Log in')))
    : authForm({ mode: 'signup', shop: r.shop && r.shop.name, token }))
  .catch(() => show(/* existing "that link expired" card */));
```

- [ ] **Invite-only `/signup`:** the bare `/signup` route (no token) must NOT show a create-account form
  (it can never succeed). Render an invite-only message:

```js
} else if (path === '/signup') {
  show(h('div', {},
    brand(),
    h('h1', {}, 'Storefronty is invite-only'),
    h('p', { class: 'sub' }, 'Accounts are created from the private link in your email. Already have an account?'),
    h('a', { class: 'btn', href: '/login', onClick: (e) => { e.preventDefault(); navigate('/login'); } }, 'Log in')));
} else {
  authForm({ mode: 'login' });
}
```

  Also drop the "Don't have one yet? Sign up" link from the login form (replace with "Have an invite
  link? Open it to get started.").

---

## Task 7: Verify, deploy, reseed

- [ ] `node --experimental-sqlite --test` → all green.
- [ ] Self-review: invite-less signup refused; 2nd claim of a site refused (API + DB index); Google can't
  hijack an owned lead; migration keeps exactly one owner per lead; legacy (no-exp) links still work but
  only on an UNOWNED lead.
- [ ] **Two-tenant E2E (hermetic):** seed leads A + B; claim A with `a@x`, claim B with `b@x`; assert
  `/api/me` for each shows only its own shop/site; assert claiming A with `c@x` is refused.
- [ ] `fly deploy`; on the live DB confirm the unique index exists and `idx_accounts_lead` holds.
- [ ] **Reseed note:** the live DB currently has multiple test accounts on the Beautiful Scars lead. The
  migration keeps the OLDEST as owner and detaches the rest. For a clean demo, optionally wipe accounts +
  reseed one lead and claim it once. (Document; do not auto-wipe.)

---

## Self-review checklist
- One owner per site enforced in TWO places (app check + DB partial-unique index → race-safe). ✓
- Invite-only: no claim token ⇒ no account (signup + Google). ✓
- Claim links expire (30d) and are single-use in effect (owned lead rejects further claims). ✓
- Already-claimed link shows "log in", not a second signup. ✓
- Existing per-account scoping (sites, quota, change requests, billing) now maps 1:1 to one tenant. ✓
- Migration is idempotent and non-destructive (detaches extras to lead_id NULL; never deletes). ✓
- Public storefront stays public (only the portal is gated) — intended. ✓
