// Opus art-director (design Stage-2 "wow-build"). After a shop owner replies, Claude Opus 4.8 acts as an
// art director: in ONE forced tool call (emit_site) it emits BOTH a grounded ContentContract (facts/copy)
// AND a DesignSpec (validated design tokens — palette, fonts, layout, mood) so every site looks
// designed-for-this-business, never templated. Structurally a clone of fill/opus.js's transport (same
// Anthropic Messages API, forced tool_use, key-gating, grounding-snapback) with a two-property tool; the
// shared plumbing lives in fill/anthropic.js so the two adapters stay DRY.
//
// The model only STEERS: validateContract gates the contract and validateDesignSpec gates the design
// (both repair-not-reject — a spec ALWAYS validates). NEVER throws: on any failure (no key, network
// error, no tool_use, invalid contract) it returns the deterministic always-ships pair
// { fillDeterministic(lead), designForNiche(lead.niche) } so a valid, grounded, self-contained site
// always builds.
import { buildFactSheet } from './grounding.js';
import { fillDeterministic } from './deterministic.js';
import { validateContract, CONTRACT_VERSION } from '../contract/contract.js';
import {
  validateDesignSpec,
  designForNiche,
  LAYOUTS,
  SCALES,
  RADII,
  SHADOWS,
  MOTIONS,
  TEXTURES,
} from '../design/spec.js';
import { designBrief } from '../design/playbook.js';
import { postJson } from '../util/net.js';
import {
  ENDPOINT,
  HEADERS,
  contractSchema,
  systemPrompt,
  userMessage,
  mentionedFacts,
  applyGroundTruth,
  extractTool,
} from './anthropic.js';

// JSON Schema for the DesignSpec half of emit_site. Enumerates the validated tokens (string enums for
// layout/scale/radius/shadow/motion/texture; palette = hex strings; fonts = display/body) so the model
// picks freely within the safe set. It only STEERS shape; validateDesignSpec is the real gate (off-list
// or unsafe values are coerced to sensible defaults — the spec can never inject CSS or break
// self-containment).
function designSchema() {
  const hex = { type: 'string', description: 'CSS hex color, e.g. #0b0b0d' };
  return {
    type: 'object',
    description: 'The visual design tokens (the "look") — chosen to fit THIS business and its photos.',
    properties: {
      layout: { type: 'string', enum: LAYOUTS },
      palette: {
        type: 'object',
        properties: { bg: hex, surface: hex, ink: hex, muted: hex, accent: hex, accentInk: hex },
      },
      fonts: {
        type: 'object',
        properties: { display: { type: 'string' }, body: { type: 'string' } },
      },
      scale: { type: 'string', enum: SCALES },
      radius: { type: 'string', enum: RADII },
      shadow: { type: 'string', enum: SHADOWS },
      motion: { type: 'string', enum: MOTIONS },
      texture: { type: 'string', enum: TEXTURES },
    },
    required: ['layout', 'palette', 'fonts'],
  };
}

// Extend the shared edit-mode system prompt with the art-direction north star (designBrief) and the
// instruction to emit BOTH objects via the single emit_site tool.
function artSystemPrompt(sheet, allowedServices, niche) {
  return [
    systemPrompt(sheet, allowedServices),
    '',
    'You are ALSO the ART DIRECTOR for this site. In the SAME emit_site tool call, emit a `design`',
    '(visual design tokens) alongside the grounded `contract`, so the site looks bespoke for THIS',
    'business — never templated. Choose the palette, fonts, layout, and mood from the business\'s real',
    'vibe and its photos.',
    '',
    'DESIGN DIRECTION:',
    designBrief(niche),
    '',
    'Emit BOTH a grounded `contract` and a `design` via the emit_site tool.',
  ].join('\n');
}

// The single forced tool: emit_site carries BOTH the contract and the design. tool_choice forces it so
// the model always returns structured output (no prose-only replies).
function buildBody({ sheet, allowedServices, niche, change, photos, model }) {
  return {
    model: model || 'claude-opus-4-8',
    max_tokens: 3072,
    // NB: no `temperature` — Opus 4.8 deprecated it (sending it → HTTP 400 → silent deterministic
    // fallback, i.e. the wow-build would NEVER use Opus). Default sampling is right for grounded gen.
    system: artSystemPrompt(sheet, allowedServices, niche),
    messages: [{ role: 'user', content: userMessage(null, change, photos) }],
    tools: [{
      name: 'emit_site',
      description: 'Return BOTH the grounded ContentContract (facts/copy) and the DesignSpec (visual tokens) for this business in one call.',
      input_schema: {
        type: 'object',
        properties: { contract: contractSchema(), design: designSchema() },
        required: ['contract', 'design'],
      },
    }],
    tool_choice: { type: 'tool', name: 'emit_site' },
  };
}

/**
 * applyArtDirection(lead, { change, photos, ...opts }) -> { contract, design }. Wires the real SSRF-safe
 * prod transport (util/net.js postJson) when ANTHROPIC_API_KEY is set; otherwise returns the
 * deterministic always-ships pair. Key-gated. The model id is configurable via ANTHROPIC_MODEL (or
 * opts.model; default claude-opus-4-8). `opts.fetchJson` overrides the transport so this stays
 * offline-testable. NEVER throws — any failure yields { fillDeterministic(lead), designForNiche(niche) }.
 */
export async function applyArtDirection(lead, { change, photos = [], ...opts } = {}) {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
  const fallback = () => ({ contract: fillDeterministic(lead), design: designForNiche(lead.niche) });
  if (!apiKey) return fallback();
  try {
    const { sheet, allowedServices, facts } = buildFactSheet(lead);
    const fetchJson = opts.fetchJson
      // 90s timeout: an Opus art-direction call generates a full contract+design and routinely exceeds
      // postJson's 12s default → without this it aborts (TIMEOUT) → silent deterministic fallback.
      || ((url, o) => postJson(url, JSON.parse(o.body), { headers: o.headers, timeoutMs: 90000 }));
    const resp = await fetchJson(ENDPOINT, {
      method: 'POST',
      headers: HEADERS(apiKey),
      body: JSON.stringify(buildBody({
        sheet, allowedServices, niche: lead.niche, change, photos,
        model: opts.model ?? process.env.ANTHROPIC_MODEL,
      })),
    });
    const tool = extractTool(resp, 'emit_site');
    if (!tool || typeof tool !== 'object') return fallback();
    // Ground the contract back to the verified facts (the model can't silently lie), stamp the version,
    // then validate (the real gate). The design is independently validated (always succeeds).
    const cRaw = tool.contract && typeof tool.contract === 'object' ? tool.contract : {};
    applyGroundTruth(cRaw, facts, mentionedFacts(change));
    cRaw.schemaVersion = CONTRACT_VERSION;
    const cv = validateContract(cRaw);
    return {
      contract: cv.ok ? cv.value : fillDeterministic(lead),
      design: validateDesignSpec(tool.design),
    };
  } catch {
    // Any network/parse/unexpected error => the deterministic always-ships pair.
    return fallback();
  }
}
