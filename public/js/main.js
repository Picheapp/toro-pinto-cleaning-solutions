// App entry: boot data, language, routing between the public site and the signed-in app views.
import { S, LS, t, api, $, $$, initLang, setLang, applyStatic, initDelegation, act, toast, closeModal, closeAllModals, errToast } from './core.js';
import { initSite, renderSite } from './site.js';
import { initWizard, renderWizard, renderEstimator } from './booking.js';
import { initShop, renderShop } from './shop.js';
import { setUser, updateNav, onAuthed, openAuth } from './auth.js';
import { openAccount } from './account.js';
import { openAdmin } from './admin.js';
import { openWork } from './employee.js';
import { closeApp, currentApp } from './appshell.js';

initLang();
initDelegation();
applyStatic();

act('close-modal', () => closeModal());
act('lang', (el) => setLang(el.dataset.v));
let wantApp = 0;
act('account', () => {
  if (!S.user) { wantApp = Date.now(); openAuth('login'); return; }
  openFor(S.user);
});
function openFor(u, tab) {
  if (u.role === 'admin') return openAdmin(tab);
  if (u.role === 'employee') return openWork();
  return openAccount(tab);
}
onAuthed((u) => { if (u && u.role === 'customer' && wantApp && Date.now() - wantApp < 180000) { wantApp = 0; openAccount(); } });

// ---- hash routing
async function route() {
  const m = /^#(account|admin|work)(?:\/([\w-]+))?/.exec(location.hash);
  if (!m) { if (currentApp()) closeApp(); return; }
  const [, kind, tab] = m; const u = S.user;
  if (!u) { openAuth('login'); history.replaceState(null, '', location.pathname + location.search + '#home'); return; }
  if (kind === 'admin') { if (u.role !== 'admin') { toast(t('That area is for staff only.'), 'bad'); history.replaceState(null, '', '#home'); return; } return openAdmin(tab); }
  if (kind === 'work') { if (u.role === 'customer') { toast(t('That area is for staff only.'), 'bad'); history.replaceState(null, '', '#home'); return; } return openWork(); }
  return openFor(u, tab);
}
window.addEventListener('hashchange', () => route().catch(errToast));

// ---- scroll spy for the bottom tab bar and top nav
function spy() {
  const map = { home: 'home', trust: 'home', services: 'services', estimator: 'services', book: 'book', shop: 'shop' };
  const ids = ['home', 'trust', 'services', 'estimator', 'book', 'plans', 'shop', 'gallery', 'reviews', 'rewards', 'area', 'faq', 'quote'];
  const els = ids.map((id) => document.getElementById(id)).filter(Boolean); if (!els.length || !('IntersectionObserver' in window)) return;
  const vis = new Map();
  const io = new IntersectionObserver((es) => {
    for (const e of es) vis.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
    let best = null, bv = 0; for (const [id, r] of vis) if (r > bv) { best = id; bv = r; }
    const tab = best ? map[best] : null;
    $$('#tabbar [data-tab]').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
    $$('.nav-links a, .nav a[href^="#"]').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + best));
  }, { rootMargin: '-35% 0px -45% 0px', threshold: [0, 0.01, 0.2, 0.5, 1] });
  els.forEach((e) => io.observe(e));
}

// ---- return trips from payment pages and email links
function handleParams() {
  const q = new URLSearchParams(location.search); let dirty = false; let tab = null;
  if (q.has('paid')) { dirty = true; if (q.get('paid') === '1') { toast(t('Payment received — thank you!'), 'ok'); tab = 'invoices'; } else toast(t('Payment was cancelled. You have not been charged.')); if (!location.hash.startsWith('#account')) history.replaceState(null, '', location.pathname + '?' + q + '#account'); }
  if (q.get('card') === 'saved') { dirty = true; toast(t('Card saved.'), 'ok'); tab = 'profile'; }
  if (q.get('ref')) { LS.set('tp_ref', String(q.get('ref')).toUpperCase().slice(0, 20)); dirty = true; }
  if (q.get('reset')) { setTimeout(() => openAuth('reset'), 300); }
  else if (dirty) { for (const k of ['paid', 'inv', 'card', 'ref']) q.delete(k); const s = q.toString(); history.replaceState(null, '', location.pathname + (s ? '?' + s : '') + location.hash); }
  return tab;
}

function loadAnalytics() {
  if (!S.cfg.gaId) return; const s = document.createElement('script'); s.src = '/js/ga.js'; s.async = true; document.head.appendChild(s);
}

async function boot() {
  let b;
  try { b = await api('/api/bootstrap'); } catch (e) {
    document.body.insertAdjacentHTML('afterbegin', `<div style="background:#b3261e;color:#fff;padding:.8rem;text-align:center;position:relative;z-index:99">${t('We could not load the site. Please check your connection and refresh.')}</div>`); return;
  }
  S.boot = b; S.settings = b.settings; S.cfg = b.config || {}; S.user = b.user || null;
  S.cat = { categories: b.categories, services: b.services, addons: b.addons, products: b.products, plans: b.plans, gallery: b.gallery };
  setUser(S.user, { silent: true });
  initSite(); initWizard(); initShop(); updateNav(); applyStatic();
  document.addEventListener('tp:catalog', () => { renderSite(); renderShop(); renderEstimator?.(); renderWizard(); });
  const tab = handleParams();
  spy(); loadAnalytics();
  if (tab && S.user) { location.hash = '#account'; }
  await route().catch(errToast);
  if (tab && S.user?.role === 'customer') openAccount(tab);
  document.documentElement.classList.add('ready');
}
boot();
