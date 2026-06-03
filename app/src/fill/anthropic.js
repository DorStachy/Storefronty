// Shared Anthropic (Claude) Messages-API helpers — the transport + grounding primitives reused by BOTH
// the small-edit adapter (fill/opus.js) and the art-director (fill/artdirect.js). Factored out so the
// two adapters don't duplicate the forced-tool-use plumbing, the edit-mode grounding rules, or the
// snap-back logic. Pure functions (no I/O); the caller injects `fetchJson`/`apiKey`. Anthropic uses
// standard JSON Schema for tool input_schema (drop Google-only `propertyOrdering`).
export const ENDPOINT = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';

// Standard Anthropic auth/version headers for a Messages call.
export function HEADERS(apiKey) {
  return {
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'content-type': 'application/json',
  };
}

// input_schema mirrors the ContentContract. type/properties/items/required all work — this just steers
// shape; validateContract is the real gate. Copied fields are present so the model fills them; we ground
// them afterward.
export function contractSchema() {
  const s = (max) => ({ type: 'string', maxLength: max });
  return {
    type: 'object',
    properties: {
      shopName: s(80),
      eyebrow: s(40),
      tagline: s(90),
      about: {
        type: 'object',
        properties: { heading: s(60), paragraphs: { type: 'array', items: s(320) } },
      },
      services: {
        type: 'array',
        items: {
          type: 'object',
          properties: { name: s(48), desc: s(160), price: s(24) },
          required: ['name', 'desc'],
        },
      },
      hours: {
        type: 'object',
        properties: {
          display: {
            type: 'array',
            items: {
              type: 'object',
              properties: { day: s(12), value: s(40) },
              required: ['day', 'value'],
            },
          },
        },
      },
      rating: {
        type: 'object',
        properties: { stars: { type: 'number' }, count: { type: 'integer' }, blurb: s(100) },
      },
      reviewHighlights: {
        type: 'array',
        items: {
          type: 'object',
          properties: { quote: s(200), author: s(40) },
          required: ['quote'],
        },
      },
      contact: {
        type: 'object',
        properties: {
          addressLines: { type: 'array', items: s(80) },
          phone: s(24),
          areaServed: s(80),
        },
      },
      cta: {
        type: 'object',
        properties: { label: s(28), kind: s(16) },
        required: ['label'],
      },
      galleryQueries: { type: 'array', items: s(60) },
      accentHint: s(24),
      toneHint: s(24),
    },
    required: ['shopName', 'tagline', 'about', 'services', 'hours', 'rating', 'contact', 'cta', 'galleryQueries'],
  };
}

// System prompt: grounded facts + edit-mode instructions. The owner is editing an EXISTING site; the
// model must apply the requested change and otherwise keep the current contract intact, without
// inventing facts or silently changing truthful fields the owner didn't ask about.
export function systemPrompt(facts, allowedServices) {
  return [
    'You are editing an EXISTING website for a US local business. The business owner has replied asking',
    'for specific changes. Apply ONLY the requested change to the current ContentContract and return the',
    'full updated contract via the emit_contract tool. Keep everything the owner did NOT ask to change.',
    '',
    'STRICT GROUNDING RULES (anti-hallucination):',
    '- Do NOT invent services, prices, awards, certifications, years in business, staff names, or history.',
    `- Describe ONLY the allowed services listed (${allowedServices.length ? allowedServices.join(', ') : 'none — keep "services" generic and DO NOT invent specific offerings or prices'}).`,
    '- Do NOT change shopName, hours, rating, address, or phone UNLESS the owner explicitly asked to correct',
    '  that specific fact. If the owner corrects a fact (e.g. new closing time), apply exactly their correction.',
    '- reviewHighlights MUST be quoted NEAR-VERBATIM from the provided review snippets; never fabricate quotes.',
    '- galleryQueries are SEARCH QUERIES (e.g. "barbershop interior"), never URLs. Keep 3–6.',
    '- No superlatives you cannot support ("best", "#1", "award-winning") and no URLs in any text.',
    '- Honor stylistic requests (colors → accentHint, tone/feel → toneHint, photo requests → galleryQueries).',
    '',
    facts,
  ].join('\n');
}

// The user turn: the current contract to edit + the owner's requested change + any photo notes.
export function userMessage(baseContract, change, photos) {
  const L = [];
  L.push('CURRENT CONTENT CONTRACT (the site as it stands now — edit this, keep what is not being changed):');
  L.push('```json');
  L.push(JSON.stringify(baseContract ?? {}, null, 2));
  L.push('```');
  L.push('');
  L.push('THE BUSINESS OWNER REPLIED ASKING FOR THIS CHANGE:');
  L.push(String(change ?? '').trim() || '(no change text provided — return the contract unchanged)');
  if (Array.isArray(photos) && photos.length) {
    L.push('');
    L.push('PHOTOS THE OWNER ATTACHED (reflect them in galleryQueries / gallery intent, do not invent URLs):');
    for (const p of photos) {
      const note = typeof p === 'string' ? p : (p && (p.note ?? p.caption ?? p.label ?? p.name)) || '';
      if (String(note).trim()) L.push(`- ${String(note).trim()}`);
    }
  }
  L.push('');
  L.push('Return the FULL updated ContentContract via emit_contract.');
  return L.join('\n');
}

// Which truthful fact-groups did the owner explicitly reference? Conservative keyword match — when a
// group is mentioned we TRUST the model's (owner-corrected) value for it; otherwise we snap it back to
// ground truth so the model can't silently change a fact the owner didn't ask about.
export function mentionedFacts(change) {
  const t = String(change || '').toLowerCase();
  const has = (...words) => words.some((w) => t.includes(w));
  return {
    hours: has('hour', 'open', 'close', 'closing', 'opening', 'am', 'pm', 'a.m', 'p.m', 'schedule', 'time', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'weekday', 'weekend'),
    rating: has('rating', 'star', 'review'),
    contact: has('address', 'street', 'located', 'location', 'move', 'moved', 'relocat', 'suite', 'phone', 'number', 'call us', 'area', 'serve'),
    name: has('name', 'rename', 'called', 'rebrand'),
  };
}

// Snap COPIED / ground-truth fields back to the verified facts, EXCEPT the fact-groups the owner asked
// to change (those keep the model's owner-corrected value). Each field is only overwritten when ground
// truth actually KNOWS it; otherwise the model's value is kept so the validator's required-field checks
// still pass. Mirrors llm.applyGroundTruth, but edit-aware.
export function applyGroundTruth(c, facts, mentioned) {
  if (!c || typeof c !== 'object') return c;
  if (!mentioned.name && facts.name) c.shopName = facts.name;
  if (!mentioned.hours && facts.hours.length) {
    c.hours = { display: facts.hours.map((h) => ({ day: h.day, value: h.value })) };
  }
  if (!mentioned.rating && facts.rating != null) {
    c.rating = { ...(c.rating && typeof c.rating === 'object' ? c.rating : {}), stars: facts.rating };
    if (facts.reviewCount != null) c.rating.count = facts.reviewCount;
  }
  if (!mentioned.contact && (facts.addressLines.length || facts.phone || facts.city)) {
    c.contact = {
      ...(c.contact && typeof c.contact === 'object' ? c.contact : {}),
      ...(facts.addressLines.length ? { addressLines: facts.addressLines.slice() } : {}),
      ...(facts.phone ? { phone: facts.phone } : {}),
      ...(facts.city ? { areaServed: facts.city } : {}),
    };
  }
  return c;
}

// Pull a forced tool_use input out of an Anthropic Messages response. Anthropic returns an array of
// content blocks; the forced tool_choice yields a { type:'tool_use', name, input } block (possibly
// preceded by a text block). Prefers the block whose name matches `name`, else the first tool_use.
// Returns the parsed input object, or null if shaped wrong.
export function extractTool(resp, name) {
  const blocks = resp && Array.isArray(resp.content) ? resp.content : null;
  if (!blocks) return null;
  const tool = blocks.find((b) => b && b.type === 'tool_use' && b.name === name)
    || blocks.find((b) => b && b.type === 'tool_use');
  const input = tool && tool.input;
  return input && typeof input === 'object' ? input : null;
}
