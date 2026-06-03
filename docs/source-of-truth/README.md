# Storefronty — Source of Truth

The authoritative reference for **what the Storefronty code actually does** (verified against source,
not the original design plan). Start with **[00 — System Overview](00-SYSTEM-OVERVIEW.md)**, which is
also the index.

| # | Doc | Read it for |
|---|---|---|
| 00 | [System Overview](00-SYSTEM-OVERVIEW.md) | the mental model, tech stack, module map, how to run, status — **start here** |
| 01 | [End-to-End Flow](01-END-TO-END-FLOW.md) | the one canonical narrative, step by step with state transitions |
| 02 | [Database](02-DATABASE.md) | every table + column, the helper API, the lead state machine |
| 03 | [Researcher & Discovery](03-RESEARCHER-AND-DISCOVERY.md) | how no-website shops are found + identity-verified |
| 04 | [Site Builder](04-SITE-BUILDER.md) | lead → themed site (contract, fill, QA, screenshots, deploy) |
| 05 | [Email & Outreach](05-EMAIL-AND-OUTREACH.md) | the two emails, replies, classification, approval, CAN-SPAM |
| 06 | [Portal](06-PORTAL.md) | the SPA, the AI change console, dashboard, account, theming |
| 07 | [Billing & Payments](07-BILLING-AND-PAYMENTS.md) | plans, quota, top-ups, Stripe + Paddle |
| 08 | [Auth & Security](08-AUTH-AND-SECURITY.md) | signed tokens, sessions, Google OAuth, SSRF, escaping |

> These docs were verified against the codebase on **2026-06-03**. Each doc has a "Last verified
> against code" date and links to the exact source files. When the code changes, update the matching
> doc (and its date).
