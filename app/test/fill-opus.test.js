import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeOpusEdit, applyOpusEdit } from '../src/fill/opus.js';
import { fillDeterministic } from '../src/fill/deterministic.js';
import { validateContract, CONTRACT_VERSION } from '../src/contract/contract.js';

const lead = {
  name: 'Silva’s', niche: 'barbershop', city: 'San Marcos, TX',
  address: '1138 Invasion St c, San Marcos, TX 78666, USA', phone: '(512) 392-3050',
  details: JSON.stringify({ rating: 4.6, reviewCount: 103, primaryType: 'Barber shop',
    hours: ['Monday: Closed', 'Tuesday: 7:15 AM – 6:00 PM', 'Saturday: 8:00 AM – 3:00 PM', 'Sunday: Closed'],
    reviews: [{ text: 'Best fade in town, friendly staff.', author: 'Jordan M.' }] }),
};

// The CURRENT site's contract (what the owner is replying about). Tuesday closes at 6:00 PM here.
const baseContract = {
  schemaVersion: CONTRACT_VERSION,
  shopName: 'Silva’s',
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
  accentHint: 'warm',
  toneHint: 'classic',
};

// Helper to clone the base contract and apply a tweak (so tests don't mutate the shared base).
const withEdit = (patch) => ({ ...structuredClone(baseContract), ...patch });

// Build an Anthropic Messages-shaped response wrapping a tool_use block (how Claude returns it
// when tool_choice forces emit_contract). A real reply also has a leading text block sometimes —
// include one to prove the adapter finds the tool_use block, not just content[0].
const anthropicResponse = (obj) => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-4-8',
  stop_reason: 'tool_use',
  content: [
    { type: 'text', text: 'Here is the updated contract.' },
    { type: 'tool_use', id: 'toolu_1', name: 'emit_contract', input: obj },
  ],
});

test('happy path: a tool_use response that applied the change yields a valid contract', async () => {
  let captured = null;
  // Owner asked to go navy + accent change. The model returns the base with toneHint/accentHint changed.
  const edited = withEdit({ accentHint: 'navy', toneHint: 'modern', tagline: 'Sharp, modern cuts in San Marcos.' });
  const fetchJson = async (url, options) => { captured = { url, options }; return anthropicResponse(edited); };
  const edit = makeOpusEdit({ fetchJson, apiKey: 'TEST_KEY' });

  const c = await edit(lead, { baseContract, change: 'make it navy and more modern' });
  const r = validateContract(c);
  assert.equal(r.ok, true, r.errors?.join(', '));
  assert.ok(r.value.services.length >= 1);
  assert.equal(c.accentHint, 'navy', 'the requested accent change is reflected');
  assert.equal(c.toneHint, 'modern');
  assert.ok(captured, 'the adapter must have called fetchJson');
});

test('an owner-requested hours CORRECTION is applied (not reverted to old ground truth)', async () => {
  // Owner explicitly says they now close at 7. The model returns Tuesday at 7:00 PM.
  const edited = withEdit({ hours: { display: [{ day: 'Mon', value: 'Closed' }, { day: 'Tue', value: '7:15 AM – 7:00 PM' }] } });
  const fetchJson = async () => anthropicResponse(edited);
  const edit = makeOpusEdit({ fetchJson, apiKey: 'TEST_KEY' });

  const c = await edit(lead, { baseContract, change: 'we close at 7 now, please update our hours' });
  // The corrected value survives — grounding must NOT stomp it back to the lead's old 6:00 PM facts.
  const tue = c.hours.display.find((d) => d.day === 'Tue');
  assert.ok(tue, 'Tuesday row present');
  assert.equal(tue.value, '7:15 AM – 7:00 PM', 'the owner-corrected closing time is preserved');
});

test('grounding: truthful fields the owner did NOT mention stay equal to the lead facts', async () => {
  // The model tries to silently change hours AND rating, but the owner only asked for a color change.
  const tampered = withEdit({
    hours: { display: [{ day: 'Mon', value: 'Open 24 hours' }, { day: 'Tue', value: '6:00 AM – 11:00 PM' }] },
    rating: { stars: 5.0, count: 999 },
    contact: { addressLines: ['999 Fake Ave'], phone: '(000) 000-0000', areaServed: 'Nowhere' },
  });
  const fetchJson = async () => anthropicResponse(tampered);
  const edit = makeOpusEdit({ fetchJson, apiKey: 'TEST_KEY' });

  const c = await edit(lead, { baseContract, change: 'make the buttons green' });
  // Hours snap back to the REAL lead hours (Mon Closed, Tue 7:15 AM – 6:00 PM) — the model can't lie.
  assert.deepEqual(
    c.hours.display,
    [{ day: 'Mon', value: 'Closed' }, { day: 'Tue', value: '7:15 AM – 6:00 PM' }, { day: 'Sat', value: '8:00 AM – 3:00 PM' }, { day: 'Sun', value: 'Closed' }],
    'hours grounded to the lead facts (owner did not mention hours)',
  );
  assert.equal(c.rating.stars, 4.6, 'rating grounded — model cannot inflate it');
  assert.equal(c.rating.count, 103);
  assert.equal(c.contact.phone, '(512) 392-3050', 'phone grounded to the real number');
  assert.deepEqual(c.contact.addressLines, ['1138 Invasion St c', 'San Marcos, TX 78666'], 'address grounded');
});

test('the request SENT to fetchJson targets Anthropic, carries the change + an emit_contract tool', async () => {
  let captured = null;
  const edited = withEdit({ accentHint: 'navy' });
  const fetchJson = async (url, options) => { captured = { url, options }; return anthropicResponse(edited); };
  const edit = makeOpusEdit({ fetchJson, apiKey: 'TEST_KEY' });
  await edit(lead, { baseContract, change: 'make it navy and we close at 7 now' });

  // Endpoint + required Anthropic headers.
  assert.match(captured.url, /api\.anthropic\.com\/v1\/messages/);
  assert.equal(captured.options.headers['x-api-key'], 'TEST_KEY');
  assert.equal(captured.options.headers['anthropic-version'], '2023-06-01');
  assert.match(captured.options.headers['content-type'], /application\/json/);

  const body = JSON.parse(captured.options.body);
  assert.equal(body.model, 'claude-opus-4-8');
  assert.equal(body.max_tokens, 2048);
  // The user message must carry the requested change text AND the current contract to edit.
  const userText = Array.isArray(body.messages[0].content)
    ? body.messages[0].content.map((b) => (typeof b === 'string' ? b : b.text)).join('\n')
    : String(body.messages[0].content);
  assert.ok(userText.includes('make it navy and we close at 7 now'), 'the change text is sent to the model');
  assert.ok(userText.includes('Silva'), 'the base contract is sent to the model');
  // System prompt carries the grounded facts (real rating/hours/services).
  assert.ok(body.system.includes('4.6'), 'system carries the real rating');
  assert.ok(body.system.includes('7:15'), 'system carries the real hours');
  assert.ok(body.system.includes('Haircuts'), 'system carries the allowed services');
  // Tool + forced tool_choice.
  assert.ok(Array.isArray(body.tools) && body.tools.length === 1, 'exactly one tool');
  assert.equal(body.tools[0].name, 'emit_contract');
  assert.ok(body.tools[0].input_schema, 'the tool has a JSON Schema');
  assert.equal(body.tools[0].input_schema.type, 'object');
  assert.ok(body.tools[0].input_schema.properties.shopName, 'schema mirrors the contract');
  assert.ok(body.tools[0].input_schema.properties.services, 'schema includes services');
  // No Google-only propertyOrdering leaked into the Anthropic schema.
  assert.equal(body.tools[0].input_schema.propertyOrdering, undefined, 'no Google-only propertyOrdering');
  assert.deepEqual(body.tool_choice, { type: 'tool', name: 'emit_contract' }, 'forced tool use');
});

test('fallback: a fetchJson that THROWS yields the deterministic base', async () => {
  const fetchJson = async () => { throw new Error('network down'); };
  const edit = makeOpusEdit({ fetchJson, apiKey: 'TEST_KEY' });
  const c = await edit(lead, { baseContract, change: 'make it navy' });
  assert.deepEqual(c, fillDeterministic(lead));
  assert.equal(validateContract(c).ok, true);
});

test('fallback: a malformed response (no tool_use block) yields the deterministic base', async () => {
  // Only a text block, no tool_use — the model refused / mis-replied.
  const fetchJson = async () => ({ content: [{ type: 'text', text: 'I am not able to do that.' }] });
  const edit = makeOpusEdit({ fetchJson, apiKey: 'TEST_KEY' });
  const c = await edit(lead, { baseContract, change: 'make it navy' });
  assert.deepEqual(c, fillDeterministic(lead));
});

test('fallback: a tool_use input that fails validateContract yields the deterministic base', async () => {
  const broken = { schemaVersion: CONTRACT_VERSION, shopName: 'X' }; // missing services/hours/rating/etc.
  const fetchJson = async () => anthropicResponse(broken);
  const edit = makeOpusEdit({ fetchJson, apiKey: 'TEST_KEY' });
  const c = await edit(lead, { baseContract, change: 'make it navy' });
  assert.deepEqual(c, fillDeterministic(lead));
});

test('fallback: a null / non-object response yields the deterministic base (never throws)', async () => {
  const fetchJson = async () => null;
  const edit = makeOpusEdit({ fetchJson, apiKey: 'TEST_KEY' });
  await assert.doesNotReject(async () => {
    const c = await edit(lead, { baseContract, change: 'make it navy' });
    assert.deepEqual(c, fillDeterministic(lead));
  });
});

test('fallback: no apiKey never calls the network and returns deterministic', async () => {
  let called = false;
  const fetchJson = async () => { called = true; return anthropicResponse(baseContract); };
  const edit = makeOpusEdit({ fetchJson, apiKey: '' });
  const c = await edit(lead, { baseContract, change: 'make it navy' });
  assert.equal(called, false, 'must not hit the network without a key');
  assert.deepEqual(c, fillDeterministic(lead));
});

test('the model id is configurable', async () => {
  let captured = null;
  const fetchJson = async (url, options) => { captured = { url, options }; return anthropicResponse(withEdit({})); };
  const edit = makeOpusEdit({ fetchJson, apiKey: 'TEST_KEY', model: 'claude-opus-4-8[1m]' });
  await edit(lead, { baseContract, change: 'tweak the copy' });
  assert.equal(JSON.parse(captured.options.body).model, 'claude-opus-4-8[1m]');
});

test('applyOpusEdit with no ANTHROPIC_API_KEY returns the deterministic base (key-gated convenience)', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const c = await applyOpusEdit(lead, { baseContract, change: 'make it navy' });
    assert.deepEqual(c, fillDeterministic(lead));
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});

test('applyOpusEdit accepts an injected fetchJson so it stays offline-testable', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'TEST_KEY';
  try {
    const edited = withEdit({ accentHint: 'navy' });
    const fetchJson = async () => anthropicResponse(edited);
    const c = await applyOpusEdit(lead, { baseContract, change: 'make it navy', fetchJson });
    assert.equal(c.accentHint, 'navy');
    assert.equal(c.shopName, 'Silva’s'); // ground-truth name, validated path
    assert.equal(validateContract(c).ok, true);
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved;
  }
});

test('applyOpusEdit honors ANTHROPIC_MODEL from the environment', async () => {
  const savedKey = process.env.ANTHROPIC_API_KEY;
  const savedModel = process.env.ANTHROPIC_MODEL;
  process.env.ANTHROPIC_API_KEY = 'TEST_KEY';
  process.env.ANTHROPIC_MODEL = 'claude-opus-4-8[1m]';
  try {
    let captured = null;
    const fetchJson = async (url, options) => { captured = { url, options }; return anthropicResponse(withEdit({})); };
    await applyOpusEdit(lead, { baseContract, change: 'tweak copy', fetchJson });
    assert.equal(JSON.parse(captured.options.body).model, 'claude-opus-4-8[1m]');
  } finally {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = savedKey;
    if (savedModel === undefined) delete process.env.ANTHROPIC_MODEL; else process.env.ANTHROPIC_MODEL = savedModel;
  }
});
