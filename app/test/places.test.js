import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapPlace, search } from '../src/researcher/places.js';

const base = { niche: 'cafe', city: 'Austin, TX' };

test('mapPlace: a real own-domain websiteUri → hasWebsite=true', () => {
  const l = mapPlace({ id: '1', displayName: { text: 'Real Cafe' }, websiteUri: 'https://realcafe.com/' }, base);
  assert.equal(l.hasWebsite, true);
  assert.equal(l.websiteUri, 'https://realcafe.com/');
});

test('mapPlace: an aggregator websiteUri (linktr.ee) → hasWebsite=false, but URI preserved', () => {
  const l = mapPlace({ id: '2', displayName: { text: 'Trippy Buck Coffee' }, websiteUri: 'https://linktr.ee/TrippyBuckCoffee?utm=x' }, base);
  assert.equal(l.hasWebsite, false);                         // discovery will verify properly
  assert.equal(l.websiteUri, 'https://linktr.ee/TrippyBuckCoffee?utm=x');  // kept for context
});

test('mapPlace: Apple/Google Maps URI → hasWebsite=false (Maps pages are aggregators)', () => {
  const a = mapPlace({ id: '3', displayName: { text: 'X' }, websiteUri: 'https://maps.apple.com/place?id=Y' }, base);
  const g = mapPlace({ id: '4', displayName: { text: 'X' }, websiteUri: 'https://maps.google.com/?q=Y' }, base);
  assert.equal(a.hasWebsite, false);
  assert.equal(g.hasWebsite, false);
});

test('mapPlace: no websiteUri → hasWebsite=false', () => {
  const l = mapPlace({ id: '5', displayName: { text: 'No Site Co' } }, base);
  assert.equal(l.hasWebsite, false);
  assert.equal(l.websiteUri, null);
});

test('mapPlace: an Instagram URI → hasWebsite=false', () => {
  const l = mapPlace({ id: '6', displayName: { text: 'Insta-only Cafe' }, websiteUri: 'https://www.instagram.com/some-handle' }, base);
  assert.equal(l.hasWebsite, false);
});

test('search paginates via nextPageToken up to the requested limit', async () => {
  const mkPlaces = (prefix, n) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, displayName: { text: `${prefix}${i}` } }));
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    if (!body.pageToken) return { ok: true, json: async () => ({ places: mkPlaces('A', 20), nextPageToken: 'TOK2' }) };
    if (body.pageToken === 'TOK2') return { ok: true, json: async () => ({ places: mkPlaces('B', 20), nextPageToken: 'TOK3' }) };
    return { ok: true, json: async () => ({ places: mkPlaces('C', 20) }) };   // no token → last page
  };
  const out = await search({ niche: 'cafe', city: 'Austin, TX', limit: 60, apiKey: 'k', fetchImpl });
  assert.equal(out.length, 60);
  assert.equal(calls.length, 3);                       // three pages fetched
  assert.equal(calls[1].pageToken, 'TOK2');            // forwarded the token
});

test('search stops at the limit even if more pages exist', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({
    places: Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, displayName: { text: `x${i}` } })),
    nextPageToken: 'MORE',
  }) });
  const out = await search({ niche: 'cafe', city: 'Austin, TX', limit: 25, apiKey: 'k', fetchImpl });
  assert.equal(out.length, 25);                        // 20 + 5 from the second page, then stop
});

test('mapPlace: captures lat/lng + mapsUri into details (for identity-anchored discovery)', () => {
  const l = mapPlace({
    id: '7', displayName: { text: 'Geo Cafe' },
    location: { latitude: 30.2649, longitude: -97.7405 },
    googleMapsUri: 'https://maps.google.com/?cid=999',
  }, base);
  assert.equal(l.details.lat, 30.2649);
  assert.equal(l.details.lng, -97.7405);
  assert.equal(l.details.mapsUri, 'https://maps.google.com/?cid=999');
  assert.equal(l.source, 'places:7');                       // place_id available via source
});
