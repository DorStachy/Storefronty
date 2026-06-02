// Storefronty Phase 0 generator (zero dependencies).
// Reads data/shops.json, fills the {{token}} templates in ../site, and writes finished
// demo sites + a per-shop pricing page + an Email 1 preview + a dashboard into ./output.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const siteDir = join(root, 'site');
const outDir = resolve(here, '..', 'output');
const { config, shops } = JSON.parse(readFileSync(resolve(here, '..', 'data', 'shops.json'), 'utf8'));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function fill(tpl, map) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (m, k) =>
    k in map ? map[k] : (console.warn('  ⚠ missing token:', k), m));
}

// fresh output
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
copyFileSync(join(siteDir, 'styles.css'), join(outDir, 'styles.css'));

const pricingTpl = readFileSync(join(siteDir, 'pricing.html'), 'utf8');
const cards = [];

for (const shop of shops) {
  const tplName = shop.niche === 'cafe' ? 'cafe.html' : 'barbershop.html';
  const tpl = readFileSync(join(siteDir, 'templates', tplName), 'utf8');
  const s = shop.services || [];
  const map = {
    ...config, ...shop,
    ratingBadge: shop.ratingBadge ?? '',
    svc1Name: s[0]?.name ?? '', svc1Desc: s[0]?.desc ?? '', svc1Price: s[0]?.price ?? '',
    svc2Name: s[1]?.name ?? '', svc2Desc: s[1]?.desc ?? '', svc2Price: s[1]?.price ?? '',
    svc3Name: s[2]?.name ?? '', svc3Desc: s[2]?.desc ?? '', svc3Price: s[2]?.price ?? '',
  };

  const shopDir = join(outDir, shop.slug);
  mkdirSync(shopDir, { recursive: true });
  writeFileSync(join(shopDir, 'index.html'), fill(tpl, map));
  writeFileSync(join(shopDir, 'pricing.html'),
    fill(pricingTpl, map).replace('href="styles.css"', 'href="../styles.css"'));
  writeFileSync(join(shopDir, 'email.html'), emailHtml(map));
  cards.push(map);
  console.log('  ✓', shop.slug, `(${shop.niche})`);
}

writeFileSync(join(outDir, 'index.html'), dashboardHtml(cards, config));
console.log(`\nGenerated ${shops.length} shop(s) → generator/output/  (run "npm run serve" to view)`);

// ---------- Email 1 preview (matches phase-0/outreach-en.md) ----------
function emailHtml(m) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Email preview · ${esc(m.shopName)}</title>
<style>
 body{margin:0;background:#f1f3f4;font-family:Arial,Helvetica,sans-serif;color:#202124}
 .frame{max-width:640px;margin:30px auto;background:#fff;border:1px solid #e0e0e0;border-radius:10px;overflow:hidden}
 .hdr{padding:16px 22px;border-bottom:1px solid #eee}
 .subj{font-size:20px;font-weight:600;margin:0 0 10px}
 .meta{font-size:13px;color:#5f6368}
 .meta b{color:#202124}
 .body{padding:22px;font-size:15px;line-height:1.6}
 .shot{display:block;width:100%;border:1px solid #e6e6e6;border-radius:8px;margin:14px 0}
 .shotfallback{display:none;place-items:center;height:300px;background:#fafafa;border:1px dashed #ccc;border-radius:8px;color:#999;margin:14px 0;text-align:center}
 .sig{color:#444}.muted{color:#80868b;font-size:12px;margin-top:18px;border-top:1px solid #eee;padding-top:12px}
 a.btnlink{color:#1a73e8;text-decoration:none}
 .tag{display:inline-block;background:#e8f0fe;color:#1967d2;font-size:11px;font-weight:700;padding:3px 8px;border-radius:6px;margin-bottom:10px}
</style></head><body>
<div class="frame">
  <div class="hdr">
    <span class="tag">EMAIL 1 · DAY 0 — PREVIEW ONLY (nothing is sent)</span>
    <p class="subj">a website for ${esc(m.shopName)} 👀</p>
    <div class="meta"><b>${esc(m.fromName)}</b> &lt;hello@${esc(m.brand.toLowerCase())}.com&gt; &nbsp;→&nbsp; ${esc(m.firstName)} &lt;${esc(m.email)}&gt;</div>
  </div>
  <div class="body">
    <p>Hi ${esc(m.firstName)},</p>
    <p>I noticed ${esc(m.shopName)} doesn't have a website yet — so I went ahead and built you one. Here's a peek:</p>
    <a href="./index.html"><img class="shot" src="./screenshot.png" alt="${esc(m.shopName)} website preview"
       onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"></a>
    <div class="shotfallback">📷 screenshot.png — run <code>npm run screenshot</code> to generate it<br>(click to open the live site)</div>
    <p>It's a real, working site, not a mockup. Tell me <b>one thing</b> you'd change — different photos,
       your hours, a section about ${esc(m.specialty)} — and I'll make the change and send you the live link.</p>
    <p>No catch, nothing to pay to look. Just reply and tell me what you'd tweak 🙂</p>
    <p class="sig">${esc(m.fromName)}<br><i>${esc(m.brand)} — websites for local businesses</i></p>
    <p style="margin-top:14px"><a class="btnlink" href="./index.html">▶ Open the live preview</a> &nbsp;·&nbsp; <a class="btnlink" href="./pricing.html">▶ Open the "make it yours" page</a></p>
    <div class="muted">${esc(m.postalAddress)} · <a href="${esc(m.unsubscribeUrl)}">Unsubscribe</a></div>
  </div>
</div>
</body></html>`;
}

// ---------- Dashboard ----------
function dashboardHtml(items, cfg) {
  const rows = items.map(m => `
    <div class="shopcard">
      <a href="./${esc(m.slug)}/index.html"><img src="./${esc(m.slug)}/screenshot.png" alt=""
        onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">
      <div class="ph">📷 screenshot pending<br><small>run npm run screenshot</small></div></a>
      <div class="pad">
        <h3>${esc(m.shopName)} <span class="badge">${esc(m.niche)}</span></h3>
        <div class="city">${esc(m.city)}</div>
        <div class="links">
          <a href="./${esc(m.slug)}/index.html">Live site →</a>
          <a href="./${esc(m.slug)}/email.html">Email preview →</a>
          <a href="./${esc(m.slug)}/pricing.html">Pricing page →</a>
        </div>
      </div>
    </div>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(cfg.brand)} — Phase 0 dashboard</title>
<style>
 body{margin:0;background:#0f1115;color:#e8e8e8;font-family:system-ui,Arial,sans-serif}
 header{padding:34px 28px;border-bottom:1px solid #23262d}
 header h1{margin:0 0 6px;font-size:26px}header p{margin:0;color:#9aa0aa}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px;padding:28px}
 .shopcard{background:#171a20;border:1px solid #262a33;border-radius:14px;overflow:hidden}
 .shopcard img{width:100%;height:200px;object-fit:cover;object-position:top;display:block}
 .ph{display:none;place-items:center;height:200px;background:#1d2129;color:#6b7280;text-align:center}
 .pad{padding:16px}.pad h3{margin:0 0 4px;font-size:18px}
 .badge{font-size:11px;background:#2a2f3a;color:#c8a24a;padding:2px 8px;border-radius:999px;vertical-align:middle}
 .city{color:#9aa0aa;font-size:14px;margin-bottom:12px}
 .links{display:flex;flex-direction:column;gap:6px}
 .links a{color:#7ab7ff;text-decoration:none;font-size:14px}
 .links a:hover{text-decoration:underline}
</style></head><body>
<header><h1>${esc(cfg.brand)} — Phase 0 dashboard</h1>
<p>${items.length} generated shop(s). Each one: a finished site, the Email 1 you'd send, and the "make it yours" pricing page. Nothing is sent — this is your local test bench.</p></header>
<div class="grid">${rows}</div>
</body></html>`;
}
