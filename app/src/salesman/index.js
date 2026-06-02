// The Salesman: composes the CAN-SPAM cold email (Email 1, design spec §5.6) and sends it.
// In test mode every email is delivered to config.mail.testRecipient (your inbox), never the real
// shop — so we can run the whole funnel safely. The corrected funnel sends THREE section
// screenshots and NO live link; the link only follows after the owner replies (Email 2).
import { sendEmail } from '../mailer/index.js';
import { composeColdEmail, nicheVariant } from './coldEmail.js';

export { composeColdEmail, nicheVariant };

export async function sendColdEmail(db, lead, config, { shots = [] } = {}) {
  const recipient = config.mail.testRecipient || lead.email;
  if (!recipient) return { skipped: 'no recipient (no test inbox + no lead email)', needsHuman: true };
  if (db.isSuppressed(recipient)) return { skipped: 'suppressed' };
  // Idempotency: if a re-tick fires deployed→emailed again, don't re-send. The orchestrator may
  // retry; the salesman is the gatekeeper.
  if (db.messagesFor(lead.id).some((m) => m.direction === 'out' && m.type === 'email1')) {
    return { skipped: 'already_emailed' };
  }

  const { subject, text, html, attachments } = composeColdEmail(lead, { shots, config });
  const res = await sendEmail({ to: recipient, subject, html, text, attachments }, config);
  db.addMessage(lead.id, { direction: 'out', type: 'email1', subject, body: text, providerId: res.id });
  return { sent: true, to: recipient, ...res };
}
