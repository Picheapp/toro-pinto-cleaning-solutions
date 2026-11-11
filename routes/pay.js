'use strict';
const { get, run } = require('../lib/db');
const { HttpError, bad, oneOf, money } = require('../lib/util');
const auth = require('../lib/auth');
const core = require('../lib/core');
const pay = require('../lib/pay');
const cfg = require('../lib/config');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

module.exports = function (app) {
  // Create a checkout for an invoice (deposit / remaining balance / full)
  app.post('/api/pay/checkout', async (c) => {
    auth.need(c.user, 'customer');
    const customer = core.customerForUser(c.user);
    const inv = get('SELECT * FROM invoices WHERE id=?', Number(c.body.invoice_id));
    if (!inv || inv.customer_id !== customer.id) throw new HttpError(404, 'Not found');
    const purpose = oneOf(c.body.purpose || 'balance', ['deposit', 'balance', 'full'], 'Payment type');
    const r = await pay.createCheckout({ invoice: inv, customer, purpose, baseUrl: c.base });
    c.res.json({ url: r.url, mode: r.mode });
  });

  // ---------------- DEMO payment page (only when Stripe is not configured and demo payments are allowed)
  app.get('/pay/demo/:ref', (c) => {
    if (!pay.demoEnabled()) throw new HttpError(404, 'Not found');
    const p = get(`SELECT p.*, i.number FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.provider='demo' AND p.provider_ref=?`, c.params.ref);
    if (!p) throw new HttpError(404, 'Not found');
    const lang = (c.req.headers['accept-language'] || '').toLowerCase().startsWith('es') ? 'es' : 'en';
    const tx = lang === 'es'
      ? { title: 'Pago de demostración', warn: 'MODO DEMO — no se cobra dinero real. Conecta Stripe para pagos reales.', amt: 'Monto a pagar', inv: 'Factura', ok: 'Simular pago exitoso', fail: 'Simular pago fallido', back: 'Volver' }
      : { title: 'Demo payment', warn: 'DEMO MODE — no real money is charged. Connect Stripe for real payments.', amt: 'Amount due', inv: 'Invoice', ok: 'Simulate successful payment', fail: 'Simulate failed payment', back: 'Back' };
    const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${tx.title}</title><link rel="icon" href="/img/favicon.png" type="image/png"><link rel="stylesheet" href="/css/demo-pay.css"></head>
<body><main class="card"><div class="warn">${tx.warn}</div><h1>${tx.title}</h1><p>${tx.inv} <b>${esc(p.number)}</b></p><p class="amt">${tx.amt}<br><strong>${money(p.amount_cents)}</strong></p>
<div id="msg" class="msg" hidden></div>
<button class="btn ok" data-ref="${esc(c.params.ref)}" data-result="success" data-lang="${lang}">${tx.ok}</button>
<button class="btn bad" data-ref="${esc(c.params.ref)}" data-result="fail" data-lang="${lang}">${tx.fail}</button>
<a class="back" href="/#account">${tx.back}</a></main><script src="/js/demo-pay.js"></script></body></html>`;
    c.res.send(html, 'text/html; charset=utf-8', 200, { 'Cache-Control': 'no-store' });
  });

  app.post('/api/pay/demo/:ref', (c) => {
    if (!pay.demoEnabled()) throw new HttpError(404, 'Not found');
    auth.need(c.user, 'customer');
    const customer = core.customerForUser(c.user);
    const p = get(`SELECT * FROM payments WHERE provider='demo' AND provider_ref=?`, c.params.ref);
    if (!p || p.customer_id !== customer.id) throw new HttpError(404, 'Not found');
    if (p.status !== 'pending') throw bad('This payment was already processed');
    if (c.body.result === 'success') { core.completePayment(p.id); return c.res.json({ ok: true, status: 'succeeded' }); }
    core.failPayment(p.id);
    c.res.json({ ok: true, status: 'failed' });
  });

  // ---------------- Stripe webhook (signature verified; amounts re-checked against our own records)
  app.post('/api/webhooks/stripe', (c) => {
    pay.verifySignature(c.raw, c.req.headers['stripe-signature'], cfg.stripe.webhookSecret);
    let evt; try { evt = JSON.parse(c.raw.toString('utf8')); } catch { throw bad('Invalid payload'); }
    const result = pay.handleEvent(evt);
    c.res.json({ received: true, result });
  }, { raw: true, noCsrf: true, limit: 1_000_000 });
};
