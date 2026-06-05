// Free, self-hosted domain warm-up for storefronty.cc.
//
// Why this exists: a brand-new sending domain has zero reputation, so cold mail lands in spam until the
// domain has built a consistent, positively-engaged sending history (the "warm-up", normally 2–4 weeks).
// Paid tools (Mailreach/Warmy/QuickMail) do this with a network of thousands of inboxes. This is the $0
// baseline: it sends a GENTLE, RAMPING volume of plain, human-looking notes FROM michael@storefronty.cc
// (via Resend, so DKIM d=storefronty.cc — the exact path the real campaign uses) TO a seed inbox we own
// (storefronty.dev@gmail.com), then engages with them over IMAP exactly the way a happy recipient would:
// rescue from Spam → Inbox ("not spam"), mark read, and star. Those are the positive signals Gmail
// attributes to the SENDER domain.
//
// HONEST LIMITS: this is a low-diversity loop (one recipient inbox), so it is a modest baseline, not a
// substitute for a real warm-up network — its main value is building a steady, complaint-free sending
// history on the Resend path. Layer QuickMail/TrulyInbox's free network on top for diversity.
//
// SAFETY: recipients are HARDCODED to inboxes we own (the seed set). This engine can NEVER email a real
// business, no matter the lead DB. It also self-disables under the test runner (never sends for real).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Same guard the mailer uses: never send real mail from `node --test`, even with live creds loaded.
const IN_TEST = (!!process.env.NODE_TEST_CONTEXT || process.execArgv.includes('--test')) && process.env.MAIL_LIVE !== '1';

// ---- ramp schedule ------------------------------------------------------------------------------
// Daily send cap by day-of-warmup (day 1 = first day). Deliberately conservative for a single-recipient
// loop — pushing 50–75/day into ONE inbox would look unnatural; the network tool is what scales volume.
const RAMP = [
  { untilDay: 2, cap: 4 },    // days 1–2
  { untilDay: 4, cap: 8 },    // days 3–4
  { untilDay: 7, cap: 12 },   // days 5–7  (end of week 1)
  { untilDay: 14, cap: 20 },  // week 2
  { untilDay: 21, cap: 30 },  // week 3
  { untilDay: 28, cap: 40 },  // week 4
];
const STEADY_CAP = 45; // day 29+ maintenance volume

export function rampTarget(dayIndex) {
  const d = Math.max(1, Math.floor(dayIndex));
  for (const step of RAMP) if (d <= step.untilDay) return step.cap;
  return STEADY_CAP;
}

// How many to send in a single cycle, so the day's cap is spread across ~6 cycles instead of one burst.
export function decideBurst(dayCap, sentToday) {
  const remaining = Math.max(0, dayCap - sentToday);
  if (remaining === 0) return 0;
  return Math.min(remaining, Math.max(1, Math.ceil(dayCap / 6)));
}

// Whole-day difference (UTC) between two YYYY-MM-DD date strings, +1 so the start date is day 1.
export function dayIndexFor(startDateStr, nowDateStr) {
  const a = Date.parse(startDateStr + 'T00:00:00Z');
  const b = Date.parse(nowDateStr + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return 1;
  return Math.floor((b - a) / 86400000) + 1;
}

export const todayUTC = (now = new Date()) => now.toISOString().slice(0, 10);

// ---- warm-up content ----------------------------------------------------------------------------
// Plain, varied, human 1:1 notes (internal-correspondence voice — these go between our own two addresses).
// Variety matters: identical repeated bodies fingerprint as bulk. No links (a link from a cold domain is a
// spam trigger), no emojis, no marketing. Deterministic selection (indexed by a counter) — no randomness.
const SUBJECTS = [
  'notes from this morning', 'the homepage copy', 'follow-up on the pricing line', 'quick thought',
  're: the new layout', 'where we are this week', 'a draft for you to look at', 'a couple of small edits',
  'the wording on the free change', 'thinking about the intro',
];
const BODIES = [
  'Took another pass at the homepage this morning — the shorter intro reads better to me. Let me know what you think when you get a minute.',
  'Pulled the notes from this week into one place so we do not lose track of anything. Nothing urgent in there.',
  'I keep coming back to how we explain the free change. The plainer we keep it, the more people seem to trust it. Worth testing.',
  'The draft is roughly where I want it. A few rough edges left but the structure feels right now. Happy to walk through it.',
  'Small thing — I moved the contact line up so it is the first thing people see. Feels more natural reading it that way.',
  'Good week overall. The replies that come in seem to land in the right tone, so let us keep the cadence steady.',
  'Reworked the second paragraph. It was saying the same thing twice; it is tighter now and makes the point once.',
  'Had a thought on the order of the sections — reviews before the gallery might build trust earlier. Easy to try both.',
];

export function warmupMessage(n, fromName = 'Michael') {
  const subject = SUBJECTS[n % SUBJECTS.length];
  const body = BODIES[(n * 3 + 1) % BODIES.length]; // decorrelate subject/body pairing
  const text = `${body}\n\n— ${fromName}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#262626"><p>${body}</p><p>— ${fromName}</p></div>`;
  return { subject, text, html };
}

// ---- sending (Resend, seed-only) ----------------------------------------------------------------
let cachedTransport = null;
async function warmupTransport(config) {
  if (cachedTransport) return cachedTransport;
  const nodemailer = (await import('nodemailer')).default;
  cachedTransport = nodemailer.createTransport({
    host: 'smtp.resend.com', port: 465, secure: true,
    auth: { user: 'resend', pass: config.email.resendKey },
    pool: true, maxConnections: 2,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
  });
  return cachedTransport;
}

// The ONLY inboxes warm-up mail may ever be sent to (we own + control them). Hardcoded blast radius.
export function seedRecipients(config) {
  return [config.mail.user].filter(Boolean); // storefronty.dev@gmail.com (we have IMAP to engage it)
}

// Send one warm-up note. Refuses any recipient outside the seed set — a hard stop so a future bug can
// never turn this into a sender that reaches real businesses. Dry (no real send) under the test runner.
export async function sendWarmup(config, { to, n }, { _transport = null } = {}) {
  if (!seedRecipients(config).includes(to)) throw new Error(`warmup refused non-seed recipient: ${to}`);
  const msg = warmupMessage(n, config.mail.fromName);
  if (IN_TEST && !_transport) return { dry: true, to, subject: msg.subject };
  const transport = _transport || (await warmupTransport(config));
  const from = config.email.from || `${config.mail.fromName} <michael@storefronty.cc>`;
  // Reply-To = the seed Gmail (which receives), NOT the From (michael@storefronty.cc has no inbox yet).
  // So a reply — the strongest warm-up signal — threads back deliverably instead of bouncing.
  const replyTo = config.mail.user;
  const info = await transport.sendMail({ from, replyTo, to, subject: msg.subject, text: msg.text, html: msg.html });
  return { dry: false, to, subject: msg.subject, id: info.messageId };
}

// ---- engagement (IMAP) --------------------------------------------------------------------------
// Act like a recipient who wants this mail: pull storefronty.cc messages OUT of Spam into the Inbox
// ("not spam" — the strongest single positive signal), then mark them read + starred. Idempotent and
// best-effort: any IMAP hiccup returns an error field rather than throwing (mirrors the inbox poller's
// hardening so a transient socket error can never crash the server's warm-up loop).
export async function engageInbox(config) {
  if (!(config.mail.user && config.mail.pass)) return { rescued: 0, starred: 0, note: 'no imap creds' };
  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: config.mail.user, pass: config.mail.pass }, logger: false,
    greetingTimeout: 15000, socketTimeout: 60000,
  });
  client.on('error', () => { /* never let a transient IMAP error crash the warm-up loop */ });
  let rescued = 0, starred = 0;
  try {
    await client.connect();
    // 1) Rescue from Spam → Inbox. Moving a message out of [Gmail]/Spam IS the "not spam" action.
    try {
      const lock = await client.getMailboxLock('[Gmail]/Spam');
      try {
        const uids = await client.search({ from: 'storefronty.cc' }, { uid: true });
        if (uids && uids.length) { await client.messageMove(uids.join(','), 'INBOX', { uid: true }); rescued = uids.length; }
      } finally { lock.release(); }
    } catch { /* no Spam folder / locale name / nothing to rescue — fine */ }
    // 2) In the Inbox, mark unread storefronty.cc mail as read + starred (engaged-with).
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const uids = await client.search({ from: 'storefronty.cc', seen: false }, { uid: true });
        if (uids && uids.length) { await client.messageFlagsAdd(uids.join(','), ['\\Seen', '\\Flagged'], { uid: true }); starred = uids.length; }
      } finally { lock.release(); }
    } catch { /* best-effort */ }
  } catch (e) {
    return { rescued, starred, error: String((e && e.message) || e).split('\n')[0] };
  } finally {
    await client.logout().catch(() => { /* best-effort */ });
  }
  return { rescued, starred };
}

// ---- state (persisted on the data volume so restarts never double-send past the daily cap) -------
function statePath(config) { return join(dirname(config.dbPath), 'warmup-state.json'); }

export function loadState(config) {
  try { return JSON.parse(readFileSync(statePath(config), 'utf8')); }
  catch { return null; }
}
export function saveState(config, state) {
  try { mkdirSync(dirname(statePath(config)), { recursive: true }); writeFileSync(statePath(config), JSON.stringify(state, null, 2)); }
  catch { /* a failed state write just means we re-evaluate next cycle; never fatal */ }
}

// ---- orchestration ------------------------------------------------------------------------------
// One warm-up cycle: figure out today's cap, send a small burst toward it (spread across the day),
// engage the inbox, persist progress. Pure inputs (state, now, _transport, _engage) are injectable for
// tests so the send/state logic can run without opening a real IMAP socket.
export async function runCycle(config, { state, now = new Date(), _transport = null, _engage = null } = {}) {
  const day = todayUTC(now);
  let s = state || loadState(config) || { startDate: day, totalSent: 0, today: day, sentToday: 0 };
  if (s.today !== day) { s.today = day; s.sentToday = 0; } // new UTC day → reset the daily counter
  const dayIndex = dayIndexFor(s.startDate, day);
  const dayCap = rampTarget(dayIndex);
  const burst = decideBurst(dayCap, s.sentToday);

  const sends = [];
  for (let i = 0; i < burst; i++) {
    const to = seedRecipients(config)[i % Math.max(1, seedRecipients(config).length)];
    try { sends.push(await sendWarmup(config, { to, n: s.totalSent + i }, { _transport })); }
    catch (e) { sends.push({ error: String((e && e.message) || e) }); }
  }
  const sent = sends.filter((r) => r && !r.error).length;
  s.sentToday += sent; s.totalSent += sent;

  // Engage what's already arrived (this cycle's sends + any from prior cycles still unread/in spam).
  // Skipped under the test runner unless an _engage stub is injected, so tests never touch live IMAP.
  const doEngage = _engage || (!IN_TEST ? () => engageInbox(config) : null);
  const eng = doEngage ? await Promise.resolve(doEngage()).catch((e) => ({ rescued: 0, starred: 0, error: String(e.message || e) })) : { rescued: 0, starred: 0, dry: true };

  saveState(config, s);
  return { dayIndex, dayCap, sentToday: s.sentToday, totalSent: s.totalSent, sent, rescued: eng.rescued || 0, starred: eng.starred || 0, sends, engage: eng };
}
