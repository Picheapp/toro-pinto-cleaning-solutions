// Booking: shared price summary, instant estimator and the 10-step booking wizard.
import { S, t, tl, tlist, html, raw, mount, $, $$, icon, api, post, money, num, fmtDate, fmtTime, todayISO, toast, errToast, act, form, onLang, findSvc, findCat, svcName, anonKey, fileToDataUrl, scrollToEl, track, openModal, closeAllModals, debounce, waLink, LS, badge } from './core.js';
import { authForm, onAuthed, openAuth } from './auth.js';

// ---------------------------------------------------------------- helpers shared with the page
export function startPrice(s) {
  if (s.pricing_type === 'quote') return { custom: true, text: t('Custom quote') };
  const c = s.min_cents || s.base_cents;
  return { custom: false, text: t('From {price}', { price: money(c) }) };
}
// Server price-line labels are English; translate the known patterns and catalog names.
export function lineLabel(label) {
  if (S.lang !== 'es') return label;
  const svc = S.cat.services.find((s) => s.name === label); if (svc) return svc.name_es || label;
  const ad = S.cat.addons.find((a) => a.name === label); if (ad) return ad.name_es || label;
  if (label === 'Commercial rate') return t('Commercial rate');
  if (label === 'Heavy soil / extra effort') return t('Heavy soil / extra effort');
  let m;
  if ((m = /^(Weekly|Biweekly|Monthly) plan \((\d+)% off service\)$/.exec(label))) return t('{freq} plan ({pct}% off service)', { freq: t(m[1]), pct: m[2] });
  if ((m = /^Code (.+)$/.exec(label))) return t('Code {code}', { code: m[1] });
  if ((m = /^(.+) member \((\d+)% off\)$/.exec(label))) return t('{plan} member ({pct}% off)', { plan: m[1], pct: m[2] });
  if ((m = /^Loyalty points \((\d+) pts\)$/.exec(label))) return t('Loyalty points ({n} pts)', { n: m[1] });
  return label;
}
export function summaryHtml(est, { deposit = true } = {}) {
  if (!est) return html``;
  return html`<div class="sum" aria-live="polite">
    ${est.lines.map((l) => html`<div class="ln"><span>${lineLabel(l.label)}</span><b>${money(l.cents)}</b></div>`)}
    ${est.discounts.map((d) => html`<div class="ln disc"><span>${lineLabel(d.label)}</span><b>−${money(d.cents)}</b></div>`)}
    ${est.tax_cents ? html`<div class="ln"><span>${t('Tax')} (${est.tax_rate}%)</span><b>${money(est.tax_cents)}</b></div>` : ''}
    <div class="ln tot"><span>${t('Estimated total')}</span><span>${money(est.total_cents)}</span></div>
    ${deposit ? html`<div class="ln muted"><span>${t('Deposit due to book')}</span><b>${money(est.deposit_cents)}</b></div>` : ''}
  </div>`;
}

const PROPS = {
  residential: ['House', 'Apartment / Condo', 'Townhouse', 'Vacation rental', 'Other'],
  commercial: ['Restaurant', 'Fast-food / Quick service', 'Retail store', 'Warehouse / Industrial', 'Medical / Clinic', 'School / Church', 'Other'],
};
const FREQ_LABEL = { once: 'One-time', weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly' };

// size / condition / frequency / add-ons fields — used by the estimator and wizard step 4
export function optionFields(svc, d, ns = '') {
  const addons = S.cat.addons.filter((a) => a.service_id === svc.id || (a.category_id === svc.category_id && !a.service_id));
  const fd = S.settings.frequency_discounts;
  const quick = svc.pricing_type === 'sqft' ? [500, 1000, 1500, 2000, 3000] : [];
  return html`
    ${svc.pricing_type === 'sqft' ? html`<div class="field"><span>${t('Approximate square footage')}</span>
      <input type="number" name="sqft" inputmode="numeric" min="1" max="${S.settings.max_auto_sqft}" value="${d.sqft}" placeholder="1500" data-ns="${ns}">
      <div class="row">${quick.map((q) => html`<button type="button" class="chip ${Number(d.sqft) === q ? 'on' : ''}" data-act="set-size" data-ns="${ns}" data-k="sqft" data-v="${q}">${num(q)} ft²</button>`)}</div>
      <small class="hint">${t('Over {n} sq ft? We will prepare a custom quote.', { n: num(S.settings.max_auto_sqft) })}</small></div>` : ''}
    ${svc.pricing_type === 'room' ? html`<div class="field"><span>${t('Number of rooms')}</span>
      <div class="row"><div class="qty"><button type="button" data-act="rooms" data-ns="${ns}" data-d="-1" aria-label="−">${icon('minus')}</button><b id="${ns}rooms-n">${d.rooms || 0}</b><button type="button" data-act="rooms" data-ns="${ns}" data-d="1" aria-label="+">${icon('plus')}</button></div>
      <small class="hint">${t('Bedrooms, bathrooms, kitchen and living areas each count as one.')}</small></div></div>` : ''}
    ${svc.pricing_type === 'quote' ? html`<div class="alert">${t('This service is priced after a quick review. Continue and we will send you a free custom quote.')}</div>` : ''}
    ${svc.pricing_type !== 'quote' ? html`<div class="field"><span>${t('Condition')}</span><div class="optgrid">
      <button type="button" class="opt ${d.condition !== 'heavy' ? 'on' : ''}" data-act="set-opt" data-ns="${ns}" data-k="condition" data-v="standard"><b>${t('Standard')}</b><small>${t('Regular dirt and buildup')}</small></button>
      <button type="button" class="opt ${d.condition === 'heavy' ? 'on' : ''}" data-act="set-opt" data-ns="${ns}" data-k="condition" data-v="heavy"><b>${t('Heavy')}</b><small>${t('Years of grime, mold, stains')}</small></button></div></div>` : ''}
    ${svc.recurring_ok ? html`<div class="field"><span>${t('How often?')}</span><div class="optgrid">
      ${['once', 'weekly', 'biweekly', 'monthly'].map((f) => html`<button type="button" class="opt ${d.frequency === f ? 'on' : ''}" data-act="set-opt" data-ns="${ns}" data-k="frequency" data-v="${f}"><b>${t(FREQ_LABEL[f])}</b><small>${f === 'once' ? t('Single visit') : t('Save {pct}%', { pct: fd[f] })}</small></button>`)}</div></div>` : ''}
    ${addons.length ? html`<div class="field"><span>${t('Add-ons')}</span><div class="stack">
      ${addons.map((a) => html`<label class="check"><input type="checkbox" data-act="toggle-addon" data-ns="${ns}" value="${a.id}" ${d.addon_ids.includes(a.id) ? 'checked' : ''}><span class="grow">${tl(a, 'name')}</span><b>+${money(a.price_cents)}</b></label>`)}</div></div>` : ''}`;
}
export const sizeReady = (svc, d) => svc.pricing_type === 'quote' || svc.pricing_type === 'flat' || (svc.pricing_type === 'sqft' ? Number(d.sqft) > 0 : Number(d.rooms) > 0);
export const estPayload = (d) => ({ service_id: d.service_id, segment: d.segment || 'residential', sqft: Number(d.sqft) || 0, rooms: Number(d.rooms) || 0, condition: d.condition, frequency: d.frequency, addon_ids: d.addon_ids, coupon_code: (d.coupon_code || '').trim(), use_points: d.use_points ? usablePoints(d) : 0 });
function usablePoints() {
  const L = S.settings.loyalty; const pts = S.user?.customer?.loyalty_points || 0;
  return pts >= L.min_redeem ? Math.floor(pts / L.redeem_points) * L.redeem_points : 0;
}

// ================================================================ INSTANT ESTIMATOR (#est)
const E = { d: { service_id: null, segment: 'residential', sqft: '', rooms: '', condition: 'standard', frequency: 'once', addon_ids: [], coupon_code: '' }, est: null, err: '', recs: null };
const runEst = debounce(async () => {
  const svc = findSvc(E.d.service_id); if (!svc || !sizeReady(svc, E.d)) { E.est = null; E.err = ''; renderEstResult(); return; }
  try { const r = await post('/api/estimate', estPayload(E.d)); E.est = r.estimate; E.recs = r.recommendations; E.err = ''; track('estimate', { service: svc.slug }); }
  catch (e) { E.est = null; E.err = e.message; }
  renderEstResult();
}, 350);

function serviceSelect(selected, name = 'service_id') {
  return html`<select name="${name}">${S.cat.categories.map((c) => html`<optgroup label="${tl(c, 'name')}">${S.cat.services.filter((s) => s.category_id === c.id).map((s) => html`<option value="${s.id}" ${s.id === selected ? 'selected' : ''}>${svcName(s)}</option>`)}</optgroup>`)}</select>`;
}
export function renderEstimator() {
  const host = $('#est'); if (!host || !S.cat) return;
  if (!E.d.service_id) E.d.service_id = (S.cat.services.find((s) => s.pricing_type === 'sqft') || S.cat.services[0]).id;
  const svc = findSvc(E.d.service_id);
  if (svc.segments !== 'both' && svc.segments !== E.d.segment) E.d.segment = svc.segments;
  mount(host, html`<div class="stack">
    <label class="field"><span>${t('Service')}</span>${serviceSelect(svc.id, 'est_service')}</label>
    ${svc.segments === 'both' ? html`<div class="seg seg-full"><button type="button" class="${E.d.segment === 'residential' ? 'on' : ''}" data-act="set-opt" data-ns="est" data-k="segment" data-v="residential">${t('Residential')}</button><button type="button" class="${E.d.segment === 'commercial' ? 'on' : ''}" data-act="set-opt" data-ns="est" data-k="segment" data-v="commercial">${t('Commercial')}</button></div>` : ''}
    ${optionFields(svc, E.d, 'est')}
    <div id="est-result"></div></div>`);
  renderEstResult();
}
function renderEstResult() {
  const el = $('#est-result'); if (!el) return; const svc = findSvc(E.d.service_id);
  let body;
  if (E.err) body = html`<div class="alert warn">${E.err}</div>`;
  else if (!E.est) body = html`<div class="sum"><div class="muted center">${svc && !sizeReady(svc, E.d) ? t('Enter the size of the job to see your estimate.') : t('Your estimate will appear here.')}</div></div>`;
  else if (E.est.custom_quote) body = html`<div class="alert">${t('This job needs a custom quote — it is quick and free.')}<br><small>${t(E.est.reason)}</small></div><button class="btn btn-primary btn-block btn-lg" data-act="est-quote">${t('Request a custom quote')}</button>`;
  else body = html`<div class="row between"><div><small class="muted">${t('Estimated total')}</small><div class="big-price">${money(E.est.total_cents)}</div></div><small class="muted">${t('Deposit to book: {amt}', { amt: money(E.est.deposit_cents) })}</small></div>
      ${summaryHtml(E.est, { deposit: false })}
      <label class="field"><span>${t('Discount code')}</span><div class="row"><input type="text" name="est_coupon" value="${E.d.coupon_code}" placeholder="WELCOME10" autocapitalize="characters" style="flex:1"><button type="button" class="btn btn-ghost" data-act="est-apply">${t('Apply')}</button></div></label>
      <button class="btn btn-primary btn-block btn-lg" data-act="est-book">${t('Book this service')}</button>`;
  mount(el, html`<div class="stack">${body}</div>`);
}
document.addEventListener('change', (e) => {
  if (e.target.name === 'est_service') { const s = findSvc(e.target.value); E.d = { ...E.d, service_id: s.id, sqft: '', rooms: '', addon_ids: [], frequency: 'once', condition: 'standard' }; renderEstimator(); }
});
document.addEventListener('input', (e) => {
  const el = e.target; if (!el.closest('#est')) return;
  if (el.name === 'sqft') { E.d.sqft = el.value; runEst(); }
  if (el.name === 'est_coupon') E.d.coupon_code = el.value.trim().toUpperCase();
});
act('est-apply', () => { runEst(); });
act('est-book', () => startBooking({ ...E.d, fromEstimator: true }));
act('est-quote', () => openQuoteModal({ service_id: E.d.service_id, segment: E.d.segment }));

// shared option handlers (estimator "est" namespace or wizard "wiz")
const target = (ns) => (ns === 'est' ? E.d : W.d);
const after = (ns) => (ns === 'est' ? (renderEstimator(), runEst()) : renderWizard());
act('set-opt', (el) => { const d = target(el.dataset.ns); d[el.dataset.k] = el.dataset.v; after(el.dataset.ns); });
act('set-size', (el) => { const d = target(el.dataset.ns); d[el.dataset.k] = el.dataset.v; after(el.dataset.ns); });
act('rooms', (el) => { const d = target(el.dataset.ns); d.rooms = Math.max(0, Math.min(S.settings.max_auto_rooms + 5, (Number(d.rooms) || 0) + Number(el.dataset.d))); $(`#${el.dataset.ns}rooms-n`).textContent = d.rooms; if (el.dataset.ns === 'est') runEst(); });
act('toggle-addon', (el) => { const d = target(el.dataset.ns); const id = Number(el.value); d.addon_ids = el.checked ? [...new Set([...d.addon_ids, id])] : d.addon_ids.filter((x) => x !== id); if (el.dataset.ns === 'est') runEst(); });

// ================================================================ BOOKING WIZARD (#wizard)
const blank = () => ({ segment: '', service_id: null, property_type: '', address: '', city: '', zip: '', access_notes: '', notes: '', sqft: '', rooms: '', condition: 'standard', frequency: 'once', addon_ids: [], date: '', slot: '', contact_name: '', contact_phone: '', contact_email: '', coupon_code: '', use_points: false, photos: [] });
const W = { step: 1, d: blank(), est: null, estErr: '', month: null, days: null, slots: null, slotsFor: '', result: null, authMode: 'register', loading: false };
const SS = { get() { try { return sessionStorage.getItem('tp_wiz'); } catch { return null; } }, set(v) { try { sessionStorage.setItem('tp_wiz', v); } catch { /* ignore */ } } };
const save = () => SS.set(JSON.stringify({ step: W.step, d: W.d }));
const TOTAL = 10;
const STEP_TITLE = () => [t('Choose a service'), t('Residential or commercial?'), t('Property details'), t('Size & options'), t('Date & time'), t('Your contact information'), t('Photos of the property'), t('Review your estimate'), t('Sign in or register'), t('Confirm your booking')];

export function initWizard() {
  try { const s = JSON.parse(SS.get() || 'null'); if (s?.d?.service_id && findSvc(s.d.service_id)) { W.d = { ...blank(), ...s.d }; W.step = Math.min(s.step || 1, 9); } } catch { /* ignore */ }
  onAuthed((u) => { if (W.step === 9 && u?.role === 'customer') { W.step = 10; W.est = null; prefillContact(); renderWizard(); computeEstimate().then(renderWizard); } else renderWizard(); });
  onLang(() => { if (E.d.service_id) renderEstimator(); renderWizard(); });
  renderEstimator(); renderWizard();
}

export function startBooking(pre = {}) {
  W.d = blank(); W.est = null; W.result = null; W.days = null; W.slots = null;
  const svc = pre.service_id ? findSvc(pre.service_id) : null;
  if (svc) {
    W.d.service_id = svc.id;
    W.d.segment = pre.segment && (svc.segments === 'both' || svc.segments === pre.segment) ? pre.segment : svc.segments === 'both' ? '' : svc.segments;
    for (const k of ['sqft', 'rooms', 'condition', 'frequency', 'coupon_code']) if (pre[k]) W.d[k] = pre[k];
    if (Array.isArray(pre.addon_ids)) W.d.addon_ids = [...pre.addon_ids];
    W.step = W.d.segment ? 3 : 2;
  } else W.step = 1;
  prefillContact(); save(); renderWizard(); scrollToEl('#book'); track('begin_checkout', { service: svc?.slug });
}
function prefillContact() {
  const u = S.user; if (!u || u.role !== 'customer') return;
  if (!W.d.contact_name) W.d.contact_name = u.name || '';
  if (!W.d.contact_phone) W.d.contact_phone = u.customer?.phone || u.phone || '';
  if (!W.d.contact_email) W.d.contact_email = u.email || '';
}

async function loadMonth(m) {
  W.month = m; W.days = null; renderWizard();
  try { W.days = (await api(`/api/availability?month=${m}`)).days; } catch (e) { errToast(e); W.days = {}; }
  renderWizard();
}
async function loadSlots(date) {
  W.slots = null; W.slotsFor = date; renderWizard();
  try { W.slots = (await api(`/api/availability?date=${date}`)).slots; } catch (e) { errToast(e); W.slots = []; }
  renderWizard();
}
async function computeEstimate() {
  W.estErr = ''; W.est = null;
  try { const r = await post('/api/estimate', estPayload(W.d)); W.est = r.estimate; } catch (e) { W.estErr = e.message; }
}

function stepBody() {
  const d = W.d; const svc = d.service_id ? findSvc(d.service_id) : null;
  switch (W.step) {
    case 1: return html`<div class="optgrid svc-pick">${S.cat.services.map((s) => html`<button type="button" class="opt ${d.service_id === s.id ? 'on' : ''}" data-act="w-service" data-id="${s.id}"><span class="thumb" style="background-image:url('${s.image}')"></span><span><b>${svcName(s)}</b><small>${startPrice(s).text} · ${tl(findCat(s.category_id), 'name')}</small></span></button>`)}</div>`;
    case 2: return html`<p class="muted">${svc ? svcName(svc) : ''}</p><div class="optgrid">
      ${svc.segments !== 'commercial' ? html`<button type="button" class="opt ${d.segment === 'residential' ? 'on' : ''}" data-act="w-seg" data-v="residential"><b>${t('Residential')}</b><small>${t('Homes, apartments, driveways')}</small></button>` : ''}
      ${svc.segments !== 'residential' ? html`<button type="button" class="opt ${d.segment === 'commercial' ? 'on' : ''}" data-act="w-seg" data-v="commercial"><b>${t('Commercial')}</b><small>${t('Offices, stores, industrial')}</small></button>` : ''}</div>
      ${svc.segments !== 'both' ? html`<div class="alert" style="margin-top:.8rem">${svc.segments === 'residential' ? t('This service is available for residential properties.') : t('This service is available for commercial properties.')}</div>` : ''}`;
    case 3: return html`<div class="form-grid" style="padding:0">
      <label class="field"><span>${t('Property type')}</span><select name="property_type">${['', ...PROPS[d.segment || 'residential']].map((p) => html`<option value="${p}" ${d.property_type === p ? 'selected' : ''}>${p ? t(p) : t('Select…')}</option>`)}</select></label>
      <label class="field"><span>${t('Street address')}</span><input type="text" name="address" value="${d.address}" autocomplete="street-address" required></label>
      <label class="field"><span>${t('City / Town')}</span><input type="text" name="city" value="${d.city}" autocomplete="address-level2"></label>
      <label class="field"><span>${t('ZIP code')}</span><input type="text" name="zip" value="${d.zip}" inputmode="numeric" autocomplete="postal-code" maxlength="10"></label>
      <label class="field full"><span>${t('Access notes')}</span><textarea name="access_notes" placeholder="${t('Gate code, parking, pets, where to find the water spigot…')}">${d.access_notes}</textarea></label>
      <label class="field full"><span>${t('Anything else we should know?')}</span><textarea name="notes">${d.notes}</textarea></label></div>`;
    case 4: return html`<div class="stack">${optionFields(svc, d, 'wiz')}</div>`;
    case 5: return calendarHtml();
    case 6: return html`<div class="form-grid" style="padding:0">
      <label class="field"><span>${t('Full name')}</span><input type="text" name="contact_name" value="${d.contact_name}" autocomplete="name" required></label>
      <label class="field"><span>${t('Mobile phone')}</span><input type="tel" name="contact_phone" value="${d.contact_phone}" autocomplete="tel" inputmode="tel" placeholder="787-555-1234" required></label>
      <label class="field full"><span>${t('Email')}</span><input type="email" name="contact_email" value="${d.contact_email}" autocomplete="email" inputmode="email" required></label>
      <p class="tiny muted full">${t('We only use your details to confirm and complete your service.')}</p></div>`;
    case 7: return html`<p class="muted">${t('Optional — photos help us prepare and give a more accurate price.')}</p>
      <div class="uploads" id="uploads">${d.photos.map((p, i) => html`<div class="up"><img src="${p.thumb}" alt="">${p.busy ? html`<div class="spin"><span class="spinner"></span></div>` : html`<button type="button" data-act="w-rmphoto" data-i="${i}" aria-label="${t('Remove')}">${icon('x')}</button>`}</div>`)}
        ${d.photos.length < 8 ? html`<label class="up add"><input type="file" accept="image/*" multiple hidden id="photo-input">${icon('camera')}<span>${t('Add photos')}</span></label>` : ''}</div>`;
    case 8: return estimateStep();
    case 9: return html`<p class="muted">${t('Create an account (or sign in) so you can pay your deposit, track your job and download invoices.')}</p>
      <div class="seg seg-full" style="margin:.6rem 0 1rem"><button type="button" class="${W.authMode === 'register' ? 'on' : ''}" data-act="w-authmode" data-v="register">${t('New customer')}</button><button type="button" class="${W.authMode === 'login' ? 'on' : ''}" data-act="w-authmode" data-v="login">${t('I have an account')}</button></div>
      <div data-auth-inline data-mode="${W.authMode}">${authForm(W.authMode, { inline: true })}</div>`;
    case 10: return confirmStep();
    default: return html``;
  }
}
function calendarHtml() {
  const d = W.d; const today = todayISO(); const maxDay = new Date(today + 'T12:00:00Z'); maxDay.setUTCDate(maxDay.getUTCDate() + S.settings.max_days_ahead);
  if (!W.month) { W.month = (d.date || today).slice(0, 7); loadMonth(W.month); }
  const [y, m] = W.month.split('-').map(Number); const first = new Date(Date.UTC(y, m - 1, 1, 12)); const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const label = new Intl.DateTimeFormat(S.lang === 'es' ? 'es-PR' : 'en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
  const dows = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(S.lang === 'es' ? 'es-PR' : 'en-US', { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + i, 12))));
  const prevOk = W.month > today.slice(0, 7); const nextOk = new Date(Date.UTC(y, m, 1)) <= maxDay;
  const cells = [];
  for (let i = 0; i < first.getUTCDay(); i++) cells.push(html`<span class="blank"></span>`);
  for (let day = 1; day <= dim; day++) {
    const iso = `${W.month}-${String(day).padStart(2, '0')}`; const info = W.days?.[iso];
    const ok = info?.open && info.left > 0 && iso >= today;
    cells.push(html`<button type="button" class="${d.date === iso ? 'on' : ''} ${ok ? (info.left <= 2 ? 'few' : 'many') : ''}" data-act="w-date" data-v="${iso}" ${ok ? '' : 'disabled'} aria-label="${fmtDate(iso, { weekday: 'long', month: 'long', day: 'numeric' })}">${day}</button>`);
  }
  return html`<div class="cal-h"><button type="button" class="icon-btn" data-act="w-month" data-d="-1" ${prevOk ? '' : 'disabled'} aria-label="${t('Previous month')}">${icon('left')}</button><b style="text-transform:capitalize">${label}</b><button type="button" class="icon-btn" data-act="w-month" data-d="1" ${nextOk ? '' : 'disabled'} aria-label="${t('Next month')}">${icon('right')}</button></div>
    ${W.days ? html`<div class="cal">${dows.map((x) => html`<span class="dow">${x}</span>`)}${cells}</div>` : html`<div class="skel" style="height:260px"></div>`}
    <p class="tiny muted" style="margin-top:.5rem"><span style="color:var(--ok)">●</span> ${t('Good availability')} &nbsp; <span style="color:var(--warn)">●</span> ${t('Almost full')}</p>
    ${d.date ? html`<h4 style="margin-top:1rem">${fmtDate(d.date, { weekday: 'long', month: 'long', day: 'numeric' })}</h4>
      ${W.slots ? (W.slots.length ? html`<div class="slots">${W.slots.map((s) => html`<button type="button" class="slot ${d.slot === s.slot ? 'on' : ''}" data-act="w-slot" data-v="${s.slot}" ${s.available ? '' : 'disabled'}>${fmtTime(s.slot)}<small>${s.available ? t('{n} left', { n: s.left }) : t('Full')}</small></button>`)}</div>` : html`<p class="muted">${t('No times available that day.')}</p>`) : html`<div class="skel" style="height:60px;margin-top:.6rem"></div>`}` : html`<p class="muted" style="margin-top:1rem">${t('Choose a day to see available times.')}</p>`}
    ${d.frequency !== 'once' ? html`<div class="alert" style="margin-top:1rem">${t('This is your first visit. We will schedule the next ones automatically.')}</div>` : ''}`;
}
function estimateStep() {
  const d = W.d; const pts = usablePoints(d);
  if (W.estErr) return html`<div class="alert warn">${W.estErr}</div><p class="muted" style="margin-top:.8rem">${t('Go back to fix this, or request a custom quote.')}</p>`;
  if (!W.est) return html`<div class="skel" style="height:220px"></div>`;
  if (W.est.custom_quote) return html`<div class="alert"><b>${t('This job needs a custom quote')}</b><br>${t(W.est.reason)}</div>
    <p class="muted" style="margin:.8rem 0">${t('We will review your details and photos and send you a free, no-obligation quote — usually within one business day.')}</p>`;
  return html`<div class="row between"><div><small class="muted">${t('Estimated total')}</small><div class="big-price">${money(W.est.total_cents)}</div></div><div class="right"><small class="muted">${t('Deposit to book')}</small><div class="bold">${money(W.est.deposit_cents)}</div></div></div>
    <div style="margin:.8rem 0">${summaryHtml(W.est)}</div>
    <p class="tiny muted">${t('Final price is confirmed on-site if the job differs from the details provided. The remaining balance is due after the service.')}</p>
    <label class="field" style="margin-top:.9rem"><span>${t('Discount code')}</span><div class="row"><input type="text" name="coupon_code" value="${d.coupon_code}" placeholder="WELCOME10" autocapitalize="characters" style="flex:1"><button type="button" class="btn btn-ghost" data-act="w-coupon">${t('Apply')}</button></div></label>
    ${pts ? html`<label class="check" style="margin-top:.7rem"><input type="checkbox" name="use_points" data-act="w-points" ${d.use_points ? 'checked' : ''}><span>${t('Use my {pts} loyalty points', { pts: num(pts) })}</span></label>` : ''}`;
}
function confirmStep() {
  const d = W.d; const svc = findSvc(d.service_id);
  if (W.result) return resultHtml();
  if (!W.est) return html`<div class="skel" style="height:200px"></div>`;
  return html`<div class="sum"><div class="ln"><span>${t('Service')}</span><b>${svcName(svc)}</b></div>
    <div class="ln"><span>${t('When')}</span><b>${fmtDate(d.date, { weekday: 'short', month: 'short', day: 'numeric' })} · ${fmtTime(d.slot)}</b></div>
    <div class="ln"><span>${t('Where')}</span><b style="text-align:right">${d.address}${d.city ? ', ' + d.city : ''}</b></div>
    <div class="ln"><span>${t('Contact')}</span><b style="text-align:right">${d.contact_name}<br>${d.contact_phone}</b></div>
    <div class="ln tot"><span>${t('Estimated total')}</span><span>${money(W.est.total_cents)}</span></div>
    <div class="ln muted"><span>${t('Deposit to book')}</span><b>${money(W.est.deposit_cents)}</b></div></div>
    <p class="tiny muted" style="margin-top:.8rem">${t('By confirming you agree to be contacted about this booking. You will pay the deposit securely on the next screen.')}</p>`;
}
function resultHtml() {
  const r = W.result;
  if (r.quote_requested) return html`<div class="confirm"><div class="big-check">${icon('check')}</div><h3>${t('Quote request received!')}</h3><p class="muted" style="margin:.5rem 0 1rem">${t('Thank you. We will review your job and send your free quote soon.')}</p>
    <div class="row" style="justify-content:center"><a class="btn btn-ghost" href="${waLink(t('Hi Toro Pinto, I just requested a quote.'))}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp</a><button class="btn btn-navy" data-act="w-reset">${t('Done')}</button></div></div>`;
  return html`<div class="confirm"><div class="big-check">${icon('check')}</div><h2>${t('You are booked in!')}</h2>
    <p class="muted" style="margin:.4rem 0 .8rem">${t('Confirmation')}</p><div class="codebox">${r.booking.code}</div>
    <p style="margin:1rem 0 .3rem"><b>${fmtDate(r.booking.date, { weekday: 'long', month: 'long', day: 'numeric' })}</b> · ${fmtTime(r.booking.slot)}</p>
    <p class="muted">${t('Total {total} · Deposit {dep}', { total: money(r.booking.total_cents), dep: money(r.booking.deposit_cents) })}</p>
    <div class="alert warn" style="margin:1rem 0;text-align:left">${t('Your date is held for 24 hours. Pay the deposit to lock it in.')}</div>
    <div class="stack"><button class="btn btn-primary btn-lg btn-block" data-act="w-paydeposit" data-inv="${r.invoice.id}">${icon('lock')} ${t('Pay {amt} deposit', { amt: money(r.booking.deposit_cents) })}</button>
    <button class="btn btn-ghost btn-block" data-act="w-reset" data-go="account">${t('Pay later from my account')}</button></div>
    <p class="tiny muted" style="margin-top:.8rem">${t('A confirmation was sent to your email.')}</p></div>`;
}

export function renderWizard() {
  const host = $('#wizard'); if (!host || !S.cat) return;
  const d = W.d; const last = W.step === TOTAL; const done = !!W.result;
  const canBack = W.step > 1 && !done;
  let primary = t('Continue');
  if (W.step === 8 && W.est?.custom_quote) primary = t('Request custom quote');
  if (W.step === 10) primary = t('Confirm booking');
  if (W.step === 9) primary = null;
  const quoteLink = !done && W.step < 9 && W.step >= 1 && d.service_id ? html`<button class="btn-link tiny" data-act="w-quote">${t('Prefer a custom quote instead?')}</button>` : '';
  mount(host, html`
    ${done ? '' : html`<div class="prog" role="progressbar" aria-valuemin="1" aria-valuemax="${TOTAL}" aria-valuenow="${W.step}">${Array.from({ length: TOTAL }, (_, i) => html`<i class="${i + 1 < W.step ? 'done' : i + 1 === W.step ? 'cur' : ''}"></i>`)}</div>
    <div class="wiz-h"><h3>${STEP_TITLE()[W.step - 1]}</h3><small>${t('Step {n} of {total}', { n: W.step, total: TOTAL })}</small></div>`}
    <div class="wiz-body" id="wiz-body">${stepBody()}</div>
    ${done ? '' : html`<div class="wiz-nav">${canBack ? html`<button class="btn btn-ghost" data-act="w-back" aria-label="${t('Back')}">${icon('left')} ${t('Back')}</button>` : ''}${primary ? html`<button class="btn btn-primary" data-act="w-next" id="w-next">${primary}</button>` : ''}</div>`}
    <div class="center" style="margin-top:.8rem">${quoteLink}</div>`);
  const input = $('#photo-input'); if (input) input.addEventListener('change', onPhotos);
}

// ---- step validation + navigation
async function next() {
  const d = W.d; const svc = d.service_id ? findSvc(d.service_id) : null;
  switch (W.step) {
    case 1: if (!svc) return toast(t('Please choose a service.'), 'bad'); if (svc.segments !== 'both') d.segment = svc.segments; break;
    case 2: if (!d.segment) return toast(t('Please choose residential or commercial.'), 'bad'); break;
    case 3: if (!d.address.trim()) return toast(t('Please enter the property address.'), 'bad'); break;
    case 4: if (!sizeReady(svc, d)) return toast(svc.pricing_type === 'room' ? t('Please enter the number of rooms.') : t('Please enter the approximate square footage.'), 'bad'); break;
    case 5: if (!d.date || !d.slot) return toast(t('Please choose a date and time.'), 'bad'); break;
    case 6:
      if (d.contact_name.trim().length < 2) return toast(t('Please enter your name.'), 'bad');
      if (!/^\S+@\S+\.\S+$/.test(d.contact_email.trim())) return toast(t('Please enter a valid email address.'), 'bad');
      if (d.contact_phone.replace(/\D/g, '').length < 10) return toast(t('Please enter a valid phone number.'), 'bad');
      break;
    case 7: if (d.photos.some((p) => p.busy)) return toast(t('Please wait for your photos to finish uploading.'), 'bad'); break;
    case 8:
      if (W.est?.custom_quote) return submitQuote();
      if (!W.est) return toast(W.estErr || t('Please wait…'), 'bad');
      W.step = S.user?.role === 'customer' ? 10 : 9; save(); renderWizard(); return scrollToEl('#book');
    case 10: return submitBooking();
    default: break;
  }
  if (W.step === 7 || W.step === 4 || W.step === 5) { /* estimate is computed when entering step 8 */ }
  W.step += 1; if (W.step === 5) { W.month = null; W.days = null; }
  if (W.step === 8) { W.est = null; W.estErr = ''; renderWizard(); await computeEstimate(); }
  if (W.step === 10) { W.est = null; renderWizard(); await computeEstimate(); }
  save(); renderWizard(); scrollToEl('#book');
}
async function back() {
  if (W.step === 10 && S.user?.role === 'customer') W.step = 8; else W.step = Math.max(1, W.step - 1);
  if (W.step === 5) { W.month = null; W.days = null; }
  save(); renderWizard(); scrollToEl('#book');
}
const guest = () => S.user?.role !== 'customer';
function bookingBody() {
  const d = W.d;
  return { ...estPayload(d), property_type: d.property_type, address: d.address, city: d.city, zip: d.zip, access_notes: d.access_notes, notes: d.notes, date: d.date, slot: d.slot, contact_name: d.contact_name, contact_phone: d.contact_phone, contact_email: d.contact_email, photo_ids: d.photos.map((p) => p.id), anon_key: anonKey() };
}
async function submitBooking() {
  if (guest()) { W.step = 9; renderWizard(); return; }
  const btn = $('#w-next'); btn?.classList.add('busy');
  try {
    const r = await post('/api/bookings', bookingBody());
    track('purchase', { value: (r.booking?.total_cents || 0) / 100, currency: 'USD' });
    W.result = r; W.step = 10; SS.set(''); renderWizard(); scrollToEl('#book');
    if (r.invoice) { /* account data will refresh next time it opens */ }
  } catch (e) {
    const el = document.createElement('div'); el.className = 'alert bad'; el.textContent = e.message; $('#wiz-body')?.append(el);
    if (/time|date|slot|available|full/i.test(e.message)) { W.step = 5; W.month = null; W.slots = null; setTimeout(renderWizard, 1500); }
  } finally { btn?.classList.remove('busy'); }
}
async function submitQuote() {
  const d = W.d; const svc = findSvc(d.service_id); const btn = $('#w-next'); btn?.classList.add('busy');
  try {
    const lines = [`${svcName(svc)} (${d.segment})`, d.sqft ? `${t('Size')}: ${d.sqft} sq ft` : '', d.rooms ? `${t('Rooms')}: ${d.rooms}` : '', d.date ? `${t('Preferred date')}: ${d.date} ${d.slot}` : '', d.notes, d.access_notes].filter(Boolean).join('\n');
    await post('/api/quotes', { name: d.contact_name, email: d.contact_email, phone: d.contact_phone, service_id: d.service_id, segment: d.segment, message: lines, address: `${d.address} ${d.city}`.trim(), photo_ids: d.photos.map((p) => p.id), anon_key: anonKey() });
    track('generate_lead'); W.result = { quote_requested: true }; W.step = 10; SS.set(''); renderWizard(); scrollToEl('#book');
  } catch (e) { toast(e.message, 'bad'); } finally { btn?.classList.remove('busy'); }
}

act('w-service', (el) => { const s = findSvc(el.dataset.id); W.d.service_id = s.id; W.d.sqft = ''; W.d.rooms = ''; W.d.addon_ids = []; W.d.frequency = 'once'; if (s.segments !== 'both') W.d.segment = s.segments; else if (W.d.segment && W.d.segment !== s.segments) W.d.segment = W.d.segment; save(); renderWizard(); });
act('w-seg', (el) => { W.d.segment = el.dataset.v; save(); renderWizard(); });
act('w-next', next); act('w-back', back);
act('w-date', (el) => { W.d.date = el.dataset.v; W.d.slot = ''; save(); loadSlots(el.dataset.v); });
act('w-slot', (el) => { W.d.slot = el.dataset.v; save(); renderWizard(); });
act('w-month', (el) => { const [y, m] = W.month.split('-').map(Number); const n = new Date(Date.UTC(y, m - 1 + Number(el.dataset.d), 1)); loadMonth(n.toISOString().slice(0, 7)); });
act('w-authmode', (el) => { W.authMode = el.dataset.v; renderWizard(); });
act('w-coupon', async () => { await computeEstimate(); renderWizard(); if (W.estErr) toast(W.estErr, 'bad'); else if (W.d.coupon_code) toast(t('Discount applied'), 'ok'); });
act('w-points', async (el) => { W.d.use_points = el.checked; await computeEstimate(); renderWizard(); });
act('w-quote', () => openQuoteModal({ service_id: W.d.service_id, segment: W.d.segment, d: W.d }));
act('w-reset', (el) => { W.d = blank(); W.step = 1; W.result = null; W.est = null; SS.set(''); renderWizard(); if (el.dataset.go === 'account') location.hash = '#account'; });
act('w-rmphoto', (el) => { W.d.photos.splice(Number(el.dataset.i), 1); save(); renderWizard(); });
act('w-paydeposit', async (el) => {
  el.classList.add('busy');
  try { const r = await post('/api/pay/checkout', { invoice_id: Number(el.dataset.inv), purpose: 'deposit' }); location.href = r.url; } catch (e) { el.classList.remove('busy'); throw e; }
});

// text inputs inside the wizard update state without a re-render (keeps focus)
document.addEventListener('input', (e) => {
  const el = e.target; if (!el.closest('#wizard') || !el.name) return;
  if (el.type === 'checkbox' || el.dataset.act) return;
  if (el.name in W.d) { W.d[el.name] = el.value; if (el.name === 'coupon_code') W.d.coupon_code = el.value.trim().toUpperCase(); save(); }
});
document.addEventListener('change', (e) => { const el = e.target; if (el.closest('#wizard') && el.name === 'property_type') { W.d.property_type = el.value; save(); } });

async function onPhotos(e) {
  const files = [...e.target.files].slice(0, 8 - W.d.photos.length); e.target.value = '';
  for (const f of files) {
    const ph = { id: null, thumb: '', busy: true }; W.d.photos.push(ph);
    try {
      const full = await fileToDataUrl(f, 1600, 0.82); ph.thumb = await fileToDataUrl(f, 220, 0.7); renderWizard();
      const r = await post('/api/uploads', { kind: 'booking_photo', data: full, anon_key: anonKey() }); ph.id = r.id; ph.busy = false;
    } catch (err) { W.d.photos.splice(W.d.photos.indexOf(ph), 1); toast(err.message, 'bad'); }
    save(); renderWizard();
  }
}

// ================================================================ quote form (section #quote + modal)
export function quoteFields(pre = {}) {
  const u = S.user;
  return html`
    <label class="field"><span>${t('Full name')}</span><input type="text" name="name" value="${pre.name || u?.name || ''}" autocomplete="name" required></label>
    <label class="field"><span>${t('Mobile phone')}</span><input type="tel" name="phone" value="${pre.phone || u?.customer?.phone || u?.phone || ''}" autocomplete="tel" inputmode="tel"></label>
    <label class="field"><span>${t('Email')}</span><input type="email" name="email" value="${pre.email || u?.email || ''}" autocomplete="email" inputmode="email"></label>
    <label class="field"><span>${t('Service')}</span><select name="service_id"><option value="">${t('Not sure yet')}</option>${S.cat.categories.map((c) => html`<optgroup label="${tl(c, 'name')}">${S.cat.services.filter((s) => s.category_id === c.id).map((s) => html`<option value="${s.id}" ${Number(pre.service_id) === s.id ? 'selected' : ''}>${svcName(s)}</option>`)}</optgroup>`)}</select></label>
    <label class="field full"><span>${t('Property address')}</span><input type="text" name="address" value="${pre.address || ''}" autocomplete="street-address"></label>
    <label class="field full"><span>${t('Tell us about the job')}</span><textarea name="message" required placeholder="${t('Size, what needs cleaning, timing, anything unusual…')}">${pre.message || ''}</textarea></label>
    <div class="field full"><span>${t('Photos (optional)')}</span><div class="uploads" id="q-uploads"></div><label class="btn btn-ghost btn-sm" style="width:max-content"><input type="file" accept="image/*" multiple hidden id="q-photo">${icon('camera')} ${t('Add photos')}</label></div>
    <button class="btn btn-primary btn-lg full" type="submit">${t('Send quote request')}</button>
    <p class="tiny muted full">${t('Give us an email or phone number — we will only use it to reply about your quote.')}</p>`;
}
const QP = { photos: [] };
function renderQPhotos() { const h = $('#q-uploads'); if (h) mount(h, html`${QP.photos.map((p, i) => html`<div class="up"><img src="${p.thumb}" alt="">${p.busy ? html`<div class="spin"><span class="spinner"></span></div>` : html`<button type="button" data-act="q-rm" data-i="${i}" aria-label="${t('Remove')}">${icon('x')}</button>`}</div>`)}`); }
export function renderQuoteSection() { const f = $('#quote-form'); if (!f || !S.cat) return; mount(f, quoteFields({})); renderQPhotos(); }
document.addEventListener('change', async (e) => {
  if (e.target.id !== 'q-photo') return;
  const files = [...e.target.files].slice(0, 8 - QP.photos.length); e.target.value = '';
  for (const f of files) {
    const ph = { id: null, thumb: '', busy: true }; QP.photos.push(ph);
    try { const full = await fileToDataUrl(f); ph.thumb = await fileToDataUrl(f, 220, 0.7); renderQPhotos(); const r = await post('/api/uploads', { kind: 'lead_photo', data: full, anon_key: anonKey() }); ph.id = r.id; ph.busy = false; }
    catch (err) { QP.photos.splice(QP.photos.indexOf(ph), 1); toast(err.message, 'bad'); }
    renderQPhotos();
  }
});
act('q-rm', (el) => { QP.photos.splice(Number(el.dataset.i), 1); renderQPhotos(); });
form('quote', async (d, f) => {
  if (!d.email.trim() && !d.phone.trim()) throw new Error(t('Please give us an email or a phone number so we can reach you'));
  if (QP.photos.some((p) => p.busy)) throw new Error(t('Please wait for your photos to finish uploading.'));
  await post('/api/quotes', { ...d, service_id: d.service_id || null, photo_ids: QP.photos.map((p) => p.id), anon_key: anonKey() });
  track('generate_lead'); QP.photos = [];
  const box = f.closest('.modal-body') || f; mount(box, html`<div class="confirm"><div class="big-check">${icon('check')}</div><h3>${t('Quote request received!')}</h3><p class="muted">${t('Thank you. We will review your job and send your free quote soon.')}</p></div>`);
});
export function openQuoteModal(pre = {}) {
  QP.photos = [];
  const d = pre.d || {};
  const msg = [d.sqft ? `${t('Size')}: ${d.sqft} sq ft` : '', d.rooms ? `${t('Rooms')}: ${d.rooms}` : ''].filter(Boolean).join(' · ');
  const m = openModal(html`<form class="form-grid" style="padding:0" data-form="quote" novalidate>${quoteFields({ ...pre, name: d.contact_name, phone: d.contact_phone, email: d.contact_email, address: d.address, message: msg })}</form>`, { title: t('Request a free quote'), size: 'wide' });
  renderQPhotos(); return m;
}
