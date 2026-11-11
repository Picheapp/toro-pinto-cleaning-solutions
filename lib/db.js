'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const cfg = require('./config');
const { json } = require('./util');

fs.mkdirSync(cfg.dataDir, { recursive: true });
fs.mkdirSync(path.join(cfg.dataDir, 'uploads'), { recursive: true });

const dbFile = process.env.DB_FILE || path.join(cfg.dataDir, 'toropinto.db');
const db = new DatabaseSync(dbFile);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('admin','employee','customer')),
  name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, phone TEXT, password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, employee_title TEXT, created_at TEXT NOT NULL, last_login TEXT);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, ip TEXT, ua TEXT);
CREATE TABLE IF NOT EXISTS reset_tokens(
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS customers(
  id INTEGER PRIMARY KEY, user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL, email TEXT COLLATE NOCASE, phone TEXT, company TEXT, notes TEXT, tags TEXT DEFAULT '', lang TEXT NOT NULL DEFAULT 'en',
  source TEXT, referral_code TEXT UNIQUE, referred_by INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  loyalty_points INTEGER NOT NULL DEFAULT 0, stripe_customer_id TEXT,
  marketing_opt_in INTEGER NOT NULL DEFAULT 1, whatsapp_opt_in INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE TABLE IF NOT EXISTS customer_notes(
  id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, note TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS addresses(
  id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label TEXT, line1 TEXT NOT NULL, line2 TEXT, city TEXT, zip TEXT, notes TEXT, is_default INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS categories(
  id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT, image TEXT, name_es TEXT, description_es TEXT,
  sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS services(
  id INTEGER PRIMARY KEY, category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT, image TEXT, name_es TEXT, description_es TEXT, details_es TEXT DEFAULT '[]',
  pricing_type TEXT NOT NULL CHECK(pricing_type IN ('sqft','room','flat','quote')),
  base_cents INTEGER NOT NULL DEFAULT 0, unit_cents INTEGER NOT NULL DEFAULT 0, min_cents INTEGER NOT NULL DEFAULT 0,
  segments TEXT NOT NULL DEFAULT 'both', duration_min INTEGER NOT NULL DEFAULT 120,
  details TEXT DEFAULT '[]', recommend TEXT DEFAULT '[]', recurring_ok INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS addons(
  id INTEGER PRIMARY KEY, category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  service_id INTEGER REFERENCES services(id) ON DELETE CASCADE, name TEXT NOT NULL, name_es TEXT, price_cents INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS membership_plans(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, price_cents INTEGER NOT NULL, discount_pct INTEGER NOT NULL DEFAULT 0,
  perks TEXT DEFAULT '[]', perks_es TEXT DEFAULT '[]', highlight INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS memberships(
  id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES membership_plans(id), status TEXT NOT NULL DEFAULT 'active',
  started_at TEXT NOT NULL, next_bill_date TEXT, cancelled_at TEXT);
CREATE TABLE IF NOT EXISTS leads(
  id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  name TEXT NOT NULL, email TEXT COLLATE NOCASE, phone TEXT, source TEXT, service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  segment TEXT, message TEXT, address TEXT, stage TEXT NOT NULL DEFAULT 'New Lead', quote_cents INTEGER,
  next_followup TEXT, notes TEXT, booking_id INTEGER, photos TEXT DEFAULT '[]', lost INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bookings(
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id), segment TEXT NOT NULL, property_type TEXT,
  address TEXT NOT NULL, city TEXT, zip TEXT, access_notes TEXT, sqft INTEGER, rooms INTEGER, condition TEXT DEFAULT 'standard',
  frequency TEXT NOT NULL DEFAULT 'once', series_id TEXT, date TEXT NOT NULL, slot TEXT NOT NULL,
  addons TEXT DEFAULT '[]', notes TEXT, contact_name TEXT, contact_phone TEXT, contact_email TEXT,
  estimate TEXT, total_cents INTEGER NOT NULL DEFAULT 0, deposit_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','en_route','in_progress','completed','cancelled')),
  coupon_code TEXT, invoice_id INTEGER, lead_id INTEGER, internal_notes TEXT, custom_quote INTEGER NOT NULL DEFAULT 0,
  created_by_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, completed_at TEXT);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date, slot);
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);
CREATE TABLE IF NOT EXISTS booking_assignments(
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(booking_id, employee_id));
CREATE TABLE IF NOT EXISTS booking_changes(
  id INTEGER PRIMARY KEY, booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL, type TEXT NOT NULL CHECK(type IN ('reschedule','cancel')), new_date TEXT, new_slot TEXT,
  reason TEXT, status TEXT NOT NULL DEFAULT 'pending', admin_note TEXT, created_at TEXT NOT NULL, resolved_at TEXT);
CREATE TABLE IF NOT EXISTS files(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, mime TEXT NOT NULL, size INTEGER NOT NULL,
  user_id INTEGER, customer_id INTEGER, booking_id INTEGER, lead_id INTEGER, kind TEXT NOT NULL,
  attached INTEGER NOT NULL DEFAULT 0, anon_key TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS job_notes(
  id INTEGER PRIMARY KEY, booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, note TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, category TEXT NOT NULL DEFAULT 'Supplies', name TEXT NOT NULL,
  description TEXT, image TEXT, name_es TEXT, description_es TEXT, category_es TEXT, is_bundle INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS variants(
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Standard', name_es TEXT, sku TEXT, price_cents INTEGER NOT NULL, compare_cents INTEGER,
  stock INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS bundle_items(
  bundle_variant_id INTEGER NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  variant_id INTEGER NOT NULL REFERENCES variants(id) ON DELETE CASCADE, qty INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(bundle_variant_id, variant_id));
CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  invoice_id INTEGER, status TEXT NOT NULL DEFAULT 'pending_payment', fulfillment TEXT NOT NULL DEFAULT 'pickup',
  ship_name TEXT, ship_line1 TEXT, ship_city TEXT, ship_zip TEXT, ship_phone TEXT, notes TEXT,
  subtotal_cents INTEGER NOT NULL DEFAULT 0, discount_cents INTEGER NOT NULL DEFAULT 0, shipping_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0, total_cents INTEGER NOT NULL DEFAULT 0, coupon_code TEXT,
  tracking_number TEXT, carrier TEXT, stock_released INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, paid_at TEXT);
CREATE TABLE IF NOT EXISTS order_items(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id INTEGER REFERENCES variants(id) ON DELETE SET NULL, product_name TEXT NOT NULL, variant_name TEXT,
  qty INTEGER NOT NULL, unit_cents INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS invoices(
  id INTEGER PRIMARY KEY, number TEXT NOT NULL UNIQUE, customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  booking_id INTEGER, order_id INTEGER, status TEXT NOT NULL DEFAULT 'draft', is_draft INTEGER NOT NULL DEFAULT 0,
  cancelled INTEGER NOT NULL DEFAULT 0, sent_at TEXT, issue_date TEXT NOT NULL, due_date TEXT NOT NULL,
  subtotal_cents INTEGER NOT NULL DEFAULT 0, discount_cents INTEGER NOT NULL DEFAULT 0, tax_rate REAL NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0, total_cents INTEGER NOT NULL DEFAULT 0, paid_cents INTEGER NOT NULL DEFAULT 0,
  deposit_cents INTEGER NOT NULL DEFAULT 0, notes TEXT, terms TEXT, created_at TEXT NOT NULL, paid_at TEXT,
  overdue_notices INTEGER NOT NULL DEFAULT 0, last_overdue_notice TEXT);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE TABLE IF NOT EXISTS invoice_items(
  id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'service', description TEXT NOT NULL, qty REAL NOT NULL DEFAULT 1,
  unit_cents INTEGER NOT NULL DEFAULT 0, total_cents INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS payments(
  id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL, amount_cents INTEGER NOT NULL, method TEXT NOT NULL, provider TEXT,
  provider_ref TEXT UNIQUE, intent_ref TEXT, status TEXT NOT NULL DEFAULT 'pending', purpose TEXT, note TEXT,
  created_at TEXT NOT NULL, paid_at TEXT, recorded_by INTEGER);
CREATE TABLE IF NOT EXISTS coupons(
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE COLLATE NOCASE, description TEXT,
  type TEXT NOT NULL CHECK(type IN ('percent','fixed')), value INTEGER NOT NULL, min_cents INTEGER NOT NULL DEFAULT 0,
  applies_to TEXT NOT NULL DEFAULT 'all' CHECK(applies_to IN ('all','services','products')),
  starts_on TEXT, ends_on TEXT, max_uses INTEGER, uses INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS expenses(
  id INTEGER PRIMARY KEY, date TEXT NOT NULL, category TEXT NOT NULL, vendor TEXT, description TEXT,
  amount_cents INTEGER NOT NULL, created_by INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reviews(
  id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL, booking_id INTEGER UNIQUE,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), comment TEXT, name_display TEXT, verified INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1, is_demo INTEGER NOT NULL DEFAULT 0, reply TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS gallery(
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, title_es TEXT, caption_es TEXT, before_img TEXT NOT NULL, after_img TEXT NOT NULL, caption TEXT,
  is_sample INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL, user_id INTEGER, body TEXT NOT NULL, created_at TEXT NOT NULL,
  read_by_admin INTEGER NOT NULL DEFAULT 0, read_by_customer INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY, customer_id INTEGER, channel TEXT NOT NULL, template TEXT NOT NULL, to_addr TEXT, subject TEXT, body TEXT,
  status TEXT NOT NULL DEFAULT 'queued', error TEXT, dedupe_key TEXT UNIQUE, ref_type TEXT, ref_id INTEGER,
  created_at TEXT NOT NULL, sent_at TEXT);
CREATE TABLE IF NOT EXISTS loyalty_ledger(
  id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  points INTEGER NOT NULL, reason TEXT NOT NULL, ref TEXT UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log(
  id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;
db.exec(SCHEMA);

// ---------- helpers ----------
const cache = new Map();
function prep(sql) {
  let s = cache.get(sql);
  if (!s) { s = db.prepare(sql); cache.set(sql, s); }
  return s;
}
const clean = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
const get = (sql, ...p) => prep(sql).get(...clean(p));
const all = (sql, ...p) => prep(sql).all(...clean(p));
const run = (sql, ...p) => prep(sql).run(...clean(p));
const insert = (sql, ...p) => Number(prep(sql).run(...clean(p)).lastInsertRowid);

let depth = 0;
function tx(fn) {
  if (depth > 0) return fn(); // nested: join outer transaction
  db.exec('BEGIN IMMEDIATE');
  depth++;
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
  finally { depth--; }
}

// ---------- settings ----------
const DEFAULTS = require('./defaults');
let settingsCache = null;
function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) out[k] = k in base && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? deepMerge(base[k], over[k]) : over[k];
  return out;
}
function settings() {
  if (settingsCache) return settingsCache;
  const stored = {};
  for (const r of all('SELECT key, value FROM settings')) stored[r.key] = json(r.value);
  settingsCache = deepMerge(DEFAULTS, stored);
  return settingsCache;
}
function saveSettings(patch) {
  tx(() => {
    for (const [k, v] of Object.entries(patch)) {
      const cur = settings()[k];
      const next = cur && typeof cur === 'object' && !Array.isArray(cur) && v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(cur, v) : v;
      run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, JSON.stringify(next));
    }
  });
  settingsCache = null;
  return settings();
}

function audit(userId, action, detail) {
  run('INSERT INTO audit_log(user_id,action,detail,created_at) VALUES(?,?,?,?)', userId || null, action, detail ? String(detail).slice(0, 500) : null, new Date().toISOString());
}

module.exports = { db, get, all, run, insert, tx, settings, saveSettings, audit, dbFile };
