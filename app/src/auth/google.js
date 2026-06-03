// "Log in with Google" — server-side OAuth 2.0 Authorization Code adapter. Mirrors the portal/stripe.js
// shape: pure URL/JWT helpers + an injected `fetchForm` transport so the whole flow is offline-testable,
// with a key-gated `googleLogin` convenience that wires the real SSRF-safe prod transport.
//
// SECURITY NOTE: parseIdToken DECODES (does not cryptographically verify) the id_token's payload. That is
// safe here ONLY because we receive the id_token directly from Google's token endpoint over TLS in the
// Authorization Code flow (exchangeCode POSTs our client_secret to https://oauth2.googleapis.com/token and
// reads the id_token straight out of that authenticated response). The token never passes through the
// browser/client, so there is no untrusted intermediary to forge it and no JWKS signature check is needed.
// Do NOT reuse parseIdToken on an id_token that arrived via the client (implicit flow / front-channel) —
// that path requires full JWKS signature + issuer + audience verification.
import { postForm } from '../util/net.js';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/**
 * googleAuthUrl({ clientId, redirectUri, state }) -> the Google consent-screen URL to redirect the user to.
 * Requests the openid/email/profile scopes for a one-shot (access_type=online) login and forces the
 * account chooser (prompt=select_account). `state` is the caller's CSRF/round-trip token; pass it through
 * verbatim and validate it on the callback.
 */
export function googleAuthUrl({ clientId, redirectUri, state } = {}) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    include_granted_scopes: 'true',
    prompt: 'select_account',
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * exchangeCode({ code, clientId, clientSecret, redirectUri, fetchForm }) -> the parsed Google token
 * response (which includes `id_token`, `access_token`, ...). POSTs the authorization code to Google's
 * token endpoint as application/x-www-form-urlencoded. `fetchForm(url, fields, options)` is injected
 * (tests pass a fake; prod wraps util/net.js postForm) and returns the parsed JSON response.
 */
export async function exchangeCode({ code, clientId, clientSecret, redirectUri, fetchForm } = {}) {
  if (typeof fetchForm !== 'function') throw new Error('GOOGLE_TRANSPORT_MISSING');
  const fields = {
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  };
  return fetchForm(TOKEN_ENDPOINT, fields, {});
}

// base64url -> Buffer. Restores standard-base64 padding/alphabet first so Buffer can decode it.
function decodeBase64Url(seg) {
  const norm = seg.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 === 0 ? '' : '='.repeat(4 - (norm.length % 4));
  return Buffer.from(norm + pad, 'base64');
}

/**
 * parseIdToken(idToken) -> { email, emailVerified, name, sub } from the JWT's PAYLOAD, or null if the
 * token is malformed / carries no email. DECODE ONLY — the signature is intentionally not verified (see
 * the security note at the top of this file: the id_token came straight from Google's token endpoint
 * over TLS, so it is already trusted).
 */
export function parseIdToken(idToken) {
  if (typeof idToken !== 'string') return null;
  const parts = idToken.split('.');
  if (parts.length < 2) return null; // need at least header.payload
  let payload;
  try {
    payload = JSON.parse(decodeBase64Url(parts[1]).toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object' || !payload.email) return null;
  return {
    email: payload.email,
    emailVerified: !!payload.email_verified,
    name: payload.name || '',
    sub: payload.sub || '',
  };
}

/**
 * googleLogin({ code, redirectUri, ...opts }) -> normalized profile { email, name, sub, emailVerified }.
 * Convenience that reads clientId/clientSecret from opts or GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET, THROWS
 * "GOOGLE_OAUTH not configured" if either is missing, wires the real SSRF-safe prod transport
 * (util/net.js postForm) unless `opts.fetchForm` is supplied, then exchanges the code and decodes the
 * id_token. Secrets are never logged.
 */
export async function googleLogin({ code, redirectUri, ...opts } = {}) {
  const clientId = opts.clientId ?? process.env.GOOGLE_CLIENT_ID;
  const clientSecret = opts.clientSecret ?? process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('GOOGLE_OAUTH not configured');
  const fetchForm = opts.fetchForm
    || ((url, fields, options) => postForm(url, fields, { headers: options.headers }));

  const tokens = await exchangeCode({ code, clientId, clientSecret, redirectUri, fetchForm });
  if (!tokens || typeof tokens !== 'object' || !tokens.id_token) throw new Error('GOOGLE_BAD_RESPONSE');
  const profile = parseIdToken(tokens.id_token);
  if (!profile) throw new Error('GOOGLE_BAD_ID_TOKEN');
  return profile;
}
