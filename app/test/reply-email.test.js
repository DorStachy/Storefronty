import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeReplyEmail, claimUrl } from '../src/salesman/replyEmail.js';
import { verifyToken } from '../src/util/sign.js';

const cfg = {
  mail: { fromName: 'Michael' }, brand: 'Storefronty', postalAddress: 'Storefronty LLC, Austin, TX',
  portalBaseUrl: 'https://app.storefronty.com', signSecret: 's3cret',
};

test('composeReplyEmail = approved §6.6 copy with TWO links, no emojis', () => {
  const site = 'https://silvas.preview.storefronty.com';
  const claim = claimUrl({ id: 7 }, cfg);
  const { subject, text, html } = composeReplyEmail(
    { name: "Silva's", id: 7 },
    { siteUrl: site, claimUrl: claim, changeSummary: 'made the chairs navy and fixed Saturday hours', config: cfg },
  );
  assert.equal(subject, "re: a website for Silva's");
  assert.ok(text.includes('Thanks for getting back to me'));
  assert.ok(text.includes("it'll be up for 48 hours"));
  assert.ok(text.includes(site), 'link 1 (the live site) present');
  assert.ok(text.includes(claim), 'link 2 (the account-claim link) present');
  assert.ok(text.includes('one more change for you, free'));
  assert.ok(!/[\u{1F300}-\u{1FAFF}☀-➿←-⇿]/u.test(text), 'hand-typed: no emojis');
  assert.ok(html.includes('href') && !html.includes('{{'));
});

test('claimUrl is a verifiable signed token bound to the lead (tamper-proof)', () => {
  const url = claimUrl({ id: 42 }, cfg);
  const token = url.split('/claim/')[1];
  const payload = verifyToken(token, cfg.signSecret);
  assert.equal(payload.leadId, 42);
  assert.equal(payload.kind, 'claim');
  assert.equal(verifyToken(token, 'wrong-secret'), null); // a forged/altered token does not verify
});
