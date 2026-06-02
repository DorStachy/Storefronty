# Storefronty generator (Phase 0)

Turns a list of shops into finished demo websites + the cold email you'd send + a personalized
"make it yours" pricing page — all locally, **no cost, no emails sent, no API keys**.

## Run it

```bash
cd generator
npm run generate     # build the sites from data/shops.json  (zero dependencies)
npm run serve        # open the preview at http://localhost:4173
```

Optional — real screenshots for the cold email:

```bash
npm i -D playwright && npx playwright install chromium
npm run build        # = generate + screenshot
```

(If Playwright isn't installed, everything still works; the email/dashboard just show a
"screenshot pending" placeholder.)

## How it works

- `data/shops.json` — the shop data you collect (name, niche, city, phone, services, vibe…) plus a
  `config` block (your from-name, postal address for CAN-SPAM, owner email).
- `src/generate.js` — fills the `{{token}}` templates in `../site` and writes everything to `output/`.
- `src/screenshot.js` — optional Playwright snapshots.
- `src/serve.js` — a tiny static server to preview `output/`.

## The flow you can test end-to-end

1. Add a shop to `data/shops.json` (set `niche` to `barbershop` or `cafe`).
2. `npm run generate` → a finished site appears at `output/<slug>/index.html`.
3. Open the **dashboard** (`npm run serve`) → for each shop you get **Live site**, **Email preview**, and **Pricing page**.
4. To test an **edit request**: change the shop's data (e.g. a service name or the tagline), re-run
   `npm run generate`, refresh — that's the "reply → we update it" loop, by hand.

Payments are intentionally deferred — the pricing page's buy buttons are Stripe-link placeholders.
