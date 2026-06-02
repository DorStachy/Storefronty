// The Deployer: a built site -> a public URL.
// engine "local": files already live in app/public/<slug>/; we just compute the URL that the
// local static server (npm run serve) exposes. Later, engine "cloudflare-pages" uploads + returns
// the real https URL — same contract, swapped internals.
export async function deploy(lead, site, config) {
  const base = (config.publicBaseUrl || 'http://localhost:4173').replace(/\/$/, '');
  return { previewUrl: `${base}/${site.slug}/` };
}
