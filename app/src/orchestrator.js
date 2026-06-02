// Moves leads along the pipeline. M1: seeding from research. Later milestones add the
// build/deploy/email/reply/edit handlers keyed by status.
import { research } from './researcher/index.js';

// Run the researcher and persist new leads as 'discovered'. Returns a summary.
export async function seedFromResearch(db, { niche, city, limit, engine, apiKey }) {
  const leads = await research({ niche, city, limit, engine, apiKey });
  let inserted = 0, skipped = 0;
  for (const lead of leads) {
    const { inserted: isNew } = db.insertLead(lead);
    isNew ? inserted++ : skipped++;
  }
  return { found: leads.length, inserted, skipped };
}

// Per-status handlers get registered here as milestones land (M2 build, M3 email, ...).
const HANDLERS = {
  // 'discovered': async (db, lead) => { /* M2: build */ },
};

// One pass over actionable leads. Safe to call repeatedly (cron tick).
export async function tick(db) {
  const acted = [];
  for (const [status, handler] of Object.entries(HANDLERS)) {
    for (const lead of db.listLeads(status)) {
      try { await handler(db, lead); acted.push({ id: lead.id, status }); }
      catch (e) { db.recordEvent(lead.id, 'error', { status, message: String(e.message || e) }); }
    }
  }
  return acted;
}
