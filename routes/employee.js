'use strict';
const { get, all, run, insert, settings } = require('../lib/db');
const { HttpError, bad, str, oneOf, nowISO, tzNow, addDays, json } = require('../lib/util');
const auth = require('../lib/auth');
const core = require('../lib/core');
const { saveImage } = require('./public');

// Employees only ever see jobs assigned to them, and never prices or invoices.
function mine(c, id) {
  auth.need(c.user, 'employee', 'admin');
  const b = get('SELECT b.*, s.name service_name, s.name_es service_name_es, s.details service_details, s.details_es service_details_es FROM bookings b JOIN services s ON s.id=b.service_id WHERE b.id=?', Number(id));
  if (!b) throw new HttpError(404, 'Not found');
  if (c.user.role === 'employee' && !get('SELECT 1 x FROM booking_assignments WHERE booking_id=? AND employee_id=?', b.id, c.user.id)) throw new HttpError(404, 'Not found');
  return b;
}
const view = (b, full = false) => {
  const out = {
    id: b.id, code: b.code, service_name: b.service_name, service_name_es: b.service_name_es, segment: b.segment, date: b.date, slot: b.slot, status: b.status,
    address: b.address, city: b.city, zip: b.zip, access_notes: b.access_notes, notes: b.notes, contact_name: b.contact_name, contact_phone: b.contact_phone,
    sqft: b.sqft, rooms: b.rooms, condition: b.condition, addons: (json(b.addons) || []).map((a) => a.name), duration_min: undefined,
    photo_counts: { before: get(`SELECT COUNT(*) n FROM files WHERE booking_id=? AND kind='job_before'`, b.id).n, after: get(`SELECT COUNT(*) n FROM files WHERE booking_id=? AND kind='job_after'`, b.id).n },
  };
  if (full) {
    out.checklist = json(b.service_details) || []; out.checklist_es = json(b.service_details_es) || [];
    out.job_notes = all(`SELECT n.id,n.note,n.created_at,u.name author FROM job_notes n LEFT JOIN users u ON u.id=n.user_id WHERE n.booking_id=? ORDER BY n.id`, b.id);
    out.photos = all(`SELECT id,kind,created_at FROM files WHERE booking_id=? AND kind IN ('job_before','job_after') ORDER BY id`, b.id);
    out.internal_notes = b.internal_notes;
    out.crew = all(`SELECT u.name FROM booking_assignments a JOIN users u ON u.id=a.employee_id WHERE a.booking_id=?`, b.id).map((x) => x.name);
  }
  return out;
};

module.exports = function (app) {
  app.get('/api/employee/jobs', (c) => {
    auth.need(c.user, 'employee', 'admin');
    const S = settings();
    const today = tzNow(S.timezone).date;
    const from = c.query.from || today;
    const to = c.query.to || addDays(today, 14);
    const rows = c.user.role === 'admin'
      ? all(`SELECT b.*, s.name service_name, s.name_es service_name_es, s.details service_details, s.details_es service_details_es FROM bookings b JOIN services s ON s.id=b.service_id WHERE b.date BETWEEN ? AND ? AND b.status!='cancelled' ORDER BY b.date,b.slot`, from, to)
      : all(`SELECT b.*, s.name service_name, s.name_es service_name_es, s.details service_details, s.details_es service_details_es FROM bookings b JOIN services s ON s.id=b.service_id JOIN booking_assignments a ON a.booking_id=b.id WHERE a.employee_id=? AND b.date BETWEEN ? AND ? AND b.status!='cancelled' ORDER BY b.date,b.slot`, c.user.id, from, to);
    const stats = {
      today: rows.filter((r) => r.date === today).length,
      in_progress: rows.filter((r) => ['en_route', 'in_progress'].includes(r.status)).length,
      completed_week: get(`SELECT COUNT(*) n FROM bookings b JOIN booking_assignments a ON a.booking_id=b.id WHERE a.employee_id=? AND b.status='completed' AND b.completed_at >= ?`, c.user.id, new Date(Date.now() - 7 * 86400000).toISOString()).n,
    };
    c.res.json({ today, jobs: rows.map((b) => view(b)), stats });
  });

  app.get('/api/employee/jobs/:id', (c) => { const b = mine(c, c.params.id); c.res.json({ job: view(b, true) }); });

  app.post('/api/employee/jobs/:id/status', (c) => {
    const b = mine(c, c.params.id);
    const status = oneOf(c.body.status, ['en_route', 'in_progress', 'completed'], 'Status');
    const order = ['pending', 'confirmed', 'en_route', 'in_progress', 'completed'];
    if (b.status === 'cancelled') throw bad('This job was cancelled');
    if (order.indexOf(status) <= order.indexOf(b.status)) throw bad('That step was already done');
    if (b.status === 'pending') throw bad('This booking is not confirmed yet');
    if (status === 'completed' && !c.body.confirm) throw bad('Please confirm the job is complete');
    core.setBookingStatus(b.id, status, c.user.id);
    c.res.json({ ok: true, status });
  });

  app.post('/api/employee/jobs/:id/photos', (c) => {
    const b = mine(c, c.params.id);
    const kind = oneOf(c.body.kind, ['before', 'after'], 'Photo type');
    if (get(`SELECT COUNT(*) n FROM files WHERE booking_id=? AND kind LIKE 'job_%'`, b.id).n >= 30) throw bad('Photo limit reached for this job');
    const f = saveImage(c.body.data, { kind: `job_${kind}`, user_id: c.user.id, customer_id: b.customer_id, booking_id: b.id, attached: 1 });
    c.res.json({ id: f.id });
  }, { limit: 9_000_000 });

  app.post('/api/employee/jobs/:id/notes', (c) => {
    const b = mine(c, c.params.id);
    const note = str(c.body.note, { required: true, label: 'Note', max: 1000 });
    insert('INSERT INTO job_notes(booking_id,user_id,note,created_at) VALUES(?,?,?,?)', b.id, c.user.id, note, nowISO());
    c.res.json({ ok: true });
  });
};
