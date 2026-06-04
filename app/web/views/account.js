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
    h('div', { style: { display: 'grid', gap: '10px' } },
      h('div', { class: 'eyebrow', style: { letterSpacing: '.1em' } }, 'Security'),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
        h('span', { class: account.emailVerified ? 'badge ok dot' : 'badge dot' }, account.emailVerified ? 'Email verified' : 'Email not verified'),
        h('span', { class: 'muted', style: { fontSize: '13px' } }, 'We email a 6-digit code to confirm sign-ins from a new device.'))));

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

  // --- Domain --- (Premium: functional connect + verify; otherwise an upsell)
  const domainBody = isPremium && planActive
    ? domainPanel(ctx)
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

// Premium custom-domain panel: enter a domain → save (pending) → show the CNAME to add → Verify.
// Builds DOM with in-place handlers (the SPA has no reactive layer). me.domain = { name, status, cname }.
function domainPanel(ctx) {
  const { me, api } = ctx;
  const wrap = h('div', {});
  const status = h('div', { style: { margin: '0 0 12px', fontSize: '13.5px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } });
  const cnameBox = h('div', { class: 'cname-box', hidden: 'hidden' });
  const input = h('input', { class: 'input', type: 'text', placeholder: 'yourshop.com', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', style: { flex: '1 1 220px' }, value: (me.domain && me.domain.name) || '' });
  const saveBtn = h('button', { class: 'btn', type: 'button' }, me.domain ? 'Update' : 'Connect');
  const verifyBtn = h('button', { class: 'btn ghost', type: 'button', hidden: me.domain ? null : 'hidden' }, 'Verify');

  const showCname = (cname) => {
    if (!cname) { cnameBox.hidden = 'hidden'; return; }
    cnameBox.replaceChildren(
      h('div', { class: 'eyebrow', style: { marginBottom: '6px' } }, 'Point your DNS here'),
      h('div', { class: 'cname-row' }, h('code', {}, cname.type || 'CNAME'), h('code', {}, cname.name || 'www'), h('span', { class: 'muted' }, '→'), h('code', {}, cname.value)),
      h('p', { class: 'muted', style: { margin: '8px 0 0', fontSize: '13px' } }, 'Add this record at your domain registrar, then hit Verify. DNS can take a few minutes to propagate.'));
    cnameBox.hidden = null;
  };
  const setStatus = (st) => {
    if (!st || st === 'none') { status.replaceChildren(); return; }
    const verified = st === 'verified';
    status.replaceChildren(
      h('span', { class: verified ? 'badge ok dot' : 'badge dot' }, verified ? 'Connected' : 'Pending'),
      h('span', { class: 'muted' }, verified ? 'Your domain is live.' : 'Add the DNS record below, then verify.'));
  };

  if (me.domain) { setStatus(me.domain.status); showCname(me.domain.cname); }

  saveBtn.addEventListener('click', async () => {
    const domain = input.value.trim();
    if (!domain) { ctx.toast('Enter your domain first.'); return; }
    saveBtn.disabled = true; const lbl = saveBtn.textContent; saveBtn.replaceChildren(h('span', { class: 'spinner' }));
    try {
      const r = await api.setDomain(domain);
      setStatus(r.status); showCname(r.cname); verifyBtn.hidden = null;
      ctx.toast('Saved — add the DNS record, then verify.');
    } catch (e) { ctx.toast(e.message || 'Could not save the domain.'); }
    finally { saveBtn.disabled = false; saveBtn.replaceChildren(document.createTextNode(lbl)); }
  });
  verifyBtn.addEventListener('click', async () => {
    verifyBtn.disabled = true; verifyBtn.replaceChildren(h('span', { class: 'spinner' }));
    try {
      const r = await api.verifyDomain();
      setStatus(r.status);
      ctx.toast(r.status === 'verified' ? 'Verified — you’re live on your domain.' : 'Not visible yet — give DNS a few minutes, then try again.');
    } catch (e) { ctx.toast(e.message || 'Could not verify yet.'); }
    finally { verifyBtn.disabled = false; verifyBtn.replaceChildren(document.createTextNode('Verify')); }
  });

  wrap.append(
    status,
    h('div', { class: 'field', style: { marginBottom: '12px' } },
      h('label', {}, 'Your domain'),
      h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' } }, input, saveBtn, verifyBtn)),
    cnameBox);
  return wrap;
}
