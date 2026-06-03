// Cloudflare KV publisher for the free 48h preview sites. Each built site is inlined into one
// self-contained HTML and PUT into a Workers KV namespace under its slug, with a native 48h TTL
// (expiration_ttl) — so it auto-expires with zero cleanup and zero cost. The Worker (worker/preview.js)
// serves KV[slug] at <host>/<slug>/, or an "expired — claim your site" page once the key is gone.
//
// Pure REST + Bearer token (zero new deps): the Workers-KV write API. `fetchImpl` is injected for
// offline tests; prod uses global fetch.
import { inlineSite } from './inline.js';

const CF_API = 'https://api.cloudflare.com/client/v4';
export const PREVIEW_TTL_SECONDS = 48 * 60 * 60; // 172800

async function kvPut(key, value, { accountId, apiToken, namespaceId, ttlSeconds = 0, fetchImpl = fetch } = {}) {
  if (!accountId || !apiToken || !namespaceId) throw new Error('CLOUDFLARE_* not configured (need account id + API token + KV namespace)');
  let url = `${CF_API}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
  if (ttlSeconds > 0) url += `?expiration_ttl=${ttlSeconds}`;
  const res = await fetchImpl(url, {
    method: 'PUT',
    headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'text/html' },
    body: value,
  });
  if (!res || !res.ok) throw new Error(`Cloudflare KV write failed (${res ? res.status : 'no response'})`);
  return { ok: true, bytes: value.length, ttlSeconds };
}

// Publish a built site as a 48h preview (auto-expiring).
export async function publishPreview(siteDir, slug, { ttlSeconds = PREVIEW_TTL_SECONDS, ...opts } = {}) {
  return kvPut(slug, inlineSite(siteDir), { ...opts, ttlSeconds });
}

// Make a preview permanent — re-PUT without a TTL. Called when the owner claims / signs up.
export async function keepPreview(siteDir, slug, opts = {}) {
  return kvPut(slug, inlineSite(siteDir), { ...opts, ttlSeconds: 0 });
}
