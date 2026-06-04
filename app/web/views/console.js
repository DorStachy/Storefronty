import { h, icon, initials, orb } from '../ui.js';

// The AI request console — a conversational surface. The owner types what they'd like changed; the
// assistant replies and the request enters the rebuild pipeline. ctx = { me, api, navigate, toast }.
export async function ConsoleView(ctx) {
  const wrap = h('div', { class: 'console' });
  const thread = h('div', { class: 'thread' });
  const ta = h('textarea', { rows: 1, placeholder: 'Tell me what to change — e.g. “add a section showcasing my 5 best photos”' });
  const fill = (t) => { ta.value = t; autoResize(ta); ta.focus(); };

  // While a rebuild is in flight we poll so its "all done" lands in the chat live (not just an email).
  const shown = new Set();        // request ids whose completion is already in the thread
  let handle = null, ticks = 0;
  const stop = () => { if (handle != null) { clearInterval(handle); handle = null; } };
  const watch = () => {           // idempotent: one poller at a time, self-stops on detach / completion / cap
    if (handle != null) return;
    handle = setInterval(async () => {
      if (!document.contains(wrap) || ++ticks > 90) { stop(); return; }   // navigated away / ~6min safety cap
      let reqs;
      try { reqs = (await ctx.api.requests()).requests || []; } catch { return; }
      for (const r of reqs) {
        if (r.done && r.result && !shown.has(r.id)) {
          shown.add(r.id);
          const node = aiMsg(''); thread.append(node);
          typeInto(node.querySelector('.bubble'), r.result, thread);
          ctx.toast('Your site’s updated ✨');
        }
      }
      if (!reqs.some((r) => !r.done)) stop();   // nothing left in flight
    }, 4000);
  };

  wrap.append(thread, composer(ctx, thread, ta, watch));

  let history = [];
  try { history = (await ctx.api.requests()).requests || []; } catch { /* show empty */ }
  if (!history.length) thread.append(emptyState(ctx, fill));
  else for (const r of history) {
    thread.append(userMsg(ctx, r.body, r.images));
    thread.append(aiMsg(r.reply));
    if (r.done && r.result) { thread.append(aiMsg(r.result)); shown.add(r.id); }
  }
  if (history.some((r) => !r.done)) watch();   // a request is still building → wait for its completion
  requestAnimationFrame(() => scrollEnd(thread));
  return wrap;
}

// ---- messages -------------------------------------------------------------
const who = (cls, label) => h('div', { class: `who ${cls}` }, label);
function userMsg(ctx, text, images) {
  const bubble = h('div', { class: 'bubble' });
  if (Array.isArray(images) && images.length) bubble.append(h('div', { class: 'msg-imgs' }, ...images.map((p) => h('img', { src: p.dataUrl, alt: '' }))));
  else if (Number(images) > 0) bubble.append(h('div', { class: 'imgs-note' }, icon('image'), `${images} photo${Number(images) === 1 ? '' : 's'}`));
  if (text) bubble.append(text);
  return h('div', { class: 'msg user' }, who('', initials(ctx.me.account.email)), bubble);
}
const aiMsg = (text) => h('div', { class: 'msg ai' }, orb(), h('div', { class: 'bubble' }, text));
const aiTyping = () => h('div', { class: 'msg ai' }, orb(), h('div', { class: 'bubble' }, h('span', { class: 'typing' }, h('i'), h('i'), h('i'))));

function emptyState(ctx, fill) {
  const free = ctx.me.quota.freeAvailable;
  const chips = ['Make the header navy', 'Add my photos', 'Change the fonts', 'Fix my opening hours'];
  return h('div', { class: 'empty' },
    orb('lg'),
    h('div', { class: 'big' }, free ? 'What would you like to change?' : 'What should I tweak next?'),
    h('p', {}, free
      ? "Your first change is free — tell me in plain words and I'll rebuild your site."
      : "Tell me in plain words and I'll rebuild your site."),
    h('div', { class: 'suggest', style: { justifyContent: 'center', marginTop: '18px' } },
      ...chips.map((c) => h('button', { class: 'chip', type: 'button', onClick: () => fill(c) }, c))));
}

// ---- composer -------------------------------------------------------------
function composer(ctx, thread, ta, onQueued) {
  ta.addEventListener('input', () => autoResize(ta));
  const pending = []; // [{ name, dataUrl }]

  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' } });
  const attach = h('button', { class: 'attach', type: 'button', 'aria-label': 'Attach photos', title: 'Attach photos' }, icon('image'));
  const thumbs = h('div', { class: 'attachments', hidden: true });
  const send = h('button', { class: 'btn send', type: 'button', 'aria-label': 'Send' }, icon('send'));
  const quota = h('span', {}, quotaText(ctx.me.quota));
  const box = h('div', { class: 'box' }, attach, ta, send);
  const form = h('div', { class: 'composer' }, thumbs, box,
    h('div', { class: 'hint' }, h('span', {}, 'Enter to send · Shift+Enter for a new line'), quota), fileInput);

  const renderThumbs = () => {
    thumbs.replaceChildren(...pending.map((p, i) =>
      h('div', { class: 'thumb' }, h('img', { src: p.dataUrl, alt: '' }),
        h('button', { class: 'rm', type: 'button', 'aria-label': 'Remove', onClick: () => { pending.splice(i, 1); renderThumbs(); } }, '×'))));
    thumbs.hidden = pending.length === 0;
  };

  attach.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const files = [...(fileInput.files || [])];
    fileInput.value = '';
    for (const f of files) {
      if (pending.length >= 5) { ctx.toast('Up to 5 photos at a time'); break; }
      if (!f.type.startsWith('image/')) continue;
      try { pending.push({ name: f.name, dataUrl: await fileToDataUrl(f) }); } catch { /* skip a bad one */ }
    }
    renderThumbs();
  });

  const submit = async () => {
    const text = ta.value.trim();
    if (!text && !pending.length) return;
    const images = pending.splice(0); renderThumbs();
    ta.value = ''; autoResize(ta);
    const empty = thread.querySelector('.empty'); if (empty) empty.remove();
    thread.append(userMsg(ctx, text, images)); scrollEnd(thread);
    const typing = aiTyping(); thread.append(typing); scrollEnd(thread);
    send.disabled = true;
    try {
      const r = await ctx.api.sendRequest({ body: text, images });
      typing.remove();
      const node = aiMsg(''); thread.append(node);
      typeInto(node.querySelector('.bubble'), r.reply, thread);
      if (r.quota) { Object.assign(ctx.me.quota, r.quota); quota.textContent = quotaText(ctx.me.quota); }
      if (typeof onQueued === 'function') onQueued();   // start watching for the "all done" completion

    } catch (e) {
      typing.remove();
      const node = aiMsg(''); thread.append(node);
      const b = node.querySelector('.bubble');
      if (e.status === 402) {
        b.append(`${(e.data && e.data.error) || "You're out of changes for now"} — `,
          h('a', { href: '/billing', onClick: (ev) => { ev.preventDefault(); ctx.navigate('/billing'); } }, 'get more changes'),
          " and I'll get right to it.");
      } else {
        b.textContent = e.message || 'Something went wrong — give it another try in a moment.';
      }
    } finally {
      send.disabled = false; scrollEnd(thread);
    }
  };

  send.addEventListener('click', submit);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
  requestAnimationFrame(() => autoResize(ta)); // size correctly once mounted (fixes the clipped text)
  return form;
}

// Downscale a chosen image to a compact JPEG data URL before upload.
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 1400;
      let w = img.naturalWidth, hgt = img.naturalHeight;
      if (w > max || hgt > max) { const s = max / Math.max(w, hgt); w = Math.round(w * s); hgt = Math.round(hgt * s); }
      const c = document.createElement('canvas'); c.width = w; c.height = hgt;
      c.getContext('2d').drawImage(img, 0, 0, w, hgt);
      URL.revokeObjectURL(url);
      try { resolve(c.toDataURL('image/jpeg', 0.82)); } catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}

// ---- helpers --------------------------------------------------------------
function quotaText(q) {
  if (q.freeAvailable) return '1 free change ready';
  if (q.remaining == null) return 'Unlimited changes';
  return `${q.remaining} change${q.remaining === 1 ? '' : 's'} left`;
}
function autoResize(ta) { ta.style.height = 'auto'; ta.style.height = `${Math.min(Math.max(ta.scrollHeight || 0, 24), 168)}px`; }
function scrollEnd(thread) { thread.scrollTop = thread.scrollHeight; }
function typeInto(el, text, thread) {
  el.textContent = '';
  let i = 0;
  const id = setInterval(() => {
    i = Math.min(text.length, i + 2);
    el.textContent = text.slice(0, i);
    scrollEnd(thread);
    if (i >= text.length) clearInterval(id);
  }, 14);
}
