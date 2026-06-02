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
  then **real Gmail SMTP**. Suppression list enforced. `deployed → emailed`. **16 tests passing.**
- ⬜ M4 inbox+classifier · M5 editor+approvals · M6 end-to-end + dashboard · M7 ready-for-real.

**To switch from dry-run to really sending:** put `GMAIL_USER`, `GMAIL_APP_PASSWORD`, and a real
`TEST_RECIPIENT` in `app/.env`. (M4 — reading replies — needs the same test Gmail.)

Run the pipeline: `npm run research -- --niche cafe --city "Austin, TX"` then `npm run tick` then
`npm run serve` and open the printed URL.
