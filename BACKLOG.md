# Storefronty — Backlog (future-only ideas)

Ideas captured so we don't lose them. **Do not build these yet** — they're deliberately deferred
until the single end-to-end loop is proven and the founder green-lights scaling.

## Sending / scale
- **Batch sending.** Once the single end-to-end test is proven (one shop → cold email → reply →
  tune → approve → send), send to ~5 qualified leads in a batch, then later 20–50 per batch.
  Respect deliverability limits (≈30–40 sends/inbox/day, see BLUEPRINT §8), inbox rotation, and the
  CAN-SPAM suppression list. **Not now.**
- **Deliverability hardening.** SPF/DKIM/DMARC on a real sending domain; warmup; per-inbox daily
  caps; spam-complaint kill-switch (<0.3%).

## Discovery / data quality
- **Non-ASCII name normalization.** `normalizeName` currently drops letters like `đ`, `ñ`, `ø`
  instead of transliterating (e.g. "đậm" → "am"). Add transliteration so token matching is robust
  for non-ASCII shop names. (Low priority for the US/English launch market.)
- **JS-render fallback engine.** The `render()` seam + cheap signals are built; the Knowledge Panel
  already closes most of the SPA gap. If a measured gap remains, plug in a real headless engine
  (Playwright or a render API) behind the existing seam — budgeted, SSRF-safe.
- **Email-discovery breadth.** Add more sources (WHOIS where permitted, Facebook Graph where
  allowed, schema.org `email`, common role-address probing with verification). Track find-rate.

## Product loop
- **AI builder.** Replace the template builder with Claude-generated, per-shop sites (Sonnet for the
  pitch, Opus for the converting polish) — see BLUEPRINT §6.
- **Dashboard (M6).** Local web UI to watch the pipeline + approve actions.
- **Payments (Stripe) + domain automation** at the known seam (BLUEPRINT §9).
