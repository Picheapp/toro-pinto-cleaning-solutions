'use strict';
const crypto = require('crypto');

class HttpError extends Error {
  constructor(status, message, fields) { super(message); this.status = status; this.fields = fields; }
}
const bad = (msg, fields) => new HttpError(400, msg, fields);

const uid = (n = 16) => crypto.randomBytes(n).toString('hex');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const nowISO = () => new Date().toISOString();

// Human-friendly codes without look-alike characters
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function code(prefix, len = 6) {
  let s = '';
  const b = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) s += ALPHA[b[i] % ALPHA.length];
  return prefix ? `${prefix}-${s}` : s;
}

const money = (c) => '$' + (Number(c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toCents = (v) => Math.round(Number(v) * 100);

// ---------- validation ----------
function str(v, { min = 0, max = 500, required = false, label = 'Field' } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string' && typeof v !== 'number') throw bad(`${label} is invalid`);
  v = String(v).trim();
  if (required && !v) throw bad(`${label} is required`, { [label]: 'Required' });
  if (v && v.length < min) throw bad(`${label} is too short`);
  if (v.length > max) throw bad(`${label} is too long`);
  return v;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function email(v, required = true) {
  v = str(v, { max: 200, required, label: 'Email' }).toLowerCase();
  if (v && !EMAIL_RE.test(v)) throw bad('Enter a valid email address', { Email: 'Invalid' });
  return v;
}
function phone(v, required = false) {
  v = str(v, { max: 40, required, label: 'Phone' });
  if (v && v.replace(/\D/g, '').length < 7) throw bad('Enter a valid phone number', { Phone: 'Invalid' });
  return v;
}
function int(v, { min = -Infinity, max = Infinity, def = null, label = 'Number' } = {}) {
  if (v === undefined || v === null || v === '') { if (def !== null) return def; throw bad(`${label} is required`); }
  const n = Number(v);
  if (!Number.isFinite(n) || Math.floor(n) !== n) throw bad(`${label} must be a whole number`);
  if (n < min || n > max) throw bad(`${label} is out of range`);
  return n;
}
function num(v, { min = -Infinity, max = Infinity, def = null, label = 'Number' } = {}) {
  if (v === undefined || v === null || v === '') { if (def !== null) return def; throw bad(`${label} is required`); }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`${label} is invalid`);
  return n;
}
function date(v, label = 'Date') {
  v = String(v || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v + 'T12:00:00Z'))) throw bad(`${label} is invalid`);
  return v;
}
function oneOf(v, list, label = 'Value') {
  if (!list.includes(v)) throw bad(`${label} is invalid`);
  return v;
}
const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

// ---------- time (business timezone) ----------
function tzNow(tz = 'America/Puerto_Rico') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
const dow = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
function addDays(d, n) { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function minutesBetween(d1, t1, d2, t2) { return (Date.parse(`${d2}T${t2}:00Z`) - Date.parse(`${d1}T${t1}:00Z`)) / 60000; }

// ---------- rate limiting (in-memory, per process) ----------
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.n++;
  if (b.n > max) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
}
setInterval(() => { const n = Date.now(); for (const [k, b] of buckets) if (b.reset < n) buckets.delete(k); }, 60000).unref();

// ---------- CSV (with spreadsheet-formula injection protection) ----------
function csv(rows, cols) {
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.map((c) => cell(c.label)).join(',')].concat(rows.map((r) => cols.map((c) => cell(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','))).join('\r\n');
}

const json = (s) => { try { return JSON.parse(s); } catch { return null; } };

module.exports = { HttpError, bad, uid, sha256, nowISO, code, money, toCents, str, email, phone, int, num, date, oneOf, bool, tzNow, dow, addDays, minutesBetween, rateLimit, csv, json };
