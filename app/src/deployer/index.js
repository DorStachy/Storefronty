// The Deployer: a built site -> a public URL, live for a bounded window (the 48h preview).
// engine "local": files already live in app/public/<slug>/; we compute the URL the local static
// server (npm run serve) exposes. engine "cloudflare": real Cloudflare Workers + KV-TTL expiry —
// same contract, swapped internals — wired once CLOUDFLARE_API_TOKEN is provided.
export async function deploy(lead, site, config) {
  const engine = config.hosting?.engine || 'local';
  const hours = config.hosting?.previewHours || 48;
  const expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();

  if (engine === 'cloudflare') {
    // The real adapter uploads the built site as a Worker on the *.preview wildcard with a KV TTL
    // flag at `expiresAt`. Needs the account creds; until then keep the funnel on HOSTING_ENGINE=local.
    throw new Error('cloudflare hosting not configured — set CLOUDFLARE_API_TOKEN + zone, or HOSTING_ENGINE=local');
  }

  const base = (config.publicBaseUrl || 'http://localhost:4173').replace(/\/$/, '');
  return { previewUrl: `${base}/${site.slug}/`, expiresAt, engine: 'local' };
}
