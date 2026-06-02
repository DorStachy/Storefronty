// Optional: render a real screenshot of each generated site for the cold email.
// Requires Playwright + Chromium:  npm i -D playwright && npx playwright install chromium
// Then:  npm run screenshot   (or it runs as part of npm run build)
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', 'output');

if (!existsSync(outDir)) {
  console.error('No output/ yet — run "npm run generate" first.');
  process.exit(1);
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.warn('\n  ⚠ Playwright not installed — skipping screenshots (the flow still works;');
  console.warn('    emails/dashboard show a placeholder). To enable real screenshots:');
  console.warn('      npm i -D playwright && npx playwright install chromium && npm run screenshot\n');
  process.exit(0);
}

const slugs = readdirSync(outDir).filter(d => statSync(join(outDir, d)).isDirectory());
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 });

for (const slug of slugs) {
  const file = join(outDir, slug, 'index.html');
  if (!existsSync(file)) continue;
  await page.goto(pathToFileURL(file).href, { waitUntil: 'networkidle' });
  await page.screenshot({ path: join(outDir, slug, 'screenshot.png') });
  console.log('  📸', slug);
}

await browser.close();
console.log(`\nScreenshots done for ${slugs.length} shop(s).`);
