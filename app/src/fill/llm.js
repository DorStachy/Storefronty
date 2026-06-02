// Cheap-LLM fill adapter (design §5.2). Turns a shop's REAL Google data into a validated
// ContentContract via Gemini 2.5 Flash-Lite — with strict anti-hallucination grounding and a
// deterministic fallback. INVARIANT: the model emits ONLY a ContentContract JSON object (never
// HTML/CSS); it sees a fact sheet ("the ONLY facts that exist") + an allowed-services whitelist and
// must not invent services/prices/awards/history. Copied fields (name/hours/rating/address) are
// overwritten from ground truth by validateContract. A site ALWAYS ships: any failure (no key,
// network error, malformed/garbage JSON, invalid contract) falls back to fillDeterministic.
import { buildFactSheet } from './grounding.js';
import { fillDeterministic } from './deterministic.js';
import { validateContract, CONTRACT_VERSION } from '../contract/contract.js';
import { postJson } from '../util/net.js';

const ENDPOINT = (model, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

// responseSchema mirrors the ContentContract (Google Generative Language uses an OpenAPI-3.0 subset:
// type/properties/items/nullable/propertyOrdering). The validator is the real gate; this just steers
// the model toward the right shape. Copied fields are present so the model fills them, then we
// overwrite from ground truth.
function responseSchema() {
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
        propertyOrdering: ['heading', 'paragraphs'],
      },
      services: {
        type: 'array',
        items: {
          type: 'object',
          properties: { name: s(48), desc: s(160), price: s(24) },
          required: ['name', 'desc'],
          propertyOrdering: ['name', 'desc', 'price'],
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
              propertyOrdering: ['day', 'value'],
            },
          },
        },
        propertyOrdering: ['display'],
      },
      rating: {
        type: 'object',
        properties: { stars: { type: 'number' }, count: { type: 'integer' }, blurb: s(100) },
        propertyOrdering: ['stars', 'count', 'blurb'],
      },
      reviewHighlights: {
        type: 'array',
        items: {
          type: 'object',
          properties: { quote: s(200), author: s(40) },
          required: ['quote'],
          propertyOrdering: ['quote', 'author'],
        },
      },
      contact: {
        type: 'object',
        properties: {
          addressLines: { type: 'array', items: s(80) },
          phone: s(24),
          areaServed: s(80),
        },
        propertyOrdering: ['addressLines', 'phone', 'areaServed'],
      },
      cta: {
        type: 'object',
        properties: { label: s(28), kind: s(16) },
        required: ['label'],
        propertyOrdering: ['label', 'kind'],
      },
      galleryQueries: { type: 'array', items: s(60) },
      accentHint: s(24),
      toneHint: s(24),
    },
    required: ['shopName', 'tagline', 'about', 'services', 'hours', 'rating', 'contact', 'cta', 'galleryQueries'],
    propertyOrdering: [
      'shopName', 'eyebrow', 'tagline', 'about', 'services', 'hours', 'rating',
      'reviewHighlights', 'contact', 'cta', 'galleryQueries', 'accentHint', 'toneHint',
    ],
  };
}

function instructions(facts, allowedServices) {
  return [
    'You are a copywriter for US local-business websites. Using ONLY the verified facts below,',
    'produce a single ContentContract JSON object that matches the provided schema. Output JSON ONLY —',
    'never HTML, CSS, Markdown, or prose outside the JSON.',
    '',
    'STRICT GROUNDING RULES (anti-hallucination):',
    '- Do NOT invent services, prices, awards, certifications, years in business, staff names, or history.',
    `- Describe ONLY the allowed services listed (${allowedServices.length ? allowedServices.join(', ') : 'none — keep "services" generic and DO NOT invent specific offerings or prices'}).`,
    '- Do NOT state a price for any service unless a price appears in the facts (none do here).',
    '- reviewHighlights MUST be quoted NEAR-VERBATIM from the provided review snippets. If no snippets',
    '  are provided, OMIT reviewHighlights entirely (do not fabricate quotes or authors).',
    '- Copy shopName, hours, rating, and address EXACTLY from the facts (they will be re-checked).',
    '- galleryQueries are SEARCH QUERIES (e.g. "barbershop interior"), never URLs. Provide 3–6.',
    '- No superlatives you cannot support ("best", "#1", "award-winning") and no URLs in any text.',
    '- Benefit-led, concrete, warm copy that sells THIS business; 1–3 about paragraphs.',
    '',
    facts,
  ].join('\n');
}

// Overwrite the COPIED / ground-truth fields from the verified facts, so a model hallucination in
// name/hours/rating/address/phone can never reach the page (design §5.2 invariant). Each field is
// only overwritten when ground truth actually KNOWS it; otherwise the model's value is kept so the
// validator's required-field checks still pass (an unknown field would otherwise force a fallback).
function applyGroundTruth(c, facts) {
  if (!c || typeof c !== 'object') return c;
  if (facts.name) c.shopName = facts.name;
  if (facts.hours.length) c.hours = { display: facts.hours.map((h) => ({ day: h.day, value: h.value })) };
  if (facts.rating != null) {
    c.rating = { ...(c.rating && typeof c.rating === 'object' ? c.rating : {}), stars: facts.rating };
    if (facts.reviewCount != null) c.rating.count = facts.reviewCount;
  }
  if (facts.addressLines.length || facts.phone || facts.city) {
    c.contact = {
      ...(c.contact && typeof c.contact === 'object' ? c.contact : {}),
      ...(facts.addressLines.length ? { addressLines: facts.addressLines.slice() } : {}),
      ...(facts.phone ? { phone: facts.phone } : {}),
      ...(facts.city ? { areaServed: facts.city } : {}),
    };
  }
  return c;
}

// Pull the model's JSON-string payload out of a v1beta generateContent response and parse it.
// Returns the parsed object, or null if the response is shaped wrong / the text isn't valid JSON.
function extractJson(resp) {
  const text = resp?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Tolerate a stray code-fence or leading prose: grab the first {...} block.
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }
}

/**
 * makeGeminiFill({ fetchJson, apiKey, model }) -> async fill(lead) -> contract
 * `fetchJson(url, options)` is an injected async function returning the parsed JSON response
 * (tests pass a fake; prod wraps util/net.js postJson). NEVER throws; always returns a contract.
 */
export function makeGeminiFill({ fetchJson, apiKey, model = 'gemini-2.5-flash-lite' } = {}) {
  return async function fill(lead) {
    // Key-gated: no key (or no transport) => deterministic, no network.
    if (!apiKey || typeof fetchJson !== 'function') return fillDeterministic(lead);
    try {
      const { sheet, allowedServices, facts } = buildFactSheet(lead);
      const body = {
        contents: [{ role: 'user', parts: [{ text: instructions(sheet, allowedServices) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: responseSchema(),
          temperature: 0.4,
          maxOutputTokens: 2048,
        },
      };
      const resp = await fetchJson(ENDPOINT(model, apiKey), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const parsed = extractJson(resp);
      if (!parsed) return fillDeterministic(lead);
      // Stamp ground truth over the model's copied fields (anti-hallucination), set the version,
      // then validate (which truncates/length-bounds and rejects structurally-bad output).
      applyGroundTruth(parsed, facts);
      parsed.schemaVersion = CONTRACT_VERSION;
      const r = validateContract(parsed);
      return r.ok ? r.value : fillDeterministic(lead);
    } catch {
      // Any network/parse/unexpected error => a site still ships.
      return fillDeterministic(lead);
    }
  };
}

/**
 * fillLead(lead, opts?) -> contract. Convenience that wires the real SSRF-safe prod transport
 * (util/net.js postJson) when GEMINI_API_KEY is set; otherwise returns the deterministic fill.
 * Key-gated. `opts.fetchJson` overrides the transport (so this stays offline-testable).
 */
export async function fillLead(lead, opts = {}) {
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY ?? '';
  if (!apiKey) return fillDeterministic(lead);
  const fetchJson = opts.fetchJson || ((url, options) => postJson(url, JSON.parse(options.body), { headers: options.headers }));
  const fill = makeGeminiFill({ fetchJson, apiKey, model: opts.model });
  return fill(lead);
}
