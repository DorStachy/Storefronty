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
  const hex = { type: 'string', description: 'CSS hex color, e.g. #f7f3ec (a light background) or #14110d (a dark one) — pick to fit THIS business; default to light/airy unless its vibe is genuinely dark.' };
  return {
    type: 'object',
    description: 'The visual design tokens (the "look") — chosen to fit THIS business and its photos.',
    properties: {
      layout: { type: 'string', enum: LAYOUTS },
      palette: {
        type: 'object',
        description: 'Brand palette. Prefer a light, airy background (cream / off-white / a soft tint) with deep, readable ink for most local businesses; go dark only for genuinely moody venues. Keep AA contrast.',
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
// instruction to emit BOTH objects via the single emit_site tool. When `baseDesign` is supplied this is
// an EDIT of an already-designed site: the model must PRESERVE that look and apply only the requested
// delta, never re-pick the palette/fonts on a copy/content edit.
function artSystemPrompt(sheet, allowedServices, niche, baseDesign) {
  const lines = [
    systemPrompt(sheet, allowedServices),
    '',
    'You are ALSO the ART DIRECTOR for this site. In the SAME emit_site tool call, emit a `design`',
    '(visual design tokens) alongside the grounded `contract`, so the site looks bespoke for THIS',
    'business — never templated.',
  ];
  if (baseDesign && typeof baseDesign === 'object') {
    lines.push(
      '',
      'THIS IS AN EDIT of an existing, already-designed site. Its CURRENT design tokens are:',
      '```json',
      JSON.stringify(baseDesign, null, 2),
      '```',
      'Return this EXACT design UNCHANGED — same palette, fonts, layout, scale, radius, shadow, texture —',
      'UNLESS the owner\'s change explicitly asks to alter the visual style (new colors, brighter/darker,',
      'different fonts, a new layout or mood). If it does, change ONLY the tokens that request implies and',
      'keep every other token byte-for-byte identical. NEVER redesign from scratch or re-pick the palette',
      'on a copy/tone/content/photo edit — the owner has already approved this look.',
    );
  } else {
    lines.push(
      '',
      'Choose the palette, fonts, layout, and mood from the business\'s real vibe and its photos.',
      '',
      'DESIGN DIRECTION:',
      designBrief(niche),
    );
  }
  lines.push('', 'Emit BOTH a grounded `contract` and a `design` via the emit_site tool.');
  return lines.join('\n');
}

// The single forced tool: emit_site carries BOTH the contract and the design. tool_choice forces it so
// the model always returns structured output (no prose-only replies).
function buildBody({ sheet, allowedServices, niche, change, photos, model, baseContract, baseDesign }) {
  return {
    model: model || 'claude-opus-4-8',
    max_tokens: 3072,
    // NB: no `temperature` — Opus 4.8 deprecated it (sending it → HTTP 400 → silent deterministic
    // fallback, i.e. the wow-build would NEVER use Opus). Default sampling is right for grounded gen.
    system: artSystemPrompt(sheet, allowedServices, niche, baseDesign),
    // Pass the CURRENT contract as the base so the model edits it (keeps untouched copy) instead of
    // rewriting the whole site from the fact sheet. null on the first build → a fresh generation.
    messages: [{ role: 'user', content: userMessage(baseContract ?? null, change, photos) }],
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
// Never make a REAL Opus call from the unit-test runner (a dev .env loads ANTHROPIC_API_KEY) — tests
// inject a fake `fetchJson`; without one under `node --test` we return the deterministic always-ships
// pair, so the suite costs nothing. e2e scripts (no --test) call Opus for real.
const IN_TEST = !!process.env.NODE_TEST_CONTEXT || process.execArgv.includes('--test');

export async function applyArtDirection(lead, { change, photos = [], baseContract = null, baseDesign = null, ...opts } = {}) {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
  // On an EDIT (a base is supplied), any failure must KEEP the current site, not regenerate it from
  // scratch — a failed "change the hours" edit should never wipe the owner's approved design + copy.
  const baseCv = baseContract && typeof baseContract === 'object' ? validateContract({ ...baseContract, schemaVersion: CONTRACT_VERSION }) : null;
  const fallback = () => ({
    contract: baseCv && baseCv.ok ? baseCv.value : fillDeterministic(lead),
    design: baseDesign ? validateDesignSpec(baseDesign) : designForNiche(lead.niche),
  });
  if (!apiKey) return fallback();
  if (IN_TEST && !opts.fetchJson) return fallback(); // no real Opus calls from the test runner
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
        model: opts.model ?? process.env.ANTHROPIC_MODEL, baseContract, baseDesign,
      })),
    });
    const tool = extractTool(resp, 'emit_site');
    if (!tool || typeof tool !== 'object') {
      // Observability: a non-tool response (e.g. an API error object) means Opus did NOT art-direct and
      // we shipped the deterministic look. Surface it so a misconfigured key/model is visible in logs.
      console.warn('[artdirect] Opus returned no emit_site tool_use — using deterministic fallback. resp:', JSON.stringify(resp).slice(0, 300));
      return fallback();
    }
    // Ground the contract back to the verified facts (the model can't silently lie), stamp the version,
    // then validate (the real gate).
    const cRaw = tool.contract && typeof tool.contract === 'object' ? tool.contract : {};
    applyGroundTruth(cRaw, facts, mentionedFacts(change));
    cRaw.schemaVersion = CONTRACT_VERSION;
    const cv = validateContract(cRaw);
    // Design: on an EDIT, only adopt the model's design when the owner actually asked for a VISUAL change;
    // otherwise keep the existing look verbatim, so a copy/tone/photo edit can never silently re-skin the
    // site (the bug where "change the text" flipped dark+neon → light cream).
    const styleAsked = /\b(colou?rs?|colou?red|dark(er)?|light(er)?|bright(er)?|fonts?|typeface|theme|look|styl(e|ing|ish)|palette|layout|vibe|mood|aesthetic|accent|neon|gradient|texture|grain|minimal(ist)?|bold(er)?|elegant|luxe|luxur(y|ious)|modern|sleek|vibrant|pastel|warm(er)?|cool(er)?|colou?rful|re-?design|re-?skin|re-?style|re-?brand)\b/i.test(String(change || ''));
    const design = (baseDesign && !styleAsked) ? validateDesignSpec(baseDesign) : validateDesignSpec(tool.design);
    return {
      contract: cv.ok ? cv.value : (baseCv && baseCv.ok ? baseCv.value : fillDeterministic(lead)),
      design,
    };
  } catch (e) {
    // Any network/parse/unexpected error => the deterministic always-ships pair. Log it (the wow-build
    // must never look like it "ran Opus in 2s" with no trace of why it actually fell back).
    console.warn('[artdirect] Opus call failed — using deterministic fallback:', String((e && e.message) || e).split('\n')[0]);
    return fallback();
  }
}
