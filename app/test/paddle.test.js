import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  verifyPaddleWebhook,
  parsePaddleEvent,
  PADDLE_API,
} from '../src/portal/paddle.js';

// Build a VALID Paddle-Signature header for a body using the same scheme the adapter verifies, so the
// test is fully self-contained (no network). Paddle signs "<ts>:<rawBody>" with HMAC-SHA256 and sends
// the header as "ts=<unixSeconds>;h1=<hexHmac>".
function signPaddle(body, secret, ts = Math.floor(Date.now() / 1000)) {
  const sig = crypto.createHmac('sha256', secret).update(`${ts}:${body}`, 'utf8').digest('hex');
  return `ts=${ts};h1=${sig}`;
}

test('PADDLE_API exposes the sandbox + production base URLs', () => {
  assert.deepEqual(PADDLE_API, {
    sandbox: 'https://sandbox-api.paddle.com',
    production: 'https://api.paddle.com',
  });
});

test('verifyPaddleWebhook: a valid signature returns the parsed event', () => {
  const secret = 'pdl_ntfset_test_secret';
  const event = {
    event_type: 'subscription.activated',
    data: { id: 'sub_1', custom_data: { accountId: '7', plan: 'pro' } },
  };
  const body = JSON.stringify(event);
  const header = signPaddle(body, secret);

  const verified = verifyPaddleWebhook(body, header, secret);
  assert.ok(verified, 'a valid signature must verify');
  assert.equal(verified.event_type, 'subscription.activated');
  assert.deepEqual(verified, event);
});

test('verifyPaddleWebhook: tolerates multiple h1 candidates in the header', () => {
  const secret = 'pdl_ntfset_test_secret';
  const event = { event_type: 'transaction.paid', data: { id: 'txn_1' } };
  const body = JSON.stringify(event);
  const ts = Math.floor(Date.now() / 1000);
  const good = crypto.createHmac('sha256', secret).update(`${ts}:${body}`, 'utf8').digest('hex');
  // First h1 is bogus, second is correct — adapter must accept on any match.
  const header = `ts=${ts};h1=${'0'.repeat(good.length)};h1=${good}`;
  assert.deepEqual(verifyPaddleWebhook(body, header, secret), event);
});

test('verifyPaddleWebhook: a tampered body returns null', () => {
  const secret = 'pdl_ntfset_test_secret';
  const body = JSON.stringify({ event_type: 'subscription.activated', data: { id: 'sub_1' } });
  const header = signPaddle(body, secret);
  // Body changed after signing => signature no longer matches.
  const tamperedBody = body.replace('sub_1', 'sub_HACKED');
  assert.equal(verifyPaddleWebhook(tamperedBody, header, secret), null);
});

test('verifyPaddleWebhook: the wrong secret returns null', () => {
  const body = JSON.stringify({ event_type: 'subscription.activated', data: { id: 'sub_1' } });
  const header = signPaddle(body, 'pdl_ntfset_real');
  assert.equal(verifyPaddleWebhook(body, header, 'pdl_ntfset_WRONG'), null);
});

test('verifyPaddleWebhook: a malformed header returns null', () => {
  const body = '{}';
  assert.equal(verifyPaddleWebhook(body, 'not-a-paddle-sig-header', 'whsec'), null);
  assert.equal(verifyPaddleWebhook(body, '', 'whsec'), null);
  // Header with a ts but no h1 is incomplete.
  assert.equal(verifyPaddleWebhook(body, 'ts=123', 'whsec'), null);
});

test('verifyPaddleWebhook: missing/garbage inputs return null', () => {
  const secret = 'pdl_ntfset_test_secret';
  const body = '{}';
  const header = signPaddle(body, secret);
  assert.equal(verifyPaddleWebhook(body, header, ''), null); // no secret
  assert.equal(verifyPaddleWebhook(body, null, secret), null); // no header
  assert.equal(verifyPaddleWebhook(null, header, secret), null); // no body
});

test('verifyPaddleWebhook: accepts a Buffer rawBody (exact signed bytes)', () => {
  const secret = 'pdl_ntfset_test_secret';
  const event = { event_type: 'subscription.created', data: { id: 'sub_buf' } };
  const body = JSON.stringify(event);
  const header = signPaddle(body, secret);
  assert.deepEqual(verifyPaddleWebhook(Buffer.from(body, 'utf8'), header, secret), event);
});

test('parsePaddleEvent: subscription.activated normalizes correctly', () => {
  const event = {
    event_type: 'subscription.activated',
    data: {
      id: 'sub_2',
      status: 'active',
      customer_id: 'ctm_ABC',
      custom_data: { accountId: '7', plan: 'pro' },
    },
  };
  assert.deepEqual(parsePaddleEvent(event), {
    type: 'subscription',
    accountId: '7',
    plan: 'pro',
    status: 'active',
    customerId: 'ctm_ABC',
  });
});

test('parsePaddleEvent: subscription.canceled carries a canceled status', () => {
  const event = {
    event_type: 'subscription.canceled',
    data: { id: 'sub_3', status: 'canceled', customer_id: 'ctm_X', custom_data: { accountId: '7', plan: 'pro' } },
  };
  const norm = parsePaddleEvent(event);
  assert.equal(norm.type, 'subscription');
  assert.equal(norm.accountId, '7');
  assert.equal(norm.customerId, 'ctm_X');
  assert.equal(norm.status, 'canceled');
});

test('parsePaddleEvent: subscription.updated defaults status to active when absent', () => {
  const event = {
    event_type: 'subscription.updated',
    data: { id: 'sub_4', customer_id: 'ctm_Y', custom_data: { accountId: '12', plan: 'premium' } },
  };
  assert.deepEqual(parsePaddleEvent(event), {
    type: 'subscription',
    accountId: '12',
    plan: 'premium',
    status: 'active',
    customerId: 'ctm_Y',
  });
});

test('parsePaddleEvent: transaction.completed with custom_data.changes -> topup (changes coerced to Number)', () => {
  const event = {
    event_type: 'transaction.completed',
    data: { id: 'txn_2', customer_id: 'ctm_ABC', custom_data: { accountId: '7', changes: '5' } },
  };
  assert.deepEqual(parsePaddleEvent(event), {
    type: 'topup',
    accountId: '7',
    changes: 5,
    customerId: 'ctm_ABC',
  });
});

test('parsePaddleEvent: transaction.paid is also a topup when it carries changes', () => {
  const event = {
    event_type: 'transaction.paid',
    data: { id: 'txn_3', custom_data: { accountId: '9', changes: 20 } },
  };
  const norm = parsePaddleEvent(event);
  assert.equal(norm.type, 'topup');
  assert.equal(norm.accountId, '9');
  assert.equal(norm.changes, 20);
});

test("parsePaddleEvent: a subscription's transaction (no changes) returns null", () => {
  // transaction.completed WITHOUT custom_data.changes is a subscription renewal/initial charge,
  // handled via the subscription event, so it must NOT be treated as a topup.
  const event = {
    event_type: 'transaction.completed',
    data: { id: 'txn_4', subscription_id: 'sub_1', custom_data: { accountId: '7', plan: 'pro' } },
  };
  assert.equal(parsePaddleEvent(event), null);
});

test('parsePaddleEvent: unknown/garbage events return null', () => {
  assert.equal(parsePaddleEvent({ event_type: 'address.created', data: {} }), null);
  assert.equal(parsePaddleEvent(null), null);
  assert.equal(parsePaddleEvent({ event_type: 'subscription.activated' }), null); // no data
  assert.equal(parsePaddleEvent({ data: { custom_data: {} } }), null); // no event_type
});

test('parsePaddleEvent: defensive when custom_data is missing on a subscription event', () => {
  const event = { event_type: 'subscription.activated', data: { id: 'sub_5', status: 'active', customer_id: 'ctm_Z' } };
  assert.deepEqual(parsePaddleEvent(event), {
    type: 'subscription',
    accountId: null,
    plan: null,
    status: 'active',
    customerId: 'ctm_Z',
  });
});
