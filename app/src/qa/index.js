// Playwright QA gate (Phase 2 §6.3). Before a customized site ships, crawl the built preview
// headlessly and assert it isn't broken: no console errors, no broken images, no broken/placeholder
// links, no leftover {{template}} tokens, and no horizontal overflow on mobile.
//
// Design mirrors the screenshotter (src/screenshot/index.js): lazy `import('playwright')`, an
// injectable `launch` (a fake browser in unit tests), file:// via pathToFileURL, and a context
// created with { viewport, reducedMotion:'reduce' }. A "broken page" is a normal RESULT
// ({ ok:false, issues }) — only an infra error (no browser) propagates to the caller's try/catch.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const fileUrl = (htmlPath) => pathToFileURL(resolve(htmlPath)).href;

// Crawl one built page and report problems. Returns { ok, issues, checked }.
//   issues  — [{ type, detail }] (type ∈ console_error | broken_image | bad_link | leftover_token | mobile_overflow)
//   checked — small summary: { imgs, links, viewport, mobile }
export async function qaCheck({
  htmlPath,
  url,
  viewport = { width: 1280, height: 900 },
  launch,
  mobileWidth = 390,
  navTimeoutMs = 15000,
} = {}) {
  if (!htmlPath && !url) throw new Error('qaCheck: htmlPath or url required');
  const target = url || fileUrl(htmlPath);

  if (!launch) {
    const { chromium } = await import('playwright');
    launch = () => chromium.launch({ headless: true });
  }

  const issues = [];
  const push = (type, detail) => issues.push(detail === undefined ? { type } : { type, detail });

  const browser = await launch();
  const checked = { imgs: 0, links: 0, viewport, mobile: { width: mobileWidth } };
  try {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const page = await context.newPage();

    // Listen BEFORE navigation so we catch errors fired during load. Any console.error or
    // uncaught page exception is a defect. (Failed subresources surface as network events, not
    // console errors — so an offline Google-Fonts stylesheet does NOT trip this.)
    page.on('console', (m) => {
      if (m.type() === 'error') push('console_error', m.text());
    });
    page.on('pageerror', (err) => push('console_error', String(err && err.message ? err.message : err)));

    await page.goto(target, { waitUntil: 'load', timeout: navTimeoutMs });
    // let webfonts settle (same as the screenshotter); ignore if unsupported
    await page.evaluate(() => (document.fonts && document.fonts.ready ? document.fonts.ready : null)).catch(() => {});

    // --- broken images: every <img> must have decoded to a non-zero intrinsic size -----------
    // Wrapped in try/catch so a hostile page can never make qaCheck throw — a probe failure is
    // recorded as a normal issue, not an exception.
    try {
      const imgs = await page.$$eval('img', (els) =>
        els.map((el) => ({ src: el.currentSrc || el.getAttribute('src') || '', natural: el.naturalWidth })),
      );
      checked.imgs = imgs.length;
      for (const img of imgs) {
        if (!(img.natural > 0)) push('broken_image', img.src || '(no src)');
      }
    } catch (e) {
      push('broken_image', `probe failed: ${String(e && e.message ? e.message : e).split('\n')[0]}`);
    }

    // --- broken/placeholder links: every <a href> must be a usable destination ---------------
    // Bad = missing/empty href, a bare "#", or a javascript: scheme. Internal anchors like
    // "#services" ARE allowed (only a lone "#" or empty/js scheme is a defect). External http(s)
    // links are accepted as-is (we don't fetch them — that'd be flaky and out of scope).
    try {
      const links = await page.$$eval('a', (els) =>
        els.map((el) => ({ href: el.getAttribute('href'), text: (el.textContent || '').trim().slice(0, 40) })),
      );
      checked.links = links.length;
      for (const link of links) {
        const href = link.href == null ? '' : link.href.trim();
        const bad = href === '' || href === '#' || /^javascript:/i.test(href);
        if (bad) push('bad_link', href === '' ? `(empty href) "${link.text}"` : href);
      }
    } catch (e) {
      push('bad_link', `probe failed: ${String(e && e.message ? e.message : e).split('\n')[0]}`);
    }

    // --- leftover template tokens: rendered HTML must not still contain "{{" -------------------
    try {
      const hasToken = await page.evaluate(() => document.documentElement.outerHTML.includes('{{'));
      if (hasToken) push('leftover_token', '{{');
    } catch (e) {
      push('leftover_token', `probe failed: ${String(e && e.message ? e.message : e).split('\n')[0]}`);
    }

    // --- mobile overflow: no horizontal scroll at a phone width -------------------------------
    // Resize the live viewport and measure scrollWidth. A small 2px slack absorbs sub-pixel
    // rounding so a pixel-perfect layout isn't flagged.
    try {
      await page.setViewportSize({ width: mobileWidth, height: viewport.height });
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      checked.mobile.scrollWidth = scrollWidth;
      if (scrollWidth > mobileWidth + 2) push('mobile_overflow', scrollWidth);
    } catch (e) {
      push('mobile_overflow', `probe failed: ${String(e && e.message ? e.message : e).split('\n')[0]}`);
    }

    await context.close();
  } finally {
    await browser.close();
  }

  return { ok: issues.length === 0, issues, checked };
}
