// contract + theme -> a complete HTML page. The contract is trusted-SHAPE (validated) but its
// string VALUES are untrusted (from Google / the model), so every value is escapeHtml'd.
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml } from '../util/html.js';

const here = dirname(fileURLToPath(import.meta.url));
const THEME_DIR = resolve(here, '..', '..', 'site', 'themes');

const e = escapeHtml;
const fill = (tpl, map) => tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in map ? map[k] : ''));

export async function renderContract(contract, theme = 'editorial', { cssHref = './theme.css' } = {}) {
  const tpl = await readFile(resolve(THEME_DIR, theme, 'template.html'), 'utf8');
  const c = contract;
  const map = {
    shopName: e(c.shopName),
    eyebrow: e(c.eyebrow || ''),
    tagline: e(c.tagline),
    cssHref: e(cssHref),
    ctaLabel: e(c.cta.label),
    aboutHtml: c.about.paragraphs.map((p) => `<p>${e(p)}</p>`).join(''),
    servicesHtml: c.services
      .map(
        (s) =>
          `<div class="card"><h3>${e(s.name)}</h3>${s.price ? `<span class="price">${e(s.price)}</span>` : ''}<p>${e(s.desc)}</p></div>`,
      )
      .join(''),
    hoursHtml: c.hours.display.map((d) => `<li><span>${e(d.day)}</span><span>${e(d.value)}</span></li>`).join(''),
    ratingHtml: c.rating.count
      ? `<span class="star">★</span> ${e(c.rating.stars)} · ${e(c.rating.count)} Google reviews`
      : '',
    reviewsHtml: (c.reviewHighlights || [])
      .map((r) => `<blockquote>${e(r.quote)}${r.author ? `<cite>${e(r.author)}</cite>` : ''}</blockquote>`)
      .join(''),
    galleryHtml: c.galleryQueries
      .slice(0, 3)
      .map((q) => `<div class="tile" data-query="${e(q)}"><span class="cap">${e(q)}</span></div>`)
      .join(''),
    contactHtml: `${c.contact.addressLines.map((l) => `<div>${e(l)}</div>`).join('')}${
      c.contact.phone ? `<div>${e(c.contact.phone)}</div>` : ''
    }`,
  };
  return { html: fill(tpl, map), theme };
}
