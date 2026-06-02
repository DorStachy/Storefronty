# Storefronty pipeline (`app/`)

The autonomous research → build → email → reply → tune → approve → send system.
See `../ARCHITECTURE.md` for the full design. **Zero runtime dependencies** (Node 22 built-ins).

## Setup

```bash
cd app
cp .env.example .env     # then fill in (Google Places key, test Gmail, etc.)
```

## Commands

```bash
npm run init                                              # create the database
npm run research -- --city "Austin, TX" --niche barbershop --limit 10
npm run research -- --city "Austin, TX" --niche cafe --engine mock   # offline, no key
npm run leads                                            # list all leads + status counts
npm run lead 1                                           # show one lead + its event history
npm test                                                 # run the test suite
```

`--engine mock` uses built-in fake data (no API key, fully offline). `--engine places`
(the default in `.env`) uses the real Google Places API and needs `GOOGLE_PLACES_KEY`.

## Status — what's built

- ✅ **M1 (spine):** SQLite DB + lead state machine + event log + suppression list + the
  **Researcher** (mock + Google Places engines) + orchestrator seeding + CLI.
- ✅ **M2 (build + deploy):** **Builder** (lead → finished site + pricing page) + **Deployer**
  (local URL) + orchestrator handlers `discovered → built → deployed` + `npm run serve`.
- ✅ **Enriched data contract:** the Researcher pulls a rich profile from Google Places (real
  description, opening hours, rating, review count, price level, type) and stores it on the lead;
  the Builder uses it (real tagline, real hours, a `★ rating · N Google reviews` trust badge),
  with graceful fallback when a field is missing.
- ✅ **M3 (salesman):** composes the CAN-SPAM cold email (preview link + postal address +
  unsubscribe) and sends it — **dry-run** (writes to `public/_outbox/`) until Gmail creds are set,
  then **real Gmail SMTP**. Suppression list enforced. `deployed → emailed`. Outbound HTML is
  XSS-escaped, preview link is scheme-checked, and a per-lead idempotency guard prevents
  double-sends if a tick re-fires.
- ✅ **Hardening (audit punch-list):** SSRF-safe fetch (private/loopback/redirect-validated),
  XSS-escaped builder + salesman + notifier HTML, scheme-checked hrefs, search-API failures
  surfaced and forced to UNCERTAIN, aggregator denylist hardened (Apple/Google Maps, Wanderboat,
  etc.), Places `websiteUri` pointing at an aggregator (linktr.ee, Instagram) no longer kills the
  lead — it goes through discovery instead. Directory-listing guard: a page with your phone +
  city but no name evidence in title/domain is NOT accepted as your site. Address parsed for
  street/zip so discovery has more signal when phone is missing. **SerpApi** supported alongside
  Serper.dev (`SEARCH_ENGINE=serpapi` + `SERPAPI_KEY`). **45 tests passing.**
- ⬜ M4 inbox+classifier · M5 editor+approvals · M6 end-to-end + dashboard · M7 ready-for-real.

**To switch from dry-run to really sending:** put `GMAIL_USER`, `GMAIL_APP_PASSWORD`, and a real
`TEST_RECIPIENT` in `app/.env`. (M4 — reading replies — needs the same test Gmail.)

Run the pipeline: `npm run research -- --niche cafe --city "Austin, TX"` then `npm run tick` then
`npm run serve` and open the printed URL.
