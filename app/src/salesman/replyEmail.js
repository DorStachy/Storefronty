// The reply email (Email 2), founder-approved copy (design spec §6.6). Sent after the owner replies
// and we've rebuilt + hosted their real site. TWO links: (1) the live 48h site, (2) a SIGNED
// account-claim link to our portal that pre-binds the new account to his site. Hand-typed, no emojis.
import { escapeHtml, safeUrl } from '../util/html.js';
import { signToken } from '../util/sign.js';

// A signed, tamper-proof account-claim URL unique to this lead. Creating an account THROUGH it binds
// the new account to his exact site (no "find your site" step). See spec §6.6 / §7.
export function claimUrl(lead, config) {
  const token = signToken({ leadId: lead.id, kind: 'claim' }, config.signSecret);
  const base = (config.portalBaseUrl || '').replace(/\/$/, '');
  return `${base}/claim/${token}`;
}

/**
 * composeReplyEmail(lead, { siteUrl, claimUrl, changeSummary, config }) -> { subject, text, html }
 * `siteUrl` = the live 48h preview. `claimUrl` = the signed portal account-claim link.
 * `changeSummary` = the change we applied (their own words), shown back to them.
 */
export function composeReplyEmail(lead, { siteUrl, claimUrl: claim, changeSummary = '', config }) {
  const first = lead.first_name || 'there';
  const fromName = config.mail.fromName;
  const subject = `re: a website for ${lead.name}`;
  const changes = changeSummary || 'the changes you asked for';

  const text = `Hi ${first},

Thanks for getting back to me. I made the changes you asked for — ${changes} — and your site's ready. Two links below.

Have a click through it here (it'll be up for 48 hours):
${siteUrl}

If you like it, create your account here and I'll do one more change for you, free — that's also what saves the site to you before the 48 hours are up:
${claim}

Any trouble, just reply.

${fromName}
${config.brand}
${config.postalAddress} · Reply STOP to unsubscribe`;

  const e = {
    first: escapeHtml(first), changes: escapeHtml(changes), fromName: escapeHtml(fromName),
    brand: escapeHtml(config.brand), postal: escapeHtml(config.postalAddress),
    siteHref: escapeHtml(safeUrl(siteUrl)), claimHref: escapeHtml(safeUrl(claim)),
    siteText: escapeHtml(siteUrl), claimText: escapeHtml(claim),
  };
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#262626;max-width:600px">
<p>Hi ${e.first},</p>
<p>Thanks for getting back to me. I made the changes you asked for — <i>${e.changes}</i> — and your site's ready. Two links below.</p>
<p>Have a click through it here (it'll be up for 48 hours):<br><a href="${e.siteHref}">${e.siteText}</a></p>
<p>If you like it, create your account here and I'll do one more change for you, free — that's also what saves the site to you before the 48 hours are up:<br><a href="${e.claimHref}">${e.claimText}</a></p>
<p>Any trouble, just reply.</p>
<p>${e.fromName}<br>${e.brand}</p>
<hr style="border:none;border-top:1px solid #eee;margin:18px 0">
<p style="color:#8a8278;font-size:12px">${e.postal} · Reply STOP to unsubscribe</p>
</div>`;

  return { subject, text, html };
}
