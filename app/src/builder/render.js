// contract + theme -> a complete HTML page. The contract is trusted-SHAPE (validated) but its
// string VALUES are untrusted (from Google / the model), so every value is escapeHtml'd.
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml } from '../util/html.js';
import { designToCss } from '../design/css.js';
import { googleFontsHref } from '../design/spec.js';
import { leadFormHtml, catalogueHtml, orderFormHtml, heroCanvasHtml, heroScriptHtml, formScriptHtml } from '../design/tier.js';

const here = dirname(fileURLToPath(import.meta.url));
const THEME_DIR = resolve(here, '..', '..', 'site', 'themes');

const e = escapeHtml;
const fill = (tpl, map) => tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in map ? map[k] : ''));

// `images` = the shop's own photos as relative URLs (e.g. 'img/photo-0.jpg'); images[0] becomes the
// hero, the rest the gallery. Empty → the theme's decorative fallback (gradient panel + caption tiles).
export async function renderContract(contract, theme = 'editorial', { cssHref = './theme.css', images = [] } = {}) {
  const tpl = await readFile(resolve(THEME_DIR, theme, 'template.html'), 'utf8');
  const c = contract;
  const imgs = (Array.isArray(images) ? images : []).filter(Boolean);
  const hero = imgs[0] || null;
  const galleryImgs = (imgs.length > 1 ? imgs.slice(1) : imgs).slice(0, 3); // reuse the hero if it's the only one
  const map = {
    shopName: e(c.shopName),
    eyebrow: e(c.eyebrow || ''),
    tagline: e(c.tagline),
    cssHref: e(cssHref),
    ctaLabel: e(c.cta.label),
    // The shop's own first photo fills the hero panel; '' falls back to the theme's decorative panel.
    heroImageHtml: hero ? `<img class="hero-photo" src="${e(hero)}" alt="${e(c.shopName)}" loading="eager"><span class="hero-scrim" aria-hidden="true"></span>` : '',
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
    // Real photos when we have them; the atmospheric placeholder tiles otherwise.
    galleryHtml: galleryImgs.length
      ? galleryImgs.map((src, i) => `<div class="tile"><img src="${e(src)}" alt="${e(c.galleryQueries[i] || c.shopName)}" loading="lazy"></div>`).join('')
      : c.galleryQueries
        .slice(0, 3)
        .map((q) => `<div class="tile" data-query="${e(q)}"><span class="cap">${e(q)}</span></div>`)
        .join(''),
    contactHtml: `${c.contact.addressLines.map((l) => `<div>${e(l)}</div>`).join('')}${
      c.contact.phone ? `<div>${e(c.contact.phone)}</div>` : ''
    }`,
  };
  return { html: fill(tpl, map), theme };
}

// Token-driven render: same content tokens as renderContract, but the look comes from the DesignSpec
// (generated CSS + Google-Fonts link). Returns { html, css } so writeSite can write the generated CSS.
export async function renderSiteV3(contract, design, { images = [], tier = 'starter', slug = '', apiBase = '' } = {}) {
  const tpl = await readFile(resolve(THEME_DIR, 'v3', 'template.html'), 'utf8');
  const c = contract;
  const imgs = (Array.isArray(images) ? images : []).filter(Boolean);
  const hero = imgs[0] || null;
  const galleryImgs = (imgs.length > 1 ? imgs.slice(1) : imgs).slice(0, 6);
  // Tier feature slots (Phase D). STARTER leaves every one of these '' → the template renders exactly
  // as before. Pro gets the lead-capture form; Premium additionally gets the WebGL hero (canvas +
  // inline module), a catalogue grid, and an order/reservation form. The builders are defensive and
  // escape every value; designToCss is told the tier so the matching richness CSS is appended.
  const isPro = tier === 'pro';
  const isPremium = tier === 'premium';
  const map = {
    shopName: e(c.shopName), eyebrow: e(c.eyebrow || ''), tagline: e(c.tagline),
    cssHref: './theme.css', fontsHref: e(googleFontsHref(design.fonts)), layout: e(design.layout),
    ctaLabel: e(c.cta.label),
    heroImageHtml: hero ? `<img class="hero-photo" src="${e(hero)}" alt="${e(c.shopName)}" loading="eager"><span class="hero-scrim" aria-hidden="true"></span>` : '',
    aboutHtml: c.about.paragraphs.map((p) => `<p>${e(p)}</p>`).join(''),
    servicesHtml: c.services.map((s) => `<div class="item"><div><h3>${e(s.name)}</h3><p class="muted">${e(s.desc)}</p></div>${s.price ? `<span class="price">${e(s.price)}</span>` : ''}</div>`).join(''),
    hoursHtml: c.hours.display.map((d) => `<li><span>${e(d.day)}</span><span>${e(d.value)}</span></li>`).join(''),
    ratingHtml: c.rating.count ? `<span class="star">★</span> ${e(c.rating.stars)} · ${e(c.rating.count)} Google reviews` : '',
    reviewsHtml: (c.reviewHighlights || []).map((r) => `<blockquote>${e(r.quote)}${r.author ? `<cite>${e(r.author)}</cite>` : ''}</blockquote>`).join(''),
    galleryHtml: galleryImgs.length ? galleryImgs.map((src, i) => `<div class="tile"><img src="${e(src)}" alt="${e(c.galleryQueries[i] || c.shopName)}" loading="lazy"></div>`).join('') : c.galleryQueries.slice(0, 3).map((q) => `<div class="tile"><span class="cap">${e(q)}</span></div>`).join(''),
    contactHtml: `${c.contact.addressLines.map((l) => `<div>${e(l)}</div>`).join('')}${c.contact.phone ? `<div><a href="tel:${e(c.contact.phone)}">${e(c.contact.phone)}</a></div>` : ''}`,
    // Tier slots — the builders return '' for tiers that don't get the feature (so Starter is unchanged).
    heroCanvasHtml: isPremium ? heroCanvasHtml() : '',
    heroScriptHtml: isPremium ? heroScriptHtml(design) : '',
    catalogueHtml: isPremium ? catalogueHtml(c) : '',
    leadFormHtml: isPro || isPremium ? leadFormHtml(c, { slug, apiBase }) : '',
    orderFormHtml: isPremium ? orderFormHtml(c, { slug, apiBase }) : '',
    // The form-submit script (cross-origin JSON POST + thank-you) — emitted whenever a form exists.
    formScriptHtml: isPro || isPremium ? formScriptHtml(apiBase) : '',
  };
  return { html: fill(tpl, map), css: designToCss(design, { tier }) };
}
