import { h, icon, fmtDate } from '../ui.js';

export function DashboardView(ctx) {
  const { me, navigate } = ctx;
  const site = me.site;
  const wrap = h('div', {});

  wrap.append(h('div', { class: 'view-head' },
    h('h2', {}, me.shop || 'Your site'),
    h('p', { class: 'muted' }, 'Preview your site, request changes, and manage your plan.')));

  const planLabel = me.plan ? me.plan.label : 'Free change';
  const changes = !me.plan
    ? (me.quota.freeAvailable ? '1 free' : '0 left')
    : (me.quota.allowance == null ? 'Unlimited' : `${me.quota.remaining == null ? 0 : me.quota.remaining} left`);
  const status = site && site.previewUrl ? 'Live' : 'Building';
  wrap.append(h('div', { class: 'stat-row' },
    stat('Plan', planLabel, me.account.planStatus === 'active' ? 'active' : (me.plan ? '' : 'pick one anytime')),
    stat('Changes this month', changes, me.quota.freeAvailable && me.plan ? '+1 free available' : (me.quota.freeAvailable ? 'your first is free' : '')),
    stat('Site', status, site && site.expiresAt ? `until ${fmtDate(site.expiresAt)}` : (site ? '' : 'being built'))));

  wrap.append(h('div', { class: 'grid cols-2' }, previewCard(site), sideCard(ctx)));
  return wrap;
}

const stat = (k, v, sub) => h('div', { class: 'stat card' },
  h('div', { class: 'k' }, k), h('div', { class: 'v' }, v),
  sub ? h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '2px' } }, sub) : null);

function previewCard(site) {
  const bar = h('div', { class: 'preview-bar' },
    h('span', { class: 'dot3' }, h('i'), h('i'), h('i')),
    h('span', { class: 'addr' }, site && site.previewUrl ? site.previewUrl.replace(/^https?:\/\//, '') : 'your site'));
  const frame = h('div', { class: 'preview-frame' });
  if (site && site.previewUrl) frame.append(h('iframe', { src: site.previewUrl, title: 'Your site preview', loading: 'lazy' }));
  else if (site && site.screenshots && site.screenshots[0]) frame.append(h('img', { src: site.screenshots[0], alt: 'Your site', style: { width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' } }));
  else frame.append(h('div', { class: 'center-pad' }, 'Your site is being built…'));
  return h('div', { class: 'card' }, bar, frame);
}

function sideCard(ctx) {
  const { me, navigate } = ctx;
  const card = h('div', { class: 'card pad', style: { display: 'flex', flexDirection: 'column' } });
  card.append(
    h('div', { class: 'eyebrow', style: { marginBottom: '10px' } }, 'Make it yours'),
    h('h3', { style: { fontSize: '21px', marginBottom: '8px' } }, 'Want to change something?'),
    h('p', { class: 'muted', style: { marginBottom: '18px' } }, me.quota.freeAvailable
      ? "Your first change is on us — just tell the assistant what you'd like and it rebuilds your site."
      : 'Tell the assistant what to tweak in plain words and it rebuilds your site.'),
    h('button', { class: 'btn block', onClick: () => navigate('/requests') }, icon('chat'), 'Request a change'));
  if (me.site && me.site.previewUrl) {
    card.append(h('a', { class: 'btn ghost block', style: { marginTop: '10px' }, href: me.site.previewUrl, target: '_blank', rel: 'noopener' }, 'Open live site', icon('ext')));
  }
  if (!me.plan) {
    card.append(h('p', { class: 'muted', style: { fontSize: '13px', marginTop: 'auto', paddingTop: '16px', textAlign: 'center' } },
      h('a', { href: '/billing', onClick: (e) => { e.preventDefault(); navigate('/billing'); } }, 'See plans →')));
  }
  return card;
}
