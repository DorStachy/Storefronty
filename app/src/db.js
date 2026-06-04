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
CREATE TABLE IF NOT EXISTS seen_replies (
  message_id TEXT PRIMARY KEY, lead_id INTEGER, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS suppressions (
  email TEXT PRIMARY KEY, reason TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER, kind TEXT, payload TEXT,
  status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, decided_at TEXT
);
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER,                      -- the bound site (from the signed claim link)
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,                   -- scrypt salt:hash; null for Google-only accounts
  auth_provider TEXT DEFAULT 'password',
  plan TEXT DEFAULT 'none',             -- none|starter|pro|premium
  plan_status TEXT DEFAULT 'inactive',  -- inactive|active|past_due|canceled
  stripe_customer TEXT,
  free_change_used INTEGER DEFAULT 0,
  extra_changes INTEGER DEFAULT 0,      -- bought top-up credits (do NOT reset monthly)
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS change_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER, lead_id INTEGER, body TEXT,
  kind TEXT DEFAULT 'change',           -- change|free|extra
  status TEXT NOT NULL DEFAULT 'queued',-- queued|done
  images TEXT,                          -- JSON array of uploaded photo paths (sent with the request)
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS email_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  purpose TEXT NOT NULL,                 -- 'verify' (signup email) | 'login' (2nd factor)
  code_hash TEXT NOT NULL,               -- HMAC of the 6-digit code (never the plaintext)
  attempts INTEGER DEFAULT 0, used INTEGER DEFAULT 0,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  email TEXT PRIMARY KEY, fails INTEGER DEFAULT 0,
  window_start TEXT, locked_until TEXT   -- brute-force lockout (per email)
);
`;

const now = () => new Date().toISOString();

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  // Lightweight migration: the 48h preview expiry column (added Phase 2). IF NOT EXISTS has no
  // column form in sqlite, so guard the ALTER and ignore "duplicate column" on already-migrated DBs.
  try { db.exec('ALTER TABLE sites ADD COLUMN expires_at TEXT'); } catch { /* column already present */ }
  try { db.exec('ALTER TABLE change_requests ADD COLUMN images TEXT'); } catch { /* present */ }
  // The assistant's completion message + when the rebuild finished — so the portal CHAT (not just an
  // email) shows the owner their request was carried out. status flips 'queued' -> 'done' alongside.
  try { db.exec('ALTER TABLE change_requests ADD COLUMN result TEXT'); } catch { /* present */ }
  try { db.exec('ALTER TABLE change_requests ADD COLUMN done_at TEXT'); } catch { /* present */ }
  try { db.exec('ALTER TABLE accounts ADD COLUMN extra_changes INTEGER DEFAULT 0'); } catch { /* present */ }
  // The serialized { contract, design } the v3 site was built from — lets us regenerate the SAME site
  // at a richer tier (Pro/Premium) on purchase without another Opus call. Null for legacy/cold sites.
  try { db.exec('ALTER TABLE sites ADD COLUMN spec TEXT'); } catch { /* present */ }
  // Custom domain (Premium): the owner-supplied hostname + its verification status (none|pending|verified).
  try { db.exec('ALTER TABLE accounts ADD COLUMN custom_domain TEXT'); } catch { /* present */ }
  try { db.exec("ALTER TABLE accounts ADD COLUMN domain_status TEXT DEFAULT 'none'"); } catch { /* present */ }
  // Email verification: 0 until the owner confirms a 6-digit code we email them (security §2FA).
  try { db.exec('ALTER TABLE accounts ADD COLUMN email_verified INTEGER DEFAULT 0'); } catch { /* present */ }
  // Session version: baked into every session token; bumping it (logout) invalidates ALL prior tokens
  // server-side, so a stolen/old cookie stops working even before its own expiry.
  try { db.exec('ALTER TABLE accounts ADD COLUMN session_version INTEGER DEFAULT 0'); } catch { /* present */ }

  let inTx = false;          // re-entry guard for nested transaction() calls

  const api = {
    raw: db,
    close: () => db.close(),

    // Wrap multi-step writes (lead + event, status + event, etc.) in an explicit transaction so a
    // failure on the second statement rolls back the first — the DB never lands in a half-written
    // state. node:sqlite has no nested-transaction sugar, so we guard re-entry: an inner call just
    // runs the body (the outer COMMIT/ROLLBACK owns the boundary).
    transaction(fn) {
      if (inTx) return fn();
      db.exec('BEGIN');
      inTx = true;
      try {
        const out = fn();
        db.exec('COMMIT');
        return out;
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* ignore */ }
        throw e;
      } finally {
        inTx = false;
      }
    },

    insertLead(lead) {
      return api.transaction(() => {
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
      });
    },

    getLead: (id) => db.prepare('SELECT * FROM leads WHERE id = ?').get(id),
    getLeadByEmail: (email) => db.prepare('SELECT * FROM leads WHERE lower(email) = ?').get(String(email || '').toLowerCase().trim()),
    listLeads: (status) => status
      ? db.prepare('SELECT * FROM leads WHERE status = ? ORDER BY id').all(status)
      : db.prepare('SELECT * FROM leads ORDER BY id').all(),
    countByStatus: () => db.prepare('SELECT status, COUNT(*) n FROM leads GROUP BY status').all(),

    setStatus(id, status, payload) {
      return api.transaction(() => {
        const lead = api.getLead(id);
        if (!lead) throw new Error(`lead ${id} not found`);
        assertTransition(lead.status, status);
        db.prepare('UPDATE leads SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);
        api.recordEvent(id, `status:${status}`, payload);
        return api.getLead(id);
      });
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
      const info = db.prepare(`INSERT INTO sites (lead_id,slug,engine,html_path,screenshot_path,preview_url,version,spec,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(leadId, s.slug ?? null, s.engine ?? null, s.htmlPath ?? null,
        s.screenshotPath ?? null, s.previewUrl ?? null, s.version ?? 1, s.spec ?? null, now());
      return Number(info.lastInsertRowid);
    },
    setSocials(id, socials) {
      return api.transaction(() => {
        db.prepare('UPDATE leads SET socials = ?, updated_at = ? WHERE id = ?')
          .run(socials ? JSON.stringify(socials) : null, now(), id);
        api.recordEvent(id, 'socials', socials);
        return api.getLead(id);
      });
    },

    getSiteForLead: (leadId) => db.prepare('SELECT * FROM sites WHERE lead_id = ? ORDER BY id DESC').get(leadId),
    getSiteBySlug: (slug) => db.prepare('SELECT * FROM sites WHERE slug = ? ORDER BY id DESC').get(slug),
    setSitePreview: (siteId, url) => db.prepare('UPDATE sites SET preview_url = ? WHERE id = ?').run(url, siteId),
    setSiteScreenshot: (siteId, path) => db.prepare('UPDATE sites SET screenshot_path = ? WHERE id = ?').run(path, siteId),
    // Mark a site live at a public URL with an expiry (the 48h preview window).
    setSiteLive: (siteId, { previewUrl, expiresAt }) =>
      db.prepare('UPDATE sites SET preview_url = ?, expires_at = ? WHERE id = ?').run(previewUrl, expiresAt ?? null, siteId),
    // Drop a lead's current-site 48h trial expiry → permanent. Called when a plan is PAID (claiming
    // alone keeps the site a 48h trial). Targets the newest site row for the lead.
    setSitePermanent: (leadId) =>
      db.prepare('UPDATE sites SET expires_at = NULL WHERE id = (SELECT id FROM sites WHERE lead_id = ? ORDER BY id DESC LIMIT 1)').run(leadId),

    addMessage(leadId, m) {
      const info = db.prepare(`INSERT INTO messages (lead_id,direction,type,subject,body,provider_id,created_at)
        VALUES (?,?,?,?,?,?,?)`).run(leadId, m.direction, m.type ?? null, m.subject ?? null, m.body ?? null, m.providerId ?? null, now());
      return Number(info.lastInsertRowid);
    },
    messagesFor: (leadId) => db.prepare('SELECT * FROM messages WHERE lead_id = ? ORDER BY id').all(leadId),

    // Idempotency for the IMAP poller: never process the same inbound reply twice even if the IMAP
    // \Seen flag fails to stick — otherwise the poller re-fires the wow-build + Email 2 every cycle.
    // Keyed by the message's RFC822 Message-ID.
    replyAlreadyHandled: (mid) => !!db.prepare('SELECT 1 FROM seen_replies WHERE message_id = ?').get(String(mid || '')),
    recordHandledReply: (mid, leadId) => { try { db.prepare('INSERT OR IGNORE INTO seen_replies (message_id,lead_id,created_at) VALUES (?,?,?)').run(String(mid || ''), leadId ?? null, now()); } catch { /* ignore dup */ } },

    // --- portal accounts + change requests (Phase 3) ---
    addAccount({ leadId, email, passwordHash, authProvider = 'password' }) {
      const info = db.prepare(`INSERT INTO accounts (lead_id,email,password_hash,auth_provider,created_at)
        VALUES (?,?,?,?,?)`).run(leadId ?? null, String(email).toLowerCase().trim(), passwordHash ?? null, authProvider, now());
      return Number(info.lastInsertRowid);
    },
    getAccount: (id) => db.prepare('SELECT * FROM accounts WHERE id = ?').get(id),
    getAccountByEmail: (email) => db.prepare('SELECT * FROM accounts WHERE email = ?').get(String(email || '').toLowerCase().trim()),
    getAccountByLead: (leadId) => db.prepare('SELECT * FROM accounts WHERE lead_id = ? ORDER BY id DESC').get(leadId),
    setAccountPlan: (id, { plan, planStatus, stripeCustomer }) =>
      db.prepare('UPDATE accounts SET plan = ?, plan_status = ?, stripe_customer = COALESCE(?, stripe_customer) WHERE id = ?')
        .run(plan, planStatus, stripeCustomer ?? null, id),
    markFreeChangeUsed: (id) => db.prepare('UPDATE accounts SET free_change_used = 1 WHERE id = ?').run(id),
    // Revoke every existing session for this account (e.g. on logout) by advancing its session version.
    bumpSessionVersion: (id) => db.prepare('UPDATE accounts SET session_version = COALESCE(session_version,0) + 1 WHERE id = ?').run(id),
    addExtraChanges: (id, n) => db.prepare('UPDATE accounts SET extra_changes = COALESCE(extra_changes,0) + ? WHERE id = ?').run(n, id),
    consumeExtraChange: (id) => db.prepare('UPDATE accounts SET extra_changes = MAX(0, COALESCE(extra_changes,0) - 1) WHERE id = ?').run(id),
    // Custom domain (Premium): store the owner's hostname (status → 'pending') and update verification.
    setCustomDomain: (id, domain) => db.prepare("UPDATE accounts SET custom_domain = ?, domain_status = 'pending' WHERE id = ?").run(domain ?? null, id),
    setDomainStatus: (id, status) => db.prepare('UPDATE accounts SET domain_status = ? WHERE id = ?').run(status, id),

    addChangeRequest({ accountId, leadId, body, kind = 'change', images = null }) {
      const info = db.prepare(`INSERT INTO change_requests (account_id,lead_id,body,kind,status,images,created_at)
        VALUES (?,?,?,?,?,?,?)`).run(accountId ?? null, leadId ?? null, body ?? '', kind, 'queued', images ? JSON.stringify(images) : null, now());
      return Number(info.lastInsertRowid);
    },
    changeRequestsFor: (accountId) => db.prepare('SELECT * FROM change_requests WHERE account_id = ? ORDER BY id').all(accountId),
    // Count of quota-consuming ('change') requests in a given 'YYYY-MM' month.
    changeRequestsThisMonth: (accountId, monthPrefix) =>
      db.prepare("SELECT COUNT(*) n FROM change_requests WHERE account_id = ? AND kind = 'change' AND substr(created_at,1,7) = ?").get(accountId, monthPrefix).n,

    // The rebuild finished: mark every still-open ('queued') request for this lead 'done' and attach the
    // completion message to the most recent one (so the chat shows one "all done" reply, not one per row).
    // Returns how many requests were closed (0 ⇒ the change didn't originate from the portal). Atomic.
    markChangeRequestsDoneForLead(leadId, result) {
      return api.transaction(() => {
        const rows = db.prepare("SELECT id FROM change_requests WHERE lead_id = ? AND status = 'queued' ORDER BY id").all(leadId);
        if (!rows.length) return 0;
        const lastId = rows[rows.length - 1].id;
        const ts = now();
        for (const r of rows) db.prepare('UPDATE change_requests SET status = ?, done_at = ?, result = ? WHERE id = ?')
          .run('done', ts, r.id === lastId ? (result ?? null) : null, r.id);
        return rows.length;
      });
    },
    // Close a single request by id with its completion message (used when mirroring an email-originated
    // change into the chat thread so a claimed owner still sees it answered in the portal).
    markChangeRequestDone: (id, result) =>
      db.prepare("UPDATE change_requests SET status = 'done', done_at = ?, result = ? WHERE id = ?").run(now(), result ?? null, id),

    // --- email verification + email-code 2FA + brute-force lockout (security) ---
    setEmailVerified: (id) => db.prepare('UPDATE accounts SET email_verified = 1 WHERE id = ?').run(id),

    // Issue a fresh code, superseding any prior unused one for the same purpose (only one live at a time).
    createEmailCode({ accountId, purpose, codeHash, expiresAt }) {
      return api.transaction(() => {
        db.prepare("UPDATE email_codes SET used = 1 WHERE account_id = ? AND purpose = ? AND used = 0").run(accountId, purpose);
        const info = db.prepare('INSERT INTO email_codes (account_id,purpose,code_hash,attempts,used,expires_at,created_at) VALUES (?,?,?,0,0,?,?)')
          .run(accountId, purpose, codeHash, expiresAt, now());
        return Number(info.lastInsertRowid);
      });
    },
    latestEmailCode: (accountId, purpose) =>
      db.prepare("SELECT * FROM email_codes WHERE account_id = ? AND purpose = ? AND used = 0 ORDER BY id DESC").get(accountId, purpose),
    bumpEmailCodeAttempt: (id) => db.prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?').run(id),
    // Atomic single-use: only the FIRST caller flips used 0→1 (returns 1); a concurrent duplicate gets 0.
    consumeEmailCode: (id) => Number(db.prepare('UPDATE email_codes SET used = 1 WHERE id = ? AND used = 0').run(id).changes),

    getLoginAttempt: (email) => db.prepare('SELECT * FROM login_attempts WHERE email = ?').get(String(email || '').toLowerCase().trim()),
    recordLoginFail({ email, windowStart, fails, lockedUntil = null }) {
      db.prepare(`INSERT INTO login_attempts (email,fails,window_start,locked_until) VALUES (?,?,?,?)
        ON CONFLICT(email) DO UPDATE SET fails = excluded.fails, window_start = excluded.window_start, locked_until = excluded.locked_until`)
        .run(String(email).toLowerCase().trim(), fails, windowStart, lockedUntil);
    },
    clearLoginAttempts: (email) => db.prepare('DELETE FROM login_attempts WHERE email = ?').run(String(email || '').toLowerCase().trim()),
  };
  return api;
}
