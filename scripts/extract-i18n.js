// Lists every translatable English key used by the frontend (t('…') calls and data-t* attributes).
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'public');
const keys = new Set();
const dec = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const unesc = (s, q) => s.replace(/\\(.)/g, (m, c) => (c === 'n' ? '\n' : c === q || c === '\\' || c === '`' || c === '$' ? c : m));
for (const f of fs.readdirSync(path.join(root, 'js')).filter((x) => x.endsWith('.js') && x !== 'es.js')) {
  const src = fs.readFileSync(path.join(root, 'js', f), 'utf8');
  for (const re of [/\bt\(\s*'((?:[^'\\\n]|\\.)*)'/g, /\bt\(\s*"((?:[^"\\\n]|\\.)*)"/g, /\bt\(\s*`((?:[^`\\$]|\\.)*)`/g]) {
    let m; while ((m = re.exec(src))) keys.add(unesc(m[1], re.source.includes("'") ? "'" : '"'));
  }
}
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const a of ['data-t', 'data-t-ph', 'data-t-aria']) { const re = new RegExp(`${a}="([^"]*)"`, 'g'); let m; while ((m = re.exec(html))) keys.add(dec(m[1])); }
// dynamic keys the regex cannot see
[
  'One-time', 'Weekly', 'Every 2 weeks', 'Monthly', 'Biweekly', 'Welcome back', 'Create your account', 'Reset your password', 'New password',
  'This service is priced after a quick review of the job.', 'Large properties are quoted individually.', 'You asked for a custom quote.',
  'Cash', 'Zelle', 'ATH Móvil', 'Check', 'Bank transfer', 'Card (external)', 'Other', 'Card', 'Demo',
  'Pending', 'Confirmed', 'On the way', 'In progress', 'Completed', 'Cancelled', 'Draft', 'Sent', 'Unpaid', 'Partially paid', 'Paid', 'Overdue',
  'Awaiting payment', 'Processing', 'Ready for pickup', 'Shipped', 'Delivered',
  'In Progress', 'New Lead', 'Contacted', 'Quote Sent', 'Awaiting Approval', 'Booked', 'Paid', 'VIP', 'Active', 'At risk', 'Inactive', 'New', 'Prospect',
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
  'House', 'Apartment / Condo', 'Townhouse', 'Vacation rental', 'Restaurant', 'Fast-food / Quick service', 'Retail store', 'Warehouse / Industrial', 'Medical / Clinic', 'School / Church',
  'Supplies', 'Fuel', 'Equipment', 'Payroll', 'Insurance', 'Marketing', 'Vehicle', 'Software',
  'Appointment reminders', 'Overdue invoice reminders', 'Review requests', 'Membership renewals', 'Housekeeping', 'Win-back campaign (inactive customers)',
].forEach((k) => keys.add(k));
const list = [...keys].filter((k) => k && k.trim()).sort();
if (process.argv[2] === '--missing') {
  const { ES } = (() => { const s = fs.readFileSync(path.join(root, 'js', 'es.js'), 'utf8').replace('export const ES =', 'module.exports = {ES:').replace(/;\s*$/, '}'); const m = { exports: {} }; new Function('module', s)(m); return m.exports; })();
  const miss = list.filter((k) => !(k in ES)); console.log(miss.length ? miss.join('\n') : 'ALL TRANSLATED'); console.error(`${miss.length} missing of ${list.length}`);
} else { fs.writeFileSync(path.join(__dirname, 'i18n-keys.json'), JSON.stringify(list, null, 1)); console.log(list.length + ' keys'); }
