// Storefronty 48h preview Worker — serves the customer preview sites from Cloudflare KV (free tier).
// Binding: PREVIEWS (the KV namespace the backend writes self-contained preview HTML into, with a
// native 48h TTL). Var: PORTAL_URL (where an expired preview's "Claim" button points).
// URL shape: https://<this-worker>.workers.dev/<slug>/  → the shop's live site, or the expired page.
//
// One Worker serves every shop; the backend just writes KV keys. Expiry is automatic (KV TTL), so
// after 48h the key is gone and we serve the "claim your site" page — which is the signup nudge.

export default {
  async fetch(request, env) {
    const slug = new URL(request.url).pathname.split('/').filter(Boolean)[0] || '';
    if (!slug) {
      return new Response('Storefronty previews.', { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    const html = await env.PREVIEWS.get(slug);
    if (html === null) {
      return new Response(expiredPage(env.PORTAL_URL || '#'), {
        status: 410,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    return new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' },
    });
  },
};

function expiredPage(portalUrl) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>This preview has expired</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#0A0E1A; color:#E8EAF0;
    font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif; text-align:center; padding:24px; }
  .card { max-width:460px; }
  .orb { width:64px; height:64px; border-radius:50%; margin:0 auto 22px;
    background:conic-gradient(from 210deg,#ff8bd0,#a78bfa,#5b8cff,#43e0ff,#ff8bd0); }
  h1 { font-size:26px; font-weight:700; letter-spacing:-.02em; margin:0 0 10px; }
  p { color:#9aa3b8; font-size:16px; line-height:1.6; margin:0 0 26px; }
  a.btn { display:inline-block; background:#5B5BF5; color:#fff; text-decoration:none; font-weight:600;
    padding:13px 26px; border-radius:999px; }
</style></head><body><div class="card">
  <div class="orb"></div>
  <h1>This preview has expired</h1>
  <p>Your Storefronty site was live for 48 hours. Want it back for good — your design, your changes, on your own domain? Claim your account and pick a plan to keep it live.</p>
  <a class="btn" href="${portalUrl}">Claim your site</a>
</div></body></html>`;
}
