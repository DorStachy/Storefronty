import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGeminiFill, fillLead } from '../src/fill/llm.js';
import { fillDeterministic } from '../src/fill/deterministic.js';
import { validateContract, CONTRACT_VERSION } from '../src/contract/contract.js';

const lead = {
  name: 'Silva’s', niche: 'barbershop', city: 'San Marcos, TX',
  address: '1138 Invasion St c, San Marcos, TX 78666, USA', phone: '(512) 392-3050',
  details: JSON.stringify({ rating: 4.6, reviewCount: 103, primaryType: 'Barber shop',
    hours: ['Monday: Closed', 'Tuesday: 7:15 AM – 6:00 PM', 'Saturday: 8:00 AM – 3:00 PM', 'Sunday: Closed'],
    reviews: [{ text: 'Best fade in town, friendly staff.', author: 'Jordan M.' }] }),
};

// A well-formed ContentContract as the model would return it. Note: shopName here is a
// HALLUCINATION ("Silva's Premium Cuts") to prove the validator overwrites it from ground truth.
const modelContract = {
  schemaVersion: CONTRACT_VERSION,
  shopName: "Silva's Premium Cuts & Spa",
  eyebrow: 'Barber shop in San Marcos',
  tagline: 'Classic cuts and clean fades in San Marcos.',
  about: { paragraphs: ['A neighborhood barbershop in San Marcos, TX with a 4.6-star reputation across 103 reviews.'] },
  services: [
    { name: 'Haircuts', desc: 'Precision haircuts tailored to your style and head shape.' },
    { name: 'Fades', desc: 'Sharp, blended fades from skin to scissor work.' },
    { name: 'Beard Trim', desc: 'Beard shaping and clean lineups to finish the look.' },
  ],
  hours: { display: [{ day: 'Mon', value: 'Closed' }, { day: 'Tue', value: '7:15 AM – 6:00 PM' }] },
  rating: { stars: 4.6, count: 103 },
  reviewHighlights: [{ quote: 'Best fade in town, friendly staff.', author: 'Jordan M.' }],
  contact: { addressLines: ['1138 Invasion St c', 'San Marcos, TX 78666'], phone: '(512) 392-3050', areaServed: 'San Marcos, TX' },
  cta: { label: 'Book a Cut', kind: 'call' },
  galleryQueries: ['barbershop interior', 'fade haircut', 'hot towel shave'],
};

// Build a Gemini-shaped response wrapping a JSON-string payload, the way v1beta returns it.
const geminiResponse = (obj) => ({
  candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }],
});

test('happy path: a well-formed model response yields a valid contract', async () => {
  let captured = null;
  const fetchJson = async (url, options) => { captured = { url, options }; return geminiResponse(modelContract); };
  const fill = makeGeminiFill({ fetchJson, apiKey: 'TEST_KEY' });

  const c = await fill(lead);
  const r = validateContract(c);
  assert.equal(r.ok, true, r.errors?.join(', '));
  assert.ok(r.value.services.length >= 1);
  assert.ok(r.value.reviewHighlights?.[0]?.quote.includes('Best fade in town'));
  assert.ok(captured, 'the adapter must have called fetchJson');
});

test('copied fields are ground-truth, not the model hallucination', async () => {
  const fetchJson = async () => geminiResponse(modelContract);
  const fill = makeGeminiFill({ fetchJson, apiKey: 'TEST_KEY' });
  const c = await fill(lead);
  // The model said "Silva's Premium Cuts & Spa"; the adapter overwrites shopName from the lead.
  assert.equal(c.shopName, 'Silva’s');
  // rating + phone copied from ground truth
  assert.equal(c.rating.stars, 4.6);
  assert.equal(c.rating.count, 103);
  assert.equal(c.contact.phone, '(512) 392-3050');
});

test('the request SENT to fetchJson carries the fact sheet + a responseSchema', async () => {
  let captured = null;
  const fetchJson = async (url, options) => { captured = { url, options }; return geminiResponse(modelContract); };
  const fill = makeGeminiFill({ fetchJson, apiKey: 'TEST_KEY' });
  await fill(lead);

  // URL targets the Generative Language v1beta generateContent endpoint with the key.
  assert.match(captured.url, /generativelanguage\.googleapis\.com/);
  assert.match(captured.url, /:generateContent/);
  assert.match(captured.url, /gemini-2\.5-flash-lite/);

  const body = JSON.parse(captured.options.body);
  // Prompt text includes the grounded fact sheet (real rating/hours/services).
  const promptText = body.contents[0].parts.map((p) => p.text).join('\n');
  assert.ok(promptText.includes('4.6'), 'prompt must include the real rating');
  assert.ok(promptText.includes('7:15'), 'prompt must include the real hours');
  assert.ok(promptText.includes('Haircuts'), 'prompt must include the allowed services');

  // Structured-output config present and JSON-typed.
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.ok(body.generationConfig.responseSchema, 'a responseSchema must be sent');
  assert.equal(body.generationConfig.responseSchema.type, 'object');
  assert.ok(body.generationConfig.responseSchema.properties.shopName, 'schema mirrors the contract');
  assert.ok(body.generationConfig.responseSchema.properties.services, 'schema includes services');
});

test('fallback: a fetchJson that THROWS yields the deterministic contract', async () => {
  const fetchJson = async () => { throw new Error('network down'); };
  const fill = makeGeminiFill({ fetchJson, apiKey: 'TEST_KEY' });
  const c = await fill(lead);
  assert.deepEqual(c, fillDeterministic(lead));
  assert.equal(validateContract(c).ok, true);
});

test('fallback: garbage (non-JSON) model text yields the deterministic contract', async () => {
  const fetchJson = async () => ({ candidates: [{ content: { parts: [{ text: 'sorry I cannot do that' }] } }] });
  const fill = makeGeminiFill({ fetchJson, apiKey: 'TEST_KEY' });
  const c = await fill(lead);
  assert.deepEqual(c, fillDeterministic(lead));
});

test('fallback: a structurally-invalid contract (fails validateContract) yields deterministic', async () => {
  // Missing services/hours/rating etc => validateContract returns ok:false => fall back.
  const broken = { schemaVersion: CONTRACT_VERSION, shopName: 'X' };
  const fetchJson = async () => geminiResponse(broken);
  const fill = makeGeminiFill({ fetchJson, apiKey: 'TEST_KEY' });
  const c = await fill(lead);
  assert.deepEqual(c, fillDeterministic(lead));
});

test('fallback: an empty/blank-candidate response yields deterministic', async () => {
  const fetchJson = async () => ({ candidates: [] });
  const fill = makeGeminiFill({ fetchJson, apiKey: 'TEST_KEY' });
  const c = await fill(lead);
  assert.deepEqual(c, fillDeterministic(lead));
});

test('fallback: no apiKey never calls the network and returns deterministic', async () => {
  let called = false;
  const fetchJson = async () => { called = true; return geminiResponse(modelContract); };
  const fill = makeGeminiFill({ fetchJson, apiKey: '' });
  const c = await fill(lead);
  assert.equal(called, false, 'must not hit the network without a key');
  assert.deepEqual(c, fillDeterministic(lead));
});

test('the adapter never throws, even on a malformed fetchJson contract', async () => {
  const fetchJson = async () => null; // not even an object
  const fill = makeGeminiFill({ fetchJson, apiKey: 'TEST_KEY' });
  await assert.doesNotReject(async () => {
    const c = await fill(lead);
    assert.deepEqual(c, fillDeterministic(lead));
  });
});

test('fillLead with no GEMINI_API_KEY returns deterministic (key-gated convenience)', async () => {
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const c = await fillLead(lead);
    assert.deepEqual(c, fillDeterministic(lead));
  } finally {
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
  }
});

test('fillLead accepts an injected fetchJson so it stays offline-testable', async () => {
  const saved = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'TEST_KEY';
  try {
    const fetchJson = async () => geminiResponse(modelContract);
    const c = await fillLead(lead, { fetchJson });
    assert.equal(c.shopName, 'Silva’s'); // ground-truth name, validated path
    assert.equal(validateContract(c).ok, true);
  } finally {
    if (saved === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = saved;
  }
});
