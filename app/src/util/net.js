// SSRF-hardened HTTP GET (audit CRITICAL #2). Blocks requests that resolve to private/loopback/
// link-local addresses, follows redirects MANUALLY re-validating every hop, caps body size and time.
// Note: a residual DNS-rebinding TOCTOU window exists; acceptable for our use (probing public
// business sites), and far safer than redirect:'follow' to attacker-derived domains.
import dns from 'node:dns/promises';
import net from 'node:net';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const ip2int = (ip) => ip.split('.').reduce((a, o) => ((a << 8) + Number(o)) >>> 0, 0);
const RANGES = [['10.0.0.0', '10.255.255.255'], ['172.16.0.0', '172.31.255.255'], ['192.168.0.0', '192.168.255.255'],
  ['127.0.0.0', '127.255.255.255'], ['169.254.0.0', '169.254.255.255'], ['0.0.0.0', '0.255.255.255'],
  ['100.64.0.0', '100.127.255.255']].map(([a, b]) => [ip2int(a), ip2int(b)]);

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) { const n = ip2int(ip); return RANGES.some(([a, b]) => n >= a && n <= b); }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    if (s === '::1' || s === '::') return true;
    if (s.startsWith('fe80') || s.startsWith('fc') || s.startsWith('fd')) return true;
    if (s.startsWith('::ffff:')) return isPrivateIp(s.split(':').pop()); // IPv4-mapped
    return false;
  }
  return true; // unknown → treat as unsafe
}

async function resolvesPublic(hostname) {
  if (net.isIP(hostname)) return !isPrivateIp(hostname);
  let addrs;
  try { addrs = await dns.lookup(hostname, { all: true }); } catch { return false; }
  return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
}

async function readCapped(res, maxBytes) {
  const reader = res.body?.getReader?.();
  if (!reader) return (await res.text()).slice(0, maxBytes);
  const dec = new TextDecoder(); let out = '', total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length; out += dec.decode(value, { stream: true });
    if (total >= maxBytes) { try { await reader.cancel(); } catch { /* ignore */ } break; }
  }
  return out;
}

// Returns { ok, status, finalUrl, host, contentType, body } or { ok:false, status:'<reason>' }.
export async function safeFetch(rawUrl, { timeoutMs = 8000, maxBytes = 1_500_000, maxRedirects = 5 } = {}) {
  let url;
  try { url = new URL(rawUrl); } catch { return { ok: false, status: 'BAD_URL' }; }
  for (let hop = 0; ; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, status: 'BAD_SCHEME' };
    if (!(await resolvesPublic(url.hostname))) return { ok: false, status: 'BLOCKED_PRIVATE' };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, {
        method: 'GET', redirect: 'manual', signal: ctrl.signal,
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*', 'accept-language': 'en-US,en;q=0.9' },
      });
    } catch (e) {
      clearTimeout(timer);
      return { ok: false, status: e.name === 'AbortError' ? 'TIMEOUT' : 'FAILED' };
    }
    clearTimeout(timer);
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc || hop >= maxRedirects) return { ok: false, status: 'TOO_MANY_REDIRECTS' };
      try { url = new URL(loc, url); } catch { return { ok: false, status: 'BAD_REDIRECT' }; }
      continue;
    }
    const contentType = res.headers.get('content-type') || '';
    let body = '';
    if (/html|json|text\//i.test(contentType)) body = await readCapped(res, maxBytes);
    return { ok: res.ok, status: res.status, finalUrl: url.toString(), host: url.hostname.replace(/^www\./, ''), contentType, body };
  }
}

// SSRF-safe POST-JSON for our own outbound API calls (e.g. the Gemini fill). Reuses the SAME
// private/loopback/link-local guard as safeFetch, but sends a JSON body and parses a JSON reply.
// No redirect-following (our API hosts don't 3xx); host is validated before connect. Throws on
// network/timeout/non-2xx/parse failure so callers can fall back deterministically.
export async function postJson(rawUrl, payload, { timeoutMs = 12000, maxBytes = 2_000_000, headers = {} } = {}) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('BAD_SCHEME');
  if (!(await resolvesPublic(url.hostname))) throw new Error('BLOCKED_PRIVATE');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST', redirect: 'manual', signal: ctrl.signal,
      headers: { 'user-agent': UA, 'content-type': 'application/json', accept: 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(e.name === 'AbortError' ? 'TIMEOUT' : 'FAILED');
  }
  clearTimeout(timer);
  if (!res.ok) throw new Error(`HTTP_${res.status}`);
  const text = await readCapped(res, maxBytes);
  return JSON.parse(text);
}
