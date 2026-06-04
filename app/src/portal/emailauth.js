// Email-based auth: 6-digit one-time codes (signup verification + login 2nd factor) and a signed
// trusted-device token. No authenticator app — our customers (salons, cafes, tattoo shops) just read a
// code from their inbox. Pure node:crypto; codes are HMAC-hashed (never stored or logged in plain).
// `now` is injectable (seconds) so the time-sensitive bits are deterministically testable.
import { randomInt, createHmac, timingSafeEqual } from 'node:crypto';
import { signToken, verifyToken } from '../util/sign.js';

export const CODE_TTL_SEC = 600;        // a code is valid for 10 minutes
export const MAX_CODE_ATTEMPTS = 5;     // wrong-guesses before the code is burned
export const RESEND_COOLDOWN_SEC = 45;  // min gap between "resend code" requests
export const TRUST_TTL_SEC = 30 * 24 * 3600; // remember a verified device for 30 days
export const SESSION_TTL_SEC = 30 * 24 * 3600; // signed-session lifetime (also re-checked server-side)
export const PENDING_TTL_SEC = 600;     // a password-authed login has 10 min to clear the 2FA code
export const LOCKOUT_THRESHOLD = 5;     // bad passwords (per email, in-window) before lockout
export const LOCKOUT_WINDOW_SEC = 900;  // the failure-counting window (15 min)
export const LOCKOUT_SEC = 900;         // how long the lockout lasts (15 min)

export const nowSec = () => Math.floor(Date.now() / 1000);

// A uniformly-random 6-digit code (randomInt is unbiased — no modulo skew). Zero-padded.
export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

// HMAC the code with the app secret so a DB leak never exposes a live code. Salted by a fixed label.
export function hashCode(code, secret) {
  return createHmac('sha256', String(secret)).update(`code:${String(code)}`).digest('base64url');
}
export function verifyCodeHash(code, stored, secret) {
  const a = Buffer.from(hashCode(code, secret));
  const b = Buffer.from(String(stored || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

// All three token classes are signed { kind, accountId, exp } and verified by EXACT kind + unexpired, so
// one class can never be replayed as another (e.g. a trust cookie used as a session). Each verifier
// returns the bound accountId (or null), except verifyTrust which checks against a given accountId.

// Session: the logged-in cookie. Carries its own expiry (so a stale/stolen token can't be replayed
// forever) and the account's session version `sv` (so logout can revoke it server-side). verifySession
// returns the validated claims { accountId, sv, ... } (or null); the caller compares sv to the account's.
export function sessionToken(accountId, secret, sv = 0, ttl = SESSION_TTL_SEC, now = nowSec()) {
  return signToken({ kind: 'session', accountId, sv, exp: now + ttl }, secret);
}
export function verifySession(token, secret, now = nowSec()) {
  const p = verifyToken(token, secret);
  return (p && p.kind === 'session' && p.accountId && typeof p.exp === 'number' && p.exp > now) ? p : null;
}

// Pending-2FA: minted ONLY after a correct password on a new device. Required to submit/resend the login
// code, so the email code can never stand in for the password (2FA is bound to password auth).
export function pendingToken(accountId, secret, ttl = PENDING_TTL_SEC, now = nowSec()) {
  return signToken({ kind: 'pending2fa', accountId, exp: now + ttl }, secret);
}
export function verifyPending(token, secret, now = nowSec()) {
  const p = verifyToken(token, secret);
  return (p && p.kind === 'pending2fa' && p.accountId && typeof p.exp === 'number' && p.exp > now) ? p.accountId : null;
}

// Trusted-device: set after a code is verified, so a returning customer on the same browser skips the code.
export function trustToken(accountId, secret, ttl = TRUST_TTL_SEC, now = nowSec()) {
  return signToken({ kind: 'trust', accountId, exp: now + ttl }, secret);
}
export function verifyTrust(token, secret, accountId, now = nowSec()) {
  const p = verifyToken(token, secret);
  return !!(p && p.kind === 'trust' && p.accountId === accountId && typeof p.exp === 'number' && p.exp > now);
}
