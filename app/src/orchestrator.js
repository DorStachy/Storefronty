// Moves leads along the pipeline. Seeds from research, then advances each lead through the
// per-status handlers. The cold-pitch funnel (corrected with the founder): build a themed demo from
// the shop's REAL Google data → capture 3 section screenshots → send a personal email with those
// screenshots and NO live link. The live 48h link only follows after the owner replies (Phase 2).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { research } from './researcher/index.js';
import { buildSiteV2 } from './builder/build2.js';
import { fillLead } from './fill/llm.js';
import { screenshotForEmail, shotsFromDir } from './screenshot/index.js';
import { sendColdEmail } from './salesman/index.js';
import { config } from './config.js';

// Run the researcher and persist new leads as 'discovered'. Returns a summary.
export async function seedFromResearch(db, { niche, city, limit, engine, apiKey, searchFn }) {
  const leads = await research({ niche, city, limit, engine, apiKey, searchFn });
  let inserted = 0, skipped = 0;
  for (const lead of leads) {
    const { inserted: isNew } = db.insertLead(lead);
    isNew ? inserted++ : skipped++;
  }
  return { found: leads.length, inserted, skipped };
}

// Per-status handlers, run in order each tick.
const HANDLERS = {
  // Build the tailored demo from real Google data. Cheap-LLM fill when GEMINI_API_KEY is set,
  // deterministic fallback otherwise (fillLead is key-gated). Niche auto-selects the theme.
  discovered: async (db, lead) => {
    const site = await buildSiteV2(lead, { fill: (l) => fillLead(l) });
    db.addSite(lead.id, { slug: site.slug, engine: site.engine, htmlPath: site.htmlPath });
    db.setStatus(lead.id, 'built', { slug: site.slug, theme: site.renderedTheme });
  },
  // Capture the 3 section screenshots for the cold pitch (hero, services, reviews|gallery). No live
  // deploy here — the cold email carries screenshots, not a link.
  built: async (db, lead) => {
    const site = db.getSiteForLead(lead.id);
    const hasReviews = readFileSync(site.html_path, 'utf8').includes('<blockquote');
    const shotsDir = resolve(dirname(site.html_path), 'shots');
    const shots = await screenshotForEmail({ htmlPath: site.html_path, outDir: shotsDir, hasReviews });
    const ok = shots.filter((s) => s.ok).length;
    if (!ok) throw new Error('no screenshots captured');
    db.setSiteScreenshot(site.id, shotsDir);
    db.setStatus(lead.id, 'deployed', { shots: ok });
  },
  // Send the personal cold email with the screenshots attached (to the test inbox in test mode).
  deployed: async (db, lead) => {
    const site = db.getSiteForLead(lead.id);
    const shots = shotsFromDir(site.screenshot_path);
    const r = await sendColdEmail(db, lead, config, { shots });
    if (r.needsHuman) { db.setStatus(lead.id, 'needs_human', { reason: r.skipped }); return; }
    if (r.skipped) { db.recordEvent(lead.id, 'send_skipped', { reason: r.skipped }); return; }
    db.setStatus(lead.id, 'emailed', { to: r.to, dry: r.dry, id: r.id });
  },
};

// One pass over actionable leads. Safe to call repeatedly (cron tick). `handlers` is injectable for
// testing. `errorCap`: after this many consecutive errors at the same stage, quarantine the lead to
// needs_human instead of retrying it forever (and burning work/credits every tick).
export async function tick(db, { handlers = HANDLERS, errorCap = 3 } = {}) {
  const acted = [];
  for (const [status, handler] of Object.entries(handlers)) {
    for (const lead of db.listLeads(status)) {
      try {
        await handler(db, lead);
        acted.push({ id: lead.id, status });
      } catch (e) {
        db.recordEvent(lead.id, 'error', { status, message: String(e.message || e) });
        if (db.errorsSinceLastStatus(lead.id) >= errorCap) {
          db.setStatus(lead.id, 'needs_human', { reason: 'error_cap', status, lastError: String(e.message || e) });
          acted.push({ id: lead.id, status, quarantined: true });
        }
      }
    }
  }
  return acted;
}
