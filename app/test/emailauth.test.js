import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newCode, hashCode, verifyCodeHash, trustToken, verifyTrust, sessionToken, verifySession, pendingToken, verifyPending } from '../src/portal/emailauth.js';

const SECRET = 'test-secret';

test('newCode is always a 6-digit numeric string', () => {
  for (let i = 0; i < 200; i++) assert.match(newCode(), /^\d{6}$/);
});

test('hashCode never stores plain; verify is constant-time + secret-bound', () => {
  const h = hashCode('123456', SECRET);
  assert.doesNotMatch(h, /123456/);                       // not the plaintext
  assert.equal(verifyCodeHash('123456', h, SECRET), true);
  assert.equal(verifyCodeHash('000000', h, SECRET), false);
  assert.equal(verifyCodeHash('123456', h, 'other-secret'), false); // bound to the app secret
  assert.equal(verifyCodeHash('123456', '', SECRET), false);
});

test('trust token round-trips for its account and rejects tampering + expiry', () => {
  const tok = trustToken(7, SECRET, 1000, 0);             // exp = 0 + 1000
  assert.equal(verifyTrust(tok, SECRET, 7, 0), true);     // before expiry
  assert.equal(verifyTrust(tok, SECRET, 7, 999), true);
  assert.equal(verifyTrust(tok, SECRET, 7, 1001), false); // expired
  assert.equal(verifyTrust(tok, SECRET, 8, 0), false);    // wrong account
  assert.equal(verifyTrust(tok, 'other', 7, 0), false);   // wrong secret
  assert.equal(verifyTrust('garbage', SECRET, 7, 0), false);
});

test('session/pending tokens are kind-isolated, account-bound, and expire', () => {
  const s = sessionToken(7, SECRET, 3, 1000, 0);           // accountId 7, sv 3, exp 0+1000
  const p = pendingToken(7, SECRET, 1000, 0);
  assert.equal(verifySession(s, SECRET, 0).accountId, 7);  // valid session → claims
  assert.equal(verifySession(s, SECRET, 0).sv, 3);         // carries the session version
  assert.equal(verifySession(s, SECRET, 1001), null);      // expired
  assert.equal(verifyPending(p, SECRET, 0), 7);            // valid pending → its accountId
  assert.equal(verifyPending(p, SECRET, 1001), null);      // expired
  // a token of one class must NEVER validate as another (no token-class confusion)
  assert.equal(verifySession(p, SECRET, 0), null);         // pending ≠ session
  assert.equal(verifyPending(s, SECRET, 0), null);         // session ≠ pending
  assert.equal(verifySession(trustToken(7, SECRET, 1000, 0), SECRET, 0), null); // trust ≠ session
  assert.equal(verifyTrust(s, SECRET, 7, 0), false);       // session ≠ trust
});
