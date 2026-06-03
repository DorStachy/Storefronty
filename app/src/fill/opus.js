// Opus reply-edit adapter (design §5.3 — review mode). When a shop owner REPLIES asking for changes
// ("make it navy and we close at 7 now, add my patio photos"), this rebuilds a validated
// ContentContract that APPLIES the requested change, via the Anthropic (Claude Opus) Messages API.
// It mirrors the Gemini cheap-fill adapter (llm.js): makeXxx({ fetchJson, apiKey, model }) returns
// an async fn, key-gated, NEVER throws, deterministic fallback. The model emits ONLY a ContentContract
// (forced tool_use → emit_contract); the validator is the real gate.
//
// GROUNDING NUANCE vs. the fill adapter: a reply can EXPLICITLY CORRECT a truthful fact ("we close at
// 7 now"). So untouched truthful fields (hours/rating/address/phone the owner did NOT mention) are
// snapped back to ground truth — the model can't silently lie — but when the change text references a
// field, the model's (owner-corrected) value for that field is kept. On ANY failure we return the
// deterministic base (the change is then left for the founder to tune in review mode).
import { buildFactSheet } from './grounding.js';
import { fillDeterministic } from './deterministic.js';
import { validateContract, CONTRACT_VERSION } from '../contract/contract.js';
import { postJson } from '../util/net.js';
// Shared Anthropic Messages-API transport + grounding helpers (also used by fill/artdirect.js). The
// forced-tool plumbing, the edit-mode grounding rules, and the snap-back logic live there so the two
// adapters stay DRY; `extractTool(resp, 'emit_contract')` is the generic form of the old extractContract.
import {
  ENDPOINT,
  ANTHROPIC_VERSION,
  contractSchema,
  systemPrompt,
  userMessage,
  mentionedFacts,
  applyGroundTruth,
  extractTool,
} from './anthropic.js';

/**
 * makeOpusEdit({ fetchJson, apiKey, model }) -> async edit(lead, { baseContract, change, photos }) -> contract
 * `fetchJson(url, options)` is an injected async function returning the parsed JSON response (tests pass
 * a fake; prod wraps util/net.js postJson). NEVER throws; always returns a valid contract. On any failure
 * (no key, network error, no tool_use, invalid contract) it returns fillDeterministic(lead) — the base —
 * and the requested change is left for the founder to tune in review mode.
 */
export function makeOpusEdit({ fetchJson, apiKey, model = 'claude-opus-4-8' } = {}) {
  return async function edit(lead, { baseContract, change, photos = [] } = {}) {
    // Key-gated: no key (or no transport) => deterministic base, no network.
    if (!apiKey || typeof fetchJson !== 'function') return fillDeterministic(lead);
    try {
      const { sheet, allowedServices, facts } = buildFactSheet(lead);
      const body = {
        model,
        max_tokens: 2048,
        // No `temperature` — Opus 4.8 deprecated it (sending it → HTTP 400 → silent fallback).
        system: systemPrompt(sheet, allowedServices),
        messages: [{ role: 'user', content: userMessage(baseContract, change, photos) }],
        tools: [{
          name: 'emit_contract',
          description: 'Return the full, updated ContentContract that applies the owner\'s requested change.',
          input_schema: contractSchema(),
        }],
        tool_choice: { type: 'tool', name: 'emit_contract' },
      };
      const resp = await fetchJson(ENDPOINT, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const parsed = extractTool(resp, 'emit_contract');
      if (!parsed) return fillDeterministic(lead);
      // Ground untouched truthful fields back to the facts (the model can't silently lie); keep the
      // owner-corrected fields. Stamp the version, then validate (the real gate).
      applyGroundTruth(parsed, facts, mentionedFacts(change));
      parsed.schemaVersion = CONTRACT_VERSION;
      const r = validateContract(parsed);
      return r.ok ? r.value : fillDeterministic(lead);
    } catch {
      // Any network/parse/unexpected error => the current site still stands (deterministic base).
      return fillDeterministic(lead);
    }
  };
}

/**
 * applyOpusEdit(lead, { baseContract, change, photos, ...opts }) -> contract. Convenience that wires the
 * real SSRF-safe prod transport (util/net.js postJson) when ANTHROPIC_API_KEY is set; otherwise returns
 * the deterministic base. Key-gated. The model id is configurable via ANTHROPIC_MODEL (or opts.model).
 * `opts.fetchJson` overrides the transport so this stays offline-testable.
 */
export async function applyOpusEdit(lead, { baseContract, change, photos = [], ...opts } = {}) {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
  if (!apiKey) return fillDeterministic(lead);
  const model = opts.model ?? process.env.ANTHROPIC_MODEL ?? undefined;
  const fetchJson = opts.fetchJson
    // 90s: Opus generation exceeds postJson's 12s default → would abort (TIMEOUT) → silent fallback.
    || ((url, options) => postJson(url, JSON.parse(options.body), { headers: options.headers, timeoutMs: 90000 }));
  const edit = makeOpusEdit({ fetchJson, apiKey, model });
  return edit(lead, { baseContract, change, photos });
}
