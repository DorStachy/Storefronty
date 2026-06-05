import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rampTarget, decideBurst, dayIndexFor, todayUTC, warmupMessage,
  seedRecipients, sendWarmup, runCycle,
} from '../src/warmup/index.js';

const cfg = {
  dbPath: '/tmp/sf-warmup-test/storefronty.db',
  mail: { user: 'storefronty.dev@gmail.com', pass: 'app-pass', fromName: 'Michael' },
  email: { resendKey: 're_fake', from: 'Michael <michael@storefronty.cc>' },
};

test('rampTarget ramps gently week by week, then holds at a steady cap', () => {
  assert.equal(rampTarget(1), 4);
  assert.equal(rampTarget(2), 4);
  assert.equal(rampTarget(3), 8);
  assert.equal(rampTarget(7), 12);   // end of week 1
  assert.equal(rampTarget(8), 20);   // week 2
  assert.equal(rampTarget(14), 20);
  assert.equal(rampTarget(21), 30);  // week 3
  assert.equal(rampTarget(28), 40);  // week 4
  assert.equal(rampTarget(29), 45);  // steady
  assert.equal(rampTarget(365), 45);
  assert.equal(rampTarget(0), 4);    // clamps to day 1
});

test('decideBurst spreads the daily cap across cycles and stops at the cap', () => {
  assert.equal(decideBurst(4, 0), 1);    // ceil(4/6)=1
  assert.equal(decideBurst(40, 0), 7);   // ceil(40/6)=7
  assert.equal(decideBurst(40, 38), 2);  // only 2 left under the cap
  assert.equal(decideBurst(40, 40), 0);  // cap reached
  assert.equal(decideBurst(40, 99), 0);  // never negative
});

test('dayIndexFor counts whole UTC days, start date = day 1', () => {
  assert.equal(dayIndexFor('2026-06-05', '2026-06-05'), 1);
  assert.equal(dayIndexFor('2026-06-05', '2026-06-06'), 2);
  assert.equal(dayIndexFor('2026-06-05', '2026-06-11'), 7);
  assert.equal(dayIndexFor('2026-06-05', '2026-07-03'), 29);
});

test('todayUTC formats YYYY-MM-DD', () => {
  assert.equal(todayUTC(new Date('2026-06-05T23:59:00Z')), '2026-06-05');
});

test('warmupMessage produces varied, plain, link-free, emoji-free human notes', () => {
  const seen = new Set();
  for (let n = 0; n < 12; n++) {
    const m = warmupMessage(n, 'Michael');
    assert.ok(m.subject && m.text && m.html);
    assert.ok(m.text.endsWith('— Michael'));
    assert.ok(!/\{\{/.test(m.text) && !/\{\{/.test(m.html), 'no template placeholders');
    assert.ok(!/https?:\/\//.test(m.text) && !/https?:\/\//.test(m.html), 'no links (a link from a cold domain trips spam filters)');
    assert.ok(!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(m.text), 'no emojis');
    seen.add(`${m.subject}|${m.text}`);
  }
  assert.ok(seen.size >= 6, 'content actually varies across sends (not one repeated body)');
});

test('seedRecipients is exactly the inbox(es) we own', () => {
  assert.deepEqual(seedRecipients(cfg), ['storefronty.dev@gmail.com']);
});

test('sendWarmup HARD-REFUSES any recipient outside the owned seed set', async () => {
  // The safety guarantee: warm-up can never email a real business, even if called with one.
  await assert.rejects(
    () => sendWarmup(cfg, { to: 'a-real-business@example.com', n: 0 }, { _transport: { sendMail: async () => ({ messageId: 'x' }) } }),
    /refused non-seed recipient/,
  );
});

test('sendWarmup sends to the seed via the injected transport with a storefronty.cc From', async () => {
  const sentArgs = [];
  const _transport = { sendMail: async (env) => { sentArgs.push(env); return { messageId: 'mid-1' }; } };
  const r = await sendWarmup(cfg, { to: 'storefronty.dev@gmail.com', n: 3 }, { _transport });
  assert.equal(r.dry, false);
  assert.equal(r.id, 'mid-1');
  assert.equal(sentArgs.length, 1);
  assert.match(sentArgs[0].from, /michael@storefronty\.cc/);
  assert.equal(sentArgs[0].to, 'storefronty.dev@gmail.com');
  assert.equal(sentArgs[0].replyTo, 'storefronty.dev@gmail.com'); // replies thread back deliverably, never bounce
  assert.ok(sentArgs[0].subject && sentArgs[0].text && sentArgs[0].html);
});

test('runCycle sends a day-1 burst, engages (stubbed), and persists progress', async () => {
  const sent = [];
  const _transport = { sendMail: async (env) => { sent.push(env); return { messageId: `m${sent.length}` }; } };
  const _engage = async () => ({ rescued: 1, starred: 2 });
  const state = { startDate: '2026-06-05', totalSent: 0, today: '2026-06-05', sentToday: 0 };
  const r = await runCycle(cfg, { state, now: new Date('2026-06-05T09:00:00Z'), _transport, _engage });
  assert.equal(r.dayIndex, 1);
  assert.equal(r.dayCap, 4);
  assert.equal(r.sent, 1);          // day-1 burst = ceil(4/6) = 1
  assert.equal(r.sentToday, 1);
  assert.equal(r.totalSent, 1);
  assert.equal(r.rescued, 1);
  assert.equal(r.starred, 2);
  assert.equal(sent.length, 1);
});

test('runCycle resets the daily counter when the UTC day rolls over', async () => {
  const _transport = { sendMail: async () => ({ messageId: 'm' }) };
  const _engage = async () => ({ rescued: 0, starred: 0 });
  // Yesterday we already hit the cap; today is a new date → counter resets, sending resumes.
  const state = { startDate: '2026-06-05', totalSent: 4, today: '2026-06-05', sentToday: 4 };
  const r = await runCycle(cfg, { state, now: new Date('2026-06-06T08:00:00Z'), _transport, _engage });
  assert.equal(r.dayIndex, 2);
  assert.equal(r.dayCap, 4);
  assert.equal(r.sentToday, 1);     // reset to 0, then sent this cycle's burst
  assert.equal(r.totalSent, 5);
});

test('runCycle sends nothing once the daily cap is reached', async () => {
  let calls = 0;
  const _transport = { sendMail: async () => { calls++; return { messageId: 'm' }; } };
  const _engage = async () => ({ rescued: 0, starred: 0 });
  const state = { startDate: '2026-06-05', totalSent: 4, today: '2026-06-05', sentToday: 4 };
  const r = await runCycle(cfg, { state, now: new Date('2026-06-05T20:00:00Z'), _transport, _engage });
  assert.equal(r.sent, 0);
  assert.equal(calls, 0, 'no sends once the cap is hit');
});
