import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { slugFor, PUBLIC_DIR } from '../builder/build2.js';

// Reads inbound replies. Two ways in:
//  - injectReply(): the simulated path used by the CLI / tests.
//  - poll(): real Gmail IMAP (lazy imapflow), used live once GMAIL creds are set.
// Both ultimately call the orchestrator's handleReply().

// Simulated inbound (no inbox needed) — the CLI/tests use this.
export function injectReply(text) {
  return { text };
}

// Decode quoted-printable, assembling =XX bytes then interpreting as UTF-8 (so "=C3=A9" → "é").
function decodeQuotedPrintable(s) {
  const noSoft = s.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < noSoft.length; i++) {
    const m = i + 2 < noSoft.length && noSoft[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(noSoft.slice(i + 1, i + 3));
    if (m) { bytes.push(parseInt(noSoft.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(noSoft.charCodeAt(i) & 0xff);
  }
  return Buffer.from(bytes).toString('utf8');
}

// Cut the quoted reply history + signature, keeping only the new message the person typed.
function stripQuotedAndSignature(body) {
  const out = [];
  for (const line of body.split('\n')) {
    if (/^\s*--/.test(line)) break;                           // signature "-- " OR a MIME boundary "--xyz"
    if (/^\s*On\b.+\bwrote:\s*$/.test(line)) break;           // Gmail-style English quote header
    if (/<[^@>\s]+@[^>\s]+>\s*:?\s*$/.test(line)) break;      // any-language attribution ending in "<email>:"
    if (/^\s*-{3,}\s*Original Message\s*-{3,}/i.test(line)) break;
    if (/^\s*>/.test(line)) break;                            // quoted line — rest is history
    if (/^\s*(From|Sent|To|Subject|Content-Type|Content-Transfer-Encoding|Content-Disposition):\s/i.test(line)) break;
    out.push(line);
  }
  return out.join('\n');
}

// Extract the human-typed reply text from a raw RFC822 message: split headers, pick the text/plain
// MIME part (decode quoted-printable; de-tag HTML as a fallback), then strip quotes + signature.
export function extractText(raw) {
  const s = String(raw || '').replace(/\r\n/g, '\n');
  let body;
  let isHtml = false;
  // Find the message part DIRECTLY — nested-multipart-safe. A reply is often multipart/mixed wrapping a
  // multipart/alternative + image attachments, so splitting on one top-level boundary grabs the wrong
  // (outer) part and leaks raw MIME into the text. Scanning straight to the text/plain part avoids that.
  let m = /Content-Type:\s*text\/plain[^]*?\n\n/i.exec(s);
  if (!m) { m = /Content-Type:\s*text\/html[^]*?\n\n/i.exec(s); isHtml = !!m; }
  if (m) {
    const partHeaders = m[0];
    const rest = s.slice(m.index + m[0].length);
    const end = rest.search(/\n--[^\n]/); // up to the next MIME boundary line
    body = end >= 0 ? rest.slice(0, end) : rest;
    if (/quoted-printable/i.test(partHeaders)) body = decodeQuotedPrintable(body);
    if (isHtml) body = body.replace(/<[^>]+>/g, ' ');
  } else {
    const he = s.indexOf('\n\n');
    const headers = he >= 0 ? s.slice(0, he) : '';
    body = he >= 0 ? s.slice(he + 2) : s;
    if (/quoted-printable/i.test(headers)) body = decodeQuotedPrintable(body);
  }
  body = body.replace(/\[image:[^\]]*\]/gi, ' '); // strip Gmail inline-image placeholders
  return stripQuotedAndSignature(body).replace(/[ \t]+\n/g, '\n').trim().slice(0, 2000);
}

// Extract image attachments from a raw reply. A customer who replies "here are my photos" should get
// them on their site — this heuristic MIME scan pulls each image/* part's base64 body and decodes it.
// Capped at 6, each must be a non-trivial image. Best-effort: returns [] on anything unexpected.
export function extractAttachments(raw) {
  const s = String(raw || '').replace(/\r\n/g, '\n');
  const out = [];
  const re = /Content-Type:\s*image\/(?:png|jpe?g|gif|webp)[^]*?\n\n/gi;
  let m;
  while ((m = re.exec(s)) && out.length < 6) {
    const rest = s.slice(m.index + m[0].length);
    const end = rest.search(/\n--/);
    const b64 = (end >= 0 ? rest.slice(0, end) : rest).replace(/[^A-Za-z0-9+/=]/g, '');
    if (b64.length > 100) {
      try { const buf = Buffer.from(b64, 'base64'); if (buf.length > 500) out.push(buf); } catch { /* skip a bad part */ }
    }
  }
  return out;
}

// Save a reply's photos into the lead's site img dir as photo-N.jpg, so the rebuild (leadImages) renders
// them as the hero + gallery. Never throws — photos are a bonus, the text change must still go through.
function savePhotos(lead, raw) {
  try {
    const photos = extractAttachments(raw);
    if (!photos.length) return 0;
    const dir = join(PUBLIC_DIR, slugFor(lead), 'img');
    mkdirSync(dir, { recursive: true });
    photos.forEach((buf, i) => { try { writeFileSync(join(dir, `photo-${i}.jpg`), buf); } catch { /* skip */ } });
    return photos.length;
  } catch { return 0; }
}

// Real Gmail poll. Returns count handled. Matches a reply to a lead by sender email.
export async function poll(db, config, onReply) {
  if (!(config.mail.user && config.mail.pass)) return { polled: 0, note: 'no creds — use the CLI `reply` command to simulate' };
  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: config.mail.user, pass: config.mail.pass }, logger: false,
  });
  await client.connect();
  let handled = 0;
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      for await (const msg of client.fetch({ seen: false }, { envelope: true, source: true })) {
        const from = msg.envelope?.from?.[0]?.address?.toLowerCase();
        const lead = from ? db.getLeadByEmail(from) : null;
        if (lead) {
          savePhotos(lead, msg.source);                 // attach the owner's photos to their site (best-effort)
          await onReply(lead, extractText(msg.source));  // the text change → handleReply → rebuild
          await client.messageFlagsAdd(msg.uid, ['\\Seen'], { uid: true });
          handled++;
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => { /* best-effort */ });
  }
  return { polled: handled };
}
