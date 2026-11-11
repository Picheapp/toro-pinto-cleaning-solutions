'use strict';
// Background automations (run every minute, all idempotent via notification dedupe keys).
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const { get, all, run, settings } = require('./db');
const { tzNow, addDays, minutesBetween, money, nowISO } = require('./util');
const core = require('./core');
const notify = require('./notify');

const log = (...a) => console.log('[jobs]', ...a);

// 1) appointment reminders
function reminders() {
  const S = settings();
  const now = tzNow(S.timezone);
  const rows = all(`SELECT b.*, s.name sname, s.name_es sname_es FROM bookings b JOIN services s ON s.id=b.service_id WHERE b.status IN ('pending','confirmed') AND b.date BETWEEN ? AND ?`, now.date, addDays(now.date, 2));
  for (const b of rows) {
    const hrs = minutesBetween(now.date, now.time, b.date, b.slot) / 60;
    if (hrs > 0 && hrs <= S.notifications.reminder_hours) {
      const c = get('SELECT * FROM customers WHERE id=?', b.customer_id);
      notify.send('appointment_reminder', { customer: c, vars: (lg) => ({ name: core.firstName(c.name), service: lg === 'es' ? b.sname_es || b.sname : b.sname, when: core.when(b, lg), when_short: lg === 'es' ? `${core.fmtTime(b.slot)}` : `at ${core.fmtTime(b.slot)}`, address: `${b.address}${b.city ? ', ' + b.city : ''}` }), dedupe: `rem:${b.id}:${b.date}:${b.slot}`, ref_type: 'booking', ref_id: b.id });
    }
  }
}

// 2) invoices: refresh statuses (draft/sent/overdue) + overdue reminders
function invoices() {
  const S = settings();
  const open = all(`SELECT id FROM invoices WHERE cancelled=0 AND is_draft=0 AND status!='paid'`);
  const today = tzNow(S.timezone).date;
  for (const { id } of open) {
    const inv = core.refreshInvoice(id);
    if (inv.status === 'overdue') {
      const every = S.notifications.overdue_every_days;
      const last = inv.last_overdue_notice ? inv.last_overdue_notice.slice(0, 10) : null;
      const due = !last || (Date.parse(today) - Date.parse(last)) / 86400000 >= every;
      if (due && inv.overdue_notices < S.notifications.overdue_max) {
        const c = get('SELECT * FROM customers WHERE id=?', inv.customer_id);
        notify.send('payment_overdue', { customer: c, vars: { name: core.firstName(c.name), number: inv.number, due: inv.due_date, balance: money(inv.total_cents - inv.paid_cents) }, dedupe: `od:${inv.id}:${inv.overdue_notices + 1}`, ref_type: 'invoice', ref_id: inv.id });
        run('UPDATE invoices SET overdue_notices=overdue_notices+1, last_overdue_notice=? WHERE id=?', nowISO(), inv.id);
      }
    }
  }
}

// 3) review requests after completed jobs
function reviewRequests() {
  const S = settings();
  const cutoff = new Date(Date.now() - S.notifications.review_delay_hours * 3600000).toISOString();
  const rows = all(`SELECT b.* FROM bookings b WHERE b.status='completed' AND b.completed_at <= ? AND b.completed_at >= ? AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.booking_id=b.id)`, cutoff, new Date(Date.now() - 14 * 86400000).toISOString());
  for (const b of rows) {
    const c = get('SELECT * FROM customers WHERE id=?', b.customer_id);
    notify.send('review_request', { customer: c, vars: { name: core.firstName(c.name) }, dedupe: `rev:${b.id}`, ref_type: 'booking', ref_id: b.id });
  }
}

// 4) inactive-customer follow-up campaign
function inactiveCampaign() {
  const S = settings();
  const days = S.notifications.inactive_days;
  const today = tzNow(S.timezone).date;
  const cutoff = addDays(today, -days);
  const rows = all(`SELECT c.* FROM customers c WHERE c.archived=0 AND c.marketing_opt_in=1 AND (c.email IS NOT NULL OR c.phone IS NOT NULL)
    AND EXISTS (SELECT 1 FROM bookings b WHERE b.customer_id=c.id AND b.status='completed')
    AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.customer_id=c.id AND b.status!='cancelled' AND b.date > ?)
    AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id=c.id AND o.created_at > ?)`, cutoff, cutoff + 'T00:00:00Z');
  let n = 0;
  const coupon = get(`SELECT * FROM coupons WHERE code='COMEBACK10' AND active=1`);
  for (const c of rows) {
    const key = `inactive:${c.id}:${today.slice(0, 4)}-${Math.floor(Number(today.slice(5, 7)) / 3)}`; // at most once per quarter
    const ids = notify.send('inactive_followup', { customer: c, vars: (lg) => ({ name: core.firstName(c.name), code: coupon?.code, offer: lg === 'es' ? '10% de descuento' : '10% off' }), dedupe: key });
    n += ids.length;
  }
  return n;
}

// 5) monthly membership invoices
function memberships() {
  const S = settings();
  const today = tzNow(S.timezone).date;
  for (const m of all(`SELECT m.*, p.name pname, p.price_cents FROM memberships m JOIN membership_plans p ON p.id=m.plan_id WHERE m.status='active' AND m.next_bill_date <= ?`, today)) {
    const c = get('SELECT * FROM customers WHERE id=?', m.customer_id);
    const id = core.createInvoice({ customer_id: m.customer_id, items: [{ kind: 'membership', description: `${m.pname} membership — ${m.next_bill_date}`, qty: 1, unit_cents: m.price_cents }], due_days: 5, notes: 'Monthly membership. Billed every 30 days until cancelled.' });
    run('UPDATE invoices SET sent_at=? WHERE id=?', nowISO(), id);
    const inv = core.refreshInvoice(id);
    run('UPDATE memberships SET next_bill_date=? WHERE id=?', addDays(m.next_bill_date, 30), m.id);
    notify.send('membership_invoice', { customer: c, vars: { name: core.firstName(c.name), plan: m.pname, number: inv.number, total: money(inv.total_cents) }, dedupe: `mem:${m.id}:${m.next_bill_date}`, ref_type: 'invoice', ref_id: id });
  }
}

// 6) housekeeping: expire unpaid orders (return stock), drop orphan uploads and stale pending payments
function housekeeping() {
  const cutoff = new Date(Date.now() - 3 * 3600000).toISOString();
  for (const o of all(`SELECT id FROM orders WHERE status='pending_payment' AND created_at < ?`, cutoff)) core.setOrderStatus(o.id, 'cancelled');
  run(`UPDATE payments SET status='expired' WHERE status='pending' AND created_at < ?`, new Date(Date.now() - 2 * 86400000).toISOString());
  const old = all(`SELECT id,name FROM files WHERE attached=0 AND created_at < ?`, new Date(Date.now() - 86400000).toISOString());
  for (const f of old) { try { fs.unlinkSync(path.join(cfg.dataDir, 'uploads', path.basename(f.name))); } catch {} run('DELETE FROM files WHERE id=?', f.id); }
  run('DELETE FROM sessions WHERE expires_at < ?', nowISO());
  run('DELETE FROM reset_tokens WHERE expires_at < ?', nowISO());
}

const TASKS = { reminders, invoices, reviewRequests, memberships, housekeeping };
function tick() {
  for (const [name, fn] of Object.entries(TASKS)) { try { fn(); } catch (e) { console.error(`[jobs] ${name} failed:`, e.message); } }
  notify.retryPending().catch(() => {});
}
let lastCampaignDay = '';
function daily() {
  const day = tzNow(settings().timezone).date;
  if (day !== lastCampaignDay) { lastCampaignDay = day; try { const n = inactiveCampaign(); if (n) log(`inactive campaign queued ${n} messages`); } catch (e) { console.error('[jobs] campaign failed', e.message); } }
}

function start() {
  if (process.env.DISABLE_JOBS === '1') return;
  setTimeout(() => { tick(); daily(); }, 5000).unref();
  setInterval(tick, 60000).unref();
  setInterval(daily, 3600000).unref();
}

module.exports = { start, tick, run: (name) => (name === 'inactiveCampaign' ? inactiveCampaign() : TASKS[name]()), TASKS: Object.keys(TASKS).concat(['inactiveCampaign']) };
