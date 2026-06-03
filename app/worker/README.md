# Storefronty 48h preview Worker

Serves the customer 48h preview sites from Cloudflare KV (free). **One-time setup**, then the backend
publishes every site automatically — no manual deploy per customer, ever.

## One-time setup
1. `npm i -g wrangler` then `wrangler login` (free Cloudflare account).
2. Create the KV namespace: `wrangler kv namespace create PREVIEWS` → copy the returned `id`.
3. Paste that `id` into `wrangler.toml` (`kv_namespaces`) **and** set it as `CLOUDFLARE_KV_NAMESPACE_ID`
   in the backend env.
4. Set `PORTAL_URL` in `wrangler.toml` to your deployed portal's `/login`.
5. `wrangler deploy` → note the `https://storefronty-previews.<account>.workers.dev` URL.
6. In the **backend** env set:
   - `HOSTING_ENGINE=cloudflare`
   - `CLOUDFLARE_ACCOUNT_ID=<your account id>`
   - `CLOUDFLARE_API_TOKEN=<token with "Workers KV Storage: Edit">`
   - `CLOUDFLARE_KV_NAMESPACE_ID=<the id from step 2>`
   - `CLOUDFLARE_PREVIEW_HOST=https://storefronty-previews.<account>.workers.dev`

After that: every approved site auto-publishes to a free `…workers.dev/<slug>/` URL that **expires in
48h**; when the owner signs up, the backend drops the TTL and the site becomes **permanent**.

## How it works
- Backend → `publishPreview()` PUTs the inlined HTML to KV with `expiration_ttl=172800` (48h).
- This Worker → serves `KV[slug]` at `/<slug>/`, or the branded "expired — claim your site" page.
- Signup → `keepPreview()` re-PUTs the HTML with no TTL (permanent).
