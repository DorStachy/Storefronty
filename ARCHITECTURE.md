# Storefronty — System Architecture & Build Plan

> **What this is:** the design for the full **autonomous outreach + site-building system**.
> **Principle:** build it to run **locally on one PC now**, but with every piece behind a clean
> interface so it can **lift to the cloud later** by swapping a provider + config — never a rewrite.
> **Human-in-the-loop:** a single `MODE` switch (`review` → `auto`). Month 1 = `review`: the founder
> approves every customer-facing message. Later = `auto`: it runs itself.

---

## 1. The mental model — an assembly line

Each "agent" is an independent **module** with a typed input → output. They never call each other
directly; they read and write a shared **database** (the single source of truth), and an
**orchestrator** moves each lead from one stage to the next. That's what makes it both testable
locally and liftable to the cloud.

```
                ┌───────────────────────── ORCHESTRATOR (state machine) ─────────────────────────┐
                │   reads/writes the DB, advances each lead, fires the next module on a tick       │
                └─────────────────────────────────────────────────────────────────────────────────┘
   RESEARCHER ─► BUILDER ─► DEPLOYER ─► SALESMAN ─►  (wait)  ─► INBOX ─► CLASSIFIER ─► EDITOR ─► (approve) ─► SALESMAN
   find shops   make site  publish    send email             read reply  tag intent   tune site   NOTIFIER     send link
   no website   +screenshot to a URL   to inbox              (IMAP poll)               regenerate  (Slack)      back
                                                                                                     ▲
                                                                                          you ✅ approve in review mode
```

### The agents (modules)

| # | Module | Job | Pluggable engine (now → later) |
|---|---|---|---|
| 1 | **researcher** | city+niche → shops with no website → `leads` | `mock` JSON → `osm` (free) → `places` (Google API) |
| 2 | **builder** | lead → finished site + screenshot | `template` (our generator) → `+ai` (Claude polish) |
| 3 | **deployer** | site → a public URL | `local` server (+tunnel) → `cloudflare-pages` |
| 4 | **salesman** | lead+preview → personalized CAN-SPAM email; sequence + follow-ups; suppression | `smtp`/Gmail (test) → ESP w/ warmed domains |
| 5 | **inbox** | poll the reply inbox for new replies | `imap` poll → provider webhooks |
| 6 | **classifier** | reply → `interested / edit_request / question / opt_out / angry` (+extract the change) | `rules` → cheap LLM |
| 7 | **editor** | edit_request → regenerate the site with the change → new preview | reuses builder |
| 8 | **notifier** | human-in-the-loop pings + approvals + daily summary | `console` → `slack` |
| 9 | **orchestrator** | the state machine + scheduler that drives all of the above | in-process + cron → real queue |
| 10 | **dashboard** *(optional)* | local web UI to watch the pipeline + approve actions | local Express page |

---

## 2. The data model (SQLite now → Postgres later)

One file, `data/storefronty.db`. The whole system's state lives here, so any module can crash/restart
and nothing is lost.

- **leads** — `id, name, niche, city, address, phone, email, instagram, has_website, vibe, source, status, created_at`
- **sites** — `id, lead_id, engine, html_path, screenshot_path, preview_url, version, created_at`
- **messages** — `id, lead_id, direction(in|out), type, subject, body, provider_id, created_at`
- **events** — `id, lead_id, type, payload_json, created_at`  *(append-only audit log of everything)*
- **suppressions** — `email, reason, created_at`  *(checked before every send, forever)*
- **approvals** — `id, lead_id, kind, payload_json, status(pending|approved|rejected), created_at, decided_at`

### Lead lifecycle (the states the orchestrator moves through)

```
discovered → built → deployed → emailed → [followup_1 → followup_2] → replied
   → classified → (edit_request → editing → pending_approval → approved → link_sent)
   → reached_pricing → paid → live
   side-exits any time: opted_out · bounced · dead(no reply after seq) · needs_human
```

---

## 3. Human-in-the-loop (the knob you asked for)

A config value **`MODE`**:
- **`review`** *(month 1)* — any **customer-facing** action (sending the tuned site back, sending the
  live link) is **paused as an `approval`** and you get a **Slack message with the before/after + the
  draft**. Nothing goes out until you tap ✅ (or edit it). You're verifying quality and teaching the
  system what "good" looks like.
- **`auto`** *(later)* — the same actions fire automatically. Internal steps (research, build, classify)
  are always automatic; only the customer-facing send is gated.

You're **always notified** on a new reply, regardless of mode.

---

## 4. Where each piece sits — now vs. the autonomous future

| Concern | 🖥️ Now (your PC) | ☁️ Later (autonomous) | How we move (no rewrite) |
|---|---|---|---|
| Runtime | Node processes + cron tick | Serverless / workers + scheduled triggers | same module code, different entry |
| Database | **SQLite** file | Managed **Postgres** (Supabase) | swap the `db` adapter |
| Orchestration | in-process loop + cron | real queue (Inngest/BullMQ) | swap the `queue` adapter |
| Lead source | `mock` JSON / OSM | Google **Places API** | swap researcher engine |
| Site builder | `template` (free) | `+ Claude` polish | swap builder engine |
| Deploy | local server + tunnel | **Cloudflare Pages** | swap deployer engine |
| Sending mail | **Gmail/SMTP** → test inbox | ESP + warmed domains, rotation | swap mailer provider |
| Reading replies | **IMAP** poll | provider webhooks | swap inbox provider |
| Notify/approve | console / **Slack** | **Slack** | same |
| Payments | *(deferred)* | **Stripe** + auto domain + deploy | new module at a known seam |

Secrets (API keys, Gmail creds, Slack token) live in a **`.env`** (git-ignored). Each provider is
chosen by config, so flipping `mock → real` or `local → cloud` is editing `.env`, not the code.

---

## 5. The end-to-end local test (the goal of the build)

One command — `npm run demo:e2e` — against a **test inbox you create**, runs the entire funnel with
**no real customers**:

1. **research** a shop (mock) → 2. **build** its site + screenshot → 3. **deploy** to a local URL →
4. **send** the real cold email to your test inbox → 5. you **reply** "make the colors navy" →
6. **inbox** reads it → 7. **classifier** tags `edit_request` + extracts the change →
8. **editor** regenerates the site → 9. (`review`) **Slack** pings you the before/after →
10. you **approve** → 11. **salesman** emails the updated link → 12. you click → the **pricing page**.

When that runs reliably, we flip providers `mock → real` and `review → auto`, and it's ready for real
customers with you only approving replies.

---

## 6. Build roadmap (each milestone ends with a working, tested slice)

| M | Deliverable | Local test that proves it |
|---|---|---|
| **M1 — Spine** | SQLite schema + orchestrator state machine + config/.env + module interfaces + `mock` researcher | a mock lead flows through states in the DB |
| **M2 — Build + Deploy** | wrap the existing generator as `builder`; `local` deployer + screenshot | lead → a live local site URL |
| **M3 — Salesman** | `smtp` mailer → CAN-SPAM email w/ screenshot; follow-up scheduler; suppression list | the email lands in your test inbox |
| **M4 — Inbox + Classify** | IMAP poll; reply → intent + extracted change | you reply, the system detects & tags it |
| **M5 — Editor + Approvals** | regenerate on edit; `review`-mode approval via Slack/console; send updated link | full edit loop, gated by your ✅ |
| **M6 — E2E + Dashboard** | the one-command `demo:e2e` + a local dashboard to watch/approve | the whole funnel runs end-to-end |
| **M7 — Ready for real** | deliverability + retries + opt-out compliance; flip `mock→real`, `review→auto` per piece | a real first customer, you in the loop |

Tech: **Node + SQLite (better-sqlite3) + nodemailer (SMTP) + imapflow (IMAP)**, tiny adapters, tests per
module. No paid services required to build/test M1–M6.

---

## 7. Open decisions before M1 (see chat)

1. **Notify/approve channel** — Slack (repo is named `beewise-slack`), email, or local dashboard first?
2. **Test sending** — a throwaway **Gmail + app password** (real send+receive) vs. a dev mail sandbox?
3. **Lead source now** — start on a **mock dataset** (fully local) and wire Google Places later?
