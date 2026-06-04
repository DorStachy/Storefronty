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
  const shop = lead.name || 'your shop';
  const portalBase = (config.portalBaseUrl || '').replace(/\/$/, '');

  const text = `Hi ${first},

Thanks for getting back to me — I made the changes you asked for (${changes}), and ${shop}'s new site is ready. Have a click through it; it's live for the next 48 hours:
${siteUrl}

Want your customers to see it right now? Paste that link into your Google Business Profile, in the "Website" field — it'll show on your Google listing and Maps straight away. A real 48-hour test drive on your own storefront.

When you like it, here's your private portal — claim your free account and it's yours to run:
${claim}
Inside, you can message me any change you want and I'll redesign it for you, watch it update live, and pick a plan whenever it feels right. Your next change is on me.

One honest note, so this doesn't feel out of nowhere: I'm a real person. I came across ${shop} on Google, saw you didn't have a website yet, and built this one for you to look at. Reply any time and you'll reach me directly, or see who we are at ${portalBase}. Not interested? Reply STOP and you won't hear from me again.

Talk soon,
${fromName}
${config.brand}
${config.postalAddress} · Reply STOP to unsubscribe`;

  const e = {
    first: escapeHtml(first), changes: escapeHtml(changes), fromName: escapeHtml(fromName), shop: escapeHtml(shop),
    brand: escapeHtml(config.brand), postal: escapeHtml(config.postalAddress),
    siteHref: escapeHtml(safeUrl(siteUrl)), claimHref: escapeHtml(safeUrl(claim)),
    siteText: escapeHtml(siteUrl), portalHref: escapeHtml(safeUrl(portalBase)), portalText: escapeHtml(portalBase.replace(/^https?:\/\//, '')),
  };
  const btn = 'display:inline-block;background:#5B5BF5;color:#fff;text-decoration:none;font-weight:600;padding:11px 22px;border-radius:8px';
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#262626;max-width:600px">
<p>Hi ${e.first},</p>
<p>Thanks for getting back to me — I made the changes you asked for (<i>${e.changes}</i>), and ${e.shop}'s new site is ready. Have a click through it; it's live for the next 48 hours:</p>
<p><a href="${e.siteHref}">${e.siteText}</a></p>
<p>Want your customers to see it right now? Paste that link into your Google Business Profile, in the <b>Website</b> field — it'll show on your Google listing and Maps straight away. A real 48-hour test drive on your own storefront.</p>
<p>When you like it, here's your private portal — claim your free account and it's yours to run:</p>
<p><a href="${e.claimHref}" style="${btn}">Open your private portal</a></p>
<p style="color:#5a5a5a">Inside, you can message me any change you want and I'll redesign it for you, watch it update live, and pick a plan whenever it feels right. Your next change is on me.</p>
<p style="color:#5a5a5a;font-size:14px;background:#f6f6fb;border:1px solid #ececf6;border-radius:8px;padding:12px 14px">One honest note, so this doesn't feel out of nowhere: I'm a real person. I came across ${e.shop} on Google, saw you didn't have a website yet, and built this one for you to look at. Reply any time and you'll reach me directly${e.portalText ? `, or see who we are at <a href="${e.portalHref}">${e.portalText}</a>` : ''}. Not interested? Reply STOP and you won't hear from me again.</p>
<p>Talk soon,<br>${e.fromName}<br>${e.brand}</p>
<hr style="border:none;border-top:1px solid #eee;margin:18px 0">
<p style="color:#8a8278;font-size:12px">${e.postal} · Reply STOP to unsubscribe</p>
</div>`;

  return { subject, text, html };
}

/**
 * composeUpdateEmail(lead, { siteUrl, changeSummary, config }) -> { subject, text, html }
 * A SHORT, no-claim-link confirmation for an owner who has ALREADY claimed their portal and just made a
 * change there. The portal chat is the live reply; this is a light "it's live" nudge by email too — so it
 * must never contain the account-claim link (they've claimed) and stays brief.
 */
export function composeUpdateEmail(lead, { siteUrl, changeSummary = '', config }) {
  const fromName = config.mail.fromName;
  const shop = lead.name || 'your shop';
  const subject = `${shop} — your site’s updated`;
  const changes = changeSummary || 'the change you asked for';
  const portalBase = (config.portalBaseUrl || '').replace(/\/$/, '');

  const text = `Done — I just pushed ${changes} live on ${shop}'s site. Take a look:
${siteUrl}

Want more? Open your portal and tell me in the chat — I'll redesign it and you'll watch it update live:
${portalBase}

Talk soon,
${fromName}
${config.brand}`;

  const e = {
    changes: escapeHtml(changes), fromName: escapeHtml(fromName), shop: escapeHtml(shop), brand: escapeHtml(config.brand),
    siteHref: escapeHtml(safeUrl(siteUrl)), siteText: escapeHtml(siteUrl), portalHref: escapeHtml(safeUrl(portalBase)),
  };
  const btn = 'display:inline-block;background:#5B5BF5;color:#fff;text-decoration:none;font-weight:600;padding:11px 22px;border-radius:8px';
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#262626;max-width:600px">
<p>Done — I just pushed <i>${e.changes}</i> live on ${e.shop}'s site. Take a look:</p>
<p><a href="${e.siteHref}">${e.siteText}</a></p>
<p>Want more? Open your portal and tell me in the chat — I'll redesign it and you'll watch it update live:</p>
<p><a href="${e.portalHref}" style="${btn}">Open your portal</a></p>
<p>Talk soon,<br>${e.fromName}<br>${e.brand}</p>
</div>`;

  return { subject, text, html };
}
