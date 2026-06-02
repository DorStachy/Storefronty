import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendEmail } from '../src/mailer/index.js';

const cfg = { mail: { user: 'biz@gmail.com', pass: 'app-pass', fromName: 'Michael' } };

test('dry-run when no creds: writes to the outbox, never sends', async () => {
  const r = await sendEmail({ to: 'x@y.com', subject: 's', html: '<p>h</p>', text: 't' }, { mail: { user: '', pass: '' } });
  assert.equal(r.dry, true);
  assert.match(r.id, /^dry-/);
});

test('sends on the first try via the injected transport', async () => {
  let calls = 0;
  const _transport = { sendMail: async () => { calls++; return { messageId: '<abc@gmail>' }; } };
  const r = await sendEmail({ to: 'x@y.com', subject: 's', html: '<p>h</p>', text: 't' }, cfg, { _transport, retryDelayMs: 1 });
  assert.equal(r.dry, false);
  assert.equal(r.id, '<abc@gmail>');
  assert.equal(r.attempts, 1);
  assert.equal(calls, 1);
});

test('retries a transient failure, then succeeds (bounded)', async () => {
  let calls = 0;
  const _transport = { sendMail: async () => { calls++; if (calls < 3) throw new Error('ETIMEDOUT'); return { messageId: '<ok>' }; } };
  const r = await sendEmail({ to: 'x@y.com', subject: 's', html: 'h', text: 't' }, cfg, { _transport, retries: 3, retryDelayMs: 1 });
  assert.equal(r.id, '<ok>');
  assert.equal(r.attempts, 3);
});

test('throws after exhausting retries', async () => {
  const _transport = { sendMail: async () => { throw new Error('SMTP down'); } };
  await assert.rejects(
    sendEmail({ to: 'x@y.com', subject: 's', html: 'h', text: 't' }, cfg, { _transport, retries: 2, retryDelayMs: 1 }),
    /send failed after 3 attempts.*SMTP down/);
});
