// SQLite data layer (Node built-in node:sqlite). The single source of truth.
// openDatabase(path) returns a handle with all the query helpers the modules use.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { assertTransition } from './states.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  niche TEXT NOT NULL,
  city TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  instagram TEXT,
  has_website INTEGER DEFAULT 0,
  vibe TEXT,
  details TEXT,
  website TEXT,
  website_status TEXT,
  socials TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'discovered',
  dedup_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  slug TEXT, engine TEXT, html_path TEXT, screenshot_path TEXT, preview_url TEXT,
  version INTEGER DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER, direction TEXT, type TEXT, subject TEXT, body TEXT,
  provider_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER, type TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS suppressions (
  email TEXT PRIMARY KEY, reason TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER, kind TEXT, payload TEXT,
  status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, decided_at TEXT
);
`;

const now = () => new Date().toISOString();

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);

  const api = {
    raw: db,
    close: () => db.close(),

    insertLead(lead) {
      const ts = now();
      // Prefer the stable Google Place id for dedup; else email; else name|city.
      const placeId = (lead.source || '').startsWith('places:') ? lead.source.slice(7) : '';
      const dedup = (placeId || lead.email || `${lead.name}|${lead.city || lead.address || ''}`).toLowerCase().trim();
      const existing = db.prepare('SELECT id FROM leads WHERE dedup_key = ?').get(dedup);
      if (existing) return { id: existing.id, inserted: false };
      const info = db.prepare(`INSERT INTO leads
        (name,niche,city,address,phone,email,instagram,has_website,vibe,details,website,website_status,socials,source,status,dedup_key,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        lead.name, lead.niche, lead.city ?? null, lead.address ?? null, lead.phone ?? null,
        lead.email ?? null, lead.instagram ?? null, lead.hasWebsite ? 1 : 0, lead.vibe ?? null,
        lead.details ? JSON.stringify(lead.details) : null, lead.website ?? null, lead.website_status ?? null,
        lead.socials ? JSON.stringify(lead.socials) : null, lead.source ?? null, 'discovered', dedup, ts, ts);
      const id = Number(info.lastInsertRowid);
      api.recordEvent(id, 'discovered', { source: lead.source });
      return { id, inserted: true };
    },

    getLead: (id) => db.prepare('SELECT * FROM leads WHERE id = ?').get(id),
    getLeadByEmail: (email) => db.prepare('SELECT * FROM leads WHERE lower(email) = ?').get(String(email || '').toLowerCase().trim()),
    listLeads: (status) => status
      ? db.prepare('SELECT * FROM leads WHERE status = ? ORDER BY id').all(status)
      : db.prepare('SELECT * FROM leads ORDER BY id').all(),
    countByStatus: () => db.prepare('SELECT status, COUNT(*) n FROM leads GROUP BY status').all(),

    setStatus(id, status, payload) {
      const lead = api.getLead(id);
      if (!lead) throw new Error(`lead ${id} not found`);
      assertTransition(lead.status, status);
      db.prepare('UPDATE leads SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);
      api.recordEvent(id, `status:${status}`, payload);
      return api.getLead(id);
    },

    recordEvent: (leadId, type, payload) =>
      db.prepare('INSERT INTO events (lead_id,type,payload,created_at) VALUES (?,?,?,?)')
        .run(leadId ?? null, type, payload ? JSON.stringify(payload) : null, now()),
    eventsFor: (leadId) => db.prepare('SELECT * FROM events WHERE lead_id = ? ORDER BY id').all(leadId),
    // How many 'error' events since the lead last changed status — the consecutive-error count the
    // orchestrator uses to quarantine a perpetually-failing lead. Resets whenever status advances.
    errorsSinceLastStatus(leadId) {
      const rows = db.prepare('SELECT type FROM events WHERE lead_id = ? ORDER BY id DESC').all(leadId);
      let n = 0;
      for (const r of rows) {
        if (r.type.startsWith('status:')) break;
        if (r.type === 'error') n++;
      }
      return n;
    },

    addSuppression: (email, reason) =>
      db.prepare('INSERT OR REPLACE INTO suppressions (email,reason,created_at) VALUES (?,?,?)')
        .run(email.toLowerCase().trim(), reason ?? null, now()),
    isSuppressed: (email) =>
      !!db.prepare('SELECT 1 FROM suppressions WHERE email = ?').get((email || '').toLowerCase().trim()),

    addSite(leadId, s) {
      const info = db.prepare(`INSERT INTO sites (lead_id,slug,engine,html_path,screenshot_path,preview_url,version,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(leadId, s.slug ?? null, s.engine ?? null, s.htmlPath ?? null,
        s.screenshotPath ?? null, s.previewUrl ?? null, s.version ?? 1, now());
      return Number(info.lastInsertRowid);
    },
    setSocials(id, socials) {
      db.prepare('UPDATE leads SET socials = ?, updated_at = ? WHERE id = ?')
        .run(socials ? JSON.stringify(socials) : null, now(), id);
      api.recordEvent(id, 'socials', socials);
      return api.getLead(id);
    },

    getSiteForLead: (leadId) => db.prepare('SELECT * FROM sites WHERE lead_id = ? ORDER BY id DESC').get(leadId),
    setSitePreview: (siteId, url) => db.prepare('UPDATE sites SET preview_url = ? WHERE id = ?').run(url, siteId),

    addMessage(leadId, m) {
      const info = db.prepare(`INSERT INTO messages (lead_id,direction,type,subject,body,provider_id,created_at)
        VALUES (?,?,?,?,?,?,?)`).run(leadId, m.direction, m.type ?? null, m.subject ?? null, m.body ?? null, m.providerId ?? null, now());
      return Number(info.lastInsertRowid);
    },
    messagesFor: (leadId) => db.prepare('SELECT * FROM messages WHERE lead_id = ? ORDER BY id').all(leadId),
  };
  return api;
}
