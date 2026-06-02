import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { handleApproval, parseApprovalPath } from '../src/approval/index.js';
import { signToken } from '../src/util/sign.js';

const config = { signSecret: 'secret', publicBaseUrl: 'http://localhost:4173' };

// Walk a fresh lead through the legal edges to pending_approval.
function pendingLead(db) {
  const { id } = db.insertLead({ name: 'Approve Me', niche: 'cafe' });
  for (const s of ['built', 'deployed', 'emailed', 'replied', 'editing', 'pending_approval']) db.setStatus(id, s);
  return id;
}

test('parseApprovalPath matches /approve and /reject only', () => {
  assert.deepEqual(parseApprovalPath('/approve/abc.def'), { action: 'approve', token: 'abc.def' });
  assert.deepEqual(parseApprovalPath('/reject/xy.z'), { action: 'reject', token: 'xy.z' });
  assert.equal(parseApprovalPath('/silva-s/'), null);
});

test('approval: GET confirms (no state change), POST approves, bad token 403, idempotent', () => {
  const db = openDatabase(':memory:');
  const id = pendingLead(db);
  const token = signToken({ leadId: id, kind: 'approve' }, config.signSecret);
  const path = `/approve/${token}`;

  const get = handleApproval({ method: 'GET', urlPath: path, db, config });
  assert.equal(get.status, 200);
  assert.match(get.body, /Approve/);
  assert.equal(db.getLead(id).status, 'pending_approval'); // a GET must NOT change state

  const post = handleApproval({ method: 'POST', urlPath: path, db, config });
  assert.equal(post.status, 200);
  assert.equal(db.getLead(id).status, 'approved'); // POST performs it

  const forged = handleApproval({ method: 'POST', urlPath: `/approve/${token}TAMPER`, db, config });
  assert.equal(forged.status, 403); // tampered token rejected

  const again = handleApproval({ method: 'POST', urlPath: path, db, config });
  assert.match(again.body, /Already handled/); // no longer pending → no-op
  db.close();
});

test('reject moves the lead to needs_human; wrong-kind token is rejected', () => {
  const db = openDatabase(':memory:');
  const id = pendingLead(db);
  // an approve-kind token presented to /reject must not work (kind is bound into the signature)
  const approveTok = signToken({ leadId: id, kind: 'approve' }, config.signSecret);
  assert.equal(handleApproval({ method: 'POST', urlPath: `/reject/${approveTok}`, db, config }).status, 403);

  const rejectTok = signToken({ leadId: id, kind: 'reject' }, config.signSecret);
  handleApproval({ method: 'POST', urlPath: `/reject/${rejectTok}`, db, config });
  assert.equal(db.getLead(id).status, 'needs_human');
  db.close();
});

test('non-approval routes return null (fall through to static serving)', () => {
  const db = openDatabase(':memory:');
  assert.equal(handleApproval({ method: 'GET', urlPath: '/silva-s/', db, config }), null);
  db.close();
});
