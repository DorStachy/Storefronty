import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { createAccount, authenticate, hashPassword, verifyPassword, canRequestChange } from '../src/portal/accounts.js';

const MONTH = '2026-06';

test('password hash verifies; wrong password fails', () => {
  const h = hashPassword('hunter2pass');
  assert.ok(verifyPassword('hunter2pass', h));
  assert.ok(!verifyPassword('wrong', h));
});

test('createAccount binds to a lead, rejects dup + weak inputs', () => {
  const db = openDatabase(':memory:');
  const { id: leadId } = db.insertLead({ name: 'Claim Cafe', niche: 'cafe' });
  const r = createAccount(db, { email: 'owner@cafe.com', password: 'longenough1', leadId });
  assert.ok(r.ok);
  assert.equal(r.account.lead_id, leadId); // pre-bound to his site
  assert.equal(createAccount(db, { email: 'owner@cafe.com', password: 'longenough1' }).ok, false); // dup email
  assert.equal(createAccount(db, { email: 'bad', password: 'longenough1' }).ok, false); // bad email
  assert.equal(createAccount(db, { email: 'x@y.com', password: 'short' }).ok, false); // weak pw
  db.close();
});

test('authenticate returns the account on correct creds only', () => {
  const db = openDatabase(':memory:');
  createAccount(db, { email: 'a@b.com', password: 'longenough1' });
  assert.ok(authenticate(db, 'a@b.com', 'longenough1'));
  assert.equal(authenticate(db, 'a@b.com', 'nope'), null);
  assert.equal(authenticate(db, 'no@one.com', 'longenough1'), null);
  db.close();
});

test('quota: free change first → then plan limit → then blocked; premium unlimited', () => {
  const db = openDatabase(':memory:');
  const { account } = createAccount(db, { email: 'q@b.com', password: 'longenough1' });

  // before any plan, only the post-signup free change is available
  let c = canRequestChange(db, account, MONTH);
  assert.deepEqual([c.ok, c.useFree], [true, true]);

  // spend the free change → now blocked without a plan
  db.addChangeRequest({ accountId: account.id, body: 'free one', kind: 'free' });
  db.markFreeChangeUsed(account.id);
  assert.equal(canRequestChange(db, db.getAccount(account.id), MONTH).ok, false);

  // activate Starter (quota 3): 3 allowed, 4th blocked
  db.setAccountPlan(account.id, { plan: 'starter', planStatus: 'active' });
  for (let i = 0; i < 3; i++) {
    assert.equal(canRequestChange(db, db.getAccount(account.id), MONTH).ok, true);
    db.addChangeRequest({ accountId: account.id, body: `c${i}`, kind: 'change' });
  }
  assert.equal(canRequestChange(db, db.getAccount(account.id), MONTH).ok, false); // 3/3 used

  // Premium = unlimited
  db.setAccountPlan(account.id, { plan: 'premium', planStatus: 'active' });
  assert.equal(canRequestChange(db, db.getAccount(account.id), MONTH).ok, true);
  db.close();
});
