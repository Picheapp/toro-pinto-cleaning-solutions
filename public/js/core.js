// Shared core: state, i18n, API, safe HTML templating, UI primitives.
import { ES } from './es.js';

export const S = { boot: null, cfg: {}, settings: null, cat: null, user: null, lang: 'en', cart: [], reviews: null, stats: null };
const LS = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
export { LS };

// ---------------------------------------------------------------- i18n
export function t(key, vars) {
  let s = S.lang === 'es' && Object.prototype.hasOwnProperty.call(ES, key) ? ES[key] : key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  return s;
}
// localized field of a catalog object: tl(service,'name') -> name_es when Spanish
export const tl = (o, f) => (o ? (S.lang === 'es' && o[f + '_es'] ? o[f + '_es'] : o[f]) : '');
export const tlist = (o, f) => (S.lang === 'es' && o[f + '_es'] && o[f + '_es'].length ? o[f + '_es'] : o[f] || []);
const detectLang = () => { const s = LS.get('tp_lang'); if (s === 'es' || s === 'en') return s; return (navigator.language || 'en').toLowerCase().startsWith('es') ? 'es' : 'en'; };
const rerenders = new Set();
export const onLang = (fn) => { rerenders.add(fn); return fn; };
export function setLang(l, silent) {
  S.lang = l === 'es' ? 'es' : 'en'; LS.set('tp_lang', S.lang);
  document.documentElement.lang = S.lang;
  applyStatic();
  if (!silent) for (const fn of rerenders) { try { fn(); } catch (e) { console.error(e); } }
}
export function applyStatic(root = document) {
  root.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  root.querySelectorAll('[data-t-ph]').forEach((el) => { el.placeholder = t(el.dataset.tPh); });
  root.querySelectorAll('[data-t-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.tAria)); });
  root.querySelectorAll('[data-act="lang"]').forEach((b) => b.classList.toggle('on', b.dataset.v === S.lang));
}
export function initLang() { S.lang = detectLang(); document.documentElement.lang = S.lang; }

// ---------------------------------------------------------------- formatting
const loc = () => (S.lang === 'es' ? 'es-PR' : 'en-US');
export const money = (c) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((c || 0) / 100);
export const moneyShort = (c) => ((c || 0) % 100 === 0 ? money(c).replace('.00', '') : money(c));
export const num = (n) => new Intl.NumberFormat(loc()).format(n || 0);
export function fmtDate(d, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  if (!d) return '';
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T12:00:00Z') : new Date(d);
  return new Intl.DateTimeFormat(loc(), { ...opts, ...(/^\d{4}-\d{2}-\d{2}$/.test(d) ? { timeZone: 'UTC' } : {}) }).format(dt);
}
export const fmtDateTime = (d) => fmtDate(d, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export function fmtTime(hhmm) { if (!hhmm) return ''; const [h, m] = hhmm.split(':').map(Number); return new Intl.DateTimeFormat(loc(), { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, 0, 1, h, m))); }
export const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: S.settings?.timezone || 'America/Puerto_Rico' }).format(new Date());

// ---------------------------------------------------------------- safe html templating
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Safe(String(s ?? ''));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const part = (v) => (v instanceof Safe ? v.s : Array.isArray(v) ? v.map(part).join('') : v === null || v === undefined || v === false ? '' : esc(v));
export const html = (strs, ...vals) => new Safe(strs.reduce((out, s, i) => out + s + (i < vals.length ? part(vals[i]) : ''), ''));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const mount = (el, safe) => { if (typeof el === 'string') el = $(el); if (el) { el.innerHTML = safe instanceof Safe ? safe.s : esc(safe); applyStatic(el); } return el; };
export const icon = (n, cls = '') => raw(`<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`);
export const stars = (n, max = 5) => raw(`<span class="stars" role="img" aria-label="${esc(n)} / ${max}">${Array.from({ length: max }, (_, i) => `<svg class="ic ${i < Math.round(n) ? '' : 'off'}"><use href="#i-star"/></svg>`).join('')}</span>`);

// ---------------------------------------------------------------- api
export class ApiError extends Error { constructor(msg, status, fields) { super(msg); this.status = status; this.fields = fields || {}; } }
export async function api(path, { method = 'GET', body, raw: rawRes } = {}) {
  const headers = { 'X-Requested-With': 'fetch', 'X-Lang': S.lang };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try { res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' }); }
  catch { throw new ApiError(t('You appear to be offline. Please check your connection and try again.'), 0); }
  if (rawRes) return res;
  let data = null; try { data = await res.json(); } catch { /* not json */ }
  if (!res.ok) throw new ApiError(data?.error || t('Something went wrong. Please try again.'), res.status, data?.fields);
  return data;
}
export const post = (p, body) => api(p, { method: 'POST', body: body || {} });
export const put = (p, body) => api(p, { method: 'PUT', body: body || {} });
export const del = (p) => api(p, { method: 'DELETE' });

// ---------------------------------------------------------------- toast / modal / drawer
export function toast(msg, kind = '') {
  const el = document.createElement('div'); el.className = `toast ${kind}`; el.setAttribute('role', 'status'); el.textContent = msg;
  $('#toasts').append(el); setTimeout(() => el.remove(), kind === 'bad' ? 6500 : 3800);
}
export const errToast = (e) => toast(e?.message || t('Something went wrong. Please try again.'), 'bad');
const stack = [];
export function openModal(content, { title = '', size = '', onClose, drawer = false } = {}) {
  const ov = document.createElement('div'); ov.className = `ov${drawer ? ' dr' : ''}`; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
  const inner = drawer ? '' : `<div class="modal ${size}"><div class="modal-h"><h3>${esc(title)}</h3><button type="button" class="x" data-act="close-modal" aria-label="${esc(t('Close'))}">${icon('x')}</button></div><div class="modal-body"></div></div>`;
  ov.innerHTML = drawer ? '<div class="drawer"></div>' : inner;
  const body = drawer ? ov.firstChild : ov.querySelector('.modal-body');
  mount(body, content);
  const entry = { ov, onClose, body, title };
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeModal(entry); });
  $('#layer').append(ov); document.body.classList.add('locked'); stack.push(entry);
  const f = body.querySelector('input:not([type=hidden]),select,textarea'); if (f && !matchMedia('(pointer:coarse)').matches) f.focus();
  return { el: body, close: () => closeModal(entry), set: (c) => mount(body, c) };
}
export function closeModal(entry) {
  entry = entry && entry.ov ? entry : stack[stack.length - 1]; if (!entry) return;
  entry.ov.remove(); const i = stack.indexOf(entry); if (i >= 0) stack.splice(i, 1);
  if (!stack.length && document.querySelector('#app-view')?.hidden !== false) document.body.classList.remove('locked');
  entry.onClose?.();
}
export const closeAllModals = () => { while (stack.length) closeModal(stack[stack.length - 1]); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && stack.length) closeModal(); });
export async function confirmDialog(message, { ok = t('Confirm'), danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal(html`<p>${message}</p><div class="wiz-nav"><button class="btn btn-ghost" data-act="no">${t('Cancel')}</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="yes">${ok}</button></div>`, { size: 'sm', title: t('Please confirm'), onClose: () => { if (!done) resolve(false); } });
    m.el.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (!b) return; if (b.dataset.act === 'yes' || b.dataset.act === 'no') { done = true; resolve(b.dataset.act === 'yes'); m.close(); } });
  });
}

// ---------------------------------------------------------------- delegated actions & forms
const actions = {}; const forms = {};
export const act = (name, fn) => { actions[name] = fn; };
export const form = (name, fn) => { forms[name] = fn; };
export function initDelegation() {
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
    const fn = actions[el.dataset.act]; if (!fn) return;
    if (el.tagName === 'A' && el.dataset.keep === undefined) e.preventDefault();
    try { await fn(el, e); } catch (err) { errToast(err); }
  });
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('form[data-form]'); if (!f) return; e.preventDefault();
    const fn = forms[f.dataset.form]; if (!fn) return;
    const btn = f.querySelector('button[type=submit]'); if (btn?.classList.contains('busy')) return;
    clearErrors(f); btn?.classList.add('busy');
    try { await fn(formData(f), f, e); } catch (err) { showErrors(f, err); } finally { btn?.classList.remove('busy'); }
  });
}
export function formData(f) {
  const o = {};
  for (const el of f.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') { if (el.dataset.multi !== undefined) { (o[el.name] ||= []); if (el.checked) o[el.name].push(el.value); } else o[el.name] = el.checked; }
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value;
  }
  return o;
}
export function clearErrors(f) { f.querySelectorAll('.err-msg').forEach((x) => x.remove()); f.querySelectorAll('.err').forEach((x) => x.classList.remove('err')); f.querySelectorAll('.alert.bad.form-err').forEach((x) => x.remove()); }
export function showErrors(f, err) {
  const msg = err?.message || t('Something went wrong. Please try again.');
  const box = document.createElement('div'); box.className = 'alert bad form-err full'; box.setAttribute('role', 'alert'); box.textContent = msg;
  const btn = f.querySelector('button[type=submit]'); (btn?.parentElement || f).before(box); box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ---------------------------------------------------------------- misc helpers
export const debounce = (fn, ms = 300) => { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; };
export const badge = (kind, text) => html`<span class="bdg ${kind}">${text}</span>`;
export const phoneHref = (p) => 'tel:' + String(p || '').replace(/[^\d+]/g, '');
export const waLink = (text) => `https://wa.me/${S.settings?.business?.whatsapp || '17874278122'}${text ? '?text=' + encodeURIComponent(text) : ''}`;
export const track = (name, params) => { try { window.gtag?.('event', name, params); } catch { /* no analytics */ } };
export const svcName = (s) => tl(s, 'name');
export const findSvc = (id) => S.cat.services.find((s) => s.id === Number(id));
export const findCat = (id) => S.cat.categories.find((c) => c.id === Number(id));

// status vocab (English keys translate via t())
export const BOOKING_LABEL = { pending: 'Pending', confirmed: 'Confirmed', en_route: 'On the way', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };
export const BOOKING_KIND = { pending: 'warn', confirmed: 'info', en_route: 'teal', in_progress: 'teal', completed: 'ok', cancelled: 'bad' };
export const INV_LABEL = { draft: 'Draft', sent: 'Sent', unpaid: 'Unpaid', partial: 'Partially paid', paid: 'Paid', overdue: 'Overdue', cancelled: 'Cancelled' };
export const INV_KIND = { draft: '', sent: 'info', unpaid: 'warn', partial: 'warn', paid: 'ok', overdue: 'bad', cancelled: '' };
export const ORDER_LABEL = { pending_payment: 'Awaiting payment', processing: 'Processing', ready_for_pickup: 'Ready for pickup', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' };
export const ORDER_KIND = { pending_payment: 'warn', processing: 'info', ready_for_pickup: 'teal', shipped: 'teal', delivered: 'ok', cancelled: 'bad' };
export const bookingBadge = (s) => badge(BOOKING_KIND[s] || '', t(BOOKING_LABEL[s] || s));
export const invBadge = (s) => badge(INV_KIND[s] || '', t(INV_LABEL[s] || s));
export const orderBadge = (s) => badge(ORDER_KIND[s] || '', t(ORDER_LABEL[s] || s));

// downscale an image file client-side before upload; returns a data URL
export function fileToDataUrl(file, max = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) return reject(new Error(t('Please choose a JPG, PNG or WebP image')));
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t('That image could not be read. Try a JPG or PNG.'))); };
    img.src = url;
  });
}
export const anonKey = () => { let k = LS.get('tp_anon'); if (!k) { k = (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '') + 'xx'; LS.set('tp_anon', k); } return k; };
export function scrollToEl(sel) { const el = typeof sel === 'string' ? $(sel) : sel; el?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
