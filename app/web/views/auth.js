import { h, themeToggle } from '../ui.js';

// Login / signup / claim. ctx = { path, api, navigate, onAuthed }.
export function AuthView(ctx) {
  const { path, api, navigate, onAuthed } = ctx;
  const wrap = h('div', { class: 'auth' });
  const card = h('div', { class: 'auth-card card pad' });
  wrap.append(card, themeToggle());
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
