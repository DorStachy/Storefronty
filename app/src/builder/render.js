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

// Token-driven render: the look comes from the DesignSpec (generated CSS + Google-Fonts link), and the
// page is assembled here as a real, designed layout — a sticky nav, a cinematic hero, numbered editorial
// section headers, an adaptive gallery (1 photo → feature band, 2 → pair, 3+ → mosaic), a reviews wall,
// a combined hours/visit band, and a substantial footer. Every interpolated value is escapeHtml'd (the
// contract's shape is validated, its string VALUES are untrusted). Returns { html, css }.
export async function renderSiteV3(contract, design, { images = [], tier = 'starter', slug = '', apiBase = '' } = {}) {
  const tpl = await readFile(resolve(THEME_DIR, 'v3', 'template.html'), 'utf8');
  const c = contract;
  const imgs = (Array.isArray(images) ? images : []).filter(Boolean);
  const hero = imgs[0] || null;

  // Tier feature slots (Phase D). STARTER leaves every one '' (no nav-reveal, no script, no form, no
  // canvas) → a calm static page. Pro adds the lead-capture form + scroll-reveal; Premium additionally
  // gets the WebGL hero, a catalogue grid, and an order form. On Pro/Premium the base sections also get
  // a `data-reveal` so the whole page animates in; Starter stays static (the tier tests assert this).
  const isPro = tier === 'pro';
  const isPremium = tier === 'premium';
  const hasForm = isPro || isPremium;
  const ctaHref = hasForm ? '#contact-form' : '#visit';
  const rev = hasForm ? ' data-reveal' : '';

  // Skip-aware section numbering (a section that doesn't render leaves no gap in the 01/02/03 sequence).
  let n = 0;
  const head = (eyebrow, title) =>
    `<div class="sec-head"><span class="sec-num">${String(++n).padStart(2, '0')}</span><div><p class="eyebrow">${e(eyebrow)}</p><h2 class="sec-title">${e(title)}</h2></div></div>`;

  // --- Adaptive gallery selection (decide first so the nav knows whether to show a Gallery link) ------
  // 2 photos → show both as a pair; 3+ → the rest after the hero as a mosaic (capped). 0–1 → no gallery
  // (a lone tile or a placeholder grid reads as broken; the hero already carries the single photo).
  let gal = [];
  if (imgs.length === 2) gal = imgs;
  else if (imgs.length >= 3) gal = imgs.slice(1, 7);

  // --- NAV ---------------------------------------------------------------------------------------------
  const navHtml =
    `<nav class="nav" id="top"><div class="wrap nav-inner"><a class="brand" href="#top">${e(c.shopName)}</a>` +
    `<ul class="nav-links"><li><a href="#menu">Menu</a></li>${gal.length ? '<li><a href="#work">Gallery</a></li>' : ''}<li><a href="#visit">Visit</a></li></ul>` +
    `<a class="nav-cta" href="${e(ctaHref)}">${e(c.cta.label)}</a></div></nav>`;

  // --- HERO bits (the photo, layered tint + scrim, and the meta row) -----------------------------------
  const heroImageHtml = hero
    ? `<img class="hero-photo" src="${e(hero)}" alt="${e(c.shopName)}" loading="eager"><span class="hero-tint" aria-hidden="true"></span><span class="hero-scrim" aria-hidden="true"></span>`
    : '';
  const locale = (c.contact.addressLines || []).slice(-1)[0] || '';
  const ratingBit = c.rating.count
    ? `<span><span class="star">★</span> ${e(c.rating.stars)} · ${e(c.rating.count)} reviews</span>` : '';
  const heroMetaHtml = [ratingBit, locale ? `<span>${e(locale)}</span>` : '']
    .filter(Boolean).join('<span class="sep" aria-hidden="true"></span>');

  // --- ABOUT (editorial two-column when there's a supporting paragraph) ---------------------------------
  const paras = (c.about.paragraphs || []).filter(Boolean);
  const lead = paras[0] || c.tagline;
  const body = paras.slice(1);
  const aboutInner = body.length
    ? `<div class="about-grid"><p class="about-lead big">${e(lead)}</p><div class="about-body">${body.map((p) => `<p>${e(p)}</p>`).join('')}</div></div>`
    : `<p class="about-lead big">${e(lead)}</p>`;
  const aboutHtml = `<section id="about"${rev}><div class="wrap">${head('About', 'Our story')}${aboutInner}</div></section>`;

  // --- MENU / services ---------------------------------------------------------------------------------
  const items = c.services
    .map((s) => `<div class="item"><h3>${e(s.name)}</h3>${s.price ? `<span class="price">${e(s.price)}</span>` : ''}${s.desc ? `<p>${e(s.desc)}</p>` : ''}</div>`)
    .join('');
  const menuHtml = `<section id="menu"${rev}><div class="wrap">${head('Menu', 'What we offer')}<div class="menu">${items}</div></div></section>`;

  // --- GALLERY (adaptive) ------------------------------------------------------------------------------
  let galleryHtml = '';
  if (gal.length) {
    const galClass = gal.length >= 3 ? 'g-mosaic' : gal.length === 2 ? 'g-pair' : 'g-feature';
    const tiles = gal
      .map((src, i) => `<div class="tile"><img src="${e(src)}" alt="${e(c.galleryQueries[i] || c.shopName)}" loading="lazy"></div>`)
      .join('');
    galleryHtml = `<section id="work"${rev}><div class="wrap">${head('Gallery', 'A look inside')}<div class="gallery ${galClass}">${tiles}</div></div></section>`;
  }

  // --- REVIEWS (only when we have real highlights) ------------------------------------------------------
  const revs = (c.reviewHighlights || []).filter((r) => r && r.quote);
  let reviewsHtml = '';
  if (revs.length) {
    const quotes = revs.slice(0, 3)
      .map((r) => `<blockquote><p>${e(r.quote)}</p>${r.author ? `<cite>${e(r.author)}</cite>` : ''}</blockquote>`)
      .join('');
    reviewsHtml = `<section id="reviews"${rev}><div class="wrap">${head('Reviews', 'What people say')}<div class="reviews-grid">${quotes}</div></div></section>`;
  }

  // --- INFO / VISIT (hours + a contact card with the address, phone, and a CTA) -------------------------
  const hoursLis = c.hours.display.map((d) => `<li><span>${e(d.day)}</span><span>${e(d.value)}</span></li>`).join('');
  const hoursCol = hoursLis ? `<div><h3 class="info-h">Hours</h3><ul class="hours">${hoursLis}</ul></div>` : '<div></div>';
  const addr = `${c.contact.addressLines.map((l) => `${e(l)}<br>`).join('')}${c.contact.phone ? `<a href="tel:${e(c.contact.phone)}">${e(c.contact.phone)}</a>` : ''}`;
  const infoHtml =
    `<section id="visit"${rev}><div class="wrap">${head('Visit', 'Come say hello')}` +
    `<div class="info-grid">${hoursCol}<div class="info-card"><address class="addr">${addr}</address>` +
    `<a class="btn" href="${e(ctaHref)}">${e(c.cta.label)}</a></div></div></div></section>`;

  // --- FOOTER ------------------------------------------------------------------------------------------
  const footAddr = c.contact.addressLines.map((l) => `<li>${e(l)}</li>`).join('');
  const footPhone = c.contact.phone ? `<li><a href="tel:${e(c.contact.phone)}">${e(c.contact.phone)}</a></li>` : '';
  const footHours = c.hours.display.slice(0, 3).map((d) => `<li>${e(d.day)}: ${e(d.value)}</li>`).join('');
  const footerHtml =
    `<footer class="footer"><div class="wrap foot-grid">` +
    `<div class="foot-brand"><div class="name">${e(c.shopName)}</div><p>${e(c.tagline)}</p></div>` +
    `<div class="foot-col"><h4>Visit</h4><ul>${footAddr}${footPhone}</ul></div>` +
    `<div class="foot-col"><h4>Hours</h4><ul>${footHours || '<li class="muted">By appointment</li>'}</ul></div></div>` +
    `<div class="wrap foot-credit"><span>© ${e(c.shopName)}</span><span>Made with Storefronty</span></div></footer>`;

  const map = {
    shopName: e(c.shopName), eyebrow: e(c.eyebrow || ''), tagline: e(c.tagline),
    cssHref: './theme.css', fontsHref: e(googleFontsHref(design.fonts)), layout: e(design.layout),
    ctaLabel: e(c.cta.label), ctaHref: e(ctaHref),
    navHtml, heroImageHtml, heroMetaHtml,
    aboutHtml, menuHtml, galleryHtml, reviewsHtml, infoHtml, footerHtml,
    // Tier slots — the builders return '' for tiers that don't get the feature (so Starter is unchanged).
    heroCanvasHtml: isPremium ? heroCanvasHtml() : '',
    heroScriptHtml: isPremium ? heroScriptHtml(design) : '',
    catalogueHtml: isPremium ? catalogueHtml(c) : '',
    leadFormHtml: hasForm ? leadFormHtml(c, { slug, apiBase }) : '',
    orderFormHtml: isPremium ? orderFormHtml(c, { slug, apiBase }) : '',
    // The form-submit script (cross-origin JSON POST + thank-you) — emitted whenever a form exists.
    formScriptHtml: hasForm ? formScriptHtml(apiBase) : '',
  };
  return { html: fill(tpl, map), css: designToCss(design, { tier }) };
}
