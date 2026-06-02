// The Editor: applies a customer's requested change and re-deploys the site.
// Deterministic auto-edits cover the easy, common asks (e.g. accent colour). Anything it can't
// auto-apply is recorded verbatim so YOU can tune it in review mode (which is the point of month 1).
// Later, the AI builder will apply arbitrary changes automatically.
import { build } from '../builder/index.js';
import { deploy } from '../deployer/index.js';

const COLORS = {
  navy: '#1e3a5f', blue: '#1f6feb', red: '#c0392b', green: '#1e8e5a', purple: '#7d3cad',
  orange: '#d2691e', black: '#111111', gold: '#c8a24a', teal: '#0f8a8a', pink: '#d6336c', brown: '#6b4226',
};

export function overridesFromChange(change) {
  const o = {};
  const t = (change || '').toLowerCase();
  for (const [name, hex] of Object.entries(COLORS)) {
    if (new RegExp(`\\b${name}\\b`).test(t)) {
      o.injectHeadHtml = `<style>:root,.theme-barber,.theme-cafe{--accent:${hex} !important}</style>`;
      o.appliedColor = name;
      break;
    }
  }
  return o;
}

export async function applyEdit(db, lead, change, config) {
  const overrides = overridesFromChange(change);
  const site = await build(lead, config, overrides);          // re-renders + writes files
  const { previewUrl } = await deploy(lead, site, config);
  const existing = db.getSiteForLead(lead.id);
  if (existing) db.setSitePreview(existing.id, previewUrl);
  else db.addSite(lead.id, { ...site, previewUrl });
  return { previewUrl, applied: overrides.appliedColor ? `accent colour → ${overrides.appliedColor}` : 'recorded for your tuning' };
}
