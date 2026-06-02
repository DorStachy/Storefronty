// HMAC-signed tokens for tamper-proof approve/reject links (used by the M5 approval endpoint).
// A link carries `signToken({id, kind}, secret)`; the server only acts on a token that verifies,
// so the action can't be forged or guessed. SHA-256 HMAC; constant-time compare.
import { createHmac, timingSafeEqual } from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sign = (payloadB64, secret) => createHmac('sha256', secret).update(payloadB64).digest('base64url');

export function signToken(payload, secret) {
  const payloadB64 = b64url(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

export function verifyToken(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;
  const expected = sign(payloadB64, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')); } catch { return null; }
}
