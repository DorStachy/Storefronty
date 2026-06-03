import { h, toast } from '../ui.js';

// Plans & billing. ctx = { me, api, navigate, toast, refresh }.
// me = { account:{plan,planStatus,…}, plan:{key,label,price,quota}|null,
//        quota:{used,remaining,freeAvailable,allowance}, … }
// api.plans() -> { plans:[{key,label,price,quota,domainIncluded}] }
// api.checkout(key) -> { url } | { configured:false, message }
export async function BillingView(ctx) {
  const { me, api } = ctx;
  const t = ctx.toast || toast;

  // Returning from a successful Stripe checkout.
  if (new URLSearchParams(location.search).get('paid')) {
    t('Payment received — your plan is active.');
    ctx.refresh();
  }

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

  return view;
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
    cta(ctx, p, isCurrent, isFlagship));

  return card;
}

// Card action button: disabled "Current plan", or a checkout CTA.
function cta(ctx, p, isCurrent, isFlagship) {
  const { api } = ctx;
  const t = ctx.toast || toast;

  if (isCurrent) {
    return h('button', { class: 'btn block ghost', disabled: true }, 'Current plan');
  }

  const cls = isFlagship ? 'btn block accent' : 'btn block ghost';
  const label = `Choose ${p.label}`;
  const btn = h('button', { class: cls, type: 'button' }, label);

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.replaceChildren(h('span', { class: 'spinner' }));
    try {
      const r = await api.checkout(p.key);
      if (r && r.url) {
        window.location.href = r.url;
        return; // navigating away — leave the spinner up
      }
      // Stripe not wired up yet — let them know and re-enable.
      t((r && r.message) || 'Card payments switch on once Stripe is connected.');
    } catch (e) {
      t(e.message || 'Could not start checkout — please try again.');
    }
    btn.disabled = false;
    btn.replaceChildren(document.createTextNode(label));
  });

  return btn;
}
