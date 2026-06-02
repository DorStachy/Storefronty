import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapPlace } from '../src/researcher/places.js';

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
