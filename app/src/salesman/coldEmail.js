// The cold email (Email 1), founder-approved copy (design spec §5.6). Hand-typed voice, no emojis,
// no AI tells. The corrected funnel sends THREE section screenshots and NO live link — the link only
// comes after the owner replies (Email 2). CAN-SPAM: real identity + US postal address + working
// unsubscribe. Per-niche "family" variants change ONLY two phrases (the action phrase + services/menu
// wording); every other sentence is the approved copy, verbatim.
import { escapeHtml } from '../util/html.js';

// niche family -> the two phrases that vary. Order matters (first match wins).
const FAMILIES = [
  { match: /barber|salon|beauty|spa|tattoo|nail|lash|brow|wax/, action: 'walk in or book', servicesWord: 'services' },
  { match: /restaurant|steakhouse|bar|lounge|fine dining|dining|grill|pizz|taqueria|bbq|barbecue/, action: 'walk in or book a table', servicesWord: 'menu' },
  { match: /cafe|coffee|bakery|food truck|truck|deli|juice|smoothie|creamery|ice cream/, action: 'walk in', servicesWord: 'menu' },
  { match: /gym|fitness|studio|yoga|pilates|crossfit|martial|dance/, action: 'walk in or sign up', servicesWord: 'services' },
  { match: /plumb|electric|landscap|clean|auto|mechanic|contractor|trade|repair|hvac|roof|handyman|detailing/, action: 'find you and get in touch', servicesWord: 'services' },
];

export function nicheVariant(niche) {
  const n = String(niche || '').toLowerCase();
  for (const f of FAMILIES) if (f.match.test(n)) return { action: f.action, servicesWord: f.servicesWord };
  return { action: 'walk in or book', servicesWord: 'services' }; // default (approved base wording)
}

// Human label for a screenshot section (matches the §5.6 "[ the top of the site ] ..." line).
function shotLabel(name, servicesWord) {
  if (name === 'hero') return 'the top of the site';
  if (name === 'services') return `your ${servicesWord}`;
  if (name === 'reviews') return 'your reviews';
  if (name === 'gallery') return 'a look inside';
  return name;
}

/**
 * composeColdEmail(lead, { shots, config }) -> { subject, text, html, attachments }
 * `shots` = [{ name:'hero'|'services'|'reviews'|'gallery', path }] (0–3). Each becomes an inline
 * cid image in the HTML + an attachment. The text/plain part lists the labels (it can't show images).
 */
export function composeColdEmail(lead, { shots = [], config }) {
  const first = lead.first_name || 'there';
  const fromName = config.mail.fromName;
  const v = nicheVariant(lead.niche);
  const subject = `a website for ${lead.name}`;

  const cidFor = (i) => `shot${i}@storefronty`;
  const labels = shots.map((s) => shotLabel(s.name, v.servicesWord));
  const attachments = shots.map((s, i) => ({ filename: `${s.name}.png`, path: s.path, cid: cidFor(i) }));

  // ---- text/plain (faithful to the approved copy; images noted as attached) -----------------
  const bracket = labels.length ? `\n${labels.map((l) => `[ ${l} ]`).join('   ')}\n(screenshots attached)\n` : '\n';
  const text = `Hi ${first},

My name's ${fromName} and I'm a web designer. I was looking at ${lead.name} online, saw you didn't have a website, and put one together to show you what it could look like. A few screenshots are below.
${bracket}
Everything on it is your real info: your hours, your ${v.servicesWord}, and the reviews people have left you on Google. I do these for local businesses because most don't have a proper site, and a good one makes a real difference to how many people ${v.action}.

If you'd want it, just reply and tell me what to change. The usual things people ask for:
- send me as many photos as you'd like and I'll add them in — or if it's easier, I can set up a photoshoot for you
- if you've got products or a menu, I can put together a proper menu or catalog page
- change the colors, fonts, or layout
- fix any of the wording, prices, or hours

I'll make those changes for you, so you can see I'm serious, and then send you a link to the real working site to click around and share. You're not signing up for anything.

Let me know what you think.

${fromName}
${config.brand} — websites for local businesses
${config.postalAddress} · Reply STOP to unsubscribe`;

  // ---- text/html (plain, human; the 3 screenshots inline; no salesy CTA button) -------------
  const e = {
    first: escapeHtml(first), name: escapeHtml(lead.name), fromName: escapeHtml(fromName),
    brand: escapeHtml(config.brand), postal: escapeHtml(config.postalAddress), services: escapeHtml(v.servicesWord),
    action: escapeHtml(v.action),
  };
  const imgs = shots
    .map(
      (s, i) =>
        `<figure style="margin:0 0 14px"><img src="cid:${cidFor(i)}" alt="${escapeHtml(shotLabel(s.name, v.servicesWord))}" width="600" style="width:100%;max-width:600px;border:1px solid #e5e0d8;border-radius:8px;display:block"><figcaption style="font-size:12px;color:#8a8278;margin-top:5px">${escapeHtml(shotLabel(s.name, v.servicesWord))}</figcaption></figure>`,
    )
    .join('');
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#262626;max-width:600px">
<p>Hi ${e.first},</p>
<p>My name's ${e.fromName} and I'm a web designer. I was looking at <b>${e.name}</b> online, saw you didn't have a website, and put one together to show you what it could look like. A few screenshots are below.</p>
${imgs}
<p>Everything on it is your real info: your hours, your ${e.services}, and the reviews people have left you on Google. I do these for local businesses because most don't have a proper site, and a good one makes a real difference to how many people ${e.action}.</p>
<p>If you'd want it, just reply and tell me what to change. The usual things people ask for:</p>
<ul style="margin:0 0 14px;padding-left:20px">
<li>send me as many photos as you'd like and I'll add them in — or if it's easier, I can set up a photoshoot for you</li>
<li>if you've got products or a menu, I can put together a proper menu or catalog page</li>
<li>change the colors, fonts, or layout</li>
<li>fix any of the wording, prices, or hours</li>
</ul>
<p>I'll make those changes for you, so you can see I'm serious, and then send you a link to the real working site to click around and share. You're not signing up for anything.</p>
<p>Let me know what you think.</p>
<p>${e.fromName}<br>${e.brand} — websites for local businesses</p>
<hr style="border:none;border-top:1px solid #eee;margin:18px 0">
<p style="color:#8a8278;font-size:12px">${e.postal} · Reply STOP to unsubscribe</p>
</div>`;

  return { subject, text, html, attachments };
}
