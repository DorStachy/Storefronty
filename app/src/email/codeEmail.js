// The 6-digit code email — signup verification + login 2nd factor. Short and plain: no link to click,
// just the code (so it works for non-technical owners and can't be phished by a fake button). The code
// is numeric, but escape it anyway to keep the safe-by-default pattern.
import { escapeHtml } from '../util/html.js';

export function composeCodeEmail({ code, purpose = 'login', config }) {
  const brand = (config && config.brand) || 'Storefronty';
  const why = purpose === 'verify' ? 'confirm your email and finish setting up your account' : 'finish signing in';
  const subject = `Your ${brand} code: ${code}`;
  const text = `Your ${brand} verification code is ${code}

Enter it to ${why}. It expires in 10 minutes.
If you didn't request this, you can safely ignore this email.`;
  const c = escapeHtml(String(code));
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#262626;max-width:520px">
<p>Your ${escapeHtml(brand)} verification code is:</p>
<p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:14px 0;color:#111">${c}</p>
<p>Enter it to ${escapeHtml(why)}. It expires in 10 minutes.</p>
<p style="color:#8a8278;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
</div>`;
  return { subject, text, html };
}
