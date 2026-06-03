import { h, icon, toast } from '../ui.js';

// Plans & billing. ctx = { me, api, navigate, toast, refresh }.
// me = { account:{plan,planStatus,…}, plan:{key,label,price,quota}|null,
//        quota:{used,remaining,freeAvailable,allowance}, … }
// api.plans() -> { plans:[{key,label,price,quota,domainIncluded}] }
// api.checkout(key) -> { url } | { configured:false, message }
export async function BillingView(ctx) {
  const { me, api } = ctx;
  const t = ctx.toast || toast;

  // Returning from a successful Stripe checkout.
  const qs = new URLSearchParams(location.search);
  if (qs.get('paid')) { t('Payment received — your plan is active.'); ctx.refresh(); }
  if (qs.get('topped')) { t("Changes added — they're ready to use."); ctx.refresh(); }

  const view = h('div', {});

  // ---- header ----------------------------------------------------------
  view.append(h('div', { class: 'view-head' },
    h('h2', {}, 'Plans & billing'),
    h('p', { class: 'muted' }, 'Pick the plan that fits your shop. Change or cancel anytime — no contracts.')));

  // ---- current status --------------------------------------------------
  view.append(statusCard(me));

  // ---- plan cards ------------------------------------------------------
  const grid = h('div', { class: 'plans' });
  view.append(grid);

  const { plans } = await api.plans();
  const list = plans || [];
  // The flagship is the highest-priced tier — gets the gold "Recommended"
  // accent. Resolved from data so it stays truthful whatever the keys are.
  const flagship = list.reduce(
    (best, p) => (best == null || p.price > best.price ? p : best), null,
  );
  const flagshipKey = flagship && flagship.key;

  for (const p of list) grid.append(planCard(ctx, p, flagshipKey));

  view.append(await topupSection(ctx));
  return view;
}

// One-time "buy more changes" packs (credits never expire; used after the monthly plan quota).
async function topupSection(ctx) {
  const wrap = h('div', { style: { marginTop: '34px' } });
  wrap.append(h('div', { class: 'view-head', style: { marginBottom: '14px' } },
    h('h2', { style: { fontSize: '21px' } }, 'Need a few more changes?'),
    h('p', { class: 'muted' }, 'Grab a one-time pack — credits never expire and kick in after your monthly plan.')));
  let packs = [];
  try { packs = (await ctx.api.topups()).topups || []; } catch { /* none */ }
  const row = h('div', { class: 'topups' });
  for (const tp of packs) row.append(topupCard(ctx, tp));
  wrap.append(row);
  return wrap;
}

function topupCard(ctx, tp) {
  const t = ctx.toast || toast;
  const per = tp.price / tp.changes;
  const btn = h('button', { class: 'btn ghost block', type: 'button' }, `Buy — $${tp.price}`);
  btn.addEventListener('click', async () => {
    btn.disabled = true; const lbl = `Buy — $${tp.price}`;
    btn.replaceChildren(h('span', { class: 'spinner' }));
    await startPay(ctx, { key: tp.key, kind: 'topup', changes: tp.changes });
    btn.disabled = false; btn.replaceChildren(document.createTextNode(lbl));
  });
  return h('div', { class: 'card pad topup' },
    h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px' } },
      h('div', { style: { fontSize: '24px', fontWeight: 800, letterSpacing: '-0.03em' } }, `+${tp.changes}`),
      h('div', { class: 'muted', style: { fontSize: '13px' } }, `$${per.toFixed(2)} each`)),
    h('div', { class: 'muted', style: { fontSize: '14px', margin: '4px 0 16px' } }, `${tp.changes} extra changes, one-time`),
    btn);
}

// Current plan + usage panel.
function statusCard(me) {
  const card = h('div', { class: 'card pad', style: { marginBottom: '22px' } });

  // No plan: warm nudge toward the free change.
  if (!me.plan) {
    return h('div', { class: 'card pad', style: { marginBottom: '22px' } },
      h('div', { class: 'eyebrow', style: { marginBottom: '8px' } }, 'Your plan'),
      h('p', { style: { margin: 0, fontSize: '15.5px', color: 'var(--ink-70)' } },
        "You're on your free change right now — pick a plan to keep requesting changes."));
  }

  const q = me.quota || {};
  const unlimited = q.allowance == null;
  const used = q.used == null ? 0 : q.used;
  const usageText = unlimited
    ? 'Unlimited changes'
    : `${used} of ${q.allowance} changes used this month`;

  card.append(
    h('div', { class: 'eyebrow', style: { marginBottom: '8px' } }, 'Current plan'),
    h('div', {
      style: { display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' },
    },
      h('span', { style: { fontFamily: 'var(--display)', fontSize: '24px' } }, me.plan.label),
      h('span', { class: 'muted', style: { fontSize: '15px' } }, `$${me.plan.price}/mo`),
      h('span', { class: 'badge ok dot', style: { marginLeft: 'auto' } }, 'Active')),
    h('p', { class: 'muted', style: { margin: '10px 0 0', fontSize: '14.5px' } }, usageText));

  // Remaining / free-change extras on a second line when meaningful.
  const extras = [];
  if (!unlimited && q.remaining != null) {
    extras.push(`${q.remaining} remaining`);
  }
  if (q.freeAvailable) extras.push('1 free change available');
  if (extras.length) {
    card.append(h('p', {
      class: 'muted', style: { margin: '4px 0 0', fontSize: '13.5px' },
    }, extras.join(' · ')));
  }

  return card;
}

// One plan card.
function planCard(ctx, p, flagshipKey) {
  const { me } = ctx;
  const isCurrent = me.account && me.account.plan === p.key && me.account.planStatus === 'active';
  const isFlagship = p.key === flagshipKey;

  const card = h('article', { class: isCurrent ? 'card plan current' : 'card plan' });

  // Top tag: current state wins; otherwise the flagship gets "Recommended".
  if (isCurrent) card.append(h('span', { class: 'tag' }, 'Current'));
  else if (isFlagship) card.append(h('span', { class: 'tag' }, 'Recommended'));

  // Features — kept real and short.
  const features = [
    p.quota === null ? 'Unlimited changes' : `${p.quota} changes / month`,
    'Unlimited-within-plan tweaks',
    'Hosted + SSL included',
  ];
  if (p.domainIncluded) features.splice(1, 0, 'Custom domain included');

  card.append(
    h('h3', {}, p.label),
    h('div', { class: 'price' }, `$${p.price}`, h('small', {}, '/mo')),
    h('ul', {}, ...features.map((f) => h('li', {}, f))),
    // "See an example" → the generic hand-built showcase for this tier (Pro/Premium), opened in a new tab.
    p.exampleUrl ? h('a', { class: 'plan-example', href: p.exampleUrl, target: '_blank', rel: 'noopener' }, 'See an example', icon('ext')) : null,
    cta(ctx, p, isCurrent, isFlagship));

  return card;
}

// Open checkout for a plan or a top-up. Paddle (overlay) when configured, else Stripe redirect, else
// a friendly "switch on soon" toast. customData is what our webhook reads to grant access.
async function startPay(ctx, opts) {
  const t = ctx.toast || toast;
  const pay = ctx.me.pay || {};
  if (pay.provider === 'paddle' && pay.ready) {
    const priceId = (pay.prices || {})[opts.key];
    if (!priceId) { t("That isn't set up yet — try again shortly."); return; }
    const customData = opts.kind === 'topup'
      ? { accountId: String(ctx.me.account.id), changes: String(opts.changes) }
      : { accountId: String(ctx.me.account.id), plan: opts.key };
    try {
      const { paddleCheckout } = await import('../pay.js');
      await paddleCheckout(pay, { priceId, email: ctx.me.account.email, customData });
    } catch (e) { t(e.message || 'Could not open checkout.'); }
    return;
  }
  try {
    const r = opts.kind === 'topup' ? await ctx.api.topup(opts.key) : await ctx.api.checkout(opts.key);
    if (r && r.url) { window.location.href = r.url; return; }
    // Stub provider: the server already granted the plan + made the site permanent. Refresh in place.
    if (r && r.ok) {
      t(opts.kind === 'topup' ? 'Changes added — ready to use.' : 'Plan active — your site is now live for good.');
      if (ctx.refresh) await ctx.refresh();
      return;
    }
    t((r && r.message) || 'Card payments switch on once checkout is connected.');
  } catch (e) { t(e.message || 'Could not start checkout — please try again.'); }
}

// Card action button: disabled "Current plan", or a checkout CTA.
function cta(ctx, p, isCurrent, isFlagship) {
  if (isCurrent) return h('button', { class: 'btn block ghost', disabled: true }, 'Current plan');
  const cls = isFlagship ? 'btn block accent' : 'btn block ghost';
  const label = `Choose ${p.label}`;
  const btn = h('button', { class: cls, type: 'button' }, label);
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.replaceChildren(h('span', { class: 'spinner' }));
    await startPay(ctx, { key: p.key, kind: 'plan' });
    btn.disabled = false;
    btn.replaceChildren(document.createTextNode(label));
  });
  return btn;
}
