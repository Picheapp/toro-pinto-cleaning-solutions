// Admin dashboard: overview, CRM pipeline, customers, bookings, invoices, orders.
import { S, t, tl, html, raw, mount, $, $$, icon, api, post, put, del, money, num, fmtDate, fmtDateTime, fmtTime, todayISO, toast, errToast, act, form, onLang, openModal, closeAllModals, confirmDialog, debounce, badge, bookingBadge, invBadge, orderBadge, BOOKING_LABEL, INV_LABEL, ORDER_LABEL, formData, phoneHref, waLink, findSvc } from './core.js';
import { openApp, frame, paint, currentApp } from './appshell.js';
import { fld, fieldsHtml, readFields, table, csvHref, monthStart, sel, svcLabel, dollars, cents } from './adminkit.js';
import { lineLabel } from './booking.js';
import { TABS2, LOAD2 } from './admin2.js';

export const A = { tab: 'dash', view: () => html``, d: {}, badge: {}, q: { cust: '', seg: '', bstat: '', bq: '', istat: '', iq: '', ostat: '' }, kb: { lost: false } };
const TABS = () => [
  { id: 'dash', label: t('Dashboard'), icon: 'chart' }, { id: 'pipeline', label: t('Pipeline'), icon: 'flag' }, { id: 'customers', label: t('Customers'), icon: 'users' },
  { id: 'bookings', label: t('Bookings'), icon: 'calendar' }, { id: 'invoices', label: t('Invoices'), icon: 'file' }, { id: 'orders', label: t('Orders'), icon: 'box' }, ...TABS2(),
];
const skel = html`<div class="skel" style="height:120px"></div><div class="skel" style="height:220px;margin-top:1rem"></div>`;
export const draw = () => paint(frame({ title: t('Admin'), tabs: TABS(), active: A.tab, body: A.view(), badge: A.badge }));
export const reload = async () => { await LOAD[A.tab](); draw(); refreshBadges(); };
export async function openAdmin(tab) {
  if (tab && LOAD[tab]) A.tab = tab;
  openApp('admin', async (id) => { A.tab = id; history.replaceState(null, '', '#admin/' + id); A.view = () => skel; draw(); await show(); });
  A.view = () => skel; draw(); await show();
}
async function show() {
  try { await LOAD[A.tab](); } catch (e) { A.view = () => html`<div class="alert bad">${e.message}</div>`; }
  draw(); refreshBadges();
}
async function refreshBadges() {
  try { const o = await api('/api/admin/overview'); A.badge = { messages: o.unread_messages || '', bookings: o.pending_changes || '', pipeline: o.new_leads || '', invoices: o.overdue_count || '' }; if (currentApp()?.kind === 'admin') { const keep = A.badge; draw(); void keep; } } catch { /* ignore */ }
}
onLang(() => { if (currentApp()?.kind === 'admin') draw(); });
const nm = (o) => (S.lang === 'es' && o.service_name_es ? o.service_name_es : o.service_name);
const segBadge = (s) => badge({ VIP: 'teal', Active: 'ok', New: 'info', 'At risk': 'warn', Inactive: 'bad', Prospect: '' }[s] || '', t(s));
const mini = (x) => html`<div class="kpi"><small>${x.l}</small><b>${x.v}</b>${x.e ? html`<em>${x.e}</em>` : ''}</div>`;

// ================================================================ DASHBOARD
async function dash() {
  const o = await api('/api/admin/overview'); A.d.o = o;
  A.view = () => {
    const max = Math.max(1, ...o.series.map((s) => Math.max(s.revenue_cents, s.expenses_cents)));
    const mo = (m) => new Intl.DateTimeFormat(S.lang === 'es' ? 'es-PR' : 'en-US', { month: 'short', timeZone: 'UTC' }).format(new Date(m + '-15T12:00:00Z'));
    const stageMax = Math.max(1, ...Object.values(o.stages));
    return html`<div class="pg-h"><h2>${t('Dashboard')}</h2><div class="row"><button class="btn btn-primary btn-sm" data-act="ad-newbooking">${icon('plus')} ${t('New booking')}</button><button class="btn btn-ghost btn-sm" data-act="ad-newinvoice">${icon('plus')} ${t('New invoice')}</button></div></div>
      ${o.pending_changes || o.unread_messages || o.overdue_count ? html`<div class="row" style="margin-bottom:1rem">${o.pending_changes ? html`<button class="pill" style="background:var(--warn-bg);color:#7a520f" data-act="app-tab" data-id="bookings">${t('{n} change requests', { n: o.pending_changes })}</button>` : ''}${o.unread_messages ? html`<button class="pill" style="background:var(--info-bg);color:#1a4a7a" data-act="app-tab" data-id="messages">${t('{n} unread messages', { n: o.unread_messages })}</button>` : ''}${o.overdue_count ? html`<button class="pill" style="background:var(--bad-bg);color:#8f2222" data-act="app-tab" data-id="invoices">${t('{n} overdue invoices', { n: o.overdue_count })}</button>` : ''}</div>` : ''}
      <div class="kpis">${mini({ l: t('Revenue this month'), v: money(o.revenue_month_cents), e: t('Total {amt}', { amt: money(o.revenue_total_cents) }) })}${mini({ l: t('Pending payments'), v: money(o.pending_cents), e: t('{n} overdue', { n: o.overdue_count }) })}${mini({ l: t('Upcoming bookings'), v: o.upcoming_count })}${mini({ l: t('New leads'), v: o.new_leads })}
        ${mini({ l: t('Completed services'), v: o.completed_services })}${mini({ l: t('Active customers'), v: o.active_customers, e: t('last 90 days') })}${mini({ l: t('Products sold'), v: o.products_sold })}${mini({ l: t('Expenses this month'), v: money(o.expenses_month_cents) })}</div>
      <div class="two"><div class="panel"><h3>${t('Revenue vs expenses')} <small class="muted">(${t('6 months')})</small></h3><div class="bars">${o.series.map((s) => html`<div class="bar" title="${money(s.revenue_cents)} / ${money(s.expenses_cents)}"><div style="display:flex;gap:3px;align-items:flex-end;height:120px;width:100%;justify-content:center"><i style="height:${Math.max(2, (s.revenue_cents / max) * 120)}px;width:46%;max-width:26px;background:linear-gradient(var(--teal),var(--teal-d));border-radius:6px 6px 0 0"></i><i class="exp" style="height:${Math.max(2, (s.expenses_cents / max) * 120)}px;width:46%;max-width:26px;background:#cbd5e0;border-radius:6px 6px 0 0"></i></div><small>${mo(s.month)}</small></div>`)}</div>
        <div class="row tiny muted" style="margin-top:.4rem"><span style="color:var(--teal-d)">■</span> ${t('Revenue')} <span style="color:#a0aec0">■</span> ${t('Expenses')}</div></div>
      <div class="panel"><h3>${t('Pipeline')}</h3>${Object.entries(o.stages).map(([k, n]) => html`<div class="row" style="margin:.35rem 0;flex-wrap:nowrap"><span style="width:130px;font-size:.85rem">${t(k)}</span><div style="flex:1;background:var(--gray-2);border-radius:99px;height:10px"><i style="display:block;height:10px;border-radius:99px;background:var(--teal);width:${(n / stageMax) * 100}%"></i></div><b style="width:28px;text-align:right">${n}</b></div>`)}</div></div>
      <div class="two"><div class="panel"><h3>${t('Upcoming bookings')}</h3>${o.upcoming.length ? html`<div class="list">${o.upcoming.map((b) => html`<div class="li click" data-act="bk-open" data-id="${b.id}"><div class="t"><b>${nm(b)}</b><small>${fmtDate(b.date)} · ${fmtTime(b.slot)} · ${b.customer_name}</small></div>${bookingBadge(b.status)}</div>`)}</div>` : html`<div class="empty">${t('No upcoming bookings.')}</div>`}</div>
      <div class="panel"><h3>${t('Follow-ups due')}</h3>${o.followups.length ? html`<div class="list">${o.followups.map((l) => html`<div class="li click" data-act="lead-open" data-id="${l.id}"><div class="t"><b>${l.name}</b><small>${t(l.stage)} · ${fmtDate(l.next_followup)}</small></div>${icon('right')}</div>`)}</div>` : html`<div class="empty">${t('Nothing due.')}</div>`}</div></div>
      <div class="two"><div class="panel"><h3>${t('Top services')}</h3>${o.top_services.length ? html`<div class="list">${o.top_services.map((s) => html`<div class="li"><span>${nm({ service_name: s.name, service_name_es: s.name_es })} <small class="muted">×${s.n}</small></span><b>${money(s.cents)}</b></div>`)}</div>` : html`<div class="empty">${t('No data yet.')}</div>`}</div>
      <div class="panel"><h3>${t('Low stock')}</h3>${o.low_stock.length ? html`<div class="list">${o.low_stock.map((p) => html`<div class="li"><span>${p.name}${p.vname !== 'Standard' ? ' — ' + p.vname : ''}</span>${badge(p.stock < 1 ? 'bad' : 'warn', p.stock < 1 ? t('Sold out') : t('{n} left', { n: p.stock }))}</div>`)}</div>` : html`<div class="empty">${t('Stock levels look good.')}</div>`}</div></div>`;
  };
}

// ================================================================ PIPELINE (CRM)
const NEXT = { 'New Lead': 'Contacted', Contacted: 'Quote Sent', 'Quote Sent': 'Awaiting Approval', 'Awaiting Approval': 'Booked', Booked: 'In Progress', 'In Progress': 'Completed', Completed: 'Paid' };
async function pipeline() {
  const r = await api('/api/admin/leads'); A.d.leads = r;
  A.view = () => {
    const items = r.items; const lost = items.filter((l) => l.lost); const live = items.filter((l) => !l.lost);
    const card = (l) => html`<div class="kc" data-act="lead-open" data-id="${l.id}"><b>${l.name}</b><small>${l.service_name ? nm(l) : (l.source || '')}</small>${l.quote_cents ? html`<small><b>${money(l.quote_cents)}</b></small>` : ''}
      ${l.next_followup ? html`<small style="color:${l.next_followup <= todayISO() ? 'var(--bad)' : 'var(--muted)'}">${icon('clock')} ${fmtDate(l.next_followup)}</small>` : ''}
      ${NEXT[l.stage] ? html`<button class="btn btn-ghost btn-sm" data-act="lead-next" data-id="${l.id}" style="margin-top:.2rem">${t(NEXT[l.stage])} →</button>` : ''}</div>`;
    return html`<div class="pg-h"><h2>${t('Sales pipeline')}</h2><div class="row"><label class="check"><input type="checkbox" data-act="kb-lost" ${A.kb.lost ? 'checked' : ''}><span>${t('Show lost')}</span></label><button class="btn btn-primary btn-sm" data-act="lead-new">${icon('plus')} ${t('New lead')}</button><a class="btn btn-ghost btn-sm" href="${csvHref('leads')}" data-keep>${icon('download')} CSV</a></div></div>
      <div class="kanban">${r.stages.map((s) => { const l = live.filter((x) => x.stage === s); return html`<div class="col"><h4><span>${t(s)}</span><span>${l.length}</span></h4>${l.map(card)}</div>`; })}${A.kb.lost ? html`<div class="col"><h4><span>${t('Lost')}</span><span>${lost.length}</span></h4>${lost.map(card)}</div>` : ''}</div>`;
  };
}
act('kb-lost', (el) => { A.kb.lost = el.checked; draw(); });
act('lead-next', async (el) => { const l = A.d.leads.items.find((x) => x.id === Number(el.dataset.id)); await put(`/api/admin/leads/${l.id}`, { stage: NEXT[l.stage] }); toast(t('Moved to {stage}', { stage: t(NEXT[l.stage]) }), 'ok'); reload(); });
const LEAD_DEFS = () => [
  { k: 'name', l: t('Name'), t: 'text', req: 1 }, { k: 'phone', l: t('Phone'), t: 'tel' }, { k: 'email', l: t('Email'), t: 'email' }, { k: 'source', l: t('Source'), t: 'text', ph: 'Referral, WhatsApp, Facebook…' },
  { k: 'service_id', l: t('Service'), t: 'select', opts: [['', t('— none —')], ...S.cat.services.map((s) => [s.id, svcLabel(s)])] },
  { k: 'quote_cents', l: t('Quote ($)'), t: 'money' }, { k: 'next_followup', l: t('Next follow-up'), t: 'date' }, { k: 'address', l: t('Address'), t: 'text' },
  { k: 'message', l: t('Request details'), t: 'area', full: 1 }, { k: 'notes', l: t('Internal notes'), t: 'area', full: 1 },
];
act('lead-new', () => openModal(html`<form data-form="lead-save" novalidate>${fieldsHtml(LEAD_DEFS().filter((d) => d.k !== 'message'), {})}<button class="btn btn-primary btn-block" type="submit" style="margin-top:1rem">${t('Add lead')}</button></form>`, { title: t('New lead'), size: 'wide' }));
act('lead-open', async (el) => {
  let lead = A.d.leads?.items.find((x) => x.id === Number(el.dataset.id));
  if (!lead) { const r = await api('/api/admin/leads'); A.d.leads = r; lead = r.items.find((x) => x.id === Number(el.dataset.id)); }
  const stages = A.d.leads.stages;
  openModal(html`<form data-form="lead-save" novalidate><input type="hidden" name="id" value="${lead.id}">
    <label class="field" style="margin-bottom:.8rem"><span>${t('Stage')}</span><div class="optgrid">${stages.map((s) => html`<label class="opt ${lead.stage === s ? 'on' : ''}" style="cursor:pointer"><input type="radio" name="stage" value="${s}" ${lead.stage === s ? 'checked' : ''} hidden><b>${t(s)}</b></label>`)}</div></label>
    ${fieldsHtml(LEAD_DEFS(), lead)}
    <label class="check" style="margin-top:.6rem"><input type="checkbox" name="lost" ${lead.lost ? 'checked' : ''}><span>${t('Mark as lost')}</span></label>
    <div class="row" style="margin-top:1rem"><button class="btn btn-primary" type="submit">${t('Save')}</button>${lead.customer_id ? html`<button type="button" class="btn btn-ghost" data-act="ad-newbooking" data-cid="${lead.customer_id}" data-sid="${lead.service_id || ''}">${icon('calendar')} ${t('Create booking')}</button><button type="button" class="btn btn-ghost" data-act="ad-newinvoice" data-cid="${lead.customer_id}">${icon('file')} ${t('Create invoice')}</button>` : ''}
    ${lead.phone ? html`<a class="btn btn-ghost" href="${waLink('').replace(/\/\d+/, '/' + lead.phone.replace(/\D/g, '').replace(/^(\d{10})$/, '1$1'))}" target="_blank" rel="noopener" data-keep>${icon('whatsapp')}</a>` : ''}<button type="button" class="btn btn-ghost" data-act="lead-del" data-id="${lead.id}" style="color:var(--bad);margin-left:auto">${icon('trash')}</button></div></form>`, { title: lead.name, size: 'wide' });
});
document.addEventListener('change', (e) => { if (e.target.name === 'stage') e.target.closest('.optgrid')?.querySelectorAll('.opt').forEach((o) => o.classList.toggle('on', o.contains(e.target))); });
form('lead-save', async (d) => {
  const body = readFields(LEAD_DEFS(), d); body.stage = d.stage; body.lost = !!d.lost;
  if (d.id) await put(`/api/admin/leads/${d.id}`, body); else await post('/api/admin/leads', body);
  closeAllModals(); toast(t('Saved'), 'ok'); reload();
});
act('lead-del', async (el) => { if (!(await confirmDialog(t('Delete this lead?'), { ok: t('Delete'), danger: true }))) return; await del(`/api/admin/leads/${el.dataset.id}`); closeAllModals(); reload(); });

// ================================================================ CUSTOMERS
async function customers() {
  const r = await api(`/api/admin/customers?${new URLSearchParams({ q: A.q.cust, segment: A.q.seg })}`); A.d.customers = r.items;
  A.view = () => html`<div class="pg-h"><h2>${t('Customers')}</h2><div class="row"><button class="btn btn-primary btn-sm" data-act="cust-new">${icon('plus')} ${t('Add customer')}</button><a class="btn btn-ghost btn-sm" href="${csvHref('customers')}" data-keep>${icon('download')} CSV</a></div></div>
    <div class="toolbar"><input type="search" id="cust-q" value="${A.q.cust}" placeholder="${t('Search name, email, phone…')}"><select id="cust-seg"><option value="">${t('All segments')}</option>${['VIP', 'Active', 'New', 'At risk', 'Inactive', 'Prospect'].map((s) => html`<option value="${s}" ${A.q.seg === s ? 'selected' : ''}>${t(s)}</option>`)}</select><span class="muted tiny">${t('{n} customers', { n: A.d.customers.length })}</span></div>
    ${table([{ h: t('Customer'), c: (r) => html`<b>${r.name}</b>${r.company ? html`<br><small class="muted">${r.company}</small>` : ''}` }, { h: t('Contact'), c: (r) => html`${r.email || ''}<br><small class="muted">${r.phone || ''}</small>` }, { h: t('Segment'), c: (r) => segBadge(r.segment) }, { h: t('Jobs'), c: (r) => r.bookings, cls: 'right' }, { h: t('Lifetime value'), c: (r) => money(r.ltv_cents), cls: 'right' }, { h: t('Balance'), c: (r) => (r.balance_cents ? html`<b style="color:var(--bad)">${money(r.balance_cents)}</b>` : '—'), cls: 'right' }, { h: t('Points'), c: (r) => r.loyalty_points, cls: 'right' }], A.d.customers, { rowAct: 'cust-open' })}`;
}
document.addEventListener('input', debounce((e) => { if (e.target.id === 'cust-q') { A.q.cust = e.target.value; reload().then(() => { const i = $('#cust-q'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }); } }, 350));
document.addEventListener('change', (e) => { if (e.target.id === 'cust-seg') { A.q.seg = e.target.value; reload(); } });
const CUST_DEFS = () => [
  { k: 'name', l: t('Full name'), t: 'text', req: 1 }, { k: 'company', l: t('Company'), t: 'text' }, { k: 'email', l: t('Email'), t: 'email' }, { k: 'phone', l: t('Phone'), t: 'tel' }, { k: 'tags', l: t('Tags'), t: 'text', ph: 'vip, hoa, referral' },
  { k: 'lang', l: t('Language'), t: 'select', opts: [['en', 'English'], ['es', 'Español']] }, { k: 'notes', l: t('Notes'), t: 'area', full: 1 },
];
act('cust-new', () => openModal(html`<form data-form="cust-save" novalidate>${fieldsHtml(CUST_DEFS().filter((d) => d.k !== 'notes'), { lang: S.lang })}<button class="btn btn-primary btn-block" type="submit" style="margin-top:1rem">${t('Add customer')}</button></form>`, { title: t('Add customer') }));
act('cust-open', async (el) => {
  const m = openModal(html`<div class="skel" style="height:240px"></div>`, { title: t('Customer'), size: 'wide' });
  const r = await api(`/api/admin/customers/${el.dataset.id}`); const c = r.customer;
  m.set(html`<div class="row between"><div><h3 style="font-size:1.3rem">${c.name}</h3><div class="muted">${c.company || ''}</div></div>${segBadge(c.segment)}</div>
    <div class="row" style="margin:.6rem 0">${c.phone ? html`<a class="btn btn-ghost btn-sm" href="${phoneHref(c.phone)}" data-keep>${icon('phone')} ${c.phone}</a>` : ''}${c.email ? html`<a class="btn btn-ghost btn-sm" href="mailto:${c.email}" data-keep>${icon('mail')} ${c.email}</a>` : ''}
      <button class="btn btn-ghost btn-sm" data-act="cust-edit" data-id="${c.id}">${icon('edit')} ${t('Edit')}</button><button class="btn btn-ghost btn-sm" data-act="msg-thread" data-id="${c.id}">${icon('message')} ${t('Message')}</button></div>
    <div class="kpis"><div class="kpi"><small>${t('Lifetime value')}</small><b>${money(r.stats.ltv_cents)}</b></div><div class="kpi"><small>${t('Jobs')}</small><b>${r.bookings.length}</b></div><div class="kpi"><small>${t('Points')}</small><b>${c.loyalty_points}</b></div><div class="kpi"><small>${t('Account')}</small><b style="font-size:1rem">${c.has_account ? t('Registered') : t('Guest')}</b></div></div>
    <div class="row" style="margin-bottom:1rem"><button class="btn btn-primary btn-sm" data-act="ad-newbooking" data-cid="${c.id}">${icon('plus')} ${t('New booking')}</button><button class="btn btn-ghost btn-sm" data-act="ad-newinvoice" data-cid="${c.id}">${icon('plus')} ${t('New invoice')}</button></div>
    <h4>${t('Bookings')}</h4>${r.bookings.length ? html`<div class="list">${r.bookings.slice(0, 8).map((b) => html`<div class="li click" data-act="bk-open" data-id="${b.id}"><div class="t"><b>${nm(b)}</b><small>${fmtDate(b.date)} · ${money(b.total_cents)}</small></div>${bookingBadge(b.status)}</div>`)}</div>` : html`<div class="muted">—</div>`}
    <h4 style="margin-top:1rem">${t('Invoices')}</h4>${r.invoices.length ? html`<div class="list">${r.invoices.slice(0, 8).map((i) => html`<div class="li click" data-act="inv-open" data-id="${i.id}"><div class="t"><b>${i.number}</b><small>${fmtDate(i.issue_date)} · ${money(i.total_cents)}</small></div>${invBadge(i.status)}</div>`)}</div>` : html`<div class="muted">—</div>`}
    <h4 style="margin-top:1rem">${t('Notes')}</h4>${c.notes ? html`<p class="muted">${c.notes}</p>` : ''}${r.notes.map((n) => html`<div class="li"><div class="t"><b>${n.note}</b><small>${n.author || ''} · ${fmtDateTime(n.created_at)}</small></div></div>`)}
    <form class="row" data-form="cust-note" style="flex-wrap:nowrap;margin-top:.5rem" novalidate><input type="hidden" name="id" value="${c.id}"><input type="text" name="note" placeholder="${t('Add an internal note…')}" style="flex:1"><button class="btn btn-navy" type="submit">${t('Add')}</button></form>`);
});
act('cust-edit', async (el) => {
  const r = await api(`/api/admin/customers/${el.dataset.id}`); const c = r.customer;
  openModal(html`<form data-form="cust-save" novalidate><input type="hidden" name="id" value="${c.id}">${fieldsHtml(CUST_DEFS(), c)}
    <label class="check" style="margin-top:.6rem"><input type="checkbox" name="marketing_opt_in" ${c.marketing_opt_in ? 'checked' : ''}><span>${t('Email marketing opt-in')}</span></label><label class="check"><input type="checkbox" name="whatsapp_opt_in" ${c.whatsapp_opt_in ? 'checked' : ''}><span>${t('WhatsApp opt-in')}</span></label>
    <div class="form-grid" style="padding:0;margin-top:.6rem"><label class="field"><span>${t('Adjust loyalty points (+/−)')}</span><input type="number" name="points_adjust" value="0"></label><label class="field"><span>${t('Reason')}</span><input type="text" name="points_reason"></label></div>
    <div class="row" style="margin-top:1rem"><button class="btn btn-primary" type="submit">${t('Save')}</button><button type="button" class="btn btn-ghost" data-act="cust-del" data-id="${c.id}" style="color:var(--bad);margin-left:auto">${t('Archive customer')}</button></div></form>`, { title: t('Edit customer') });
});
form('cust-save', async (d) => {
  const body = { ...readFields(CUST_DEFS(), d), marketing_opt_in: !!d.marketing_opt_in, whatsapp_opt_in: !!d.whatsapp_opt_in, points_adjust: Number(d.points_adjust) || 0, points_reason: d.points_reason };
  if (d.id) await put(`/api/admin/customers/${d.id}`, body); else await post('/api/admin/customers', body);
  closeAllModals(); toast(t('Saved'), 'ok'); reload();
});
form('cust-note', async (d) => { await post(`/api/admin/customers/${d.id}/notes`, { note: d.note }); closeAllModals(); $('[data-act=cust-open]'); toast(t('Note added'), 'ok'); });
act('cust-del', async (el) => { if (!(await confirmDialog(t('Archive this customer? Their history is kept.'), { ok: t('Archive'), danger: true }))) return; await del(`/api/admin/customers/${el.dataset.id}`); closeAllModals(); reload(); });

// ================================================================ BOOKINGS
async function bookings() {
  const q = new URLSearchParams(); if (A.q.bstat) q.set('status', A.q.bstat); if (A.q.bq) q.set('q', A.q.bq);
  const [r, ch] = await Promise.all([api(`/api/admin/bookings?${q}`), api('/api/admin/booking-changes?status=pending')]);
  A.d.bookings = r.items; A.d.changes = ch.items;
  A.view = () => {
    const today = todayISO(); const groups = new Map(); for (const b of [...A.d.bookings].sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot))) { if (!groups.has(b.date)) groups.set(b.date, []); groups.get(b.date).push(b); }
    const order = [...groups.keys()]; const upcoming = order.filter((d) => d >= today); const past = order.filter((d) => d < today).reverse();
    const row = (b) => html`<div class="li click" data-act="bk-open" data-id="${b.id}"><div class="t"><b>${fmtTime(b.slot)} · ${nm(b)}</b><small>${b.customer_name} · ${b.address}${b.crew.length ? ' · ' + b.crew.map((c) => c.name.split(' ')[0]).join(', ') : ''}</small></div><div class="right">${bookingBadge(b.status)}<br><small>${money(b.total_cents)}</small></div></div>`;
    const day = (d) => html`<div class="panel"><h3>${fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}${d === today ? ' · ' + t('Today') : ''}</h3><div class="list">${groups.get(d).map(row)}</div></div>`;
    return html`<div class="pg-h"><h2>${t('Bookings')}</h2><div class="row"><button class="btn btn-primary btn-sm" data-act="ad-newbooking">${icon('plus')} ${t('New booking')}</button><a class="btn btn-ghost btn-sm" href="${csvHref('bookings', '2000-01-01', '2100-01-01')}" data-keep>${icon('download')} CSV</a></div></div>
      ${A.d.changes.length ? html`<div class="panel" style="border-color:var(--warn)"><h3>${t('Customer change requests')}</h3><div class="list">${A.d.changes.map((c) => html`<div class="li"><div class="t"><b>${c.customer_name} — ${c.type === 'cancel' ? t('Cancel') : t('Reschedule')} ${c.code}</b><small>${c.service_name} · ${fmtDate(c.date)} ${fmtTime(c.slot)}${c.type === 'reschedule' ? ' → ' + fmtDate(c.new_date) + ' ' + fmtTime(c.new_slot) : ''}${c.reason ? ' · “' + c.reason + '”' : ''}</small></div><div class="row"><button class="btn btn-primary btn-sm" data-act="chg-resolve" data-id="${c.id}" data-a="approve">${t('Approve')}</button><button class="btn btn-ghost btn-sm" data-act="chg-resolve" data-id="${c.id}" data-a="deny">${t('Decline')}</button></div></div>`)}</div></div>` : ''}
      <div class="toolbar"><input type="search" id="bk-q" value="${A.q.bq}" placeholder="${t('Search code, customer, address…')}"><select id="bk-stat"><option value="">${t('All statuses')}</option>${Object.keys(BOOKING_LABEL).map((s) => html`<option value="${s}" ${A.q.bstat === s ? 'selected' : ''}>${t(BOOKING_LABEL[s])}</option>`)}</select></div>
      ${order.length ? html`${upcoming.map(day)}${past.length ? html`<h3 style="margin:1.2rem 0 .6rem">${t('Past')}</h3>${past.slice(0, 20).map(day)}` : ''}` : html`<div class="empty card">${t('No bookings found.')}</div>`}`;
  };
}
document.addEventListener('input', debounce((e) => { if (e.target.id === 'bk-q') { A.q.bq = e.target.value; reload().then(() => { const i = $('#bk-q'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }); } }, 350));
document.addEventListener('change', (e) => { if (e.target.id === 'bk-stat') { A.q.bstat = e.target.value; reload(); } });
act('chg-resolve', async (el) => { await post(`/api/admin/booking-changes/${el.dataset.id}/resolve`, { action: el.dataset.a }); toast(t('Done'), 'ok'); reload(); });
const STATUS_FLOW = ['pending', 'confirmed', 'en_route', 'in_progress', 'completed', 'cancelled'];
act('bk-open', async (el) => {
  const m = openModal(html`<div class="skel" style="height:260px"></div>`, { title: t('Booking'), size: 'wide' });
  const [r, emps] = await Promise.all([api(`/api/admin/bookings/${el.dataset.id}`), api('/api/admin/employees')]); const b = r.booking; A.d.emps = emps.items.filter((e) => e.active);
  m.set(html`<form data-form="bk-save" novalidate><input type="hidden" name="id" value="${b.id}">
    <div class="row between"><div><h3>${nm(b)}</h3><span class="muted">${b.code} · ${b.customer_name}</span></div>${bookingBadge(b.status)}</div>
    <div class="sum" style="margin:.8rem 0"><div class="ln"><span>${t('When')}</span><b>${fmtDate(b.date, { weekday: 'long', month: 'long', day: 'numeric' })} · ${fmtTime(b.slot)}</b></div><div class="ln"><span>${t('Where')}</span><b style="text-align:right">${b.address}${b.city ? ', ' + b.city : ''}</b></div><div class="ln"><span>${t('Type')}</span><b>${b.segment === 'commercial' ? t('Commercial') : t('Residential')}${b.sqft ? ' · ' + b.sqft + ' sq ft' : ''}${b.rooms ? ' · ' + b.rooms + ' ' + t('rooms') : ''}</b></div>
      <div class="ln"><span>${t('Total')}</span><b>${money(b.total_cents)}</b></div>${b.inv_number ? html`<div class="ln"><span>${t('Invoice')}</span><b><button type="button" class="btn-link" data-act="inv-open" data-id="${b.invoice_id}">${b.inv_number}</button> ${invBadge(b.inv_status)}</b></div>` : ''}${b.contact_phone || b.customer_phone ? html`<div class="ln"><span>${t('Phone')}</span><b><a href="${phoneHref(b.contact_phone || b.customer_phone)}" data-keep>${b.contact_phone || b.customer_phone}</a></b></div>` : ''}</div>
    ${b.notes ? html`<div class="alert">${b.notes}</div>` : ''}${b.access_notes ? html`<div class="alert warn">${b.access_notes}</div>` : ''}
    <label class="field"><span>${t('Status')}</span><div class="optgrid">${STATUS_FLOW.map((s) => html`<label class="opt ${b.status === s ? 'on' : ''}" style="cursor:pointer"><input type="radio" name="status" value="${s}" ${b.status === s ? 'checked' : ''} hidden><b>${t(BOOKING_LABEL[s])}</b></label>`)}</div></label>
    <div class="form-grid" style="padding:0;margin-top:.8rem"><label class="field"><span>${t('Date')}</span><input type="date" name="date" value="${b.date}"></label><label class="field"><span>${t('Time')}</span><select name="slot">${S.settings.slots.map((s) => html`<option value="${s}" ${b.slot === s ? 'selected' : ''}>${fmtTime(s)}</option>`)}</select></label></div>
    <div class="field" style="margin-top:.8rem"><span>${t('Assigned crew')}</span><div class="row">${A.d.emps.length ? A.d.emps.map((e) => html`<label class="check"><input type="checkbox" name="employee_ids" data-multi value="${e.id}" ${b.crew.some((c) => c.id === e.id) ? 'checked' : ''}><span>${e.name}</span></label>`) : html`<span class="muted">${t('Add team members in the Team tab.')}</span>`}</div></div>
    <label class="field" style="margin-top:.8rem"><span>${t('Internal notes (crew can see)')}</span><textarea name="internal_notes">${b.internal_notes || ''}</textarea></label>
    ${r.photos.length ? html`<h4 style="margin-top:1rem">${t('Job photos')}</h4><div class="photo-row">${r.photos.map((p) => html`<a href="/api/files/${p.id}" target="_blank" rel="noopener" data-keep><img src="/api/files/${p.id}" alt="${p.kind}" loading="lazy"></a>`)}</div>` : ''}
    ${r.notes.length ? html`<h4 style="margin-top:1rem">${t('Crew notes')}</h4><div class="list">${r.notes.map((n) => html`<div class="li"><div class="t"><b>${n.note}</b><small>${n.author || ''} · ${fmtDateTime(n.created_at)}</small></div></div>`)}</div>` : ''}
    <button class="btn btn-primary btn-block" type="submit" style="margin-top:1rem">${t('Save changes')}</button></form>`);
});
form('bk-save', async (d) => {
  const ids = Array.isArray(d.employee_ids) ? d.employee_ids.map(Number) : [];
  await put(`/api/admin/bookings/${d.id}`, { status: d.status, date: d.date, slot: d.slot, employee_ids: ids, internal_notes: d.internal_notes });
  closeAllModals(); toast(t('Saved'), 'ok'); reload();
});
// create booking (admin)
const NB = { slots: null };
act('ad-newbooking', async (el) => {
  const cust = (await api('/api/admin/customers')).items; closeAllModals();
  openModal(html`<form data-form="bk-new" novalidate><div class="form-grid" style="padding:0">
    <label class="field full"><span>${t('Customer')}</span><select name="customer_id"><option value="">${t('— New customer —')}</option>${cust.map((c) => html`<option value="${c.id}" ${String(el.dataset.cid) === String(c.id) ? 'selected' : ''}>${c.name}${c.phone ? ' · ' + c.phone : ''}</option>`)}</select></label>
    <label class="field"><span>${t('New customer name')}</span><input type="text" name="nc_name"></label><label class="field"><span>${t('Phone')}</span><input type="tel" name="nc_phone"></label><label class="field full"><span>${t('Email')}</span><input type="email" name="nc_email"></label>
    <label class="field full"><span>${t('Service')}</span><select name="service_id">${S.cat.services.map((s) => html`<option value="${s.id}" ${String(el.dataset.sid) === String(s.id) ? 'selected' : ''}>${svcLabel(s)}</option>`)}</select></label>
    <label class="field"><span>${t('Type')}</span><select name="segment"><option value="residential">${t('Residential')}</option><option value="commercial">${t('Commercial')}</option></select></label><label class="field"><span>${t('Condition')}</span><select name="condition"><option value="standard">${t('Standard')}</option><option value="heavy">${t('Heavy')}</option></select></label>
    <label class="field"><span>${t('Square feet')}</span><input type="number" name="sqft"></label><label class="field"><span>${t('Rooms')}</span><input type="number" name="rooms"></label>
    <label class="field full"><span>${t('Address')}</span><input type="text" name="address" required></label><label class="field"><span>${t('City / Town')}</span><input type="text" name="city"></label>
    <label class="field"><span>${t('Date')}</span><input type="date" name="date" min="${todayISO()}" required></label><label class="field"><span>${t('Time')}</span><select name="slot">${S.settings.slots.map((s) => html`<option value="${s}">${fmtTime(s)}</option>`)}</select></label>
    <label class="field"><span>${t('Override price ($)')}</span><input type="number" step="0.01" name="override" placeholder="${t('auto')}"></label><label class="field full"><span>${t('Notes')}</span><textarea name="notes"></textarea></label></div>
    <button class="btn btn-primary btn-block" type="submit" style="margin-top:1rem">${t('Create booking')}</button></form>`, { title: t('New booking'), size: 'wide' });
});
form('bk-new', async (d) => {
  const body = { customer_id: d.customer_id || undefined, new_customer: d.customer_id ? undefined : { name: d.nc_name, phone: d.nc_phone, email: d.nc_email }, service_id: Number(d.service_id), segment: d.segment, condition: d.condition, sqft: d.sqft, rooms: d.rooms, address: d.address, city: d.city, date: d.date, slot: d.slot, notes: d.notes, override_total_cents: d.override ? cents(d.override) : undefined };
  const r = await post('/api/admin/bookings', body); closeAllModals(); toast(t('Booking {code} created', { code: r.code }), 'ok'); if (A.tab === 'bookings' || A.tab === 'dash') reload();
});

// ================================================================ INVOICES
async function invoices() {
  const q = new URLSearchParams(); if (A.q.istat) q.set('status', A.q.istat); if (A.q.iq) q.set('q', A.q.iq);
  const r = await api(`/api/admin/invoices?${q}`); A.d.invoices = r.items;
  A.view = () => { const from = monthStart(); const to = todayISO();
    return html`<div class="pg-h"><h2>${t('Invoices')}</h2><div class="row"><button class="btn btn-primary btn-sm" data-act="ad-newinvoice">${icon('plus')} ${t('New invoice')}</button><a class="btn btn-ghost btn-sm" href="${csvHref('invoices', '2000-01-01', '2100-01-01')}" data-keep>${icon('download')} ${t('Export CSV')}</a><a class="btn btn-ghost btn-sm" href="${csvHref('payments', '2000-01-01', '2100-01-01')}" data-keep>${icon('download')} ${t('Payments CSV')}</a></div></div>
      <div class="toolbar"><input type="search" id="inv-q" value="${A.q.iq}" placeholder="${t('Search number or customer…')}"><select id="inv-stat"><option value="">${t('All statuses')}</option>${Object.keys(INV_LABEL).map((s) => html`<option value="${s}" ${A.q.istat === s ? 'selected' : ''}>${t(INV_LABEL[s])}</option>`)}</select></div>
      ${table([{ h: t('Number'), c: (r) => html`<b>${r.number}</b>` }, { h: t('Customer'), c: (r) => r.customer_name }, { h: t('Issued'), c: (r) => fmtDate(r.issue_date) }, { h: t('Due'), c: (r) => fmtDate(r.due_date) }, { h: t('Total'), c: (r) => money(r.total_cents), cls: 'right' }, { h: t('Balance'), c: (r) => (r.balance_cents ? money(r.balance_cents) : '—'), cls: 'right' }, { h: t('Status'), c: (r) => invBadge(r.status) }], A.d.invoices, { rowAct: 'inv-open' })}`; };
}
document.addEventListener('input', debounce((e) => { if (e.target.id === 'inv-q') { A.q.iq = e.target.value; reload().then(() => { const i = $('#inv-q'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }); } }, 350));
document.addEventListener('change', (e) => { if (e.target.id === 'inv-stat') { A.q.istat = e.target.value; reload(); } });
const METHODS = [['cash', 'Cash'], ['zelle', 'Zelle'], ['ath_movil', 'ATH Móvil'], ['check', 'Check'], ['bank_transfer', 'Bank transfer'], ['card_external', 'Card (external)'], ['other', 'Other']];
act('inv-open', async (el) => {
  const modal = openModal(html`<div class="skel" style="height:260px"></div>`, { title: t('Invoice'), size: 'wide' });
  const r = await api(`/api/admin/invoices/${el.dataset.id}`); const i = r.invoice; const c = r.customer;
  modal.set(html`<div class="row between"><div><b style="font:800 1.3rem var(--head)">${i.number}</b><div class="muted">${c.name}${c.email ? ' · ' + c.email : ''}</div><div class="muted tiny">${t('Issued {a} · Due {b}', { a: fmtDate(i.issue_date), b: fmtDate(i.due_date) })}</div></div>${invBadge(i.status)}</div>
    <div class="tbl-wrap" style="margin:1rem 0"><table class="tbl"><thead><tr><th>${t('Description')}</th><th class="right">${t('Qty')}</th><th class="right">${t('Unit')}</th><th class="right">${t('Amount')}</th></tr></thead><tbody>${i.items.map((x) => html`<tr><td>${lineLabel(x.description)}</td><td class="right">${x.qty}</td><td class="right">${money(x.unit_cents)}</td><td class="right">${money(x.total_cents)}</td></tr>`)}</tbody></table></div>
    <div class="sum"><div class="ln"><span>${t('Subtotal')}</span><b>${money(i.subtotal_cents)}</b></div>${i.discount_cents ? html`<div class="ln disc"><span>${t('Discount')}</span><b>−${money(i.discount_cents)}</b></div>` : ''}${i.tax_cents ? html`<div class="ln"><span>${t('Tax')} (${i.tax_rate}%)</span><b>${money(i.tax_cents)}</b></div>` : ''}<div class="ln tot"><span>${t('Total')}</span><span>${money(i.total_cents)}</span></div><div class="ln"><span>${t('Paid')}</span><b>${money(i.paid_cents)}</b></div><div class="ln bold"><span>${t('Balance due')}</span><b>${money(i.balance_cents)}</b></div></div>
    ${i.payments.length ? html`<h4 style="margin:1rem 0 .4rem">${t('Payments')}</h4><div class="list">${i.payments.map((p) => html`<div class="li"><div class="t"><b>${money(p.amount_cents)} · ${p.method}${p.status !== 'succeeded' ? ' · ' + p.status : ''}</b><small>${fmtDateTime(p.paid_at || p.created_at)}${p.note ? ' · ' + p.note : ''}</small></div>${p.status === 'succeeded' && p.provider !== 'stripe' ? html`<button class="btn btn-ghost btn-sm" data-act="pay-void" data-id="${p.id}" data-inv="${i.id}">${t('Void')}</button>` : ''}</div>`)}</div>` : ''}
    ${!i.cancelled && i.balance_cents > 0 && !i.is_draft ? html`<form class="panel" data-form="pay-record" style="margin-top:1rem" novalidate><h4>${t('Record a payment')}</h4><input type="hidden" name="id" value="${i.id}"><div class="form-grid" style="padding:0;margin-top:.6rem"><label class="field"><span>${t('Amount ($)')}</span><input type="number" step="0.01" name="amount" value="${dollars(i.balance_cents)}" required></label><label class="field"><span>${t('Method')}</span><select name="method">${METHODS.map(([v, l]) => html`<option value="${v}">${t(l)}</option>`)}</select></label><label class="field full"><span>${t('Note')}</span><input type="text" name="note"></label></div><button class="btn btn-navy" type="submit" style="margin-top:.6rem">${t('Record payment')}</button></form>` : ''}
    <div class="row" style="margin-top:1rem"><a class="btn btn-ghost btn-sm" href="/api/invoices/${i.id}/pdf" target="_blank" rel="noopener" data-keep>${icon('download')} PDF</a>
      ${!i.cancelled ? html`<button class="btn btn-primary btn-sm" data-act="inv-send" data-id="${i.id}">${icon('mail')} ${i.is_draft || !i.sent_at ? t('Send to customer') : t('Resend')}</button>${i.paid_cents === 0 ? html`<button class="btn btn-ghost btn-sm" data-act="inv-edit" data-id="${i.id}">${icon('edit')} ${t('Edit')}</button>` : ''}<button class="btn btn-ghost btn-sm" data-act="inv-cancel" data-id="${i.id}" style="color:var(--bad)">${t('Cancel invoice')}</button>` : ''}</div>`);
});
form('pay-record', async (d) => { await post(`/api/admin/invoices/${d.id}/payments`, { amount: d.amount, method: d.method, note: d.note }); closeAllModals(); toast(t('Payment recorded'), 'ok'); reload(); });
act('pay-void', async (el) => { if (!(await confirmDialog(t('Void this payment?'), { ok: t('Void'), danger: true }))) return; await post(`/api/admin/payments/${el.dataset.id}/void`); closeAllModals(); toast(t('Payment voided')); reload(); });
act('inv-send', async (el) => { await post(`/api/admin/invoices/${el.dataset.id}/send`); toast(t('Invoice sent'), 'ok'); closeAllModals(); reload(); });
act('inv-cancel', async (el) => { if (!(await confirmDialog(t('Cancel this invoice?'), { ok: t('Cancel invoice'), danger: true }))) return; await post(`/api/admin/invoices/${el.dataset.id}/cancel`); closeAllModals(); reload(); });
// invoice create / edit
const INV = { items: [], editing: null };
const itemRow = (it, i) => html`<div class="row" style="flex-wrap:nowrap;align-items:flex-end" data-row="${i}"><label class="field grow"><span>${i === 0 ? t('Description') : ''}</span><input type="text" data-k="description" value="${it.description}" placeholder="${t('Service or product')}"></label><label class="field" style="width:70px"><span>${i === 0 ? t('Qty') : ''}</span><input type="number" data-k="qty" value="${it.qty}" step="0.01" min="0"></label><label class="field" style="width:100px"><span>${i === 0 ? t('Price ($)') : ''}</span><input type="number" data-k="price" value="${it.unit_cents === '' ? '' : dollars(it.unit_cents)}" step="0.01"></label><button type="button" class="icon-btn" data-act="inv-rmrow" data-i="${i}" aria-label="${t('Remove')}">${icon('x')}</button></div>`;
function readRows() { $$('[data-row]').forEach((r) => { const i = Number(r.dataset.row); INV.items[i] = { description: $('[data-k=description]', r).value, qty: Number($('[data-k=qty]', r).value) || 1, unit_cents: $('[data-k=price]', r).value === '' ? '' : cents($('[data-k=price]', r).value) }; }); }
function drawRows() { mount('#inv-rows', html`${INV.items.map(itemRow)}`); }
act('inv-addrow', () => { readRows(); INV.items.push({ description: '', qty: 1, unit_cents: '' }); drawRows(); });
act('inv-rmrow', (el) => { readRows(); INV.items.splice(Number(el.dataset.i), 1); if (!INV.items.length) INV.items.push({ description: '', qty: 1, unit_cents: '' }); drawRows(); });
act('ad-newinvoice', async (el) => {
  const cust = (await api('/api/admin/customers')).items; closeAllModals(); INV.items = [{ description: '', qty: 1, unit_cents: '' }]; INV.editing = null;
  openModal(html`<form data-form="inv-save" novalidate><div class="form-grid" style="padding:0">
    <label class="field full"><span>${t('Customer')} *</span><select name="customer_id">${cust.map((c) => html`<option value="${c.id}" ${String(el.dataset.cid) === String(c.id) ? 'selected' : ''}>${c.name}${c.email ? ' · ' + c.email : ''}</option>`)}</select></label></div>
    <h4 style="margin:1rem 0 .4rem">${t('Line items')}</h4><div class="stack" id="inv-rows">${INV.items.map(itemRow)}</div><button type="button" class="btn btn-ghost btn-sm" data-act="inv-addrow" style="margin-top:.6rem">${icon('plus')} ${t('Add line')}</button>
    <div class="form-grid" style="padding:0;margin-top:1rem"><label class="field"><span>${t('Discount ($)')}</span><input type="number" step="0.01" name="discount" value="0"></label><label class="field"><span>${t('Tax rate (%)')}</span><input type="number" step="0.001" name="tax_rate" value="${S.settings.tax_rate}"></label><label class="field"><span>${t('Due in (days)')}</span><input type="number" name="due_days" value="7"></label><label class="field"><span>${t('Deposit ($, optional)')}</span><input type="number" step="0.01" name="deposit" value="0"></label><label class="field full"><span>${t('Notes (shown on invoice)')}</span><textarea name="notes"></textarea></label></div>
    <div class="row" style="margin-top:1rem"><button class="btn btn-primary" type="submit" data-send="1">${t('Create & send')}</button><button class="btn btn-ghost" type="submit" data-send="0">${t('Save as draft')}</button></div></form>`, { title: t('New invoice'), size: 'wide' });
  document.querySelector('[data-form=inv-save]').addEventListener('click', (e) => { const b = e.target.closest('button[type=submit]'); if (b) INV.send = b.dataset.send === '1'; });
});
act('inv-edit', async (el) => {
  const r = await api(`/api/admin/invoices/${el.dataset.id}`); const i = r.invoice; closeAllModals(); INV.items = i.items.map((x) => ({ description: x.description, qty: x.qty, unit_cents: x.unit_cents })); INV.editing = i.id;
  openModal(html`<form data-form="inv-save" novalidate><input type="hidden" name="edit_id" value="${i.id}"><h4 style="margin-bottom:.4rem">${t('Line items')}</h4><div class="stack" id="inv-rows">${INV.items.map(itemRow)}</div><button type="button" class="btn btn-ghost btn-sm" data-act="inv-addrow" style="margin-top:.6rem">${icon('plus')} ${t('Add line')}</button>
    <div class="form-grid" style="padding:0;margin-top:1rem"><label class="field"><span>${t('Discount ($)')}</span><input type="number" step="0.01" name="discount" value="${dollars(i.discount_cents)}"></label><label class="field"><span>${t('Tax rate (%)')}</span><input type="number" step="0.001" name="tax_rate" value="${i.tax_rate}"></label><label class="field"><span>${t('Due date')}</span><input type="date" name="due_date" value="${i.due_date}"></label><label class="field full"><span>${t('Notes')}</span><textarea name="notes">${i.notes || ''}</textarea></label></div>
    <button class="btn btn-primary btn-block" type="submit" style="margin-top:1rem">${t('Save invoice')}</button></form>`, { title: `${t('Edit invoice')} ${i.number}`, size: 'wide' });
});
form('inv-save', async (d) => {
  readRows(); const items = INV.items.filter((x) => x.description.trim()).map((x) => ({ description: x.description, qty: x.qty, unit_cents: x.unit_cents === '' ? 0 : x.unit_cents }));
  if (!items.length) throw new Error(t('Add at least one line item'));
  if (d.edit_id) { await put(`/api/admin/invoices/${d.edit_id}`, { items, discount_cents: cents(d.discount), tax_rate: d.tax_rate, due_date: d.due_date, notes: d.notes }); }
  else { await post('/api/admin/invoices', { customer_id: Number(d.customer_id), items, discount_cents: cents(d.discount), tax_rate: d.tax_rate, due_days: Number(d.due_days) || 0, deposit_cents: cents(d.deposit), notes: d.notes, draft: !INV.send, send: !!INV.send }); }
  closeAllModals(); toast(t('Saved'), 'ok'); reload();
});

// ================================================================ ORDERS
async function orders() {
  const r = await api(`/api/admin/orders?status=${A.q.ostat}`); A.d.orders = r.items;
  A.view = () => html`<div class="pg-h"><h2>${t('Orders')}</h2><div class="row"><select id="ord-stat"><option value="">${t('All statuses')}</option>${Object.keys(ORDER_LABEL).map((s) => html`<option value="${s}" ${A.q.ostat === s ? 'selected' : ''}>${t(ORDER_LABEL[s])}</option>`)}</select><a class="btn btn-ghost btn-sm" href="${csvHref('orders', '2000-01-01', '2100-01-01')}" data-keep>${icon('download')} CSV</a></div></div>
    ${table([{ h: t('Order'), c: (r) => html`<b>${r.code}</b>` }, { h: t('Date'), c: (r) => fmtDate(r.created_at) }, { h: t('Customer'), c: (r) => r.customer_name }, { h: t('Items'), c: (r) => r.items, cls: 'right' }, { h: t('Fulfillment'), c: (r) => (r.fulfillment === 'ship' ? t('Shipping') : t('Pickup')) }, { h: t('Total'), c: (r) => money(r.total_cents), cls: 'right' }, { h: t('Status'), c: (r) => orderBadge(r.status) }], A.d.orders, { rowAct: 'ord-open' })}`;
}
document.addEventListener('change', (e) => { if (e.target.id === 'ord-stat') { A.q.ostat = e.target.value; reload(); } });
act('ord-open', (el) => {
  const o = A.d.orders.find((x) => x.id === Number(el.dataset.id));
  openModal(html`<form data-form="ord-save" novalidate><input type="hidden" name="id" value="${o.id}"><div class="row between"><div><h3>${o.code}</h3><span class="muted">${o.customer_name} · ${fmtDateTime(o.created_at)}</span></div>${orderBadge(o.status)}</div>
    <div class="list" style="margin:.8rem 0">${o.order_items.map((x) => html`<div class="li"><span>${x.qty} × ${x.product_name}${x.variant_name && x.variant_name !== 'Standard' ? ' — ' + x.variant_name : ''}</span><b>${money(x.unit_cents * x.qty)}</b></div>`)}</div>
    ${o.fulfillment === 'ship' ? html`<div class="alert">${icon('truck')} ${[o.ship_name, o.ship_line1, o.ship_city, o.ship_zip, o.ship_phone].filter(Boolean).join(', ')}</div>` : html`<div class="alert">${icon('pin')} ${t('Local pickup')}</div>`}${o.notes ? html`<p class="muted">${o.notes}</p>` : ''}
    <div class="form-grid" style="padding:0;margin-top:.8rem"><label class="field"><span>${t('Status')}</span><select name="status">${Object.keys(ORDER_LABEL).map((s) => html`<option value="${s}" ${o.status === s ? 'selected' : ''}>${t(ORDER_LABEL[s])}</option>`)}</select></label><label class="field"><span>${t('Carrier')}</span><input type="text" name="carrier" value="${o.carrier || ''}"></label><label class="field full"><span>${t('Tracking number')}</span><input type="text" name="tracking_number" value="${o.tracking_number || ''}"></label></div>
    <div class="row between" style="margin-top:1rem"><b>${t('Total')} ${money(o.total_cents)} ${o.inv_status ? invBadge(o.inv_status) : ''}</b><button class="btn btn-primary" type="submit">${t('Save')}</button></div></form>`, { title: t('Order'), size: 'wide' });
});
form('ord-save', async (d) => { await put(`/api/admin/orders/${d.id}`, { status: d.status, carrier: d.carrier, tracking_number: d.tracking_number }); closeAllModals(); toast(t('Saved'), 'ok'); reload(); });

const LOAD = { dash, pipeline, customers, bookings, invoices, orders, ...LOAD2 };
