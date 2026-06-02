// The Salesman: composes the CAN-SPAM cold email (Email 1) and sends it.
// In test mode every email is delivered to config.mail.testRecipient (your inbox), never the
// real shop — so we can run the whole funnel safely.
import { sendEmail } from '../mailer/index.js';
import { escapeHtml, safeUrl } from '../util/html.js';

export function composeEmail1(lead, site, config) {
  const first = lead.first_name || 'there';
  const rawLink = site?.preview_url || `${config.publicBaseUrl}/`;
  const link = safeUrl(rawLink);                         // javascript: / data: rejected
  const subject = `a website for ${lead.name} 👀`;       // text/plain — not rendered as HTML

  const text = `Hi ${first},

I noticed ${lead.name} doesn't have a website yet — so I went ahead and built you one. Take a look:
${rawLink}

It's a real, working site, not a mockup. Tell me one thing you'd change — different photos, your
hours, anything — and I'll update it and send you the link again.

No catch, nothing to pay to look. Just reply and tell me what you'd tweak.

${config.mail.fromName}
${config.brand} — websites for local businesses
${config.postalAddress}
Reply STOP to unsubscribe.`;

  // Every interpolation that lands in HTML must be escaped — lead.name is untrusted (Google
  // Places display strings include arbitrary text). Same audit class as the builder fix.
  const e = {
    first: escapeHtml(first), name: escapeHtml(lead.name), link: escapeHtml(link),
    fromName: escapeHtml(config.mail.fromName), brand: escapeHtml(config.brand),
    postal: escapeHtml(config.postalAddress),
  };
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#222;max-width:560px">
  <p>Hi ${e.first},</p>
  <p>I noticed <b>${e.name}</b> doesn't have a website yet — so I went ahead and built you one. Take a look:</p>
  <p><a href="${e.link}" style="background:#c8a24a;color:#111;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">▶ View ${e.name}'s site</a></p>
  <p>It's a real, working site, not a mockup. Tell me <b>one thing</b> you'd change — different photos, your hours, anything — and I'll update it and send you the link again.</p>
  <p>No catch, nothing to pay to look. Just reply and tell me what you'd tweak 🙂</p>
  <p>${e.fromName}<br><i>${e.brand} — websites for local businesses</i></p>
  <hr style="border:none;border-top:1px solid #eee;margin:18px 0">
  <p style="color:#888;font-size:12px">${e.postal} · Reply STOP to unsubscribe.</p>
</div>`;

  return { subject, text, html };
}

export async function sendColdEmail(db, lead, config) {
  const site = db.getSiteForLead(lead.id);
  const recipient = config.mail.testRecipient || lead.email;
  if (!recipient) return { skipped: 'no recipient (no test inbox + no lead email)', needsHuman: true };
  if (db.isSuppressed(recipient)) return { skipped: 'suppressed' };
  // Idempotency: if a re-tick fires deployed→emailed again (e.g. status was rewound), don't
  // re-send. The orchestrator is allowed to retry; the salesman is the gatekeeper.
  if (db.messagesFor(lead.id).some((m) => m.direction === 'out' && m.type === 'email1')) {
    return { skipped: 'already_emailed' };
  }

  const { subject, text, html } = composeEmail1(lead, site, config);
  const res = await sendEmail({ to: recipient, subject, html, text }, config);
  db.addMessage(lead.id, { direction: 'out', type: 'email1', subject, body: text, providerId: res.id });
  return { sent: true, to: recipient, ...res };
}
