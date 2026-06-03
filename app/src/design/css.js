// Generate a full, self-contained stylesheet for site/themes/v3/template.html from validated tokens.
// CSS custom properties hold the palette/scale/radius/shadow; rules below style every element the
// template emits (hero, .menu .item, .gallery .tile, .hours li, blockquote, etc.). No @import / url()
// — fonts arrive via a <link> the renderer injects, keeping the inlined KV blob self-contained.
const SCALE = { compact: { unit: '6px', h1: '2.6rem', pad: '56px' }, comfortable: { unit: '8px', h1: '3.2rem', pad: '88px' }, spacious: { unit: '10px', h1: '4rem', pad: '120px' } };
const RADIUS = { sharp: '0px', soft: '14px', round: '28px' };
const SHADOW = { none: 'none', subtle: '0 1px 2px rgba(0,0,0,.18)', lifted: '0 24px 60px -28px rgba(0,0,0,.55)' };

export function designToCss(d) {
  const s = SCALE[d.scale] || SCALE.comfortable;
  const motion = d.motion === 'subtle';
  const grad = d.texture === 'gradient'
    ? `radial-gradient(1200px 600px at 70% -10%, color-mix(in srgb, var(--accent) 18%, transparent), transparent), var(--bg)`
    : 'var(--bg)';
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
`;
}
