// Static server for app/public (the deployed sites). Run: npm run serve
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openDatabase } from './db.js';
import { config } from './config.js';
import { handleApproval } from './approval/index.js';
import { isPortalRoute, handlePortal, handleStripeWebhook } from './portal/index.js';

// Minimal request IO helpers for the portal (form POSTs + cookie sessions).
const readBody = (req) =>
  new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1_000_000) req.destroy(); });
    req.on('end', () => resolve(d));
    req.on('error', () => resolve(''));
  });
const parseForm = (s) => { const o = {}; for (const [k, v] of new URLSearchParams(s)) o[k] = v; return o; };
const parseCookies = (h) => {
  const o = {};
  String(h || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return o;
};

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(here, '..', 'public');
const PORT = process.env.PORT || 4173;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

// Resolve a request path to a safe file under publicDir, or null if it escapes. The escape check
// compares against `publicDir + sep` (not a bare startsWith) so a sibling like "public-evil" that
// merely shares the prefix is rejected. Returns the absolute file path.
export function resolveStaticPath(publicDir, urlRaw) {
  let p;
  try { p = decodeURIComponent(String(urlRaw).split('?')[0]); } catch { return null; }
  if (p === '' || p === '/' || p.endsWith('/')) p += 'index.html';
  if (!p.startsWith('/')) p = '/' + p;
  const full = resolve(publicDir, '.' + p);          // '.' + '/a/b' → resolves under publicDir
  if (full !== publicDir && !full.startsWith(publicDir + sep)) return null;
  return full;
}

// Run-as-main check that works on Windows too: compare against pathToFileURL(argv[1]) rather than
// a hand-built `file://` + path string (Windows argv[1] uses backslashes + a drive letter, so the
// naive string never matches import.meta.url and the server would silently never listen).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = openDatabase(config.dbPath);
  createServer(async (req, res) => {
    let urlPath = req.url, query = {};
    try { const u = new URL(req.url, `http://localhost:${PORT}`); urlPath = u.pathname; query = Object.fromEntries(u.searchParams); } catch { /* keep raw */ }

    // Stripe webhook needs the RAW body for signature verification.
    if (urlPath === '/stripe/webhook' && req.method === 'POST') {
      const r = await handleStripeWebhook({ rawBody: await readBody(req), signature: req.headers['stripe-signature'] || '', db, config });
      res.writeHead(r.status, { 'Content-Type': 'text/plain' }); res.end(r.body); return;
    }

    // The customer portal (§7): claim → account → dashboard → plan → changes.
    if (isPortalRoute(urlPath)) {
      const body = req.method === 'POST' ? parseForm(await readBody(req)) : {};
      const out = await handlePortal({ method: req.method, path: urlPath, query, body, cookies: parseCookies(req.headers.cookie), db, config });
      if (out) { res.writeHead(out.status, out.headers); res.end(out.body); return; }
    }

    // Signed approve/reject endpoint (§6.5): GET shows a confirm page, POST performs the action.
    const ap = handleApproval({ method: req.method, urlPath, db, config });
    if (ap) { res.writeHead(ap.status, { 'Content-Type': ap.contentType }); res.end(ap.body); return; }

    const filePath = resolveStaticPath(PUBLIC_DIR, req.url);
    if (!filePath) { res.writeHead(403).end('Forbidden'); return; }
    try {
      const data = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': TYPES[extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/html' }).end('<h1>404</h1>');
    }
  }).listen(PORT, () => console.log(`\n  Serving app/public → http://localhost:${PORT}\n`));
}
