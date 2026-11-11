// Shop: product grid, cart drawer and checkout.
import { S, t, tl, html, raw, mount, $, $$, icon, api, post, money, num, toast, errToast, act, form, onLang, openModal, closeModal, LS, track, debounce } from './core.js';
import { openAuth, onAuthed } from './auth.js';
import { lineLabel } from './booking.js';

const C = { open: null, view: 'cart', priced: null, err: '', coupon: '', fulfillment: 'pickup', usePoints: false, busy: false, shop: 'all' };
const loadCart = () => { try { const c = JSON.parse(LS.get('tp_cart') || '[]'); return Array.isArray(c) ? c.filter((i) => i.variant_id && i.qty > 0) : []; } catch { return []; } };
const saveCart = () => { LS.set('tp_cart', JSON.stringify(S.cart)); updateBadge(); };
export function updateBadge() { const n = S.cart.reduce((s, i) => s + i.qty, 0); const b = $('#cart-count'); if (b) { b.hidden = !n; b.textContent = n; } }
const variantInfo = (vid) => { for (const p of S.cat.products) { const v = p.variants.find((x) => x.id === vid); if (v) return { p, v }; } return null; };

export function initShop() {
  S.cart = loadCart(); updateBadge();
  if (S.cart.length) S.cart = S.cart.filter((i) => variantInfo(i.variant_id)); saveCart();
  onLang(() => { renderShop(); if (C.open) renderDrawer(); });
  onAuthed(() => { if (C.open) renderDrawer(); });
  renderShop();
}

// ---------------------------------------------------------------- product grid
function minPrice(p) { return Math.min(...p.variants.map((v) => v.price_cents)); }
export function renderShop() {
  const grid = $('#shop-grid'), chips = $('#shop-chips'); if (!grid || !S.cat) return;
  const cats = [...new Map(S.cat.products.map((p) => [p.category, p])).values()];
  mount(chips, html`<button class="chip ${C.shop === 'all' ? 'on' : ''}" data-act="shop-cat" data-v="all">${t('All')}</button>${cats.map((p) => html`<button class="chip ${C.shop === p.category ? 'on' : ''}" data-act="shop-cat" data-v="${p.category}">${tl(p, 'category')}</button>`)}`);
  const list = S.cat.products.filter((p) => C.shop === 'all' || p.category === C.shop);
  if (!list.length) return mount(grid, html`<div class="empty">${t('No products yet — check back soon.')}</div>`);
  mount(grid, html`${list.map((p) => {
    const first = p.variants.find((v) => v.available > 0) || p.variants[0]; const out = p.variants.every((v) => v.available < 1);
    return html`<article class="card prod" data-pid="${p.id}">
      <div class="prod-img" style="background-image:url('${p.image}')" role="img" aria-label="${tl(p, 'name')}">${p.is_bundle ? html`<span class="tag">${t('Bundle')}</span>` : ''}</div>
      <div class="prod-body"><h3>${tl(p, 'name')}</h3>
        <div class="price" id="pp-${p.id}">${p.variants.length > 1 ? html`<small>${t('From')} </small>` : ''}${money(p.variants.length > 1 ? minPrice(p) : first.price_cents)}${first.compare_cents ? html`<span class="was">${money(first.compare_cents)}</span>` : ''}</div>
        ${p.variants.length > 1 ? html`<select data-pv="${p.id}" aria-label="${t('Option')}">${p.variants.map((v) => html`<option value="${v.id}" ${v.id === first.id ? 'selected' : ''} ${v.available < 1 ? 'disabled' : ''}>${tl(v, 'name')} — ${money(v.price_cents)}${v.available < 1 ? ' (' + t('Sold out') + ')' : ''}</option>`)}</select>` : ''}
        <button class="btn btn-primary btn-sm btn-block" data-act="add-cart" data-pid="${p.id}" ${out ? 'disabled' : ''}>${out ? t('Sold out') : html`${icon('plus')} ${t('Add to cart')}`}</button></div></article>`;
  })}`);
}
act('shop-cat', (el) => { C.shop = el.dataset.v; renderShop(); });
document.addEventListener('change', (e) => {
  const sel = e.target.closest('[data-pv]'); if (!sel) return;
  const p = S.cat.products.find((x) => x.id === Number(sel.dataset.pv)); const v = p.variants.find((x) => x.id === Number(sel.value));
  mount($(`#pp-${p.id}`), html`${money(v.price_cents)}${v.compare_cents ? html`<span class="was">${money(v.compare_cents)}</span>` : ''}`);
});
export function addToCart(variantId, qty = 1) {
  const info = variantInfo(variantId); if (!info) return;
  const row = S.cart.find((i) => i.variant_id === variantId); const have = row?.qty || 0;
  if (have + qty > info.v.available) return toast(t('Only {n} available.', { n: info.v.available }), 'bad');
  if (row) row.qty += qty; else S.cart.push({ variant_id: variantId, qty });
  saveCart(); track('add_to_cart', { item: info.p.slug });
  toast(t('Added to cart'), 'ok'); const b = $('#cart-count'); b?.animate([{ transform: 'scale(1.5)' }, { transform: 'scale(1)' }], { duration: 250 });
  if (C.open) { C.priced = null; renderDrawer(); price(); }
}
act('add-cart', (el) => {
  const p = S.cat.products.find((x) => x.id === Number(el.dataset.pid)); const card = el.closest('.prod'); const sel = card.querySelector('select');
  const vid = sel ? Number(sel.value) : p.variants[0].id; addToCart(vid, 1);
});

// ---------------------------------------------------------------- drawer
act('cart', () => openCart());
export function openCart() {
  if (C.open) return;
  C.view = 'cart'; C.err = ''; C.priced = null;
  const m = openModal(html``, { drawer: true, onClose: () => { C.open = null; } });
  C.open = m; renderDrawer(); price();
}
function renderDrawer() {
  if (!C.open) return;
  const body = C.view === 'checkout' ? checkoutView() : cartView();
  mount(C.open.el, body);
}
function cartView() {
  const empty = !S.cart.length; const P = C.priced; const sh = S.settings.shipping;
  const lines = S.cart.map((i) => { const info = variantInfo(i.variant_id); return info ? { ...i, ...info } : null; }).filter(Boolean);
  const pts = S.user?.customer?.loyalty_points || 0; const L = S.settings.loyalty;
  return html`<div class="drawer-h"><h3>${t('Your cart')}</h3><button class="x" data-act="close-modal" aria-label="${t('Close')}">${icon('x')}</button></div>
    <div class="drawer-b">
      ${empty ? html`<div class="empty">${icon('bag')}<p>${t('Your cart is empty.')}</p><a class="btn btn-primary" href="#shop" data-act="close-modal" data-keep>${t('Browse products')}</a></div>` : html`
      ${lines.map((l) => html`<div class="line"><div class="thumb" style="background-image:url('${l.p.image}')"></div>
        <div><b>${tl(l.p, 'name')}</b><div class="tiny muted">${l.p.variants.length > 1 ? tl(l.v, 'name') : ''}</div>
          <div class="row" style="margin-top:.3rem"><div class="qty"><button data-act="cart-qty" data-vid="${l.variant_id}" data-d="-1" aria-label="−">${icon('minus')}</button><b>${l.qty}</b><button data-act="cart-qty" data-vid="${l.variant_id}" data-d="1" aria-label="+">${icon('plus')}</button></div></div></div>
        <div class="right"><b>${money(l.v.price_cents * l.qty)}</b><br><button class="btn-link tiny" data-act="cart-rm" data-vid="${l.variant_id}">${t('Remove')}</button></div></div>`)}
      <div class="stack" style="margin-top:1rem">
        <div class="seg seg-full"><button type="button" class="${C.fulfillment === 'pickup' ? 'on' : ''}" data-act="cart-ful" data-v="pickup" ${sh.pickup_enabled ? '' : 'disabled'}>${t('Local pickup')}</button><button type="button" class="${C.fulfillment === 'ship' ? 'on' : ''}" data-act="cart-ful" data-v="ship" ${sh.ship_enabled ? '' : 'disabled'}>${t('Shipping')}</button></div>
        ${C.fulfillment === 'ship' && P && sh.free_over_cents ? html`<div class="tiny muted">${P.shipping_cents ? t('Add {amt} more for free shipping.', { amt: money(Math.max(0, sh.free_over_cents - (P.subtotal_cents - P.discount_cents))) }) : t('You get free shipping!')}</div>` : ''}
        ${C.fulfillment === 'pickup' && sh.pickup_address ? html`<div class="tiny muted">${t('Pickup at')}: ${sh.pickup_address}</div>` : ''}
        <label class="field"><span>${t('Discount code')}</span><div class="row"><input type="text" id="cart-coupon" value="${C.coupon}" placeholder="SHOP10" autocapitalize="characters" style="flex:1"><button class="btn btn-ghost" data-act="cart-coupon">${t('Apply')}</button></div></label>
        ${S.user?.role === 'customer' && pts >= L.min_redeem ? html`<label class="check"><input type="checkbox" data-act="cart-points" ${C.usePoints ? 'checked' : ''}><span>${t('Use my {pts} loyalty points', { pts: num(pts) })}</span></label>` : ''}
        ${C.err ? html`<div class="alert warn">${C.err}</div>` : ''}</div>`}
    </div>
    ${empty ? '' : html`<div class="drawer-f"><div class="stack">
      ${P ? html`<div class="sum" style="background:#fff">
        <div class="ln"><span>${t('Subtotal')}</span><b>${money(P.subtotal_cents)}</b></div>
        ${P.discounts.map((d) => html`<div class="ln disc"><span>${lineLabel(d.label)}</span><b>−${money(d.cents)}</b></div>`)}
        ${C.fulfillment === 'ship' ? html`<div class="ln"><span>${t('Shipping')}</span><b>${P.shipping_cents ? money(P.shipping_cents) : t('Free')}</b></div>` : ''}
        ${P.tax_cents ? html`<div class="ln"><span>${t('Tax')}</span><b>${money(P.tax_cents)}</b></div>` : ''}
        <div class="ln tot"><span>${t('Total')}</span><span>${money(P.total_cents)}</span></div></div>` : html`<div class="skel" style="height:110px"></div>`}
      <button class="btn btn-primary btn-lg btn-block" data-act="cart-checkout" ${P ? '' : 'disabled'}>${t('Checkout')}</button></div></div>`}`;
}
const price = debounce(async () => {
  if (!C.open || !S.cart.length) return;
  const had = !!C.priced;
  try { C.priced = (await post('/api/cart/price', { items: S.cart, coupon_code: C.coupon, fulfillment: C.fulfillment, use_points: C.usePoints ? usable() : 0 })).cart; C.err = ''; }
  catch (e) { C.err = e.message; if (/coupon|code/i.test(e.message)) C.coupon = ''; try { C.priced = (await post('/api/cart/price', { items: S.cart, fulfillment: C.fulfillment })).cart; } catch { C.priced = null; } }
  if (C.view === 'cart' || !had) renderDrawer();
}, 200);
const usable = () => { const L = S.settings.loyalty; const p = S.user?.customer?.loyalty_points || 0; return p >= L.min_redeem ? Math.floor(p / L.redeem_points) * L.redeem_points : 0; };
act('cart-qty', (el) => {
  const vid = Number(el.dataset.vid); const row = S.cart.find((i) => i.variant_id === vid); const info = variantInfo(vid); const n = row.qty + Number(el.dataset.d);
  if (n < 1) S.cart = S.cart.filter((i) => i !== row); else if (n > info.v.available) return toast(t('Only {n} available.', { n: info.v.available }), 'bad'); else row.qty = n;
  saveCart(); C.priced = null; renderDrawer(); price();
});
act('cart-rm', (el) => { S.cart = S.cart.filter((i) => i.variant_id !== Number(el.dataset.vid)); saveCart(); C.priced = null; renderDrawer(); price(); });
act('cart-ful', (el) => { C.fulfillment = el.dataset.v; C.priced = null; renderDrawer(); price(); });
act('cart-coupon', () => { C.coupon = ($('#cart-coupon').value || '').trim().toUpperCase(); C.priced = null; renderDrawer(); price(); });
act('cart-points', (el) => { C.usePoints = el.checked; C.priced = null; renderDrawer(); price(); });
act('cart-checkout', () => {
  if (S.user?.role !== 'customer') { C.open.close(); openAuth('register'); toast(t('Create an account or sign in to check out.')); const un = onAuthed((u) => { un(); if (u?.role === 'customer') { openCart(); C.view = 'checkout'; renderDrawer(); } }); return; }
  C.view = 'checkout'; renderDrawer();
});

// ---------------------------------------------------------------- checkout
function checkoutView() {
  const P = C.priced; const u = S.user; const ship = C.fulfillment === 'ship';
  return html`<div class="drawer-h"><button class="x" data-act="co-back" aria-label="${t('Back')}">${icon('left')}</button><h3>${t('Checkout')}</h3><button class="x" data-act="close-modal" aria-label="${t('Close')}">${icon('x')}</button></div>
    <form data-form="checkout" novalidate style="display:contents"><div class="drawer-b stack">
      ${ship ? html`<h4>${t('Shipping address')}</h4>
        <label class="field"><span>${t('Full name')}</span><input type="text" name="name" value="${u.name || ''}" autocomplete="name" required></label>
        <label class="field"><span>${t('Street address')}</span><input type="text" name="line1" autocomplete="address-line1" required></label>
        <div class="row"><label class="field grow"><span>${t('City / Town')}</span><input type="text" name="city" autocomplete="address-level2" required></label><label class="field" style="width:120px"><span>${t('ZIP code')}</span><input type="text" name="zip" inputmode="numeric" autocomplete="postal-code" required></label></div>
        <label class="field"><span>${t('Mobile phone')}</span><input type="tel" name="phone" value="${u.customer?.phone || ''}" autocomplete="tel" inputmode="tel" required></label>`
        : html`<div class="alert">${icon('pin')} ${t('Local pickup — we will message you when your order is ready.')}${S.settings.shipping.pickup_address ? html`<br><b>${S.settings.shipping.pickup_address}</b>` : ''}</div>`}
      <label class="field"><span>${t('Order notes (optional)')}</span><textarea name="notes"></textarea></label>
      <div class="sum"><div class="ln"><span>${t('Subtotal')}</span><b>${P ? money(P.subtotal_cents) : ''}</b></div>
        ${P?.discounts.map((d) => html`<div class="ln disc"><span>${lineLabel(d.label)}</span><b>−${money(d.cents)}</b></div>`)}
        ${ship ? html`<div class="ln"><span>${t('Shipping')}</span><b>${P?.shipping_cents ? money(P.shipping_cents) : t('Free')}</b></div>` : ''}
        ${P?.tax_cents ? html`<div class="ln"><span>${t('Tax')}</span><b>${money(P.tax_cents)}</b></div>` : ''}
        <div class="ln tot"><span>${t('Total')}</span><span>${P ? money(P.total_cents) : ''}</span></div></div>
      <p class="tiny muted">${icon('lock')} ${t('Secure payment by card, Apple Pay or Google Pay on the next screen.')}</p></div>
    <div class="drawer-f"><button class="btn btn-primary btn-lg btn-block" type="submit">${t('Place order & pay')}</button></div></form>`;
}
act('co-back', () => { C.view = 'cart'; renderDrawer(); price(); });
form('checkout', async (d) => {
  const ship = C.fulfillment === 'ship';
  const r = await post('/api/orders', { items: S.cart, fulfillment: C.fulfillment, coupon_code: C.coupon, use_points: C.usePoints ? usable() : 0, notes: d.notes, ship: ship ? { name: d.name, line1: d.line1, city: d.city, zip: d.zip, phone: d.phone } : undefined });
  track('begin_checkout', { value: (r.order.total_cents || 0) / 100, currency: 'USD' });
  S.cart = []; saveCart(); C.priced = null;
  const p = await post('/api/pay/checkout', { invoice_id: r.invoice_id, purpose: 'full' });
  location.href = p.url;
});
