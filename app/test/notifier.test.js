import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeApproval } from '../src/notifier/index.js';

const cfg = { publicBaseUrl: 'http://localhost:4173' };

test('composeApproval fully HTML-escapes lead name, applied note, and change', () => {
  const approval = {
    id: 7,
    payloadObj: {
      change: 'make it <script>alert(1)</script> & "navy"',
      applied: '<img src=x onerror=alert(1)>',
      previewUrl: 'http://localhost:4173/x/',
    },
  };
  const { html } = composeApproval({ name: '<b>Bad</b> Cafe' }, approval, cfg);
  assert.ok(!html.includes('<script>alert'), 'no live script tag');
  assert.ok(!html.includes('<img src=x onerror'), 'no live img onerror');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;b&gt;Bad&lt;/b&gt; Cafe'));
  assert.ok(html.includes('&amp; &quot;navy&quot;'), 'ampersand + quotes escaped');
});

test('composeApproval neutralizes a javascript: previewUrl in the "View site" link', () => {
  const approval = { id: 9, payloadObj: { change: 'hi', applied: 'colour', previewUrl: 'javascript:alert(1)' } };
  const { html } = composeApproval({ name: 'OK Cafe' }, approval, cfg);
  assert.ok(!html.includes('href="javascript:'), 'javascript: rejected from href');
});

test('composeApproval renders working approve/reject links from publicBaseUrl', () => {
  const approval = { id: 42, payloadObj: { change: 'navy', applied: 'accent', previewUrl: 'http://localhost:4173/x/' } };
  const { html, text } = composeApproval({ name: 'OK Cafe' }, approval, cfg);
  assert.ok(html.includes('http://localhost:4173/approve/42'));
  assert.ok(html.includes('http://localhost:4173/reject/42'));
  assert.ok(text.includes('approve 42'));
});
