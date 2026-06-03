// Moves leads along the pipeline. Seeds from research, then advances each lead through the
// per-status handlers. The cold-pitch funnel (corrected with the founder): build a themed demo from
// the shop's REAL Google data → capture 3 section screenshots → send a personal email with those
// screenshots and NO live link. The live 48h link only follows after the owner replies (Phase 2).
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, join, basename } from 'node:path';
import { research } from './researcher/index.js';
import { buildSiteV2, writeSite, slugFor, PUBLIC_DIR } from './builder/build2.js';
import { downloadPhotos } from './photos/index.js';
import { fillLead } from './fill/llm.js';
import { applyArtDirection } from './fill/artdirect.js';
import { screenshotForEmail, shotsFromDir } from './screenshot/index.js';
import { qaCheck } from './qa/index.js';
import { deploy } from './deployer/index.js';
import { classify } from './classifier/index.js';
import { sendColdEmail } from './salesman/index.js';
import { composeReplyEmail, claimUrl } from './salesman/replyEmail.js';
import { composeFounderApproval, notifyFounder } from './notifier/index.js';
import { sendEmail } from './mailer/index.js';
import { canTransition } from './states.js';
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

// The most recent change the owner asked for (recorded by handleReply), for the reply email summary.
function latestChange(db, leadId) {
  const evs = db.eventsFor(leadId).filter((e) => e.type === 'edit_request');
  if (!evs.length) return '';
  try { return JSON.parse(evs[evs.length - 1].payload)?.change || ''; } catch { return ''; }
}

// Route an inbound reply: rules-based compliance first (opt-out/angry), then edit vs noop. An
// edit advances the lead to 'replied' so the tick handlers rebuild→QA→approval. Hard opt-out is
// instant + deterministic — never trusted to an LLM. Returns { intent, change }.
export async function handleReply(db, lead, text) {
  const { intent, change } = classify(text);
  db.addMessage(lead.id, { direction: 'in', type: 'reply', subject: intent, body: text });

  if (intent === 'opt_out') {
    const addr = lead.email || config.mail.testRecipient;
    if (addr) db.addSuppression(addr, 'opt_out');
    if (canTransition(lead.status, 'opted_out')) db.setStatus(lead.id, 'opted_out', { via: 'reply' });
    return { intent };
  }
  if (intent === 'angry') {
    if (canTransition(lead.status, 'needs_human')) db.setStatus(lead.id, 'needs_human', { reason: 'angry' });
    return { intent };
  }
  if (intent === 'question') {
    if (canTransition(lead.status, 'needs_human')) db.setStatus(lead.id, 'needs_human', { reason: 'pricing_question' });
    return { intent };
  }
  if (intent === 'auto_reply' || intent === 'other') {
    db.recordEvent(lead.id, 'reply_noop', { intent });
    return { intent };
  }
  // edit_request
  db.recordEvent(lead.id, 'edit_request', { change });
  if (canTransition(lead.status, 'replied')) db.setStatus(lead.id, 'replied', { change });
  return { intent, change };
}

// The shop's OWN Google photos as relative URLs ('img/photo-0.jpg') for the hero + gallery. Reuses
// any already-downloaded photos (so a rebuild never re-bills the Places Photo API); otherwise pulls
// them from the lead's Places photo refs. Returns [] (→ the theme's decorative fallback) on no
// key / no photos / any error — a build must never break on imagery.
async function leadImages(lead, config) {
  const dir = join(PUBLIC_DIR, slugFor(lead), 'img');
  try {
    const existing = readdirSync(dir).filter((f) => /^photo-\d+\.jpg$/.test(f)).sort();
    if (existing.length) return existing.map((f) => `img/${f}`);
  } catch { /* dir not created yet */ }
  let names = [];
  try { const d = typeof lead.details === 'string' ? JSON.parse(lead.details) : (lead.details || {}); names = Array.isArray(d.photos) ? d.photos : []; } catch { /* none */ }
  const saved = await downloadPhotos(names, dir, { apiKey: config.researcher?.googleKey });
  return saved.map((f) => `img/${basename(f)}`);
}

// Per-status handlers, run in order each tick.
const HANDLERS = {
  // Build the tailored demo from real Google data. Cheap-LLM fill when GEMINI_API_KEY is set,
  // deterministic fallback otherwise (fillLead is key-gated). Niche auto-selects the theme.
  discovered: async (db, lead) => {
    const images = await leadImages(lead, config);
    const site = await buildSiteV2(lead, { fill: (l) => fillLead(l), images });
    db.addSite(lead.id, { slug: site.slug, engine: site.engine, htmlPath: site.htmlPath });
    db.setStatus(lead.id, 'built', { slug: site.slug, theme: site.renderedTheme, photos: images.length });
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

  // The owner replied with a change → Claude Opus 4.8 art-directs a bespoke rebuild: one grounded tool
  // call emits BOTH a ContentContract (facts/copy) and a DesignSpec (palette/fonts/layout/mood), which
  // writeSite renders as the token-driven v3 site with a generated, self-contained stylesheet
  // (deterministic always-ships pair without a key). Gate it through Playwright + static QA (real shop
  // name + phone present, no external scripts/links), then route to founder approval (review mode) or
  // straight to approved (auto mode). A QA failure quarantines to needs_human rather than shipping broken.
  replied: async (db, lead) => {
    const change = latestChange(db, lead.id);
    const { contract, design } = await applyArtDirection(lead, { change, photos: [] });
    const built = await writeSite(lead, contract, { design, images: await leadImages(lead, config), apiBase: config.portalBaseUrl });
    const facts = [contract.shopName, contract.contact?.phone].filter(Boolean);
    const qa = await qaCheck({ htmlPath: built.htmlPath, mustInclude: facts });
    if (!qa.ok) { db.setStatus(lead.id, 'needs_human', { reason: 'qa_failed', issues: qa.issues.map((i) => i.type) }); return; }
    // Cache the { contract, design } the site was built from so a paid Pro/Premium upgrade can regenerate
    // the SAME bespoke site at the richer tier (motion / WebGL / forms) with no second Opus call.
    db.addSite(lead.id, { slug: built.slug, engine: built.engine, htmlPath: built.htmlPath, spec: JSON.stringify({ contract, design }) });
    // Rebuild succeeded → advance through 'editing' (the state machine's edit edge) to the approval
    // gate. Transition only now (not before the work) so a mid-rebuild failure leaves the lead on
    // 'replied' to retry, never stranded on 'editing' with no handler.
    db.setStatus(lead.id, 'editing', { change });
    if (config.mode === 'auto') { db.setStatus(lead.id, 'approved', { change }); return; }
    const previewPath = `${(config.publicBaseUrl || '').replace(/\/$/, '')}/${built.slug}/`;
    await notifyFounder(composeFounderApproval(lead, { change, previewPath, config }), config);
    db.setStatus(lead.id, 'pending_approval', { change });
  },

  // Founder approved (via the signed endpoint or the CLI) → deploy the site live for 48h and send the
  // two-link reply email (live site + signed account-claim link).
  approved: async (db, lead) => {
    const site = db.getSiteForLead(lead.id);
    // If the owner is already on an active paid plan (e.g. a later change request), keep the site
    // PERMANENT — don't re-stamp a 48h TTL. Pre-purchase this is always a 48h trial.
    const acct = db.getAccountByLead(lead.id);
    const permanent = !!(acct && acct.plan_status === 'active');
    const { previewUrl, expiresAt } = await deploy(lead, site, config, { permanent });
    db.setSiteLive(site.id, { previewUrl, expiresAt });
    const recipient = config.mail.testRecipient || lead.email;
    if (!recipient) { db.setStatus(lead.id, 'needs_human', { reason: 'no recipient for reply email' }); return; }
    const { subject, text, html } = composeReplyEmail(lead, {
      siteUrl: previewUrl, claimUrl: claimUrl(lead, config), changeSummary: latestChange(db, lead.id), config,
    });
    const res = await sendEmail({ to: recipient, subject, html, text }, config);
    db.addMessage(lead.id, { direction: 'out', type: 'email2', subject, body: text, providerId: res.id });
    db.setStatus(lead.id, 'link_sent', { to: recipient, dry: res.dry, id: res.id, expiresAt });
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
