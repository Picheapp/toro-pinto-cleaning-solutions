// Customer portal.
import { S, t, tl, tlist, html, raw, mount, $, $$, icon, stars, api, post, put, del, money, num, fmtDate, fmtDateTime, fmtTime, todayISO, toast, errToast, act, form, onLang, openModal, closeAllModals, confirmDialog, svcName, findSvc, bookingBadge, invBadge, orderBadge, badge, waLink, LS, track } from './core.js';
import { openApp, frame, paint, currentApp } from './appshell.js';
import { onAuthed } from './auth.js';
import { startBooking, lineLabel } from './booking.js';
import { openCart } from './shop.js';

const A = { tab: 'home', data: null, cards: null, err: '' };
const TABS = () => [
  { id: 'home', label: t('Home'), icon: 'home' }, { id: 'bookings', label: t('Bookings'), icon: 'calendar' }, { id: 'invoices', label: t('Invoices'), icon: 'file' },
  { id: 'orders', label: t('Orders'), icon: 'bag' }, { id: 'rewards', label: t('Rewards'), icon: 'gift' }, { id: 'messages', label: t('Messages'), icon: 'message' }, { id: 'profile', label: t('Profile'), icon: 'user' },
];

export async function openAccount(tab) {
  if (tab) A.tab = tab;
  openApp('account', (id) => { A.tab = id; draw(); });
  draw();
  await refresh();
}
export async function refresh() {
  try { A.data = await api('/api/account'); A.err = ''; } catch (e) { A.err = e.message; }
  if (currentApp()?.kind === 'account') draw();
}
onLang(() => { if (currentApp()?.kind === 'account') draw(); });
onAuthed((u) => { if (currentApp()?.kind === 'account' && !u) return; });

function draw() {
  const d = A.data; let body;
  if (A.err) body = html`<div class="alert bad">${A.err}</div>`;
  else if (!d) body = html`<div class="skel" style="height:160px"></div><div class="skel" style="height:160px;margin-top:1rem"></div>`;
  else body = { home, bookings, invoices, orders, rewards, messages, profile }[A.tab](d);
  paint(frame({ title: t('My account'), tabs: TABS(), active: A.tab, body, badge: { invoices: d?.invoices.filter((i) => i.balance_cents > 0).length || '' } }));
  if (A.tab === 'profile' && d) setTimeout(loadCards, 0);
}
const bk = (b) => ({ ...b, name: S.lang === 'es' && b.service_name_es ? b.service_name_es : b.service_name });
const isUpcoming = (b) => ['pending', 'confirmed', 'en_route', 'in_progress'].includes(b.status);

// ---------------------------------------------------------------- home
function home(d) {
  const up = d.bookings.filter(isUpcoming).sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot));
  const due = d.invoices.filter((i) => i.balance_cents > 0);
  const dueTotal = due.reduce((s, i) => s + i.balance_cents, 0);
  return html`<div class="pg-h"><div><h2>${t('Hello, {name}', { name: d.customer.name.split(' ')[0] })}</h2><span class="muted">${d.customer.email}</span></div><button class="btn btn-primary" data-act="acct-book">${icon('plus')} ${t('Book a service')}</button></div>
    <div class="kpis"><div class="kpi"><small>${t('Upcoming')}</small><b>${up.length}</b></div><div class="kpi ${dueTotal ? 'hl' : ''}"><small>${t('Balance due')}</small><b>${money(dueTotal)}</b></div><div class="kpi"><small>${t('Loyalty points')}</small><b>${num(d.loyalty.points)}</b></div><div class="kpi"><small>${t('Membership')}</small><b style="font-size:1.1rem">${d.membership ? d.membership.name : '—'}</b></div></div>
    <div class="two"><div class="panel"><h3>${t('Next visit')}</h3>${up.length ? bookingCard(up[0], d) : html`<div class="empty">${t('No upcoming bookings.')}<br><button class="btn btn-primary" data-act="acct-book" style="margin-top:.8rem">${t('Book now')}</button></div>`}</div>
    <div class="panel"><h3>${t('Payments due')}</h3>${due.length ? html`<div class="list">${due.map((i) => html`<div class="li"><div class="t"><b>${i.number}</b><small>${t('Due {d}', { d: fmtDate(i.due_date) })} ${invBadge(i.status)}</small></div><div class="row"><b>${money(i.balance_cents)}</b><button class="btn btn-primary btn-sm" data-act="pay-inv" data-id="${i.id}" data-p="balance">${t('Pay')}</button></div></div>`)}</div>` : html`<div class="empty">${icon('check')}<br>${t('You are all paid up. Thank you!')}</div>`}</div></div>
    ${d.membership ? html`<div class="panel"><h3>${t('Your plan')}: ${d.membership.name}</h3><p class="muted">${t('{pct}% off every service. Next billing {d}.', { pct: d.membership.discount_pct, d: fmtDate(d.membership.next_bill_date) })}</p><button class="btn btn-ghost btn-sm" data-act="mem-cancel" style="margin-top:.6rem">${t('Cancel membership')}</button></div>` : ''}`;
}
act('acct-book', () => { $('#app-view').querySelector('[data-act=app-close]').click(); setTimeout(() => startBooking({}), 50); });

// ---------------------------------------------------------------- bookings
function bookingCard(raw0, d) {
  const b = bk(raw0); const inv = d.invoices.find((i) => i.id === b.invoice_id);
  const depDue = inv ? Math.max(0, inv.deposit_cents - inv.paid_cents) : 0; const canChange = ['pending', 'confirmed'].includes(b.status) && !b.change;
  return html`<article class="job" style="cursor:default"><div class="row between"><b>${b.name}</b>${bookingBadge(b.status)}</div>
    <div class="muted">${icon('calendar')} ${fmtDate(b.date, { weekday: 'long', month: 'long', day: 'numeric' })} · ${fmtTime(b.slot)}</div>
    <div class="muted tiny">${icon('pin')} ${b.address}${b.city ? ', ' + b.city : ''} · <span class="nowrap">${b.code}</span></div>
    <div class="row between"><b>${money(b.total_cents)}</b>${inv ? html`<span class="tiny muted">${invBadge(inv.status)}</span>` : ''}</div>
    ${b.change ? html`<div class="alert ${b.change.status === 'pending' ? 'warn' : b.change.status === 'approved' ? 'ok' : 'bad'}">${b.change.status === 'pending' ? t('Your {type} request is being reviewed.', { type: b.change.type === 'cancel' ? t('cancellation') : t('reschedule') }) : b.change.status === 'approved' ? t('Your request was approved.') : t('Your request was declined.') + (b.change.admin_note ? ' ' + b.change.admin_note : '')}</div>` : ''}
    ${b.crew?.length ? html`<div class="tiny muted">${icon('users')} ${t('Your crew')}: ${b.crew.join(', ')}</div>` : ''}
    ${b.photos?.length ? html`<div class="photo-row">${b.photos.map((p) => html`<a href="/api/files/${p.id}" target="_blank" rel="noopener"><img src="/api/files/${p.id}" alt="${p.kind === 'job_before' ? t('Before') : t('After')}" loading="lazy"></a>`)}</div>` : ''}
    <div class="row">${depDue > 0 && b.status !== 'cancelled' ? html`<button class="btn btn-primary btn-sm" data-act="pay-inv" data-id="${b.invoice_id}" data-p="deposit">${t('Pay {amt} deposit', { amt: money(depDue) })}</button>` : b.inv_balance > 0 && b.status !== 'cancelled' && b.status === 'completed' ? html`<button class="btn btn-primary btn-sm" data-act="pay-inv" data-id="${b.invoice_id}" data-p="balance">${t('Pay balance')} ${money(b.inv_balance)}</button>` : ''}
      ${canChange ? html`<button class="btn btn-ghost btn-sm" data-act="bk-resched" data-id="${b.id}">${t('Reschedule')}</button><button class="btn btn-ghost btn-sm" data-act="bk-cancel" data-id="${b.id}">${t('Cancel')}</button>` : ''}
      ${b.status === 'completed' && !b.reviewed ? html`<button class="btn btn-navy btn-sm" data-act="bk-review" data-id="${b.id}">${icon('star')} ${t('Leave a review')}</button>` : ''}
      ${b.status === 'completed' || b.status === 'cancelled' ? html`<button class="btn btn-ghost btn-sm" data-act="bk-again" data-id="${b.id}">${icon('refresh')} ${t('Book again')}</button>` : ''}</div></article>`;
}
function bookings(d) {
  const up = d.bookings.filter(isUpcoming).sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot)); const past = d.bookings.filter((b) => !isUpcoming(b));
  return html`<div class="pg-h"><h2>${t('Bookings')}</h2><button class="btn btn-primary btn-sm" data-act="acct-book">${icon('plus')} ${t('New booking')}</button></div>
    <h3 style="margin:.4rem 0 .6rem">${t('Upcoming')}</h3>${up.length ? up.map((b) => bookingCard(b, d)) : html`<div class="empty card">${t('No upcoming bookings.')}</div>`}
    <h3 style="margin:1.4rem 0 .6rem">${t('History')}</h3>${past.length ? past.map((b) => bookingCard(b, d)) : html`<div class="empty card">${t('Nothing here yet.')}</div>`}`;
}
const getBooking = (id) => A.data.bookings.find((b) => b.id === Number(id));
act('bk-again', (el) => { const b = getBooking(el.dataset.id); $('#app-view').querySelector('[data-act=app-close]').click(); setTimeout(() => startBooking({ service_id: b.service_id, segment: b.segment, frequency: b.frequency }), 50); });
act('bk-cancel', (el) => {
  const b = getBooking(el.dataset.id);
  openModal(html`<form class="stack" data-form="bk-change" novalidate><input type="hidden" name="id" value="${b.id}"><input type="hidden" name="type" value="cancel">
    <p>${t('Request to cancel {name} on {d}?', { name: bk(b).name, d: fmtDate(b.date) })}</p><label class="field"><span>${t('Reason (optional)')}</span><textarea name="reason"></textarea></label>
    <p class="tiny muted">${t('Cancellations are confirmed by our team. Deposits may be non-refundable within 24 hours of the service.')}</p>
    <button class="btn btn-danger btn-block" type="submit">${t('Request cancellation')}</button></form>`, { title: t('Cancel booking'), size: 'sm' });
});
const RS = { date: '', slot: '', slots: null };
act('bk-resched', (el) => {
  const b = getBooking(el.dataset.id); RS.date = ''; RS.slot = ''; RS.slots = null; const max = new Date(todayISO() + 'T12:00:00Z'); max.setUTCDate(max.getUTCDate() + S.settings.max_days_ahead);
  openModal(html`<form class="stack" data-form="bk-change" novalidate><input type="hidden" name="id" value="${b.id}"><input type="hidden" name="type" value="reschedule"><input type="hidden" name="date" id="rs-date"><input type="hidden" name="slot" id="rs-slot">
    <p>${bk(b).name} · ${fmtDate(b.date)} ${fmtTime(b.slot)}</p>
    <label class="field"><span>${t('New date')}</span><input type="date" id="rs-pick" min="${todayISO()}" max="${max.toISOString().slice(0, 10)}"></label>
    <div id="rs-slots"></div><label class="field"><span>${t('Reason (optional)')}</span><textarea name="reason"></textarea></label>
    <button class="btn btn-primary btn-block" type="submit">${t('Request new time')}</button></form>`, { title: t('Reschedule'), size: 'sm' });
});
document.addEventListener('change', async (e) => {
  if (e.target.id !== 'rs-pick') return; const date = e.target.value; $('#rs-date').value = date; $('#rs-slot').value = '';
  mount('#rs-slots', html`<div class="skel" style="height:50px"></div>`);
  try { const r = await api('/api/availability?date=' + date); drawSlots(r.slots); } catch (err) { mount('#rs-slots', html`<div class="alert bad">${err.message}</div>`); }
});
function drawSlots(slots) {
  mount('#rs-slots', slots.length ? html`<div class="slots">${slots.map((s) => html`<button type="button" class="slot ${$('#rs-slot').value === s.slot ? 'on' : ''}" data-act="rs-slot" data-v="${s.slot}" ${s.available ? '' : 'disabled'}>${fmtTime(s.slot)}</button>`)}</div>` : html`<div class="muted">${t('No times available that day.')}</div>`);
  RS.slots = slots;
}
act('rs-slot', (el) => { $('#rs-slot').value = el.dataset.v; drawSlots(RS.slots); });
form('bk-change', async (d) => {
  if (d.type === 'reschedule' && (!d.date || !d.slot)) throw new Error(t('Please choose a date and time.'));
  await post(`/api/bookings/${d.id}/change-request`, { type: d.type, date: d.date, slot: d.slot, reason: d.reason });
  closeAllModals(); toast(t('Request sent. We will confirm shortly.'), 'ok'); refresh();
});
act('bk-review', (el) => {
  const b = getBooking(el.dataset.id); let rating = 5;
  const m = openModal(html`<form class="stack" data-form="review" novalidate><input type="hidden" name="booking_id" value="${b.id}"><input type="hidden" name="rating" value="5">
    <p>${bk(b).name}</p><div class="row" id="rv-stars" style="justify-content:center">${[1, 2, 3, 4, 5].map((n) => html`<button type="button" class="icon-btn" data-act="rv-star" data-n="${n}" aria-label="${n}" style="color:#f6b73c;width:52px;height:52px">${icon('star', 'fill')}</button>`)}</div>
    <label class="field"><span>${t('Tell us about your experience')}</span><textarea name="comment"></textarea></label><button class="btn btn-primary btn-block" type="submit">${t('Submit review')}</button></form>`, { title: t('Leave a review'), size: 'sm' });
});
act('rv-star', (el) => { const n = Number(el.dataset.n); $('input[name=rating]', el.closest('form')).value = n; $$('#rv-stars button').forEach((b, i) => { b.style.color = i < n ? '#f6b73c' : '#d6dde6'; }); });
form('review', async (d) => { await post('/api/reviews', { booking_id: Number(d.booking_id), rating: Number(d.rating), comment: d.comment }); closeAllModals(); toast(t('Thank you for your review!'), 'ok'); track('review'); refresh(); });

// ---------------------------------------------------------------- invoices
function invoices(d) {
  return html`<div class="pg-h"><h2>${t('Invoices')}</h2></div>${d.invoices.length ? html`<div class="panel"><div class="list">${d.invoices.map((i) => html`<div class="li click" data-act="inv-open" data-id="${i.id}"><div class="t"><b>${i.number}</b><small>${fmtDate(i.issue_date)}${i.booking_code ? ' · ' + i.booking_code : ''}${i.order_code ? ' · ' + i.order_code : ''}</small></div><div class="right"><b>${money(i.total_cents)}</b><br>${invBadge(i.status)}</div></div>`)}</div></div>` : html`<div class="empty card">${t('No invoices yet.')}</div>`}`;
}
act('inv-open', async (el) => {
  const m = openModal(html`<div class="skel" style="height:200px"></div>`, { title: t('Invoice'), size: 'wide' });
  const { invoice: i } = await api(`/api/invoices/${el.dataset.id}`);
  const deposit = Math.max(0, i.deposit_cents - i.paid_cents);
  m.set(html`<div class="row between"><div><b style="font:800 1.3rem var(--head)">${i.number}</b><div class="muted tiny">${t('Issued {a} · Due {b}', { a: fmtDate(i.issue_date), b: fmtDate(i.due_date) })}</div></div>${invBadge(i.status)}</div>
    <div class="tbl-wrap" style="margin:1rem 0"><table class="tbl"><thead><tr><th>${t('Description')}</th><th class="right">${t('Qty')}</th><th class="right">${t('Amount')}</th></tr></thead><tbody>${i.items.map((x) => html`<tr><td>${lineLabel(x.description)}</td><td class="right">${x.qty}</td><td class="right">${money(x.total_cents)}</td></tr>`)}</tbody></table></div>
    <div class="sum"><div class="ln"><span>${t('Subtotal')}</span><b>${money(i.subtotal_cents)}</b></div>${i.discount_cents ? html`<div class="ln disc"><span>${t('Discount')}</span><b>−${money(i.discount_cents)}</b></div>` : ''}${i.tax_cents ? html`<div class="ln"><span>${t('Tax')}</span><b>${money(i.tax_cents)}</b></div>` : ''}<div class="ln tot"><span>${t('Total')}</span><span>${money(i.total_cents)}</span></div><div class="ln"><span>${t('Paid')}</span><b>${money(i.paid_cents)}</b></div><div class="ln bold"><span>${t('Balance due')}</span><b>${money(i.balance_cents)}</b></div></div>
    ${i.payments.filter((p) => p.status === 'succeeded').length ? html`<h4 style="margin:1rem 0 .4rem">${t('Payments')}</h4><div class="list">${i.payments.filter((p) => p.status === 'succeeded').map((p) => html`<div class="li"><span>${fmtDate(p.paid_at || p.created_at)} · ${t(PAYM[p.method] || p.method)}</span><b>${money(p.amount_cents)}</b></div>`)}</div>` : ''}
    <div class="row" style="margin-top:1.2rem"><a class="btn btn-ghost" href="/api/invoices/${i.id}/pdf" target="_blank" rel="noopener" data-keep>${icon('download')} ${t('Download PDF')}</a>
      ${i.balance_cents > 0 && !i.cancelled ? html`${deposit > 0 && i.paid_cents === 0 && i.deposit_cents < i.total_cents ? html`<button class="btn btn-ghost" data-act="pay-inv" data-id="${i.id}" data-p="deposit">${t('Pay deposit')} ${money(deposit)}</button>` : ''}<button class="btn btn-primary" data-act="pay-inv" data-id="${i.id}" data-p="balance">${icon('lock')} ${t('Pay')} ${money(i.balance_cents)}</button>` : ''}</div>`);
});
const PAYM = { card: 'Card', stripe: 'Card', cash: 'Cash', check: 'Check', zelle: 'Zelle', ath_movil: 'ATH Móvil', bank_transfer: 'Bank transfer', card_external: 'Card (external)', other: 'Other', demo: 'Demo' };
act('pay-inv', async (el) => {
  el.classList.add('busy');
  try { const r = await post('/api/pay/checkout', { invoice_id: Number(el.dataset.id), purpose: el.dataset.p || 'balance' }); location.href = r.url; } finally { el.classList.remove('busy'); }
});

// ---------------------------------------------------------------- orders
function orders(d) {
  return html`<div class="pg-h"><h2>${t('Orders')}</h2><button class="btn btn-primary btn-sm" data-act="acct-shop">${t('Shop products')}</button></div>
    ${d.orders.length ? d.orders.map((o) => html`<article class="job" style="cursor:default"><div class="row between"><b>${o.code}</b>${orderBadge(o.status)}</div>
      <div class="muted tiny">${fmtDate(o.created_at)} · ${o.fulfillment === 'ship' ? t('Shipping') : t('Local pickup')}</div>
      <div class="list">${o.items.map((x) => html`<div class="li"><span>${x.qty} × ${prodLabel(x)}</span><b>${money(x.unit_cents * x.qty)}</b></div>`)}</div>
      <div class="row between"><b>${t('Total')} ${money(o.total_cents)}</b>${o.status === 'pending_payment' && o.invoice_id ? html`<button class="btn btn-primary btn-sm" data-act="pay-inv" data-id="${o.invoice_id}" data-p="full">${t('Pay now')}</button>` : ''}</div>
      ${o.tracking_number ? html`<div class="alert">${icon('truck')} ${t('Tracking')}: <b>${o.tracking_number}</b>${o.carrier ? ' (' + o.carrier + ')' : ''}</div>` : ''}</article>`) : html`<div class="empty card">${t('No orders yet.')}</div>`}`;
}
function prodLabel(x) { const p = S.cat.products.find((q) => q.name === x.product_name); const name = p ? tl(p, 'name') : x.product_name; const v = p?.variants.find((q) => q.name === x.variant_name); const vn = v ? tl(v, 'name') : x.variant_name; return vn && vn !== 'Standard' ? `${name} — ${vn}` : name; }
act('acct-shop', () => { $('#app-view').querySelector('[data-act=app-close]').click(); setTimeout(() => document.querySelector('#shop').scrollIntoView({ behavior: 'smooth' }), 80); });

// ---------------------------------------------------------------- rewards
function rewards(d) {
  const L = d.loyalty, R = d.referral; const link = `${location.origin}/?ref=${R.code}`;
  const msg = t('Get {pts} bonus points on your first Toro Pinto cleaning! Use my code {code}: {link}', { pts: R.referred_points, code: R.code, link });
  return html`<div class="pg-h"><h2>${t('Rewards')}</h2></div>
    <div class="kpis"><div class="kpi hl"><small>${t('Loyalty points')}</small><b>${num(L.points)}</b><em>${t('Worth {amt}', { amt: money(Math.floor(L.points / L.redeem_points) * L.redeem_value_cents) })}</em></div><div class="kpi"><small>${t('Friends referred')}</small><b>${R.referred}</b></div></div>
    <div class="panel"><h3>${t('Refer a friend')}</h3><p class="muted">${t('You get {a} points and your friend gets {b} points after their first payment.', { a: num(R.referrer_points), b: num(R.referred_points) })}</p>
      <div class="row" style="margin:.8rem 0"><span class="codebox">${R.code}</span><button class="btn btn-ghost btn-sm" data-act="copy" data-v="${link}">${t('Copy link')}</button><a class="btn btn-primary btn-sm" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener" data-keep>${icon('whatsapp')} ${t('Share')}</a></div></div>
    <div class="panel"><h3>${t('How points work')}</h3><p class="muted">${t('Earn {n} point per $1. Every {pts} points = {amt} off. Use them when booking or checking out.', { n: L.points_per_dollar, pts: L.redeem_points, amt: money(L.redeem_value_cents) })}</p></div>
    <div class="panel"><h3>${t('Points history')}</h3>${L.ledger.length ? html`<div class="list">${L.ledger.map((x) => html`<div class="li"><div class="t"><b>${ledgerReason(x.reason)}</b><small>${fmtDate(x.created_at)}</small></div><b style="color:${x.points >= 0 ? 'var(--ok)' : 'var(--bad)'}">${x.points >= 0 ? '+' : ''}${x.points}</b></div>`)}</div>` : html`<div class="empty">${t('No points yet — your first payment starts earning them.')}</div>`}</div>
    <div class="panel"><h3>${t('Memberships')}</h3>${d.membership ? html`<p>${t('Active plan')}: <b>${d.membership.name}</b> — ${d.membership.discount_pct}%</p><button class="btn btn-ghost btn-sm" data-act="mem-cancel">${t('Cancel membership')}</button>` : html`<div class="grid plans" style="margin:0">${S.cat.plans.map((p) => html`<div class="card pad"><b>${p.name}</b><div class="price">${money(p.price_cents)} <small>/ ${t('month')}</small></div><p class="tiny muted">${p.discount_pct}% ${t('off every service')}</p><button class="btn btn-navy btn-sm btn-block" data-act="mem-join" data-id="${p.id}" style="margin-top:.6rem">${t('Join')}</button></div>`)}</div>`}</div>`;
}
const ledgerReason = (r) => { let m; if ((m = /^Payment (.+)$/.exec(r))) return t('Payment {x}', { x: m[1] }); if ((m = /^Referral/.exec(r))) return t('Referral reward'); return /^Welcome/.test(r) ? t('Welcome bonus') : r; };
act('copy', async (el) => { try { await navigator.clipboard.writeText(el.dataset.v); toast(t('Copied!'), 'ok'); } catch { toast(el.dataset.v); } });
act('mem-join', async (el) => {
  const p = S.cat.plans.find((x) => x.id === Number(el.dataset.id));
  if (!(await confirmDialog(t('Join {plan} for {price} per month?', { plan: p.name, price: money(p.price_cents) }), { ok: t('Continue to payment') }))) return;
  const r = await post('/api/membership/subscribe', { plan_id: p.id }); const c = await post('/api/pay/checkout', { invoice_id: r.invoice_id, purpose: 'full' }); location.href = c.url;
});
act('mem-cancel', async () => { if (!(await confirmDialog(t('Cancel your membership? You keep your perks until the end of the paid period.'), { ok: t('Cancel membership'), danger: true }))) return; await post('/api/membership/cancel'); toast(t('Membership cancelled.')); refresh(); });

// ---------------------------------------------------------------- messages
function messages(d) {
  return html`<div class="pg-h"><h2>${t('Messages')}</h2><a class="btn btn-ghost btn-sm" href="${waLink('')}" target="_blank" rel="noopener" data-keep>${icon('whatsapp')} WhatsApp</a></div>
    <div class="panel"><div class="chat" id="chat">${d.messages.length ? d.messages.map((m) => html`<div class="msg ${m.sender_role === 'customer' ? 'me' : ''}">${m.body}<small>${fmtDateTime(m.created_at)}</small></div>`) : html`<div class="empty">${t('Send us a message — we usually reply within a few hours.')}</div>`}</div>
    <form class="row" data-form="msg" style="margin-top:.8rem;flex-wrap:nowrap" novalidate><input type="text" name="body" placeholder="${t('Write a message…')}" style="flex:1" required autocomplete="off"><button class="btn btn-primary" type="submit">${icon('arrow')}</button></form></div>`;
}
form('msg', async (d, f) => { if (!d.body.trim()) return; await post('/api/messages', { body: d.body }); f.reset(); await refresh(); const c = $('#chat'); if (c) c.scrollTop = c.scrollHeight; });

// ---------------------------------------------------------------- profile
function profile(d) {
  const c = d.customer;
  return html`<div class="pg-h"><h2>${t('Profile')}</h2></div>
    <form class="panel stack" data-form="profile" novalidate><h3>${t('Your details')}</h3>
      <label class="field"><span>${t('Full name')}</span><input type="text" name="name" value="${c.name}" required></label>
      <label class="field"><span>${t('Email')}</span><input type="email" value="${c.email}" disabled></label>
      <label class="field"><span>${t('Mobile phone')}</span><input type="tel" name="phone" value="${c.phone || ''}" inputmode="tel"></label>
      <label class="field"><span>${t('Company (optional)')}</span><input type="text" name="company" value="${c.company || ''}"></label>
      <label class="check"><input type="checkbox" name="whatsapp_opt_in" ${c.whatsapp_opt_in ? 'checked' : ''}><span>${t('Send me reminders and updates on WhatsApp')}</span></label>
      <label class="check"><input type="checkbox" name="marketing_opt_in" ${c.marketing_opt_in ? 'checked' : ''}><span>${t('Send me offers and tips by email')}</span></label>
      <button class="btn btn-primary" type="submit" style="width:max-content">${t('Save changes')}</button></form>
    <div class="panel"><div class="row between"><h3>${t('Saved addresses')}</h3><button class="btn btn-ghost btn-sm" data-act="addr-edit" data-id="0">${icon('plus')} ${t('Add')}</button></div>
      ${d.addresses.length ? html`<div class="list">${d.addresses.map((a) => html`<div class="li"><div class="t"><b>${a.label || t('Address')}${a.is_default ? html` ${badge('teal', t('Default'))}` : ''}</b><small>${a.line1}${a.city ? ', ' + a.city : ''} ${a.zip || ''}</small></div><div class="row"><button class="icon-btn" data-act="addr-edit" data-id="${a.id}" aria-label="${t('Edit')}">${icon('edit')}</button><button class="icon-btn" data-act="addr-del" data-id="${a.id}" aria-label="${t('Delete')}">${icon('trash')}</button></div></div>`)}</div>` : html`<div class="empty">${t('No saved addresses.')}</div>`}</div>
    ${d.pay.mode === 'stripe' ? html`<div class="panel" id="cards"><div class="row between"><h3>${t('Saved cards')}</h3><button class="btn btn-ghost btn-sm" data-act="card-add">${icon('plus')} ${t('Add card')}</button></div><div id="cards-body"><div class="skel" style="height:50px"></div></div></div>` : ''}
    <form class="panel stack" data-form="password" novalidate><h3>${t('Change password')}</h3>
      <label class="field"><span>${t('Current password')}</span><input type="password" name="current" autocomplete="current-password" required></label>
      <label class="field"><span>${t('New password')}</span><input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
      <button class="btn btn-navy" type="submit" style="width:max-content">${t('Update password')}</button></form>`;
}
form('profile', async (d) => { await put('/api/account/profile', d); toast(t('Saved'), 'ok'); refresh(); });
form('password', async (d, f) => { await post('/api/auth/password', d); f.reset(); toast(t('Password updated'), 'ok'); });
act('addr-edit', (el) => {
  const a = A.data.addresses.find((x) => x.id === Number(el.dataset.id)) || {};
  openModal(html`<form class="stack" data-form="addr" novalidate><input type="hidden" name="id" value="${a.id || ''}">
    <label class="field"><span>${t('Label')}</span><input type="text" name="label" value="${a.label || ''}" placeholder="${t('Home, Office…')}"></label>
    <label class="field"><span>${t('Street address')}</span><input type="text" name="line1" value="${a.line1 || ''}" required></label>
    <div class="row"><label class="field grow"><span>${t('City / Town')}</span><input type="text" name="city" value="${a.city || ''}"></label><label class="field" style="width:120px"><span>${t('ZIP code')}</span><input type="text" name="zip" value="${a.zip || ''}"></label></div>
    <label class="field"><span>${t('Access notes')}</span><textarea name="notes">${a.notes || ''}</textarea></label>
    <label class="check"><input type="checkbox" name="is_default" ${a.is_default ? 'checked' : ''}><span>${t('Make this my default address')}</span></label>
    <button class="btn btn-primary btn-block" type="submit">${t('Save address')}</button></form>`, { title: a.id ? t('Edit address') : t('New address'), size: 'sm' });
});
form('addr', async (d) => { const body = { label: d.label, line1: d.line1, city: d.city, zip: d.zip, notes: d.notes, is_default: d.is_default }; if (d.id) await put(`/api/account/addresses/${d.id}`, body); else await post('/api/account/addresses', body); closeAllModals(); refresh(); });
act('addr-del', async (el) => { if (!(await confirmDialog(t('Delete this address?'), { ok: t('Delete'), danger: true }))) return; await del(`/api/account/addresses/${el.dataset.id}`); refresh(); });
act('card-add', async () => { const r = await post('/api/account/payment-methods'); location.href = r.url; });
act('card-del', async (el) => { await del(`/api/account/payment-methods/${el.dataset.id}`); loadCards(); });
async function loadCards() {
  const box = $('#cards-body'); if (!box) return;
  try { const r = await api('/api/account/payment-methods'); mount(box, r.cards.length ? html`<div class="list">${r.cards.map((c) => html`<div class="li"><span>${icon('lock')} <b style="text-transform:capitalize">${c.brand}</b> •••• ${c.last4} <small class="muted">${String(c.exp_month).padStart(2, '0')}/${String(c.exp_year).slice(-2)}</small></span><button class="icon-btn" data-act="card-del" data-id="${c.id}" aria-label="${t('Remove')}">${icon('trash')}</button></div>`)}</div>` : html`<div class="empty">${t('No saved cards.')}</div>`); } catch (e) { mount(box, html`<div class="alert warn">${e.message}</div>`); }
}
