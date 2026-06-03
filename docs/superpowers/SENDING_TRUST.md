# Email trust & deliverability (don't look like a scam)

Cold outreach only works if it lands in the inbox and reads as a real person. Two layers: what's in the
message (done in code) and what's set up at the domain (ops, required before scaling cold sends).

## In-message (implemented)
- **Real Reply-To** — replies reach a monitored human inbox (`mailer/index.js`). Customers can verify us by just replying.
- **List-Unsubscribe header** + visible `Reply STOP` (CAN-SPAM). Gmail/Outlook surface a one-click unsubscribe → fewer spam flags.
- **Physical mailing address** in every footer (CAN-SPAM requirement; also a legitimacy signal).
- **Hand-typed, plain copy** — no emojis, no link shorteners, no image-only emails, one or two plain links to our own domains.
- **Explicit trust paragraph** in Email 2: states we're a real person, why they got it (public Google listing, no website), how to verify (reply, or visit our site), and how to opt out. (`salesman/replyEmail.js`)
- **Test-recipient routing** — in dev/E2E every email is force-routed to the founder (`mailer/index.js`), so no real business is ever contacted while testing.

## Domain-level (REQUIRED before sending cold mail at any real volume)
Today we send via Gmail (`GMAIL_USER` + app password). For a personal `@gmail.com`, Google handles SPF/DKIM
and outreach volume is capped + risky. Before scaling cold outreach, move to a **branded domain** (e.g.
`hello@storefronty.com` via Google Workspace or a transactional ESP) and set:
- **SPF** — TXT record authorizing the sending host (`v=spf1 include:_spf.google.com ~all` for Workspace).
- **DKIM** — enable in Workspace/ESP and publish the provided TXT key; signs every message.
- **DMARC** — `v=DMARC1; p=quarantine; rua=mailto:dmarc@yourdomain` (start `p=none` to monitor, then tighten).
- **Custom return-path / tracking domain** aligned to the sending domain (DMARC alignment).
- **Warm-up** — ramp volume gradually on a new domain/IP; keep bounce + complaint rates low (suppression list already enforced in `db.addSuppression` / `isSuppressed`).

## How a customer verifies us (what we tell them)
- Reply to the email — it reaches a human (Reply-To).
- Visit the portal / our site (linked in Email 2).
- Consistent sender name + physical address + working unsubscribe.

> Cold B2B email to businesses' public addresses is legal under CAN-SPAM with accurate headers, a real
> address, and a working opt-out — all present. GDPR/CASL apply for EU/Canada contacts; keep targeting US
> local businesses (the product's market) and honor STOP immediately (already enforced).
