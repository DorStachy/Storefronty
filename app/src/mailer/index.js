// Sends email. Two transports, chosen automatically:
//  - "dry"  (no Gmail creds yet): writes the composed email to app/public/_outbox/ and does NOT send.
//  - "smtp" (GMAIL_USER + GMAIL_APP_PASSWORD set): really sends via Gmail (lazy-loads nodemailer).
// Same return shape either way. Adds connection/socket timeouts, a bounded retry with backoff, and a
// reused (pooled) transport; closeMailer() shuts it down. The transport is injectable for tests.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUTBOX = resolve(here, '..', '..', 'public', '_outbox');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

let cachedTransport = null;
async function getTransport(config) {
  if (cachedTransport) return cachedTransport;
  const nodemailer = (await import('nodemailer')).default;
  const resendKey = config.email?.resendKey;
  if (resendKey) {
    // Authenticated transactional sending via Resend — SPF/DKIM/DMARC-aligned, so it lands in the inbox
    // instead of spam (which a personal gmail.com sender structurally cannot achieve). FROM must be a
    // Resend-verified domain (or "Name <onboarding@resend.dev>" for the sandbox); see MAIL_FROM. Replies
    // still route to the Gmail inbox via Reply-To, so the existing IMAP poller keeps catching them.
    cachedTransport = nodemailer.createTransport({
      host: 'smtp.resend.com', port: 465, secure: true,
      auth: { user: 'resend', pass: resendKey },
      pool: true, maxConnections: 2,
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    });
    return cachedTransport;
  }
  cachedTransport = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: config.mail.user, pass: config.mail.pass },
    pool: true, maxConnections: 1,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
  });
  return cachedTransport;
}

export function closeMailer() {
  try { cachedTransport?.close?.(); } catch { /* ignore */ }
  cachedTransport = null;
}

export async function sendEmail({ to, from, subject, html, text, attachments }, config, { _transport = null, retries = 2, retryDelayMs = 500 } = {}) {
  // Hard safety guard: when a test recipient is configured, force EVERY email to it so no real business
  // is ever contacted during dev/E2E. Central (covers all current + future callers); the per-call-site
  // `testRecipient || lead.email` checks remain as defense-in-depth. Only the address changes.
  if (config.mail?.testRecipient) to = config.mail.testRecipient;
  // Real send when EITHER an authenticated ESP (Resend) OR Gmail creds are configured.
  const hasCreds = config.email?.resendKey || (config.mail?.user && config.mail?.pass);

  if (!hasCreds && !_transport) {
    mkdirSync(OUTBOX, { recursive: true });
    const file = join(OUTBOX, `${Date.now()}-${(to || 'none').replace(/[^a-z0-9]/gi, '_')}.html`);
    const note = attachments?.length ? `\n  attachments: ${attachments.map((a) => a.filename).join(', ')}` : '';
    writeFileSync(file, `<!-- DRY RUN (not sent)\n  to: ${to}\n  subject: ${subject}${note}\n-->\n${html}`);
    return { id: `dry-${Date.now()}`, dry: true, file };
  }

  const transport = _transport || (await getTransport(config));
  // Deliverability + trust headers: a real Reply-To so a reply reaches a human, and a List-Unsubscribe
  // header so Gmail/Outlook show a native one-click unsubscribe — both reduce spam-flagging and make the
  // message read as legitimate (sender authenticity, not a phishing blast).
  const headers = config.mail?.user ? { 'List-Unsubscribe': `<mailto:${config.mail.user}?subject=unsubscribe>` } : undefined;
  // From: the ESP-verified sender (MAIL_FROM) when sending via Resend; else the Gmail identity. Reply-To
  // stays the Gmail inbox the IMAP poller reads, so replies are still caught regardless of the transport.
  const envelope = { from: from || config.email?.from || `${config.mail.fromName} <${config.mail.user}>`, replyTo: config.mail.user || undefined, to, subject, html, text, ...(headers ? { headers } : {}), ...(attachments?.length ? { attachments } : {}) };
  let lastErr;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const info = await transport.sendMail(envelope);
      return { id: info.messageId, dry: false, attempts: attempt };
    } catch (e) {
      lastErr = e;
      if (attempt <= retries) await delay(retryDelayMs * 2 ** (attempt - 1));
    }
  }
  throw new Error(`send failed after ${retries + 1} attempts: ${lastErr?.message || lastErr}`);
}
