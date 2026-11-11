'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('../lib/config');
const { get, all, run, insert, settings } = require('../lib/db');
const { HttpError, bad, str, email, phone, int, oneOf, uid, sha256, nowISO, rateLimit, json, date: vDate } = require('../lib/util');
const auth = require('../lib/auth');
const core = require('../lib/core');
const pricing = require('../lib/pricing');
const avail = require('../lib/availability');
const notify = require('../lib/notify');
const pay = require('../lib/pay');

const UPLOAD_DIR = path.join(cfg.dataDir, 'uploads');

function publicSettings() {
  const S = settings();
  return {
    business: S.business, timezone: S.timezone, slots: S.slots, hours: S.hours, max_days_ahead: S.max_days_ahead, lead_hours: S.lead_hours,
    tax_rate: S.tax_rate, deposit_pct: S.deposit_pct, frequency_discounts: S.frequency_discounts, loyalty: S.loyalty, referral: S.referral,
    shipping: S.shipping, site: S.site, commercial_multiplier: S.commercial_multiplier, max_auto_sqft: S.max_auto_sqft, max_auto_rooms: S.max_auto_rooms,
  };
}

function publicCatalog() {
  const categories = all('SELECT id,slug,name,description,image,name_es,description_es FROM categories WHERE active=1 ORDER BY sort,id');
  const addons = all('SELECT id,category_id,service_id,name,name_es,price_cents FROM addons WHERE active=1 ORDER BY sort,id');
  const services = all(`SELECT s.* FROM services s JOIN categories c ON c.id=s.category_id WHERE s.active=1 AND c.active=1 ORDER BY s.sort,s.id`).map((s) => ({
    id: s.id, category_id: s.category_id, slug: s.slug, name: s.name, description: s.description, name_es: s.name_es, description_es: s.description_es, details_es: json(s.details_es) || [], image: s.image, pricing_type: s.pricing_type,
    base_cents: s.base_cents, unit_cents: s.unit_cents, min_cents: s.min_cents, segments: s.segments, duration_min: s.duration_min,
    details: json(s.details) || [], recommend: json(s.recommend) || [], recurring_ok: !!s.recurring_ok,
  }));
  const products = all(`SELECT * FROM products WHERE active=1 ORDER BY sort,id`).map((p) => ({
    id: p.id, slug: p.slug, category: p.category, category_es: p.category_es, name: p.name, description: p.description, name_es: p.name_es, description_es: p.description_es, image: p.image, is_bundle: !!p.is_bundle,
    variants: all('SELECT id,name,name_es,price_cents,compare_cents FROM variants WHERE product_id=? AND active=1 ORDER BY sort,id', p.id).map((v) => ({ ...v, available: core.variantAvailability(v.id) })),
  })).filter((p) => p.variants.length);
  const plans = all('SELECT id,name,price_cents,discount_pct,perks,perks_es,highlight FROM membership_plans WHERE active=1 ORDER BY sort,id').map((p) => ({ ...p, perks: json(p.perks) || [], perks_es: json(p.perks_es) || [] }));
  const gallery = all('SELECT id,title,title_es,before_img,after_img,caption,caption_es,is_sample FROM gallery WHERE active=1 ORDER BY sort,id');
  return { categories, services, addons, products, plans, gallery };
}

function publicReviews() {
  const rows = all(`SELECT r.id, r.rating, r.comment, r.name_display, r.verified, r.is_demo, r.reply, r.created_at, c.name cname FROM reviews r LEFT JOIN customers c ON c.id=r.customer_id WHERE r.published=1 ORDER BY r.created_at DESC LIMIT 12`);
  const display = (r) => { const n = (r.name_display || r.cname || 'Customer').trim().split(/\s+/); return n.length > 1 ? `${n[0]} ${n[n.length - 1][0]}.` : n[0]; };
  const s = get('SELECT COUNT(*) n, AVG(rating) a FROM reviews WHERE published=1');
  return { items: rows.map((r) => ({ id: r.id, rating: r.rating, comment: r.comment, name: display(r), verified: !!r.verified, reply: r.reply, created_at: r.created_at })), count: s.n, avg: s.n ? Math.round(s.a * 10) / 10 : null };
}

function activePromos() {
  const S = settings();
  return (S.site.promos || []).filter((p) => p.active && p.text);
}

function userPayload(user) {
  if (!user) return null;
  const out = { id: user.id, role: user.role, name: user.name, email: user.email, phone: user.phone };
  if (user.role === 'customer') {
    const c = core.customerForUser(user);
    out.customer = { id: c.id, loyalty_points: c.loyalty_points, referral_code: c.referral_code, phone: c.phone, company: c.company, lang: c.lang };
  }
  return out;
}

async function startSession(c, user) {
  const token = auth.createSession(user.id, c.req);
  c.res.json({ user: userPayload(user) }, 200, { 'Set-Cookie': auth.cookieHeader(token, c.req) });
}

// persist an uploaded image (base64 data URL) — validates real file type by magic bytes
function saveImage(dataUrl, { kind, user_id = null, customer_id = null, booking_id = null, anon_key = null, attached = 0 }) {
  const m = /^data:image\/(?:jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw bad('Please choose a JPG, PNG or WebP image');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length < 100) throw bad('That image looks empty');
  if (buf.length > 6 * 1024 * 1024) throw bad('Images must be under 6 MB');
  const type = core.sniffImage(buf);
  const name = `${uid(16)}.${type.ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf, { mode: 0o600 });
  const id = insert('INSERT INTO files(name,mime,size,user_id,customer_id,booking_id,kind,attached,anon_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', name, type.mime, buf.length, user_id, customer_id, booking_id, kind, attached, anon_key, nowISO());
  return { id, name, size: buf.length };
}

module.exports = function (app) {
  // ---------------------------------------------------------------- bootstrap
  app.get('/api/bootstrap', (c) => {
    const reviews = publicReviews();
    const jobs = get(`SELECT COUNT(*) n FROM bookings WHERE status='completed'`).n;
    const customers = get('SELECT COUNT(*) n FROM customers WHERE archived=0').n;
    c.res.json({
      settings: publicSettings(), ...publicCatalog(), reviews, promos: activePromos(),
      stats: { jobs_completed: jobs, customers, rating: reviews.avg, review_count: reviews.count },
      config: { gaId: cfg.gaId, mapsKey: cfg.mapsKey, payments: pay.mode(), whatsapp: settings().business.whatsapp },
      user: userPayload(c.user),
    });
  });

  // ---------------------------------------------------------------- availability / estimate / cart
  app.get('/api/availability', (c) => {
    if (c.query.month) return c.res.json({ days: avail.calendar(String(c.query.month)) });
    const d = vDate(c.query.date);
    c.res.json({ date: d, slots: avail.slotsFor(d) });
  });

  app.post('/api/estimate', (c) => {
    const customer = c.user?.role === 'customer' ? core.customerForUser(c.user) : null;
    const est = pricing.estimate(c.body, { customer });
    c.res.json({ estimate: est, recommendations: pricing.recommendations(c.body.service_id) });
  });

  app.post('/api/cart/price', (c) => {
    const customer = c.user?.role === 'customer' ? core.customerForUser(c.user) : null;
    c.res.json({ cart: core.priceCart(c.body.items, { coupon_code: c.body.coupon_code, fulfillment: c.body.fulfillment || 'pickup', customer, use_points: c.body.use_points }) });
  });

  // ---------------------------------------------------------------- uploads (anonymous allowed, strictly limited)
  app.post('/api/uploads', (c) => {
    rateLimit(`up:${c.ip}`, 30, 3600000);
    const kind = oneOf(c.body.kind || 'booking_photo', ['booking_photo', 'lead_photo'], 'Upload type');
    let anon = null, userId = null, customerId = null;
    if (c.user?.role === 'customer') { userId = c.user.id; customerId = core.customerForUser(c.user).id; }
    else { anon = str(c.body.anon_key, { min: 16, max: 80, required: true, label: 'Upload key' }); }
    const existing = get('SELECT COUNT(*) n FROM files WHERE attached=0 AND ((anon_key IS NOT NULL AND anon_key=?) OR (user_id IS NOT NULL AND user_id=?))', anon || '', userId || 0).n;
    if (existing >= 8) throw bad('You can attach up to 8 photos');
    const f = saveImage(c.body.data, { kind, user_id: userId, customer_id: customerId, anon_key: anon });
    c.res.json({ id: f.id, size: f.size });
  }, { limit: 9_000_000 });

  // ---------------------------------------------------------------- quote request (lead)
  app.post('/api/quotes', (c) => {
    rateLimit(`quote:${c.ip}`, 8, 3600000);
    const b = c.body;
    const name = str(b.name, { required: true, label: 'Name', max: 120 });
    const em = email(b.email, false), ph = phone(b.phone, false);
    if (!em && !ph) throw bad('Please give us an email or a phone number so we can reach you', { Email: 'Email or phone required' });
    const msg = str(b.message, { max: 2000, label: 'Message' });
    const serviceId = b.service_id ? int(b.service_id) : null;
    if (serviceId && !get('SELECT 1 x FROM services WHERE id=?', serviceId)) throw bad('Unknown service');
    const segment = b.segment === 'commercial' ? 'commercial' : b.segment === 'residential' ? 'residential' : null;
    const photos = [];
    for (const id of (Array.isArray(b.photo_ids) ? b.photo_ids : []).slice(0, 8)) {
      const f = get('SELECT * FROM files WHERE id=? AND attached=0 AND ((anon_key IS NOT NULL AND anon_key=?) OR (user_id IS NOT NULL AND user_id=?))', Number(id), String(b.anon_key || ''), c.user?.id || 0);
      if (f) photos.push(f);
    }
    const id = core.createQuoteRequest({ name, email: em, phone: ph, service_id: serviceId, segment, message: msg, address: str(b.address, { max: 250 }), photos, lang: c.lang });
    c.res.json({ ok: true, id });
  });

  // ---------------------------------------------------------------- auth
  app.post('/api/auth/register', async (c) => {
    rateLimit(`reg:${c.ip}`, 10, 3600000);
    const b = c.body;
    const name = str(b.name, { required: true, min: 2, max: 120, label: 'Name' });
    const em = email(b.email), ph = phone(b.phone, false);
    auth.checkPasswordStrength(b.password);
    const hash = await auth.hashPassword(b.password);
    const { user } = core.registerCustomer({ name, email: em, phone: ph, password_hash: hash, referral_code: str(b.referral_code, { max: 20 }), lang: c.lang });
    await startSession(c, user);
  });

  app.post('/api/auth/login', async (c) => {
    const em = email(c.body.email);
    rateLimit(`login:${c.ip}`, 30, 600000);
    rateLimit(`login:${em}`, 8, 600000);
    const u = get('SELECT * FROM users WHERE email=?', em);
    const ok = await auth.verifyPassword(String(c.body.password || ''), u ? u.password_hash : 'scrypt$00$00');
    if (!u || !ok || !u.active) throw new HttpError(401, 'Incorrect email or password');
    if (u.role === 'customer') run('UPDATE customers SET lang=? WHERE user_id=?', c.lang, u.id);
    await startSession(c, u);
  });

  app.post('/api/auth/logout', (c) => {
    auth.destroySession(c.req);
    c.res.json({ ok: true }, 200, { 'Set-Cookie': auth.cookieHeader('', c.req, true) });
  });

  app.get('/api/me', (c) => c.res.json({ user: userPayload(c.user) }));

  app.post('/api/auth/forgot', async (c) => {
    rateLimit(`forgot:${c.ip}`, 6, 3600000);
    const em = email(c.body.email);
    const u = get('SELECT * FROM users WHERE email=? AND active=1', em);
    if (u) {
      const token = uid(24);
      run('INSERT INTO reset_tokens(token_hash,user_id,expires_at) VALUES(?,?,?)', sha256(token), u.id, new Date(Date.now() + 3600000).toISOString());
      const cust = u.role === 'customer' ? core.customerForUser(u) : null;
      notify.send('password_reset', { customer: cust, email: u.email, channels: ['email'], vars: { name: core.firstName(u.name), link: `${c.base}/?reset=${token}` } });
    }
    c.res.json({ ok: true, message: 'If that email has an account, a reset link is on its way.' });
  });

  app.post('/api/auth/reset', async (c) => {
    rateLimit(`reset:${c.ip}`, 10, 3600000);
    auth.checkPasswordStrength(c.body.password);
    const t = get('SELECT * FROM reset_tokens WHERE token_hash=?', sha256(String(c.body.token || '')));
    if (!t || t.used || t.expires_at < nowISO()) throw bad('This reset link is invalid or has expired. Please request a new one.');
    run('UPDATE users SET password_hash=? WHERE id=?', await auth.hashPassword(c.body.password), t.user_id);
    run('UPDATE reset_tokens SET used=1 WHERE token_hash=?', t.token_hash);
    auth.destroyUserSessions(t.user_id);
    const u = get('SELECT * FROM users WHERE id=?', t.user_id);
    await startSession(c, u);
  });

  app.post('/api/auth/password', async (c) => {
    auth.need(c.user);
    const u = get('SELECT * FROM users WHERE id=?', c.user.id);
    if (!(await auth.verifyPassword(String(c.body.current || ''), u.password_hash))) throw new HttpError(400, 'Your current password is incorrect');
    auth.checkPasswordStrength(c.body.password);
    run('UPDATE users SET password_hash=? WHERE id=?', await auth.hashPassword(c.body.password), u.id);
    c.res.json({ ok: true });
  });
};

module.exports.saveImage = saveImage;
module.exports.userPayload = userPayload;
module.exports.publicSettings = publicSettings;
