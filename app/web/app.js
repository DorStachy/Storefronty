// Portal SPA — router + app shell. Views are functions(ctx) -> DOM node.
// ctx = { me, api, navigate, toast, refresh }. `me` = GET /api/me payload:
//   { account, shop, plan:{key,label,price,quota}, quota:{used,remaining,freeAvailable,allowance},
//     site:{ previewUrl, screenshots[], expiresAt, status } | null }
import { h, mount, toast, icon, initials } from './ui.js';
import { api } from './api.js';
import { AuthView } from './views/auth.js';
import { DashboardView } from './views/dashboard.js';
import { ConsoleView } from './views/console.js';
import { BillingView } from './views/billing.js';
import { AccountView } from './views/account.js';

const root = document.getElementById('root');
const APP_ROUTES = {
  '/dashboard': { title: 'Dashboard', icon: 'home', view: DashboardView },
  '/requests': { title: 'Requests', icon: 'chat', view: ConsoleView },
  '/billing': { title: 'Billing', icon: 'card', view: BillingView },
  '/account': { title: 'Account', icon: 'user', view: AccountView },
};

const state = { me: null };

export function navigate(path, replace = false) {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  render();
}

const ctx = () => ({
  me: state.me, api, navigate, toast,
  refresh: async () => { state.me = await api.me(); render(); },
});

async function render() {
  const path = location.pathname;
  if (path === '/login' || path === '/signup' || path.startsWith('/claim/')) {
    mount(root, AuthView({ ...ctx(), path, onAuthed: async () => { state.me = await api.me().catch(() => null); navigate('/dashboard', true); } }));
    return;
  }
  if (!state.me) {
    try { state.me = await api.me(); } catch { navigate('/login', true); return; }
  }
  const route = APP_ROUTES[path];
  if (!route) { navigate('/dashboard', true); return; }
  let viewNode;
  try { viewNode = await route.view(ctx()); } catch (e) { viewNode = errorPane(e); }
  mount(root, Shell(route, viewNode));
}

const planLabel = (me) => (me.plan && me.plan.label ? me.plan.label : 'No plan yet');
const errorPane = (e) => h('div', { class: 'center-pad' }, `Couldn't load this — ${e.message || e}`);

function Shell(route, viewNode) {
  const me = state.me;
  const app = h('div', { class: 'app' });
  const link = (p, r) => h('a', {
    href: p, class: location.pathname === p ? 'active' : '',
    onClick: (e) => { e.preventDefault(); navigate(p); },
  }, icon(r.icon), r.title);

  const sidebar = h('aside', { class: 'sidebar' },
    h('div', { class: 'brand' }, h('span', { class: 'mark' }), 'Storefronty'),
    h('nav', { class: 'nav' }, ...Object.entries(APP_ROUTES).map(([p, r]) => link(p, r))),
    h('div', { class: 'foot' },
      h('div', { class: 'who' },
        h('div', { class: 'avatar' }, initials(me.account.email)),
        h('div', { style: { minWidth: 0 } },
          h('div', { style: { fontSize: '13.5px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, me.shop || me.account.email),
          h('div', { class: 'muted', style: { fontSize: '12px' } }, planLabel(me))))));

  const topbar = h('div', { class: 'topbar' },
    h('button', { class: 'menu-btn', 'aria-label': 'Menu', onClick: () => app.classList.toggle('nav-open') }, icon('menu')),
    h('h1', {}, route.title),
    me.site && me.site.previewUrl
      ? h('a', { class: 'btn ghost sm', href: me.site.previewUrl, target: '_blank', rel: 'noopener' }, 'View live site', icon('ext'))
      : h('span'));

  app.append(sidebar, h('main', { class: 'main' }, topbar, h('div', { class: 'view' }, viewNode)));
  sidebar.addEventListener('click', (e) => { if (e.target.closest('a')) app.classList.remove('nav-open'); });
  return app;
}

window.addEventListener('popstate', render);
render();
