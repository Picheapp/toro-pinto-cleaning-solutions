'use strict';
// Stripe integration (Checkout Sessions + verified webhooks) with a clearly-labelled DEMO fallback for development.
const crypto = require('crypto');
const cfg = require('./config');
const { get, run, all, insert, settings } = require('./db');
const core = require('./core');
const notify = require('./notify');
const { bad, HttpError, uid, nowISO, money } = require('./util');

const stripeEnabled = () => !!cfg.stripe.secret;
const demoEnabled = () => cfg.demoPayments;
const mode = () => (stripeEnabled() ? 'stripe' : demoEnabled() ? 'demo' : 'off');

function formEncode(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (x && typeof x === 'object' ? formEncode(x, `${key}[${i}]`, out) : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(x)}`)));
    else if (typeof v === 'object') formEncode(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out;
}
async function stripe(method, path, params) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const headers = { Authorization: `Bearer ${cfg.stripe.secret}`, 'Content-Type': 'application/x-www-form-urlencoded' };
    if (method === 'POST') headers['Idempotency-Key'] = uid(16);
    const qs = method === 'GET' && params ? '?' + formEncode(params).join('&') : '';
    const r = await fetch(cfg.stripe.apiBase + path + qs, { method, headers, body: method === 'POST' && params ? formEncode(params).join('&') : undefined, signal: ctl.signal });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { console.error('Stripe error', r.status, data?.error?.message); throw new HttpError(502, 'The payment provider returned an error. Please try again.'); }
    return data;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    console.error('Stripe request failed:', e.message);
    throw new HttpError(502, 'Could not reach the payment provider. Please try again.');
  } finally { clearTimeout(t); }
}

// Amount the customer is allowed to pay right now.
function payableAmount(inv, purpose) {
  const balance = inv.total_cents - inv.paid_cents;
  if (inv.cancelled) throw bad('This invoice is cancelled');
  if (inv.is_draft) throw bad('This invoice is not ready for payment yet');
  if (balance <= 0) throw bad('This invoice is already paid');
  if (purpose === 'deposit') {
    const dep = Math.max(0, inv.deposit_cents - inv.paid_cents);
    if (dep <= 0) throw bad('The deposit has already been paid. You can pay the remaining balance instead.');
    return Math.min(dep, balance);
  }
  return balance; // 'balance' | 'full'
}

async function createCheckout({ invoice, customer, purpose, baseUrl }) {
  const amount = payableAmount(invoice, purpose);
  if (amount < 50) throw bad('Amount is below the minimum payment');
  const S = settings();
  if (mode() === 'off') throw new HttpError(503, 'Online payments are not available right now. Please call us to pay.');

  if (mode() === 'demo') {
    const ref = `demo_${uid(10)}`;
    const pid = core.createPendingPayment({ invoice_id: invoice.id, amount_cents: amount, provider: 'demo', provider_ref: ref, purpose });
    return { url: `/pay/demo/${ref}`, payment_id: pid, mode: 'demo' };
  }

  const pid = core.createPendingPayment({ invoice_id: invoice.id, amount_cents: amount, provider: 'stripe', purpose });
  const label = purpose === 'deposit' ? `Deposit — invoice ${invoice.number}` : `Invoice ${invoice.number}`;
  try {
    const session = await stripe('POST', '/v1/checkout/sessions', {
      mode: 'payment',
      'line_items': [{ quantity: 1, price_data: { currency: 'usd', unit_amount: amount, product_data: { name: label, description: S.business.name } } }],
      customer: await ensureStripeCustomer(customer),
      client_reference_id: String(pid),
      metadata: { payment_id: pid, invoice_id: invoice.id, invoice_number: invoice.number, purpose },
      payment_intent_data: { metadata: { payment_id: pid, invoice_id: invoice.id }, description: `${S.business.name} — ${label}` },
      success_url: `${baseUrl}/?paid=1&inv=${encodeURIComponent(invoice.number)}#account`,
      cancel_url: `${baseUrl}/?paid=0#account`,
    });
    run('UPDATE payments SET provider_ref=? WHERE id=?', session.id, pid);
    return { url: session.url, payment_id: pid, mode: 'stripe' };
  } catch (e) { core.failPayment(pid); throw e; }
}

async function ensureStripeCustomer(customer) {
  if (customer.stripe_customer_id) return customer.stripe_customer_id;
  const c = await stripe('POST', '/v1/customers', { name: customer.name, email: customer.email || undefined, phone: customer.phone || undefined, metadata: { customer_id: customer.id } });
  run('UPDATE customers SET stripe_customer_id=? WHERE id=?', c.id, customer.id);
  return c.id;
}

async function listPaymentMethods(customer) {
  if (!stripeEnabled() || !customer.stripe_customer_id) return [];
  const r = await stripe('GET', '/v1/payment_methods', { customer: customer.stripe_customer_id, type: 'card', limit: 10 });
  return (r.data || []).map((m) => ({ id: m.id, brand: m.card?.brand, last4: m.card?.last4, exp_month: m.card?.exp_month, exp_year: m.card?.exp_year }));
}
async function addPaymentMethodSession(customer, baseUrl) {
  if (!stripeEnabled()) throw new HttpError(503, 'Saving cards requires the payment provider to be connected.');
  const s = await stripe('POST', '/v1/checkout/sessions', {
    mode: 'setup', customer: await ensureStripeCustomer(customer), currency: 'usd', 'payment_method_types': ['card'],
    success_url: `${baseUrl}/?card=saved#account`, cancel_url: `${baseUrl}/#account`,
  });
  return { url: s.url };
}
async function removePaymentMethod(customer, pmId) {
  const mine = await listPaymentMethods(customer);
  if (!mine.some((m) => m.id === pmId)) throw new HttpError(404, 'Card not found');
  await stripe('POST', `/v1/payment_methods/${encodeURIComponent(pmId)}/detach`, {});
}

// ---------- webhook ----------
function verifySignature(raw, header, secret, tolerance = 300) {
  if (!secret) throw new HttpError(400, 'Webhook secret not configured');
  const parts = String(header || '').split(',').map((p) => p.split('='));
  const t = parts.find((p) => p[0] === 't')?.[1];
  const sigs = parts.filter((p) => p[0] === 'v1').map((p) => p[1]);
  if (!t || !sigs.length) throw new HttpError(400, 'Missing signature');
  if (Math.abs(Date.now() / 1000 - Number(t)) > tolerance) throw new HttpError(400, 'Signature timestamp outside tolerance');
  const expected = crypto.createHmac('sha256', secret).update(`${t}.`).update(raw).digest('hex');
  const ok = sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) throw new HttpError(400, 'Invalid signature');
}

function handleEvent(evt) {
  const obj = evt.data?.object || {};
  switch (evt.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      if (obj.mode !== 'payment') return 'ignored';
      if (obj.payment_status !== 'paid') return 'awaiting';
      const p = get(`SELECT * FROM payments WHERE provider='stripe' AND (provider_ref=? OR id=?)`, obj.id, Number(obj.metadata?.payment_id) || 0);
      if (!p) return 'unknown-payment';
      if (obj.amount_total !== p.amount_cents || String(obj.currency).toLowerCase() !== 'usd') { console.error('Stripe amount mismatch', obj.id); return 'amount-mismatch'; }
      core.completePayment(p.id, { intent_ref: typeof obj.payment_intent === 'string' ? obj.payment_intent : null });
      return 'paid';
    }
    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed': {
      const p = get(`SELECT * FROM payments WHERE provider='stripe' AND provider_ref=?`, obj.id);
      if (p) core.failPayment(p.id, evt.type.endsWith('expired') ? 'expired' : 'failed');
      return 'failed';
    }
    case 'charge.refunded': {
      const intent = obj.payment_intent;
      const p = intent && get(`SELECT * FROM payments WHERE intent_ref=? AND amount_cents>0 AND status='succeeded'`, intent);
      if (!p) return 'unknown-charge';
      const already = -get(`SELECT COALESCE(SUM(amount_cents),0) v FROM payments WHERE intent_ref=? AND amount_cents<0`, intent).v;
      const delta = (obj.amount_refunded || 0) - already;
      if (delta > 0) {
        insert(`INSERT INTO payments(invoice_id,customer_id,amount_cents,method,provider,provider_ref,intent_ref,status,purpose,note,created_at,paid_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
          p.invoice_id, p.customer_id, -delta, 'refund', 'stripe', `refund:${obj.id}:${obj.amount_refunded}`, intent, 'succeeded', 'refund', 'Refunded via Stripe', nowISO(), nowISO());
        core.refreshInvoice(p.invoice_id);
      }
      return 'refunded';
    }
    default: return 'ignored';
  }
}

module.exports = { stripeEnabled, demoEnabled, mode, createCheckout, listPaymentMethods, addPaymentMethodSession, removePaymentMethod, verifySignature, handleEvent, payableAmount };
