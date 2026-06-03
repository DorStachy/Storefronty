// Light/dark theme. The INITIAL value is applied by a tiny inline script in index.html (so there's
// no flash of the wrong theme before the app boots); these helpers flip it at runtime + persist it.
const KEY = 'sf-theme';
export const getTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
export function setTheme(t) {
  document.documentElement.dataset.theme = t === 'dark' ? 'dark' : 'light';
  try { localStorage.setItem(KEY, getTheme()); } catch { /* private mode — fine */ }
}
export function toggleTheme() {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
  return getTheme();
}
