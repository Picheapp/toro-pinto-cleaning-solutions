// Shared full-screen app frame used by the customer account, admin and employee views.
import { S, t, html, mount, $, icon, act, post, toast, setLang } from './core.js';
import { setUser } from './auth.js';

let cur = null;
export const currentApp = () => cur;
export function openApp(kind, go) {
  const v = $('#app-view'); v.hidden = false; document.body.classList.add('locked'); cur = { kind, go }; return v;
}
export function closeApp() {
  const v = $('#app-view'); v.hidden = true; v.innerHTML = ''; cur = null;
  if (!document.querySelector('#layer .ov')) document.body.classList.remove('locked');
}
export function frame({ title, tabs, active, body, badge = {} }) {
  const tabBtn = (x, cls) => html`<button type="button" class="${active === x.id ? 'on' : ''}" data-act="app-tab" data-id="${x.id}">${icon(x.icon)}<span>${x.label}</span>${badge[x.id] ? html`<i class="badge-dot">${badge[x.id]}</i>` : ''}</button>`;
  return html`<div class="app">
    <header class="app-top"><button class="icon-btn" data-act="app-close" aria-label="${t('Back to website')}">${icon('left')}</button><h1>${title}</h1>
      <div class="seg" role="group" aria-label="Language"><button type="button" data-act="lang" data-v="es" class="${S.lang === 'es' ? 'on' : ''}">ES</button><button type="button" data-act="lang" data-v="en" class="${S.lang === 'en' ? 'on' : ''}">EN</button></div>
      <button class="icon-btn" data-act="app-logout" aria-label="${t('Sign out')}" title="${t('Sign out')}">${icon('logout')}</button></header>
    <div class="app-body"><nav class="side" aria-label="${title}">${tabs.map((x) => tabBtn(x))}</nav><main class="app-main" id="app-main">${body}</main></div>
    <nav class="mtabs" aria-label="${title}">${tabs.map((x) => tabBtn(x))}</nav></div>`;
}
export function paint(content) { const v = $('#app-view'); const sc = v.scrollTop; mount(v, content); v.scrollTop = sc; }

act('app-tab', (el) => { cur?.go(el.dataset.id); $('#app-view').scrollTo({ top: 0 }); });
act('app-close', () => { closeApp(); if (/^#(account|admin|work)/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search + '#home'); window.scrollTo({ top: 0 }); });
act('app-logout', async () => {
  try { await post('/api/auth/logout'); } catch { /* ignore */ }
  closeApp(); setUser(null); history.replaceState(null, '', location.pathname + '#home'); toast(t('You have been signed out.'));
});
