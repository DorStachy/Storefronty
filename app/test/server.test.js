import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sep } from 'node:path';
import { resolveStaticPath } from '../src/server.js';

const ROOT = sep === '/' ? '/srv/public' : 'C:\\srv\\public';

test('maps / and directory paths to index.html under the public dir', () => {
  assert.equal(resolveStaticPath(ROOT, '/'), `${ROOT}${sep}index.html`);
  assert.equal(resolveStaticPath(ROOT, '/shop/'), `${ROOT}${sep}shop${sep}index.html`);
  assert.equal(resolveStaticPath(ROOT, '/styles.css'), `${ROOT}${sep}styles.css`);
});

test('rejects path traversal (../) — encoded or not', () => {
  assert.equal(resolveStaticPath(ROOT, '/../etc/passwd'), null);
  assert.equal(resolveStaticPath(ROOT, '/..%2f..%2fetc/passwd'), null);
  assert.equal(resolveStaticPath(ROOT, '/shop/../../secret'), null);
});

test('rejects a sibling dir that shares the prefix (the startsWith bug)', () => {
  // "/srv/public-evil/x" starts with "/srv/public" but is OUTSIDE the public dir.
  assert.equal(resolveStaticPath(ROOT, '/../public-evil/x'), null);
});
