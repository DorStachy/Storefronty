// Loads .env (if present) without overwriting already-set vars, then exposes typed config.
// No dependency — a tiny tolerant parser so a missing .env never crashes anything.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '..');

const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trimStart().startsWith('#') && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const E = process.env;
export const config = {
  mode: E.MODE === 'auto' ? 'auto' : 'review',
  dbPath: E.DB_PATH || join(ROOT, 'data', 'storefronty.db'),
  researcher: {
    engine: E.RESEARCHER_ENGINE || 'mock',
    googleKey: E.GOOGLE_PLACES_KEY || '',
  },
  search: {                                    // web search used for website + social discovery
    engine: E.SEARCH_ENGINE || 'serper',       // 'serper' (Serper.dev) | 'serpapi' (SerpApi) | 'mock'
    serperKey: E.SERPER_API_KEY || '',
    serpapiKey: E.SERPAPI_KEY || '',
  },
  mail: {
    user: E.GMAIL_USER || '',
    pass: E.GMAIL_APP_PASSWORD || '',
    fromName: E.FROM_NAME || 'Michael',
    testRecipient: E.TEST_RECIPIENT || '',
    founderEmail: E.FOUNDER_EMAIL || '',
  },
  brand: E.BRAND || 'Storefronty',
  postalAddress: E.POSTAL_ADDRESS || 'Storefronty LLC, 123 Main St, Austin, TX 78701',
  publicBaseUrl: E.PUBLIC_BASE_URL || 'http://localhost:4173',
  // The customer portal ("our site") the reply email's account-claim link points at.
  portalBaseUrl: E.PORTAL_BASE_URL || E.PUBLIC_BASE_URL || 'http://localhost:4173',
  // HMAC secret for signed approve/reject + account-claim links. MUST be set in production.
  signSecret: E.SIGN_SECRET || 'dev-sign-secret-change-me',
  // Hosting for the post-reply 48h preview: 'local' (the static server) until Cloudflare creds land.
  hosting: { engine: E.HOSTING_ENGINE || 'local', previewHours: Number(E.PREVIEW_HOURS) || 48 },
  anthropic: { apiKey: E.ANTHROPIC_API_KEY || '', model: E.ANTHROPIC_MODEL || 'claude-opus-4-8' },
  stripe: { secretKey: E.STRIPE_SECRET_KEY || '', webhookSecret: E.STRIPE_WEBHOOK_SECRET || '' },
};
