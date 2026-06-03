// The Deployer: a built site -> a public URL, live for a bounded window (the 48h preview).
// engine "local": files already live in app/public/<slug>/; we compute the URL the local static
// server (npm run serve) exposes. engine "cloudflare": real Cloudflare Workers + KV-TTL expiry —
// same contract, swapped internals — wired once CLOUDFLARE_API_TOKEN is provided.
import { join } from 'node:path';
import { PUBLIC_DIR } from '../builder/build2.js';
import { publishPreview } from './cloudflare.js';

export async function deploy(lead, site, config) {
  const engine = config.hosting?.engine || 'local';
  const hours = config.hosting?.previewHours || 48;
  const expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();

  if (engine === 'cloudflare') {
    // Publish the built site as one self-contained HTML into Cloudflare KV with a native 48h TTL
    // (auto-expires, no cleanup job). The Worker (worker/preview.js) serves it at <host>/<slug>/.
    const cf = config.cloudflare || {};
    await publishPreview(join(PUBLIC_DIR, site.slug), site.slug, {
      accountId: cf.accountId, apiToken: cf.apiToken, namespaceId: cf.kvNamespace, ttlSeconds: hours * 3600,
    });
    return { previewUrl: `${cf.previewHost || ''}/${site.slug}/`, expiresAt, engine: 'cloudflare' };
  }

  const base = (config.publicBaseUrl || 'http://localhost:4173').replace(/\/$/, '');
  return { previewUrl: `${base}/${site.slug}/`, expiresAt, engine: 'local' };
}
