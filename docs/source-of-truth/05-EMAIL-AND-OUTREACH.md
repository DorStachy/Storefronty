# 05 — Email & Outreach (Source of Truth)

> **Scope:** the two customer emails, how replies are read and classified, the founder approval
> gate, the SMTP/dry-run mailer, and CAN-SPAM compliance.
> **Code:** [`salesman/`](../../app/src/salesman/), [`mailer/`](../../app/src/mailer/index.js),
> [`inbox/`](../../app/src/inbox/index.js), [`classifier/`](../../app/src/classifier/index.js),
> [`approval/`](../../app/src/approval/index.js), [`notifier/`](../../app/src/notifier/index.js).
> **Last verified against code:** 2026-06-03.

---

## 1. The two emails (and the gap between them)

The funnel was deliberately corrected to **earn the reply before showing a link**:

| | Email 1 — Cold | Email 2 — Reply |
|---|---|---|
| When | after `built → deployed` (screenshots captured) | after the owner replies + we rebuild + host |
| Carries | **3 section screenshots, NO live link** | the **live 48h site URL** + a **signed account-claim link** |
| Composer | `salesman/coldEmail.js` | `salesman/replyEmail.js` |
| Sender | the salesman (orchestrator `deployed` handler) | orchestrator `approved` handler |

In between: the owner replies → the inbox reads it → the classifier tags it → (review mode) the
founder approves → the reply email goes out. Live link only ever follows a real reply.

---

## 2. Email 1 — the cold email (`salesman/coldEmail.js`)

**Founder-approved copy, hand-typed voice — no emojis, no AI tells.** Subject: `a website for
<shop>`. The body explains "I saw you have no website, I built you one, here are screenshots, reply
and tell me what to change, I'll do it free, then I'll send the real link — you're not signing up
for anything," signed with the founder's name + brand.

- **Per-niche family variants (`nicheVariant`)** change **only two phrases** — the action phrase
  (`walk in or book` / `walk in or book a table` / `find you and get in touch` / …) and the
  services word (`services` vs `menu`). Every other sentence is the approved copy, **verbatim**.
- **3 inline screenshots:** each shot becomes a `cid:` inline image in the HTML **and** an
  attachment; the text/plain part lists the labels (`[ the top of the site ]   [ your menu ]   [ your
  reviews ]`) since it can't render images. Labels come from `shotLabel`.
- **CAN-SPAM:** real identity (`fromName` + `brand`), the US **postal address**, and a working
  unsubscribe — **"Reply STOP to unsubscribe"** (a STOP reply → `opt_out` → suppression, §6).
- Every interpolated value (`lead.name`, etc.) is `escapeHtml`'d.

### Sending it (`salesman/sendColdEmail`)
1. Recipient = `config.mail.testRecipient || lead.email`. **In test mode every email goes to your
   test inbox**, never the real shop — so the whole funnel runs safely. No recipient → `needsHuman`.
2. **Suppression check** — `db.isSuppressed(recipient)` → skip.
3. **Idempotency** — if an `email1` message already exists for the lead, skip (a re-tick of
   `deployed → emailed` must not double-send). The salesman is the gatekeeper.
4. `sendEmail(...)`, then log an `email1` message with the provider id.

---

## 3. The mailer (`mailer/index.js`) — dry-run vs live

`sendEmail({to, subject, html, text, attachments}, config)` auto-picks a transport:

- **`dry`** (no Gmail creds): writes the composed email to `app/public/_outbox/<ts>-<to>.html`
  (with a `<!-- DRY RUN -->` header noting attachments) and **does not send**. Returns
  `{id:'dry-…', dry:true, file}`.
- **`smtp`** (`GMAIL_USER` + `GMAIL_APP_PASSWORD` set): really sends via Gmail (lazy-loads
  `nodemailer`, pooled single connection, connection/socket timeouts, **bounded retry with
  exponential backoff**). Returns `{id: messageId, dry:false, attempts}`.

`closeMailer()` shuts the pooled transport down (the CLI calls it so a tick that sent exits
promptly). The transport is injectable for tests.

> **Flip to really sending:** put `GMAIL_USER`, `GMAIL_APP_PASSWORD`, and a real `TEST_RECIPIENT` in
> `app/.env`. Same `TEST_RECIPIENT` inbox is used for both sending (SMTP) and reading replies (IMAP).

---

## 4. Reading replies (`inbox/index.js`)

Two ways in, both ending at the orchestrator's `handleReply`:
- **`injectReply(text)`** — the simulated path the CLI / tests use (no inbox needed).
- **`poll(db, config, onReply)`** — real Gmail **IMAP** (lazy `imapflow`). Fetches unseen INBOX
  messages, matches each to a lead by **sender email** (`db.getLeadByEmail`), calls `onReply(lead,
  extractText(source))`, and marks the message `\Seen`. No creds → returns a "use the CLI" note.

**`extractText(raw)`** turns a raw RFC822 message into just the human-typed text: split headers,
pick the `text/plain` MIME part (decode quoted-printable; de-tag HTML as a fallback), then
**strip quoted history + signature** (`-- `, Gmail `On … wrote:`, `>` quotes, forwarded header
blocks), and cap at 2000 chars.

---

## 5. Classifying the reply (`classifier/index.js`)

`classify(text) → {intent, change}`. **Rules-based, order matters** (a cheap LLM can later replace
it behind the same signature):

1. **`opt_out`** — an explicit unsubscribe **command**: `unsubscribe`, `opt out`, `remove me`,
   `stop emailing/contacting…`, a bare `stop`. *Deliberately NOT* any sentence containing
   "stop"/"remove" — `"stop the red logo"` and `"remove the giant logo"` are **edits**.
2. **`angry`** — legal/abuse words (`scam`, `sue`, `lawyer`, `cease and desist`, `fraud`, …).
3. **`auto_reply`** — out-of-office / vacation autoresponders (don't act on a bot).
4. **`question`** — pricing questions (`how much`, `pricing`, `per month`, `how do I sign up`, …).
5. **`other`** — a pure acknowledgement ("thanks!", "got it, ok") — not an edit.
6. **`edit_request`** (default) — a substantive reply. Our email explicitly asks "tell me what to
   change," so anything else is treated as the change (`change = text`).

### Routing (orchestrator `handleReply`)
| intent | action |
|---|---|
| `opt_out` | add the address to **suppressions**, set lead `opted_out` (instant + deterministic — never trusted to an LLM) |
| `angry` | `needs_human` (reason `angry`) |
| `question` | `needs_human` (reason `pricing_question`) |
| `auto_reply` / `other` | log `reply_noop`, no state change |
| `edit_request` | record an `edit_request` event with the change, set lead `replied` (→ the tick rebuilds → QA → approval) |

Every inbound reply is also logged as an `in`/`reply` message.

---

## 6. Email 2 — the reply email (`salesman/replyEmail.js`)

Sent by the `approved` handler after the rebuilt site is hosted. Subject `re: a website for
<shop>`. Founder-approved copy, hand-typed, no emojis. **Two links:**
1. the **live 48h preview** (`siteUrl`),
2. a **signed account-claim link** (`claimUrl(lead, config)` → `/claim/<token>`, where the token is
   `signToken({leadId, kind:'claim'})`). Creating an account *through* it pre-binds the new account
   to this exact site (no "find your site" step).

The `changeSummary` (their own words) is shown back to them. Both hrefs pass through `safeUrl` +
`escapeHtml`. See [08 — Auth & Security](08-AUTH-AND-SECURITY.md) for the claim token.

---

## 7. The founder approval gate (review mode)

In **review mode**, a reply-driven edit pauses at `pending_approval` until the founder approves.

### Notify (`notifier/index.js`)
`composeFounderApproval(lead, {change, previewPath, config})` builds an internal email: the change
(blockquoted), a "View the rebuilt site" link, and **signed Approve / Reject buttons**
(`approvalUrls` → `/approve/<token>` & `/reject/<token>`, each `signToken({leadId, kind})`).
`notifyFounder` sends it to `FOUNDER_EMAIL || TEST_RECIPIENT || GMAIL_USER`. (`composeApproval` is a
legacy variant keyed by approval id + a CLI hint; the live path uses `composeFounderApproval`.)

### Act on it (`approval/index.js`)
`handleApproval({method, urlPath, db, config})` serves `/approve/<token>` and `/reject/<token>`:
- `verifyToken` must succeed **and** `payload.kind === action` **and** carry a `leadId`, else `403`.
- **`GET` shows a confirm page** with a button — **no state-changing GET**.
- **`POST` performs the action**, only when the lead is still `pending_approval`:
  - `approve` → `setStatus(lead, 'approved')` (the tick then deploys + sends Email 2),
  - `reject` → `setStatus(lead, 'needs_human', {reason:'rejected'})`.
- Already-handled leads get a friendly "already handled" page.

In **auto mode**, the `replied` handler skips this and goes straight `editing → approved`.

---

## 8. CAN-SPAM & suppression posture
- **Identity:** real sender name + brand in every email.
- **Postal address:** `config.postalAddress` in the footer of both customer emails.
- **Unsubscribe:** "Reply STOP to unsubscribe" → classified `opt_out` → written to `suppressions`
  → `opted_out`. The suppression list is checked **before every send**, forever.
- **Test safety:** in test mode all customer mail is redirected to `TEST_RECIPIENT`.

## 9. Related docs
- [04 — Site Builder](04-SITE-BUILDER.md) — produces the screenshots (Email 1) + rebuilt site (Email 2).
- [06 — Portal](06-PORTAL.md) — where the claim link lands.
- [08 — Auth & Security](08-AUTH-AND-SECURITY.md) — the HMAC-signed claim/approve/reject tokens.
- [01 — End-to-End Flow](01-END-TO-END-FLOW.md) — the full sequence.
