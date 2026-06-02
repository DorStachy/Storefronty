// Sends email. Two transports, chosen automatically:
//  - "dry"  (no Gmail creds yet): writes the composed email to app/public/_outbox/ and does NOT send.
//  - "smtp" (GMAIL_USER + GMAIL_APP_PASSWORD set): really sends via Gmail (lazy-loads nodemailer).
// Same return shape either way, so the rest of the pipeline doesn't care which ran.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUTBOX = resolve(here, '..', '..', 'public', '_outbox');

export async function sendEmail({ to, from, subject, html, text }, config) {
  const hasCreds = config.mail?.user && config.mail?.pass;

  if (!hasCreds) {
    mkdirSync(OUTBOX, { recursive: true });
    const file = join(OUTBOX, `${Date.now()}-${(to || 'none').replace(/[^a-z0-9]/gi, '_')}.html`);
    writeFileSync(file, `<!-- DRY RUN (not sent)\n  to: ${to}\n  subject: ${subject}\n-->\n${html}`);
    return { id: `dry-${Date.now()}`, dry: true, file };
  }

  const nodemailer = (await import('nodemailer')).default;
  const transport = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: config.mail.user, pass: config.mail.pass },
  });
  const info = await transport.sendMail({
    from: from || `${config.mail.fromName} <${config.mail.user}>`,
    to, subject, html, text,
  });
  return { id: info.messageId, dry: false };
}
