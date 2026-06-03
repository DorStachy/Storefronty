import { h, icon, fmtDate } from '../ui.js';

// Account view. ctx = { me, api, navigate, toast, refresh }.
// me = { account:{ email, plan, planStatus }, shop, plan:{ key, label, price }, site:{ previewUrl, expiresAt } | null }
export function AccountView(ctx) {
  const { me, api, navigate } = ctx;
  const account = me.account || {};
  const site = me.site || null;
  const isPremium = account.plan === 'premium';
  const planActive = account.planStatus === 'active';
  const planLabel = (me.plan && me.plan.label) || 'No plan yet';

  // A small labelled row: dim caption above, value below. Keeps the profile calm and scannable.
  const row = (label, value) => h('div', { style: { display: 'grid', gap: '3px' } },
    h('div', { class: 'eyebrow', style: { letterSpacing: '.1em' } }, label),
    h('div', { style: { fontSize: '15.5px', color: 'var(--espresso)' } }, value));

  // --- Profile ---
  const profile = h('section', { class: 'card pad' },
    h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap', marginBottom: '18px' } },
      h('h3', { style: { fontSize: '18px' } }, 'Profile'),
      h('span', { class: planActive ? 'badge ok dot' : 'badge dot' }, planLabel)),
    h('div', { style: { display: 'grid', gap: '16px' } },
      row('Email', account.email || '—'),
      row('Shop', me.shop || h('span', { class: 'muted' }, 'Not set yet'))),
    h('hr', { class: 'hairline', style: { margin: '20px 0 16px' } }),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } },
      h('button', { class: 'btn ghost sm', disabled: true }, 'Change password'),
      h('span', { class: 'muted', style: { fontSize: '13px' } }, 'Coming soon')));

  // --- Your site ---
  const siteBody = site && site.previewUrl
    ? h('div', { style: { display: 'grid', gap: '8px' } },
        h('a', { href: site.previewUrl, target: '_blank', rel: 'noopener', style: { display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, wordBreak: 'break-all' } },
          site.previewUrl, icon('ext')),
        h('p', { class: 'muted', style: { margin: 0, fontSize: '13.5px' } },
          site.expiresAt
            ? `Preview live until ${fmtDate(site.expiresAt)}.`
            : 'Your live preview — share it with anyone.'))
    : h('p', { class: 'muted', style: { margin: 0 } }, 'Your site will appear here once it’s built.');

  const yourSite = h('section', { class: 'card pad' },
    h('h3', { style: { fontSize: '18px', marginBottom: '12px' } }, 'Your site'),
    siteBody);

  // --- Domain --- (differs by plan; see report)
  const domainBody = isPremium
    ? h('div', {},
        h('div', { class: 'field', style: { marginBottom: '12px' } },
          h('label', {}, 'Your domain'),
          h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' } },
            h('input', { class: 'input', type: 'text', placeholder: 'yourshop.com', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', style: { flex: '1 1 240px' } }),
            h('button', { class: 'btn', disabled: true }, 'Connect'))),
        h('p', { class: 'muted', style: { margin: 0, fontSize: '13.5px' } }, 'Domain setup is one click — coming soon.'))
    : h('div', {},
        h('p', { class: 'muted', style: { margin: '0 0 4px' } }, 'A custom domain is included on the Premium plan.'),
        h('a', { href: '/billing', onClick: (e) => { e.preventDefault(); navigate('/billing'); } }, 'See plans'));

  const domain = h('section', { class: 'card pad' },
    h('h3', { style: { fontSize: '18px', marginBottom: '12px' } }, 'Domain'),
    domainBody);

  // --- Sign out ---
  const logoutBtn = h('button', { class: 'btn ghost' }, 'Log out');
  logoutBtn.addEventListener('click', async () => {
    logoutBtn.disabled = true;
    try {
      await api.logout();
      navigate('/login');
    } catch (ex) {
      logoutBtn.disabled = false;
      ctx.toast(ex.message || 'Could not log out — please try again.');
    }
  });
  const signOut = h('section', { class: 'card pad' },
    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' } },
      h('div', {},
        h('h3', { style: { fontSize: '18px', marginBottom: '2px' } }, 'Sign out'),
        h('p', { class: 'muted', style: { margin: 0, fontSize: '13.5px' } }, 'Sign out of Storefronty on this device.')),
      logoutBtn));

  return h('div', {},
    h('div', { class: 'view-head' },
      h('h2', {}, 'Account'),
      h('p', { class: 'muted', style: { margin: 0 } }, 'Your profile, site, and plan — all in one place.')),
    h('div', { class: 'grid' }, profile, yourSite, domain, signOut));
}
