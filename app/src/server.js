// Static server for app/public (the deployed sites). Run: npm run serve
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openDatabase } from './db.js';
import { config } from './config.js';
import { handleApproval } from './approval/index.js';

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
    let urlPath = req.url;
    try { urlPath = new URL(req.url, `http://localhost:${PORT}`).pathname; } catch { /* keep raw */ }

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
