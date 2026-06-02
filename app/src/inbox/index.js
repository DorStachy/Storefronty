// Reads inbound replies. Two ways in:
//  - injectReply(): the simulated path used by `npm run cli reply <id> --text ...` and tests.
//  - poll(): real Gmail IMAP (lazy imapflow), used live once GMAIL creds are set.
// Both ultimately call the orchestrator's handleReply().

// Simulated inbound (no inbox needed) — the CLI/tests use this.
export function injectReply(text) {
  return { text };
}

// Very small text extraction from a raw RFC822 source (good enough for plain replies).
function extractText(raw) {
  const s = String(raw);
  const idx = s.indexOf('\r\n\r\n');
  const body = idx >= 0 ? s.slice(idx + 4) : s;
  return body.split(/\r?\n>/)[0].replace(/=\r?\n/g, '').slice(0, 2000).trim();
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
  await client.logout();
  return { polled: handled };
}
