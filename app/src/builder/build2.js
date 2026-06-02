// buildSiteV2: lead -> fill -> validate -> render -> write files.
// Drop-in alongside the legacy build(); the orchestrator switches over in Phase 1F.
// `fill` is dependency-injected so Phase 1B can swap in the cheap-LLM fill (with this as fallback).
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fillDeterministic } from '../fill/deterministic.js';
import { validateContract } from '../contract/contract.js';
import { themeForNiche } from '../themes/map.js';
import { renderContract } from './render.js';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(here, '..', '..', 'public');
const THEME_DIR = resolve(here, '..', '..', 'site', 'themes');
const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export async function buildSiteV2(lead, { fill = fillDeterministic } = {}) {
  const requestedTheme = themeForNiche(lead.niche);
  // Until Luxe/Bold ship (Plan 1C), fall back to the editorial template when the requested one is absent.
  const renderedTheme = existsSync(join(THEME_DIR, requestedTheme, 'template.html')) ? requestedTheme : 'editorial';

  const r = validateContract(fill(lead));
  if (!r.ok) throw new Error(`contract invalid: ${r.errors.join(', ')}`);
  const { html } = await renderContract(r.value, renderedTheme, { cssHref: './theme.css' });

  const slug = slugify(lead.name) || `lead-${lead.id || 'x'}`;
  const dir = join(PUBLIC_DIR, slug);
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(THEME_DIR, renderedTheme, 'theme.css'), join(dir, 'theme.css'));
  const htmlPath = join(dir, 'index.html');
  writeFileSync(htmlPath, html);

  return { engine: 'theme', slug, requestedTheme, renderedTheme, theme: renderedTheme, htmlPath };
}
