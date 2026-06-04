// Portal API client. Same-origin in dev; window.STOREFRONTY_API is injected for the Cloudflare-Pages
// build so the static SPA can call the Node backend on its own host. Cookie-based session auth.
const BASE = (typeof window !== 'undefined' && window.STOREFRONTY_API) || '';

async function req(method, path, body) {
  const opts = { method, credentials: 'include', headers: {} };
  if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(BASE + path, opts);
  } catch {
    throw Object.assign(new Error('Network error — is the server running?'), { status: 0 });
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) throw Object.assign(new Error((data && data.error) || res.statusText || 'Request failed'), { status: res.status, data });
  return data;
}

export const api = {
  authConfig: () => req('GET', '/api/auth/config'),
  claim: (token) => req('POST', '/api/auth/claim', { token }),
  signup: (b) => req('POST', '/api/auth/signup', b),
  login: (b) => req('POST', '/api/auth/login', b),
  verifyEmail: (b) => req('POST', '/api/auth/verify-email', b),
  twofa: (b) => req('POST', '/api/auth/2fa', b),
  resendCode: (b) => req('POST', '/api/auth/resend', b),
  logout: () => req('POST', '/api/auth/logout'),
  me: () => req('GET', '/api/me'),
  requests: () => req('GET', '/api/requests'),
  sendRequest: (payload) => req('POST', '/api/requests', typeof payload === 'string' ? { body: payload } : payload),
  plans: () => req('GET', '/api/plans'),
  topups: () => req('GET', '/api/topups'),
  checkout: (plan) => req('POST', '/api/billing/checkout', { plan }),
  topup: (pack) => req('POST', '/api/billing/topup', { pack }),
  setDomain: (domain) => req('POST', '/api/domain', { domain }),
  verifyDomain: () => req('GET', '/api/domain/verify'),
};
