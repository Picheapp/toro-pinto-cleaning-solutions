'use strict';
const { get, all, settings } = require('./db');
const { tzNow, dow, addDays, minutesBetween, bad } = require('./util');

function dayConfig(date) {
  const S = settings();
  const h = S.hours[dow(date)];
  if (!h || !h.enabled) return null;
  if (S.blocked_dates.includes(date)) return null;
  return { slots: S.slots.filter((t) => t >= h.open && t < h.close) };
}

function slotsFor(date) {
  const S = settings();
  const now = tzNow(S.timezone);
  const cfg = dayConfig(date);
  if (!cfg) return [];
  if (date < now.date || date > addDays(now.date, S.max_days_ahead)) return [];
  const counts = Object.fromEntries(all(`SELECT slot, COUNT(*) n FROM bookings WHERE date=? AND status!='cancelled' GROUP BY slot`, date).map((r) => [r.slot, r.n]));
  return cfg.slots.map((slot) => {
    const notice = minutesBetween(now.date, now.time, date, slot) / 60;
    const used = counts[slot] || 0;
    const left = Math.max(0, S.crews - used);
    return { slot, left, available: left > 0 && notice >= S.lead_hours };
  });
}

// month = 'YYYY-MM' → { 'YYYY-MM-DD': { open:boolean, left:number } }
function calendar(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw bad('Invalid month');
  const out = {};
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let d = 1; d <= days; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const slots = slotsFor(date);
    const avail = slots.filter((s) => s.available);
    out[date] = { open: avail.length > 0, left: avail.reduce((s, x) => s + x.left, 0), slots: slots.length };
  }
  return out;
}

// Call inside a transaction right before inserting/moving a booking.
function assertSlotFree(date, slot, { ignoreBookingId = null, enforceLead = true, enforceDay = true } = {}) {
  const S = settings();
  if (enforceDay) {
    const cfg = dayConfig(date);
    if (!cfg || !cfg.slots.includes(slot)) throw bad('That date and time is not available. Please pick another.');
    const now = tzNow(S.timezone);
    if (date < now.date) throw bad('That date is in the past');
    if (enforceLead && minutesBetween(now.date, now.time, date, slot) / 60 < S.lead_hours) throw bad('That time is too soon. Please pick a later slot.');
  }
  const n = get(`SELECT COUNT(*) n FROM bookings WHERE date=? AND slot=? AND status!='cancelled' AND id!=?`, date, slot, ignoreBookingId || 0).n;
  if (n >= S.crews) throw bad('Sorry, that time was just taken. Please choose another slot.');
}

module.exports = { slotsFor, calendar, assertSlotFree, dayConfig };
