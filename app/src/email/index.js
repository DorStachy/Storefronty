// Email discovery — best-effort contact email for a shop, gated by the SAME identity rules as the
// rest of the pipeline. Google Places returns no email, so we search the web + any non-website
// presence (listings, Facebook About, mailto: links) and verify the address plausibly belongs to
// THIS shop (own-domain name, or co-located with the shop's phone / name+city), rejecting junk and
// conflicting-location pages. A lead is only "sendable" when it's NO_WEBSITE AND we find an email.
import { safeFetch } from '../util/net.js';
import { host, digits, last10, distinctiveTokens, registrable, nameCoverage } from '../util/text.js';

const EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi;
const JUNK_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|postmaster|mailer-daemon|abuse|privacy|webmaster|hostmaster|root|admin|example|you|your|name|email|user|test|sentry|sample)$/i;
const JUNK_DOMAIN = /(^|\.)(example\.(com|org|net)|sentry\.io|wixpress\.com|wordpress\.(com|org)|squarespace\.com|godaddy\.com|schema\.org|w3\.org|googlemail\.com\.png)/i;

const isJunkEmail = (e) => {
  const [local, domain = ''] = e.split('@');
  if (!domain || !local) return true;
  if (/\.(png|jpe?g|gif|webp|svg|css|js)$/i.test(e)) return true;   // asset filenames matched as emails
  return JUNK_LOCAL.test(local) || JUNK_DOMAIN.test(domain);
};

// Emails from free text + mailto: links, lowercased + deduped.
export function extractEmails(text) {
  const s = String(text || '');
  const set = new Set();
  for (const m of s.matchAll(/mailto:([^"'?>\s]+)/gi)) { try { set.add(decodeURIComponent(m[1]).toLowerCase()); } catch { set.add(m[1].toLowerCase()); } }
  for (const m of s.matchAll(EMAIL_RE)) set.add(m[0].toLowerCase());
  return [...set];
}

// A "City, ST" that isn't ours (and our city absent) → a different shop's page.
const locationConflict = (identity, blob) => {
  const ourCity = String(identity.city || '').toLowerCase();
  if (ourCity && blob.includes(ourCity)) return false;
  return /[a-z][a-z .'\-]+,\s*[a-z]{2}\b/i.test(blob);
};

// Verify one candidate email against the shop, using the text it was found in as corroboration.
export function scoreEmail(identity, email, context = '') {
  if (isJunkEmail(email)) return { accept: false, confidence: 'none', score: 0, reasons: ['junk'] };
  const domain = email.split('@')[1] || '';
  const blob = String(context).toLowerCase();
  const dg = digits(blob);
  const dt = distinctiveTokens(identity.name);
  const ourPhone = last10(identity.phone);
  const reasons = [];
  let score = 0;

  if (dt.some((t) => registrable(domain).includes(t))) { score += 4; reasons.push('domain_name'); }
  if (ourPhone && dg.includes(ourPhone)) { score += 4; reasons.push('phone'); }
  if (nameCoverage(identity.name, blob) >= 0.7) { score += 2; reasons.push('name'); }
  if (identity.city && blob.includes(String(identity.city).toLowerCase())) { score += 1; reasons.push('city'); }
  if (locationConflict(identity, blob)) { score -= 5; reasons.push('-conflict_city'); }

  const conflicted = reasons.includes('-conflict_city');
  let confidence = 'none';
  if (!conflicted && (reasons.includes('domain_name') || reasons.includes('phone'))) confidence = 'high';
  else if (!conflicted && reasons.includes('name') && reasons.includes('city')) confidence = 'medium';
  return { accept: confidence === 'high' || confidence === 'medium', confidence, score, reasons };
}

const rank = (c) => (c.confidence === 'high' ? 2 : c.confidence === 'medium' ? 1 : 0);

// Search a couple of queries, scan snippets + a few fetched result pages for emails, verify, and
// return the best { email, source, confidence, reasons } or { email: null }.
export async function discoverEmail(identity, { searchFn = null, fetchPage = safeFetch, cfg = {} } = {}) {
  if (!searchFn) return { email: null };
  const region = [identity.city, identity.state].filter(Boolean).join(' ');
  const queries = [`"${identity.name}" ${region} email`, `"${identity.name}" ${region} contact`];
  const seenUrls = new Set();
  const candidates = [];                                   // { email, context, source }
  const add = (text, source) => { for (const e of extractEmails(text)) candidates.push({ email: e, context: text, source }); };

  let fetchBudget = cfg.fetchBudget ?? 4;
  for (const q of queries) {
    let raw;
    try { raw = await searchFn(q); } catch { continue; }
    const results = Array.isArray(raw) ? raw : (raw?.organic || []);
    for (const r of results) {
      add(`${r.title || ''} ${r.snippet || ''}`, `serp:${host(r.url)}`);
      if (fetchBudget > 0 && r.url && !seenUrls.has(host(r.url))) {
        seenUrls.add(host(r.url));
        fetchBudget--;
        const fr = await fetchPage(r.url, { timeoutMs: cfg.timeoutMs ?? 8000 });
        if (fr?.ok && /html|text/i.test(fr.contentType || '')) add(fr.body, `page:${host(r.url)}`);
      }
    }
  }

  const scored = candidates
    .map((c) => ({ ...c, ...scoreEmail(identity, c.email, c.context) }))
    .filter((s) => s.accept)
    .sort((a, b) => rank(b) - rank(a) || b.score - a.score);
  if (!scored.length) return { email: null };
  const best = scored[0];
  return { email: best.email, source: best.source, confidence: best.confidence, reasons: best.reasons };
}
