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
      const dedup = (lead.email || `${lead.name}|${lead.address || ''}`).toLowerCase().trim();
      const existing = db.prepare('SELECT id FROM leads WHERE dedup_key = ?').get(dedup);
      if (existing) return { id: existing.id, inserted: false };
      const info = db.prepare(`INSERT INTO leads
        (name,niche,city,address,phone,email,instagram,has_website,vibe,source,status,dedup_key,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        lead.name, lead.niche, lead.city ?? null, lead.address ?? null, lead.phone ?? null,
        lead.email ?? null, lead.instagram ?? null, lead.hasWebsite ? 1 : 0, lead.vibe ?? null,
        lead.source ?? null, 'discovered', dedup, ts, ts);
      const id = Number(info.lastInsertRowid);
      api.recordEvent(id, 'discovered', { source: lead.source });
      return { id, inserted: true };
    },

    getLead: (id) => db.prepare('SELECT * FROM leads WHERE id = ?').get(id),
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
    getSiteForLead: (leadId) => db.prepare('SELECT * FROM sites WHERE lead_id = ? ORDER BY id DESC').get(leadId),
    setSitePreview: (siteId, url) => db.prepare('UPDATE sites SET preview_url = ? WHERE id = ?').run(url, siteId),
  };
  return api;
}
