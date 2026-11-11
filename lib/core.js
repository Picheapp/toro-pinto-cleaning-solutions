'use strict';
// Domain logic shared by the API routes and the background jobs.
const { get, all, run, insert, tx, settings, audit } = require('./db');
const { bad, HttpError, uid, code, nowISO, money, tzNow, addDays, json } = require('./util');
const pricing = require('./pricing');
const avail = require('./availability');
const notify = require('./notify');
const { invoicePdf } = require('./pdf');

const STAGES = ['New Lead', 'Contacted', 'Quote Sent', 'Awaiting Approval', 'Booked', 'In Progress', 'Completed', 'Paid'];
const BOOKING_STATUSES = ['pending', 'confirmed', 'en_route', 'in_progress', 'completed', 'cancelled'];
const ORDER_STATUSES = ['pending_payment', 'processing', 'ready_for_pickup', 'shipped', 'delivered', 'cancelled'];
const ORDER_LABEL_ES = { pending_payment: 'Pendiente de pago', processing: 'En proceso', ready_for_pickup: 'Listo para recoger', shipped: 'Enviado', delivered: 'Entregado', cancelled: 'Cancelado' };
const ORDER_LABEL = { pending_payment: 'Awaiting payment', processing: 'Processing', ready_for_pickup: 'Ready for pickup', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' };

const fmtDate = (d, lang = 'en') => new Date(d + 'T12:00:00Z').toLocaleDateString(lang === 'es' ? 'es-PR' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
const fmtTime = (t) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const when = (b, lang = 'en') => `${fmtDate(b.date, lang)} ${lang === 'es' ? 'a las' : 'at'} ${fmtTime(b.slot)}`;
const L = (c) => (c && c.lang === 'es' ? 'es' : 'en');

// =========================================================== customers / loyalty
function newReferralCode(name) {
  const base = String(name || '').replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase().padEnd(4, 'X');
  for (let i = 0; i < 50; i++) {
    const c = base + String(Math.floor(100 + Math.random() * 900));
    if (!get('SELECT 1 x FROM customers WHERE referral_code=?', c)) return c;
  }
  return code('TP', 6);
}

function customerForUser(user) {
  let c = get('SELECT * FROM customers WHERE user_id=?', user.id);
  if (c) return c;
  c = get('SELECT * FROM customers WHERE email=? AND user_id IS NULL', user.email);
  if (c) { run('UPDATE customers SET user_id=? WHERE id=?', user.id, c.id); return get('SELECT * FROM customers WHERE id=?', c.id); }
  const id = insert('INSERT INTO customers(user_id,name,email,phone,referral_code,source,created_at) VALUES(?,?,?,?,?,?,?)', user.id, user.name, user.email, user.phone, newReferralCode(user.name), 'website', nowISO());
  return get('SELECT * FROM customers WHERE id=?', id);
}

function findOrCreateCustomer({ name, email, phone, source = 'website', company = null, lang = 'en' }) {
  let c = email ? get('SELECT * FROM customers WHERE email=?', email) : null;
  if (!c && phone) { const digits = phone.replace(/\D/g, ''); if (digits.length >= 7) c = all('SELECT * FROM customers WHERE phone IS NOT NULL').find((x) => x.phone.replace(/\D/g, '') === digits) || null; }
  if (c) return c;
  const id = insert('INSERT INTO customers(name,email,phone,company,referral_code,source,lang,created_at) VALUES(?,?,?,?,?,?,?,?)', name, email || null, phone || null, company, newReferralCode(name), source, lang === 'es' ? 'es' : 'en', nowISO());
  return get('SELECT * FROM customers WHERE id=?', id);
}

function registerCustomer({ name, email, phone, password_hash, referral_code, lang = 'en' }) {
  return tx(() => {
    if (get('SELECT 1 x FROM users WHERE email=?', email)) throw bad('An account with that email already exists. Try logging in.', { Email: 'Already registered' });
    const userId = insert('INSERT INTO users(role,name,email,phone,password_hash,created_at) VALUES(?,?,?,?,?,?)', 'customer', name, email, phone || null, password_hash, nowISO());
    const user = get('SELECT * FROM users WHERE id=?', userId);
    const customer = customerForUser(user);
    run('UPDATE customers SET lang=? WHERE id=?', lang === 'es' ? 'es' : 'en', customer.id);
    if (phone && !customer.phone) run('UPDATE customers SET phone=? WHERE id=?', phone, customer.id);
    if (referral_code) {
      const ref = get('SELECT id FROM customers WHERE referral_code=?', String(referral_code).trim().toUpperCase());
      if (ref && ref.id !== customer.id) run('UPDATE customers SET referred_by=? WHERE id=? AND referred_by IS NULL', ref.id, customer.id);
    }
    const fresh = get('SELECT * FROM customers WHERE id=?', customer.id);
    notify.send('welcome', { customer: fresh, vars: { name: firstName(name), referral_code: fresh.referral_code }, dedupe: `welcome:${fresh.id}` });
    return { user, customer: fresh };
  });
}
const svcName = (svc, lg) => (lg === 'es' && svc.name_es ? svc.name_es : svc.name);
const firstName = (n) => String(n || '').split(' ')[0] || 'there';

function addPoints(customerId, points, reason, ref) {
  if (!points) return false;
  return tx(() => {
    if (ref && get('SELECT 1 x FROM loyalty_ledger WHERE ref=?', ref)) return false;
    insert('INSERT INTO loyalty_ledger(customer_id,points,reason,ref,created_at) VALUES(?,?,?,?,?)', customerId, points, reason, ref || null, nowISO());
    run('UPDATE customers SET loyalty_points=MAX(0, loyalty_points+?) WHERE id=?', points, customerId);
    return true;
  });
}

function customerStats(customerId) {
  const ltv = get(`SELECT COALESCE(SUM(amount_cents),0) v FROM payments WHERE customer_id=? AND status='succeeded'`, customerId).v;
  const b = get(`SELECT COUNT(*) n, SUM(status='completed') done, MAX(CASE WHEN status='completed' THEN date END) last_done FROM bookings WHERE customer_id=?`, customerId);
  const o = get(`SELECT COUNT(*) n FROM orders WHERE customer_id=? AND status!='cancelled' AND status!='pending_payment'`, customerId).n;
  const bal = get(`SELECT COALESCE(SUM(total_cents-paid_cents),0) v FROM invoices WHERE customer_id=? AND cancelled=0 AND is_draft=0`, customerId).v;
  return { ltv_cents: ltv, bookings: b.n || 0, completed: b.done || 0, last_completed: b.last_done || null, orders: o, balance_cents: Math.max(0, bal) };
}
function segmentOf(c, stats) {
  const S = settings();
  const today = tzNow(S.timezone).date;
  const age = (d) => Math.floor((Date.parse(today) - Date.parse(String(d).slice(0, 10))) / 86400000);
  if (stats.ltv_cents >= S.vip_cents) return 'VIP';
  if (stats.last_completed) { const a = age(stats.last_completed); if (a <= 90) return 'Active'; if (a <= 180) return 'At risk'; return 'Inactive'; }
  if (age(c.created_at) <= 30) return 'New';
  return stats.bookings || stats.orders ? 'Active' : 'Prospect';
}

// =========================================================== leads / CRM
function upsertLeadForBooking(customer, booking, service) {
  const open = get(`SELECT * FROM leads WHERE (customer_id=? OR (email IS NOT NULL AND email=?)) AND lost=0 AND stage IN ('New Lead','Contacted','Quote Sent','Awaiting Approval') ORDER BY id DESC LIMIT 1`, customer.id, customer.email || '');
  const now = nowISO();
  if (open) {
    run(`UPDATE leads SET stage='Booked', booking_id=?, customer_id=?, service_id=?, updated_at=? WHERE id=?`, booking.id, customer.id, service.id, now, open.id);
    return open.id;
  }
  return insert(`INSERT INTO leads(customer_id,name,email,phone,source,service_id,segment,address,stage,booking_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    customer.id, customer.name, customer.email, customer.phone, 'online booking', service.id, booking.segment, booking.address, 'Booked', booking.id, now, now);
}

function setLeadStage(id, stage, { quote_cents } = {}) {
  if (!STAGES.includes(stage)) throw bad('Invalid pipeline stage');
  const lead = get('SELECT * FROM leads WHERE id=?', id);
  if (!lead) throw new HttpError(404, 'Lead not found');
  const q = quote_cents !== undefined && quote_cents !== null ? quote_cents : lead.quote_cents;
  run('UPDATE leads SET stage=?, quote_cents=?, lost=0, updated_at=? WHERE id=?', stage, q, nowISO(), id);
  if (stage === 'Quote Sent' && lead.stage !== 'Quote Sent') {
    const svc = lead.service_id ? get('SELECT name FROM services WHERE id=?', lead.service_id) : null;
    const customer = lead.customer_id ? get('SELECT * FROM customers WHERE id=?', lead.customer_id) : null;
    notify.send('quote_sent', { customer, email: lead.email, phone: lead.phone, vars: { name: firstName(lead.name), amount: q ? money(q) : 'as discussed', service: svc?.name }, dedupe: `quote:${id}:${q || 0}`, ref_type: 'lead', ref_id: id });
  }
  return get('SELECT * FROM leads WHERE id=?', id);
}

function createQuoteRequest({ name, email, phone, service_id, segment, message, address, photos = [], source = 'quote form', lang = 'en' }) {
  return tx(() => {
    const customer = findOrCreateCustomer({ name, email, phone, source, lang });
    const now = nowISO();
    const id = insert(`INSERT INTO leads(customer_id,name,email,phone,source,service_id,segment,message,address,stage,photos,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      customer.id, name, email || null, phone || null, source, service_id || null, segment || null, message || null, address || null, 'New Lead', JSON.stringify(photos.map((p) => p.id)), now, now);
    for (const p of photos) run('UPDATE files SET attached=1, lead_id=?, customer_id=? WHERE id=?', id, customer.id, p.id);
    notify.send('quote_received', { customer, email, phone, vars: { name: firstName(name) }, dedupe: `qr:${id}`, ref_type: 'lead', ref_id: id });
    notify.alertAdmin(`New lead: ${name}`, [`${name} requested a quote.`, `Phone: ${phone || '—'} · Email: ${email || '—'}`, message ? `Message: ${message}` : ''].filter(Boolean), `adminlead:${id}`, { type: 'lead', id });
    return id;
  });
}

// =========================================================== invoices / payments
function nextInvoiceNumber() {
  const S = settings();
  const { saveSettings } = require('./db');
  return tx(() => {
    let n = S.invoice.next;
    let num;
    do { num = `${S.invoice.prefix}${n++}`; } while (get('SELECT 1 x FROM invoices WHERE number=?', num));
    saveSettings({ invoice: { next: n } });
    return num;
  });
}

function createInvoice({ customer_id, booking_id = null, order_id = null, items, discount_cents = 0, tax_rate, deposit_cents = 0, notes = null, number, issue_date, due_days, due_date, draft = false, terms }) {
  const S = settings();
  return tx(() => {
    if (!items || !items.length) throw bad('An invoice needs at least one line item');
    const lines = items.map((it) => {
      const qty = Number(it.qty) || 1;
      const unit = Math.round(Number(it.unit_cents) || 0);
      if (!it.description || !String(it.description).trim()) throw bad('Every line needs a description');
      return { kind: it.kind || 'service', description: String(it.description).slice(0, 300), qty, unit_cents: unit, total_cents: Math.round(qty * unit) };
    });
    const subtotal = lines.reduce((s, l) => s + l.total_cents, 0);
    const discount = Math.min(Math.max(0, Math.round(discount_cents)), subtotal);
    const rate = tax_rate === undefined || tax_rate === null ? S.tax_rate : Number(tax_rate);
    const tax = Math.round(((subtotal - discount) * rate) / 100);
    const total = subtotal - discount + tax;
    const issue = issue_date || tzNow(S.timezone).date;
    const due = due_date || addDays(issue, due_days ?? S.invoice.due_days);
    const num = number ? String(number).trim().slice(0, 40) : nextInvoiceNumber();
    if (get('SELECT 1 x FROM invoices WHERE number=?', num)) throw bad(`Invoice number ${num} already exists`);
    const id = insert(`INSERT INTO invoices(number,customer_id,booking_id,order_id,status,is_draft,issue_date,due_date,subtotal_cents,discount_cents,tax_rate,tax_cents,total_cents,deposit_cents,notes,terms,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, num, customer_id, booking_id, order_id, draft ? 'draft' : 'unpaid', draft ? 1 : 0, issue, due, subtotal, discount, rate, tax, total, Math.min(deposit_cents, total), notes, terms ?? S.invoice.terms, nowISO());
    for (const l of lines) insert('INSERT INTO invoice_items(invoice_id,kind,description,qty,unit_cents,total_cents) VALUES(?,?,?,?,?,?)', id, l.kind, l.description, l.qty, l.unit_cents, l.total_cents);
    refreshInvoice(id);
    return id;
  });
}

function refreshInvoice(id) {
  const inv = get('SELECT * FROM invoices WHERE id=?', id);
  if (!inv) return null;
  const S = settings();
  const paid = get(`SELECT COALESCE(SUM(amount_cents),0) v FROM payments WHERE invoice_id=? AND status='succeeded'`, id).v;
  const today = tzNow(S.timezone).date;
  const balance = inv.total_cents - paid;
  let status;
  if (inv.cancelled) status = 'cancelled';
  else if (inv.is_draft) status = 'draft';
  else if (balance <= 0) status = 'paid';
  else if (inv.due_date < today) status = 'overdue';
  else if (paid > 0) status = 'partial';
  else status = inv.sent_at ? 'sent' : 'unpaid';
  const paidAt = status === 'paid' ? inv.paid_at || nowISO() : null;
  run('UPDATE invoices SET paid_cents=?, status=?, paid_at=? WHERE id=?', paid, status, paidAt, id);
  return get('SELECT * FROM invoices WHERE id=?', id);
}

function invoiceDetail(id) {
  const inv = get(`SELECT i.*, b.code booking_code, o.code order_code FROM invoices i LEFT JOIN bookings b ON b.id=i.booking_id LEFT JOIN orders o ON o.id=i.order_id WHERE i.id=?`, id);
  if (!inv) return null;
  inv.items = all('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY id', id);
  inv.payments = all('SELECT id,amount_cents,method,provider,status,purpose,note,created_at,paid_at FROM payments WHERE invoice_id=? ORDER BY id', id);
  inv.balance_cents = inv.cancelled ? 0 : Math.max(0, inv.total_cents - inv.paid_cents);
  return inv;
}

function buildInvoicePdf(id) {
  const inv = invoiceDetail(id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  const customer = get('SELECT * FROM customers WHERE id=?', inv.customer_id);
  const S = settings();
  return invoicePdf({ invoice: inv, items: inv.items, payments: inv.payments.filter((p) => p.status === 'succeeded'), customer, business: S.business, footer: S.invoice.footer, terms: inv.terms });
}

function sendInvoice(id) {
  const inv = get('SELECT * FROM invoices WHERE id=?', id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  if (inv.cancelled) throw bad('This invoice is cancelled');
  run('UPDATE invoices SET is_draft=0, sent_at=COALESCE(sent_at,?) WHERE id=?', nowISO(), id);
  const f = refreshInvoice(id);
  const c = get('SELECT * FROM customers WHERE id=?', f.customer_id);
  notify.send('invoice_generated', { customer: c, vars: { name: firstName(c.name), number: f.number, total: money(f.total_cents), due: f.due_date, balance: money(f.total_cents - f.paid_cents) }, ref_type: 'invoice', ref_id: id });
  return f;
}

// Create a payment row (pending). Used by Stripe/demo checkout creation.
function createPendingPayment({ invoice_id, amount_cents, provider, provider_ref, purpose, method = 'card' }) {
  const inv = get('SELECT * FROM invoices WHERE id=?', invoice_id);
  return insert('INSERT INTO payments(invoice_id,customer_id,amount_cents,method,provider,provider_ref,status,purpose,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    invoice_id, inv.customer_id, amount_cents, method, provider, provider_ref || null, 'pending', purpose || null, nowISO());
}

// Mark a payment succeeded (idempotent) and run all follow-up automations.
function completePayment(paymentId, { intent_ref } = {}) {
  const done = tx(() => {
    const p = get('SELECT * FROM payments WHERE id=?', paymentId);
    if (!p) throw new HttpError(404, 'Payment not found');
    if (p.status === 'succeeded') return null;
    run(`UPDATE payments SET status='succeeded', paid_at=?, intent_ref=COALESCE(?,intent_ref) WHERE id=?`, nowISO(), intent_ref || null, paymentId);
    return p;
  });
  if (!done) return false;
  afterPayment(done.invoice_id, paymentId);
  return true;
}

function recordPayment({ invoice_id, amount_cents, method, note, by, provider = 'manual', provider_ref = null, purpose = 'manual' }) {
  const inv = get('SELECT * FROM invoices WHERE id=?', invoice_id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  if (inv.cancelled) throw bad('This invoice is cancelled');
  amount_cents = Math.round(Number(amount_cents));
  if (!(amount_cents > 0)) throw bad('Enter a payment amount greater than zero');
  const balance = inv.total_cents - inv.paid_cents;
  if (amount_cents > balance) throw bad(`Payment exceeds the balance due (${money(balance)})`);
  const id = tx(() => {
    const pid = insert('INSERT INTO payments(invoice_id,customer_id,amount_cents,method,provider,provider_ref,status,purpose,note,created_at,paid_at,recorded_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      invoice_id, inv.customer_id, amount_cents, method, provider, provider_ref, 'pending', purpose, note || null, nowISO(), null, by || null);
    return pid;
  });
  completePayment(id);
  return id;
}

function afterPayment(invoiceId, paymentId) {
  const S = settings();
  const inv = refreshInvoice(invoiceId);
  const p = get('SELECT * FROM payments WHERE id=?', paymentId);
  const c = get('SELECT * FROM customers WHERE id=?', inv.customer_id);
  const balance = inv.total_cents - inv.paid_cents;

  // loyalty points (1 point per dollar by default)
  if (p.amount_cents > 0) addPoints(c.id, Math.floor((p.amount_cents / 100) * S.loyalty.points_per_dollar), `Payment on ${inv.number}`, `pay:${p.id}`);

  // referral reward on first payment
  if (c.referred_by && p.amount_cents > 0) {
    const first = get(`SELECT COUNT(*) n FROM payments WHERE customer_id=? AND status='succeeded' AND amount_cents>0`, c.id).n;
    if (first === 1) {
      addPoints(c.referred_by, S.referral.referrer_points, `Referral: ${c.name} booked`, `refbonus:${c.id}`);
      addPoints(c.id, S.referral.referred_points, 'Welcome bonus (referral)', `refwelcome:${c.id}`);
    }
  }

  // booking: deposit confirms the slot, full payment advances the CRM
  if (inv.booking_id) {
    const b = get('SELECT * FROM bookings WHERE id=?', inv.booking_id);
    if (b && b.status === 'pending' && inv.paid_cents >= Math.min(inv.deposit_cents, inv.total_cents) && inv.paid_cents > 0) setBookingStatus(b.id, 'confirmed', null);
    if (b && b.lead_id && balance <= 0) { run(`UPDATE leads SET stage='Paid', updated_at=? WHERE id=?`, nowISO(), b.lead_id); }
  }
  // order: paid → processing
  if (inv.order_id && balance <= 0) {
    const o = get('SELECT * FROM orders WHERE id=?', inv.order_id);
    if (o && o.status === 'pending_payment') {
      run(`UPDATE orders SET status='processing', paid_at=? WHERE id=?`, nowISO(), o.id);
      notify.send('order_confirmation', { customer: c, vars: { name: firstName(c.name), code: o.code, total: money(o.total_cents), fulfillment: o.fulfillment }, dedupe: `order:${o.id}`, ref_type: 'order', ref_id: o.id });
      notify.alertAdmin(`New paid order ${o.code}`, [`${c.name} paid ${money(o.total_cents)} for order ${o.code} (${o.fulfillment}).`], `adminorder:${o.id}`, { type: 'order', id: o.id });
    }
  }
  notify.send('payment_confirmation', { customer: c, vars: { name: firstName(c.name), amount: money(p.amount_cents), number: inv.number, balance: money(Math.max(0, balance)), balance_cents: balance }, dedupe: `pay:${p.id}`, ref_type: 'invoice', ref_id: invoiceId });
}

function failPayment(paymentId, status = 'failed') {
  run(`UPDATE payments SET status=? WHERE id=? AND status='pending'`, status, paymentId);
}

function cancelInvoice(id) {
  const inv = get('SELECT * FROM invoices WHERE id=?', id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  if (inv.paid_cents > 0) throw bad('This invoice has payments. Void or refund them first.');
  run('UPDATE invoices SET cancelled=1 WHERE id=?', id);
  return refreshInvoice(id);
}

// =========================================================== bookings
function parseAddons(b) { return json(b.addons) || []; }

function createBooking({ customer, input, adminCreated = false, overrideTotalCents = null }) {
  const S = settings();
  const service = get('SELECT * FROM services WHERE id=? AND active=1', Number(input.service_id));
  if (!service) throw bad('Please choose a service');
  const segment = input.segment === 'commercial' ? 'commercial' : 'residential';
  const est = pricing.estimate({ ...input, segment }, { customer });
  if (est.custom_quote && overrideTotalCents === null) throw bad('This job needs a custom quote — please send a quote request instead.');

  return tx(() => {
    avail.assertSlotFree(input.date, input.slot, { enforceLead: !adminCreated });
    const code_ = code('TP', 6);
    const total = overrideTotalCents !== null ? overrideTotalCents : est.total_cents;
    const deposit = overrideTotalCents !== null ? 0 : est.deposit_cents;
    const frequency = est.frequency;
    const id = insert(`INSERT INTO bookings(code,customer_id,service_id,segment,property_type,address,city,zip,access_notes,sqft,rooms,condition,frequency,series_id,date,slot,addons,notes,contact_name,contact_phone,contact_email,estimate,total_cents,deposit_cents,status,coupon_code,created_by_admin,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      code_, customer.id, service.id, segment, input.property_type || null, input.address, input.city || null, input.zip || null, input.access_notes || null,
      est.sqft || null, est.rooms || null, est.condition, frequency, frequency !== 'once' ? uid(8) : null, input.date, input.slot,
      JSON.stringify(est.addons), input.notes || null, input.contact_name || customer.name, input.contact_phone || customer.phone, input.contact_email || customer.email,
      JSON.stringify(est), total, deposit, adminCreated ? 'confirmed' : 'pending', est.coupon_code || null, adminCreated ? 1 : 0, nowISO());
    const booking = get('SELECT * FROM bookings WHERE id=?', id);

    // invoice from the estimate
    const size = service.pricing_type === 'sqft' ? `${est.sqft} sq ft` : service.pricing_type === 'room' ? `${est.rooms} rooms` : '';
    let items, discount = 0;
    if (overrideTotalCents !== null) {
      items = [{ kind: 'service', description: `${service.name}${size ? ' · ' + size : ''}`, qty: 1, unit_cents: overrideTotalCents }];
    } else {
      items = est.lines.map((l) => ({ kind: 'service', description: l.label === service.name ? `${service.name} (${segment}${size ? ', ' + size : ''})` : l.label, qty: 1, unit_cents: l.cents }));
      discount = est.discounts.reduce((s, d) => s + d.cents, 0);
    }
    const notesParts = [`Booking ${code_} · ${fmtDate(input.date)} ${fmtTime(input.slot)}`, `Address: ${input.address}${input.city ? ', ' + input.city : ''}`];
    if (est.discounts?.length) notesParts.push('Discounts: ' + est.discounts.map((d) => `${d.label} -${money(d.cents)}`).join('; '));
    const invoiceId = createInvoice({ customer_id: customer.id, booking_id: id, items, discount_cents: discount, tax_rate: est.tax_rate ?? S.tax_rate, deposit_cents: deposit, notes: notesParts.join('\n'), due_date: input.date });
    run('UPDATE bookings SET invoice_id=? WHERE id=?', invoiceId, id);

    // coupon + points bookkeeping
    if (est.coupon_code) run('UPDATE coupons SET uses=uses+1 WHERE code=?', est.coupon_code);
    if (est.points_used) addPoints(customer.id, -est.points_used, `Redeemed on booking ${code_}`, `redeem:${code_}`);
    // photos
    for (const fid of input.photo_ids || []) run('UPDATE files SET attached=1, booking_id=?, customer_id=? WHERE id=?', id, customer.id, fid);
    // CRM
    const leadId = upsertLeadForBooking(customer, booking, service);
    run('UPDATE bookings SET lead_id=? WHERE id=?', leadId, id);

    const fresh = get('SELECT * FROM bookings WHERE id=?', id);
    notify.send('booking_confirmation', { customer, vars: (lg) => ({ name: firstName(customer.name), code: code_, service: svcName(service, lg), when: when(fresh, lg), address: `${input.address}${input.city ? ', ' + input.city : ''}`, total: money(total), deposit: deposit ? money(deposit) : '' }), dedupe: `bk:${id}`, ref_type: 'booking', ref_id: id });
    notify.alertAdmin(`New booking ${code_}`, [`${customer.name} booked ${service.name} for ${when(fresh)}.`, `Total ${money(total)} · ${segment}`, `Address: ${input.address}`], `adminbk:${id}`, { type: 'booking', id });
    return { booking: fresh, invoice_id: invoiceId, estimate: est };
  });
}

function setBookingStatus(id, status, byUserId) {
  if (!BOOKING_STATUSES.includes(status)) throw bad('Invalid status');
  const b = get('SELECT * FROM bookings WHERE id=?', id);
  if (!b) throw new HttpError(404, 'Booking not found');
  if (b.status === status) return b;
  const c = get('SELECT * FROM customers WHERE id=?', b.customer_id);
  const svc = get('SELECT * FROM services WHERE id=?', b.service_id);
  const completedAt = status === 'completed' ? nowISO() : b.completed_at;
  run('UPDATE bookings SET status=?, completed_at=? WHERE id=?', status, completedAt, id);
  const vars = (lg) => ({ name: firstName(c.name), code: b.code, service: svcName(svc, lg), when: when(b, lg), date: fmtDate(b.date, lg) });

  if (status === 'confirmed' && b.status === 'pending') notify.send('booking_confirmed', { customer: c, vars, dedupe: `bkc:${id}`, ref_type: 'booking', ref_id: id });
  if (status === 'in_progress' && b.lead_id) run(`UPDATE leads SET stage='In Progress', updated_at=? WHERE id=?`, nowISO(), b.lead_id);
  if (status === 'completed') {
    if (b.lead_id) run(`UPDATE leads SET stage=CASE WHEN stage='Paid' THEN 'Paid' ELSE 'Completed' END, updated_at=? WHERE id=?`, nowISO(), b.lead_id);
    notify.send('job_completed', { customer: c, vars, dedupe: `done:${id}`, ref_type: 'booking', ref_id: id });
    // issue the balance invoice
    if (b.invoice_id) {
      const inv = refreshInvoice(b.invoice_id);
      if (inv && !inv.cancelled && inv.total_cents - inv.paid_cents > 0) {
        run('UPDATE invoices SET is_draft=0, sent_at=COALESCE(sent_at,?), due_date=? WHERE id=?', nowISO(), addDays(tzNow(settings().timezone).date, settings().invoice.due_days), b.invoice_id);
        const f = refreshInvoice(b.invoice_id);
        notify.send('invoice_generated', { customer: c, vars: { name: firstName(c.name), number: f.number, total: money(f.total_cents), due: f.due_date, balance: money(f.total_cents - f.paid_cents) }, dedupe: `invdue:${f.id}`, ref_type: 'invoice', ref_id: f.id });
      } else if (inv && inv.total_cents - inv.paid_cents <= 0 && b.lead_id) run(`UPDATE leads SET stage='Paid', updated_at=? WHERE id=?`, nowISO(), b.lead_id);
    }
    try { scheduleNextOccurrence(get('SELECT * FROM bookings WHERE id=?', id)); } catch (e) { console.error('recurrence failed', e.message); }
  }
  if (status === 'cancelled') {
    if (b.invoice_id) { const inv = get('SELECT * FROM invoices WHERE id=?', b.invoice_id); if (inv && inv.paid_cents === 0) { run('UPDATE invoices SET cancelled=1 WHERE id=?', inv.id); refreshInvoice(inv.id); } }
    notify.send('booking_cancelled', { customer: c, vars, dedupe: `bkx:${id}`, ref_type: 'booking', ref_id: id });
  }
  audit(byUserId, 'booking.status', `${b.code}: ${b.status} → ${status}`);
  return get('SELECT * FROM bookings WHERE id=?', id);
}

function rescheduleBooking(id, date, slot, { force = false, byUserId = null } = {}) {
  const b = get('SELECT * FROM bookings WHERE id=?', id);
  if (!b) throw new HttpError(404, 'Booking not found');
  if (['completed', 'cancelled'].includes(b.status)) throw bad('This booking can no longer be rescheduled');
  tx(() => {
    avail.assertSlotFree(date, slot, { ignoreBookingId: id, enforceLead: !force, enforceDay: !force });
    run('UPDATE bookings SET date=?, slot=? WHERE id=?', date, slot, id);
    if (b.invoice_id) run('UPDATE invoices SET due_date=? WHERE id=? AND status IN (\'draft\',\'unpaid\',\'sent\')', date, b.invoice_id);
  });
  const fresh = get('SELECT * FROM bookings WHERE id=?', id);
  const c = get('SELECT * FROM customers WHERE id=?', b.customer_id);
  const svc = get('SELECT name,name_es FROM services WHERE id=?', b.service_id);
  notify.send('booking_rescheduled', { customer: c, vars: (lg) => ({ name: firstName(c.name), code: b.code, service: svcName(svc, lg), when: when(fresh, lg) }), dedupe: `rs:${id}:${date}:${slot}`, ref_type: 'booking', ref_id: id });
  audit(byUserId, 'booking.reschedule', `${b.code} → ${date} ${slot}`);
  return fresh;
}

const FREQ_DAYS = { weekly: 7, biweekly: 14, monthly: 30 };
function scheduleNextOccurrence(b) {
  if (!b.series_id || b.frequency === 'once') return null;
  if (get(`SELECT 1 x FROM bookings WHERE series_id=? AND date>? AND status!='cancelled'`, b.series_id, b.date)) return null;
  const S = settings();
  const target = addDays(b.date, FREQ_DAYS[b.frequency]);
  const customer = get('SELECT * FROM customers WHERE id=?', b.customer_id);
  const addonIds = (json(b.addons) || []).map((a) => a.id);
  for (let off = 0; off < 7; off++) {
    const date = addDays(target, off);
    const slots = avail.slotsFor(date).filter((s) => s.available);
    if (!slots.length) continue;
    const slot = (slots.find((s) => s.slot === b.slot) || slots[0]).slot;
    const r = createBooking({ customer, adminCreated: true, input: { service_id: b.service_id, segment: b.segment, sqft: b.sqft, rooms: b.rooms, condition: b.condition, frequency: b.frequency, addon_ids: addonIds, date, slot, address: b.address, city: b.city, zip: b.zip, property_type: b.property_type, access_notes: b.access_notes, notes: 'Recurring visit (auto-scheduled)' } });
    run('UPDATE bookings SET series_id=? WHERE id=?', b.series_id, r.booking.id);
    return r.booking.id;
  }
  return null;
}

// =========================================================== shop
function variantAvailability(variantId) {
  const v = get('SELECT v.*, p.is_bundle FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=?', variantId);
  if (!v) return 0;
  if (!v.is_bundle) return v.stock;
  const comps = all('SELECT bi.qty, c.stock FROM bundle_items bi JOIN variants c ON c.id=bi.variant_id WHERE bi.bundle_variant_id=?', variantId);
  if (!comps.length) return 0;
  return Math.min(...comps.map((c) => Math.floor(c.stock / c.qty)));
}

function priceCart(items, { coupon_code, fulfillment = 'pickup', customer = null, use_points = 0 } = {}) {
  const S = settings();
  if (!Array.isArray(items) || !items.length) throw bad('Your cart is empty');
  if (items.length > 40) throw bad('Too many items in cart');
  const merged = new Map();
  for (const it of items) {
    const vid = Number(it.variant_id), qty = Math.floor(Number(it.qty));
    if (!vid || !(qty >= 1) || qty > 99) throw bad('Invalid cart item');
    merged.set(vid, (merged.get(vid) || 0) + qty);
  }
  const lines = [];
  for (const [vid, qty] of merged) {
    const v = get(`SELECT v.*, p.name pname, p.id pid, p.image, p.is_bundle FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=? AND v.active=1 AND p.active=1`, vid);
    if (!v) throw bad('An item in your cart is no longer available');
    const left = variantAvailability(vid);
    if (qty > left) throw bad(`Only ${left} left of ${v.pname}${v.name !== 'Standard' ? ' (' + v.name + ')' : ''}`);
    lines.push({ variant_id: vid, product_id: v.pid, name: v.pname, variant: v.name, image: v.image, qty, unit_cents: v.price_cents, total_cents: v.price_cents * qty, stock_left: left, is_bundle: v.is_bundle });
  }
  const subtotal = lines.reduce((s, l) => s + l.total_cents, 0);
  let remaining = subtotal;
  const discounts = [];
  let coupon = null;
  if (coupon_code) {
    const r = pricing.findCoupon(coupon_code, subtotal, 'products');
    coupon = r.coupon.code; discounts.push({ label: `Code ${coupon}`, cents: r.discount_cents }); remaining -= r.discount_cents;
  }
  let pointsUsed = 0;
  if (customer && use_points) {
    const pv = pricing.pointsValue(Number(use_points), customer.loyalty_points, remaining);
    if (pv.cents) { pointsUsed = pv.points; discounts.push({ label: `Loyalty points (${pv.points} pts)`, cents: pv.cents }); remaining -= pv.cents; }
  }
  if (fulfillment === 'pickup' && !S.shipping.pickup_enabled) throw bad('Local pickup is not available');
  if (fulfillment === 'ship' && !S.shipping.ship_enabled) throw bad('Shipping is not available');
  if (!['pickup', 'ship'].includes(fulfillment)) throw bad('Choose shipping or local pickup');
  const shipping = fulfillment === 'ship' && remaining < S.shipping.free_over_cents ? S.shipping.flat_cents : 0;
  const tax = Math.round(((remaining + shipping) * S.tax_rate) / 100);
  return {
    lines, subtotal_cents: subtotal, discounts, discount_cents: subtotal - remaining, coupon_code: coupon, points_used: pointsUsed,
    shipping_cents: shipping, tax_rate: S.tax_rate, tax_cents: tax, total_cents: remaining + shipping + tax, free_ship_over_cents: S.shipping.free_over_cents,
  };
}

function adjustStock(variantId, qty, sign) { // sign=-1 take, +1 give back; handles bundles
  const v = get('SELECT v.id, p.is_bundle FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=?', variantId);
  if (!v) return;
  const targets = v.is_bundle ? all('SELECT variant_id, qty q FROM bundle_items WHERE bundle_variant_id=?', variantId).map((x) => [x.variant_id, x.q * qty]) : [[variantId, qty]];
  for (const [vid, n] of targets) {
    if (sign < 0) { const r = run('UPDATE variants SET stock=stock-? WHERE id=? AND stock>=?', n, vid, n); if (!r.changes) throw bad('Sorry, an item just sold out. Please review your cart.'); }
    else run('UPDATE variants SET stock=stock+? WHERE id=?', n, vid);
  }
}

function createOrder({ customer, items, fulfillment, ship = {}, coupon_code, use_points, notes }) {
  const S = settings();
  if (fulfillment === 'ship') {
    for (const k of ['name', 'line1', 'city', 'zip']) if (!String(ship[k] || '').trim()) throw bad('Please complete the shipping address', { [k]: 'Required' });
  }
  return tx(() => {
    const cart = priceCart(items, { coupon_code, fulfillment, customer, use_points });
    for (const l of cart.lines) adjustStock(l.variant_id, l.qty, -1);
    const code_ = code('ORD', 6);
    const orderId = insert(`INSERT INTO orders(code,customer_id,status,fulfillment,ship_name,ship_line1,ship_city,ship_zip,ship_phone,notes,subtotal_cents,discount_cents,shipping_cents,tax_cents,total_cents,coupon_code,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, code_, customer.id, 'pending_payment', fulfillment, ship.name || null, ship.line1 || null, ship.city || null, ship.zip || null, ship.phone || customer.phone || null, notes || null,
      cart.subtotal_cents, cart.discount_cents, cart.shipping_cents, cart.tax_cents, cart.total_cents, cart.coupon_code, nowISO());
    for (const l of cart.lines) insert('INSERT INTO order_items(order_id,variant_id,product_name,variant_name,qty,unit_cents) VALUES(?,?,?,?,?,?)', orderId, l.variant_id, l.name, l.variant === 'Standard' ? null : l.variant, l.qty, l.unit_cents);
    const invItems = cart.lines.map((l) => ({ kind: 'product', description: `${l.name}${l.variant !== 'Standard' ? ' — ' + l.variant : ''}`, qty: l.qty, unit_cents: l.unit_cents }));
    if (cart.shipping_cents) invItems.push({ kind: 'shipping', description: 'Shipping', qty: 1, unit_cents: cart.shipping_cents });
    const invoiceId = createInvoice({ customer_id: customer.id, order_id: orderId, items: invItems, discount_cents: cart.discount_cents, tax_rate: S.tax_rate, due_days: 0, notes: `Order ${code_} · ${fulfillment === 'pickup' ? 'Local pickup' : 'Shipping to ' + [ship.line1, ship.city, ship.zip].filter(Boolean).join(', ')}` });
    run('UPDATE orders SET invoice_id=? WHERE id=?', invoiceId, orderId);
    if (cart.coupon_code) run('UPDATE coupons SET uses=uses+1 WHERE code=?', cart.coupon_code);
    if (cart.points_used) addPoints(customer.id, -cart.points_used, `Redeemed on order ${code_}`, `redeem:${code_}`);
    return { order: get('SELECT * FROM orders WHERE id=?', orderId), invoice_id: invoiceId, cart };
  });
}

function releaseOrderStock(orderId) {
  const o = get('SELECT * FROM orders WHERE id=?', orderId);
  if (!o || o.stock_released) return;
  tx(() => {
    for (const it of all('SELECT * FROM order_items WHERE order_id=?', orderId)) if (it.variant_id) adjustStock(it.variant_id, it.qty, +1);
    run('UPDATE orders SET stock_released=1 WHERE id=?', orderId);
  });
}

function setOrderStatus(id, status, { tracking_number, carrier } = {}) {
  if (!ORDER_STATUSES.includes(status)) throw bad('Invalid order status');
  const o = get('SELECT * FROM orders WHERE id=?', id);
  if (!o) throw new HttpError(404, 'Order not found');
  if (status === 'cancelled' && o.status !== 'cancelled') {
    releaseOrderStock(id);
    if (o.invoice_id) { const inv = get('SELECT * FROM invoices WHERE id=?', o.invoice_id); if (inv && inv.paid_cents === 0) { run('UPDATE invoices SET cancelled=1 WHERE id=?', inv.id); refreshInvoice(inv.id); } }
  }
  run('UPDATE orders SET status=?, tracking_number=COALESCE(?,tracking_number), carrier=COALESCE(?,carrier) WHERE id=?', status, tracking_number || null, carrier || null, id);
  const fresh = get('SELECT * FROM orders WHERE id=?', id);
  if (status !== o.status && ['ready_for_pickup', 'shipped', 'delivered'].includes(status)) {
    const c = get('SELECT * FROM customers WHERE id=?', o.customer_id);
    notify.send('order_update', { customer: c, vars: (lg) => ({ name: firstName(c.name), code: o.code, status_label: (lg === 'es' ? ORDER_LABEL_ES : ORDER_LABEL)[status], tracking: fresh.tracking_number, carrier: fresh.carrier }), dedupe: `ordst:${id}:${status}`, ref_type: 'order', ref_id: id });
  }
  return fresh;
}

// =========================================================== memberships
function subscribeMembership(customer, planId) {
  const plan = get('SELECT * FROM membership_plans WHERE id=? AND active=1', Number(planId));
  if (!plan) throw bad('That plan is not available');
  if (get(`SELECT 1 x FROM memberships WHERE customer_id=? AND status='active'`, customer.id)) throw bad('You already have an active membership. Cancel it first to switch plans.');
  return tx(() => {
    const today = tzNow(settings().timezone).date;
    const mid = insert(`INSERT INTO memberships(customer_id,plan_id,status,started_at,next_bill_date) VALUES(?,?,'active',?,?)`, customer.id, plan.id, nowISO(), addDays(today, 30));
    const invId = createInvoice({ customer_id: customer.id, items: [{ kind: 'membership', description: `${plan.name} membership — month 1`, qty: 1, unit_cents: plan.price_cents }], due_days: 3, notes: 'Monthly membership. Billed every 30 days until cancelled.' });
    run('UPDATE invoices SET sent_at=? WHERE id=?', nowISO(), invId); refreshInvoice(invId);
    return { membership_id: mid, invoice_id: invId };
  });
}

// =========================================================== uploads
const MAGIC = [
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', mime: 'image/png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'webp', mime: 'image/webp', test: (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
];
function sniffImage(buf) {
  const m = MAGIC.find((x) => x.test(buf));
  if (!m) throw bad('Only JPG, PNG or WebP images are allowed');
  return m;
}

module.exports = {
  L, svcName, STAGES, BOOKING_STATUSES, ORDER_STATUSES, ORDER_LABEL, fmtDate, fmtTime, when, firstName,
  newReferralCode, customerForUser, findOrCreateCustomer, registerCustomer, addPoints, customerStats, segmentOf,
  upsertLeadForBooking, setLeadStage, createQuoteRequest,
  createInvoice, refreshInvoice, invoiceDetail, buildInvoicePdf, sendInvoice, createPendingPayment, completePayment, recordPayment, failPayment, cancelInvoice, afterPayment,
  createBooking, setBookingStatus, rescheduleBooking, scheduleNextOccurrence, parseAddons,
  variantAvailability, priceCart, createOrder, releaseOrderStock, setOrderStatus, adjustStock,
  subscribeMembership, sniffImage,
};
