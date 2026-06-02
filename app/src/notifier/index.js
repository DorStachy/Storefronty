// Notifies the founder (you) by email and builds the approval message with Approve/Reject links.
// Uses the same mailer, so with no creds it writes to the dry-run outbox.
import { sendEmail } from '../mailer/index.js';

export async function notifyFounder({ subject, html, text }, config) {
  const to = config.mail.founderEmail || config.mail.testRecipient || config.mail.user;
  if (!to) return { skipped: 'no founder email' };
  return sendEmail({ to, subject, html, text, from: `${config.mail.fromName} <${config.mail.user || 'noreply@storefronty'}>` }, config);
}

export function composeApproval(lead, approval, config) {
  const p = approval.payloadObj || {};
  const base = (config.publicBaseUrl || '').replace(/\/$/, '');
  const approveUrl = `${base}/approve/${approval.id}`;
  const rejectUrl = `${base}/reject/${approval.id}`;
  const change = String(p.change || '').replace(/</g, '&lt;');
  const subject = `[approve] ${lead.name} — change requested`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;max-width:600px">
  <p><b>${lead.name}</b> replied asking for a change:</p>
  <blockquote style="border-left:3px solid #c8a24a;padding-left:12px;color:#444;margin:0 0 14px">${change}</blockquote>
  <p>Auto-applied: <b>${p.applied || '—'}</b></p>
  <p><a href="${p.previewUrl}">▶ View the updated site</a></p>
  <p style="margin:18px 0">
    <a href="${approveUrl}" style="background:#1e8e5a;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:bold">✓ Approve &amp; send back</a>
    &nbsp;&nbsp;<a href="${rejectUrl}" style="color:#c0392b">Reject</a>
  </p>
  <p style="color:#888;font-size:12px">Links work while your local server (<code>npm run serve</code>) is running.
  Or from the terminal: <code>npm run cli approve ${approval.id}</code></p>
</div>`;
  const text = `${lead.name} requested: ${p.change}\nAuto-applied: ${p.applied}\nUpdated site: ${p.previewUrl}\nApprove: ${approveUrl}\n(or: npm run cli approve ${approval.id})`;
  return { subject, html, text };
}
