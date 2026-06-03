import { h, icon, orb, fmtDate } from '../ui.js';

export async function DashboardView(ctx) {
  const wrap = h('div', {});
  wrap.append(hero(ctx));
  wrap.append(h('div', { class: 'bento' },
    previewCard(ctx.me.site),
    h('div', { class: 'bento-side' }, usageCard(ctx), planCard(ctx))));
  const gb = addToGoogleCard(ctx);
  if (gb) wrap.append(gb);
  wrap.append(await recentCard(ctx));
  return wrap;
}

const greeting = () => { const hr = new Date().getHours(); return hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'; };

// The 4-colour Google "G" (inline so it keeps its brand colours; icon() is single-stroke).
const googleMark = () => h('span', {
  'aria-hidden': 'true', style: { width: '22px', height: '22px', display: 'inline-flex', flex: '0 0 auto' },
  html: '<svg viewBox="0 0 48 48" width="22" height="22"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>',
});

// "Add to Google" activation — the conversion hack: paste the live preview URL into the owner's Google
// Business Profile so real customers see the new site on their listing for the 48h trial. Only shown
// once a live preview exists; the urgency copy applies while it's still a trial (expiresAt set).
function addToGoogleCard(ctx) {
  const site = ctx.me.site;
  if (!site || !site.previewUrl) return null;
  const url = site.previewUrl;
  const trial = !!site.expiresAt;
  const field = h('input', { class: 'gb-url', type: 'text', readonly: 'readonly', value: url, onClick: (e) => e.target.select() });
  const copyBtn = h('button', { class: 'btn ghost sm', type: 'button' }, icon('copy'), 'Copy link');
  copyBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); ctx.toast('Link copied'); }
    catch { field.select(); try { document.execCommand('copy'); } catch { /* noop */ } ctx.toast('Link copied'); }
  });
  return h('div', { class: 'card pad gb-card', style: { marginTop: '18px' } },
    h('div', { class: 'gb-head' }, googleMark(), h('div', { class: 'eyebrow', style: { margin: 0 } }, 'Put it in front of real customers')),
    h('p', { class: 'gb-copy' }, trial
      ? 'Paste your site link into your Google Business Profile (the “Website” field). For the next 48 hours, anyone who finds you on Google or Maps lands on your new site — a real test drive. Pick a plan before it expires to keep it there for good.'
      : 'Add your site to your Google Business Profile (the “Website” field) so everyone who finds you on Google or Maps goes straight to it.'),
    h('div', { class: 'gb-row' }, field, copyBtn),
    h('a', { class: 'gb-link', href: 'https://business.google.com/', target: '_blank', rel: 'noopener' }, 'Open Google Business Profile', icon('ext')));
}

function hero(ctx) {
  const { me, navigate } = ctx;
  const live = me.site && me.site.previewUrl;
  return h('div', { class: 'hero-card' },
    h('div', { class: 'hero-orbwrap' }, orb('lg')),
    h('div', { class: 'hero-text' },
      h('p', { class: 'hero-eyebrow' }, greeting()),
      h('h2', { class: 'hero-name' }, me.shop || 'Your site'),
      h('div', { class: 'hero-meta' }, live
        ? h('span', { class: 'badge ok dot' }, me.site.expiresAt ? `Live · until ${fmtDate(me.site.expiresAt)}` : 'Live')
        : h('span', { class: 'badge dot' }, 'Building'))),
    h('div', { class: 'hero-actions' },
      h('button', { class: 'btn', onClick: () => navigate('/requests') }, icon('chat'), 'Request a change'),
      live ? h('a', { class: 'btn ghost', href: me.site.previewUrl, target: '_blank', rel: 'noopener' }, 'View live site', icon('ext')) : null));
}

function previewCard(site) {
  const bar = h('div', { class: 'preview-bar' },
    h('span', { class: 'dot3' }, h('i'), h('i'), h('i')),
    h('span', { class: 'addr' }, site && site.previewUrl ? site.previewUrl.replace(/^https?:\/\//, '') : 'your site'));
  const frame = h('div', { class: 'preview-frame' });
  if (site && site.previewUrl) frame.append(h('iframe', { src: site.previewUrl, title: 'Your site', loading: 'lazy' }));
  else if (site && site.screenshots && site.screenshots[0]) frame.append(h('img', { src: site.screenshots[0], alt: '', style: { width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' } }));
  else frame.append(h('div', { class: 'center-pad' }, 'Your site is being built…'));
  return h('div', { class: 'card preview-card' }, bar, frame);
}

function usageCard(ctx) {
  const { me, navigate } = ctx;
  const q = me.quota;
  const total = q.allowance; // null = unlimited
  const used = q.used || 0;
  const left = total == null ? null : Math.max(0, total - used) + (q.freeAvailable ? 1 : 0);
  const deg = (total ? Math.min(100, (used / total) * 100) : (q.freeAvailable ? 8 : 100)) * 3.6;
  const ring = h('div', { class: 'ring', style: { background: `conic-gradient(var(--primary) ${deg}deg, var(--surface-3) 0deg)` } },
    h('div', { class: 'ring-hole' },
      h('div', { class: 'ring-num' }, total == null ? '∞' : String(left == null ? 0 : left)),
      h('div', { class: 'ring-lbl' }, total == null ? 'changes' : 'left')));
  return h('div', { class: 'card pad' },
    h('div', { class: 'eyebrow', style: { marginBottom: '14px' } }, 'Changes this month'),
    h('div', { class: 'usage-row' }, ring,
      h('div', {},
        h('div', { style: { fontWeight: 600 } }, q.freeAvailable ? 'Your first change is free' : (total == null ? 'Unlimited changes' : `${used} of ${total} used`)),
        h('div', { style: { fontSize: '13.5px', marginTop: '3px' } },
          h('a', { href: '/billing', onClick: (e) => { e.preventDefault(); navigate('/billing'); } }, 'Buy more changes'),
          q.extra ? h('span', { class: 'badge', style: { marginLeft: '8px' } }, `+${q.extra} credits`) : null))));
}

function planCard(ctx) {
  const { me, navigate } = ctx;
  const active = me.account.planStatus === 'active';
  return h('div', { class: 'card pad' },
    h('div', { class: 'eyebrow', style: { marginBottom: '12px' } }, 'Plan'),
    h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' } },
      h('div', { style: { fontSize: '22px', fontWeight: 800, letterSpacing: '-0.03em' } }, me.plan ? me.plan.label : 'No plan yet'),
      me.plan ? h('span', { class: 'muted', style: { fontSize: '14px' } }, `$${me.plan.price}/mo`) : null,
      active ? h('span', { class: 'badge ok dot', style: { marginLeft: 'auto' } }, 'Active') : null),
    h('button', { class: 'btn ghost block', style: { marginTop: '16px' }, onClick: () => navigate('/billing') }, active ? 'Manage plan' : 'Pick a plan'));
}

async function recentCard(ctx) {
  let reqs = [];
  try { reqs = (await ctx.api.requests()).requests || []; } catch { /* none */ }
  reqs = reqs.slice().reverse().slice(0, 6);
  const body = reqs.length
    ? h('ul', { class: 'activity' }, ...reqs.map((r) => h('li', {},
        h('span', { class: `dot ${r.status === 'done' ? 'done' : 'queued'}` }),
        h('div', { class: 'act-body' },
          h('div', { class: 'act-text' }, r.body || (r.images ? `${r.images} photo${r.images === 1 ? '' : 's'} sent` : 'Change request')),
          h('div', { class: 'act-meta muted' }, `${r.images ? `${r.images} photo${r.images === 1 ? '' : 's'} · ` : ''}${r.status === 'done' ? 'Done' : 'In progress'} · ${fmtDate(r.createdAt)}`)))))
    : h('div', { class: 'center-pad', style: { padding: '28px 20px' } }, 'No requests yet — tell the assistant what to change.');
  return h('div', { class: 'card pad', style: { marginTop: '18px' } },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' } },
      h('div', { class: 'eyebrow' }, 'Recent requests'),
      h('a', { href: '/requests', onClick: (e) => { e.preventDefault(); ctx.navigate('/requests'); } }, 'Open console')),
    body);
}
