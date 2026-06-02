// Anti-hallucination grounding (design §5.2). Turns a lead's REAL Google data into a compact
// fact structure + a human-readable "fact sheet" string that tells the model: "these are the ONLY
// facts that exist." It invents NOTHING — unknown values are null/empty, never fabricated. The
// allowed-services whitelist is reused verbatim from deterministic.js (one source of truth).
import { SERVICES, DAY3, titleCase, safeJson } from './deterministic.js';

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

// Parse Google-style "Monday: 7:15 AM – 6:00 PM" lines into { day:'Mon', value:'7:15 AM – 6:00 PM' }.
function parseHours(det) {
  return (Array.isArray(det.hours) ? det.hours : [])
    .map((line) => {
      const m = String(line).match(/^([A-Za-z]+):\s*(.+)$/);
      return m && DAY3[m[1].toLowerCase()] ? { day: DAY3[m[1].toLowerCase()], value: m[2].trim() } : null;
    })
    .filter(Boolean);
}

// Split a one-line Google address into up-to-3 display lines (mirrors deterministic.addrLines).
function addrLines(address, city) {
  if (!address) return city ? [city] : [];
  const parts = String(address).split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length > 2) return [parts[0], parts.slice(1, 3).join(', ')];
  return parts.length ? parts : (city ? [city] : []);
}

// Pull a few real review snippets (verbatim) so the model can quote NEAR-VERBATIM, never fabricate.
function reviewSnippets(det) {
  const raw = Array.isArray(det.reviews) ? det.reviews : Array.isArray(det.reviewSnippets) ? det.reviewSnippets : [];
  return raw
    .map((r) => {
      const text = String((r && (r.text ?? r.quote ?? r.snippet)) || '').replace(/\s+/g, ' ').trim();
      const author = String((r && (r.author ?? r.name)) || '').trim();
      return text.length >= 8 ? { text: text.slice(0, 300), ...(author ? { author: author.slice(0, 60) } : {}) } : null;
    })
    .filter(Boolean)
    .slice(0, 5);
}

export function buildFactSheet(lead = {}) {
  const det = lead.details ? (typeof lead.details === 'string' ? safeJson(lead.details) : lead.details) : {};
  const niche = String(lead.niche || '').toLowerCase().trim();
  const category = det.primaryType || titleCase(niche) || 'Local Business';
  const city = lead.city || '';

  // Whitelist of services the model is ALLOWED to describe. Unknown niche => empty: the model must
  // not invent specific services (the renderer/deterministic fallback covers that case generically).
  const allowedServices = (SERVICES[niche] || []).slice();

  const facts = {
    name: lead.name || '',
    category,
    niche: niche || null,
    city: city || null,
    addressLines: addrLines(lead.address, city),
    phone: lead.phone || null,
    rating: num(det.rating),
    reviewCount: num(det.reviewCount),
    hours: parseHours(det),
    reviewSnippets: reviewSnippets(det),
  };

  return { facts, allowedServices, sheet: renderSheet(facts, allowedServices) };
}

// Compact, human-readable fact sheet for the prompt. ONLY known facts appear (no undefined/NaN,
// no invented prices/awards/history). Lines are omitted entirely when the underlying fact is absent.
function renderSheet(facts, allowedServices) {
  const L = [];
  L.push('VERIFIED FACTS (the ONLY facts that exist about this business — do not add to them):');
  L.push(`- Business name: ${facts.name}`);
  L.push(`- Category: ${facts.category}`);
  if (facts.city) L.push(`- City / area served: ${facts.city}`);
  if (facts.addressLines.length) L.push(`- Address: ${facts.addressLines.join(', ')}`);
  if (facts.phone) L.push(`- Phone: ${facts.phone}`);
  if (facts.rating != null && facts.reviewCount != null) {
    L.push(`- Google rating: ${facts.rating} stars from ${facts.reviewCount} reviews`);
  } else if (facts.rating != null) {
    L.push(`- Google rating: ${facts.rating} stars`);
  } else {
    L.push('- Google rating: unknown (do not state a rating)');
  }

  if (facts.hours.length) {
    L.push('- Opening hours:');
    for (const h of facts.hours) L.push(`    ${h.day}: ${h.value}`);
  } else {
    L.push('- Opening hours: unknown (do not state hours)');
  }

  if (allowedServices.length) {
    L.push(`- Allowed services (describe ONLY these; do not invent others, and do not invent prices): ${allowedServices.join(', ')}`);
  } else {
    L.push('- Allowed services: none provided — describe the business generally; DO NOT invent specific services or prices.');
  }

  if (facts.reviewSnippets.length) {
    L.push('- Real customer review snippets (you MAY quote these NEAR-VERBATIM; quote nothing else):');
    for (const r of facts.reviewSnippets) L.push(`    "${r.text}"${r.author ? ` — ${r.author}` : ''}`);
  } else {
    L.push('- Review snippets: none provided (do not fabricate quotes or authors).');
  }

  return L.join('\n');
}
