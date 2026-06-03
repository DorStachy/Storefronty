// Generate a full, self-contained stylesheet for site/themes/v3/template.html from validated tokens.
// CSS custom properties hold the palette/scale/radius/shadow; rules below style every element the
// template emits (hero, .menu .item, .gallery .tile, .hours li, blockquote, etc.). No @import / url()
// — fonts arrive via a <link> the renderer injects, keeping the inlined KV blob self-contained.
const SCALE = { compact: { unit: '6px', h1: '2.6rem', pad: '56px' }, comfortable: { unit: '8px', h1: '3.2rem', pad: '88px' }, spacious: { unit: '10px', h1: '4rem', pad: '120px' } };
const RADIUS = { sharp: '0px', soft: '14px', round: '28px' };
const SHADOW = { none: 'none', subtle: '0 1px 2px rgba(0,0,0,.18)', lifted: '0 24px 60px -28px rgba(0,0,0,.55)' };

export function designToCss(d, { tier = 'starter' } = {}) {
  const s = SCALE[d.scale] || SCALE.comfortable;
  const motion = d.motion === 'subtle';
  const grad = d.texture === 'gradient'
    ? `radial-gradient(1200px 600px at 70% -10%, color-mix(in srgb, var(--accent) 18%, transparent), transparent), var(--bg)`
    : 'var(--bg)';
  // Tier CSS is APPENDED after the base sheet; STARTER appends nothing → byte-identical to the
  // original output (and keeps the `motion:'none' → no transitions` guarantee, since the base sheet
  // is unchanged). Pro adds reveal + tilt; Premium adds those plus the WebGL hero layering and the
  // form/catalogue styling. Every motion rule lives inside @media (prefers-reduced-motion:
  // no-preference){…} so reduced-motion and headless QA get a calm, static, valid page.
  const tierCss = tier === 'pro' || tier === 'premium' ? tierStyles(tier) : '';
  return `:root{
  --bg:${d.palette.bg}; --surface:${d.palette.surface}; --ink:${d.palette.ink};
  --muted:${d.palette.muted}; --accent:${d.palette.accent}; --accent-ink:${d.palette.accentInk};
  --radius:${RADIUS[d.radius]}; --shadow:${SHADOW[d.shadow]}; --unit:${s.unit};
  --font-display:'${d.fonts.display}',Georgia,serif; --font-body:'${d.fonts.body}',system-ui,sans-serif;
}
*{box-sizing:border-box} html{scroll-behavior:smooth}
body{margin:0;background:${grad};color:var(--ink);font-family:var(--font-body);line-height:1.6;-webkit-font-smoothing:antialiased}
h1,h2,h3{font-family:var(--font-display);font-weight:600;letter-spacing:-.02em;line-height:1.05;margin:0}
h1{font-size:${s.h1}} a{color:inherit}
.wrap{max-width:1100px;margin:0 auto;padding:0 24px}
section{padding:${s.pad} 0}
.eyebrow{text-transform:uppercase;letter-spacing:.22em;font-size:.72rem;color:var(--accent);font-weight:600}
.hero{min-height:86vh;display:grid;align-items:end;position:relative;overflow:hidden}
.hero-photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero-scrim{position:absolute;inset:0;background:linear-gradient(180deg,transparent,color-mix(in srgb,var(--bg) 92%,transparent))}
.hero .wrap{position:relative;padding-bottom:${s.pad}}
.btn{display:inline-block;background:var(--accent);color:var(--accent-ink);padding:14px 28px;border-radius:999px;text-decoration:none;font-weight:600${motion ? ';transition:transform .2s ease,filter .2s ease' : ''}}
${motion ? '.btn:hover{transform:translateY(-2px);filter:brightness(1.05)}' : ''}
.menu{display:grid;gap:calc(var(--unit)*2)} .item{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid color-mix(in srgb,var(--ink) 12%,transparent);padding:calc(var(--unit)*2) 0}
.item h3{font-size:1.15rem} .item .price{color:var(--accent);font-variant-numeric:tabular-nums;white-space:nowrap}
.gallery{display:grid;grid-template-columns:repeat(3,1fr);gap:calc(var(--unit)*1.5)} .tile{aspect-ratio:4/5;border-radius:var(--radius);overflow:hidden;background:var(--surface);box-shadow:var(--shadow)}
.tile img{width:100%;height:100%;object-fit:cover}
.hours{list-style:none;padding:0;margin:0} .hours li{display:flex;justify-content:space-between;border-bottom:1px solid color-mix(in srgb,var(--ink) 10%,transparent);padding:calc(var(--unit)*1.2) 0}
blockquote{margin:0;background:var(--surface);border-radius:var(--radius);padding:calc(var(--unit)*3);box-shadow:var(--shadow)} cite{display:block;margin-top:12px;color:var(--muted);font-style:normal}
.muted{color:var(--muted)}
@media(max-width:720px){.gallery{grid-template-columns:1fr 1fr}h1{font-size:2.4rem}section{padding:56px 0}}
${tierCss}`;
}

// Tier "richness" CSS, appended after the base sheet. STARTER never calls this. The split:
//   • shared (pro + premium): scroll-reveal ([data-reveal]) + a tasteful CSS-3D tilt on .tile/cards,
//     plus the lead/order form styling — all ANIMATION/transform wrapped in
//     @media (prefers-reduced-motion: no-preference) so a reduced-motion viewer (and the headless QA
//     crawl, which forces reducedMotion:'reduce') sees a calm, fully-visible, static page.
//   • premium only: the cinematic WebGL hero layering (#hero-gl behind the photo) + the catalogue grid.
// Reveal defaults to VISIBLE (opacity:1) and is only hidden-then-revealed inside the no-preference
// media query — so if JS/animations don't run, nothing is ever stuck invisible.
function tierStyles(tier) {
  const shared = `
/* --- tier:${tier} — forms (self-contained, native POST to /api/lead) --- */
.lead,.order{max-width:680px;margin:0 auto}
.form-head{margin-bottom:calc(var(--unit)*3)}
.contact-form,.order-form{display:grid;gap:calc(var(--unit)*2)}
.contact-form label,.order-form label{display:grid;gap:8px;font-size:.92rem;color:var(--muted)}
.contact-form input,.contact-form textarea,.order-form input,.order-form select,.order-form textarea{
  font:inherit;color:var(--ink);background:var(--surface);border:1px solid color-mix(in srgb,var(--ink) 16%,transparent);
  border-radius:calc(var(--radius)/1.6);padding:12px 14px;width:100%}
.contact-form textarea,.order-form textarea{resize:vertical}
.contact-form input:focus,.contact-form textarea:focus,.order-form input:focus,.order-form select:focus,.order-form textarea:focus{
  outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
.order-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:calc(var(--unit)*2)}
.lead .btn,.order .btn{justify-self:start}
/* honeypot: off-screen but focusable-by-bots; real users never see it */
.hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none}
@media(max-width:720px){.order-grid{grid-template-columns:1fr}}
@keyframes sf-reveal{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: no-preference){
  /* On-load fade-up: pure CSS, no JS, all browsers. fill:both holds the END (visible) state, and the
     base rule below keeps content visible if animations don't run — nothing is ever stuck hidden. */
  [data-reveal]{animation:sf-reveal .8s cubic-bezier(.16,.84,.44,1) both}
  /* Where supported, upgrade to a real SCROLL-driven reveal tied to the element entering the view. */
  @supports (animation-timeline: view()){
    [data-reveal]{animation:sf-reveal linear both;animation-timeline:view();animation-range:entry 0% entry 55%}
  }
  /* tasteful CSS-3D tilt on gallery tiles + catalogue cards */
  .tile,.cat-card{transition:transform .35s ease,box-shadow .35s ease;transform-style:preserve-3d;will-change:transform}
  .tile:hover,.cat-card:hover{transform:perspective(900px) translateY(-4px) rotateX(2.5deg) rotateY(-2.5deg) scale(1.012);box-shadow:0 30px 70px -30px rgba(0,0,0,.6)}
}
/* reveal is VISIBLE by default → no JS/animation can leave content stuck hidden (reduced-motion/QA) */
[data-reveal]{opacity:1}`;

  const premium = tier === 'premium' ? `
/* --- tier:premium — cinematic WebGL hero (canvas sits BEHIND the photo) + catalogue grid --- */
#hero-gl{position:absolute;inset:0;width:100%;height:100%;display:block;z-index:0;pointer-events:none}
.hero-photo{z-index:1}
.hero-scrim{z-index:2}
.hero .wrap{z-index:3}
/* with a live GL hero, let the photo breathe a touch so the motion reads through */
@media (prefers-reduced-motion: no-preference){ .hero-photo{opacity:.92} }
.catalogue .cat-head{margin-bottom:calc(var(--unit)*3)}
.cat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:calc(var(--unit)*2)}
.cat-card{display:flex;flex-direction:column;justify-content:space-between;gap:calc(var(--unit)*2);
  background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow);padding:calc(var(--unit)*3)}
.cat-card h3{font-size:1.15rem}
.cat-card .price{color:var(--accent);font-variant-numeric:tabular-nums;align-self:start}
@media(max-width:980px){.cat-grid{grid-template-columns:1fr 1fr}}
@media(max-width:560px){.cat-grid{grid-template-columns:1fr}}` : '';

  return shared + premium + '\n';
}
