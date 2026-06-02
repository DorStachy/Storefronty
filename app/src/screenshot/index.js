// Headless screenshotter (Playwright/Chromium). Renders a built site and captures
// section screenshots for the cold-pitch email: hero, services/menu, reviews(or gallery).
//
// Design: the SHOT-PLANNING is pure + offline-testable (planShots). The browser capture
// (captureSections) is a thin integration verified by a real smoke test that skips when no
// browser is available — so `npm test` stays green everywhere.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Section selectors in the shared theme templates (every theme keeps these ids/classes).
export const SECTION_SELECTORS = {
  hero: '.hero',
  services: '#services',
  reviews: '#reviews',
  gallery: '#gallery',
  hours: '#hours',
  about: '#about',
  visit: '#visit',
};

// Pick the 3 section shots for the email. Reviews are the strongest social proof, but the
// deterministic fill produces none (and the theme hides an empty reviews section) — so fall
// back to the gallery when there are no review highlights.
export function planShots({ hasReviews = false } = {}) {
  const third = hasReviews ? 'reviews' : 'gallery';
  return ['hero', 'services', third].map((name) => ({ name, selector: SECTION_SELECTORS[name] }));
}

const fileUrl = (htmlPath) => pathToFileURL(resolve(htmlPath)).href;

// Capture the planned section shots. `launch` is injectable (a fake browser in unit tests);
// in prod it defaults to Playwright's chromium. Returns [{ name, path, selector, ok }].
export async function captureSections({
  htmlPath,
  url,
  outDir,
  shots,
  viewport = { width: 1280, height: 900 },
  deviceScaleFactor = 2,
  launch,
  navTimeoutMs = 15000,
} = {}) {
  if (!outDir) throw new Error('captureSections: outDir required');
  if (!htmlPath && !url) throw new Error('captureSections: htmlPath or url required');
  mkdirSync(outDir, { recursive: true });
  const target = url || fileUrl(htmlPath);

  if (!launch) {
    const { chromium } = await import('playwright');
    launch = () => chromium.launch({ headless: true });
  }

  const browser = await launch();
  const results = [];
  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(target, { waitUntil: 'load', timeout: navTimeoutMs });
    // ensure webfonts are painted before we shoot
    await page.evaluate(() => (document.fonts && document.fonts.ready ? document.fonts.ready : null)).catch(() => {});
    for (const shot of shots) {
      const path = join(outDir, `${shot.name}.png`);
      try {
        const el = await page.$(shot.selector);
        if (!el) { results.push({ ...shot, path, ok: false, reason: 'selector not found' }); continue; }
        const box = await el.boundingBox();
        if (!box || box.width < 4 || box.height < 4) { results.push({ ...shot, path, ok: false, reason: 'not visible' }); continue; }
        await el.scrollIntoViewIfNeeded();
        await el.screenshot({ path });
        results.push({ ...shot, path, ok: true, width: Math.round(box.width), height: Math.round(box.height) });
      } catch (e) {
        results.push({ ...shot, path, ok: false, reason: e.message.split('\n')[0] });
      }
    }
    await context.close();
  } finally {
    await browser.close();
  }
  return results;
}

// Convenience: plan + capture the 3 email shots for a built site.
export async function screenshotForEmail({ htmlPath, outDir, hasReviews = false, ...opts } = {}) {
  const shots = planShots({ hasReviews });
  return captureSections({ htmlPath, outDir, shots, ...opts });
}
