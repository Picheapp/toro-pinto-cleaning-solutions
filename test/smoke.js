// End-to-end API smoke test. Spawns the server on a temp database with a mocked Stripe API.
// Run:  npm test   (Node >= 22.5)
const { spawn } = require('node:child_process');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3200 + Math.floor(Math.random() * 500), STRIPE_PORT = PORT + 1000, BASE = `http://127.0.0.1:${PORT}`;
const WHSEC = 'whsec_test_' + crypto.randomBytes(6).toString('hex');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-smoke-'));
let passed = 0, failed = 0; const fails = [];
const ok = (cond, name) => { if (cond) { passed++; console.log('  ✓', name); } else { failed++; fails.push(name); console.log('  ✗', name); } };
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), `${name}${JSON.stringify(a) === JSON.stringify(b) ? '' : `  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`}`);

// ---- mock Stripe API
const stripeCalls = [];
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => { body += d; }); req.on('end', () => {
    stripeCalls.push({ method: req.method, url: req.url, body });
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/v1/customers')) return res.end(JSON.stringify({ id: 'cus_test123' }));
    if (req.url.startsWith('/v1/checkout/sessions')) return res.end(JSON.stringify({ id: 'cs_test_' + stripeCalls.length, url: 'https://checkout.stripe.test/pay/cs' }));
    res.end('{}');
  });
});

// ---- tiny cookie-jar client
function client() {
  let cookie = '';
  return async (method, url, body, extra = {}) => {
    const headers = { 'X-Requested-With': 'fetch', Origin: BASE, ...(body && !extra.raw ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(extra.headers || {}) };
    const r = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : extra.raw ? body : JSON.stringify(body), redirect: 'manual' });
    const sc = r.headers.getSetCookie?.() || []; for (const c of sc) { const [kv] = c.split(';'); const [k] = kv.split('='); cookie = cookie.split('; ').filter((x) => x && !x.startsWith(k + '=')).concat(kv).join('; '); }
    const ct = r.headers.get('content-type') || ''; const data = ct.includes('json') ? await r.json() : ct.startsWith('text') ? await r.text() : Buffer.from(await r.arrayBuffer());
    return { status: r.status, data, headers: r.headers };
  };
}

async function waitUp() { for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + '/api/bootstrap'); if (r.ok) return; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 150)); } throw new Error('server did not start'); }
const nextWeekday = () => { const d = new Date(); d.setDate(d.getDate() + 3); while ([0].includes(d.getDay())) d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };

(async () => {
  await new Promise((r) => mock.listen(STRIPE_PORT, '127.0.0.1', r));
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'platform.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, DISABLE_JOBS: '1', ADMIN_EMAIL: 'admin@smoke.test', ADMIN_PASSWORD: 'SmokeAdmin#2026', STRIPE_SECRET_KEY: 'sk_test_mock', STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_API_BASE: `http://127.0.0.1:${STRIPE_PORT}`, BASE_URL: BASE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let slog = ''; srv.stdout.on('data', (d) => { slog += d; }); srv.stderr.on('data', (d) => { slog += d; });
  try {
    await waitUp();
    const anon = client(), cust = client(), admin = client(), crew = client();

    console.log('\nPublic');
    let r = await anon('GET', '/api/bootstrap');
    ok(r.status === 200 && r.data.services.length >= 8, 'bootstrap returns catalog');
    ok(!JSON.stringify(r.data).includes('password'), 'bootstrap leaks no secrets');
    const svc = r.data.services.find((s) => s.pricing_type === 'sqft' && s.segments === 'both'); const quoteSvc = r.data.services.find((s) => s.pricing_type === 'quote');
    r = await anon('POST', '/api/estimate', { service_id: svc.id, segment: 'residential', sqft: 1000 });
    ok(r.data.estimate.total_cents > 0 && !r.data.estimate.custom_quote, 'estimate prices a sqft service');
    const e1 = r.data.estimate.total_cents;
    r = await anon('POST', '/api/estimate', { service_id: svc.id, segment: 'commercial', sqft: 1000 });
    ok(r.data.estimate.total_cents > e1, 'commercial costs more than residential');
    r = await anon('POST', '/api/estimate', { service_id: svc.id, segment: 'residential', sqft: 9999999 });
    ok(r.data.estimate.custom_quote === true, 'oversized property becomes custom quote');
    if (quoteSvc) { r = await anon('POST', '/api/estimate', { service_id: quoteSvc.id, segment: quoteSvc.segments === 'commercial' ? 'commercial' : 'residential' }); ok(r.data.estimate?.custom_quote === true, 'quote-only service is custom quote'); }
    r = await anon('POST', '/api/estimate', { service_id: svc.id, segment: 'residential', sqft: -5 });
    ok(r.status >= 400 || r.data.estimate?.custom_quote, 'negative sqft is rejected');
    const date = nextWeekday();
    r = await anon('GET', `/api/availability?date=${date}`);
    ok(Array.isArray(r.data.slots) && r.data.slots.some((s) => s.available), 'availability lists open slots');
    const slot = r.data.slots.find((s) => s.available).slot;

    console.log('\nSecurity');
    r = await anon('POST', '/api/auth/login', { email: 'x@y.z', password: 'nope' }, { headers: { 'X-Requested-With': '' } });
    ok(r.status === 403, 'CSRF header required on POST');
    r = await anon('POST', '/api/auth/login', { email: 'x@y.z', password: 'nope' }, { headers: { Origin: 'https://evil.example' } });
    ok(r.status === 403, 'foreign Origin is rejected');
    r = await anon('GET', '/api/admin/overview'); ok(r.status === 401 || r.status === 403, 'admin API requires sign-in');
    r = await anon('GET', '/api/account'); ok(r.status === 401, 'account API requires sign-in');
    r = await anon('POST', '/api/webhooks/stripe', '{"type":"x"}', { raw: true, headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 't=1,v1=bad' } });
    ok(r.status === 400, 'unsigned Stripe webhook rejected');
    r = await anon('GET', '/api/files/1'); ok(r.status === 401 || r.status === 403 || r.status === 404, 'private files are not public');
    r = await anon('GET', '/.env'); ok(r.status === 404, '.env is not served');
    r = await anon('GET', '/../platform.js'); ok(r.status === 404 || r.status === 400, 'path traversal blocked');
    ok((r.headers.get('content-security-policy') || (await anon('GET', '/')).headers.get('content-security-policy') || '').includes("default-src 'self'"), 'CSP header present');

    console.log('\nCustomer booking → invoice → Stripe');
    r = await cust('POST', '/api/auth/register', { name: 'Test Customer', email: 'cust@smoke.test', phone: '787-555-0101', password: 'CustPass#2026ab' });
    ok(r.status === 200 && r.data.user.role === 'customer', 'customer registers');
    r = await cust('POST', '/api/auth/register', { name: 'Dup', email: 'cust@smoke.test', phone: '787-555-0101', password: 'CustPass#2026ab' });
    ok(r.status >= 400, 'duplicate email rejected');
    r = await cust('POST', '/api/bookings', { service_id: svc.id, segment: 'residential', sqft: 1000, address: '1 Calle Sol', city: 'Ponce', date, slot, contact_name: 'Test Customer', contact_phone: '787-555-0101', contact_email: 'cust@smoke.test' });
    ok(r.status === 200 && r.data.booking?.code, 'booking created');
    const booking = r.data.booking, invoice = r.data.invoice;
    ok(invoice && invoice.total_cents === e1, 'invoice total equals the estimate');
    ok(booking.total_cents === e1, 'server recomputed price matches');
    r = await cust('POST', '/api/bookings', { service_id: svc.id, segment: 'residential', sqft: 1000, address: '2 Calle Sol', date, slot, contact_name: 'T', contact_phone: '787-555-0101', contact_email: 'cust@smoke.test', total_cents: 1 });
    ok(r.status !== 200 || r.data.booking.total_cents === e1, 'client-sent price is ignored');
    r = await cust('POST', '/api/pay/checkout', { invoice_id: invoice.id, purpose: 'deposit' });
    ok(r.status === 200 && /checkout\.stripe\.test/.test(r.data.url), 'deposit checkout session created');
    const dep = stripeCalls.filter((c) => c.url.startsWith('/v1/checkout/sessions')).at(-1);
    const amt = Number(new URLSearchParams(dep.body).get('line_items[0][price_data][unit_amount]'));
    ok(amt > 0 && amt < e1, 'deposit is a fraction of the total');
    const sessId = 'cs_test_' + stripeCalls.filter((c) => c.url.startsWith('/v1/checkout/sessions')).length + '';
    const evt = (over = {}, total = amt) => JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_test_' + stripeCalls.length, mode: 'payment', payment_status: 'paid', amount_total: total, currency: 'usd', payment_intent: 'pi_1', metadata: {}, ...over } } });
    const sign = (payload, secret = WHSEC, ts = Math.floor(Date.now() / 1000)) => `t=${ts},v1=${crypto.createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex')}`;
    const hook = (payload, sig) => anon('POST', '/api/webhooks/stripe', payload, { raw: true, headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sig } });
    // find real session ref used
    const sessRef = (() => { const m = stripeCalls.filter((c) => c.url.startsWith('/v1/checkout/sessions')); return 'cs_test_' + (stripeCalls.indexOf(m.at(-1)) + 1); })();
    let payload = evt({ id: sessRef }, amt + 1);
    r = await hook(payload, sign(payload)); ok(r.data.result === 'amount-mismatch', 'webhook with wrong amount is not trusted');
    payload = evt({ id: sessRef }); r = await hook(payload, sign(payload, 'whsec_wrong')); ok(r.status === 400, 'webhook with wrong secret rejected');
    r = await hook(payload, sign(payload, WHSEC, Math.floor(Date.now() / 1000) - 3600)); ok(r.status === 400, 'stale webhook timestamp rejected');
    r = await hook(payload, sign(payload)); ok(r.status === 200 && r.data.result === 'paid', 'valid webhook marks deposit paid');
    r = await hook(payload, sign(payload)); ok(r.status === 200, 'replayed webhook is harmless');
    r = await cust('GET', '/api/account');
    const inv = r.data.invoices.find((i) => i.id === invoice.id);
    ok(inv && inv.paid_cents === amt && inv.status === 'partial', 'invoice shows partial payment exactly once');
    ok(r.data.bookings.find((b) => b.id === booking.id)?.status === 'confirmed', 'booking confirmed after deposit');
    r = await cust('GET', `/api/invoices/${invoice.id}/pdf`);
    ok(r.status === 200 && Buffer.isBuffer(r.data) && r.data.slice(0, 4).toString() === '%PDF', 'customer can download invoice PDF');
    const other = client(); await other('POST', '/api/auth/register', { name: 'Other', email: 'other@smoke.test', phone: '787-555-0102', password: 'OtherPass#2026a' });
    r = await other('GET', `/api/invoices/${invoice.id}/pdf`); ok(r.status === 403 || r.status === 404, "another customer cannot read this customer's invoice");

    console.log('\nAdmin');
    r = await admin('POST', '/api/auth/login', { email: 'admin@smoke.test', password: 'SmokeAdmin#2026' }); ok(r.data.user?.role === 'admin', 'admin signs in');
    r = await cust('GET', '/api/admin/overview'); ok(r.status === 403, 'customer cannot reach admin API');
    r = await admin('GET', '/api/admin/overview'); ok(r.status === 200 && r.data.revenue_total_cents === amt, 'overview revenue equals collected deposit');
    r = await admin('POST', '/api/admin/invoices/' + invoice.id + '/payments', { amount: ((e1 - amt) / 100).toFixed(2), method: 'cash' });
    ok(r.status === 200, 'admin records cash balance');
    r = await admin('GET', '/api/admin/invoices/' + invoice.id); ok(r.data.invoice.status === 'paid' && r.data.invoice.balance_cents === 0, 'invoice becomes paid');
    r = await admin('POST', '/api/admin/invoices/' + invoice.id + '/payments', { amount: '5.00', method: 'cash' }); ok(r.status >= 400, 'overpayment rejected');
    r = await admin('POST', '/api/admin/employees', { name: 'Crew One', email: 'crew@smoke.test', password: 'CrewPass#2026ab', title: 'Cleaner' }); ok(r.status === 200, 'admin creates crew member');
    const empId = r.data.id;
    r = await admin('PUT', '/api/admin/bookings/' + booking.id, { employee_ids: [empId], status: 'confirmed' }); ok(r.status === 200, 'admin assigns crew');
    const custId = (await admin('GET', '/api/admin/bookings/' + booking.id)).data.booking.customer_id;
    r = await admin('POST', '/api/admin/invoices', { customer_id: custId, items: [{ description: 'Gutter cleaning', qty: 2, unit_cents: 4500 }], discount_cents: 500, tax_rate: 11.5, draft: true });
    ok(r.status === 200, 'admin creates manual invoice' + (r.status === 200 ? '' : ' ' + JSON.stringify(r.data)));
    const manual = await admin('GET', '/api/admin/invoices/' + r.data.id);
    eq([manual.data.invoice.subtotal_cents, manual.data.invoice.tax_cents, manual.data.invoice.total_cents], [9000, 978, 9478], 'invoice tax math (9000−500 → +11.5%)');
    ok(manual.data.invoice.status === 'draft', 'draft invoice stays draft');
    r = await admin('POST', '/api/admin/invoices/' + r.data.id + '/send'); ok(r.status === 200, 'draft invoice can be sent');
    r = await admin('POST', '/api/admin/r/coupons', { code: 'smoke10', type: 'percent', value: 10, applies_to: 'all', active: true }); ok(r.status === 200, 'admin creates coupon (code upper-cased)');
    r = await anon('POST', '/api/estimate', { service_id: svc.id, segment: 'residential', sqft: 1000, coupon_code: 'SMOKE10' }); ok(r.data.estimate.total_cents < e1, 'coupon lowers the price');
    r = await admin('POST', '/api/admin/leads', { name: 'Lead Person', phone: '787-555-0199' }); ok(r.status === 200, 'admin creates lead');
    const lid = r.data.id; r = await admin('PUT', '/api/admin/leads/' + lid, { stage: 'Contacted' }); ok(r.status === 200, 'lead moves stage');
    r = await admin('PUT', '/api/admin/leads/' + lid, { stage: 'Nonsense' }); ok(r.status >= 400, 'invalid lead stage rejected');
    r = await admin('PUT', '/api/admin/settings', { tax_rate: 11.5, site: { hero_title: 'Smoke <b>title</b>' } }); ok(r.status === 200, 'admin updates settings');
    r = await anon('GET', '/'); ok(!r.data.includes('<b>title</b>'), 'settings text is escaped in page output');
    for (const t of ['invoices', 'payments', 'customers', 'orders', 'expenses', 'bookings', 'leads']) { r = await admin('GET', `/api/admin/export/${t}?from=2000-01-01&to=2100-01-01`); ok(r.status === 200 && /text\/csv/.test(r.headers.get('content-type')), `CSV export: ${t}`); }
    r = await admin('GET', '/api/admin/export/invoices?from=2000-01-01&to=2100-01-01'); ok(r.data.includes(invoice.number), 'invoice CSV contains the invoice');
    r = await admin('GET', '/api/admin/reports'); ok(r.status === 200 && typeof r.data.profit_cents === 'number', 'reports endpoint works');

    console.log('\nCrew');
    r = await crew('POST', '/api/auth/login', { email: 'crew@smoke.test', password: 'CrewPass#2026ab' }); ok(r.data.user?.role === 'employee', 'crew signs in');
    r = await crew('GET', '/api/admin/overview'); ok(r.status === 403, 'crew cannot reach admin API');
    r = await crew('GET', '/api/employee/jobs'); ok(r.status === 200, 'crew sees assigned jobs');
    const job = (r.data.items || r.data.jobs || [])[0]; ok(!!job, 'assigned job is listed');
    ok(!JSON.stringify(r.data).match(/total_cents|price|invoice|balance/i), 'job payload has no prices or invoice data');
    if (job) {
      r = await crew('POST', `/api/employee/jobs/${job.id}/status`, { status: 'in_progress' }); ok(r.status === 200, 'crew starts job');
      r = await crew('POST', `/api/employee/jobs/${job.id}/status`, { status: 'completed', confirm: true }); ok(r.status === 200, 'crew completes job');
    }
    r = await crew('GET', `/api/invoices/${invoice.id}/pdf`); ok(r.status === 403 || r.status === 404, 'crew cannot download invoices');
    r = await admin('GET', '/api/admin/bookings/' + booking.id); ok(r.data.booking.status === 'completed', 'admin sees job completed');

    console.log('\nBilingual');
    r = await anon('POST', '/api/auth/login', { email: 'a@b.co', password: 'x' }, { headers: { 'X-Lang': 'es' } });
    ok(r.status >= 400 && /[áéíóúñ¿¡]|correo|contraseña|incorrect/i.test(JSON.stringify(r.data)), 'server errors are returned in Spanish');
  } catch (e) { failed++; fails.push('crash: ' + e.stack); console.log('  ✗ CRASH', e.stack); }
  finally {
    srv.kill(); mock.close();
    if (failed) console.log('\nServer log tail:\n' + slog.split('\n').slice(-15).join('\n'));
    console.log(`\n${passed} passed, ${failed} failed`); if (failed) console.log('FAILED:\n - ' + fails.join('\n - '));
    try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* ignore */ }
    process.exit(failed ? 1 : 0);
  }
})();
