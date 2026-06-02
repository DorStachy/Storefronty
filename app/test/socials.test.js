import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSocial, scoreSocial, socialsFromSite, discoverSocials } from '../src/socials/index.js';

const id = { name: 'Cielito Lindo Cafe', city: 'Austin', state: 'TX', phone: '(512) 555-0199' };

test('parseSocial extracts platform + handle, rejects non-profile paths', () => {
  assert.deepEqual(parseSocial('https://www.instagram.com/cielitolindocafe/'),
    { platform: 'instagram', handle: 'cielitolindocafe', url: 'https://instagram.com/cielitolindocafe' });
  assert.deepEqual(parseSocial('https://www.tiktok.com/@cielitolindocafe?lang=en'),
    { platform: 'tiktok', handle: 'cielitolindocafe', url: 'https://tiktok.com/@cielitolindocafe' });
  assert.equal(parseSocial('https://instagram.com/p/Cabc123/'), null);   // a post, not a profile
  assert.equal(parseSocial('https://example.com/cielito'), null);        // not a social host
});

test('scoreSocial: name-in-handle + our city in the bio → accepted, corroborated', () => {
  const sc = scoreSocial(id, { platform: 'instagram', handle: 'cielitolindocafe',
    title: 'Cielito Lindo Cafe (@cielitolindocafe) • Instagram', snippet: 'Coffee in Austin, TX' });
  assert.ok(sc.accept);
  assert.ok(sc.corroborated);
  assert.ok(sc.reasons.includes('handle_name'));
  assert.ok(sc.reasons.includes('city'));
});

test('scoreSocial: a different city in the bio (our city absent) → conflict, rejected', () => {
  const sc = scoreSocial(id, { platform: 'instagram', handle: 'cielitolindocafe',
    title: 'Cielito Lindo Cafe (@cielitolindocafe)', snippet: 'Tacos in San Diego, CA' });
  assert.ok(!sc.accept);
  assert.ok(sc.reasons.includes('-conflict_city'));
});

test('scoreSocial: a generic/unrelated handle is not accepted (no name evidence)', () => {
  const sc = scoreSocial(id, { platform: 'instagram', handle: 'austin.foodie',
    title: 'Austin Foodie', snippet: 'Best eats in Austin TX' });
  assert.ok(!sc.accept);
});

test('socialsFromSite: owner-attested JSON-LD sameAs + footer anchors (Tier 1, highest confidence)', () => {
  const html = `<html><head><script type="application/ld+json">
    {"@type":"Cafe","sameAs":["https://www.instagram.com/cielitolindocafe","https://facebook.com/cielitolindoatx"]}
    </script></head><body><footer><a href="https://www.tiktok.com/@cielitolindocafe">TikTok</a></footer></body></html>`;
  const s = socialsFromSite(html);
  assert.equal(s.instagram, 'https://instagram.com/cielitolindocafe');
  assert.equal(s.facebook, 'https://facebook.com/cielitolindoatx');
  assert.equal(s.tiktok, 'https://tiktok.com/@cielitolindocafe');
});

test('discoverSocials (Tier 2+3): attaches the verified IG, gated by location', async () => {
  const searchFn = async (q) => {
    if (/instagram/i.test(q)) return { organic: [
      { url: 'https://www.instagram.com/cielitolindocafe/', title: 'Cielito Lindo Cafe (@cielitolindocafe)', snippet: 'Austin, TX · coffee', position: 1 },
    ] };
    return { organic: [] };
  };
  const s = await discoverSocials(id, { searchFn });
  assert.equal(s.instagram, 'https://instagram.com/cielitolindocafe');
  assert.equal(s.facebook, undefined);
});

test('discoverSocials: SAME-NAME two cities → picks ours (by city), never the foreign one', async () => {
  const searchFn = async () => ({ organic: [
    { url: 'https://instagram.com/cielitolindo_sd', title: 'Cielito Lindo Cafe (@cielitolindo_sd)', snippet: 'San Diego, CA', position: 1 },
    { url: 'https://instagram.com/cielitolindocafe', title: 'Cielito Lindo Cafe (@cielitolindocafe)', snippet: 'Austin, TX', position: 2 },
  ] });
  const s = await discoverSocials(id, { searchFn });
  assert.equal(s.instagram, 'https://instagram.com/cielitolindocafe');   // the Austin one
});

test('discoverSocials: only a foreign same-name profile (conflicting city) → attach nothing', async () => {
  const searchFn = async () => ({ organic: [
    { url: 'https://instagram.com/cielitolindo_madrid', title: 'Cielito Lindo (@cielitolindo_madrid)', snippet: 'Madrid, ES', position: 1 },
  ] });
  const s = await discoverSocials(id, { searchFn });
  assert.equal(s.instagram, undefined);
});

test('discoverSocials: ambiguous same-name rivals with NO location signal → attach nothing', async () => {
  const searchFn = async () => ({ organic: [
    { url: 'https://instagram.com/cielitolindocafe', title: 'Cielito Lindo Cafe', snippet: '', position: 1 },
    { url: 'https://instagram.com/cielitolindo.coffee', title: 'Cielito Lindo Cafe', snippet: '', position: 2 },
  ] });
  const s = await discoverSocials(id, { searchFn });
  assert.equal(s.instagram, undefined);   // can't tell which is ours → don't guess
});
