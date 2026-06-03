import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { placePhotoUrl, downloadPhotos } from '../src/photos/index.js';

const NAME = 'places/ChIJabc123/photos/AeRef_XYZ';

test('placePhotoUrl builds the Places media endpoint with the key + width', () => {
  const u = placePhotoUrl(NAME, { apiKey: 'k', maxWidthPx: 1200 });
  assert.equal(u, `https://places.googleapis.com/v1/${NAME}/media?maxWidthPx=1200&key=k`);
});

test('downloadPhotos saves each photo to disk and returns the paths (capped at max)', async () => {
  const dir = join(tmpdir(), `sf-photos-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  const seen = [];
  const fetchImpl = async (url) => { seen.push(url); return { ok: true, arrayBuffer: async () => new TextEncoder().encode('JPEGBYTES').buffer }; };
  const names = [NAME, 'places/x/photos/2', 'places/x/photos/3', 'places/x/photos/4'];
  const saved = await downloadPhotos(names, dir, { apiKey: 'k', max: 2, fetchImpl });
  assert.equal(saved.length, 2);                         // respected max
  assert.equal(seen.length, 2);
  assert.ok(existsSync(join(dir, 'photo-0.jpg')));
  assert.ok(existsSync(join(dir, 'photo-1.jpg')));
  assert.equal(readFileSync(saved[0], 'utf8'), 'JPEGBYTES');
  rmSync(dir, { recursive: true, force: true });
});

test('downloadPhotos skips a failed photo but keeps the rest', async () => {
  const dir = join(tmpdir(), `sf-photos-skip-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  let n = 0;
  const fetchImpl = async () => { n++; return n === 1 ? { ok: false, status: 403 } : { ok: true, arrayBuffer: async () => new TextEncoder().encode('OK').buffer }; };
  const saved = await downloadPhotos(['a/photos/1', 'b/photos/2'], dir, { apiKey: 'k', fetchImpl });
  assert.equal(saved.length, 1);                         // first failed, second saved
  assert.ok(saved[0].endsWith('photo-0.jpg'));           // numbering follows successes, not attempts
  rmSync(dir, { recursive: true, force: true });
});

test('downloadPhotos returns [] with no key or no names (no build break)', async () => {
  assert.deepEqual(await downloadPhotos(['a/photos/1'], tmpdir(), { apiKey: '' }), []);
  assert.deepEqual(await downloadPhotos([], tmpdir(), { apiKey: 'k' }), []);
  assert.deepEqual(await downloadPhotos(null, tmpdir(), { apiKey: 'k' }), []);
});
