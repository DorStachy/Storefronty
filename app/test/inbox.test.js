import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractText } from '../src/inbox/index.js';

test('strips the quoted reply history ("On … wrote:" + > lines)', () => {
  const raw = [
    'From: owner@shop.com', 'Subject: re: a website', 'Content-Type: text/plain', '',
    'Make it navy please.', '',
    'On Mon, Jun 2 2026 at 9:00, Michael wrote:', '> here is your site', '> click here to view',
  ].join('\r\n');
  assert.equal(extractText(raw), 'Make it navy please.');
});

test('decodes quoted-printable, incl. soft line breaks and UTF-8', () => {
  const raw = [
    'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '',
    'Our caf=C3=A9 hours =', 'look great =21',
  ].join('\r\n');
  assert.equal(extractText(raw), 'Our café hours look great !');
});

test('picks the text/plain part out of a multipart/alternative message', () => {
  const raw = [
    'Content-Type: multipart/alternative; boundary="BND"', '',
    '--BND', 'Content-Type: text/plain', '', 'The plain reply', '',
    '--BND', 'Content-Type: text/html', '', '<p>The <b>html</b> reply</p>', '',
    '--BND--',
  ].join('\r\n');
  assert.equal(extractText(raw), 'The plain reply');
});

test('strips a signature after the "-- " delimiter', () => {
  const raw = ['Content-Type: text/plain', '', 'Love it!', '-- ', 'Sent from my iPhone'].join('\r\n');
  assert.equal(extractText(raw), 'Love it!');
});

test('plain body with no headers still works', () => {
  assert.equal(extractText('just a line'), 'just a line');
});
