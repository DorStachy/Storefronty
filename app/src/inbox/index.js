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

// Strip Unicode bidi/format marks. RTL clients (Hebrew/Arabic Gmail) wrap the quote-attribution line
// in LRE/RLE/PDF/LRM/RLM marks, which otherwise hide the "<email>" pattern from the quote detector.
const stripBidi = (s) => s.replace(/[‎‏‪-‮⁦-⁩]/g, '');

// Cut the quoted reply history + signature, keeping only the new message the person typed.
function stripQuotedAndSignature(body) {
  const out = [];
  for (const raw of body.split('\n')) {
    const line = stripBidi(raw);
    if (/^\s*--/.test(line)) break;                           // signature "-- " OR a MIME boundary "--xyz"
    if (/^\s*On\b.+\bwrote:\s*$/.test(line)) break;           // Gmail-style English quote header
    // The Gmail attribution in ANY language ("On <date> Name <email> wrote:", Hebrew "בתאריך … מאת
    // Name <email>:") contains an "<email…" token — a strong, language-agnostic quote-start signal that
    // a real reply body almost never contains. Match even when the address wraps before its closing ">".
    if (/<[^@\s>]+@[^@\s>]+/.test(line)) break;
    if (/^\s*-{3,}\s*Original Message\s*-{3,}/i.test(line)) break;
    if (/^\s*>/.test(line)) break;                            // quoted line — rest is history
    if (/^\s*(From|Sent|To|Subject|Content-Type|Content-Transfer-Encoding|Content-Disposition):\s/i.test(line)) break;
    out.push(raw);
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
  const found = [];
  const re = /Content-Type:\s*image\/(?:png|jpe?g|gif|webp)[^]*?\n\n/gi;
  // Our OWN cold-email section screenshots get quoted back inside the reply — never mistake them for
  // the customer's uploaded photos (this is what put the screenshots we sent onto the rebuilt site).
  // Identify them by the filenames we attach (hero/services/gallery/reviews.png) or our @storefronty
  // Content-ID. Genuine customer attachments have other names and still come through.
  const OURS = /(?:name|filename)\s*=\s*"?(?:hero|services|gallery|reviews)\.png"?|@storefronty/i;
  let m;
  while ((m = re.exec(s)) && found.length < 16) {
    if (OURS.test(m[0])) continue;                 // skip our quoted cold-email screenshots
    const rest = s.slice(m.index + m[0].length);
    const end = rest.search(/\n--/);
    const b64 = (end >= 0 ? rest.slice(0, end) : rest).replace(/[^A-Za-z0-9+/=]/g, '');
    if (b64.length > 100) {
      try { const buf = Buffer.from(b64, 'base64'); if (buf.length > 2000) found.push(buf); } catch { /* skip a bad part */ }
    }
  }
  // Dedupe identical parts, then prefer the BIG images (the owner's real photos, usually >400KB). The
  // quoted cold-email screenshots + Gmail inline thumbnails are small and drop out. Cap at 4, largest first.
  const seen = new Set();
  const uniq = found.filter((b) => { const k = `${b.length}:${b.subarray(0, 48).toString('base64')}`; if (seen.has(k)) return false; seen.add(k); return true; });
  uniq.sort((a, b) => b.length - a.length);
  const big = uniq.filter((b) => b.length > 400000);
  return (big.length ? big : uniq).slice(0, 4);
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
//
// HARDENED against a single bad message taking down the whole box: a customer often quotes the entire
// email back (several MB), and downloading that source can socket-timeout. imapflow then emits an 'error'
// EVENT — and an unhandled emitter 'error' crashes the process (HTTP + scheduler + poller) in a restart
// loop. So: (1) a no-op 'error' handler so a socket hiccup is never fatal; (2) a generous socketTimeout
// so big replies finish; (3) envelope-only listing, then a per-message source fetch wrapped in try/catch
// so one slow/huge message is skipped, not fatal; (4) every message is deduped + marked seen exactly once
// (even on failure) so nothing is ever re-processed → no re-send loop, no crash loop.
export async function poll(db, config, onReply) {
  if (!(config.mail.user && config.mail.pass)) return { polled: 0, note: 'no creds — use the CLI `reply` command to simulate' };
  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: config.mail.user, pass: config.mail.pass }, logger: false,
    greetingTimeout: 15000, socketTimeout: 180000, // 3 min: let a multi-MB quoted reply finish downloading
  });
  client.on('error', () => { /* never let a transient IMAP socket error crash the process */ });
  let handled = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      // List envelopes only (cheap), then fetch each source separately so one huge/slow message can't
      // stall or crash the whole batch.
      const targets = [];
      for await (const msg of client.fetch({ seen: false }, { envelope: true })) {
        targets.push({ uid: msg.uid, from: msg.envelope?.from?.[0]?.address?.toLowerCase(), messageId: msg.envelope?.messageId || `uid:${msg.uid}` });
      }
      for (const t of targets) {
        const markSeen = async () => { try { await client.messageFlagsAdd(t.uid, ['\\Seen'], { uid: true }); } catch { /* dedupe table is the real guard */ } };
        const lead = t.from ? db.getLeadByEmail(t.from) : null;
        if (!lead) { await markSeen(); continue; }
        if (db.replyAlreadyHandled(t.messageId)) { await markSeen(); continue; } // never process the same reply twice
        let source = null;
        try { const one = await client.fetchOne(t.uid, { source: true }, { uid: true }); source = one && one.source; }
        catch { source = null; } // download failed (timeout / too big) — give up on this one, don't crash
        if (source) {
          try {
            savePhotos(lead, source);                 // attach the owner's photos to their site (best-effort)
            await onReply(lead, extractText(source));  // the text change → handleReply → rebuild
            handled++;
          } catch { /* a processing error must still dedupe+seen below, so it never re-loops */ }
        }
        db.recordHandledReply(t.messageId, lead.id); // dedupe BEFORE we move on — success OR failure, once only
        await markSeen();
      }
    } finally {
      lock.release();
    }
  } catch (e) {
    return { polled: handled, error: String((e && e.message) || e).split('\n')[0] };
  } finally {
    await client.logout().catch(() => { /* best-effort */ });
  }
  return { polled: handled };
}
