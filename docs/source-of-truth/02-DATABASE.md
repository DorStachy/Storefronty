# 02 — Database (Source of Truth)

> **Scope:** the complete data layer — every table, every column, the helper API the modules
> call, migrations, and the lead state machine the DB enforces.
> **Code:** [`app/src/db.js`](../../app/src/db.js), [`app/src/states.js`](../../app/src/states.js).
> **Last verified against code:** 2026-06-03.

---

## 1. What it is

One SQLite file — `app/data/storefronty.db` — is **the single source of truth** for the entire
system. Every module reads and writes it; no module calls another directly. Because all state lives
here, any module can crash or restart and nothing is lost (the orchestrator just re-runs the handler
for whatever status the lead is parked on).

- **Engine:** Node's built-in `node:sqlite` (`DatabaseSync`) — **zero npm dependency**. Requires
  Node ≥ 22; this machine runs Node 25, where `node:sqlite` is stable (no `--experimental-sqlite`
  flag needed; the CLI scripts still pass it harmlessly for older Node).
- **Journal mode:** `PRAGMA journal_mode = WAL` (write-ahead logging) — set on every open.
- **Entry point:** `openDatabase(path)` returns a handle (`api`) exposing all query helpers. Pass
  `':memory:'` for tests (the schema is created fresh in RAM). A file path auto-creates the parent
  directory.
- **Future:** the design (`ARCHITECTURE.md`) calls for swapping this adapter for managed Postgres
  later. Today everything depends only on the `api` surface below, so that swap is "reimplement
  `openDatabase`," not a rewrite.

### WAL gotcha (operational)
WAL keeps a lock on the DB file. **Do not reopen the same file from a second process while the
server holds it** — that deadlocks. (This is why the E2E test verifies persistence by reloading the
UI rather than reopening the DB after killing the server.)

---

## 2. The transaction helper

```js
db.transaction(fn)   // BEGIN → fn() → COMMIT, or ROLLBACK on throw
```

Multi-statement writes (lead + its `discovered` event, status change + its `status:*` event) run
inside `transaction()` so a failure on the second statement rolls back the first — the DB never
lands half-written. `node:sqlite` has no nested-transaction sugar, so there is a **re-entry guard**
(`inTx`): an inner `transaction()` call just runs the body and lets the outer call own the
COMMIT/ROLLBACK boundary. `insertLead`, `setStatus`, and `setSocials` all use it.

---

## 3. Tables

There are **8 tables**. `leads` is the spine; everything else hangs off `lead_id` (and, for the
portal, `account_id`).

### 3.1 `leads` — the central entity (one row per discovered shop)

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER PK | auto-increment lead id |
| `name` | TEXT NOT NULL | shop name |
| `niche` | TEXT NOT NULL | `barbershop` / `salon` / `cafe` / `restaurant` / … |
| `city` | TEXT | research city ("Austin, TX") |
| `address` | TEXT | full formatted address (parsed for street/zip downstream) |
| `phone` | TEXT | national phone (strongest identity anchor) |
| `email` | TEXT | contact email — null until email-discovery finds one |
| `instagram` | TEXT | legacy single-handle field (socials now in `socials`) |
| `has_website` | INTEGER (0/1) | the engine's first-pass signal (Places `websiteUri`, aggregator-filtered) |
| `vibe` | TEXT | primary type / category label, used as a theme hint |
| `details` | TEXT (JSON) | rich Places profile: `{summary,rating,reviewCount,priceLevel,primaryType,hours,mapsUri,lat,lng}` |
| `website` | TEXT | a confirmed own-site URL, if discovery accepted one |
| `website_status` | TEXT | `none` (confirmed no-website) / `unknown` (offline run) / … |
| `socials` | TEXT (JSON) | `{instagram?,facebook?,tiktok?}` canonical URLs (from `socials` discovery) |
| `source` | TEXT | provenance — `places:<placeId>` or `mock:…` |
| `status` | TEXT NOT NULL | the lifecycle state (§5). Default `discovered` |
| `dedup_key` | TEXT UNIQUE | idempotency key (§3.1.1) |
| `created_at` / `updated_at` | TEXT | ISO timestamps |

**3.1.1 Dedup key.** `insertLead` computes `dedup_key` = the **Google place_id** (`source`
starts with `places:`) if present, else the **email**, else `name|city` — lowercased/trimmed. A
second insert with the same key returns `{ inserted: false }` instead of a duplicate row. This is
why re-running `research` over the same city is safe.

### 3.2 `sites` — generated site versions (one row per build)

| Column | Meaning |
|---|---|
| `id`, `lead_id` | PK + owning lead |
| `slug` | URL slug under `app/public/` (e.g. `silva-s`) |
| `engine` | which builder produced it |
| `html_path` | absolute path to the rendered `index.html` on disk |
| `screenshot_path` | directory holding the 3 cold-email section screenshots |
| `preview_url` | the live URL once deployed |
| `expires_at` | the 48h preview expiry (migration-added) |
| `version` | incrementing version (default 1) |
| `created_at` | ISO timestamp |

A lead can have **many** site rows (initial build, then a rebuild after an edit request).
`getSiteForLead` returns the **most recent** (`ORDER BY id DESC`).

### 3.3 `messages` — inbound + outbound email log

`id, lead_id, direction('in'|'out'), type, subject, body, provider_id, created_at`. `type` is e.g.
`reply` (inbound), `email2` (the reply-with-link email). `provider_id` is the SMTP message id.

### 3.4 `events` — append-only audit log (the system's black box)

`id, lead_id, type, payload(JSON), created_at`. **Everything** is logged here: `discovered`,
`status:<newstate>`, `edit_request`, `socials`, `reply_noop`, `send_skipped`, `error`. This is how
`npm run lead <id>` reconstructs a lead's full history, and how the orchestrator counts consecutive
errors.

### 3.5 `suppressions` — the permanent do-not-contact list

`email PK, reason, created_at`. Checked before **every** send, forever. An `opt_out` reply writes
here immediately and deterministically (never trusted to an LLM).

### 3.6 `approvals` — human-in-the-loop gate (review mode)

`id, lead_id, kind, payload(JSON), status('pending'|'approved'|'rejected'), created_at, decided_at`.
Records a customer-facing action waiting on founder approval. (In the current flow the approval
decision is carried by signed links rather than heavily by this table; see
[05 — Email & Outreach](05-EMAIL-AND-OUTREACH.md) and [08 — Auth & Security](08-AUTH-AND-SECURITY.md).)

### 3.7 `accounts` — portal customers (Phase 3)

| Column | Default | Meaning |
|---|---|---|
| `id` | PK | account id |
| `lead_id` | | the bound site (from the signed claim link); null if signed up cold |
| `email` | UNIQUE NOT NULL | login identity (lowercased) |
| `password_hash` | | `scrypt` `salt:hash`; **null for Google-only accounts** |
| `auth_provider` | `'password'` | `password` or `google` |
| `plan` | `'none'` | `none` / `starter` / `pro` / `premium` |
| `plan_status` | `'inactive'` | `inactive` / `active` / `past_due` / `canceled` |
| `stripe_customer` | | payment-provider customer id |
| `free_change_used` | `0` | 1 once the one free post-signup change is spent |
| `extra_changes` | `0` | **bought top-up credits — never reset monthly** |

See [07 — Billing & Payments](07-BILLING-AND-PAYMENTS.md) for how `plan` + `free_change_used` +
`extra_changes` combine into the quota decision.

### 3.8 `change_requests` — portal "ask the AI to change my site" log

| Column | Default | Meaning |
|---|---|---|
| `id`, `account_id`, `lead_id` | | PK + owners |
| `body` | | the change the customer typed |
| `kind` | `'change'` | `free` (the post-signup freebie) / `change` (counts against plan quota) / `extra` (consumed a top-up credit) |
| `status` | `'queued'` | `queued` / `done` |
| `images` | | JSON array of uploaded photo paths sent with the request |
| `created_at` | | ISO timestamp |

`changeRequestsThisMonth(accountId, 'YYYY-MM')` counts only `kind = 'change'` rows for the quota
window — `free` and `extra` requests don't burn plan quota.

---

## 4. Migrations

There is no migration framework. The schema is `CREATE TABLE IF NOT EXISTS`, and later-added
columns are **guarded `ALTER TABLE` statements** that swallow the "duplicate column" error on
already-migrated DBs (SQLite has no `ADD COLUMN IF NOT EXISTS`):

```js
try { db.exec('ALTER TABLE sites ADD COLUMN expires_at TEXT'); } catch {}
try { db.exec('ALTER TABLE change_requests ADD COLUMN images TEXT'); } catch {}
try { db.exec('ALTER TABLE accounts ADD COLUMN extra_changes INTEGER DEFAULT 0'); } catch {}
```

To add a column: add it to `SCHEMA` (for fresh DBs) **and** add a guarded `ALTER` (for existing
DBs).

---

## 5. The lead state machine (`states.js`)

`setStatus` calls `assertTransition(from, to)` and **throws on an illegal edge** — the DB will not
let a lead skip or reverse a stage. This is the backbone the orchestrator drives.

### Forward edges

```
discovered → built → deployed → emailed → [followup_1 → followup_2] → replied
replied    → editing → pending_approval → approved → link_sent
link_sent  → reached_pricing → paid → live
```

Exact map (from `FORWARD` in `states.js`):

| From | Allowed → |
|---|---|
| `discovered` | `built` |
| `built` | `deployed` |
| `deployed` | `emailed` |
| `emailed` | `followup_1`, `replied` |
| `followup_1` | `followup_2`, `replied` |
| `followup_2` | `replied`, `dead` |
| `replied` | `editing`, `reached_pricing` |
| `editing` | `pending_approval`, `approved` |
| `pending_approval` | `approved`, `editing` |
| `approved` | `link_sent` |
| `link_sent` | `reached_pricing`, `replied` |
| `reached_pricing` | `paid` |
| `paid` | `live` |
| `live` | — (terminal) |

### Rules

- **Idempotent re-write:** `from === to` is always allowed (a handler can safely re-stamp the same
  status).
- **Side-exits** (`opted_out`, `bounced`, `needs_human`, `dead`) are reachable from **any
  non-terminal** state — an angry/opt-out reply, a bounce, or a QA failure can quarantine a lead at
  any point.
- **Terminal states:** `live`, `opted_out`, `dead` — no outgoing edges.

### Which module drives each edge
See [01 — End-to-End Flow](01-END-TO-END-FLOW.md). In short: the orchestrator's per-status handlers
(`discovered/built/deployed/replied/approved`) advance the forward path; `handleReply` routes
inbound replies to `replied`/`opted_out`/`needs_human`; founder approval moves
`pending_approval → approved`.

---

## 6. The helper API (what modules actually call)

`openDatabase()` returns an object with these methods. This is the **only** surface other modules
touch.

**Leads**
- `insertLead(lead) → {id, inserted}` — dedup-guarded insert; logs a `discovered` event.
- `getLead(id)`, `getLeadByEmail(email)`, `listLeads(status?)`, `countByStatus()`.

**Status + events**
- `setStatus(id, status, payload?)` — transition-checked; logs `status:<status>`.
- `recordEvent(leadId, type, payload?)`, `eventsFor(leadId)`.
- `errorsSinceLastStatus(leadId)` — consecutive `error` events since the last status change (the
  orchestrator's quarantine counter).

**Suppression**
- `addSuppression(email, reason)`, `isSuppressed(email)`.

**Sites**
- `addSite(leadId, {slug,engine,htmlPath,…})`, `getSiteForLead(leadId)` (latest),
  `setSitePreview`, `setSiteScreenshot`, `setSiteLive(siteId,{previewUrl,expiresAt})`.

**Messages**
- `addMessage(leadId, {direction,type,subject,body,providerId})`, `messagesFor(leadId)`.

**Socials**
- `setSocials(id, socials)`.

**Portal accounts** (see [06 — Portal](06-PORTAL.md), [07 — Billing](07-BILLING-AND-PAYMENTS.md))
- `addAccount({leadId,email,passwordHash,authProvider})`, `getAccount(id)`,
  `getAccountByEmail(email)`, `getAccountByLead(leadId)`.
- `setAccountPlan(id,{plan,planStatus,stripeCustomer})`, `markFreeChangeUsed(id)`,
  `addExtraChanges(id,n)`, `consumeExtraChange(id)`.

**Change requests**
- `addChangeRequest({accountId,leadId,body,kind,images})`, `changeRequestsFor(accountId)`,
  `changeRequestsThisMonth(accountId, 'YYYY-MM')`.

`raw` (the underlying `DatabaseSync`) and `close()` are also exposed.

---

## 7. Related docs
- [00 — System Overview](00-SYSTEM-OVERVIEW.md) — where the DB sits in the assembly line.
- [01 — End-to-End Flow](01-END-TO-END-FLOW.md) — the state transitions in action.
- [03 — Researcher & Discovery](03-RESEARCHER-AND-DISCOVERY.md) — what fills `leads`.
- [07 — Billing & Payments](07-BILLING-AND-PAYMENTS.md) — the `accounts` quota columns.
