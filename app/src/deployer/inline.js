// Bake a built site (index.html + theme.css + img/*) into ONE self-contained HTML string: the theme
// stylesheet becomes an inline <style>, and every local image becomes a data: URL. That lets a 48h
// preview live as a single Cloudflare KV value (no separate asset hosting, no R2, no cleanup). External
// links (Google Fonts) are left untouched.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };

export function inlineSite(siteDir) {
  let html = readFileSync(join(siteDir, 'index.html'), 'utf8');

  // Inline the theme stylesheet (its own <link href="./theme.css">) as a <style> block; leave the
  // external Google-Fonts <link>s alone.
  const cssPath = join(siteDir, 'theme.css');
  if (existsSync(cssPath)) {
    const css = readFileSync(cssPath, 'utf8');
    html = html.replace(/<link\b[^>]*\bhref=["']\.?\/?theme\.css["'][^>]*>/i, `<style>\n${css}\n</style>`);
  }

  // Inline every local image under img/ as a data: URL so the page is fully self-contained.
  const imgDir = join(siteDir, 'img');
  if (existsSync(imgDir)) {
    for (const file of readdirSync(imgDir)) {
      const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
      const mime = MIME[ext];
      if (!mime) continue;
      const dataUrl = `data:${mime};base64,${readFileSync(join(imgDir, file)).toString('base64')}`;
      html = html.split(`./img/${file}`).join(dataUrl).split(`img/${file}`).join(dataUrl);
    }
  }
  return html;
}
