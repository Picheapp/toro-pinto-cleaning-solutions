'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('../lib/config');
const { get, all, run, insert, settings } = require('../lib/db');
const { HttpError, bad, str, email, phone, int, num, oneOf, bool, nowISO, date: vDate, rateLimit, json } = require('../lib/util');
const auth = require('../lib/auth');
const core = require('../lib/core');
const pricing = require('../lib/pricing');
const notify = require('../lib/notify');
const pay = require('../lib/pay');
const { saveImage } = require('./public');

const UPLOAD_DIR = path.join(cfg.dataDir, 'uploads');

function me(c) {
  auth.need(c.user, 'customer');
  const customer = core.customerForUser(c.user);
  if (customer.lang !== c.lang) { run('UPDATE customers SET lang=? WHERE id=?', c.lang, customer.id); customer.lang = c.lang; }
  return customer;
}
function owned(table, id, customer) {
  const row = get(`SELECT * FROM ${table} WHERE id=?`, Number(id));
  if (!row || row.customer_id !== customer.id) throw new HttpError(404, 'Not found');
  return row;
}

function parseBookingInput(b, customer, user) {
  const sqft = b.sqft === '' || b.sqft == null ? 0 : int(b.sqft, { min: 0, max: 5_000_000, label: 'Square footage' });
  const rooms = b.rooms === '' || b.rooms == null ? 0 : int(b.rooms, { min: 0, max: 200, label: 'Rooms' });
  const photo_ids = [];
  for (const id of (Array.isArray(b.photo_ids) ? b.photo_ids : []).slice(0, 8)) {
    const f = get('SELECT id FROM files WHERE id=? AND attached=0 AND ((anon_key IS NOT NULL AND anon_key=?) OR (user_id IS NOT NULL AND user_id=?))', Number(id), String(b.anon_key || ''), user.id);
    if (f) photo_ids.push(f.id);
  }
  const slot = str(b.slot, { required: true, label: 'Time', max: 5 });
  if (!/^\d{2}:\d{2}$/.test(slot)) throw bad('Please choose a time');
  return {
    service_id: int(b.service_id, { label: 'Service' }), segment: b.segment === 'commercial' ? 'commercial' : 'residential', property_type: str(b.property_type, { max: 40 }),
    address: str(b.address, { required: true, label: 'Address', max: 250 }), city: str(b.city, { max: 80 }), zip: str(b.zip, { max: 12 }),
    access_notes: str(b.access_notes, { max: 500 }), notes: str(b.notes, { max: 1500 }), sqft, rooms,
    condition: b.condition === 'heavy' ? 'heavy' : 'standard', frequency: ['weekly', 'biweekly', 'monthly'].includes(b.frequency) ? b.frequency : 'once',
    addon_ids: (Array.isArray(b.addon_ids) ? b.addon_ids : []).slice(0, 20).map(Number), date: b.date ? vDate(b.date) : '', slot,
    contact_name: str(b.contact_name, { max: 120 }) || customer.name, contact_phone: phone(b.contact_phone, false) || customer.phone, contact_email: email(b.contact_email, false) || customer.email,
    coupon_code: str(b.coupon_code, { max: 40 }), use_points: b.use_points ? int(b.use_points, { min: 0, max: 1_000_000 }) : 0, photo_ids,
  };
}

function bookingsFor(customer) {
  const rows = all(`SELECT b.*, s.name service_name, s.name_es service_name_es, s.image service_image, i.status inv_status, i.total_cents inv_total, i.paid_cents inv_paid, i.number inv_number
    FROM bookings b JOIN services s ON s.id=b.service_id LEFT JOIN invoices i ON i.id=b.invoice_id WHERE b.customer_id=? ORDER BY b.date DESC, b.slot DESC`, customer.id);
  return rows.map((b) => ({
    id: b.id, code: b.code, service_id: b.service_id, service_name: b.service_name, service_name_es: b.service_name_es, service_image: b.service_image, segment: b.segment,
    address: b.address, city: b.city, date: b.date, slot: b.slot, status: b.status, frequency: b.frequency, total_cents: b.total_cents, deposit_cents: b.deposit_cents,
    invoice_id: b.invoice_id, inv_status: b.inv_status, inv_number: b.inv_number, inv_balance: b.inv_total != null ? Math.max(0, b.inv_total - b.inv_paid) : 0,
    addons: json(b.addons) || [], notes: b.notes,
    change: get(`SELECT id,type,new_date,new_slot,status,admin_note FROM booking_changes WHERE booking_id=? ORDER BY id DESC LIMIT 1`, b.id) || null,
    reviewed: !!get('SELECT 1 x FROM reviews WHERE booking_id=?', b.id),
    photos: all(`SELECT id,kind FROM files WHERE booking_id=? AND kind IN ('job_before','job_after') ORDER BY id`, b.id),
    crew: all(`SELECT u.name FROM booking_assignments a JOIN users u ON u.id=a.employee_id WHERE a.booking_id=?`, b.id).map((x) => x.name.split(' ')[0]),
  }));
}

module.exports = function (app) {
  app.get('/api/account', (c) => {
    const customer = me(c);
    const S = settings();
    const invoices = all(`SELECT i.id,i.number,i.status,i.issue_date,i.due_date,i.total_cents,i.paid_cents,i.deposit_cents,i.booking_id,i.order_id, b.code booking_code, o.code order_code
      FROM invoices i LEFT JOIN bookings b ON b.id=i.booking_id LEFT JOIN orders o ON o.id=i.order_id WHERE i.customer_id=? AND i.is_draft=0 ORDER BY i.id DESC`, customer.id)
      .map((i) => ({ ...i, balance_cents: i.status === 'cancelled' ? 0 : Math.max(0, i.total_cents - i.paid_cents) }));
    const orders = all('SELECT * FROM orders WHERE customer_id=? ORDER BY id DESC', customer.id).map((o) => ({
      id: o.id, code: o.code, status: o.status, fulfillment: o.fulfillment, total_cents: o.total_cents, created_at: o.created_at, tracking_number: o.tracking_number, carrier: o.carrier, invoice_id: o.invoice_id,
      items: all('SELECT product_name,variant_name,qty,unit_cents FROM order_items WHERE order_id=?', o.id),
    }));
    const membership = get(`SELECT m.id,m.status,m.next_bill_date,p.name,p.discount_pct,p.price_cents FROM memberships m JOIN membership_plans p ON p.id=m.plan_id WHERE m.customer_id=? AND m.status='active'`, customer.id) || null;
    const messages = all('SELECT id,sender_role,body,created_at FROM messages WHERE customer_id=? ORDER BY id DESC LIMIT 60', customer.id).reverse();
    run('UPDATE messages SET read_by_customer=1 WHERE customer_id=? AND sender_role!=?', customer.id, 'customer');
    const ledger = all('SELECT points,reason,created_at FROM loyalty_ledger WHERE customer_id=? ORDER BY id DESC LIMIT 25', customer.id);
    const referred = get('SELECT COUNT(*) n FROM customers WHERE referred_by=?', customer.id).n;
    c.res.json({
      customer: { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone, company: customer.company, referral_code: customer.referral_code, loyalty_points: customer.loyalty_points, marketing_opt_in: !!customer.marketing_opt_in, whatsapp_opt_in: !!customer.whatsapp_opt_in },
      bookings: bookingsFor(customer), invoices, orders, membership, messages, addresses: all('SELECT * FROM addresses WHERE customer_id=? ORDER BY is_default DESC, id', customer.id),
      loyalty: { points: customer.loyalty_points, ledger, redeem_points: S.loyalty.redeem_points, redeem_value_cents: S.loyalty.redeem_value_cents, min_redeem: S.loyalty.min_redeem, points_per_dollar: S.loyalty.points_per_dollar },
      referral: { code: customer.referral_code, referred, referrer_points: S.referral.referrer_points, referred_points: S.referral.referred_points },
      pay: { mode: pay.mode() },
    });
  });

  app.put('/api/account/profile', (c) => {
    const customer = me(c);
    const b = c.body;
    const name = str(b.name, { required: true, min: 2, max: 120, label: 'Name' });
    const ph = phone(b.phone, false);
    run('UPDATE customers SET name=?, phone=?, company=?, marketing_opt_in=?, whatsapp_opt_in=? WHERE id=?', name, ph || null, str(b.company, { max: 120 }) || null, bool(b.marketing_opt_in), bool(b.whatsapp_opt_in), customer.id);
    run('UPDATE users SET name=?, phone=? WHERE id=?', name, ph || null, c.user.id);
    c.res.json({ ok: true });
  });

  // ---------------------------------------------------------------- addresses
  const addrFields = (b) => ({ label: str(b.label, { max: 40 }), line1: str(b.line1, { required: true, label: 'Address', max: 200 }), line2: str(b.line2, { max: 100 }), city: str(b.city, { max: 80 }), zip: str(b.zip, { max: 12 }), notes: str(b.notes, { max: 300 }) });
  app.post('/api/account/addresses', (c) => {
    const customer = me(c); const a = addrFields(c.body);
    const first = !get('SELECT 1 x FROM addresses WHERE customer_id=?', customer.id);
    const isDef = first || bool(c.body.is_default);
    if (isDef) run('UPDATE addresses SET is_default=0 WHERE customer_id=?', customer.id);
    const id = insert('INSERT INTO addresses(customer_id,label,line1,line2,city,zip,notes,is_default) VALUES(?,?,?,?,?,?,?,?)', customer.id, a.label, a.line1, a.line2, a.city, a.zip, a.notes, isDef ? 1 : 0);
    c.res.json({ id });
  });
  app.put('/api/account/addresses/:id', (c) => {
    const customer = me(c); owned('addresses', c.params.id, customer); const a = addrFields(c.body);
    if (bool(c.body.is_default)) run('UPDATE addresses SET is_default=0 WHERE customer_id=?', customer.id);
    run('UPDATE addresses SET label=?,line1=?,line2=?,city=?,zip=?,notes=?,is_default=CASE WHEN ?=1 THEN 1 ELSE is_default END WHERE id=?', a.label, a.line1, a.line2, a.city, a.zip, a.notes, bool(c.body.is_default), Number(c.params.id));
    c.res.json({ ok: true });
  });
  app.del('/api/account/addresses/:id', (c) => {
    const customer = me(c); owned('addresses', c.params.id, customer);
    run('DELETE FROM addresses WHERE id=?', Number(c.params.id));
    c.res.json({ ok: true });
  });

  // ---------------------------------------------------------------- bookings
  app.post('/api/bookings', (c) => {
    const customer = me(c);
    rateLimit(`book:${customer.id}`, 20, 3600000);
    const input = parseBookingInput(c.body, customer, c.user);
    const est = pricing.estimate({ ...input, force_quote: bool(c.body.force_quote) }, { customer });
    if (est.custom_quote) {
      const svc = get('SELECT name FROM services WHERE id=?', input.service_id);
      const msg = [`Custom quote request — ${svc.name} (${input.segment})`, input.sqft ? `Size: ${input.sqft} sq ft` : '', input.rooms ? `Rooms: ${input.rooms}` : '', input.date ? `Preferred: ${input.date} ${input.slot}` : '', `Address: ${input.address} ${input.city || ''}`, input.notes ? `Notes: ${input.notes}` : '', est.reason || ''].filter(Boolean).join('\n');
      const photos = input.photo_ids.map((id) => ({ id }));
      const id = core.createQuoteRequest({ name: customer.name, email: customer.email, phone: input.contact_phone || customer.phone, service_id: input.service_id, segment: input.segment, message: msg, address: `${input.address} ${input.city || ''}`.trim(), photos, source: 'online booking (custom quote)', lang: c.lang });
      return c.res.json({ quote_requested: true, lead_id: id });
    }
    if (!input.date) throw bad('Please choose a date and time');
    const r = core.createBooking({ customer, input });
    const inv = core.invoiceDetail(r.invoice_id);
    c.res.json({ booking: { id: r.booking.id, code: r.booking.code, date: r.booking.date, slot: r.booking.slot, status: r.booking.status, total_cents: r.booking.total_cents, deposit_cents: r.booking.deposit_cents }, invoice: { id: inv.id, number: inv.number, total_cents: inv.total_cents, deposit_cents: inv.deposit_cents }, estimate: r.estimate });
  });

  app.post('/api/bookings/:id/change-request', (c) => {
    const customer = me(c);
    const b = owned('bookings', c.params.id, customer);
    if (!['pending', 'confirmed'].includes(b.status)) throw bad('This booking can no longer be changed online. Please contact us.');
    if (get(`SELECT 1 x FROM booking_changes WHERE booking_id=? AND status='pending'`, b.id)) throw bad('You already have a pending request for this booking.');
    const type = oneOf(c.body.type, ['reschedule', 'cancel'], 'Request type');
    let nd = null, ns = null;
    if (type === 'reschedule') { nd = vDate(c.body.date); ns = str(c.body.slot, { required: true, max: 5, label: 'Time' }); }
    const id = insert('INSERT INTO booking_changes(booking_id,customer_id,type,new_date,new_slot,reason,created_at) VALUES(?,?,?,?,?,?,?)', b.id, customer.id, type, nd, ns, str(c.body.reason, { max: 500 }), nowISO());
    notify.alertAdmin(`${type === 'cancel' ? 'Cancel' : 'Reschedule'} request — ${b.code}`, [`${customer.name} requested to ${type} booking ${b.code}.`, nd ? `Preferred: ${nd} ${ns}` : '', c.body.reason ? `Reason: ${c.body.reason}` : ''].filter(Boolean), `adminchg:${id}`, { type: 'booking', id: b.id });
    c.res.json({ id });
  });

  // ---------------------------------------------------------------- orders
  app.post('/api/orders', (c) => {
    const customer = me(c);
    rateLimit(`order:${customer.id}`, 20, 3600000);
    const b = c.body;
    const ship = b.fulfillment === 'ship' ? { name: str(b.ship?.name, { max: 120 }), line1: str(b.ship?.line1, { max: 200 }), city: str(b.ship?.city, { max: 80 }), zip: str(b.ship?.zip, { max: 12 }), phone: phone(b.ship?.phone, false) } : {};
    const r = core.createOrder({ customer, items: b.items, fulfillment: b.fulfillment === 'ship' ? 'ship' : 'pickup', ship, coupon_code: str(b.coupon_code, { max: 40 }), use_points: b.use_points ? int(b.use_points, { min: 0, max: 1_000_000 }) : 0, notes: str(b.notes, { max: 500 }) });
    c.res.json({ order: { id: r.order.id, code: r.order.code, total_cents: r.order.total_cents }, invoice_id: r.invoice_id });
  });

  // ---------------------------------------------------------------- invoices
  const invoiceAccess = (c, id) => {
    auth.need(c.user);
    const inv = get('SELECT * FROM invoices WHERE id=?', Number(id));
    if (!inv) throw new HttpError(404, 'Not found');
    if (c.user.role !== 'admin') {
      if (c.user.role !== 'customer') throw new HttpError(403, 'You do not have permission to do that');
      const cust = core.customerForUser(c.user);
      if (inv.customer_id !== cust.id || inv.is_draft) throw new HttpError(404, 'Not found');
    }
    return inv;
  };
  app.get('/api/invoices/:id', (c) => { invoiceAccess(c, c.params.id); c.res.json({ invoice: core.invoiceDetail(Number(c.params.id)) }); });
  app.get('/api/invoices/:id/pdf', (c) => {
    const inv = invoiceAccess(c, c.params.id);
    const pdf = core.buildInvoicePdf(inv.id);
    c.res.send(pdf, 'application/pdf', 200, { 'Content-Disposition': `${c.query.inline ? 'inline' : 'attachment'}; filename="Invoice-${inv.number.replace(/[^A-Za-z0-9_-]/g, '')}.pdf"`, 'Cache-Control': 'private, no-store' });
  });

  // ---------------------------------------------------------------- messages (support)
  app.post('/api/messages', (c) => {
    const customer = me(c);
    rateLimit(`msg:${customer.id}`, 30, 3600000);
    const body = str(c.body.body, { required: true, label: 'Message', max: 2000 });
    insert('INSERT INTO messages(customer_id,sender_role,user_id,body,created_at,read_by_customer) VALUES(?,?,?,?,?,1)', customer.id, 'customer', c.user.id, body, nowISO());
    notify.alertAdmin(`New message from ${customer.name}`, [body.slice(0, 300)], null, { type: 'customer', id: customer.id });
    c.res.json({ ok: true });
  });

  // ---------------------------------------------------------------- reviews
  app.post('/api/reviews', (c) => {
    const customer = me(c);
    const b = owned('bookings', c.body.booking_id, customer);
    if (b.status !== 'completed') throw bad('You can only review completed services');
    if (get('SELECT 1 x FROM reviews WHERE booking_id=?', b.id)) throw bad('You already reviewed this service');
    const rating = int(c.body.rating, { min: 1, max: 5, label: 'Rating' });
    insert('INSERT INTO reviews(customer_id,booking_id,rating,comment,name_display,verified,published,created_at) VALUES(?,?,?,?,?,1,1,?)', customer.id, b.id, rating, str(c.body.comment, { max: 1500 }), customer.name, nowISO());
    c.res.json({ ok: true });
  });

  // ---------------------------------------------------------------- membership
  app.post('/api/membership/subscribe', (c) => {
    const customer = me(c);
    const r = core.subscribeMembership(customer, c.body.plan_id);
    c.res.json({ ok: true, invoice_id: r.invoice_id });
  });
  app.post('/api/membership/cancel', (c) => {
    const customer = me(c);
    run(`UPDATE memberships SET status='cancelled', cancelled_at=? WHERE customer_id=? AND status='active'`, nowISO(), customer.id);
    c.res.json({ ok: true });
  });

  // ---------------------------------------------------------------- saved cards (Stripe only)
  app.get('/api/account/payment-methods', async (c) => {
    const customer = me(c);
    c.res.json({ enabled: pay.stripeEnabled(), cards: await pay.listPaymentMethods(customer) });
  });
  app.post('/api/account/payment-methods', async (c) => { const customer = me(c); c.res.json(await pay.addPaymentMethodSession(customer, c.base)); });
  app.del('/api/account/payment-methods/:id', async (c) => { const customer = me(c); await pay.removePaymentMethod(customer, c.params.id); c.res.json({ ok: true }); });

  // ---------------------------------------------------------------- private files
  app.get('/api/files/:id', (c) => {
    auth.need(c.user);
    const f = get('SELECT * FROM files WHERE id=?', Number(c.params.id));
    if (!f) throw new HttpError(404, 'Not found');
    let ok = c.user.role === 'admin';
    if (!ok && c.user.role === 'customer') ok = f.customer_id === core.customerForUser(c.user).id || f.user_id === c.user.id;
    if (!ok && c.user.role === 'employee' && f.booking_id) ok = !!get('SELECT 1 x FROM booking_assignments WHERE booking_id=? AND employee_id=?', f.booking_id, c.user.id);
    if (!ok) throw new HttpError(404, 'Not found');
    const file = path.join(UPLOAD_DIR, path.basename(f.name));
    if (!fs.existsSync(file)) throw new HttpError(404, 'Not found');
    c.res.send(fs.readFileSync(file), f.mime, 200, { 'Cache-Control': 'private, max-age=3600' });
  });
};
