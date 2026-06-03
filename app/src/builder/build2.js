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
export const PUBLIC_DIR = resolve(here, '..', '..', 'public');
const THEME_DIR = resolve(here, '..', '..', 'site', 'themes');
const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// The public-dir slug for a lead (stable across rebuilds). Exported so the build step can locate the
// site's image folder (PUBLIC_DIR/<slug>/img) before rendering.
export const slugFor = (lead) => slugify(lead && lead.name) || `lead-${(lead && lead.id) || 'x'}`;

// Render an already-built contract into the niche theme and write the files. Shared by buildSiteV2
// (fresh build from a fill) and the Phase-2 reply-edit flow (an Opus-revised contract).
// `images` = the shop's own photos as relative URLs under the slug dir (e.g. 'img/photo-0.jpg').
// Empty → the theme's decorative fallback is used.
export async function writeSite(lead, contract, { theme, images = [] } = {}) {
  const requestedTheme = theme || themeForNiche(lead.niche);
  // Fall back to the editorial template if the requested theme isn't built (defensive; all 3 ship).
  const renderedTheme = existsSync(join(THEME_DIR, requestedTheme, 'template.html')) ? requestedTheme : 'editorial';

  const r = validateContract(contract);
  if (!r.ok) throw new Error(`contract invalid: ${r.errors.join(', ')}`);
  const { html } = await renderContract(r.value, renderedTheme, { cssHref: './theme.css', images });

  const slug = slugFor(lead);
  const dir = join(PUBLIC_DIR, slug);
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(THEME_DIR, renderedTheme, 'theme.css'), join(dir, 'theme.css'));
  const htmlPath = join(dir, 'index.html');
  writeFileSync(htmlPath, html);

  return { engine: 'theme', slug, requestedTheme, renderedTheme, theme: renderedTheme, htmlPath };
}

export async function buildSiteV2(lead, { fill = fillDeterministic, images = [] } = {}) {
  return writeSite(lead, await fill(lead), { images });
}
