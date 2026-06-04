# Email Verification + Email-Code 2FA Implementation Plan

> **For agentic workers:** implement task-by-task. Pure Node built-ins (node:crypto) — NO new deps. Tests via `node --experimental-sqlite --test`.

**Goal:** Secure paying customers' accounts with email verification at signup and an email one-time code as the login second factor (no authenticator app — our customers are non-technical), plus brute-force protection.

**Architecture:** A single `email_codes` table backs both flows (purpose = `verify` | `login`). Codes are 6 digits, HMAC-hashed (never stored plain), expire in 10 min, capped at 5 attempts, resend-throttled. After a code is verified we set a **trusted-device** cookie (signed, 30-day exp) so a returning customer on the same browser skips the code. A small `login_attempts` table locks an email after repeated bad passwords. Google sign-in is auto-verified and exempt from the email code (Google is the strong factor).

**Tech Stack:** node:sqlite, node:crypto (HMAC-SHA256, randomInt), existing mailer, vanilla SPA.

---

## File structure

- **Create** `src/portal/emailauth.js` — code gen/hash/verify, trusted-device token, lockout helpers (pure, unit-tested).
- **Create** `src/email/codeEmail.js` — `composeCodeEmail({ code, purpose, config })` → `{ subject, text, html }`.
- **Modify** `src/db.js` — `email_codes` + `login_attempts` tables; account `email_verified`; helpers.
- **Modify** `src/api/index.js` — signup → needs-verify; new `/api/auth/verify-email`, `/api/auth/2fa`, `/api/auth/resend`; login → trust/2FA branch + lockout; Google callback sets verified.
- **Modify** `src/web/views/auth.js` — code-entry step after signup/login.
- **Modify** `src/web/api.js` — `verifyEmail`, `twofa`, `resendCode`.
- **Modify** `src/web/views/account.js` — replace "Change password / Coming soon" with a Security panel (email-verified badge).
- **Create** `test/emailauth.test.js`; **modify** `test/api.test.js`.

---

## Task 1: Core email-auth module (`src/portal/emailauth.js`)

**Files:** Create `src/portal/emailauth.js`; Test `test/emailauth.test.js`

- [ ] **Step 1: Write failing tests** (`test/emailauth.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newCode, hashCode, verifyCodeHash, trustToken, verifyTrust } from '../src/portal/emailauth.js';

const SECRET = 'test-secret';

test('newCode is a 6-digit numeric string', () => {
  for (let i = 0; i < 50; i++) assert.match(newCode(), /^\d{6}$/);
});

test('hashCode is deterministic + constant-time verify; wrong code fails', () => {
  const h = hashCode('123456', SECRET);
  assert.notEqual(h, '123456');                 // never stored plain
  assert.equal(verifyCodeHash('123456', h, SECRET), true);
  assert.equal(verifyCodeHash('000000', h, SECRET), false);
  assert.equal(verifyCodeHash('123456', h, 'other'), false); // secret-bound
});

test('trust token round-trips for the account and rejects tampering/expiry', () => {
  const tok = trustToken(7, SECRET, 1000); // expires 1000s from a fixed base
  const ok = verifyTrust(tok, SECRET, 7, 0);
  assert.equal(ok, true);
  assert.equal(verifyTrust(tok, SECRET, 8, 0), false);      // wrong account
  assert.equal(verifyTrust(tok, SECRET, 7, 2000), false);   // expired
  assert.equal(verifyTrust('garbage', SECRET, 7, 0), false);
});
```

- [ ] **Step 2: Run, expect FAIL** (module missing).

- [ ] **Step 3: Implement** (`src/portal/emailauth.js`)

```js
// Email-based auth: 6-digit one-time codes (signup verification + login 2nd factor) and a signed
// trusted-device token. No authenticator app — our customers just read a code from their inbox.
// Pure node:crypto; codes are HMAC-hashed (never stored plain). `nowSec` is injectable for tests.
import { randomInt, createHmac, timingSafeEqual } from 'node:crypto';
import { signToken, verifyToken } from '../util/sign.js';

export const CODE_TTL_SEC = 600;     // a code is valid 10 minutes
export const MAX_CODE_ATTEMPTS = 5;  // then it's burned
export const RESEND_COOLDOWN_SEC = 45;
export const TRUST_TTL_SEC = 30 * 24 * 3600; // remember a device 30 days
export const LOCKOUT_THRESHOLD = 5;  // bad passwords before lockout
export const LOCKOUT_WINDOW_SEC = 900;
export const LOCKOUT_SEC = 900;

export const nowSec = () => Math.floor(Date.now() / 1000);

export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

export function hashCode(code, secret) {
  return createHmac('sha256', String(secret)).update(`code:${String(code)}`).digest('base64url');
}
export function verifyCodeHash(code, stored, secret) {
  const a = Buffer.from(hashCode(code, secret));
  const b = Buffer.from(String(stored || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

// Trusted-device token: signed { kind:'trust', accountId, exp }. `ttl`/`now` injectable for tests.
export function trustToken(accountId, secret, ttl = TRUST_TTL_SEC, now = nowSec()) {
  return signToken({ kind: 'trust', accountId, exp: now + ttl }, secret);
}
export function verifyTrust(token, secret, accountId, now = nowSec()) {
  const p = verifyToken(token, secret);
  return !!(p && p.kind === 'trust' && p.accountId === accountId && typeof p.exp === 'number' && p.exp > now);
}
```

- [ ] **Step 4: Run, expect PASS.**

---

## Task 2: DB schema + helpers (`src/db.js`)

**Files:** Modify `src/db.js`

- [ ] **Step 1:** Add to `SCHEMA` (after `change_requests`):

```sql
CREATE TABLE IF NOT EXISTS email_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL, purpose TEXT NOT NULL, -- 'verify' | 'login'
  code_hash TEXT NOT NULL, attempts INTEGER DEFAULT 0, used INTEGER DEFAULT 0,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  email TEXT PRIMARY KEY, fails INTEGER DEFAULT 0,
  window_start TEXT, locked_until TEXT
);
```

- [ ] **Step 2:** Add migration (after the change_requests ALTERs):

```js
try { db.exec('ALTER TABLE accounts ADD COLUMN email_verified INTEGER DEFAULT 0'); } catch { /* present */ }
```

- [ ] **Step 3:** Add helpers (in the `api` object, near the accounts helpers):

```js
setEmailVerified: (id) => db.prepare('UPDATE accounts SET email_verified = 1 WHERE id = ?').run(id),

// Email codes. createEmailCode supersedes any prior unused code for the same purpose (one live code).
createEmailCode({ accountId, purpose, codeHash, expiresAt }) {
  return api.transaction(() => {
    db.prepare("UPDATE email_codes SET used = 1 WHERE account_id = ? AND purpose = ? AND used = 0").run(accountId, purpose);
    const info = db.prepare('INSERT INTO email_codes (account_id,purpose,code_hash,attempts,used,expires_at,created_at) VALUES (?,?,?,0,0,?,?)')
      .run(accountId, purpose, codeHash, expiresAt, now());
    return Number(info.lastInsertRowid);
  });
},
latestEmailCode: (accountId, purpose) =>
  db.prepare("SELECT * FROM email_codes WHERE account_id = ? AND purpose = ? AND used = 0 ORDER BY id DESC").get(accountId, purpose),
bumpEmailCodeAttempt: (id) => db.prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?').run(id),
useEmailCode: (id) => db.prepare('UPDATE email_codes SET used = 1 WHERE id = ?').run(id),

// Brute-force: per-email failure window + lockout.
getLoginAttempt: (email) => db.prepare('SELECT * FROM login_attempts WHERE email = ?').get(String(email || '').toLowerCase().trim()),
recordLoginFail({ email, windowStart, fails, lockedUntil = null }) {
  db.prepare(`INSERT INTO login_attempts (email,fails,window_start,locked_until) VALUES (?,?,?,?)
    ON CONFLICT(email) DO UPDATE SET fails = excluded.fails, window_start = excluded.window_start, locked_until = excluded.locked_until`)
    .run(String(email).toLowerCase().trim(), fails, windowStart, lockedUntil);
},
clearLoginAttempts: (email) => db.prepare('DELETE FROM login_attempts WHERE email = ?').run(String(email || '').toLowerCase().trim()),
```

- [ ] **Step 4:** Existing DB tests still pass (`node --test test/api.test.js test/accounts.test.js`).

---

## Task 3: Code email (`src/email/codeEmail.js`)

**Files:** Create `src/email/codeEmail.js`

- [ ] **Step 1: Implement**

```js
// The 6-digit code email (signup verification + login 2nd factor). Short, plain, no links to click —
// just the code. escapeHtml-safe (code is numeric, but keep the pattern).
import { escapeHtml } from '../util/html.js';

export function composeCodeEmail({ code, purpose = 'login', config }) {
  const brand = config.brand || 'Storefronty';
  const why = purpose === 'verify' ? 'confirm your email and finish setting up your account' : 'finish signing in';
  const subject = `Your ${brand} code: ${code}`;
  const text = `Your ${brand} verification code is ${code}\n\nEnter it to ${why}. It expires in 10 minutes.\nIf you didn't request this, you can ignore this email.`;
  const c = escapeHtml(String(code));
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#262626;max-width:520px">
<p>Your ${escapeHtml(brand)} verification code is:</p>
<p style="font-size:30px;font-weight:700;letter-spacing:5px;margin:14px 0">${c}</p>
<p>Enter it to ${why}. It expires in 10 minutes.</p>
<p style="color:#8a8278;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
</div>`;
  return { subject, text, html };
}
```

---

## Task 4: API wiring (`src/api/index.js`)

**Files:** Modify `src/api/index.js`

Imports: add `verifyPassword` is via accounts; add
```js
import { newCode, hashCode, verifyCodeHash, trustToken, verifyTrust, nowSec, CODE_TTL_SEC, MAX_CODE_ATTEMPTS, RESEND_COOLDOWN_SEC, LOCKOUT_THRESHOLD, LOCKOUT_WINDOW_SEC, LOCKOUT_SEC } from '../portal/emailauth.js';
import { composeCodeEmail } from '../email/codeEmail.js';
import { authenticate } from '../portal/accounts.js';  // already imported via accounts — ensure present
```
Add a trusted-device cookie name + helper:
```js
const TRUST_COOKIE = 'sf_trust';
const trustCookie = (token) => `${TRUST_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30*24*3600}`;
const isoIn = (sec) => new Date(Date.now() + sec * 1000).toISOString();
```
A shared "issue + email a code" helper (best-effort email; never leak whether the account exists):
```js
async function issueCode(db, account, purpose, config) {
  const code = newCode();
  db.createEmailCode({ accountId: account.id, purpose, codeHash: hashCode(code, config.signSecret), expiresAt: isoIn(CODE_TTL_SEC) });
  try { const { sendEmail } = await import('../mailer/index.js'); await sendEmail({ to: config.mail.testRecipient || account.email, ...composeCodeEmail({ code, purpose, config }) }, config); } catch { /* delivery best-effort */ }
}
// returns { ok } | { error } | { expired } | { tooMany }
function checkCode(db, account, purpose, code, config) {
  const row = db.latestEmailCode(account.id, purpose);
  if (!row) return { error: 'request a new code' };
  if (new Date(row.expires_at).getTime() < Date.now()) return { expired: true };
  if (row.attempts >= MAX_CODE_ATTEMPTS) return { tooMany: true };
  if (!verifyCodeHash(String(code || ''), row.code_hash, config.signSecret)) { db.bumpEmailCodeAttempt(row.id); return { error: 'that code is incorrect' }; }
  db.useEmailCode(row.id);
  return { ok: true };
}
```

- [ ] **Signup** (`/api/auth/signup`): after `createAccount` succeeds, do NOT set a session. Instead:
```js
await issueCode(db, r.account, 'verify', config);
return json(200, { needsVerify: true, email: r.account.email });
```

- [ ] **Verify email** (new, public): `/api/auth/verify-email` POST `{ email, code }`:
```js
const acct = db.getAccountByEmail(body.email);
if (!acct) return json(400, { error: 'request a new code' });
const r = checkCode(db, acct, 'verify', body.code, config);
if (r.expired) return json(400, { error: 'that code expired — request a new one', expired: true });
if (r.tooMany) return json(429, { error: 'too many tries — request a new code' });
if (!r.ok) return json(400, { error: r.error });
db.setEmailVerified(acct.id);
return json(200, { account: safeAccount(acct) }, { 'set-cookie': [sessionCookie(acct.id, config), trustCookie(trustToken(acct.id, config.signSecret))] });
```
(Note: `set-cookie` must support an array — see Task 4b.)

- [ ] **Login** (`/api/auth/login`): add lockout + verify + trust/2FA branch:
```js
const email = String(body.email || '').toLowerCase().trim();
// lockout check
const at = db.getLoginAttempt(email);
if (at && at.locked_until && new Date(at.locked_until).getTime() > Date.now()) return json(429, { error: 'too many attempts — try again in a few minutes' });
const acct = authenticate(db, email, body.password);
if (!acct) {
  const within = at && at.window_start && (Date.now() - new Date(at.window_start).getTime() < LOCKOUT_WINDOW_SEC * 1000);
  const fails = (within ? at.fails : 0) + 1;
  db.recordLoginFail({ email, windowStart: within ? at.window_start : new Date().toISOString(), fails, lockedUntil: fails >= LOCKOUT_THRESHOLD ? isoIn(LOCKOUT_SEC) : null });
  return json(401, { error: 'wrong email or password' });
}
db.clearLoginAttempts(email);
if (!acct.email_verified) { await issueCode(db, acct, 'verify', config); return json(200, { needsVerify: true, email: acct.email }); }
if (verifyTrust(cookies[TRUST_COOKIE] || '', config.signSecret, acct.id)) return json(200, { account: safeAccount(acct) }, { 'set-cookie': sessionCookie(acct.id, config) });
await issueCode(db, acct, 'login', config);
return json(200, { needs2fa: true, email: acct.email });
```

- [ ] **2FA** (new, public): `/api/auth/2fa` POST `{ email, code }` — same as verify-email but `purpose='login'`, no setEmailVerified, set session + trust cookie.

- [ ] **Resend** (new, public): `/api/auth/resend` POST `{ email, purpose }` — cooldown via the latest code's `created_at`; re-issue:
```js
const acct = db.getAccountByEmail(body.email);
const purpose = body.purpose === 'verify' ? 'verify' : 'login';
if (acct) { const last = db.latestEmailCode(acct.id, purpose); if (last && Date.now() - new Date(last.created_at).getTime() < RESEND_COOLDOWN_SEC * 1000) return json(429, { error: 'hold on a moment before requesting another code' }); await issueCode(db, acct, purpose, config); }
return json(200, { ok: true }); // never reveal whether the email exists
```

- [ ] **Google callback** (`handleGoogleCallback`): on account create/find, set `db.setEmailVerified(account.id)` (Google verified the email) and (optional) set a trust cookie too.

### Task 4b: server `set-cookie` array support (`src/server.js`)

- [ ] The Node response needs multiple `set-cookie`s (session + trust). `res.writeHead(out.status, out.headers)` already supports an array value for a header. Ensure `handleApi` returns `headers['set-cookie']` as a string OR array; no server change needed if we always pass arrays/strings (Node accepts both). Verify with a test.

---

## Task 5: SPA client + views

**Files:** Modify `src/web/api.js`, `src/web/views/auth.js`, `src/web/views/account.js`

- [ ] **api.js**: add
```js
verifyEmail: (b) => req('POST', '/api/auth/verify-email', b),
twofa: (b) => req('POST', '/api/auth/2fa', b),
resendCode: (b) => req('POST', '/api/auth/resend', b),
```

- [ ] **auth.js**: after `api.signup` returns `{needsVerify}` or `api.login` returns `{needsVerify|needs2fa}`, render a **code step** instead of calling `onAuthed`. Code step: a 6-digit input, Verify button (calls `verifyEmail` or `twofa` with the stored email), a "Resend code" link (calls `resendCode`), and a back link. On success → `onAuthed()`. Reuse the card; show "We emailed a 6-digit code to {email}."

- [ ] **account.js**: replace the disabled "Change password / Coming soon" row with a Security panel: an email-verified badge (`me.account.emailVerified ? 'Verified' : 'Unverified'`) and copy "We email a 6-digit code to confirm new sign-ins." Add `emailVerified: !!a.email_verified` to `safeAccount` in api/index.js so the SPA can show it.

---

## Task 6: Update existing tests (`test/api.test.js`)

- [ ] Signup no longer returns a session — update the "signup sets a session" + quota + image-upload + topup tests to perform the verify step first. Helper:
```js
async function signupVerified(db, config, { email, password = 'longenough1', token = '' }) {
  await handleApi({ method: 'POST', path: '/api/auth/signup', body: { email, password, token }, db, config });
  const row = db.latestEmailCode(db.getAccountByEmail(email).id, 'verify');
  // tests can't read the plaintext code (hashed) → mark verified directly + mint a session via login-trust path
  db.setEmailVerified(db.getAccountByEmail(email).id);
  db.useEmailCode(row.id);
  const login = await handleApi({ method: 'POST', path: '/api/auth/login', body: { email, password }, db, config });
  // verified + no trust cookie → needs2fa; for tests, set verified then use a trust cookie shortcut:
  return login;
}
```
  Simpler: since the code is hashed, tests assert the FLOW (needsVerify true; a code row exists) and use `db.setEmailVerified` + a minted trust cookie to get a session. Add focused tests:
  - signup → `{ needsVerify:true }`, a `verify` code row exists, no session cookie.
  - login on unverified → `{ needsVerify:true }`.
  - login verified + valid trust cookie → session (200, account).
  - login verified + no trust → `{ needs2fa:true }` + a `login` code row.
  - 5 wrong passwords → 6th returns 429 (locked).
  - wrong code bumps attempts; 6th attempt → 429 tooMany.

- [ ] Where later authed tests need a session, mint one directly: `cookies = { sf_session: signToken({accountId}, secret), sf_trust: trustToken(accountId, secret) }` — bypasses the email step deterministically.

---

## Task 7: Full suite + deploy

- [ ] `node --experimental-sqlite --test` → all green.
- [ ] Self-review (security): codes hashed, constant-time, expiry + attempt caps enforced, lockout works, trust token bound to account + expiry, no account-existence leak on resend, Google auto-verified.
- [ ] `fly deploy` + a read-only Fly probe of the new tables.

---

## Self-review checklist
- Codes never stored or logged in plaintext (HMAC-hashed). ✓
- Constant-time compare for code + password + trust sig. ✓
- One live code per purpose (createEmailCode supersedes). ✓
- Resend cooldown + per-code attempt cap + 10-min expiry → code un-brute-forceable. ✓
- Login lockout after 5 fails/15 min → password un-brute-forceable. ✓
- Trust cookie HttpOnly+SameSite, signed, account-bound, 30-day exp. ✓
- Google path auto-verified, exempt from email code. ✓
- Existing claim→account→orchestrator (getAccountByLead) unaffected (account still created at signup). ✓
