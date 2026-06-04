// Make a model-written HTML page safe to publish to the PUBLIC web: strip every script, all external
// resources except Google Fonts, dangerous inline attrs, and unsafe URL schemes. Regex-based (no DOM
// dependency); paired with the QA gate + inlineSite. v1 ships CSS-only sites (no JS), which removes the
// main stored-XSS vector entirely (a malicious review can't execute). Pure functions, no I/O.
const FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com/i;

export function sanitizeSiteHtml(html = '') {
  let s = String(html);
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');     // inline + external scripts (paired)
  s = s.replace(/<script\b[^>]*\/?>/gi, '');                        // stray / self-closing
  s = s.replace(/<(iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<(iframe|object|embed|base)\b[^>]*\/?>/gi, '');
  // External <link> except Google Fonts (preconnect/stylesheet to them stays).
  s = s.replace(/<link\b[^>]*>/gi, (tag) => {
    const m = tag.match(/\bhref=["']([^"']+)["']/i);
    if (m && /^https?:/i.test(m[1]) && !FONTS.test(m[1])) return '';
    return tag;
  });
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ''); // on*= event handlers
  // javascript:/vbscript:/data: (non-image) in href/src → neutralize to "#". Inline image data: URLs stay.
  s = s.replace(/\b(href|src)\s*=\s*("(?:javascript|vbscript|data):[^"]*"|'(?:javascript|vbscript|data):[^']*')/gi, (full, attr, val) => {
    if (/^["']data:image\//i.test(val)) return full;
    return `${attr}="#"`;
  });
  // Placeholder/broken anchors → an inert in-page fragment. The QA gate rejects empty / bare "#" /
  // javascript: hrefs as bad_link, and a SINGLE placeholder would otherwise discard the whole bespoke
  // page (→ the generic token-engine fallback). Valid links — "#section", tel:, mailto:, http(s),
  // data:image — are left untouched; only dead placeholders are healed.
  s = s.replace(/<a\b[^>]*>/gi, (tag) => {
    const m = tag.match(/\bhref\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i);
    const raw = m ? m[1].replace(/^["']|["']$/g, '').trim() : null;
    const bad = raw == null || raw === '' || raw === '#' || /^(?:javascript|vbscript):/i.test(raw) || /^data:(?!image\/)/i.test(raw);
    if (!bad) return tag;
    return m ? tag.replace(m[0], 'href="#main"') : tag.replace(/<a\b/i, '<a href="#main"');
  });
  return s;
}

// Pull the HTML document out of a model reply (it may wrap it in ```html fences or add prose).
export function extractHtmlDocument(text = '') {
  const s = String(text);
  const m = s.match(/<!doctype html>[\s\S]*<\/html\s*>/i) || s.match(/<html\b[\s\S]*<\/html\s*>/i);
  return m ? m[0].trim() : '';
}
