'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('../lib/config');
const { get, all, run, insert, tx, settings, saveSettings, audit } = require('../lib/db');
const U = require('../lib/util');
const { HttpError, bad, str, email, phone, int, num, oneOf, bool, nowISO, tzNow, addDays, json, csv } = U;
const auth = require('../lib/auth');
const core = require('../lib/core');
const notify = require('../lib/notify');
const pay = require('../lib/pay');
const jobs = require('../lib/jobs');

const MEDIA = path.join(cfg.dataDir, 'media');
const slugify = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'item';
const uniqueSlug = (table, base, ignoreId = 0) => { let s = base, n = 2; while (get(`SELECT 1 x FROM ${table} WHERE slug=? AND id!=?`, s, ignoreId)) s = `${base}-${n++}`; return s; };
const listField = (v) => (Array.isArray(v) ? v : String(v || '').split(/\r?\n/)).map((x) => String(x).trim()).filter(Boolean).slice(0, 30);
const imgField = (v) => { v = str(v, { max: 300 }); if (v && !/^(\/|https:\/\/)/.test(v)) throw bad('Image must be an uploaded file or an https:// link'); return v || null; };

// ------------------------------------------------------------------ generic CRUD resources
// field types: s=string, t=long text, i=int, c=cents, b=bool, l=json list, e=enum [..], d=date
const RES = {
  categories: { table: 'categories', order: 'sort,id', slug: true, fields: { name: 's!', description: 't', name_es: 's', description_es: 't', image: 'img', sort: 'i', active: 'b' } },
  services: { table: 'services', order: 'sort,id', slug: true, fields: { category_id: 'i!', name: 's!', description: 't', name_es: 's', description_es: 't', image: 'img', pricing_type: ['sqft', 'room', 'flat', 'quote'], base_cents: 'c', unit_cents: 'c', min_cents: 'c', segments: ['both', 'residential', 'commercial'], duration_min: 'i', details: 'l', details_es: 'l', recommend: 'l', recurring_ok: 'b', active: 'b', sort: 'i' } },
  addons: { table: 'addons', order: 'category_id,sort,id', fields: { category_id: 'i?', service_id: 'i?', name: 's!', name_es: 's', price_cents: 'c', active: 'b', sort: 'i' } },
  plans: { table: 'membership_plans', order: 'sort,id', fields: { name: 's!', price_cents: 'c', discount_pct: 'i', perks: 'l', perks_es: 'l', highlight: 'b', active: 'b', sort: 'i' } },
  coupons: { table: 'coupons', order: 'id DESC', fields: { code: 'code!', description: 's', type: ['percent', 'fixed'], value: 'i', min_cents: 'c', applies_to: ['all', 'services', 'products'], starts_on: 'd?', ends_on: 'd?', max_uses: 'i?', active: 'b' } },
  gallery: { table: 'gallery', order: 'sort,id', fields: { title: 's!', title_es: 's', before_img: 'img!', after_img: 'img!', caption: 's', caption_es: 's', is_sample: 'b', active: 'b', sort: 'i' } },
  expenses: { table: 'expenses', order: 'date DESC,id DESC', fields: { date: 'd!', category: 's!', vendor: 's', description: 's', amount_cents: 'c!' } },
};

function clean(def, body, partial) {
  const out = {};
  for (const [k, spec] of Object.entries(def.fields)) {
    if (partial && !(k in body)) continue;
    const v = body[k];
    if (Array.isArray(spec)) { out[k] = oneOf(v ?? spec[0], spec, k); continue; }
    const required = spec.endsWith('!'), nullable = spec.endsWith('?');
    const t = spec.replace(/[!?]$/, '');
    if ((v === undefined || v === null || v === '') && !required) { out[k] = t === 'b' ? 0 : t === 'i' || t === 'c' ? (nullable ? null : 0) : t === 'l' ? '[]' : null; if (t === 's' || t === 't') out[k] = ''; if (t === 'd') out[k] = null; continue; }
    switch (t) {
      case 's': out[k] = str(v, { max: 200, required, label: k }); break;
      case 'code': out[k] = str(v, { max: 40, required: true, label: k }).toUpperCase().replace(/\s+/g, ''); break;
      case 't': out[k] = str(v, { max: 2000, required, label: k }); break;
      case 'img': out[k] = imgField(v); if (required && !out[k]) throw bad(`${k} is required`); break;
      case 'i': out[k] = int(v, { min: -1_000_000_000, max: 1_000_000_000, label: k }); break;
      case 'c': out[k] = int(v, { min: 0, max: 1_000_000_000, label: k }); break;
      case 'b': out[k] = bool(v); break;
      case 'l': out[k] = JSON.stringify(listField(v)); break;
      case 'd': out[k] = U.date(v, k); break;
      default: throw new Error('bad spec');
    }
    if (required && (out[k] === '' || out[k] === null)) throw bad(`${k} is required`);
  }
  return out;
}

function mountResource(app, name, def) {
  const listSql = `SELECT * FROM ${def.table} ORDER BY ${def.order}`;
  app.get(`/api/admin/r/${name}`, (c) => { auth.need(c.user, 'admin'); c.res.json({ items: all(listSql) }); });
  app.post(`/api/admin/r/${name}`, (c) => {
    auth.need(c.user, 'admin');
    const d = clean(def, c.body, false);
    if (def.slug) d.slug = uniqueSlug(def.table, slugify(c.body.slug || d.name));
    const keys = Object.keys(d);
    try {
      const id = insert(`INSERT INTO ${def.table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, ...keys.map((k) => d[k]));
      audit(c.user.id, `${name}.create`, id);
      c.res.json({ id });
    } catch (e) { if (/UNIQUE/i.test(e.message)) throw bad('That value already exists'); if (/FOREIGN KEY/i.test(e.message)) throw bad('Invalid reference'); throw e; }
  });
  app.put(`/api/admin/r/${name}/:id`, (c) => {
    auth.need(c.user, 'admin');
    const id = Number(c.params.id);
    if (!get(`SELECT 1 x FROM ${def.table} WHERE id=?`, id)) throw new HttpError(404, 'Not found');
    const d = clean(def, c.body, true);
    const keys = Object.keys(d);
    if (!keys.length) return c.res.json({ ok: true });
    try { run(`UPDATE ${def.table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...keys.map((k) => d[k]), id); } catch (e) { if (/UNIQUE/i.test(e.message)) throw bad('That value already exists'); throw e; }
    audit(c.user.id, `${name}.update`, id);
    c.res.json({ ok: true });
  });
  app.del(`/api/admin/r/${name}/:id`, (c) => {
    auth.need(c.user, 'admin');
    try { run(`DELETE FROM ${def.table} WHERE id=?`, Number(c.params.id)); } catch (e) { if (/FOREIGN KEY/i.test(e.message)) throw new HttpError(409, 'This item is in use. Deactivate it instead of deleting.'); throw e; }
    audit(c.user.id, `${name}.delete`, c.params.id);
    c.res.json({ ok: true });
  });
}

// ------------------------------------------------------------------ helpers
function recalcInvoice(id) {
  const inv = get('SELECT * FROM invoices WHERE id=?', id);
  const sub = get('SELECT COALESCE(SUM(total_cents),0) v FROM invoice_items WHERE invoice_id=?', id).v;
  const disc = Math.min(inv.discount_cents, sub);
  const tax = Math.round(((sub - disc) * inv.tax_rate) / 100);
  run('UPDATE invoices SET subtotal_cents=?, discount_cents=?, tax_cents=?, total_cents=? WHERE id=?', sub, disc, tax, sub - disc + tax, id);
  return core.refreshInvoice(id);
}
function parseItems(items) {
  if (!Array.isArray(items) || !items.length) throw bad('Add at least one line item');
  return items.slice(0, 60).map((it) => ({
    kind: ['service', 'product', 'shipping', 'membership', 'other'].includes(it.kind) ? it.kind : 'service',
    description: str(it.description, { required: true, label: 'Description', max: 300 }),
    qty: num(it.qty ?? 1, { min: 0.01, max: 100000, label: 'Quantity' }), unit_cents: int(Math.round(Number(it.unit_cents)), { min: -100_000_000, max: 100_000_000, label: 'Unit price' }),
  }));
}
const rangeOf = (q) => {
  const S = settings(); const today = tzNow(S.timezone).date;
  return { from: q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? q.from : today.slice(0, 8) + '01', to: q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to) ? q.to : today };
};
const sendCsv = (c, name, rows, cols) => c.res.send('﻿' + csv(rows, cols), 'text/csv; charset=utf-8', 200, { 'Content-Disposition': `attachment; filename="${name}-${tzNow(settings().timezone).date}.csv"`, 'Cache-Control': 'no-store' });
const m$ = (c) => (c / 100).toFixed(2);

function customersWithStats(where = '', ...params) {
  const rows = all(`SELECT c.*, (SELECT COALESCE(SUM(amount_cents),0) FROM payments p WHERE p.customer_id=c.id AND p.status='succeeded') ltv_cents,
    (SELECT COUNT(*) FROM bookings b WHERE b.customer_id=c.id) bookings, (SELECT MAX(date) FROM bookings b WHERE b.customer_id=c.id AND b.status='completed') last_completed,
    (SELECT COUNT(*) FROM orders o WHERE o.customer_id=c.id AND o.status NOT IN ('pending_payment','cancelled')) orders,
    (SELECT COALESCE(SUM(total_cents-paid_cents),0) FROM invoices i WHERE i.customer_id=c.id AND i.cancelled=0 AND i.is_draft=0) balance_cents
    FROM customers c WHERE c.archived=0 ${where} ORDER BY c.id DESC LIMIT 1000`, ...params);
  return rows.map((r) => ({ ...r, balance_cents: Math.max(0, r.balance_cents), segment: core.segmentOf(r, { ltv_cents: r.ltv_cents, last_completed: r.last_completed, bookings: r.bookings, orders: r.orders }) }));
}

module.exports = function (app) {
  for (const [name, def] of Object.entries(RES)) mountResource(app, name, def);
  const A = (c) => auth.need(c.user, 'admin');

  // ================================================================ overview
  app.get('/api/admin/overview', (c) => {
    A(c);
    const S = settings(); const today = tzNow(S.timezone).date; const month = today.slice(0, 7);
    const rev = (like) => get(`SELECT COALESCE(SUM(amount_cents),0) v FROM payments WHERE status='succeeded' AND paid_at LIKE ?`, like + '%').v;
    const series = [];
    for (let i = 5; i >= 0; i--) { const d = new Date(`${month}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - i); const k = d.toISOString().slice(0, 7); series.push({ month: k, revenue_cents: rev(k), expenses_cents: get(`SELECT COALESCE(SUM(amount_cents),0) v FROM expenses WHERE date LIKE ?`, k + '%').v }); }
    const stages = Object.fromEntries(core.STAGES.map((s) => [s, 0]));
    for (const r of all('SELECT stage, COUNT(*) n FROM leads WHERE lost=0 GROUP BY stage')) stages[r.stage] = r.n;
    c.res.json({
      today, revenue_total_cents: get(`SELECT COALESCE(SUM(amount_cents),0) v FROM payments WHERE status='succeeded'`).v, revenue_month_cents: rev(month),
      pending_cents: get(`SELECT COALESCE(SUM(total_cents-paid_cents),0) v FROM invoices WHERE cancelled=0 AND is_draft=0 AND status!='paid'`).v,
      overdue_count: get(`SELECT COUNT(*) n FROM invoices WHERE status='overdue'`).n,
      completed_services: get(`SELECT COUNT(*) n FROM bookings WHERE status='completed'`).n,
      upcoming_count: get(`SELECT COUNT(*) n FROM bookings WHERE date>=? AND status IN ('pending','confirmed')`, today).n,
      new_leads: get(`SELECT COUNT(*) n FROM leads WHERE stage='New Lead' AND lost=0`).n,
      active_customers: get(`SELECT COUNT(DISTINCT customer_id) n FROM (SELECT customer_id FROM bookings WHERE date>=? AND status!='cancelled' UNION SELECT customer_id FROM payments WHERE status='succeeded' AND paid_at>=?)`, addDays(today, -90), addDays(today, -90)).n,
      products_sold: get(`SELECT COALESCE(SUM(oi.qty),0) v FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status NOT IN ('pending_payment','cancelled')`).v,
      expenses_month_cents: get(`SELECT COALESCE(SUM(amount_cents),0) v FROM expenses WHERE date LIKE ?`, month + '%').v,
      series, stages,
      upcoming: all(`SELECT b.id,b.code,b.date,b.slot,b.status,b.address,s.name service_name,s.name_es service_name_es,c.name customer_name FROM bookings b JOIN services s ON s.id=b.service_id JOIN customers c ON c.id=b.customer_id WHERE b.date>=? AND b.status IN ('pending','confirmed') ORDER BY b.date,b.slot LIMIT 8`, today),
      followups: all(`SELECT id,name,stage,next_followup FROM leads WHERE lost=0 AND next_followup IS NOT NULL AND next_followup<=? AND stage NOT IN ('Completed','Paid') ORDER BY next_followup LIMIT 8`, today),
      low_stock: all(`SELECT p.name,v.name vname,v.stock FROM variants v JOIN products p ON p.id=v.product_id WHERE v.active=1 AND p.is_bundle=0 AND v.stock<=5 ORDER BY v.stock LIMIT 8`),
      pending_changes: get(`SELECT COUNT(*) n FROM booking_changes WHERE status='pending'`).n,
      unread_messages: get(`SELECT COUNT(*) n FROM messages WHERE sender_role='customer' AND read_by_admin=0`).n,
      top_services: all(`SELECT s.name,s.name_es,COUNT(*) n,COALESCE(SUM(b.total_cents),0) cents FROM bookings b JOIN services s ON s.id=b.service_id WHERE b.status!='cancelled' GROUP BY s.id ORDER BY cents DESC LIMIT 5`),
    });
  });

  // ================================================================ customers
  app.get('/api/admin/customers', (c) => {
    A(c);
    const q = `%${String(c.query.q || '').trim()}%`;
    let rows = customersWithStats(c.query.q ? 'AND (c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ? OR c.company LIKE ?)' : '', ...(c.query.q ? [q, q, q, q] : []));
    if (c.query.segment) rows = rows.filter((r) => r.segment === c.query.segment);
    c.res.json({ items: rows.map(({ notes, ...r }) => r) });
  });
  app.post('/api/admin/customers', (c) => {
    A(c);
    const b = c.body;
    const name = str(b.name, { required: true, min: 2, max: 120, label: 'Name' }); const em = email(b.email, false); const ph = phone(b.phone, false);
    if (!em && !ph) throw bad('Add an email or a phone number');
    if (em && get('SELECT 1 x FROM customers WHERE email=?', em)) throw bad('A customer with that email already exists');
    const id = insert('INSERT INTO customers(name,email,phone,company,notes,tags,referral_code,source,lang,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', name, em || null, ph || null, str(b.company, { max: 120 }) || null, str(b.notes, { max: 2000 }) || null, str(b.tags, { max: 200 }), core.newReferralCode(name), 'admin', b.lang === 'es' ? 'es' : 'en', nowISO());
    audit(c.user.id, 'customer.create', id);
    c.res.json({ id });
  });
  app.get('/api/admin/customers/:id', (c) => {
    A(c);
    const id = Number(c.params.id);
    const cust = get('SELECT * FROM customers WHERE id=?', id);
    if (!cust) throw new HttpError(404, 'Not found');
    const stats = core.customerStats(id);
    c.res.json({
      customer: { ...cust, segment: core.segmentOf(cust, stats), has_account: !!cust.user_id }, stats,
      bookings: all(`SELECT b.id,b.code,b.date,b.slot,b.status,b.total_cents,b.address,s.name service_name,s.name_es service_name_es FROM bookings b JOIN services s ON s.id=b.service_id WHERE b.customer_id=? ORDER BY b.date DESC`, id),
      invoices: all('SELECT id,number,status,issue_date,due_date,total_cents,paid_cents FROM invoices WHERE customer_id=? ORDER BY id DESC', id),
      orders: all('SELECT id,code,status,total_cents,created_at FROM orders WHERE customer_id=? ORDER BY id DESC', id),
      notes: all('SELECT n.id,n.note,n.created_at,u.name author FROM customer_notes n LEFT JOIN users u ON u.id=n.user_id WHERE n.customer_id=? ORDER BY n.id DESC', id),
      leads: all('SELECT id,stage,created_at,quote_cents FROM leads WHERE customer_id=? ORDER BY id DESC', id),
      ledger: all('SELECT points,reason,created_at FROM loyalty_ledger WHERE customer_id=? ORDER BY id DESC LIMIT 20', id),
      addresses: all('SELECT * FROM addresses WHERE customer_id=?', id),
    });
  });
  app.put('/api/admin/customers/:id', (c) => {
    A(c);
    const id = Number(c.params.id); const cust = get('SELECT * FROM customers WHERE id=?', id);
    if (!cust) throw new HttpError(404, 'Not found');
    const b = c.body;
    run('UPDATE customers SET name=?,email=?,phone=?,company=?,tags=?,notes=?,marketing_opt_in=?,whatsapp_opt_in=?,lang=? WHERE id=?',
      str(b.name ?? cust.name, { required: true, max: 120, label: 'Name' }), email(b.email ?? cust.email, false) || null, phone(b.phone ?? cust.phone, false) || null, str(b.company ?? cust.company, { max: 120 }) || null,
      str(b.tags ?? cust.tags, { max: 200 }), str(b.notes ?? cust.notes, { max: 2000 }) || null, b.marketing_opt_in === undefined ? cust.marketing_opt_in : bool(b.marketing_opt_in), b.whatsapp_opt_in === undefined ? cust.whatsapp_opt_in : bool(b.whatsapp_opt_in), b.lang === 'es' ? 'es' : b.lang === 'en' ? 'en' : cust.lang, id);
    if (b.points_adjust) core.addPoints(id, int(b.points_adjust, { min: -100000, max: 100000, label: 'Points' }), str(b.points_reason, { max: 100 }) || 'Manual adjustment', null);
    audit(c.user.id, 'customer.update', id);
    c.res.json({ ok: true });
  });
  app.post('/api/admin/customers/:id/notes', (c) => {
    A(c); const id = Number(c.params.id);
    if (!get('SELECT 1 x FROM customers WHERE id=?', id)) throw new HttpError(404, 'Not found');
    insert('INSERT INTO customer_notes(customer_id,user_id,note,created_at) VALUES(?,?,?,?)', id, c.user.id, str(c.body.note, { required: true, label: 'Note', max: 2000 }), nowISO());
    c.res.json({ ok: true });
  });
  app.del('/api/admin/customers/:id', (c) => { A(c); run('UPDATE customers SET archived=1 WHERE id=?', Number(c.params.id)); audit(c.user.id, 'customer.archive', c.params.id); c.res.json({ ok: true }); });

  // ================================================================ leads / CRM pipeline
  const leadRows = () => all(`SELECT l.*, s.name service_name, s.name_es service_name_es, c.name customer_name FROM leads l LEFT JOIN services s ON s.id=l.service_id LEFT JOIN customers c ON c.id=l.customer_id ORDER BY l.updated_at DESC LIMIT 1000`);
  app.get('/api/admin/leads', (c) => { A(c); c.res.json({ stages: core.STAGES, items: leadRows() }); });
  app.post('/api/admin/leads', (c) => {
    A(c); const b = c.body;
    const name = str(b.name, { required: true, label: 'Name', max: 120 }); const em = email(b.email, false), ph = phone(b.phone, false);
    if (!em && !ph) throw bad('Add an email or a phone number');
    const cust = core.findOrCreateCustomer({ name, email: em, phone: ph, source: 'admin', lang: b.lang });
    const now = nowISO();
    const id = insert(`INSERT INTO leads(customer_id,name,email,phone,source,service_id,segment,message,address,stage,quote_cents,next_followup,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      cust.id, name, em || null, ph || null, str(b.source, { max: 60 }) || 'manual', b.service_id ? int(b.service_id) : null, b.segment || null, str(b.message, { max: 2000 }) || null, str(b.address, { max: 250 }) || null, 'New Lead', b.quote_cents ? int(b.quote_cents, { min: 0 }) : null, b.next_followup ? U.date(b.next_followup) : null, str(b.notes, { max: 2000 }) || null, now, now);
    c.res.json({ id });
  });
  app.put('/api/admin/leads/:id', (c) => {
    A(c); const id = Number(c.params.id); const l = get('SELECT * FROM leads WHERE id=?', id);
    if (!l) throw new HttpError(404, 'Not found'); const b = c.body;
    run('UPDATE leads SET name=?,email=?,phone=?,source=?,service_id=?,message=?,address=?,notes=?,next_followup=?,quote_cents=?,lost=?,updated_at=? WHERE id=?',
      str(b.name ?? l.name, { required: true, max: 120, label: 'Name' }), email(b.email ?? l.email, false) || null, phone(b.phone ?? l.phone, false) || null, str(b.source ?? l.source, { max: 60 }) || null,
      b.service_id === undefined ? l.service_id : b.service_id ? int(b.service_id) : null, str(b.message ?? l.message, { max: 2000 }) || null, str(b.address ?? l.address, { max: 250 }) || null, str(b.notes ?? l.notes, { max: 2000 }) || null,
      b.next_followup === undefined ? l.next_followup : b.next_followup ? U.date(b.next_followup) : null, b.quote_cents === undefined ? l.quote_cents : b.quote_cents === null || b.quote_cents === '' ? null : int(b.quote_cents, { min: 0 }), b.lost === undefined ? l.lost : bool(b.lost), nowISO(), id);
    if (b.stage && b.stage !== l.stage) core.setLeadStage(id, b.stage);
    audit(c.user.id, 'lead.update', `${id}${b.stage ? ' → ' + b.stage : ''}`);
    c.res.json({ ok: true });
  });
  app.del('/api/admin/leads/:id', (c) => { A(c); run('DELETE FROM leads WHERE id=?', Number(c.params.id)); c.res.json({ ok: true }); });

  // ================================================================ bookings
  const BOOKING_SQL = `SELECT b.*, s.name service_name, s.name_es service_name_es, c.name customer_name, c.phone customer_phone, i.number inv_number, i.status inv_status, i.total_cents inv_total, i.paid_cents inv_paid
    FROM bookings b JOIN services s ON s.id=b.service_id JOIN customers c ON c.id=b.customer_id LEFT JOIN invoices i ON i.id=b.invoice_id`;
  const bookingOut = (b) => ({ ...b, addons: json(b.addons) || [], estimate: undefined, crew: all(`SELECT u.id,u.name FROM booking_assignments a JOIN users u ON u.id=a.employee_id WHERE a.booking_id=?`, b.id) });
  app.get('/api/admin/bookings', (c) => {
    A(c); const { from, to } = c.query; const w = []; const p = [];
    if (from) { w.push('b.date>=?'); p.push(from); } if (to) { w.push('b.date<=?'); p.push(to); }
    if (c.query.status) { w.push('b.status=?'); p.push(c.query.status); }
    if (c.query.q) { w.push('(b.code LIKE ? OR c.name LIKE ? OR b.address LIKE ?)'); const q = `%${c.query.q}%`; p.push(q, q, q); }
    c.res.json({ items: all(`${BOOKING_SQL} ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY b.date DESC, b.slot DESC LIMIT 500`, ...p).map(bookingOut) });
  });
  app.get('/api/admin/bookings/:id', (c) => {
    A(c); const b = get(`${BOOKING_SQL} WHERE b.id=?`, Number(c.params.id));
    if (!b) throw new HttpError(404, 'Not found');
    c.res.json({ booking: { ...bookingOut(b), estimate: json(b.estimate) }, notes: all(`SELECT n.note,n.created_at,u.name author FROM job_notes n LEFT JOIN users u ON u.id=n.user_id WHERE n.booking_id=? ORDER BY n.id`, b.id), photos: all(`SELECT id,kind FROM files WHERE booking_id=? ORDER BY id`, b.id) });
  });
  app.post('/api/admin/bookings', (c) => {
    A(c); const b = c.body;
    let customer;
    if (b.customer_id) { customer = get('SELECT * FROM customers WHERE id=?', Number(b.customer_id)); if (!customer) throw bad('Customer not found'); }
    else customer = core.findOrCreateCustomer({ name: str(b.new_customer?.name, { required: true, label: 'Name', max: 120 }), email: email(b.new_customer?.email, false), phone: phone(b.new_customer?.phone, false), source: 'admin' });
    const input = {
      service_id: int(b.service_id, { label: 'Service' }), segment: b.segment === 'commercial' ? 'commercial' : 'residential', property_type: str(b.property_type, { max: 40 }), address: str(b.address, { required: true, label: 'Address', max: 250 }),
      city: str(b.city, { max: 80 }), zip: str(b.zip, { max: 12 }), access_notes: str(b.access_notes, { max: 500 }), notes: str(b.notes, { max: 1500 }), sqft: Number(b.sqft) || 0, rooms: Number(b.rooms) || 0,
      condition: b.condition === 'heavy' ? 'heavy' : 'standard', frequency: ['weekly', 'biweekly', 'monthly'].includes(b.frequency) ? b.frequency : 'once', addon_ids: (b.addon_ids || []).map(Number),
      date: U.date(b.date), slot: str(b.slot, { required: true, max: 5, label: 'Time' }), coupon_code: str(b.coupon_code, { max: 40 }),
    };
    const override = b.override_total_cents !== undefined && b.override_total_cents !== '' && b.override_total_cents !== null ? int(b.override_total_cents, { min: 0, max: 100_000_000, label: 'Price' }) : null;
    let est; try { est = require('../lib/pricing').estimate(input, { customer }); } catch (e) { if (override === null) throw e; est = { custom_quote: true }; }
    if (est.custom_quote && override === null) throw bad('This job needs a manual price. Enter the price to continue.');
    const r = core.createBooking({ customer, input, adminCreated: true, overrideTotalCents: override });
    audit(c.user.id, 'booking.create', r.booking.code);
    c.res.json({ id: r.booking.id, code: r.booking.code, invoice_id: r.invoice_id });
  });
  app.put('/api/admin/bookings/:id', (c) => {
    A(c); const id = Number(c.params.id); const b = get('SELECT * FROM bookings WHERE id=?', id);
    if (!b) throw new HttpError(404, 'Not found'); const body = c.body;
    tx(() => {
      if (body.date && body.slot && (body.date !== b.date || body.slot !== b.slot)) core.rescheduleBooking(id, U.date(body.date), str(body.slot, { max: 5, label: 'Time' }), { force: true, byUserId: c.user.id });
      if (body.internal_notes !== undefined) run('UPDATE bookings SET internal_notes=? WHERE id=?', str(body.internal_notes, { max: 2000 }), id);
      if (body.notes !== undefined || body.address !== undefined) run('UPDATE bookings SET notes=COALESCE(?,notes), address=COALESCE(?,address) WHERE id=?', body.notes !== undefined ? str(body.notes, { max: 1500 }) : null, body.address !== undefined ? str(body.address, { required: true, max: 250, label: 'Address' }) : null, id);
      if (Array.isArray(body.employee_ids)) {
        run('DELETE FROM booking_assignments WHERE booking_id=?', id);
        for (const eid of [...new Set(body.employee_ids.map(Number))]) if (get(`SELECT 1 x FROM users WHERE id=? AND role='employee' AND active=1`, eid)) run('INSERT INTO booking_assignments(booking_id,employee_id) VALUES(?,?)', id, eid);
      }
    });
    if (body.status && body.status !== b.status) core.setBookingStatus(id, body.status, c.user.id);
    c.res.json({ ok: true });
  });
  app.get('/api/admin/booking-changes', (c) => {
    A(c);
    c.res.json({ items: all(`SELECT bc.*, b.code, b.date, b.slot, cu.name customer_name, s.name service_name FROM booking_changes bc JOIN bookings b ON b.id=bc.booking_id JOIN customers cu ON cu.id=bc.customer_id JOIN services s ON s.id=b.service_id WHERE (?='' OR bc.status=?) ORDER BY bc.id DESC LIMIT 100`, c.query.status || '', c.query.status || '') });
  });
  app.post('/api/admin/booking-changes/:id/resolve', (c) => {
    A(c);
    const ch = get('SELECT * FROM booking_changes WHERE id=?', Number(c.params.id));
    if (!ch || ch.status !== 'pending') throw bad('This request was already handled');
    const action = oneOf(c.body.action, ['approve', 'deny'], 'Action'); const note = str(c.body.note, { max: 300 });
    const b = get('SELECT * FROM bookings WHERE id=?', ch.booking_id);
    tx(() => {
      if (action === 'approve') { if (ch.type === 'cancel') core.setBookingStatus(b.id, 'cancelled', c.user.id); else core.rescheduleBooking(b.id, ch.new_date, ch.new_slot, { force: false, byUserId: c.user.id }); }
      run(`UPDATE booking_changes SET status=?, admin_note=?, resolved_at=? WHERE id=?`, action === 'approve' ? 'approved' : 'denied', note || null, nowISO(), ch.id);
    });
    const cust = get('SELECT * FROM customers WHERE id=?', ch.customer_id);
    notify.send('change_request_update', { customer: cust, vars: { name: core.firstName(cust.name), code: b.code, type: ch.type, type_es: ch.type === 'cancel' ? 'cancelación' : 'reprogramación', status: action === 'approve' ? 'approved' : 'declined', status_es: action === 'approve' ? 'aprobada' : 'rechazada', note }, dedupe: `chg:${ch.id}`, ref_type: 'booking', ref_id: b.id });
    c.res.json({ ok: true });
  });

  // ================================================================ invoices & payments
  const INV_SQL = `SELECT i.*, c.name customer_name, c.email customer_email, b.code booking_code, o.code order_code FROM invoices i JOIN customers c ON c.id=i.customer_id LEFT JOIN bookings b ON b.id=i.booking_id LEFT JOIN orders o ON o.id=i.order_id`;
  app.get('/api/admin/invoices', (c) => {
    A(c); const w = []; const p = [];
    if (c.query.status) { w.push('i.status=?'); p.push(c.query.status); }
    if (c.query.customer_id) { w.push('i.customer_id=?'); p.push(Number(c.query.customer_id)); }
    if (c.query.q) { const q = `%${c.query.q}%`; w.push('(i.number LIKE ? OR c.name LIKE ?)'); p.push(q, q); }
    if (c.query.from) { w.push('i.issue_date>=?'); p.push(c.query.from); } if (c.query.to) { w.push('i.issue_date<=?'); p.push(c.query.to); }
    const items = all(`${INV_SQL} ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY i.id DESC LIMIT 500`, ...p).map((i) => ({ ...i, balance_cents: i.cancelled ? 0 : Math.max(0, i.total_cents - i.paid_cents) }));
    c.res.json({ items });
  });
  app.get('/api/admin/invoices/:id', (c) => {
    A(c); const inv = core.invoiceDetail(Number(c.params.id));
    if (!inv) throw new HttpError(404, 'Not found');
    c.res.json({ invoice: inv, customer: get('SELECT id,name,email,phone,company FROM customers WHERE id=?', inv.customer_id) });
  });
  app.post('/api/admin/invoices', (c) => {
    A(c); const b = c.body;
    if (!get('SELECT 1 x FROM customers WHERE id=?', Number(b.customer_id))) throw bad('Choose a customer');
    const id = core.createInvoice({
      customer_id: Number(b.customer_id), items: parseItems(b.items), discount_cents: b.discount_cents ? int(b.discount_cents, { min: 0, max: 100_000_000 }) : 0,
      tax_rate: b.tax_rate === undefined || b.tax_rate === '' ? undefined : num(b.tax_rate, { min: 0, max: 30, label: 'Tax rate' }), number: b.number ? str(b.number, { max: 40 }) : undefined,
      due_date: b.due_date ? U.date(b.due_date) : undefined, due_days: b.due_days !== undefined ? int(b.due_days, { min: 0, max: 365 }) : undefined, issue_date: b.issue_date ? U.date(b.issue_date) : undefined,
      notes: str(b.notes, { max: 1500 }) || null, deposit_cents: b.deposit_cents ? int(b.deposit_cents, { min: 0 }) : 0, draft: bool(b.draft), booking_id: b.booking_id ? Number(b.booking_id) : null,
    });
    if (!bool(b.draft) && bool(b.send)) core.sendInvoice(id);
    audit(c.user.id, 'invoice.create', id);
    c.res.json({ id });
  });
  app.put('/api/admin/invoices/:id', (c) => {
    A(c); const id = Number(c.params.id); const inv = get('SELECT * FROM invoices WHERE id=?', id);
    if (!inv) throw new HttpError(404, 'Not found'); const b = c.body;
    tx(() => {
      if (b.items) {
        if (inv.paid_cents > 0) throw bad('This invoice has payments, so its line items are locked. Add a new invoice for extra charges.');
        const items = parseItems(b.items);
        run('DELETE FROM invoice_items WHERE invoice_id=?', id);
        for (const it of items) insert('INSERT INTO invoice_items(invoice_id,kind,description,qty,unit_cents,total_cents) VALUES(?,?,?,?,?,?)', id, it.kind, it.description, it.qty, it.unit_cents, Math.round(it.qty * it.unit_cents));
      }
      run('UPDATE invoices SET discount_cents=?, tax_rate=?, due_date=?, notes=?, is_draft=? WHERE id=?',
        b.discount_cents === undefined ? inv.discount_cents : int(b.discount_cents, { min: 0, max: 100_000_000 }), b.tax_rate === undefined ? inv.tax_rate : num(b.tax_rate, { min: 0, max: 30, label: 'Tax rate' }),
        b.due_date ? U.date(b.due_date) : inv.due_date, b.notes === undefined ? inv.notes : str(b.notes, { max: 1500 }) || null, b.draft === undefined ? inv.is_draft : bool(b.draft), id);
      recalcInvoice(id);
    });
    c.res.json({ ok: true });
  });
  app.post('/api/admin/invoices/:id/send', (c) => { A(c); const inv = core.sendInvoice(Number(c.params.id)); audit(c.user.id, 'invoice.send', inv.number); c.res.json({ ok: true, status: inv.status }); });
  app.post('/api/admin/invoices/:id/cancel', (c) => { A(c); core.cancelInvoice(Number(c.params.id)); audit(c.user.id, 'invoice.cancel', c.params.id); c.res.json({ ok: true }); });
  app.post('/api/admin/invoices/:id/payments', (c) => {
    A(c);
    const method = oneOf(c.body.method || 'cash', ['cash', 'check', 'zelle', 'ath_movil', 'bank_transfer', 'card_external', 'other'], 'Payment method');
    const pid = core.recordPayment({ invoice_id: Number(c.params.id), amount_cents: U.toCents(num(c.body.amount, { min: 0.01, max: 1_000_000, label: 'Amount' })), method, note: str(c.body.note, { max: 200 }), by: c.user.id });
    audit(c.user.id, 'payment.manual', `${c.params.id}:${pid}`);
    c.res.json({ id: pid, invoice: core.invoiceDetail(Number(c.params.id)) });
  });
  app.post('/api/admin/payments/:id/void', (c) => {
    A(c); const p = get('SELECT * FROM payments WHERE id=?', Number(c.params.id));
    if (!p || p.status !== 'succeeded') throw bad('Only completed payments can be voided');
    if (p.provider === 'stripe') throw bad('This was a card payment through Stripe. Issue the refund in your Stripe dashboard — it will sync here automatically.');
    run(`UPDATE payments SET status='refunded' WHERE id=?`, p.id);
    core.addPoints(p.customer_id, -Math.floor((p.amount_cents / 100) * settings().loyalty.points_per_dollar), `Payment voided`, `void:${p.id}`);
    core.refreshInvoice(p.invoice_id); audit(c.user.id, 'payment.void', p.id);
    c.res.json({ ok: true });
  });

  // ================================================================ orders
  app.get('/api/admin/orders', (c) => {
    A(c);
    const rows = all(`SELECT o.*, c.name customer_name, i.number inv_number, i.status inv_status, (SELECT SUM(qty) FROM order_items WHERE order_id=o.id) items FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN invoices i ON i.id=o.invoice_id WHERE (?='' OR o.status=?) ORDER BY o.id DESC LIMIT 500`, c.query.status || '', c.query.status || '');
    c.res.json({ items: rows.map((o) => ({ ...o, order_items: all('SELECT product_name,variant_name,qty,unit_cents FROM order_items WHERE order_id=?', o.id) })) });
  });
  app.put('/api/admin/orders/:id', (c) => {
    A(c); const o = core.setOrderStatus(Number(c.params.id), oneOf(c.body.status, core.ORDER_STATUSES, 'Status'), { tracking_number: str(c.body.tracking_number, { max: 80 }), carrier: str(c.body.carrier, { max: 40 }) });
    audit(c.user.id, 'order.status', `${o.code}: ${o.status}`); c.res.json({ ok: true });
  });

  // ================================================================ products (with variants, stock and bundle contents)
  app.get('/api/admin/products', (c) => {
    A(c);
    const items = all('SELECT * FROM products ORDER BY sort,id').map((p) => ({ ...p, variants: all('SELECT * FROM variants WHERE product_id=? ORDER BY sort,id', p.id).map((v) => ({ ...v, components: all('SELECT variant_id,qty FROM bundle_items WHERE bundle_variant_id=?', v.id), available: core.variantAvailability(v.id) })) }));
    const allVariants = all('SELECT v.id, p.name pname, v.name vname, p.is_bundle FROM variants v JOIN products p ON p.id=v.product_id ORDER BY p.name, v.sort');
    c.res.json({ items, variant_options: allVariants });
  });
  const saveProduct = (c, id) => {
    const b = c.body;
    const name = str(b.name, { required: true, label: 'Name', max: 160 });
    const vars = Array.isArray(b.variants) ? b.variants : [];
    if (!vars.length) throw bad('Add at least one variant (size / option)');
    return tx(() => {
      const fields = [name, str(b.description, { max: 2000 }), str(b.name_es, { max: 160 }) || null, str(b.description_es, { max: 2000 }) || null, str(b.category, { max: 60 }) || 'Supplies', str(b.category_es, { max: 60 }) || null, imgField(b.image), bool(b.is_bundle), bool(b.active), b.sort ? int(b.sort) : 0];
      if (!id) { id = insert('INSERT INTO products(slug,name,description,name_es,description_es,category,category_es,image,is_bundle,active,sort) VALUES(?,?,?,?,?,?,?,?,?,?,?)', uniqueSlug('products', slugify(name)), ...fields); }
      else run('UPDATE products SET name=?,description=?,name_es=?,description_es=?,category=?,category_es=?,image=?,is_bundle=?,active=?,sort=? WHERE id=?', ...fields, id);
      const keep = [];
      vars.forEach((v, i) => {
        const vals = [str(v.name, { required: true, label: 'Variant name', max: 80 }), str(v.name_es, { max: 80 }) || null, str(v.sku, { max: 40 }) || null, int(v.price_cents, { min: 0, max: 100_000_000, label: 'Price' }), v.compare_cents ? int(v.compare_cents, { min: 0 }) : null, int(v.stock ?? 0, { min: 0, max: 1_000_000, label: 'Stock' }), bool(v.active ?? 1), i];
        let vid = v.id && get('SELECT id FROM variants WHERE id=? AND product_id=?', Number(v.id), id)?.id;
        if (vid) run('UPDATE variants SET name=?,name_es=?,sku=?,price_cents=?,compare_cents=?,stock=?,active=?,sort=? WHERE id=?', ...vals, vid);
        else vid = insert('INSERT INTO variants(product_id,name,name_es,sku,price_cents,compare_cents,stock,active,sort) VALUES(?,?,?,?,?,?,?,?,?)', id, ...vals);
        keep.push(vid);
        run('DELETE FROM bundle_items WHERE bundle_variant_id=?', vid);
        if (bool(b.is_bundle)) for (const comp of v.components || []) if (Number(comp.variant_id) !== vid && get('SELECT 1 x FROM variants WHERE id=?', Number(comp.variant_id))) run('INSERT OR REPLACE INTO bundle_items(bundle_variant_id,variant_id,qty) VALUES(?,?,?)', vid, Number(comp.variant_id), Math.max(1, int(comp.qty || 1)));
      });
      for (const old of all('SELECT id FROM variants WHERE product_id=?', id)) if (!keep.includes(old.id)) { try { run('DELETE FROM variants WHERE id=?', old.id); } catch { run('UPDATE variants SET active=0 WHERE id=?', old.id); } }
      return id;
    });
  };
  app.post('/api/admin/products', (c) => { A(c); const id = saveProduct(c, 0); audit(c.user.id, 'product.create', id); c.res.json({ id }); });
  app.put('/api/admin/products/:id', (c) => { A(c); const id = Number(c.params.id); if (!get('SELECT 1 x FROM products WHERE id=?', id)) throw new HttpError(404, 'Not found'); saveProduct(c, id); audit(c.user.id, 'product.update', id); c.res.json({ ok: true }); });
  app.del('/api/admin/products/:id', (c) => {
    A(c); const id = Number(c.params.id);
    if (get('SELECT 1 x FROM order_items oi JOIN variants v ON v.id=oi.variant_id WHERE v.product_id=? LIMIT 1', id)) { run('UPDATE products SET active=0 WHERE id=?', id); return c.res.json({ ok: true, deactivated: true }); }
    run('DELETE FROM products WHERE id=?', id); c.res.json({ ok: true });
  });

  // ================================================================ employees
  const empOut = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, title: u.employee_title, active: !!u.active, last_login: u.last_login, jobs_open: get(`SELECT COUNT(*) n FROM booking_assignments a JOIN bookings b ON b.id=a.booking_id WHERE a.employee_id=? AND b.status IN ('pending','confirmed','en_route','in_progress')`, u.id).n });
  app.get('/api/admin/employees', (c) => { A(c); c.res.json({ items: all(`SELECT * FROM users WHERE role='employee' ORDER BY active DESC, name`).map(empOut) }); });
  app.post('/api/admin/employees', async (c) => {
    A(c); const b = c.body;
    const name = str(b.name, { required: true, min: 2, max: 120, label: 'Name' }), em = email(b.email);
    if (get('SELECT 1 x FROM users WHERE email=?', em)) throw bad('That email is already in use');
    auth.checkPasswordStrength(b.password);
    const id = insert('INSERT INTO users(role,name,email,phone,password_hash,employee_title,created_at) VALUES(?,?,?,?,?,?,?)', 'employee', name, em, phone(b.phone, false) || null, await auth.hashPassword(b.password), str(b.title, { max: 60 }) || 'Cleaner', nowISO());
    audit(c.user.id, 'employee.create', id); c.res.json({ id });
  });
  app.put('/api/admin/employees/:id', async (c) => {
    A(c); const id = Number(c.params.id); const u = get(`SELECT * FROM users WHERE id=? AND role='employee'`, id);
    if (!u) throw new HttpError(404, 'Not found'); const b = c.body;
    run('UPDATE users SET name=?, phone=?, employee_title=?, active=? WHERE id=?', str(b.name ?? u.name, { required: true, max: 120, label: 'Name' }), phone(b.phone ?? u.phone, false) || null, str(b.title ?? u.employee_title, { max: 60 }), b.active === undefined ? u.active : bool(b.active), id);
    if (b.password) { auth.checkPasswordStrength(b.password); run('UPDATE users SET password_hash=? WHERE id=?', await auth.hashPassword(b.password), id); auth.destroyUserSessions(id); }
    if (b.active !== undefined && !bool(b.active)) auth.destroyUserSessions(id);
    c.res.json({ ok: true });
  });

  // ================================================================ messages
  app.get('/api/admin/messages', (c) => {
    A(c);
    c.res.json({ items: all(`SELECT c.id customer_id, c.name, c.email, MAX(m.created_at) last_at, SUM(m.sender_role='customer' AND m.read_by_admin=0) unread,
      (SELECT body FROM messages x WHERE x.customer_id=c.id ORDER BY x.id DESC LIMIT 1) last_body FROM customers c JOIN messages m ON m.customer_id=c.id GROUP BY c.id ORDER BY last_at DESC LIMIT 200`) });
  });
  app.get('/api/admin/messages/:customerId', (c) => {
    A(c); const id = Number(c.params.customerId);
    run(`UPDATE messages SET read_by_admin=1 WHERE customer_id=? AND sender_role='customer'`, id);
    c.res.json({ customer: get('SELECT id,name,email,phone FROM customers WHERE id=?', id), items: all('SELECT id,sender_role,body,created_at FROM messages WHERE customer_id=? ORDER BY id', id) });
  });
  app.post('/api/admin/messages/:customerId', (c) => {
    A(c); const id = Number(c.params.customerId); const cust = get('SELECT * FROM customers WHERE id=?', id);
    if (!cust) throw new HttpError(404, 'Not found'); const body = str(c.body.body, { required: true, label: 'Message', max: 2000 });
    insert('INSERT INTO messages(customer_id,sender_role,user_id,body,created_at,read_by_admin) VALUES(?,?,?,?,?,1)', id, 'admin', c.user.id, body, nowISO());
    notify.send('support_reply', { customer: cust, vars: { name: core.firstName(cust.name), preview: body.slice(0, 200) } });
    c.res.json({ ok: true });
  });

  // ================================================================ reviews moderation
  app.get('/api/admin/reviews', (c) => { A(c); c.res.json({ items: all(`SELECT r.*, c.name customer_name FROM reviews r LEFT JOIN customers c ON c.id=r.customer_id ORDER BY r.id DESC LIMIT 300`) }); });
  app.put('/api/admin/reviews/:id', (c) => { A(c); run('UPDATE reviews SET published=COALESCE(?,published), reply=COALESCE(?,reply) WHERE id=?', c.body.published === undefined ? null : bool(c.body.published), c.body.reply === undefined ? null : str(c.body.reply, { max: 600 }), Number(c.params.id)); c.res.json({ ok: true }); });
  app.del('/api/admin/reviews/:id', (c) => { A(c); run('DELETE FROM reviews WHERE id=?', Number(c.params.id)); c.res.json({ ok: true }); });

  // ================================================================ notifications + automations
  app.get('/api/admin/notifications', (c) => {
    A(c);
    c.res.json({ items: all(`SELECT n.id,n.channel,n.template,n.to_addr,n.subject,n.status,n.error,n.created_at,n.sent_at,cu.name customer_name FROM notifications n LEFT JOIN customers cu ON cu.id=n.customer_id WHERE (?='' OR n.status=?) ORDER BY n.id DESC LIMIT 200`, c.query.status || '', c.query.status || ''), automations: jobs.TASKS,
      providers: { email: !!(cfg.email.resendKey && cfg.email.from), whatsapp: !!(cfg.whatsapp.token && cfg.whatsapp.phoneId) } });
  });
  app.post('/api/admin/notifications/:id/resend', async (c) => { A(c); run(`UPDATE notifications SET status='queued', error=NULL WHERE id=?`, Number(c.params.id)); await notify.deliver(Number(c.params.id)); c.res.json({ status: get('SELECT status,error FROM notifications WHERE id=?', Number(c.params.id)) }); });
  app.post('/api/admin/automation', (c) => {
    A(c); const job = oneOf(c.body.job, jobs.TASKS, 'Automation');
    const r = jobs.run(job); audit(c.user.id, 'automation.run', job);
    c.res.json({ ok: true, result: typeof r === 'number' ? `${r} message(s) queued` : 'Done' });
  });

  // ================================================================ reports + CSV exports
  app.get('/api/admin/reports', (c) => {
    A(c); const { from, to } = rangeOf(c.query); const f = from + 'T00:00:00', t = to + 'T23:59:59.999Z';
    const pays = all(`SELECT p.*, i.booking_id, i.order_id FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.status='succeeded' AND p.paid_at BETWEEN ? AND ?`, f, t);
    const collected = pays.filter((p) => p.amount_cents > 0).reduce((s, p) => s + p.amount_cents, 0);
    const refunds = -pays.filter((p) => p.amount_cents < 0).reduce((s, p) => s + p.amount_cents, 0);
    const byDay = {}, byMethod = {}, bySource = { services: 0, products: 0, other: 0 };
    for (const p of pays) { const d = p.paid_at.slice(0, 10); byDay[d] = (byDay[d] || 0) + p.amount_cents; byMethod[p.method] = (byMethod[p.method] || 0) + p.amount_cents; bySource[p.booking_id ? 'services' : p.order_id ? 'products' : 'other'] += p.amount_cents; }
    const expenses = all('SELECT category, SUM(amount_cents) cents FROM expenses WHERE date BETWEEN ? AND ? GROUP BY category ORDER BY cents DESC', from, to);
    const expTotal = expenses.reduce((s, e) => s + e.cents, 0);
    c.res.json({
      from, to, collected_cents: collected, refunds_cents: refunds, net_revenue_cents: collected - refunds, expenses_cents: expTotal, profit_cents: collected - refunds - expTotal,
      invoiced_cents: get(`SELECT COALESCE(SUM(total_cents),0) v FROM invoices WHERE cancelled=0 AND is_draft=0 AND issue_date BETWEEN ? AND ?`, from, to).v,
      outstanding_cents: get(`SELECT COALESCE(SUM(total_cents-paid_cents),0) v FROM invoices WHERE cancelled=0 AND is_draft=0 AND status!='paid'`).v,
      by_day: Object.entries(byDay).sort().map(([date, cents]) => ({ date, cents })), by_method: byMethod, by_source: bySource, expenses_by_category: expenses,
      top_services: all(`SELECT s.name,s.name_es,COUNT(*) jobs,SUM(b.total_cents) cents FROM bookings b JOIN services s ON s.id=b.service_id WHERE b.status='completed' AND b.date BETWEEN ? AND ? GROUP BY s.id ORDER BY cents DESC LIMIT 10`, from, to),
      products_sold: all(`SELECT oi.product_name name, oi.variant_name variant, SUM(oi.qty) qty, SUM(oi.qty*oi.unit_cents) cents FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status NOT IN ('pending_payment','cancelled') AND substr(o.created_at,1,10) BETWEEN ? AND ? GROUP BY oi.product_name, oi.variant_name ORDER BY cents DESC LIMIT 15`, from, to),
    });
  });
  app.get('/api/admin/export/:type', (c) => {
    A(c); const { from, to } = rangeOf(c.query); const type = c.params.type;
    if (type === 'invoices') return sendCsv(c, 'invoices', all(`${INV_SQL} WHERE i.issue_date BETWEEN ? AND ? ORDER BY i.id`, from, to), [{ label: 'Number', key: 'number' }, { label: 'Customer', key: 'customer_name' }, { label: 'Status', key: 'status' }, { label: 'Issue date', key: 'issue_date' }, { label: 'Due date', key: 'due_date' }, { label: 'Subtotal', get: (r) => m$(r.subtotal_cents) }, { label: 'Discount', get: (r) => m$(r.discount_cents) }, { label: 'Tax', get: (r) => m$(r.tax_cents) }, { label: 'Total', get: (r) => m$(r.total_cents) }, { label: 'Paid', get: (r) => m$(r.paid_cents) }, { label: 'Balance', get: (r) => m$(r.cancelled ? 0 : r.total_cents - r.paid_cents) }, { label: 'Booking', key: 'booking_code' }, { label: 'Order', key: 'order_code' }]);
    if (type === 'payments') return sendCsv(c, 'payments', all(`SELECT p.*, i.number, cu.name customer_name FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN customers cu ON cu.id=p.customer_id WHERE p.status='succeeded' AND substr(p.paid_at,1,10) BETWEEN ? AND ? ORDER BY p.id`, from, to), [{ label: 'Date', get: (r) => r.paid_at.slice(0, 10) }, { label: 'Invoice', key: 'number' }, { label: 'Customer', key: 'customer_name' }, { label: 'Method', key: 'method' }, { label: 'Provider', key: 'provider' }, { label: 'Amount', get: (r) => m$(r.amount_cents) }, { label: 'Note', key: 'note' }]);
    if (type === 'customers') return sendCsv(c, 'customers', customersWithStats(), [{ label: 'Name', key: 'name' }, { label: 'Email', key: 'email' }, { label: 'Phone', key: 'phone' }, { label: 'Company', key: 'company' }, { label: 'Segment', key: 'segment' }, { label: 'Tags', key: 'tags' }, { label: 'Bookings', key: 'bookings' }, { label: 'Orders', key: 'orders' }, { label: 'Lifetime value', get: (r) => m$(r.ltv_cents) }, { label: 'Balance due', get: (r) => m$(r.balance_cents) }, { label: 'Loyalty points', key: 'loyalty_points' }, { label: 'Created', get: (r) => r.created_at.slice(0, 10) }]);
    if (type === 'orders') return sendCsv(c, 'orders', all(`SELECT o.*, cu.name customer_name FROM orders o JOIN customers cu ON cu.id=o.customer_id WHERE substr(o.created_at,1,10) BETWEEN ? AND ? ORDER BY o.id`, from, to), [{ label: 'Order', key: 'code' }, { label: 'Date', get: (r) => r.created_at.slice(0, 10) }, { label: 'Customer', key: 'customer_name' }, { label: 'Status', key: 'status' }, { label: 'Fulfillment', key: 'fulfillment' }, { label: 'Subtotal', get: (r) => m$(r.subtotal_cents) }, { label: 'Shipping', get: (r) => m$(r.shipping_cents) }, { label: 'Tax', get: (r) => m$(r.tax_cents) }, { label: 'Total', get: (r) => m$(r.total_cents) }, { label: 'Tracking', key: 'tracking_number' }]);
    if (type === 'expenses') return sendCsv(c, 'expenses', all('SELECT * FROM expenses WHERE date BETWEEN ? AND ? ORDER BY date', from, to), [{ label: 'Date', key: 'date' }, { label: 'Category', key: 'category' }, { label: 'Vendor', key: 'vendor' }, { label: 'Description', key: 'description' }, { label: 'Amount', get: (r) => m$(r.amount_cents) }]);
    if (type === 'bookings') return sendCsv(c, 'bookings', all(`${BOOKING_SQL} WHERE b.date BETWEEN ? AND ? ORDER BY b.date`, from, to), [{ label: 'Code', key: 'code' }, { label: 'Date', key: 'date' }, { label: 'Time', key: 'slot' }, { label: 'Customer', key: 'customer_name' }, { label: 'Service', key: 'service_name' }, { label: 'Type', key: 'segment' }, { label: 'Address', key: 'address' }, { label: 'Status', key: 'status' }, { label: 'Total', get: (r) => m$(r.total_cents) }, { label: 'Invoice', key: 'inv_number' }, { label: 'Invoice status', key: 'inv_status' }]);
    if (type === 'leads') return sendCsv(c, 'leads', leadRows(), [{ label: 'Name', key: 'name' }, { label: 'Email', key: 'email' }, { label: 'Phone', key: 'phone' }, { label: 'Stage', key: 'stage' }, { label: 'Service', key: 'service_name' }, { label: 'Source', key: 'source' }, { label: 'Quote', get: (r) => (r.quote_cents ? m$(r.quote_cents) : '') }, { label: 'Next follow-up', key: 'next_followup' }, { label: 'Created', get: (r) => r.created_at.slice(0, 10) }]);
    throw new HttpError(404, 'Unknown export');
  });

  // ================================================================ settings + media + audit
  app.get('/api/admin/settings', (c) => {
    A(c);
    c.res.json({ settings: settings(), integrations: { payments: pay.mode(), stripe_key: !!cfg.stripe.secret, stripe_webhook: !!cfg.stripe.webhookSecret, email: !!(cfg.email.resendKey && cfg.email.from), whatsapp: !!(cfg.whatsapp.token && cfg.whatsapp.phoneId), analytics: !!cfg.gaId, maps: !!cfg.mapsKey, base_url: notify.base(), webhook_url: `${notify.base()}/api/webhooks/stripe` } });
  });
  app.put('/api/admin/settings', (c) => {
    A(c); const b = c.body; const patch = {};
    const numeric = { crews: [1, 50], lead_hours: [0, 720], max_days_ahead: [7, 365], tax_rate: [0, 30], deposit_pct: [0, 100], min_deposit_cents: [0, 1e7], commercial_multiplier: [0.5, 5], max_auto_sqft: [100, 5e6], max_auto_rooms: [1, 200], vip_cents: [0, 1e9] };
    for (const [k, [lo, hi]] of Object.entries(numeric)) if (k in b) patch[k] = num(b[k], { min: lo, max: hi, label: k });
    for (const k of ['business', 'hours', 'condition_multipliers', 'frequency_discounts', 'loyalty', 'referral', 'shipping', 'invoice', 'notifications', 'site']) if (b[k] && typeof b[k] === 'object') patch[k] = b[k];
    if (Array.isArray(b.slots)) patch.slots = b.slots.map(String).filter((s) => /^\d{2}:\d{2}$/.test(s)).sort();
    if (Array.isArray(b.blocked_dates)) patch.blocked_dates = b.blocked_dates.map(String).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
    if (patch.business) { patch.business = { ...patch.business }; if (patch.business.whatsapp) patch.business.whatsapp = String(patch.business.whatsapp).replace(/\D/g, ''); if (patch.business.email) patch.business.email = email(patch.business.email, false); }
    if (patch.shipping) for (const k of ['flat_cents', 'free_over_cents']) if (k in patch.shipping) patch.shipping[k] = int(patch.shipping[k], { min: 0, max: 1e8, label: k });
    if (patch.invoice && 'next' in patch.invoice) patch.invoice.next = int(patch.invoice.next, { min: 1, max: 1e9, label: 'Next invoice number' });
    if (patch.site) { patch.site = { ...patch.site }; if (patch.site.faqs) patch.site.faqs = patch.site.faqs.slice(0, 30).map((f) => ({ q: str(f.q, { max: 200 }), a: str(f.a, { max: 1500 }), q_es: str(f.q_es, { max: 200 }), a_es: str(f.a_es, { max: 1500 }) })).filter((f) => f.q || f.q_es); if (patch.site.promos) patch.site.promos = patch.site.promos.slice(0, 10).map((p, i) => ({ id: str(p.id, { max: 40 }) || `p${i}`, text: str(p.text, { max: 200 }), text_es: str(p.text_es, { max: 200 }), code: str(p.code, { max: 40 }).toUpperCase(), active: !!p.active })); if (patch.site.service_areas) patch.site.service_areas = listField(patch.site.service_areas); }
    saveSettings(patch); audit(c.user.id, 'settings.update', Object.keys(patch).join(','));
    c.res.json({ settings: settings() });
  });
  app.post('/api/admin/media', (c) => {
    A(c);
    const m = /^data:image\/(?:jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(c.body.data || ''));
    if (!m) throw bad('Please choose a JPG, PNG or WebP image');
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > 6 * 1024 * 1024) throw bad('Images must be under 6 MB');
    const type = core.sniffImage(buf);
    const name = `${U.uid(10)}.${type.ext}`;
    fs.mkdirSync(MEDIA, { recursive: true }); fs.writeFileSync(path.join(MEDIA, name), buf);
    c.res.json({ url: `/media/${name}` });
  }, { limit: 9_000_000 });
  app.get('/api/admin/audit', (c) => { A(c); c.res.json({ items: all(`SELECT a.*, u.name user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 150`) }); });
};
