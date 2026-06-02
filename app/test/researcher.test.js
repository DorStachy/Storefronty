import { test } from 'node:test';
import assert from 'node:assert/strict';
import { research, buildIdentity } from '../src/researcher/index.js';

// A places-shaped lead as produced by places.mapPlace (details is an OBJECT here).
const placesLead = {
  name: 'Cielito Lindo Cafe', niche: 'cafe', city: 'Austin, TX',
  address: '411 Brazos St APT 101, Austin, TX 78701, USA', phone: '(512) 555-0199',
  websiteUri: null, source: 'places:ChIJrTLr-GyuEmsRBfy61i59si0',
  details: { mapsUri: 'https://maps.google.com/?cid=999000111222', lat: 30.2649, lng: -97.7405 },
};

test('buildIdentity: extracts the FULL identity (never name-alone) from a places lead', () => {
  const id = buildIdentity(placesLead);
  assert.equal(id.name, 'Cielito Lindo Cafe');
  assert.equal(id.city, 'Austin');                                  // city/state split out of "Austin, TX"
  assert.equal(id.state, 'TX');
  assert.equal(id.phone, '(512) 555-0199');
  assert.equal(id.street, '411 Brazos St');                         // apt suffix stripped
  assert.equal(id.zip, '78701');
  assert.equal(id.placeId, 'ChIJrTLr-GyuEmsRBfy61i59si0');          // from source: places:<id>
  assert.equal(id.lat, 30.2649);
  assert.equal(id.lng, -97.7405);
  assert.equal(id.mapsUri, 'https://maps.google.com/?cid=999000111222');
});

test('buildIdentity: tolerates details stored as a JSON string (DB roundtrip)', () => {
  const id = buildIdentity({ ...placesLead, details: JSON.stringify(placesLead.details) });
  assert.equal(id.lat, 30.2649);
  assert.equal(id.mapsUri, 'https://maps.google.com/?cid=999000111222');
});

test('research(): passes the full identity object to discovery — not just the name', async () => {
  const seen = [];
  const fakeDiscover = async (identity) => { seen.push(identity); return { status: 'UNCERTAIN' }; };
  await research(
    { niche: 'cafe', city: 'Austin, TX', engine: 'mock', searchFn: async () => [] },
    { discover: fakeDiscover });
  assert.ok(seen.length >= 1, 'discovery was called for at least one candidate');
  // every required identity key is present on the object handed to discovery
  for (const k of ['name', 'city', 'state', 'phone', 'street', 'zip', 'placeId', 'lat', 'lng', 'mapsUri', 'websiteUri']) {
    assert.ok(k in seen[0], `identity passed to discovery is missing "${k}"`);
  }
});
