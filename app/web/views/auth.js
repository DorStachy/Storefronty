import { h, themeToggle } from '../ui.js';

// Login / signup / claim. ctx = { path, api, navigate, onAuthed }.
export function AuthView(ctx) {
  const { path, api, navigate, onAuthed } = ctx;
  const wrap = h('div', { class: 'auth' });
  const card = h('div', { class: 'auth-card card pad' });
  wrap.append(card, themeToggle());
  const urlErr = new URLSearchParams(location.search).get('err');
  if (urlErr && ctx.toast) ctx.toast(urlErr === 'google_off' ? "Google sign-in isn't set up yet." : "Google sign-in didn't finish — please try again.");
  const brand = () => h('div', { class: 'brand' }, h('span', { class: 'mark' }), 'Storefronty');

  function authForm({ mode, shop, token }) {
    const isSignup = mode !== 'login';
    const err = h('div', { style: { color: 'var(--danger)', fontSize: '14px', minHeight: '18px', marginBottom: '6px' } });
    const email = h('input', { class: 'input', type: 'email', placeholder: 'you@email.com', required: true, autocomplete: 'email' });
    const pass = h('input', { class: 'input', type: 'password', placeholder: isSignup ? 'a password (8+ characters)' : 'your password', required: true, autocomplete: isSignup ? 'new-password' : 'current-password' });
    const submit = h('button', { class: 'btn block', type: 'submit' }, isSignup ? 'Create account' : 'Log in');

    const form = h('form', {
      onSubmit: async (e) => {
        e.preventDefault(); err.textContent = ''; submit.disabled = true;
        const label = submit.textContent; submit.textContent = '…';
        try {
          if (isSignup) await api.signup({ email: email.value, password: pass.value, token });
          else await api.login({ email: email.value, password: pass.value });
          await onAuthed();
        } catch (ex) { err.textContent = ex.message || 'Something went wrong'; submit.disabled = false; submit.textContent = label; }
      },
    },
      h('div', { class: 'field' }, h('label', {}, 'Email'), email),
      h('div', { class: 'field' }, h('label', {}, 'Password'), pass),
      err, submit);

    return h('div', {},
      brand(),
      h('h1', {}, isSignup ? 'Create your account' : 'Welcome back'),
      h('p', { class: 'sub' }, isSignup
        ? (shop ? `for ${shop} — this saves the site to you and unlocks one more change, free.` : 'Manage your site, request changes, and pick a plan.')
        : 'Log in to manage your site and changes.'),
      form,
      googleBlock(ctx, token),
      h('p', { class: 'alt' }, isSignup ? 'Already have an account? ' : "Don't have one yet? ",
        h('a', { href: isSignup ? '/login' : '/signup', onClick: (e) => { e.preventDefault(); navigate(isSignup ? '/login' : '/signup'); } }, isSignup ? 'Log in' : 'Sign up')));
  }

  if (path.startsWith('/claim/')) {
    const token = decodeURIComponent(path.slice('/claim/'.length));
    card.append(h('div', { class: 'center-pad' }, h('span', { class: 'spinner' })));
    api.claim(token)
      .then((r) => card.replaceChildren(authForm({ mode: 'signup', shop: r.shop && r.shop.name, token })))
      .catch(() => card.replaceChildren(
        brand(),
        h('h1', {}, 'That link expired'),
        h('p', { class: 'sub' }, 'This account link is no longer valid — but you can still log in or sign up.'),
        h('div', { style: { display: 'flex', gap: '10px' } },
          h('a', { class: 'btn', href: '/login', onClick: (e) => { e.preventDefault(); navigate('/login'); } }, 'Log in'),
          h('a', { class: 'btn ghost', href: '/signup', onClick: (e) => { e.preventDefault(); navigate('/signup'); } }, 'Sign up'))));
  } else {
    card.append(authForm({ mode: path === '/login' ? 'login' : 'signup' }));
  }
  return wrap;
}

// "Continue with Google" — only shown when Google OAuth is configured server-side. Carries the claim
// token (if any) so a Google signup still binds the account to the lead's site.
function googleBlock(ctx, token) {
  const wrap = h('div', {});
  ctx.api.authConfig().then((c) => {
    if (!c || !c.google) return;
    const href = `/auth/google${token ? `?claim=${encodeURIComponent(token)}` : ''}`;
    wrap.append(
      h('div', { class: 'or' }, 'or'),
      h('a', { class: 'btn ghost block gbtn', href }, googleG(), 'Continue with Google'));
  }).catch(() => { /* config unavailable → just omit the button */ });
  return wrap;
}

function googleG() {
  const s = h('span', { class: 'gg', 'aria-hidden': 'true' });
  s.innerHTML = '<svg viewBox="0 0 18 18" width="18" height="18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95L3.97 7.28C4.68 5.16 6.66 3.58 9 3.58z"/></svg>';
  return s;
}
