// Notifies the founder (you) by email and builds the approval message with Approve/Reject links.
// Uses the same mailer, so with no creds it writes to the dry-run outbox.
import { sendEmail } from '../mailer/index.js';
import { escapeHtml, safeUrl } from '../util/html.js';
import { signToken } from '../util/sign.js';

// Signed approve/reject URLs for the §6.5 endpoint (HMAC, POST-only action — see approval/index.js).
export function approvalUrls(lead, config) {
  const base = (config.publicBaseUrl || '').replace(/\/$/, '');
  const tok = (kind) => signToken({ leadId: lead.id, kind }, config.signSecret);
  return { approveUrl: `${base}/approve/${tok('approve')}`, rejectUrl: `${base}/reject/${tok('reject')}` };
}

// Founder approval email for a reply-driven edit: shows the change + a link to view the rebuilt site,
// plus signed approve/reject buttons. Internal (founder-facing), so light styling/icons are fine.
export function composeFounderApproval(lead, { change, previewPath, config }) {
  const { approveUrl, rejectUrl } = approvalUrls(lead, config);
  const e = {
    name: escapeHtml(lead.name), change: escapeHtml(change || ''),
    previewHref: escapeHtml(safeUrl(previewPath || '#')),
    approveUrl: escapeHtml(approveUrl), rejectUrl: escapeHtml(rejectUrl),
  };
  const subject = `[approve] ${lead.name} — change requested`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;max-width:600px">
  <p><b>${e.name}</b> replied asking for a change:</p>
  <blockquote style="border-left:3px solid #c8a24a;padding-left:12px;color:#444;margin:0 0 14px">${e.change}</blockquote>
  <p><a href="${e.previewHref}">View the rebuilt site</a></p>
  <p style="margin:18px 0">
    <a href="${e.approveUrl}" style="background:#1e8e5a;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Approve &amp; send</a>
    &nbsp;&nbsp;<a href="${e.rejectUrl}" style="color:#c0392b">Reject</a>
  </p>
  <p style="color:#888;font-size:12px">Links are signed; the action only fires when you confirm on the page.</p>
</div>`;
  const text = `${lead.name} requested: ${change}\nView: ${previewPath}\nApprove: ${approveUrl}\nReject: ${rejectUrl}`;
  return { subject, html, text };
}

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
  const subject = `[approve] ${lead.name} — change requested`;
  // Every untrusted field — lead.name (Places display string), change (customer reply), applied
  // (auto-edit summary), previewUrl (built from config but treat defensively) — passes through
  // escapeHtml; the preview href is also scheme-checked. Same XSS class the builder fix closed.
  const e = {
    name: escapeHtml(lead.name),
    change: escapeHtml(p.change || ''),
    applied: escapeHtml(p.applied || '—'),
    previewHref: escapeHtml(safeUrl(p.previewUrl || '#')),
    approveUrl: escapeHtml(approveUrl),
    rejectUrl: escapeHtml(rejectUrl),
    approvalId: escapeHtml(String(approval.id)),
  };
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;max-width:600px">
  <p><b>${e.name}</b> replied asking for a change:</p>
  <blockquote style="border-left:3px solid #c8a24a;padding-left:12px;color:#444;margin:0 0 14px">${e.change}</blockquote>
  <p>Auto-applied: <b>${e.applied}</b></p>
  <p><a href="${e.previewHref}">▶ View the updated site</a></p>
  <p style="margin:18px 0">
    <a href="${e.approveUrl}" style="background:#1e8e5a;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:bold">✓ Approve &amp; send back</a>
    &nbsp;&nbsp;<a href="${e.rejectUrl}" style="color:#c0392b">Reject</a>
  </p>
  <p style="color:#888;font-size:12px">Links work while your local server (<code>npm run serve</code>) is running.
  Or from the terminal: <code>npm run cli approve ${e.approvalId}</code></p>
</div>`;
  const text = `${lead.name} requested: ${p.change}\nAuto-applied: ${p.applied}\nUpdated site: ${p.previewUrl}\nApprove: ${approveUrl}\n(or: npm run cli approve ${approval.id})`;
  return { subject, html, text };
}
