// Generate a full, self-contained stylesheet for site/themes/v3/template.html from validated tokens.
// CSS custom properties hold the palette/scale/radius/shadow; rules below style every element the
// template emits (nav, hero, .sec-head, .menu .item, .gallery variants, .info, footer, blockquote…).
// No @import / url(http…) — fonts arrive via a <link> the renderer injects and the only url() is an
// inline data: SVG grain, so the inlined KV blob stays self-contained.
const SCALE = {
  compact:     { unit: '6px',  pad: '64px',  gap: '40px', h1: 'clamp(2.3rem,6vw,3.4rem)', lead: '1.15rem' },
  comfortable: { unit: '8px',  pad: '92px',  gap: '56px', h1: 'clamp(2.8rem,7vw,4.6rem)', lead: '1.3rem' },
  spacious:    { unit: '10px', pad: '116px', gap: '72px', h1: 'clamp(3.2rem,7.5vw,5.6rem)', lead: '1.45rem' },
};
const RADIUS = { sharp: '0px', soft: '16px', round: '30px' };
const SHADOW = { none: 'none', subtle: '0 2px 8px rgba(0,0,0,.18)', lifted: '0 30px 80px -36px rgba(0,0,0,.6)' };

// A faint film grain as an inline data: SVG (self-contained — never an http url()). Tasteful at low
// opacity over the whole page; only emitted for texture:'grain'.
const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export function designToCss(d, { tier = 'starter' } = {}) {
  const s = SCALE[d.scale] || SCALE.comfortable;
  const motion = d.motion === 'subtle';
  const T = (rule) => (motion ? rule : ''); // emit a transition/hover rule only when motion is on
  // Page background: a flat color, a soft accent gradient mesh, or the flat color under a grain film.
  const bg = d.texture === 'gradient'
    ? `radial-gradient(1100px 620px at 78% -8%, color-mix(in srgb,var(--accent) 16%,transparent), transparent 60%), radial-gradient(900px 700px at -10% 30%, color-mix(in srgb,var(--accent) 8%,transparent), transparent 55%), var(--bg)`
    : 'var(--bg)';
  const grain = d.texture === 'grain'
    ? `body::before{content:"";position:fixed;inset:0;z-index:60;pointer-events:none;opacity:.05;mix-blend-mode:overlay;background-image:${GRAIN}}`
    : '';
  // Tier CSS is APPENDED after the base sheet; STARTER appends nothing. Pro adds reveal + tilt; Premium
  // adds those plus the WebGL hero layering and the form/catalogue styling. Every motion rule there lives
  // inside @media (prefers-reduced-motion: no-preference){…} so reduced-motion + headless QA stay calm.
  const tierCss = tier === 'pro' || tier === 'premium' ? tierStyles(tier) : '';
  return `:root{
  --bg:${d.palette.bg}; --surface:${d.palette.surface}; --ink:${d.palette.ink};
  --muted:${d.palette.muted}; --accent:${d.palette.accent}; --accent-ink:${d.palette.accentInk};
  --radius:${RADIUS[d.radius]}; --shadow:${SHADOW[d.shadow]}; --unit:${s.unit}; --gap:${s.gap};
  --line:color-mix(in srgb,var(--ink) 12%,transparent);
  --line-soft:color-mix(in srgb,var(--ink) 7%,transparent);
  --panel:color-mix(in srgb,var(--surface) 60%,var(--bg));
  --font-display:'${d.fonts.display}',Georgia,serif; --font-body:'${d.fonts.body}',system-ui,sans-serif;
}
*{box-sizing:border-box} html{scroll-behavior:smooth}
body{margin:0;background:${bg};color:var(--ink);font-family:var(--font-body);line-height:1.65;-webkit-font-smoothing:antialiased;overflow-x:hidden}
${grain}
h1,h2,h3{font-family:var(--font-display);font-weight:600;letter-spacing:-.018em;line-height:1.04;margin:0;overflow-wrap:break-word}
h2{font-size:clamp(1.7rem,3.4vw,2.5rem)} h3{font-size:1.16rem}
a{color:inherit;text-decoration:none} p{margin:0 0 1em} img{display:block}
.wrap{max-width:1160px;margin:0 auto;padding:0 28px}
main{display:block}
section{padding:${s.pad} 0;position:relative}
.eyebrow{text-transform:uppercase;letter-spacing:.28em;font-size:.7rem;color:var(--accent);font-weight:600;margin:0}
.muted{color:var(--muted)}

/* --- top nav: sticky, translucent, blurred; links collapse on mobile (CSS-only, no JS) --- */
.nav{position:sticky;top:0;z-index:50;background:color-mix(in srgb,var(--bg) 78%,transparent);backdrop-filter:saturate(1.4) blur(14px);-webkit-backdrop-filter:saturate(1.4) blur(14px);border-bottom:1px solid var(--line-soft)}
.nav-inner{display:flex;align-items:center;justify-content:space-between;gap:24px;height:68px}
.brand{font-family:var(--font-display);font-size:1.18rem;font-weight:600;letter-spacing:-.01em}
.nav-links{display:flex;gap:30px;align-items:center;list-style:none;margin:0;padding:0}
.nav-links a{font-size:.82rem;letter-spacing:.06em;color:var(--muted)${T(';transition:color .2s ease')}}
${T('.nav-links a:hover{color:var(--ink)}')}
.nav-cta{font-size:.82rem;font-weight:600;color:var(--accent)}

/* --- hero: cinematic, palette-tinted photo + strong scrim so text always reads --- */
.hero{position:relative;min-height:90vh;display:grid;align-items:end;overflow:hidden;isolation:isolate}
.hero-photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;filter:saturate(1.05) contrast(1.02)}
.hero-tint{position:absolute;inset:0;z-index:1;background:linear-gradient(180deg,color-mix(in srgb,var(--bg) 30%,transparent),transparent 40%),radial-gradient(120% 80% at 50% 120%,color-mix(in srgb,var(--accent) 22%,transparent),transparent 60%);mix-blend-mode:soft-light}
.hero-scrim{position:absolute;inset:0;z-index:2;background:linear-gradient(180deg,color-mix(in srgb,var(--bg) 22%,transparent) 0%,transparent 28%,transparent 46%,color-mix(in srgb,var(--bg) 82%,transparent) 88%,var(--bg) 100%)}
/* photo-less hero: a tighter, vertically-centred band with a warm dual accent glow (no empty void) */
.hero:not(:has(.hero-photo)){min-height:68vh;align-items:center;background:radial-gradient(900px 520px at 80% 2%,color-mix(in srgb,var(--accent) 26%,transparent),transparent 58%),radial-gradient(680px 560px at 4% 104%,color-mix(in srgb,var(--accent) 12%,transparent),transparent 55%),linear-gradient(180deg,color-mix(in srgb,var(--surface) 72%,var(--bg)),var(--bg))}
.hero:not(:has(.hero-photo)) .wrap{padding-top:96px;padding-bottom:72px}
.hero .wrap{position:relative;z-index:3;padding-top:128px;padding-bottom:clamp(48px,8vh,104px);width:100%}
.hero .eyebrow{margin-bottom:20px}
.hero h1{font-size:${s.h1};max-width:15ch}
.hero .tagline{font-size:clamp(1.15rem,2.2vw,1.5rem);color:color-mix(in srgb,var(--ink) 86%,var(--muted));max-width:46ch;margin:22px 0 0;line-height:1.45}
.hero-meta{display:flex;flex-wrap:wrap;align-items:center;gap:10px 18px;margin-top:26px;color:var(--muted);font-size:.92rem}
.hero-meta .star{color:var(--accent)}
.hero-meta .sep{width:4px;height:4px;border-radius:50%;background:color-mix(in srgb,var(--ink) 34%,transparent)}
.hero-actions{display:flex;flex-wrap:wrap;gap:14px;margin-top:38px}

/* --- buttons --- */
.btn{display:inline-flex;align-items:center;gap:8px;background:var(--accent);color:var(--accent-ink);padding:15px 30px;border-radius:999px;font-weight:600;font-size:.95rem;border:1px solid transparent${T(';transition:transform .2s ease,filter .2s ease,box-shadow .2s ease')}}
${T('.btn:hover{transform:translateY(-2px);filter:brightness(1.06);box-shadow:0 16px 34px -16px color-mix(in srgb,var(--accent) 70%,transparent)}')}
.btn-ghost{display:inline-flex;align-items:center;gap:8px;padding:15px 26px;border-radius:999px;font-weight:600;font-size:.95rem;color:var(--ink);border:1px solid var(--line)${T(';transition:border-color .2s ease,background .2s ease')}}
${T('.btn-ghost:hover{border-color:color-mix(in srgb,var(--ink) 30%,transparent);background:color-mix(in srgb,var(--ink) 5%,transparent)}')}

/* --- section header: big faint index numeral + eyebrow + title --- */
.sec-head{display:grid;grid-template-columns:auto 1fr;gap:28px;align-items:start;margin-bottom:var(--gap)}
.sec-num{font-family:var(--font-display);font-size:clamp(2rem,5vw,3.4rem);line-height:.9;color:color-mix(in srgb,var(--accent) 60%,transparent);font-weight:600}
.sec-head .eyebrow{margin-bottom:12px}
.sec-title{max-width:20ch}

/* --- about: editorial two-column (a large lead + supporting body) --- */
.about-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:var(--gap) calc(var(--gap) + 16px);align-items:start}
.about-lead{font-family:var(--font-display);font-weight:500;font-size:${s.lead};line-height:1.4;letter-spacing:-.01em;color:var(--ink);margin:0}
.about-lead.big{font-size:calc(${s.lead} * 1.35)}
.about-body{color:var(--muted)}
.about-body p:last-child{margin-bottom:0}

/* --- menu / services: two columns, hairline-separated, price leaders --- */
.menu{display:grid;grid-template-columns:1fr 1fr;gap:0 calc(var(--gap) + 8px)}
.item{display:grid;grid-template-columns:1fr auto;gap:6px 18px;align-items:baseline;border-bottom:1px solid var(--line);padding:calc(var(--unit)*2.4) 0}
.item h3{font-size:1.12rem;font-family:var(--font-display)}
.item .price{color:var(--accent);font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:600}
.item p{grid-column:1/-1;color:var(--muted);font-size:.95rem;margin:6px 0 0;max-width:48ch}

/* --- gallery: adaptive by photo count --- */
.gallery{display:grid;gap:calc(var(--unit)*1.6)}
.gallery .tile{overflow:hidden;border-radius:var(--radius);background:var(--surface);box-shadow:var(--shadow)}
.gallery .tile img{width:100%;height:100%;object-fit:cover}
.gallery .cap{display:flex;align-items:flex-end;padding:18px;min-height:240px;color:var(--muted);background:linear-gradient(180deg,var(--surface),var(--panel));font-size:.9rem}
.g-feature{grid-template-columns:1fr}
.g-feature .tile{aspect-ratio:16/7}
.g-pair{grid-template-columns:1.4fr 1fr}
.g-pair .tile{aspect-ratio:4/3}
.g-pair .tile:first-child{aspect-ratio:auto}
.g-mosaic{grid-template-columns:repeat(6,1fr);grid-auto-rows:1fr}
.g-mosaic .tile{aspect-ratio:1/1}
.g-mosaic .tile:nth-child(1){grid-column:span 3;grid-row:span 2;aspect-ratio:3/4}
.g-mosaic .tile:nth-child(2){grid-column:span 3;aspect-ratio:3/2}
.g-mosaic .tile:nth-child(3){grid-column:span 3;aspect-ratio:3/2}
.g-mosaic .tile:nth-child(n+4){grid-column:span 2}

/* --- reviews: oversized pull-quotes --- */
.reviews-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:calc(var(--unit)*2.2)}
blockquote{margin:0;background:var(--panel);border:1px solid var(--line-soft);border-radius:var(--radius);padding:calc(var(--unit)*3.2);box-shadow:var(--shadow)}
blockquote p{font-family:var(--font-display);font-weight:500;font-size:1.18rem;line-height:1.42;margin:0 0 16px}
blockquote::before{content:"\\201C";display:block;font-family:var(--font-display);color:var(--accent);font-size:3rem;line-height:.6;margin-bottom:8px}
cite{color:var(--muted);font-style:normal;font-size:.9rem;letter-spacing:.04em}

/* --- info band: hours + a visit/contact card --- */
.info-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:var(--gap)}
.hours{list-style:none;padding:0;margin:0}
.hours li{display:flex;justify-content:space-between;gap:18px;border-bottom:1px solid var(--line);padding:calc(var(--unit)*1.5) 0;font-variant-numeric:tabular-nums}
.hours li span:first-child{color:var(--ink)} .hours li span:last-child{color:var(--muted)}
.info-card{background:var(--surface);border:1px solid var(--line-soft);border-radius:var(--radius);padding:calc(var(--unit)*3.6);box-shadow:var(--shadow);align-self:start}
.info-card .addr{font-style:normal;color:var(--muted);line-height:1.8;margin-bottom:calc(var(--unit)*2.6)}
.info-card .addr a{color:var(--ink)}
.info-h{margin-bottom:calc(var(--unit)*2)}

/* --- footer --- */
.footer{border-top:1px solid var(--line);background:color-mix(in srgb,var(--surface) 50%,var(--bg));padding:calc(var(--unit)*8) 0 calc(var(--unit)*5)}
.foot-grid{display:grid;grid-template-columns:2fr 1fr 1fr;gap:var(--gap)}
.foot-brand .name{font-family:var(--font-display);font-size:1.5rem;margin-bottom:12px}
.foot-brand p{color:var(--muted);max-width:34ch}
.foot-col h4{font-size:.72rem;text-transform:uppercase;letter-spacing:.22em;color:var(--muted);font-weight:600;margin:0 0 16px}
.foot-col ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.foot-col a,.foot-col li{color:var(--ink);font-size:.95rem}
${T('.foot-col a{transition:color .2s ease}.foot-col a:hover{color:var(--accent)}')}
.foot-credit{display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;margin-top:calc(var(--unit)*6);padding-top:calc(var(--unit)*3);border-top:1px solid var(--line-soft);color:var(--muted);font-size:.82rem}
.foot-credit a{color:var(--muted)} ${T('.foot-credit a:hover{color:var(--ink)}')}

@media(max-width:920px){
  .about-grid,.info-grid,.menu{grid-template-columns:1fr}
  .foot-grid{grid-template-columns:1fr 1fr}
  .g-mosaic{grid-template-columns:repeat(2,1fr)}
  .g-mosaic .tile:nth-child(1),.g-mosaic .tile:nth-child(2),.g-mosaic .tile:nth-child(3),.g-mosaic .tile:nth-child(n+4){grid-column:auto;grid-row:auto;aspect-ratio:1/1}
}
@media(max-width:680px){
  .nav-links{display:none}
  .g-pair{grid-template-columns:1fr} .g-pair .tile,.g-pair .tile:first-child{aspect-ratio:4/3}
  .sec-head{grid-template-columns:1fr;gap:10px} .sec-num{font-size:2rem}
  .foot-grid{grid-template-columns:1fr}
  section{padding:64px 0}
  .hero .wrap{padding-top:104px}
}
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
/* These sections sit directly in <main> (no .wrap), so they carry their own centering + side padding. */
.catalogue{max-width:1160px;margin:0 auto;padding-left:28px;padding-right:28px}
.lead,.order{max-width:736px;margin:0 auto;padding-left:28px;padding-right:28px}
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
.form-thanks{font-family:var(--font-display);font-size:1.25rem}
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
.hero-tint{z-index:2}
.hero-scrim{z-index:3}
.hero .wrap{z-index:4}
/* with a live GL hero, let the photo breathe a touch so the motion reads through */
@media (prefers-reduced-motion: no-preference){ .hero-photo{opacity:.92} }
.catalogue .cat-head{margin-bottom:calc(var(--unit)*3)}
.cat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:calc(var(--unit)*2)}
.cat-card{display:flex;flex-direction:column;justify-content:space-between;gap:calc(var(--unit)*2);
  background:var(--surface);border:1px solid var(--line-soft);border-radius:var(--radius);box-shadow:var(--shadow);padding:calc(var(--unit)*3)}
.cat-card h3{font-size:1.15rem}
.cat-card .price{color:var(--accent);font-variant-numeric:tabular-nums;align-self:start}
@media(max-width:980px){.cat-grid{grid-template-columns:1fr 1fr}}
@media(max-width:560px){.cat-grid{grid-template-columns:1fr}}` : '';

  return shared + premium + '\n';
}
