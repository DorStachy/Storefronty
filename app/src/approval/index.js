// The signed approve/reject endpoint logic (design spec §6.5). A founder-approval email carries
// /approve/<token> and /reject/<token> where <token> is an HMAC-signed {leadId, kind}. The state
// change happens ONLY on POST (no state-changing GET) — GET shows a confirm page whose button POSTs.
import { verifyToken } from '../util/sign.js';
import { escapeHtml } from '../util/html.js';

const page = (status, body) => ({ status, contentType: 'text/html; charset=utf-8', body: shell(body) });
const shell = (inner) =>
  `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Storefronty</title><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:60px auto;padding:0 20px;color:#262626;line-height:1.6">${inner}</body>`;

// /approve/<token> or /reject/<token> → { action, token }, else null (not an approval route).
export function parseApprovalPath(urlPath) {
  const m = String(urlPath || '').split('?')[0].match(/^\/(approve|reject)\/(.+)$/);
  return m ? { action: m[1], token: decodeURIComponent(m[2]) } : null;
}

function confirmHtml(action, lead, urlPath) {
  const verb = action === 'approve' ? 'Approve &amp; send' : 'Reject';
  const color = action === 'approve' ? '#1e8e5a' : '#c0392b';
  return `<h2>${verb}?</h2>
<p><b>${escapeHtml(lead.name)}</b> requested a change and the updated site is ready.</p>
<form method="POST" action="${escapeHtml(urlPath)}">
  <button type="submit" style="background:${color};color:#fff;border:0;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer">${verb}</button>
</form>
<p style="color:#8a8278;font-size:13px;margin-top:14px">This link is signed and only acts on submit.</p>`;
}

/**
 * handleApproval({ method, urlPath, db, config }) -> { status, contentType, body } | null
 * Returns null when the path isn't an approval route (so the caller falls through to static serving).
 */
export function handleApproval({ method, urlPath, db, config }) {
  const parsed = parseApprovalPath(urlPath);
  if (!parsed) return null;
  const { action, token } = parsed;

  const payload = verifyToken(token, config.signSecret);
  if (!payload || payload.kind !== action || !payload.leadId) return page(403, '<h2>Invalid or expired link.</h2>');
  const lead = db.getLead(payload.leadId);
  if (!lead) return page(404, '<h2>Not found.</h2>');

  if (method === 'GET') return page(200, confirmHtml(action, lead, urlPath));

  if (method === 'POST') {
    if (lead.status !== 'pending_approval') {
      return page(200, `<h2>Already handled.</h2><p>${escapeHtml(lead.name)} is now <b>${escapeHtml(lead.status)}</b>.</p>`);
    }
    if (action === 'approve') {
      db.setStatus(lead.id, 'approved', { via: 'endpoint' });
      return page(200, `<h2>Approved.</h2><p>${escapeHtml(lead.name)}'s site will be sent over. You can close this tab.</p>`);
    }
    db.setStatus(lead.id, 'needs_human', { reason: 'rejected', via: 'endpoint' });
    return page(200, `<h2>Rejected.</h2><p>${escapeHtml(lead.name)} moved to your review queue.</p>`);
  }
  return page(405, '<h2>Method not allowed.</h2>');
}
