// Moves leads along the pipeline. Seeds from research, then advances each lead through the
// per-status handlers. The cold-pitch funnel (corrected with the founder): build a themed demo from
// the shop's REAL Google data → capture 3 section screenshots → send a personal email with those
// screenshots and NO live link. The live 48h link only follows after the owner replies (Phase 2).
import { readFileSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve, join, basename } from 'node:path';
import { research } from './researcher/index.js';
import { buildSiteV2, writeSite, writeLlmSite, slugFor, PUBLIC_DIR } from './builder/build2.js';
import { generateSiteHtml } from './builder/llmsite.js';
import { downloadPhotos } from './photos/index.js';
import { fillLead } from './fill/llm.js';
import { applyArtDirection } from './fill/artdirect.js';
import { screenshotForEmail, shotsFromDir } from './screenshot/index.js';
import { qaCheck } from './qa/index.js';
import { deploy } from './deployer/index.js';
import { classify } from './classifier/index.js';
import { sendColdEmail } from './salesman/index.js';
import { composeReplyEmail, composeUpdateEmail, claimUrl } from './salesman/replyEmail.js';
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

// A warm "all done" the claimed owner sees IN THE PORTAL CHAT once their rebuild is live (mirrors the
// voice of the immediate acknowledgement in api/index.js replyText). Not an email — the chat is the home
// of the conversation for someone who's already in the portal.
function completionText(change) {
  const s = String(change || '').replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '');
  const what = s ? `I've updated your site — “${s}” is done.` : "Your site's updated.";
  return `${what} It's live now: hit refresh or “View live site” to see it. Anything else you'd like to change?`;
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

// If the owner uploaded photos via a portal change request, copy the newest set into the site's img
// dir so the rebuild renders them (hero + gallery). Returns relative urls, or [] if none uploaded.
function portalPhotos(db, lead) {
  const acct = db.getAccountByLead(lead.id);
  if (!acct) return [];
  const withImgs = db.changeRequestsFor(acct.id).filter((r) => r.images);
  if (!withImgs.length) return [];
  let paths = [];
  try { paths = JSON.parse(withImgs[withImgs.length - 1].images) || []; } catch { return []; }
  if (!paths.length) return [];
  const dir = join(PUBLIC_DIR, slugFor(lead), 'img');
  mkdirSync(dir, { recursive: true });
  const out = [];
  paths.slice(0, 6).forEach((p, i) => { try { copyFileSync(p, join(dir, `photo-${i}.jpg`)); out.push(`img/photo-${i}.jpg`); } catch { /* skip a bad one */ } });
  return out;
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
    // Prefer the owner's portal-uploaded photos (their real photos); else fall back to Google photos.
    const portal = portalPhotos(db, lead);
    const images = portal.length ? portal : await leadImages(lead, config);
    const prevSite = db.getSiteForLead(lead.id);

    // Advance a freshly-built site through the approval gate. Transition only AFTER a successful build, so
    // a mid-rebuild failure leaves the lead on 'replied' to retry (never stranded on 'editing'). Shared
    // by both engines. auto-mode → approved; review-mode → notify founder + pending_approval.
    const advance = async (slug) => {
      db.setStatus(lead.id, 'editing', { change });
      if (config.mode === 'auto') { db.setStatus(lead.id, 'approved', { change }); return; }
      const previewPath = `${(config.publicBaseUrl || '').replace(/\/$/, '')}/${slug}/`;
      await notifyFounder(composeFounderApproval(lead, { change, previewPath, config }), config);
      db.setStatus(lead.id, 'pending_approval', { change });
    };

    // PRIMARY: Opus writes the WHOLE page. On an edit, pass the current LLM page as the base so it
    // modifies in place (preserving the approved design). Sanitized + always-ships-safe inside.
    let baseHtml = null;
    if (prevSite && prevSite.engine === 'llm-html') { try { baseHtml = readFileSync(prevSite.html_path, 'utf8'); } catch { baseHtml = null; } }
    const llmHtml = await generateSiteHtml(lead, { change, baseHtml, imageFiles: images });
    if (llmHtml) {
      const built = await writeLlmSite(lead, { html: llmHtml });
      // Grounding/QA: the shop name must be present (the key anti-hallucination check) and the page must
      // render clean + be self-contained. Phone format varies, so it's prompt-instructed, not QA-gated.
      const qa = await qaCheck({ htmlPath: built.htmlPath, mustInclude: [lead.name].filter(Boolean) });
      if (qa.ok) {
        db.addSite(lead.id, { slug: built.slug, engine: built.engine, htmlPath: built.htmlPath });
        await advance(built.slug);
        return;
      }
      db.recordEvent(lead.id, 'llm_qa_failed', { issues: qa.issues.map((i) => i.type) }); // → token fallback below
    }

    // FALLBACK (always-ships): today's token engine. On a non-style edit it preserves the cached design.
    let base = null;
    try { base = prevSite && prevSite.spec ? JSON.parse(prevSite.spec) : null; } catch { base = null; }
    const { contract, design } = await applyArtDirection(lead, { change, photos: [], baseContract: base && base.contract, baseDesign: base && base.design });
    const built = await writeSite(lead, contract, { design, images, apiBase: config.portalBaseUrl });
    const qa = await qaCheck({ htmlPath: built.htmlPath, mustInclude: [contract.shopName, contract.contact?.phone].filter(Boolean) });
    if (!qa.ok) { db.setStatus(lead.id, 'needs_human', { reason: 'qa_failed', issues: qa.issues.map((i) => i.type) }); return; }
    db.addSite(lead.id, { slug: built.slug, engine: built.engine, htmlPath: built.htmlPath, spec: JSON.stringify({ contract, design }) });
    await advance(built.slug);
  },

  // Build is approved (auto-mode, the signed endpoint, or the CLI) → deploy the site live. How we tell the
  // owner depends on whether they've CLAIMED their account yet:
  //   • Claimed (they're in the portal) → answer IN THE CHAT, live. No second email — and never the
  //     account-claim link again (they've already claimed). The portal is the conversation now.
  //   • Not claimed (a cold lead's first reply) → send the two-link reply email (live site + claim link).
  approved: async (db, lead) => {
    const site = db.getSiteForLead(lead.id);
    const acct = db.getAccountByLead(lead.id);
    // An owner on an active paid plan keeps the site PERMANENT (don't re-stamp a 48h TTL); else it's a trial.
    const permanent = !!(acct && acct.plan_status === 'active');
    const { previewUrl, expiresAt } = await deploy(lead, site, config, { permanent });
    db.setSiteLive(site.id, { previewUrl, expiresAt });
    const change = latestChange(db, lead.id);

    if (acct) {
      // Close the portal request(s) with a completion the chat will show. If the change came by email (no
      // open portal request), mirror it into the thread so the owner still sees it answered in the portal.
      const result = completionText(change);
      const closed = db.markChangeRequestsDoneForLead(lead.id, result);
      if (!closed) db.markChangeRequestDone(db.addChangeRequest({ accountId: acct.id, leadId: lead.id, body: change || '', kind: 'email' }), result);
      db.recordEvent(lead.id, 'portal_change_done', { change, previewUrl });
      // Plus a SHORT, no-claim-link "it's live" email alongside the live chat reply (the owner wants both).
      const to = config.mail.testRecipient || lead.email || acct.email;
      if (to) {
        const { subject, text, html } = composeUpdateEmail(lead, { siteUrl: previewUrl, changeSummary: change, config });
        const res = await sendEmail({ to, subject, html, text }, config);
        db.addMessage(lead.id, { direction: 'out', type: 'update', subject, body: text, providerId: res.id });
      }
      db.setStatus(lead.id, 'link_sent', { via: 'portal', previewUrl, expiresAt });
      return;
    }

    const recipient = config.mail.testRecipient || lead.email;
    if (!recipient) { db.setStatus(lead.id, 'needs_human', { reason: 'no recipient for reply email' }); return; }
    const { subject, text, html } = composeReplyEmail(lead, {
      siteUrl: previewUrl, claimUrl: claimUrl(lead, config), changeSummary: change, config,
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
