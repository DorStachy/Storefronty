import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  googleAuthUrl,
  exchangeCode,
  parseIdToken,
  googleLogin,
} from '../src/auth/google.js';

// Build a test JWT the same way Google would shape one: base64url(header).base64url(payload).<sig>.
// We only ever decode the payload, so the header/sig can be trivial.
function makeIdToken(payload, { header = { alg: 'RS256', typ: 'JWT' }, sig = 'sig' } = {}) {
  const b64u = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
  return `${b64u(header)}.${b64u(payload)}.${sig}`;
}

test('googleAuthUrl: builds the Google consent URL with the right query params', () => {
  const url = googleAuthUrl({
    clientId: 'client-123.apps.googleusercontent.com',
    redirectUri: 'https://app.storefronty.com/auth/google/callback',
    state: 'xyz-state-789',
  });

  // Hits Google's auth endpoint.
  assert.ok(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'), 'must target the Google auth endpoint');

  // Client id is present (URL-encoded).
  assert.ok(url.includes('client_id=client-123.apps.googleusercontent.com'));

  // redirect_uri is present, URL-encoded.
  assert.ok(url.includes('redirect_uri=https%3A%2F%2Fapp.storefronty.com%2Fauth%2Fgoogle%2Fcallback'));

  // Authorization Code flow + scopes (URLSearchParams encodes spaces as '+').
  assert.ok(url.includes('response_type=code'));
  assert.ok(url.includes('scope=openid+email+profile'));

  // The round-trip state token is carried through.
  assert.ok(url.includes('state=xyz-state-789'));

  // Spec'd extras.
  assert.ok(url.includes('access_type=online'));
  assert.ok(url.includes('include_granted_scopes=true'));
  assert.ok(url.includes('prompt=select_account'));

  // Parse it back to be sure the values decode cleanly (not just substring-present).
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('redirect_uri'), 'https://app.storefronty.com/auth/google/callback');
  assert.equal(parsed.searchParams.get('scope'), 'openid email profile');
  assert.equal(parsed.searchParams.get('state'), 'xyz-state-789');
});

test('exchangeCode: POSTs the auth code to the Google token endpoint and returns the token object', async () => {
  const idToken = makeIdToken({ email: 'a@b.com', email_verified: true, name: 'A', sub: '123' });
  let captured = null;
  const fetchForm = async (url, fields, options) => {
    captured = { url, fields, options };
    return { id_token: idToken, access_token: 'x', token_type: 'Bearer', expires_in: 3599 };
  };

  const tokens = await exchangeCode({
    code: 'auth-code-abc',
    clientId: 'cid',
    clientSecret: 'csecret',
    redirectUri: 'https://app.storefronty.com/auth/google/callback',
    fetchForm,
  });

  // Returns the parsed token object verbatim (carries the id_token).
  assert.equal(tokens.id_token, idToken);
  assert.equal(tokens.access_token, 'x');

  // Correct endpoint.
  assert.equal(captured.url, 'https://oauth2.googleapis.com/token');

  // Exact token-exchange request shape.
  assert.equal(captured.fields.code, 'auth-code-abc');
  assert.equal(captured.fields.client_id, 'cid');
  assert.equal(captured.fields.client_secret, 'csecret');
  assert.equal(captured.fields.redirect_uri, 'https://app.storefronty.com/auth/google/callback');
  assert.equal(captured.fields.grant_type, 'authorization_code');
});

test('exchangeCode: throws when no transport is injected', async () => {
  await assert.rejects(
    () => exchangeCode({ code: 'c', clientId: 'i', clientSecret: 's', redirectUri: 'https://x/cb' }),
    /GOOGLE_TRANSPORT_MISSING/,
  );
});

test('parseIdToken: decodes the JWT payload into a normalized profile', () => {
  const idToken = makeIdToken({ email: 'a@b.com', email_verified: true, name: 'A', sub: '123' });
  const profile = parseIdToken(idToken);
  assert.deepEqual(profile, { email: 'a@b.com', emailVerified: true, name: 'A', sub: '123' });
});

test('parseIdToken: coerces missing/falsey fields (email_verified=false, no name/sub)', () => {
  const idToken = makeIdToken({ email: 'c@d.com', email_verified: false });
  assert.deepEqual(parseIdToken(idToken), { email: 'c@d.com', emailVerified: false, name: '', sub: '' });
});

test('parseIdToken: a malformed token returns null', () => {
  assert.equal(parseIdToken('not-a-jwt'), null); // single segment
  assert.equal(parseIdToken(''), null);
  assert.equal(parseIdToken(null), null);
  assert.equal(parseIdToken(undefined), null);
  // Valid shape but undecodable payload.
  assert.equal(parseIdToken('aaa.@@@notbase64json.sig'), null);
  // Decodes but has no email.
  const noEmail = makeIdToken({ name: 'No Email', sub: '9' });
  assert.equal(parseIdToken(noEmail), null);
});

test('googleLogin: exchanges code + decodes id_token into the profile (injected transport)', async () => {
  const idToken = makeIdToken({ email: 'founder@store.com', email_verified: true, name: 'Founder', sub: 'g-999' });
  let captured = null;
  const fetchForm = async (url, fields, options) => {
    captured = { url, fields, options };
    return { id_token: idToken, access_token: 'tok' };
  };

  const profile = await googleLogin({
    code: 'the-code',
    redirectUri: 'https://app.storefronty.com/auth/google/callback',
    clientId: 'cid-explicit',
    clientSecret: 'csecret-explicit',
    fetchForm,
  });

  assert.deepEqual(profile, { email: 'founder@store.com', name: 'Founder', sub: 'g-999', emailVerified: true });
  // Wired the code through the token exchange.
  assert.equal(captured.url, 'https://oauth2.googleapis.com/token');
  assert.equal(captured.fields.code, 'the-code');
  assert.equal(captured.fields.client_id, 'cid-explicit');
  assert.equal(captured.fields.grant_type, 'authorization_code');
});

test('googleLogin: reads client id/secret from env when not passed', async () => {
  const savedId = process.env.GOOGLE_CLIENT_ID;
  const savedSecret = process.env.GOOGLE_CLIENT_SECRET;
  process.env.GOOGLE_CLIENT_ID = 'env-cid';
  process.env.GOOGLE_CLIENT_SECRET = 'env-csecret';
  try {
    const idToken = makeIdToken({ email: 'e@n.v', email_verified: true, name: 'Env', sub: 'env-1' });
    let captured = null;
    const fetchForm = async (url, fields) => { captured = { fields }; return { id_token: idToken }; };
    const profile = await googleLogin({ code: 'c', redirectUri: 'https://x/cb', fetchForm });
    assert.deepEqual(profile, { email: 'e@n.v', name: 'Env', sub: 'env-1', emailVerified: true });
    assert.equal(captured.fields.client_id, 'env-cid');
    assert.equal(captured.fields.client_secret, 'env-csecret');
  } finally {
    if (savedId === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = savedId;
    if (savedSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET; else process.env.GOOGLE_CLIENT_SECRET = savedSecret;
  }
});

test('googleLogin: throws "GOOGLE_OAUTH not configured" when client id/secret are missing', async () => {
  const savedId = process.env.GOOGLE_CLIENT_ID;
  const savedSecret = process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  try {
    await assert.rejects(
      () => googleLogin({ code: 'c', redirectUri: 'https://x/cb', fetchForm: async () => ({ id_token: 'x' }) }),
      /GOOGLE_OAUTH not configured/,
    );
  } finally {
    if (savedId !== undefined) process.env.GOOGLE_CLIENT_ID = savedId;
    if (savedSecret !== undefined) process.env.GOOGLE_CLIENT_SECRET = savedSecret;
  }
});
