// Sign-in, registration and password reset (modal + inline in the booking wizard).
import { S, t, html, mount, $, icon, post, act, form, openModal, closeAllModals, toast, LS, errToast, track } from './core.js';

const callbacks = new Set();
export const onAuthed = (fn) => { callbacks.add(fn); return () => callbacks.delete(fn); };
let current = null; // open auth modal

export function setUser(u, { silent } = {}) {
  S.user = u;
  updateNav();
  if (!silent) for (const fn of callbacks) { try { fn(u); } catch (e) { console.error(e); } }
}
export function updateNav() {
  const btn = $('#nav-account span'); if (btn) { btn.dataset.t = ''; btn.removeAttribute('data-t'); btn.textContent = S.user ? t('My account') : t('Sign in'); }
  const tab = $('#tabbar [data-tab=account] span:last-child'); if (tab) { tab.removeAttribute('data-t'); tab.textContent = S.user ? t('Account') : t('Sign in'); }
}

export function authForm(mode, { inline = false } = {}) {
  const ref = LS.get('tp_ref') || '';
  if (mode === 'login') return html`
    <form class="stack" data-form="login" novalidate>
      <label class="field"><span>${t('Email')}</span><input type="email" name="email" autocomplete="email" inputmode="email" required></label>
      <label class="field"><span>${t('Password')}</span><input type="password" name="password" autocomplete="current-password" required></label>
      <button class="btn btn-primary btn-block" type="submit">${t('Sign in')}</button>
      <div class="row between"><button type="button" class="btn-link" data-act="auth-mode" data-v="forgot">${t('Forgot password?')}</button><button type="button" class="btn-link" data-act="auth-mode" data-v="register">${t('Create an account')}</button></div>
    </form>`;
  if (mode === 'forgot') return html`
    <form class="stack" data-form="forgot" novalidate>
      <p class="muted">${t('Enter your email and we will send you a link to choose a new password.')}</p>
      <label class="field"><span>${t('Email')}</span><input type="email" name="email" autocomplete="email" inputmode="email" required></label>
      <button class="btn btn-primary btn-block" type="submit">${t('Send reset link')}</button>
      <button type="button" class="btn-link" data-act="auth-mode" data-v="login">${t('Back to sign in')}</button>
    </form>`;
  if (mode === 'reset') return html`
    <form class="stack" data-form="reset" novalidate>
      <p class="muted">${t('Choose a new password for your account.')}</p>
      <label class="field"><span>${t('New password')}</span><input type="password" name="password" autocomplete="new-password" minlength="8" required><small class="hint">${t('At least 8 characters')}</small></label>
      <button class="btn btn-primary btn-block" type="submit">${t('Save password')}</button>
    </form>`;
  return html`
    <form class="stack" data-form="register" novalidate>
      <label class="field"><span>${t('Full name')}</span><input type="text" name="name" autocomplete="name" required></label>
      <label class="field"><span>${t('Email')}</span><input type="email" name="email" autocomplete="email" inputmode="email" required></label>
      <label class="field"><span>${t('Mobile phone')}</span><input type="tel" name="phone" autocomplete="tel" inputmode="tel" placeholder="787-555-1234"></label>
      <label class="field"><span>${t('Password')}</span><input type="password" name="password" autocomplete="new-password" minlength="8" required><small class="hint">${t('At least 8 characters')}</small></label>
      <label class="field"><span>${t('Referral code (optional)')}</span><input type="text" name="referral_code" value="${ref}" autocapitalize="characters"></label>
      <button class="btn btn-primary btn-block" type="submit">${t('Create account')}</button>
      <div class="row between"><span class="muted tiny">${t('Already have an account?')}</span><button type="button" class="btn-link" data-act="auth-mode" data-v="login">${t('Sign in')}</button></div>
    </form>`;
}
const TITLES = { login: 'Welcome back', register: 'Create your account', forgot: 'Reset your password', reset: 'New password' };

export function openAuth(mode = 'login') {
  closeAuth();
  current = openModal(authForm(mode), { title: t(TITLES[mode]), size: 'sm', onClose: () => { current = null; } });
  current.mode = mode; return current;
}
export const closeAuth = () => { current?.close(); current = null; };

act('auth-mode', (el) => {
  const mode = el.dataset.v; const host = el.closest('[data-auth-inline]');
  if (host) { mount(host, authForm(mode, { inline: true })); host.dataset.mode = mode; return; }
  if (current) { current.set(authForm(mode)); current.mode = mode; const h = current.el.closest('.modal')?.querySelector('.modal-h h3'); if (h) h.textContent = t(TITLES[mode]); }
});

async function afterAuth(r) {
  setUser(r.user);
  closeAuth();
  toast(t('Welcome, {name}!', { name: (r.user.name || '').split(' ')[0] }), 'ok');
  if (r.user.role === 'admin' && !document.querySelector('[data-auth-inline]')) location.hash = '#admin';
  else if (r.user.role === 'employee') location.hash = '#work';
}
form('login', async (d) => { const r = await post('/api/auth/login', { email: d.email, password: d.password }); track('login'); await afterAuth(r); });
form('register', async (d) => {
  const r = await post('/api/auth/register', { name: d.name, email: d.email, phone: d.phone, password: d.password, referral_code: d.referral_code });
  LS.set('tp_ref', ''); track('sign_up'); await afterAuth(r);
});
form('forgot', async (d, f) => {
  await post('/api/auth/forgot', { email: d.email });
  mount(f, html`<div class="alert ok">${t('If that email has an account, a reset link is on its way.')}</div>`);
});
form('reset', async (d) => {
  const token = new URLSearchParams(location.search).get('reset');
  const r = await post('/api/auth/reset', { token, password: d.password });
  history.replaceState(null, '', location.pathname + location.hash); await afterAuth(r);
});

export async function logout() {
  try { await post('/api/auth/logout'); } catch { /* ignore */ }
  setUser(null); toast(t('You have been signed out.'));
}
