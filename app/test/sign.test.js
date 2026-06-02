import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signToken, verifyToken } from '../src/util/sign.js';

const secret = 'test-secret';

test('signToken → verifyToken round-trips the payload', () => {
  const tok = signToken({ id: 7, kind: 'approve' }, secret);
  assert.deepEqual(verifyToken(tok, secret), { id: 7, kind: 'approve' });
});

test('a tampered token fails verification', () => {
  const tok = signToken({ id: 7 }, secret);
  assert.equal(verifyToken(tok + 'x', secret), null);
  assert.equal(verifyToken(tok.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')), secret), null);
});

test('a token signed with a different secret fails', () => {
  const tok = signToken({ id: 7 }, secret);
  assert.equal(verifyToken(tok, 'other-secret'), null);
});

test('garbage / empty tokens return null, never throw', () => {
  assert.equal(verifyToken('', secret), null);
  assert.equal(verifyToken('not.a.token', secret), null);
  assert.equal(verifyToken(undefined, secret), null);
});
