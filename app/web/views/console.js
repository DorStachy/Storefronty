import { h, icon, initials, orb } from '../ui.js';

// The AI request console — a conversational surface. The owner types what they'd like changed; the
// assistant replies and the request enters the rebuild pipeline. ctx = { me, api, navigate, toast }.
export async function ConsoleView(ctx) {
  const wrap = h('div', { class: 'console' });
  const thread = h('div', { class: 'thread' });
  const ta = h('textarea', { rows: 1, placeholder: 'Tell me what to change — e.g. “make the header navy and add my patio photos”' });
  const fill = (t) => { ta.value = t; autoResize(ta); ta.focus(); };

  wrap.append(thread, composer(ctx, thread, ta));

  let history = [];
  try { history = (await ctx.api.requests()).requests || []; } catch { /* show empty */ }
  if (!history.length) thread.append(emptyState(ctx, fill));
  else for (const r of history) { thread.append(userMsg(ctx, r.body)); thread.append(aiMsg(r.reply)); }
  requestAnimationFrame(() => scrollEnd(thread));
  return wrap;
}

// ---- messages -------------------------------------------------------------
const who = (cls, label) => h('div', { class: `who ${cls}` }, label);
const userMsg = (ctx, text) => h('div', { class: 'msg user' }, who('', initials(ctx.me.account.email)), h('div', { class: 'bubble' }, text));
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
function composer(ctx, thread, ta) {
  autoResize(ta);
  ta.addEventListener('input', () => autoResize(ta));
  const send = h('button', { class: 'btn send', type: 'button', 'aria-label': 'Send' }, icon('send'));
  const quota = h('span', {}, quotaText(ctx.me.quota));
  const box = h('div', { class: 'box' }, ta, send);
  const form = h('div', { class: 'composer' }, box, h('div', { class: 'hint' }, h('span', {}, 'Enter to send · Shift+Enter for a new line'), quota));

  const submit = async () => {
    const text = ta.value.trim();
    if (!text) return;
    ta.value = ''; autoResize(ta);
    const empty = thread.querySelector('.empty'); if (empty) empty.remove();
    thread.append(userMsg(ctx, text)); scrollEnd(thread);
    const typing = aiTyping(); thread.append(typing); scrollEnd(thread);
    send.disabled = true;
    try {
      const r = await ctx.api.sendRequest(text);
      typing.remove();
      const node = aiMsg(''); thread.append(node);
      typeInto(node.querySelector('.bubble'), r.reply, thread);
      if (r.quota) { ctx.me.quota.remaining = r.quota.remaining; ctx.me.quota.freeAvailable = r.quota.freeAvailable; quota.textContent = quotaText(ctx.me.quota); }
    } catch (e) {
      typing.remove();
      if (e.status === 402) {
        const node = aiMsg(''); thread.append(node);
        const b = node.querySelector('.bubble');
        b.append("You've used your changes for this period — ",
          h('a', { href: '/billing', onClick: (ev) => { ev.preventDefault(); ctx.navigate('/billing'); } }, 'pick a plan'),
          " to keep going and I'll get right back to it.");
      } else {
        thread.append(aiMsg(e.message || 'Something went wrong — give it another try in a moment.'));
      }
    } finally {
      send.disabled = false; scrollEnd(thread);
    }
  };

  send.addEventListener('click', submit);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
  return form;
}

// ---- helpers --------------------------------------------------------------
function quotaText(q) {
  if (q.freeAvailable) return '1 free change ready';
  if (q.remaining == null) return 'Unlimited changes';
  return `${q.remaining} change${q.remaining === 1 ? '' : 's'} left`;
}
function autoResize(ta) { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`; }
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
