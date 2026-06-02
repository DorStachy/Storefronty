// Moves leads along the pipeline. Seeds from research, then advances each lead through the
// per-status handlers (build, deploy, ... more added each milestone).
import { research } from './researcher/index.js';
import { build } from './builder/index.js';
import { deploy } from './deployer/index.js';
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

// Per-status handlers, run in order each tick (more added each milestone: M3 email, ...).
const HANDLERS = {
  // M2: build the site
  discovered: async (db, lead) => {
    const site = await build(lead, config);
    db.addSite(lead.id, site);
    db.setStatus(lead.id, 'built', { slug: site.slug });
  },
  // M2: deploy to a public URL
  built: async (db, lead) => {
    const site = db.getSiteForLead(lead.id);
    const { previewUrl } = await deploy(lead, site, config);
    db.setSitePreview(site.id, previewUrl);
    db.setStatus(lead.id, 'deployed', { previewUrl });
  },
  // M3: send the cold email (to the test inbox in test mode)
  deployed: async (db, lead) => {
    const r = await sendColdEmail(db, lead, config);
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
