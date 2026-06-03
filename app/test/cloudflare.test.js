import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { publishPreview, keepPreview, PREVIEW_TTL_SECONDS } from '../src/deployer/cloudflare.js';

function makeSite(tag) {
  const dir = join(tmpdir(), `sf-cf-${tag}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'img'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<link rel="stylesheet" href="./theme.css"><img src="img/photo-0.jpg">Hi');
  writeFileSync(join(dir, 'theme.css'), 'body{}');
  writeFileSync(join(dir, 'img', 'photo-0.jpg'), Buffer.from('JPG'));
  return dir;
}

test('PREVIEW_TTL_SECONDS is 48 hours', () => assert.equal(PREVIEW_TTL_SECONDS, 172800));

test('publishPreview PUTs inlined HTML to KV with the 48h TTL + bearer auth', async () => {
  const dir = makeSite('pub');
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200 }; };
  const r = await publishPreview(dir, 'demo-shop', { accountId: 'acct', apiToken: 'tok', namespaceId: 'ns', fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/accounts\/acct\/storage\/kv\/namespaces\/ns\/values\/demo-shop\?expiration_ttl=172800$/);
  assert.equal(calls[0].opts.method, 'PUT');
  assert.equal(calls[0].opts.headers.authorization, 'Bearer tok');
  assert.ok(calls[0].opts.body.includes('<style>'), 'body is the inlined self-contained HTML');
  assert.ok(calls[0].opts.body.includes('data:image/jpeg;base64,'), 'image inlined into the body');
  rmSync(dir, { recursive: true, force: true });
});

test('keepPreview drops the TTL (permanent on claim)', async () => {
  const dir = makeSite('keep');
  let url = '';
  const fetchImpl = async (u) => { url = u; return { ok: true, status: 200 }; };
  await keepPreview(dir, 'demo-shop', { accountId: 'a', apiToken: 't', namespaceId: 'n', fetchImpl });
  assert.ok(!/expiration_ttl/.test(url), 'no TTL query param → permanent');
  rmSync(dir, { recursive: true, force: true });
});

test('publishPreview throws clearly when Cloudflare is not configured', async () => {
  const dir = makeSite('cfg');
  await assert.rejects(() => publishPreview(dir, 's', { accountId: '', apiToken: '', namespaceId: '' }), /not configured/);
  rmSync(dir, { recursive: true, force: true });
});

test('publishPreview surfaces a Cloudflare API failure', async () => {
  const dir = makeSite('fail');
  const fetchImpl = async () => ({ ok: false, status: 403 });
  await assert.rejects(() => publishPreview(dir, 's', { accountId: 'a', apiToken: 't', namespaceId: 'n', fetchImpl }), /KV write failed \(403\)/);
  rmSync(dir, { recursive: true, force: true });
});
