// Admin dashboard, part 2: catalog, team, messages, reports, settings.
import { S, t, html, raw, mount, $, $$, icon, api, post, put, del, money, fmtDate, fmtDateTime, todayISO, toast, errToast, act, form, openModal, closeAllModals, confirmDialog, badge, stars, formData } from './core.js';
import { fieldsHtml, readFields, table, csvHref, monthStart, svcLabel, dollars, cents, fld } from './adminkit.js';
import { A, draw, reload } from './admin.js';

export const TABS2 = () => [
  { id: 'catalog', label: t('Catalog'), icon: 'grid' }, { id: 'team', label: t('Team'), icon: 'briefcase' }, { id: 'messages', label: t('Messages'), icon: 'message' },
  { id: 'reports', label: t('Reports'), icon: 'dollar' }, { id: 'settings', label: t('Settings'), icon: 'settings' },
];
const yn = (v) => (v ? badge('ok', t('Active')) : badge('', t('Hidden')));
const subTabs = (list, cur, act_) => html`<div class="tabs">${list.map(([id, l]) => html`<button type="button" class="${cur === id ? 'on' : ''}" data-act="${act_}" data-id="${id}">${l}</button>`)}</div>`;
const pickLang = (o, k) => (S.lang === 'es' && o[k + '_es'] ? o[k + '_es'] : o[k]);

// ================================================================ CATALOG
const C = { sub: 'services', lists: {}, cats: [], products: null };
const SUBS = () => [['services', t('Services')], ['categories', t('Categories')], ['addons', t('Add-ons')], ['products', t('Products')], ['plans', t('Plans')], ['coupons', t('Promo codes')], ['gallery', t('Gallery')], ['reviews', t('Reviews')]];
const catOpts = (blank) => [...(blank ? [['', t('— none —')]] : []), ...C.cats.map((c) => [c.id, pickLang(c, 'name')])];
const svcOpts = () => [['', t('— none —')], ...S.cat.services.map((s) => [s.id, svcLabel(s)])];
const DEFS = {
  categories: () => [{ k: 'name', l: t('Name') + ' (EN)', t: 'text', req: 1 }, { k: 'name_es', l: t('Name') + ' (ES)', t: 'text' }, { k: 'description', l: t('Description') + ' (EN)', t: 'area', full: 1 }, { k: 'description_es', l: t('Description') + ' (ES)', t: 'area', full: 1 }, { k: 'image', l: t('Image'), t: 'image', full: 1 }, { k: 'sort', l: t('Sort order'), t: 'num' }, { k: 'active', l: t('Visible on website'), t: 'bool', def: 1 }],
  services: () => [{ k: 'category_id', l: t('Category'), t: 'select', opts: catOpts(), req: 1 }, { k: 'name', l: t('Name') + ' (EN)', t: 'text', req: 1 }, { k: 'name_es', l: t('Name') + ' (ES)', t: 'text' },
    { k: 'pricing_type', l: t('Pricing'), t: 'select', opts: [['sqft', t('Per square foot')], ['room', t('Per room')], ['flat', t('Flat price')], ['quote', t('Custom quote only')]] },
    { k: 'base_cents', l: t('Base price ($)'), t: 'money', hint: t('Added to every job') }, { k: 'unit_cents', l: t('Unit price ($)'), t: 'money', step: 0.01, hint: t('Per sq ft or per room') }, { k: 'min_cents', l: t('Minimum price ($)'), t: 'money' },
    { k: 'segments', l: t('Available for'), t: 'select', opts: [['both', t('Residential & commercial')], ['residential', t('Residential only')], ['commercial', t('Commercial only')]] }, { k: 'duration_min', l: t('Duration (minutes)'), t: 'num' }, { k: 'sort', l: t('Sort order'), t: 'num' },
    { k: 'description', l: t('Description') + ' (EN)', t: 'area', full: 1 }, { k: 'description_es', l: t('Description') + ' (ES)', t: 'area', full: 1 },
    { k: 'details', l: t('What is included') + ' (EN)', t: 'lines', full: 1 }, { k: 'details_es', l: t('What is included') + ' (ES)', t: 'lines', full: 1 },
    { k: 'recommend', l: t('Recommend with (service slugs)'), t: 'lines', full: 1 }, { k: 'image', l: t('Image'), t: 'image', full: 1 },
    { k: 'recurring_ok', l: t('Can be booked as recurring'), t: 'bool' }, { k: 'active', l: t('Visible on website'), t: 'bool', def: 1 }],
  addons: () => [{ k: 'name', l: t('Name') + ' (EN)', t: 'text', req: 1 }, { k: 'name_es', l: t('Name') + ' (ES)', t: 'text' }, { k: 'price_cents', l: t('Price ($)'), t: 'money' },
    { k: 'category_id', l: t('Show for category'), t: 'select', opts: catOpts(true) }, { k: 'service_id', l: t('…or for one service'), t: 'select', opts: svcOpts() }, { k: 'sort', l: t('Sort order'), t: 'num' }, { k: 'active', l: t('Available'), t: 'bool', def: 1 }],
  plans: () => [{ k: 'name', l: t('Plan name'), t: 'text', req: 1 }, { k: 'price_cents', l: t('Monthly price ($)'), t: 'money' }, { k: 'discount_pct', l: t('Discount on services (%)'), t: 'num' }, { k: 'sort', l: t('Sort order'), t: 'num' },
    { k: 'perks', l: t('Perks') + ' (EN)', t: 'lines', full: 1 }, { k: 'perks_es', l: t('Perks') + ' (ES)', t: 'lines', full: 1 }, { k: 'highlight', l: t('Highlight as most popular'), t: 'bool' }, { k: 'active', l: t('Available'), t: 'bool', def: 1 }],
  gallery: () => [{ k: 'title', l: t('Title') + ' (EN)', t: 'text', req: 1 }, { k: 'title_es', l: t('Title') + ' (ES)', t: 'text' }, { k: 'before_img', l: t('Before photo'), t: 'image' }, { k: 'after_img', l: t('After photo'), t: 'image' },
    { k: 'caption', l: t('Caption') + ' (EN)', t: 'text', full: 1 }, { k: 'caption_es', l: t('Caption') + ' (ES)', t: 'text', full: 1 }, { k: 'sort', l: t('Sort order'), t: 'num' },
    { k: 'is_sample', l: t('This is a sample / placeholder (shows a “sample” label)'), t: 'bool', full: 1 }, { k: 'active', l: t('Visible on website'), t: 'bool', def: 1 }],
};
const NEWDEF = { plans: {}, services: { pricing_type: 'sqft', segments: 'both', active: 1 }, gallery: { is_sample: 0, active: 1 }, addons: { active: 1 }, categories: { active: 1 } };
const ROWS = {
  categories: () => [{ h: t('Name'), c: (r) => html`<b>${pickLang(r, 'name')}</b>` }, { h: t('Order'), c: (r) => r.sort, cls: 'right' }, { h: t('Status'), c: (r) => yn(r.active) }],
  services: () => [{ h: t('Service'), c: (r) => html`<b>${pickLang(r, 'name')}</b><br><small class="muted">${pickLang(C.cats.find((c) => c.id === r.category_id) || {}, 'name') || ''}</small>` }, { h: t('Pricing'), c: (r) => ({ sqft: t('Per sq ft'), room: t('Per room'), flat: t('Flat'), quote: t('Quote') }[r.pricing_type]) },
    { h: t('Price'), c: (r) => (r.pricing_type === 'quote' ? '—' : r.pricing_type === 'flat' ? money(r.base_cents) : `${money(r.base_cents)} + ${money(r.unit_cents)}`), cls: 'right' }, { h: t('Status'), c: (r) => yn(r.active) }],
  addons: () => [{ h: t('Add-on'), c: (r) => html`<b>${pickLang(r, 'name')}</b>` }, { h: t('Applies to'), c: (r) => (r.service_id ? svcLabel(S.cat.services.find((s) => s.id === r.service_id) || { name: '#' + r.service_id }) : r.category_id ? pickLang(C.cats.find((c) => c.id === r.category_id) || {}, 'name') : t('All')) }, { h: t('Price'), c: (r) => money(r.price_cents), cls: 'right' }, { h: t('Status'), c: (r) => yn(r.active) }],
  plans: () => [{ h: t('Plan'), c: (r) => html`<b>${r.name}</b>` }, { h: t('Price / month'), c: (r) => money(r.price_cents), cls: 'right' }, { h: t('Discount'), c: (r) => r.discount_pct + '%', cls: 'right' }, { h: t('Status'), c: (r) => yn(r.active) }],
  gallery: () => [{ h: '', c: (r) => html`<img src="${r.after_img}" alt="" style="width:56px;height:42px;object-fit:cover;border-radius:8px">` }, { h: t('Title'), c: (r) => html`<b>${pickLang(r, 'title')}</b>${r.is_sample ? html` ${badge('warn', t('Sample'))}` : ''}` }, { h: t('Status'), c: (r) => yn(r.active) }],
};
async function catalog() {
  C.cats = (await api('/api/admin/r/categories')).items;
  if (C.sub === 'products') { C.products = await api('/api/admin/products'); }
  else if (C.sub === 'reviews') C.lists.reviews = (await api('/api/admin/reviews')).items;
  else if (C.sub === 'coupons') C.lists.coupons = (await api('/api/admin/r/coupons')).items;
  else C.lists[C.sub] = C.sub === 'categories' ? C.cats : (await api(`/api/admin/r/${C.sub}`)).items;
  A.view = () => html`<div class="pg-h"><h2>${t('Catalog')}</h2>${C.sub !== 'reviews' ? html`<button class="btn btn-primary btn-sm" data-act="${C.sub === 'products' ? 'prod-edit' : C.sub === 'coupons' ? 'cpn-edit' : 'res-edit'}" data-r="${C.sub}">${icon('plus')} ${t('Add')}</button>` : ''}</div>${subTabs(SUBS(), C.sub, 'cat-sub')}${catBody()}`;
}
function catBody() {
  const s = C.sub;
  if (s === 'products') return productList();
  if (s === 'coupons') return couponList();
  if (s === 'reviews') return reviewList();
  return html`${table(ROWS[s](), C.lists[s], { rowAct: 'res-edit-row' })}`;
}
act('cat-sub', async (el) => { C.sub = el.dataset.id; await reload(); });
// remember which resource the row belongs to
document.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-act=res-edit-row]'); if (tr) tr.dataset.r = C.sub; }, true);
const openRes = (r, item) => openModal(html`<form data-form="res-save" novalidate><input type="hidden" name="_r" value="${r}"><input type="hidden" name="_id" value="${item?.id || ''}">${fieldsHtml(DEFS[r](), item || NEWDEF[r] || {})}
  <div class="row" style="margin-top:1rem"><button class="btn btn-primary" type="submit">${t('Save')}</button>${item ? html`<button type="button" class="btn btn-ghost" data-act="res-del" data-r="${r}" data-id="${item.id}" style="color:var(--bad);margin-left:auto">${icon('trash')} ${t('Delete')}</button>` : ''}</div></form>`, { title: item ? t('Edit') : t('Add'), size: 'wide' });
act('res-edit', (el) => openRes(el.dataset.r, null));
act('res-edit-row', (el) => openRes(C.sub, C.lists[C.sub].find((x) => x.id === Number(el.dataset.id))));
form('res-save', async (d) => {
  const r = d._r; const body = readFields(DEFS[r](), d);
  if (r === 'addons') { body.category_id = body.category_id || ''; body.service_id = body.service_id || ''; }
  if (d._id) await put(`/api/admin/r/${r}/${d._id}`, body); else await post(`/api/admin/r/${r}`, body);
  closeAllModals(); toast(t('Saved'), 'ok'); await refreshCatalog();
});
act('res-del', async (el) => {
  if (!(await confirmDialog(t('Delete this item? If it is already in use, hide it instead.'), { ok: t('Delete'), danger: true }))) return;
  await del(`/api/admin/r/${el.dataset.r}/${el.dataset.id}`); closeAllModals(); toast(t('Deleted')); await refreshCatalog();
});
// public catalog cache must be refreshed after edits so the live site matches
async function refreshPublic() {
  try { const b = await api('/api/bootstrap'); S.boot = b; S.settings = b.settings; S.cat = { categories: b.categories, services: b.services, addons: b.addons, products: b.products, plans: b.plans, gallery: b.gallery }; document.dispatchEvent(new CustomEvent('tp:catalog')); } catch { /* ignore */ }
}
async function refreshCatalog() { await refreshPublic(); await reload(); }
// coupons
const couponList = () => table([{ h: t('Code'), c: (r) => html`<b>${r.code}</b><br><small class="muted">${r.description || ''}</small>` }, { h: t('Discount'), c: (r) => (r.type === 'percent' ? r.value + '%' : money(r.value)) }, { h: t('Used'), c: (r) => `${r.uses}${r.max_uses ? ' / ' + r.max_uses : ''}`, cls: 'right' }, { h: t('Valid until'), c: (r) => (r.ends_on ? fmtDate(r.ends_on) : '—') }, { h: t('Status'), c: (r) => yn(r.active) }], C.lists.coupons, { rowAct: 'cpn-edit-row' });
const CPN = () => [{ k: 'code', l: t('Code'), t: 'text', req: 1 }, { k: 'description', l: t('Description'), t: 'text' }, { k: 'type', l: t('Type'), t: 'select', opts: [['percent', t('Percent off')], ['fixed', t('Fixed amount off')]] },
  { k: 'amount', l: t('Percent or amount'), t: 'num', step: 0.01, hint: t('e.g. 10 for 10% — or dollars if fixed') }, { k: 'min_cents', l: t('Minimum order ($)'), t: 'money' }, { k: 'applies_to', l: t('Applies to'), t: 'select', opts: [['all', t('Everything')], ['services', t('Services only')], ['products', t('Products only')]] },
  { k: 'starts_on', l: t('Starts'), t: 'date' }, { k: 'ends_on', l: t('Ends'), t: 'date' }, { k: 'max_uses', l: t('Max uses (blank = unlimited)'), t: 'num' }, { k: 'active', l: t('Active'), t: 'bool', def: 1 }];
const openCpn = (c) => openModal(html`<form data-form="cpn-save" novalidate><input type="hidden" name="_id" value="${c?.id || ''}">${fieldsHtml(CPN(), c ? { ...c, amount: c.type === 'percent' ? c.value : (c.value / 100) } : { type: 'percent', applies_to: 'all', active: 1 })}
  <div class="row" style="margin-top:1rem"><button class="btn btn-primary" type="submit">${t('Save')}</button>${c ? html`<button type="button" class="btn btn-ghost" data-act="res-del" data-r="coupons" data-id="${c.id}" style="color:var(--bad);margin-left:auto">${icon('trash')}</button>` : ''}</div></form>`, { title: c ? t('Edit promo code') : t('New promo code'), size: 'wide' });
act('cpn-edit', () => openCpn(null));
act('cpn-edit-row', (el) => openCpn(C.lists.coupons.find((x) => x.id === Number(el.dataset.id))));
form('cpn-save', async (d) => {
  const body = readFields(CPN().filter((x) => x.k !== 'amount'), d); const amt = parseFloat(d.amount) || 0;
  body.value = d.type === 'percent' ? Math.round(amt) : Math.round(amt * 100);
  if (d.type === 'percent' && (body.value < 1 || body.value > 100)) throw new Error(t('Percent must be between 1 and 100'));
  if (d._id) await put(`/api/admin/r/coupons/${d._id}`, body); else await post('/api/admin/r/coupons', body);
  closeAllModals(); toast(t('Saved'), 'ok'); reload();
});
// reviews moderation
const reviewList = () => (C.lists.reviews.length ? html`<div class="list">${C.lists.reviews.map((r) => html`<div class="li" style="align-items:flex-start"><div class="t"><b>${stars(r.rating)} ${r.customer_name || t('Customer')}</b><small>${fmtDate(r.created_at)}</small><p style="margin:.3rem 0;color:var(--text)">${r.body || ''}</p>${r.reply ? html`<small><b>${t('Your reply')}:</b> ${r.reply}</small>` : ''}</div>
  <div class="row" style="flex-direction:column;align-items:stretch">${badge(r.published ? 'ok' : 'warn', r.published ? t('Published') : t('Hidden'))}<button class="btn btn-ghost btn-sm" data-act="rev-toggle" data-id="${r.id}" data-p="${r.published ? 0 : 1}">${r.published ? t('Hide') : t('Publish')}</button><button class="btn btn-ghost btn-sm" data-act="rev-reply" data-id="${r.id}">${t('Reply')}</button><button class="btn btn-ghost btn-sm" data-act="rev-del" data-id="${r.id}" style="color:var(--bad)">${icon('trash')}</button></div></div>`)}</div>` : html`<div class="empty card">${t('No reviews yet. Reviews appear here after customers rate a completed job.')}</div>`);
act('rev-toggle', async (el) => { await put(`/api/admin/reviews/${el.dataset.id}`, { published: el.dataset.p === '1' }); await refreshCatalog(); });
act('rev-reply', (el) => { const r = C.lists.reviews.find((x) => x.id === Number(el.dataset.id)); openModal(html`<form data-form="rev-reply" novalidate><input type="hidden" name="id" value="${r.id}"><p class="muted">${r.body || ''}</p><label class="field"><span>${t('Public reply')}</span><textarea name="reply">${r.reply || ''}</textarea></label><button class="btn btn-primary btn-block" type="submit" style="margin-top:1rem">${t('Save reply')}</button></form>`, { title: t('Reply to review') }); });
form('rev-reply', async (d) => { await put(`/api/admin/reviews/${d.id}`, { reply: d.reply }); closeAllModals(); await refreshCatalog(); });
act('rev-del', async (el) => { if (!(await confirmDialog(t('Delete this review?'), { ok: t('Delete'), danger: true }))) return; await del(`/api/admin/reviews/${el.dataset.id}`); await refreshCatalog(); });
// products (with variants + bundles)
const productList = () => table([{ h: '', c: (p) => (p.image ? html`<img src="${p.image}" alt="" style="width:46px;height:46px;object-fit:cover;border-radius:8px">` : '') }, { h: t('Product'), c: (p) => html`<b>${pickLang(p, 'name')}</b>${p.is_bundle ? html` ${badge('teal', t('Bundle'))}` : ''}<br><small class="muted">${pickLang(p, 'category')}</small>` },
  { h: t('Options'), c: (p) => p.variants.length, cls: 'right' }, { h: t('Price'), c: (p) => { const v = p.variants.map((x) => x.price_cents); return v.length ? (Math.min(...v) === Math.max(...v) ? money(v[0]) : `${money(Math.min(...v))}–${money(Math.max(...v))}`) : '—'; }, cls: 'right' },
  { h: t('Stock'), c: (p) => (p.is_bundle ? '∞' : p.variants.reduce((s, v) => s + (v.stock || 0), 0)), cls: 'right' }, { h: t('Status'), c: (p) => yn(p.active) }], C.products.items, { rowAct: 'prod-edit-row' });
const varRow = (v, i, bundle) => html`<div class="panel" data-var="${i}" style="padding:.8rem;margin-bottom:.6rem"><input type="hidden" data-k="id" value="${v.id || ''}">
  <div class="form-grid" style="padding:0"><label class="field"><span>${t('Option name')} (EN)</span><input type="text" data-k="name" value="${v.name || ''}" placeholder="Standard / 1 gal"></label><label class="field"><span>${t('Option name')} (ES)</span><input type="text" data-k="name_es" value="${v.name_es || ''}"></label>
  <label class="field"><span>${t('Price ($)')}</span><input type="number" step="0.01" min="0" data-k="price" value="${v.price_cents !== undefined ? dollars(v.price_cents) : ''}"></label><label class="field"><span>${t('Compare-at ($)')}</span><input type="number" step="0.01" min="0" data-k="compare" value="${v.compare_cents ? dollars(v.compare_cents) : ''}"></label>
  ${bundle ? '' : html`<label class="field"><span>${t('Stock')}</span><input type="number" min="0" data-k="stock" value="${v.stock ?? 0}"></label>`}<label class="field"><span>SKU</span><input type="text" data-k="sku" value="${v.sku || ''}"></label></div>
  ${bundle ? html`<div class="field full" style="margin-top:.6rem"><span>${t('Bundle contents')}</span><div data-comps>${(v.components || []).map((c) => compRow(c))}</div><button type="button" class="btn btn-ghost btn-sm" data-act="comp-add">${icon('plus')} ${t('Add item')}</button></div>` : ''}
  <div class="row between" style="margin-top:.4rem"><label class="check"><input type="checkbox" data-k="active" ${v.active === undefined || v.active ? 'checked' : ''}><span>${t('Available')}</span></label><button type="button" class="btn btn-ghost btn-sm" data-act="var-rm" data-i="${i}" style="color:var(--bad)">${icon('trash')}</button></div></div>`;
const compRow = (c = {}) => html`<div class="row" style="flex-wrap:nowrap;margin-bottom:.4rem" data-comp><select data-k="variant_id" class="grow"><option value="">—</option>${C.products.variant_options.filter((o) => !o.is_bundle).map((o) => html`<option value="${o.id}" ${Number(c.variant_id) === o.id ? 'selected' : ''}>${o.pname}${o.vname !== 'Standard' ? ' — ' + o.vname : ''}</option>`)}</select><input type="number" min="1" data-k="qty" value="${c.qty || 1}" style="width:70px"><button type="button" class="icon-btn" data-act="comp-rm" aria-label="${t('Remove')}">${icon('x')}</button></div>`;
const PV = { vars: [], bundle: false };
function readVars() {
  PV.vars = $$('[data-var]').map((r) => { const g = (k) => r.querySelector(`:scope [data-k=${k}]`); const o = { id: g('id').value ? Number(g('id').value) : undefined, name: g('name').value, name_es: g('name_es').value, price_cents: cents(g('price').value), compare_cents: g('compare').value ? cents(g('compare').value) : null, stock: g('stock') ? Number(g('stock').value) || 0 : 0, sku: g('sku').value, active: g('active').checked };
    o.components = $$('[data-comp]', r).map((c) => ({ variant_id: Number($('[data-k=variant_id]', c).value), qty: Number($('[data-k=qty]', c).value) || 1 })).filter((c) => c.variant_id); return o; });
}
const drawVars = () => mount('#prod-vars', html`${PV.vars.map((v, i) => varRow(v, i, PV.bundle))}`);
const openProd = (p) => {
  PV.vars = p ? p.variants.map((v) => ({ ...v })) : [{ name: 'Standard', price_cents: 0, stock: 0, active: 1 }]; PV.bundle = !!p?.is_bundle;
  openModal(html`<form data-form="prod-save" novalidate><input type="hidden" name="_id" value="${p?.id || ''}">
    <div class="form-grid" style="padding:0"><label class="field"><span>${t('Name')} (EN)</span><input type="text" name="name" value="${p?.name || ''}" required></label><label class="field"><span>${t('Name')} (ES)</span><input type="text" name="name_es" value="${p?.name_es || ''}"></label>
    <label class="field"><span>${t('Category')} (EN)</span><input type="text" name="category" value="${p?.category || 'Supplies'}"></label><label class="field"><span>${t('Category')} (ES)</span><input type="text" name="category_es" value="${p?.category_es || ''}"></label>
    <label class="field full"><span>${t('Description')} (EN)</span><textarea name="description">${p?.description || ''}</textarea></label><label class="field full"><span>${t('Description')} (ES)</span><textarea name="description_es">${p?.description_es || ''}</textarea></label>
    ${fld({ k: 'image', l: t('Image'), t: 'image', full: 1 }, p || {})}<label class="field"><span>${t('Sort order')}</span><input type="number" name="sort" value="${p?.sort || 0}"></label>
    <label class="check"><input type="checkbox" name="is_bundle" id="prod-bundle" ${p?.is_bundle ? 'checked' : ''}><span>${t('This is a bundle / kit (stock comes from its contents)')}</span></label><label class="check"><input type="checkbox" name="active" ${p === undefined || p?.active ? 'checked' : ''}><span>${t('Visible in shop')}</span></label></div>
    <h4 style="margin:1rem 0 .5rem">${t('Options, sizes & stock')}</h4><div id="prod-vars">${PV.vars.map((v, i) => varRow(v, i, PV.bundle))}</div><button type="button" class="btn btn-ghost btn-sm" data-act="var-add">${icon('plus')} ${t('Add option')}</button>
    <div class="row" style="margin-top:1rem"><button class="btn btn-primary" type="submit">${t('Save product')}</button>${p ? html`<button type="button" class="btn btn-ghost" data-act="prod-del" data-id="${p.id}" style="color:var(--bad);margin-left:auto">${icon('trash')}</button>` : ''}</div></form>`, { title: p ? t('Edit product') : t('New product'), size: 'wide' });
};
act('prod-edit', () => openProd(undefined));
act('prod-edit-row', (el) => openProd(C.products.items.find((x) => x.id === Number(el.dataset.id))));
act('var-add', () => { readVars(); PV.vars.push({ name: '', price_cents: 0, stock: 0, active: 1 }); drawVars(); });
act('var-rm', (el) => { readVars(); PV.vars.splice(Number(el.dataset.i), 1); if (!PV.vars.length) PV.vars.push({ name: 'Standard', price_cents: 0, stock: 0, active: 1 }); drawVars(); });
act('comp-add', (el) => { readVars(); const i = Number(el.closest('[data-var]').dataset.var); PV.vars[i].components = [...(PV.vars[i].components || []), {}]; drawVars(); });
act('comp-rm', (el) => { readVars(); const v = el.closest('[data-var]'); const i = Number(v.dataset.var); const k = $$('[data-comp]', v).indexOf(el.closest('[data-comp]')); PV.vars[i].components.splice(k, 1); drawVars(); });
document.addEventListener('change', (e) => { if (e.target.id === 'prod-bundle') { readVars(); PV.bundle = e.target.checked; drawVars(); } });
form('prod-save', async (d) => {
  readVars(); const body = { name: d.name, name_es: d.name_es, category: d.category, category_es: d.category_es, description: d.description, description_es: d.description_es, image: d.image, sort: d.sort, is_bundle: !!d.is_bundle, active: !!d.active, variants: PV.vars.map((v) => ({ ...v, components: d.is_bundle ? v.components : [] })) };
  if (d._id) await put(`/api/admin/products/${d._id}`, body); else await post('/api/admin/products', body);
  closeAllModals(); toast(t('Saved'), 'ok'); await refreshCatalog();
});
act('prod-del', async (el) => { if (!(await confirmDialog(t('Delete this product? Products with past orders are hidden instead.'), { ok: t('Delete'), danger: true }))) return; const r = await del(`/api/admin/products/${el.dataset.id}`); closeAllModals(); toast(r.deactivated ? t('Hidden (it has past orders)') : t('Deleted')); await refreshCatalog(); });

// ================================================================ TEAM
async function team() {
  const r = await api('/api/admin/employees'); A.d.team = r.items;
  A.view = () => html`<div class="pg-h"><h2>${t('Team')}</h2><button class="btn btn-primary btn-sm" data-act="emp-edit">${icon('plus')} ${t('Add team member')}</button></div>
    <p class="muted" style="margin-top:-.4rem">${t('Crew members sign in with their email and see only their assigned jobs — never prices or invoices.')}</p>
    ${table([{ h: t('Name'), c: (e) => html`<b>${e.name}</b><br><small class="muted">${e.title || ''}</small>` }, { h: t('Contact'), c: (e) => html`${e.email}<br><small class="muted">${e.phone || ''}</small>` }, { h: t('Open jobs'), c: (e) => e.jobs_open, cls: 'right' }, { h: t('Last sign-in'), c: (e) => (e.last_login ? fmtDateTime(e.last_login) : '—') }, { h: t('Status'), c: (e) => yn(e.active) }], A.d.team, { rowAct: 'emp-edit-row' })}`;
}
const EMP = (e) => [{ k: 'name', l: t('Full name'), t: 'text', req: 1 }, { k: 'title', l: t('Role'), t: 'text', ph: 'Cleaner' }, { k: 'email', l: t('Email (sign-in)'), t: 'email', req: !e }, { k: 'phone', l: t('Phone'), t: 'tel' }, { k: 'password', l: e ? t('New password (leave blank to keep)') : t('Password'), t: 'pass', req: !e, hint: t('At least 10 characters') }, ...(e ? [{ k: 'active', l: t('Active (can sign in)'), t: 'bool' }] : [])];
const openEmp = (e) => openModal(html`<form data-form="emp-save" novalidate><input type="hidden" name="id" value="${e?.id || ''}">${fieldsHtml(EMP(e).filter((d) => !(e && d.k === 'email')), e || {})}${e ? html`<p class="muted tiny">${e.email}</p>` : ''}<button class="btn btn-primary btn-block" type="submit" style="margin-top:1rem">${e ? t('Save') : t('Add team member')}</button></form>`, { title: e ? e.name : t('Add team member') });
act('emp-edit', () => openEmp(null));
act('emp-edit-row', (el) => openEmp(A.d.team.find((x) => x.id === Number(el.dataset.id))));
form('emp-save', async (d) => {
  const body = { name: d.name, title: d.title, email: d.email, phone: d.phone, password: d.password || undefined, active: d.active };
  if (d.id) await put(`/api/admin/employees/${d.id}`, body); else await post('/api/admin/employees', body);
  closeAllModals(); toast(t('Saved'), 'ok'); reload();
});

// ================================================================ MESSAGES
async function messages() {
  const r = await api('/api/admin/messages'); A.d.threads = r.items;
  A.view = () => html`<div class="pg-h"><h2>${t('Messages')}</h2></div>${A.d.threads.length ? html`<div class="panel"><div class="list">${A.d.threads.map((m) => html`<div class="li click" data-act="msg-thread" data-id="${m.customer_id}"><div class="t"><b>${m.name}</b><small>${(m.last_body || '').slice(0, 90)} · ${fmtDateTime(m.last_at)}</small></div>${m.unread ? badge('bad', m.unread) : icon('right')}</div>`)}</div></div>` : html`<div class="empty card">${t('No messages yet. Customer messages from their account appear here.')}</div>`}`;
}
act('msg-thread', async (el) => {
  const id = el.dataset.id; const m = openModal(html`<div class="skel" style="height:200px"></div>`, { title: t('Messages') });
  const draw_ = async () => {
    const r = await api(`/api/admin/messages/${id}`);
    m.set(html`<div class="row between"><b>${r.customer.name}</b><span class="muted tiny">${r.customer.phone || r.customer.email || ''}</span></div><div class="chat" id="adm-chat" style="margin:.6rem 0">${r.items.length ? r.items.map((x) => html`<div class="msg ${x.sender_role === 'customer' ? '' : 'me'}">${x.body}<small>${fmtDateTime(x.created_at)}</small></div>`) : html`<div class="muted center">${t('No messages yet.')}</div>`}</div>
      <form class="row" data-form="msg-send" style="flex-wrap:nowrap" novalidate><input type="hidden" name="id" value="${id}"><input type="text" name="body" class="grow" placeholder="${t('Write a reply…')}" autocomplete="off"><button class="btn btn-primary" type="submit">${t('Send')}</button></form>`);
    const c = $('#adm-chat'); if (c) c.scrollTop = c.scrollHeight;
  };
  msgRedraw = draw_; await draw_();
});
let msgRedraw = null;
form('msg-send', async (d) => { if (!d.body.trim()) return; await post(`/api/admin/messages/${d.id}`, { body: d.body }); await msgRedraw?.(); if (A.tab === 'messages') reload(); });

// ================================================================ REPORTS
const RP = { from: monthStart(), to: todayISO() };
async function reports() {
  const [r, ex] = await Promise.all([api(`/api/admin/reports?from=${RP.from}&to=${RP.to}`), api('/api/admin/r/expenses')]); A.d.rep = r; A.d.exp = ex.items.filter((e) => e.date >= RP.from && e.date <= RP.to);
  A.view = () => {
    const mx = Math.max(1, ...r.by_day.map((d) => d.cents)); const kp = (l, v, e) => html`<div class="kpi"><small>${l}</small><b>${v}</b>${e ? html`<em>${e}</em>` : ''}</div>`;
    const METH = { cash: 'Cash', zelle: 'Zelle', ath_movil: 'ATH Móvil', check: 'Check', bank_transfer: 'Bank transfer', card_external: 'Card (external)', other: 'Other', card: 'Card', stripe: 'Card', demo: 'Demo' };
    return html`<div class="pg-h"><h2>${t('Reports')}</h2><div class="row"><a class="btn btn-ghost btn-sm" href="${csvHref('payments', RP.from, RP.to)}" data-keep>${icon('download')} ${t('Payments CSV')}</a><a class="btn btn-ghost btn-sm" href="${csvHref('invoices', RP.from, RP.to)}" data-keep>${icon('download')} ${t('Invoices CSV')}</a><a class="btn btn-ghost btn-sm" href="${csvHref('expenses', RP.from, RP.to)}" data-keep>${icon('download')} ${t('Expenses CSV')}</a></div></div>
      <form class="toolbar" data-form="rep-range" novalidate><label class="row tiny">${t('From')} <input type="date" name="from" value="${RP.from}"></label><label class="row tiny">${t('To')} <input type="date" name="to" value="${RP.to}"></label><button class="btn btn-navy btn-sm" type="submit">${t('Apply')}</button>
        ${[['month', t('This month')], ['30', t('Last 30 days')], ['year', t('This year')]].map(([k, l]) => html`<button type="button" class="chip" data-act="rep-preset" data-k="${k}" style="min-height:34px;padding:.3rem .8rem">${l}</button>`)}</form>
      <div class="kpis">${kp(t('Collected'), money(r.collected_cents))}${kp(t('Refunds'), money(r.refunds_cents))}${kp(t('Expenses'), money(r.expenses_cents))}${kp(t('Net profit'), money(r.profit_cents), t('Collected − refunds − expenses'))}${kp(t('Invoiced'), money(r.invoiced_cents))}${kp(t('Outstanding (all time)'), money(r.outstanding_cents))}${kp(t('Services revenue'), money(r.by_source.services))}${kp(t('Products revenue'), money(r.by_source.products))}</div>
      ${r.by_day.length ? html`<div class="panel"><h3>${t('Collected per day')}</h3><div class="bars">${r.by_day.slice(-31).map((d) => html`<div class="bar" title="${fmtDate(d.date)} — ${money(d.cents)}"><i style="height:${Math.max(3, (d.cents / mx) * 120)}px;background:linear-gradient(var(--teal),var(--teal-d));border-radius:6px 6px 0 0;width:70%;max-width:22px"></i><small>${d.date.slice(8)}</small></div>`)}</div></div>` : ''}
      <div class="two"><div class="panel"><h3>${t('By payment method')}</h3>${Object.keys(r.by_method).length ? html`<div class="list">${Object.entries(r.by_method).map(([k, v]) => html`<div class="li"><span>${t(METH[k] || k)}</span><b>${money(v)}</b></div>`)}</div>` : html`<div class="empty">${t('No payments in this period.')}</div>`}</div>
      <div class="panel"><h3>${t('Expenses by category')}</h3>${r.expenses_by_category.length ? html`<div class="list">${r.expenses_by_category.map((e) => html`<div class="li"><span>${e.category}</span><b>${money(e.cents)}</b></div>`)}</div>` : html`<div class="empty">${t('No expenses in this period.')}</div>`}</div></div>
      <div class="two"><div class="panel"><h3>${t('Top services')}</h3>${r.top_services.length ? html`<div class="list">${r.top_services.map((s) => html`<div class="li"><span>${pickLang(s, 'name')} <small class="muted">×${s.jobs}</small></span><b>${money(s.cents)}</b></div>`)}</div>` : html`<div class="empty">${t('No completed jobs in this period.')}</div>`}</div>
      <div class="panel"><h3>${t('Products sold')}</h3>${r.products_sold.length ? html`<div class="list">${r.products_sold.map((p) => html`<div class="li"><span>${p.name}${p.variant && p.variant !== 'Standard' ? ' — ' + p.variant : ''} <small class="muted">×${p.qty}</small></span><b>${money(p.cents)}</b></div>`)}</div>` : html`<div class="empty">${t('No product sales in this period.')}</div>`}</div></div>
      <div class="panel"><div class="row between"><h3>${t('Expenses')}</h3><button class="btn btn-primary btn-sm" data-act="exp-edit">${icon('plus')} ${t('Add expense')}</button></div>${table([{ h: t('Date'), c: (e) => fmtDate(e.date) }, { h: t('Category'), c: (e) => e.category }, { h: t('Vendor'), c: (e) => e.vendor || '' }, { h: t('Notes'), c: (e) => e.description || '' }, { h: t('Amount'), c: (e) => money(e.amount_cents), cls: 'right' }], A.d.exp, { rowAct: 'exp-edit-row', empty: t('No expenses recorded for this period.') })}</div>`;
  };
}
form('rep-range', async (d) => { RP.from = d.from || RP.from; RP.to = d.to || RP.to; await reload(); });
act('rep-preset', async (el) => {
  const n = new Date(); const iso = (d) => d.toISOString().slice(0, 10); RP.to = todayISO();
  if (el.dataset.k === 'month') RP.from = monthStart(); else if (el.dataset.k === 'year') RP.from = `${n.getFullYear()}-01-01`; else { const d = new Date(); d.setDate(d.getDate() - 30); RP.from = iso(d); }
  await reload();
});
const EXPC = ['Supplies', 'Fuel', 'Equipment', 'Payroll', 'Insurance', 'Marketing', 'Vehicle', 'Software', 'Other'];
const EXP = () => [{ k: 'date', l: t('Date'), t: 'date', req: 1 }, { k: 'category', l: t('Category'), t: 'select', opts: EXPC.map((c) => [c, t(c)]) }, { k: 'vendor', l: t('Vendor'), t: 'text' }, { k: 'amount_cents', l: t('Amount ($)'), t: 'money', req: 1 }, { k: 'description', l: t('Notes'), t: 'text', full: 1 }];
const openExp = (e) => openModal(html`<form data-form="exp-save" novalidate><input type="hidden" name="id" value="${e?.id || ''}">${fieldsHtml(EXP(), e || { date: todayISO() })}<div class="row" style="margin-top:1rem"><button class="btn btn-primary" type="submit">${t('Save')}</button>${e ? html`<button type="button" class="btn btn-ghost" data-act="exp-del" data-id="${e.id}" style="color:var(--bad);margin-left:auto">${icon('trash')}</button>` : ''}</div></form>`, { title: e ? t('Edit expense') : t('Add expense') });
act('exp-edit', () => openExp(null));
act('exp-edit-row', (el) => openExp(A.d.exp.find((x) => x.id === Number(el.dataset.id))));
form('exp-save', async (d) => { const body = readFields(EXP(), d); if (d.id) await put(`/api/admin/r/expenses/${d.id}`, body); else await post('/api/admin/r/expenses', body); closeAllModals(); toast(t('Saved'), 'ok'); reload(); });
act('exp-del', async (el) => { if (!(await confirmDialog(t('Delete this expense?'), { ok: t('Delete'), danger: true }))) return; await del(`/api/admin/r/expenses/${el.dataset.id}`); closeAllModals(); reload(); });

// ================================================================ SETTINGS
const ST = { sub: 'business', s: null, integ: null, notif: null, audit: null, faqs: [], promos: [] };
const SSUBS = () => [['business', t('Business')], ['schedule', t('Schedule')], ['pricing', t('Pricing & invoices')], ['rewards', t('Rewards')], ['site', t('Website content')], ['integrations', t('Integrations')], ['automation', t('Automations')], ['audit', t('Activity log')]];
const get_ = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function set_(o, p, v) { const ks = p.split('.'); let c = o; ks.slice(0, -1).forEach((k) => { c = c[k] ??= {}; }); c[ks.at(-1)] = v; }
const flat = (defs, src) => Object.fromEntries(defs.map((d) => { let v = get_(src, d.k); if (d.t === 'lines') v = [].concat(v || []); return [d.k, v]; }));
const SDEFS = {
  business: () => [{ k: 'business.name', l: t('Business name'), t: 'text' }, { k: 'business.tagline', l: t('Tagline') + ' (ES)', t: 'text' }, { k: 'business.tagline_en', l: t('Tagline') + ' (EN)', t: 'text' }, { k: 'business.phone', l: t('Phone'), t: 'tel' }, { k: 'business.whatsapp', l: t('WhatsApp number'), t: 'tel', hint: t('Digits with country code, e.g. 17874278122') }, { k: 'business.email', l: t('Business email'), t: 'email' }, { k: 'business.address', l: t('Address'), t: 'text', full: 1 },
    { k: 'business.license_note', l: t('License note') + ' (EN)', t: 'text' }, { k: 'business.license_note_es', l: t('License note') + ' (ES)', t: 'text' }, { k: 'business.social.facebook', l: 'Facebook URL', t: 'text' }, { k: 'business.social.instagram', l: 'Instagram URL', t: 'text' }, { k: 'business.social.tiktok', l: 'TikTok URL', t: 'text' }],
  schedule: () => [{ k: 'crews', l: t('Crews available per time slot'), t: 'num', hint: t('How many jobs can run at the same time') }, { k: 'lead_hours', l: t('Minimum notice (hours)'), t: 'num' }, { k: 'max_days_ahead', l: t('Book up to (days ahead)'), t: 'num' }, { k: 'slots', l: t('Time slots (24h, one per line)'), t: 'lines', ph: '08:00\n10:00\n12:00', full: 1 }, { k: 'blocked_dates', l: t('Blocked dates (YYYY-MM-DD, one per line)'), t: 'lines', full: 1 }],
  pricing: () => [{ k: 'tax_rate', l: t('Sales tax / IVU (%)'), t: 'num', step: 0.001, hint: t('Confirm the correct rate with your accountant') }, { k: 'deposit_pct', l: t('Booking deposit (%)'), t: 'num' }, { k: 'min_deposit_cents', l: t('Minimum deposit ($)'), t: 'money' }, { k: 'commercial_multiplier', l: t('Commercial price multiplier'), t: 'num', step: 0.01 }, { k: 'condition_multipliers.heavy', l: t('Heavy-condition multiplier'), t: 'num', step: 0.01 },
    { k: 'frequency_discounts.weekly', l: t('Weekly discount (%)'), t: 'num' }, { k: 'frequency_discounts.biweekly', l: t('Every 2 weeks discount (%)'), t: 'num' }, { k: 'frequency_discounts.monthly', l: t('Monthly discount (%)'), t: 'num' }, { k: 'max_auto_sqft', l: t('Largest property priced automatically (sq ft)'), t: 'num' }, { k: 'max_auto_rooms', l: t('Most rooms priced automatically'), t: 'num' }, { k: 'vip_cents', l: t('VIP customer threshold ($ lifetime)'), t: 'money' },
    { k: 'shipping.ship_enabled', l: t('Offer shipping'), t: 'bool' }, { k: 'shipping.pickup_enabled', l: t('Offer local pickup'), t: 'bool' }, { k: 'shipping.flat_cents', l: t('Flat shipping ($)'), t: 'money' }, { k: 'shipping.free_over_cents', l: t('Free shipping over ($)'), t: 'money' }, { k: 'shipping.pickup_address', l: t('Pickup address'), t: 'text', full: 1 },
    { k: 'invoice.prefix', l: t('Invoice prefix'), t: 'text' }, { k: 'invoice.next', l: t('Next invoice number'), t: 'num' }, { k: 'invoice.due_days', l: t('Default due (days)'), t: 'num' }, { k: 'invoice.terms', l: t('Invoice terms'), t: 'area', full: 1 }, { k: 'invoice.footer', l: t('Invoice footer'), t: 'area', full: 1 }],
  rewards: () => [{ k: 'loyalty.points_per_dollar', l: t('Points earned per $1'), t: 'num', step: 0.1 }, { k: 'loyalty.redeem_points', l: t('Points per reward'), t: 'num' }, { k: 'loyalty.redeem_value_cents', l: t('Reward value ($)'), t: 'money' }, { k: 'loyalty.min_redeem', l: t('Minimum points to redeem'), t: 'num' }, { k: 'referral.referrer_points', l: t('Points for the referrer'), t: 'num' }, { k: 'referral.referred_points', l: t('Points for the new customer'), t: 'num' }],
  site: () => [{ k: 'site.hero_title', l: t('Headline') + ' (EN)', t: 'text', full: 1 }, { k: 'site.hero_title_es', l: t('Headline') + ' (ES)', t: 'text', full: 1 }, { k: 'site.hero_sub', l: t('Sub-headline') + ' (EN)', t: 'area', full: 1 }, { k: 'site.hero_sub_es', l: t('Sub-headline') + ' (ES)', t: 'area', full: 1 }, { k: 'site.about', l: t('About us') + ' (EN)', t: 'area', full: 1 }, { k: 'site.about_es', l: t('About us') + ' (ES)', t: 'area', full: 1 }, { k: 'site.service_areas', l: t('Service areas (towns, one per line)'), t: 'lines', full: 1 }],
};
const NUMERIC_TOP = new Set(['crews', 'lead_hours', 'max_days_ahead', 'tax_rate', 'deposit_pct', 'min_deposit_cents', 'commercial_multiplier', 'max_auto_sqft', 'max_auto_rooms', 'vip_cents']);
async function settingsTab() {
  if (ST.sub === 'integrations' || !ST.s) { const r = await api('/api/admin/settings'); ST.s = r.settings; ST.integ = r.integrations; }
  if (ST.sub === 'automation') ST.notif = await api('/api/admin/notifications');
  if (ST.sub === 'audit') ST.audit = (await api('/api/admin/audit')).items;
  if (ST.sub === 'site') { ST.faqs = (ST.s.site.faqs || []).map((f) => ({ ...f })); ST.promos = (ST.s.site.promos || []).map((p) => ({ ...p })); }
  A.view = () => html`<div class="pg-h"><h2>${t('Settings')}</h2></div>${subTabs(SSUBS(), ST.sub, 'set-sub')}${setBody()}`;
}
act('set-sub', async (el) => { ST.sub = el.dataset.id; await reload(); });
function setBody() {
  const s = ST.sub;
  if (SDEFS[s]) {
    const defs = SDEFS[s](); const src = flat(defs, ST.s);
    return html`<form class="panel" data-form="set-save" novalidate><input type="hidden" name="_sub" value="${s}">${fieldsHtml(defs, src)}
      ${s === 'schedule' ? hoursEditor() : ''}${s === 'site' ? html`${faqEditor()}${promoEditor()}` : ''}
      <button class="btn btn-primary" type="submit" style="margin-top:1rem">${t('Save settings')}</button></form>`;
  }
  if (s === 'integrations') return integrations();
  if (s === 'automation') return automation();
  return html`${table([{ h: t('When'), c: (a) => fmtDateTime(a.created_at) }, { h: t('Who'), c: (a) => a.user_name || '—' }, { h: t('Action'), c: (a) => a.action }, { h: t('Detail'), c: (a) => a.detail || '' }], ST.audit, { empty: t('No activity yet.') })}`;
}
const DAYS = () => [t('Sunday'), t('Monday'), t('Tuesday'), t('Wednesday'), t('Thursday'), t('Friday'), t('Saturday')];
const hoursEditor = () => html`<h4 style="margin:1.2rem 0 .5rem">${t('Business hours')}</h4><div class="stack">${DAYS().map((d, i) => { const h = ST.s.hours[i] || {}; return html`<div class="row" style="flex-wrap:nowrap"><label class="check" style="width:140px"><input type="checkbox" name="hours.${i}.enabled" ${h.enabled ? 'checked' : ''}><span>${d}</span></label><input type="time" name="hours.${i}.open" value="${h.open || '08:00'}" style="width:130px"><span>–</span><input type="time" name="hours.${i}.close" value="${h.close || '17:00'}" style="width:130px"></div>`; })}</div>`;
// FAQ + promo editors (dynamic rows)
const faqRow = (f, i) => html`<div class="panel" data-faq="${i}" style="padding:.8rem;margin-bottom:.6rem"><div class="form-grid" style="padding:0"><label class="field"><span>${t('Question')} (EN)</span><input type="text" data-k="q" value="${f.q || ''}"></label><label class="field"><span>${t('Question')} (ES)</span><input type="text" data-k="q_es" value="${f.q_es || ''}"></label><label class="field"><span>${t('Answer')} (EN)</span><textarea data-k="a">${f.a || ''}</textarea></label><label class="field"><span>${t('Answer')} (ES)</span><textarea data-k="a_es">${f.a_es || ''}</textarea></label></div><button type="button" class="btn btn-ghost btn-sm" data-act="faq-rm" data-i="${i}" style="color:var(--bad)">${icon('trash')}</button></div>`;
const promoRow = (p, i) => html`<div class="panel" data-promo="${i}" style="padding:.8rem;margin-bottom:.6rem"><input type="hidden" data-k="id" value="${p.id || ''}"><div class="form-grid" style="padding:0"><label class="field"><span>${t('Banner text')} (EN)</span><input type="text" data-k="text" value="${p.text || ''}"></label><label class="field"><span>${t('Banner text')} (ES)</span><input type="text" data-k="text_es" value="${p.text_es || ''}"></label><label class="field"><span>${t('Promo code shown')}</span><input type="text" data-k="code" value="${p.code || ''}"></label><label class="check" style="align-self:end"><input type="checkbox" data-k="active" ${p.active ? 'checked' : ''}><span>${t('Show banner')}</span></label></div><button type="button" class="btn btn-ghost btn-sm" data-act="promo-rm" data-i="${i}" style="color:var(--bad)">${icon('trash')}</button></div>`;
const faqEditor = () => html`<h4 style="margin:1.2rem 0 .5rem">${t('FAQ')}</h4><div id="faq-rows">${ST.faqs.map(faqRow)}</div><button type="button" class="btn btn-ghost btn-sm" data-act="faq-add">${icon('plus')} ${t('Add question')}</button>`;
const promoEditor = () => html`<h4 style="margin:1.2rem 0 .5rem">${t('Promo banners')}</h4><p class="muted tiny">${t('The top banner on the website. Create the matching discount under Catalog → Promo codes.')}</p><div id="promo-rows">${ST.promos.map(promoRow)}</div><button type="button" class="btn btn-ghost btn-sm" data-act="promo-add">${icon('plus')} ${t('Add banner')}</button>`;
function readDyn() {
  ST.faqs = $$('[data-faq]').map((r) => Object.fromEntries($$('[data-k]', r).map((i) => [i.dataset.k, i.value])));
  ST.promos = $$('[data-promo]').map((r) => Object.fromEntries($$('[data-k]', r).map((i) => [i.dataset.k, i.type === 'checkbox' ? i.checked : i.value])));
}
const drawDyn = () => { mount('#faq-rows', html`${ST.faqs.map(faqRow)}`); mount('#promo-rows', html`${ST.promos.map(promoRow)}`); };
act('faq-add', () => { readDyn(); ST.faqs.push({}); drawDyn(); });
act('faq-rm', (el) => { readDyn(); ST.faqs.splice(Number(el.dataset.i), 1); drawDyn(); });
act('promo-add', () => { readDyn(); ST.promos.push({ active: true }); drawDyn(); });
act('promo-rm', (el) => { readDyn(); ST.promos.splice(Number(el.dataset.i), 1); drawDyn(); });
form('set-save', async (d, f) => {
  const sub = d._sub; const defs = SDEFS[sub](); const patch = {};
  for (const x of defs) {
    const v = d[x.k]; let out;
    if (x.t === 'num') out = v === '' || v === undefined ? 0 : Number(v);
    else if (x.t === 'money') out = cents(v);
    else if (x.t === 'bool') out = !!v;
    else if (x.t === 'lines') out = String(v || '').split('\n').map((s) => s.trim()).filter(Boolean);
    else out = v ?? '';
    if (NUMERIC_TOP.has(x.k) || x.k === 'slots' || x.k === 'blocked_dates') patch[x.k] = out; else set_(patch, x.k, out);
  }
  if (sub === 'schedule') { const hours = {}; for (let i = 0; i < 7; i++) hours[i] = { enabled: !!d[`hours.${i}.enabled`], open: d[`hours.${i}.open`] || '08:00', close: d[`hours.${i}.close`] || '17:00' }; patch.hours = hours; }
  if (sub === 'site') { readDyn(); patch.site.faqs = ST.faqs; patch.site.promos = ST.promos; }
  if (sub === 'pricing') { patch.condition_multipliers = { ...ST.s.condition_multipliers, ...(patch.condition_multipliers || {}) }; patch.frequency_discounts = { ...ST.s.frequency_discounts, ...(patch.frequency_discounts || {}) }; patch.shipping = { ...ST.s.shipping, ...(patch.shipping || {}) }; patch.invoice = { ...ST.s.invoice, ...(patch.invoice || {}) }; }
  if (sub === 'business') patch.business = { ...ST.s.business, ...patch.business, social: { ...(ST.s.business.social || {}), ...(patch.business.social || {}) } };
  if (sub === 'rewards') { patch.loyalty = { ...ST.s.loyalty, ...patch.loyalty }; patch.referral = { ...ST.s.referral, ...patch.referral }; }
  if (sub === 'site') patch.site = { ...ST.s.site, ...patch.site };
  const r = await put('/api/admin/settings', patch); ST.s = r.settings; await refreshPublic();
  toast(t('Settings saved'), 'ok'); await reload();
});
function integrations() {
  const i = ST.integ; const row = (ok, name, desc, env) => html`<div class="li"><div class="t"><b>${name}</b><small>${desc}</small>${!ok && env ? html`<small><code>${env}</code></small>` : ''}</div>${badge(ok ? 'ok' : 'warn', ok ? t('Connected') : t('Not set up'))}</div>`;
  return html`<div class="panel"><h3>${t('Integrations')}</h3><p class="muted tiny">${t('These are configured on the server (environment variables) so secrets never reach the browser. See the README.')}</p><div class="list">
    ${row(i.payments === 'live', t('Stripe payments'), i.payments === 'live' ? t('Live card payments are on.') : i.payments === 'test' ? t('Test mode — no real money moves.') : t('Not connected: customers cannot pay by card online yet.'), 'STRIPE_SECRET_KEY')}
    ${row(i.stripe_webhook, t('Stripe webhook'), t('Marks invoices paid automatically.'), 'STRIPE_WEBHOOK_SECRET')}
    ${row(i.email, t('Email (Resend)'), t('Booking confirmations, invoices and receipts.'), 'RESEND_API_KEY + EMAIL_FROM')}
    ${row(i.whatsapp, t('WhatsApp Business'), t('Reminders and updates by WhatsApp.'), 'WHATSAPP_TOKEN + WHATSAPP_PHONE_ID')}
    ${row(i.analytics, t('Google Analytics'), t('Visitor and booking tracking.'), 'GA_MEASUREMENT_ID')}
    ${row(i.maps, t('Google Maps'), t('Interactive service-area map.'), 'GOOGLE_MAPS_API_KEY')}</div>
    <div class="alert" style="margin-top:1rem"><b>${t('Stripe webhook URL')}:</b><br><code style="word-break:break-all">${i.webhook_url}</code></div></div>`;
}
const AUTO_LABEL = { reminders: 'Appointment reminders', invoices: 'Overdue invoice reminders', reviewRequests: 'Review requests', memberships: 'Membership renewals', housekeeping: 'Housekeeping', inactiveCampaign: 'Win-back campaign (inactive customers)' };
function automation() {
  const n = ST.notif; const no = ST.s.notifications || {};
  return html`<div class="panel"><h3>${t('Automatic messages')}</h3><p class="muted tiny">${t('These run in the background every few minutes. You can also run one now.')}</p><div class="list">${n.automations.map((j) => html`<div class="li"><span>${t(AUTO_LABEL[j] || j)}</span><button class="btn btn-ghost btn-sm" data-act="auto-run" data-job="${j}">${icon('refresh')} ${t('Run now')}</button></div>`)}</div></div>
    <form class="panel" data-form="notif-save" novalidate><h3>${t('Message settings')}</h3>${fieldsHtml([{ k: 'email', l: t('Send emails'), t: 'bool' }, { k: 'whatsapp', l: t('Send WhatsApp messages'), t: 'bool' }, { k: 'reminder_hours', l: t('Reminder before job (hours)'), t: 'num' }, { k: 'review_delay_hours', l: t('Ask for review after (hours)'), t: 'num' }, { k: 'overdue_every_days', l: t('Overdue reminder every (days)'), t: 'num' }, { k: 'overdue_max', l: t('Max overdue reminders'), t: 'num' }, { k: 'inactive_days', l: t('Inactive customer after (days)'), t: 'num' }], no)}<button class="btn btn-primary" type="submit" style="margin-top:1rem">${t('Save')}</button></form>
    <div class="panel"><h3>${t('Message log')}</h3>${!n.providers.email || !n.providers.whatsapp ? html`<div class="alert warn">${!n.providers.email ? t('Email is not connected — emails are kept in this log only.') + ' ' : ''}${!n.providers.whatsapp ? t('WhatsApp is not connected — messages are kept in this log only.') : ''}</div>` : ''}
    ${table([{ h: t('When'), c: (x) => fmtDateTime(x.created_at) }, { h: t('To'), c: (x) => html`${x.customer_name || ''}<br><small class="muted">${x.to_addr || ''}</small>` }, { h: t('Channel'), c: (x) => (x.channel === 'whatsapp' ? 'WhatsApp' : 'Email') }, { h: t('Message'), c: (x) => x.subject || x.template }, { h: t('Status'), c: (x) => badge({ sent: 'ok', failed: 'bad', queued: 'warn', skipped: '' }[x.status] || 'info', x.status) }, { h: '', c: (x) => (x.status === 'failed' || x.status === 'queued' ? html`<button class="btn btn-ghost btn-sm" data-act="notif-resend" data-id="${x.id}">${t('Retry')}</button>` : '') }], n.items, { empty: t('No messages sent yet.') })}</div>`;
}
act('auto-run', async (el) => { const r = await post('/api/admin/automation', { job: el.dataset.job }); toast(r.result || t('Done'), 'ok'); await reload(); });
act('notif-resend', async (el) => { const r = await post(`/api/admin/notifications/${el.dataset.id}/resend`); toast(r.status?.status === 'sent' ? t('Sent') : t('Still not delivered'), r.status?.status === 'sent' ? 'ok' : undefined); await reload(); });
form('notif-save', async (d) => {
  const keys = ['reminder_hours', 'review_delay_hours', 'overdue_every_days', 'overdue_max', 'inactive_days']; const o = { ...ST.s.notifications, email: !!d.email, whatsapp: !!d.whatsapp };
  for (const k of keys) o[k] = Number(d[k]) || 0;
  const r = await put('/api/admin/settings', { notifications: o }); ST.s = r.settings; toast(t('Settings saved'), 'ok'); await reload();
});

export const LOAD2 = { catalog, team, messages, reports, settings: settingsTab };
void formData;
