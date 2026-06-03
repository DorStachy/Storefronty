import { h, icon, orb, fmtDate } from '../ui.js';

export async function DashboardView(ctx) {
  const wrap = h('div', {});
  wrap.append(hero(ctx));
  wrap.append(h('div', { class: 'bento' },
    previewCard(ctx.me.site),
    h('div', { class: 'bento-side' }, usageCard(ctx), planCard(ctx))));
  wrap.append(await recentCard(ctx));
  return wrap;
}

const greeting = () => { const hr = new Date().getHours(); return hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'; };

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
