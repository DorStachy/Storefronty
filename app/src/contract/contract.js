// The theme-agnostic content contract + a tiny hand-rolled validator/repairer (no deps).
// Strings are length-bounded; over-length is truncated at a word boundary (repaired, not rejected).
export const CONTRACT_VERSION = '1.0';

const truncate = (s, max) => {
  s = String(s).trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trim() + '…';
};

export function validateContract(input) {
  const repairs = [];
  const errors = [];
  const o = input && typeof input === 'object' ? input : {};
  const out = { schemaVersion: CONTRACT_VERSION };

  const str = (key, val, max, required) => {
    if (val == null || val === '') { if (required) errors.push(`missing ${key}`); return undefined; }
    const t = truncate(val, max);
    if (t !== String(val).trim()) repairs.push(`${key} truncated to ${max}`);
    return t;
  };

  out.shopName = str('shopName', o.shopName, 80, true);
  if (o.eyebrow) out.eyebrow = str('eyebrow', o.eyebrow, 40);
  out.tagline = str('tagline', o.tagline, 90, true);

  const paras = Array.isArray(o.about?.paragraphs) ? o.about.paragraphs.filter((p) => p && String(p).trim()) : [];
  if (!paras.length) errors.push('missing about.paragraphs');
  out.about = { paragraphs: paras.slice(0, 3).map((p) => truncate(p, 320)) };
  if (o.about?.heading) out.about.heading = str('about.heading', o.about.heading, 60);

  const svc = (Array.isArray(o.services) ? o.services : [])
    .filter((s) => s && String(s.name || '').trim().length >= 2 && String(s.desc || '').trim().length >= 10)
    .slice(0, 8)
    .map((s) => {
      const item = { name: truncate(s.name, 48), desc: truncate(s.desc, 160) };
      if (s.price) item.price = truncate(s.price, 24);
      return item;
    });
  if (!svc.length) errors.push('services must have at least 1 valid item');
  out.services = svc;

  const days = Array.isArray(o.hours?.display) ? o.hours.display.filter((d) => d?.day && d?.value).slice(0, 7) : [];
  if (!days.length) errors.push('missing hours.display');
  out.hours = { display: days.map((d) => ({ day: d.day, value: truncate(d.value, 40) })) };

  if (!o.rating || typeof o.rating.stars !== 'number' || typeof o.rating.count !== 'number') errors.push('missing rating');
  else { out.rating = { stars: Math.round(o.rating.stars * 10) / 10, count: Math.trunc(o.rating.count) };
         if (o.rating.blurb) out.rating.blurb = str('rating.blurb', o.rating.blurb, 100); }

  if (Array.isArray(o.reviewHighlights)) {
    out.reviewHighlights = o.reviewHighlights.filter((q) => q?.quote && String(q.quote).trim().length >= 10)
      .slice(0, 3).map((q) => { const h = { quote: truncate(q.quote, 200) }; if (q.author) h.author = truncate(q.author, 40); return h; });
  }

  const addr = Array.isArray(o.contact?.addressLines) ? o.contact.addressLines.filter(Boolean).slice(0, 3) : [];
  if (!addr.length) errors.push('missing contact.addressLines');
  out.contact = { addressLines: addr.map((l) => truncate(l, 80)) };
  if (o.contact?.phone) out.contact.phone = truncate(o.contact.phone, 24);
  if (o.contact?.areaServed) out.contact.areaServed = truncate(o.contact.areaServed, 80);

  if (!o.cta?.label) errors.push('missing cta.label');
  else out.cta = { label: truncate(o.cta.label, 28), ...(o.cta.kind ? { kind: o.cta.kind } : {}) };

  const gq = (Array.isArray(o.galleryQueries) ? o.galleryQueries : []).filter((q) => q && String(q).trim().length >= 3).slice(0, 8);
  if (gq.length < 3) errors.push('galleryQueries needs at least 3');
  out.galleryQueries = gq.map((q) => truncate(q, 60));

  if (o.accentHint) out.accentHint = o.accentHint;
  if (o.toneHint) out.toneHint = o.toneHint;

  return errors.length ? { ok: false, errors, repairs } : { ok: true, value: out, repairs };
}
