import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inlineSite } from '../src/deployer/inline.js';

function makeSite() {
  const dir = join(tmpdir(), `sf-inline-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'img'), { recursive: true });
  writeFileSync(join(dir, 'index.html'),
    '<link rel="stylesheet" href="https://fonts.googleapis.com/x"><link rel="stylesheet" href="./theme.css"><img class="hero-photo" src="img/photo-0.jpg"><div class="tile"><img src="img/photo-1.jpg"></div>');
  writeFileSync(join(dir, 'theme.css'), 'body{color:red}');
  writeFileSync(join(dir, 'img', 'photo-0.jpg'), Buffer.from('JPEG-ZERO'));
  writeFileSync(join(dir, 'img', 'photo-1.jpg'), Buffer.from('JPEG-ONE'));
  return dir;
}

test('inlineSite bakes the theme CSS + images into one self-contained HTML', () => {
  const dir = makeSite();
  const html = inlineSite(dir);
  assert.ok(html.includes('<style>') && html.includes('body{color:red}'), 'theme css inlined');
  assert.ok(!/href=["']\.?\/?theme\.css/.test(html), 'no external theme.css link remains');
  assert.ok(html.includes('https://fonts.googleapis.com/x'), 'external Google Fonts link is preserved');
  assert.equal((html.match(/data:image\/jpeg;base64,/g) || []).length, 2, 'both images inlined as data URLs');
  assert.ok(!html.includes('img/photo-0.jpg') && !html.includes('img/photo-1.jpg'), 'no external image refs remain');
  rmSync(dir, { recursive: true, force: true });
});

test('inlineSite tolerates a site with no images', () => {
  const dir = join(tmpdir(), `sf-inline-noimg-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<link rel="stylesheet" href="theme.css">hello');
  writeFileSync(join(dir, 'theme.css'), 'h1{}');
  const html = inlineSite(dir);
  assert.ok(html.includes('<style>') && html.includes('h1{}'));
  assert.ok(html.includes('hello'));
  rmSync(dir, { recursive: true, force: true });
});
