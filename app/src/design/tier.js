// Tier feature builders (Phase D). Pure functions: contract/design in → an HTML *string* out, with
// EVERY interpolated value escaped (the contract's shape is validated but its string values are
// untrusted — same threat model as builder/render.js). They are additive: the v3 template carries
// backward-safe slots ({{leadFormHtml}}, {{catalogueHtml}}, {{orderFormHtml}}, {{heroCanvasHtml}},
// {{heroScriptHtml}}) that render '' for tiers that don't get the feature, so STARTER output is byte
// -identical to today's.
//
// Self-contained, always: the forms are native POSTs to /api/lead (no JS, no external action), the
// hero is RAW inline WebGL2 (no library, no src=), and the script no-ops under prefers-reduced-motion
// or when WebGL2 is unavailable (headless QA / no-GPU), letting the CSS hero photo/gradient stand in.
// Nothing here ever throws on a missing contract field — each accessor is defensive.
import { escapeHtml } from '../util/html.js';

const e = escapeHtml;

// A contract's services may be absent/garbage upstream of validation (these builders are called from
// the renderer with the *validated* contract, but stay defensive anyway). Always an array of
// {name, desc?, price?}.
function services(contract) {
  const s = contract && Array.isArray(contract.services) ? contract.services : [];
  return s.filter((x) => x && typeof x === 'object');
}

const shopName = (contract) => (contract && contract.shopName) || 'this business';

// --- Pro + Premium: lead-capture form -------------------------------------------------------------
// A calm "get in touch" section. Native POST to /api/lead (works with zero JS, fully self-contained);
// the hidden `kind` lets the API distinguish a general enquiry from an order. The honeypot field is a
// quiet bot trap (visually hidden via .hp in the tier CSS; real users never fill it).
export function leadFormHtml(contract, opts = {}) {
  const name = e(shopName(contract));
  const action = e(`${String(opts.apiBase || '').replace(/\/$/, '')}/api/lead`);
  const slug = e(opts.slug || '');
  return `<section id="contact-form" class="lead" data-reveal>
<div class="form-head"><p class="eyebrow">Get in touch</p><h2>Say hello to ${name}</h2>
<p class="muted">Tell us what you're after — we'll get back to you.</p></div>
<form class="contact-form" action="${action}" method="post">
<input type="hidden" name="kind" value="lead">
<input type="hidden" name="site" value="${slug}">
<label>Your name<input name="name" type="text" autocomplete="name" required placeholder="Jane Doe"></label>
<label>Email<input name="email" type="email" autocomplete="email" required placeholder="jane@example.com"></label>
<label>Message<textarea name="message" rows="4" required placeholder="How can we help?"></textarea></label>
<input class="hp" type="text" name="company" tabindex="-1" autocomplete="off" aria-hidden="true">
<button class="btn" type="submit">Send message</button>
</form></section>`;
}

// --- Premium: catalogue / menu grid ---------------------------------------------------------------
// A card grid from the same services the menu lists, presented as a richer "browse" surface. Renders
// nothing when there are no services (defensive: an empty grid would be an awkward blank section).
export function catalogueHtml(contract) {
  const items = services(contract);
  if (!items.length) return '';
  const cards = items
    .map(
      (s) =>
        `<article class="cat-card" data-reveal><div class="cat-card-body"><h3>${e(s.name)}</h3>${
          s.desc ? `<p class="muted">${e(s.desc)}</p>` : ''
        }</div>${s.price ? `<span class="price">${e(s.price)}</span>` : ''}</article>`,
    )
    .join('');
  return `<section id="catalogue" class="catalogue"><div class="cat-head"><p class="eyebrow">The full menu</p><h2>Everything we offer</h2></div>
<div class="cat-grid">${cards}</div></section>`;
}

// --- Premium: order / reservation form ------------------------------------------------------------
// A booking surface — choose an item (from services), pick a date/time + party size, leave contact
// details. Native POST to /api/lead with kind=order so the API routes it as an order/reservation. The
// item <select> is populated from services; with none, a free-text note still lets a customer order.
export function orderFormHtml(contract, opts = {}) {
  const items = services(contract);
  const action = e(`${String(opts.apiBase || '').replace(/\/$/, '')}/api/lead`);
  const slug = e(opts.slug || '');
  const options = items.length
    ? items.map((s) => `<option value="${e(s.name)}">${e(s.name)}${s.price ? ` — ${e(s.price)}` : ''}</option>`).join('')
    : '';
  const itemField = items.length
    ? `<label>Item<select name="item">${options}</select></label>`
    : '';
  return `<section id="order" class="order" data-reveal>
<div class="form-head"><p class="eyebrow">Reserve &amp; order</p><h2>Book your table or place an order</h2>
<p class="muted">Pick a time and we'll have it ready.</p></div>
<form class="order-form" action="${action}" method="post">
<input type="hidden" name="kind" value="order">
<input type="hidden" name="site" value="${slug}">
<div class="order-grid">
${itemField}
<label>Date<input name="date" type="date"></label>
<label>Time<input name="time" type="time"></label>
<label>Party size<input name="party" type="number" min="1" max="20" inputmode="numeric" placeholder="2"></label>
</div>
<label>Your name<input name="name" type="text" autocomplete="name" required placeholder="Jane Doe"></label>
<label>Email<input name="email" type="email" autocomplete="email" required placeholder="jane@example.com"></label>
<label>Notes<textarea name="message" rows="3" placeholder="Allergies, requests, anything else"></textarea></label>
<input class="hp" type="text" name="company" tabindex="-1" autocomplete="off" aria-hidden="true">
<button class="btn" type="submit">Request booking</button>
</form></section>`;
}

// --- Premium: WebGL hero ---------------------------------------------------------------------------
// The canvas itself: the FIRST child of <header class="hero">, behind the photo (CSS layers it under
// .hero-photo). No attributes that carry untrusted data — purely structural.
export function heroCanvasHtml() {
  return `<canvas id="hero-gl" aria-hidden="true"></canvas>`;
}

// Validate a #rrggbb/#rgb to a [r,g,b] in 0..1 for safe injection into the GL source (we build a
// vec3 literal from numbers — never interpolate the raw string into shader text). Falls back to the
// default accent gold if the value is anything unexpected.
function accentRgb(design) {
  const hex = (design && design.palette && design.palette.accent) || '#c8a24a';
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  let h = m ? m[1] : 'c8a24a';
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// The inline WebGL2 hero — a tasteful animated gradient/flow field tinted to the palette accent. RAW
// WebGL2, no library, no src=. It is self-contained and *defensively inert*: it no-ops (leaving the
// CSS hero photo/gradient visible) if prefers-reduced-motion is set, if there's no #hero-gl, or if
// getContext('webgl2') returns null (headless/no-GPU). It also stops the RAF when the tab is hidden.
// The accent is injected as three NUMERIC literals (0..1) — never as raw string text — so a hostile
// palette value can't break out of the shader.
export function heroScriptHtml(design) {
  const [r, g, b] = accentRgb(design);
  const f = (x) => x.toFixed(4);
  return `<script type="module">
(() => {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.getElementById('hero-gl');
  if (reduce || !canvas) return;
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false });
  if (!gl) return; // no WebGL2 (headless / no GPU) → CSS hero photo/gradient stands in

  const ACCENT = [${f(r)}, ${f(g)}, ${f(b)}];
  const VERT = \`#version 300 es
  in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }\`;
  const FRAG = \`#version 300 es
  precision highp float;
  uniform vec2 uRes; uniform float uT; uniform vec3 uAccent;
  out vec4 frag;
  // cheap flowing value-noise from layered sines — no textures, no deps
  float wave(vec2 q, float t){
    return sin(q.x*1.3 + t*0.5) * 0.5
         + sin(q.y*1.7 - t*0.4) * 0.5
         + sin((q.x+q.y)*0.9 + t*0.7) * 0.5;
  }
  void main(){
    vec2 uv = (gl_FragCoord.xy / uRes.xy);
    vec2 q = (uv - 0.5) * vec2(uRes.x/uRes.y, 1.0) * 3.0;
    float n = wave(q, uT) * 0.5 + 0.5;          // 0..1 flowing field
    float vignette = smoothstep(1.15, 0.2, length(uv - 0.5));
    // tint: accent through deepening shadow, kept dark + tasteful (premium, not neon)
    vec3 base = mix(uAccent * 0.10, uAccent * 0.85, n);
    vec3 col = base * (0.35 + 0.65 * vignette);
    frag = vec4(col, (0.30 + 0.45 * n) * vignette);
  }\`;

  const compile = (type, src) => {
    const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { gl.deleteShader(sh); return null; }
    return sh;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);

  // fullscreen triangle
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const uRes = gl.getUniformLocation(prog, 'uRes');
  const uT = gl.getUniformLocation(prog, 'uT');
  const uAccent = gl.getUniformLocation(prog, 'uAccent');
  gl.uniform3f(uAccent, ACCENT[0], ACCENT[1], ACCENT[2]);

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uRes, canvas.width, canvas.height);
  };
  window.addEventListener('resize', resize);
  resize();

  let raf = 0; const start = performance.now();
  const frame = (now) => {
    resize();
    gl.uniform1f(uT, (now - start) / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    raf = requestAnimationFrame(frame);
  };
  // pause when the tab is hidden (battery-friendly), resume on return
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else if (!raf) raf = requestAnimationFrame(frame);
  });
  raf = requestAnimationFrame(frame);
})();
</script>`;
}

// --- Pro + Premium: form submit handler -----------------------------------------------------------
// The lead/order forms POST to /api/lead, which lives on the portal/API host (the generated preview is
// served cross-origin from Cloudflare KV). This tiny self-contained script intercepts the submit, sends
// JSON to the ABSOLUTE API url (the only host that has /api/lead), and swaps in a thank-you so the
// visitor stays on the site instead of navigating to raw JSON. The honeypot is respected. apiBase is our
// own trusted config value, injected via JSON.stringify (never raw). Emitted only when a form exists.
export function formScriptHtml(apiBase = '') {
  const api = `${String(apiBase || '').replace(/\/$/, '')}/api/lead`;
  return `<script>
(() => {
  const API = ${JSON.stringify(api)};
  document.querySelectorAll('form.contact-form, form.order-form').forEach((form) => {
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const data = {}; new FormData(form).forEach((v, k) => { data[k] = v; });
      if (data.company) return;                 // honeypot → drop silently
      const btn = form.querySelector('button[type=submit]');
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
      try {
        await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
        form.innerHTML = '<p class="form-thanks">Thanks — we\\'ll be in touch shortly.</p>';
      } catch (e) {
        if (btn) { btn.disabled = false; btn.textContent = 'Try again'; }
      }
    });
  });
})();
</script>`;
}
