# 03 — Researcher & Discovery (Source of Truth)

> **Scope:** how the system finds shops with **no website** (and optionally a verified contact
> email + social handles), and the identity-anchored logic that makes those determinations
> trustworthy.
> **Code:** [`researcher/`](../../app/src/researcher/), [`discovery/`](../../app/src/discovery/index.js),
> [`search/`](../../app/src/search/index.js), [`email/`](../../app/src/email/index.js),
> [`socials/`](../../app/src/socials/index.js), [`sweep/`](../../app/src/sweep/index.js),
> [`util/text.js`](../../app/src/util/text.js), [`util/net.js`](../../app/src/util/net.js).
> **Last verified against code:** 2026-06-03.

---

## 1. The job

> *Input:* a **niche** + **city**. *Output:* `leads` rows for shops that **genuinely have no
> website** — the only kind worth pitching a site to.

The hard part is not listing shops; it's being **sure** a shop has no site. A naive name search
produces false positives (a same-named café in another state) and false negatives (a JS-only site
the crawler can't read). The whole subsystem is built around one principle:

> **Everything is identity-anchored.** A page/handle/email is only accepted as *this* shop's when
> location-unique signals (the shop's own phone, street/ZIP, Google place_id) corroborate it. A
> same-name shop elsewhere can never match, because its page won't carry *this* shop's
> phone/address/place_id.

---

## 2. Two-stage research (`researcher/index.js`)

```
engine.search(niche,city)  →  candidates  →  filter !hasWebsite  →  discoverWebsite(identity)  →  keep NO_WEBSITE
   (mock | places)            rich leads     (drop obvious sites)    (location-anchored verify)
```

1. **Engine reports candidates.** `mock` (offline fixtures) or `places` (Google Places). Each
   candidate already carries a first-pass `hasWebsite` flag.
2. **Drop the obvious-haves.** `candidates = found.filter(l => !l.hasWebsite)`.
3. **Confirm truly-no-website.** For each candidate, `discoverWebsite(buildIdentity(lead, city))`
   runs a location-anchored web check. Only `status === 'NO_WEBSITE'` survives (`website_status:
   'none'`).

**Offline fallback:** if no search key is configured (`searchFn` is null), stage 3 is skipped and
candidates pass through with `website_status: 'unknown'` — so mock/offline runs still work end to
end. (This is also why `--engine mock` needs no key.)

**`buildIdentity(lead, cityArg)`** assembles the full identity handed to discovery — never the name
alone: `{name, city, state, phone, street, zip, placeId, lat, lng, mapsUri, websiteUri}`. The
lead's own city wins over the research city; `street`/`zip` come from `parseAddress`; `placeId`
comes from `source` (`places:<id>`).

---

## 3. Engines

### 3.1 `mock` (`researcher/mock.js`)
Built-in fake shops. No API key, fully offline. Used by tests and `--engine mock`.

### 3.2 `places` — Google Places API (`researcher/places.js`)
Real shops via **Places API Text Search v1** (`POST places:searchText`). Needs `GOOGLE_PLACES_KEY`.

- **Query mapping:** `NICHE_QUERY` maps `barbershop→"barber shop"`, `salon→"hair salon"`,
  `cafe→"coffee shop"`, `restaurant→"restaurant"` (unknown niches pass through verbatim) → text
  query `"<q> in <city>"`.
- **Field mask** pulls a **rich profile** so the builder can make a tailored site: displayName,
  formattedAddress, nationalPhoneNumber, websiteUri, types, primaryTypeDisplayName, rating,
  userRatingCount, priceLevel, regularOpeningHours, editorialSummary, googleMapsUri, location.
- **`mapPlace`** shapes one result into a lead. Critically, **`hasWebsite` is true only when the
  `websiteUri` is a *non-aggregator* host.** Places often returns a linktr.ee / instagram.com /
  facebook page as `websiteUri`; that is **not** "they have their own site," so those still go
  through discovery. `details` carries the rich JSON profile (rating, hours, lat/lng, mapsUri, …).
- **Pagination:** Text Search returns ≤20/page + a `nextPageToken`; `search()` pages through (up to
  ~60) until `limit` is reached. `fetchImpl` is injectable for offline pagination tests.
- **No email:** Places has no email field — email comes from a separate discovery step (§5).

---

## 4. Web search adapter (`search/index.js`)

A single `search(query, {engine,apiKey})` over two real Google-results providers (similar names,
different products/keys):

| Engine | Endpoint | Key |
|---|---|---|
| `serper` | `POST google.serper.dev/search` | `SERPER_API_KEY` |
| `serpapi` | `GET serpapi.com/search` | `SERPAPI_KEY` |
| `mock` | — | returns empty (tests inject a search fn directly) |

Returns `{ organic: [{url,title,snippet,position}], knowledge }`. **`knowledge`** is the Google
**Knowledge Panel** — Google's own structured answer about the business, normalized to
`{website, phone, placeId, title, address}`. Its `placeId` is the key to identity-anchoring (§4.2
of discovery).

**`makeSearchFn(searchCfg)`** returns a single-arg `query → results` function bound to config, or
**`null`** when the engine is `mock` or no key is set. A null `searchFn` is the signal that disables
discovery/socials/email (they degrade to offline behavior rather than guessing).

All requests time out at 10s and throw on non-2xx so callers can surface the outage.

---

## 5. Website discovery (`discovery/index.js`) — the crown jewel

`discoverWebsite(biz, {searchFn, fetchPage, render, cfg})` returns one of three verdicts:

- **`HAS_WEBSITE`** `{website, score, reasons}` — a candidate was strong-confirmed as their own site.
- **`NO_WEBSITE`** `{reasons}` — confidently no site of their own.
- **`UNCERTAIN`** — can't tell (search failed, or a plausibly-own domain we couldn't read).

### 5.1 Candidate gathering
- Seed with the Places `websiteUri` (if any).
- If a `searchFn` exists, run up to two queries: `"<name>" <region>` and (if a phone exists)
  `"<name>" "<phone>"` (flagged `fromPhoneQuery`). Dedup candidates by host.
- A **search failure forces `searchFailed = true`** → the call can never return a confident
  `NO_WEBSITE` (it returns `UNCERTAIN`). We never claim "no website" off a broken search.

### 5.2 Knowledge-Panel authority (identity-anchored)
The Knowledge Panel is trusted **only when its `placeId` equals THIS shop's `placeId`** (Google's
own unspoofable entity id). When matched:
- a missing phone is backfilled from the panel (gives scoring its strongest anchor),
- a panel **website** (non-aggregator) → `HAS_WEBSITE` even if the page is an empty JS shell
  (closes the SPA gap with no rendering),
- a panel with **no website** → `NO_WEBSITE` (unless a plausibly-own domain stayed UNCERTAIN).

### 5.3 `parsePage(html)` → signals
Extracts: visible text + `<meta content>` + `<title>` (folded together so server-rendered SPA
metadata still counts), `tel:` numbers, JSON-LD blocks, Google Maps links, `ChIJ…` place_ids, and
`cid=` decimals.

### 5.4 `scoreCandidate(biz, cand, page)` — the scoring model

| Signal | Δscore | Class |
|---|---|---|
| shop's phone in text or `tel:` | +5, **strong** | location-unique |
| JSON-LD `telephone` == shop phone | +2, **strong** | location-unique |
| page links back to OUR place_id/cid (`maps_backref`) | +4, **strong** | owner-attested |
| ZIP present | +2 | corroboration |
| street present | +3 | corroboration |
| city present | +1 | corroboration |
| area-code match on a `tel:` | +1 | corroboration |
| bare maps link (not ours) | +1 | weak presence |
| name coverage ≥ 0.7 in title/domain | +2 | name (never enough alone) |
| distinctive token in registrable domain (`domain_token`) | +1 | name |
| `fromPhoneQuery` && SERP position 1 | +2 | name |
| JSON-LD phone **conflicts** | −4 | conflict |
| JSON-LD city **conflicts** (ours absent) | −3 | conflict |
| JSON-LD state conflicts (2-letter codes only) | −3 | conflict |

**Aggregator hosts** (`isAggregator`) score 0 and count only as "presence" — never identity. The
denylist covers Facebook, Instagram, Linktree, Yelp, TripAdvisor, OpenTable, Resy, Fresha, Booksy,
Vagaro, Google/Apple/Bing maps, DoorDash/UberEats/Grubhub, Nextdoor, Foursquare, BBB, YellowPages,
X/Twitter, TikTok, LinkedIn, YouTube, sites.google.com, business.site, wanderboat.ai, etc.

**The directory guard (hardened by a real-world finding):** rich directories (alotoday.vn,
postcard.inc, wanderboat.ai) republish a shop's *entire* Google profile — phone, address, JSON-LD,
even the place_id backlink, with the shop name in the page title. So **every** "strong" signal is
directory-spoofable **except** putting the shop's distinctive name in the page's *own registrable
domain*. Therefore: a strong/own-site accept **requires `domain_token`** — everything else only
corroborates *which* shop, not *whose* site (`strong && !domain_token → strong = false`).

### 5.5 JS-render fallback (budgeted)
If a pluggable `render(url)` is supplied and `renderBudget` (default 1) remains, discovery renders
**only** when: the candidate is plausibly the shop's own domain (name token in host), the static
page didn't already strong-confirm, and it lacked phone/back-reference anchors. The rendered DOM is
re-scored with the **same** identity rules. This catches JS-only own sites without rendering the
whole web.

### 5.6 Thresholds & verdict
`acceptScore = 6`, `uncertainScore = 3`. A candidate that is `strong && score ≥ 6` becomes the best
`HAS_WEBSITE`. A candidate scoring `≥ 3` (but not accepted) sets `uncertain`; if it's a plausibly-own
domain we couldn't read, `ownDomainUncertain` blocks a Knowledge-Panel `NO_WEBSITE`. Final order:
best accept → KG site → KG-no-site (guarded) → uncertain/presence → `NO_WEBSITE`.

---

## 6. Email discovery (`email/index.js`)

Google Places has no email, so `discoverEmail(identity, {searchFn})` searches `"<name>" <region>
email` / `… contact`, scans SERP snippets + a few fetched pages (a `fetchBudget`, default 4), and
extracts addresses (`mailto:` + regex, asset-filename false-positives stripped).

`scoreEmail(identity, email, context)` returns a **confidence** of `high` / `medium` / `none`:

- **Rejected outright:** junk locals (`no-reply`, `postmaster`, `admin`, …), junk domains
  (`example.com`, `sentry.io`, `wixpress.com`, …), **aggregator** domains, and **platform mail**
  (Fresha, Booksy, Vagaro, Square, Toast, Calendly, Shopify, … — that's the platform's email, not
  the shop's).
- **high:** the shop's distinctive name is in the email's **own domain**; OR a **free-mail**
  address (gmail/yahoo/…) whose local part carries the name, or co-located with the shop's phone.
- **medium:** a free-mail address co-located with both the shop's name **and** city.
- A `City, ST` that isn't ours (ours absent) is a **−5 conflict** → rejected.

> Rationale: a shop's real address is either on a domain bearing their name or on free webmail. A
> generic/role address on some *third-party* business domain is not theirs — even with the phone on
> the same page.

`discoverEmail` returns the best `{email, source, confidence, reasons}` or `{email: null}`.

---

## 7. Socials discovery (`socials/index.js`)

Find a shop's Instagram / Facebook / TikTok, gated by the **same** identity rules. Three tiers,
highest-confidence first:

1. **Owner-attested** — the shop's own site's JSON-LD `sameAs` + footer anchors (`socialsFromSite`).
2. **Per-platform web search** — `"<name>" <region> <platform>`.
3. **Verify** — `scoreSocial` accepts a candidate only when the handle carries the shop's
   distinctive name **and** there's no location conflict; `phone`/`city`/`linkback` corroborate.

`parseSocial` canonicalizes a URL → `{platform, handle, url}` and rejects non-profile paths
(`/p/`, `/reel/`, `/explore/`, `facebook.com/pages`, `/login`, …). **`pickBest` never guesses
between same-name rivals** with no location signal: a location-corroborated candidate always wins;
otherwise it attaches the *sole* accepted candidate, or nothing.

---

## 8. The sweep (`sweep/index.js`) — qualified, sendable leads

For real outreach you need a lead that is **both** confirmed no-website **and** has a verified
email. `sweep(db, {niches, cities, perCity, want, maxScan}, deps)` broadens across niches × cities
(paginated Places) and reports the funnel:

```
scanned → no-website → has-email → SENDABLE
```

For each candidate: skip engine-has-site → `discover` must be `NO_WEBSITE` → `discoverEmail` must
find one → persist the lead with its email + a `email_found` event, and push to `sendable`. Stops at
`want` sendables or `maxScan` scanned. Everything is dependency-injected, so the funnel is unit-
tested offline.

---

## 9. CLI

(see [00 — System Overview](00-SYSTEM-OVERVIEW.md) for all commands)

```bash
npm run research -- --city "Austin, TX" --niche barbershop --limit 10 [--engine mock|places]
npm run cli sweep -- --niches "barbershop,nail salon" --cities "Pflugerville, TX;Round Rock, TX" --want 3
npm run cli socials -- <leadId> | --all [--status <state>]
```

`research` discovery is **off** unless `SERPER_API_KEY` or `SERPAPI_KEY` is set (it says so in its
log line). `sweep`/`socials` require a search key (they cost search credits).

---

## 10. Failure & safety posture
- **Search outage ⇒ UNCERTAIN, never a false NO_WEBSITE.** We never pitch a shop that might have a
  site we just couldn't see.
- **All outbound page fetches go through `safeFetch`** (`util/net.js`): blocks private/loopback/
  link-local IPs (SSRF), follows redirects manually re-validating each hop, caps body size + time.
  See [08 — Auth & Security](08-AUTH-AND-SECURITY.md).
- **Identity over name, always.** Phone / street / ZIP / place_id are the anchors; name alone never
  accepts.

---

## 11. Related docs
- [02 — Database](02-DATABASE.md) — the `leads` columns these modules fill.
- [04 — Site Builder](04-SITE-BUILDER.md) — what consumes the enriched lead.
- [08 — Auth & Security](08-AUTH-AND-SECURITY.md) — `safeFetch` SSRF guard.
