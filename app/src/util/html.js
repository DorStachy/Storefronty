// HTML/URL escaping — every value interpolated into generated sites or outbound email MUST pass
// through these (audit: stored-XSS / email-injection via untrusted lead fields like name/instagram).
export const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Allow only safe schemes in href values; otherwise neutralize to "#".
export function safeUrl(u) {
  if (!u) return '#';
  try {
    const x = new URL(u, 'https://example.invalid');
    if (['http:', 'https:', 'tel:', 'mailto:'].includes(x.protocol)) return u;
  } catch { /* not a URL */ }
  return '#';
}
