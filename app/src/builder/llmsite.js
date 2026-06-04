// Opus writes the WHOLE site. One Messages call → one complete, self-contained HTML document. We give
// it the verified facts, a design brief, the exact image filenames it may use, and (on an edit) the
// current page to modify in place. Output is run through sanitizeSiteHtml. NEVER throws; returns null on
// no-key / error / a reply with no HTML, so the caller falls back to the token engine (always-ships).
import { buildFactSheet } from '../fill/grounding.js';
import { designBrief } from '../design/playbook.js';
import { postJson } from '../util/net.js';
import { ENDPOINT, HEADERS } from '../fill/anthropic.js';
import { sanitizeSiteHtml, extractHtmlDocument } from './sanitizeHtml.js';

// Never make a REAL Opus call from the unit-test runner (a dev .env loads ANTHROPIC_API_KEY) — that
// would cost money + slow every run. Tests inject a fake `fetchJson`; without one under `node --test`
// we return null so the caller falls back to the token engine. e2e scripts (no --test) call for real.
const IN_TEST = !!process.env.NODE_TEST_CONTEXT || process.execArgv.includes('--test');

export function systemPrompt(niche, imageFiles, baseHtml) {
  const imgs = imageFiles && imageFiles.length
    ? `You have ${imageFiles.length} real photo(s) to work with, at these EXACT paths: ${imageFiles.join(', ')} (use these paths verbatim — never invent any other image URL). Use them wherever they make the page sing: a full-bleed hero, a dedicated gallery / "our work" section, feature blocks. If the owner asks for a section built around their photos, BUILD that section for real — a proper, beautiful new block — never just swap photos into an existing one.`
    : 'No photos are available — design a striking photo-free page (typographic hero, color, texture, shape).';
  return [
    'You are the owner’s personal, world-class web designer and front-end developer — the kind of partner',
    'who not only does exactly what they ask but elevates it, delighting them with something better than',
    'they pictured. Output ONE complete, self-contained HTML document for their small local business:',
    'distinctive, memorable, genuinely designed — never templated or generic. Strong type hierarchy, a',
    'confident palette, generous spacing, real depth and atmosphere, fully responsive (mobile-first, no',
    'horizontal overflow). Take initiative on craft, polish, and the little touches that feel premium.',
    '',
    'The ONE thing you must never do is invent facts about the business. Be boldly creative with design,',
    'layout, structure, sections, copy tone and styling — but use ONLY the verified facts below; never',
    'fabricate services, prices, awards, hours, reviews, or any claim that isn’t given to you.',
    '',
    'TECHNICAL RULES (the page ships as a single self-contained file on the public web):',
    '1. ALL CSS inline in one <style> in <head>. 2. NO JavaScript — emit NO <script> tags. 3. No external',
    'resources EXCEPT Google Fonts (<link> to fonts.googleapis.com / fonts.gstatic.com only). 4. ' + imgs,
    '5. HTML-escape any business-supplied text you embed (shop name, review quotes). 6. Include the shop',
    'name and phone number on the page.',
    '7. This is ONE single self-contained page — there are NO other pages or files. If the owner asks for a',
    '"new page", build it as a new SECTION in THIS document (give it an id; you may link to it with a',
    'same-page anchor). Every <a> must have a real, working destination: a same-page "#section-id" that',
    'actually exists, a tel:/mailto: link, or a real external URL (e.g. their socials). NEVER output',
    'href="#", an empty href, a javascript: link, or a link to a separate .html file or path.',
    '',
    'DESIGN DIRECTION (inspiration to build on and improve — not a cage): ' + designBrief(niche),
    baseHtml
      ? '\nThis is an EDIT of the page below. Fully deliver what the owner asks: if they ask to ADD something (a new section, gallery, block, testimonial strip, etc.), genuinely ADD it as a real, polished part of the page — never collapse an "add" into merely swapping or relabeling existing content. Keep the look and the parts they’re clearly happy with (only change the visual style if they ask for it), and feel free to refine the surrounding details so the whole page feels cohesive and even better than before. Return the FULL updated document.'
      : '',
    '\nReturn ONLY the HTML document (start with <!doctype html>). No markdown, no commentary.',
  ].join('\n');
}

export async function generateSiteHtml(lead, { change, baseHtml = null, imageFiles = [], ...opts } = {}) {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
  if (!apiKey) return null;
  if (IN_TEST && !opts.fetchJson) return null; // no real Opus calls from the test runner; fake → still runs
  try {
    const { sheet } = buildFactSheet(lead);
    const user = [
      'VERIFIED FACTS:', sheet, '',
      baseHtml ? 'CURRENT PAGE (edit this):\n```html\n' + baseHtml + '\n```\n' : '',
      "THE OWNER'S REQUEST:", String(change || '').trim() || 'Design the best possible site for this business.',
    ].join('\n');
    const model = opts.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8';
    const fetchJson = opts.fetchJson || ((url, o) => postJson(url, JSON.parse(o.body), { headers: o.headers, timeoutMs: 120000 }));
    const resp = await fetchJson(ENDPOINT, {
      method: 'POST',
      headers: HEADERS(apiKey),
      body: JSON.stringify({ model, max_tokens: 20000, system: systemPrompt(lead.niche, imageFiles, baseHtml), messages: [{ role: 'user', content: user }] }),
    });
    const text = (resp && Array.isArray(resp.content) ? resp.content : []).filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
    const doc = extractHtmlDocument(text);
    if (!doc) { console.warn('[llmsite] model returned no HTML document — falling back to the token engine'); return null; }
    return sanitizeSiteHtml(doc);
  } catch (e) {
    console.warn('[llmsite] generation failed — falling back to the token engine:', String((e && e.message) || e).split('\n')[0]);
    return null;
  }
}
