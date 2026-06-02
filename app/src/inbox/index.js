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
    if (/^\s*--\s*$/.test(line)) break;                       // signature delimiter "-- "
    if (/^\s*On\b.+\bwrote:\s*$/.test(line)) break;           // Gmail-style quote header
    if (/^\s*-{3,}\s*Original Message\s*-{3,}/i.test(line)) break;
    if (/^\s*>/.test(line)) break;                            // quoted line — rest is history
    if (out.length && /^\s*(From|Sent|To|Subject):\s/i.test(line)) break; // forwarded header block
    out.push(line);
  }
  return out.join('\n');
}

// Extract the human-typed reply text from a raw RFC822 message: split headers, pick the text/plain
// MIME part (decode quoted-printable; de-tag HTML as a fallback), then strip quotes + signature.
export function extractText(raw) {
  let s = String(raw || '').replace(/\r\n/g, '\n');
  const headerEnd = s.indexOf('\n\n');
  const headers = headerEnd >= 0 ? s.slice(0, headerEnd) : '';
  let body = headerEnd >= 0 ? s.slice(headerEnd + 2) : s;

  const ctype = (headers.match(/content-type:\s*([^\n]+)/i) || [])[1] || '';
  const boundary = (ctype.match(/boundary="?([^";\n]+)"?/i) || [])[1];
  if (/multipart/i.test(ctype) && boundary) {
    const parts = s.split('--' + boundary);
    const plain = parts.find((p) => /content-type:\s*text\/plain/i.test(p));
    const chosen = plain || parts.find((p) => /content-type:\s*text\/html/i.test(p)) || '';
    const pe = chosen.indexOf('\n\n');
    const partHeaders = pe >= 0 ? chosen.slice(0, pe) : '';
    body = pe >= 0 ? chosen.slice(pe + 2) : chosen;
    if (/quoted-printable/i.test(partHeaders)) body = decodeQuotedPrintable(body);
    if (/text\/html/i.test(partHeaders) && !plain) body = body.replace(/<[^>]+>/g, ' ');
  } else if (/quoted-printable/i.test(headers)) {
    body = decodeQuotedPrintable(body);
  }

  return stripQuotedAndSignature(body).replace(/[ \t]+\n/g, '\n').trim().slice(0, 2000);
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
          await onReply(lead, extractText(msg.source));
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
