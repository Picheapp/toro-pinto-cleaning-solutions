'use strict';
const { get, all, settings } = require('./db');
const { bad, json, tzNow } = require('./util');

const FREQS = ['once', 'weekly', 'biweekly', 'monthly'];

// ---------- coupons ----------
function findCoupon(codeRaw, subtotalCents, scope) {
  const code = String(codeRaw || '').trim();
  if (!code) return null;
  const c = get('SELECT * FROM coupons WHERE code=? AND active=1', code);
  if (!c) throw bad('That discount code is not valid', { Coupon: 'Invalid code' });
  const today = tzNow(settings().timezone).date;
  if (c.starts_on && today < c.starts_on) throw bad('That discount code is not active yet');
  if (c.ends_on && today > c.ends_on) throw bad('That discount code has expired');
  if (c.max_uses != null && c.uses >= c.max_uses) throw bad('That discount code has been fully redeemed');
  if (c.applies_to !== 'all' && c.applies_to !== scope) throw bad(`That code only applies to ${c.applies_to}`);
  if (subtotalCents < c.min_cents) throw bad(`That code needs a minimum of $${(c.min_cents / 100).toFixed(2)}`);
  const amount = c.type === 'percent' ? Math.round((subtotalCents * c.value) / 100) : c.value;
  return { coupon: c, discount_cents: Math.min(amount, subtotalCents) };
}

function pointsValue(points, availablePoints, capCents) {
  const L = settings().loyalty;
  points = Math.max(0, Math.floor(points || 0));
  if (!points) return { points: 0, cents: 0 };
  if (points > availablePoints) throw bad('You do not have that many points');
  if (points < L.min_redeem) throw bad(`Minimum redemption is ${L.min_redeem} points`);
  const blocks = Math.floor(points / L.redeem_points);
  let cents = blocks * L.redeem_value_cents;
  let usedPoints = blocks * L.redeem_points;
  if (cents > capCents) {
    const maxBlocks = Math.floor(capCents / L.redeem_value_cents);
    cents = maxBlocks * L.redeem_value_cents;
    usedPoints = maxBlocks * L.redeem_points;
  }
  return { points: usedPoints, cents };
}

// ---------- service estimate ----------
// input: { service_id, segment, sqft, rooms, condition, frequency, addon_ids[], coupon_code, use_points, force_quote }
// ctx:   { customer } (optional) — enables membership discount + loyalty points
function estimate(input, ctx = {}) {
  const S = settings();
  const service = get('SELECT * FROM services WHERE id=? AND active=1', Number(input.service_id));
  if (!service) throw bad('Please choose a service');
  const segment = input.segment === 'commercial' ? 'commercial' : 'residential';
  if (service.segments !== 'both' && service.segments !== segment) throw bad(`This service is only available for ${service.segments} properties`);
  const frequency = FREQS.includes(input.frequency) ? input.frequency : 'once';
  if (frequency !== 'once' && !service.recurring_ok) throw bad('This service is not available as a recurring plan');
  const condition = input.condition === 'heavy' ? 'heavy' : 'standard';
  const sqft = Math.max(0, Math.floor(Number(input.sqft) || 0));
  const rooms = Math.max(0, Math.floor(Number(input.rooms) || 0));

  const addonIds = [...new Set((input.addon_ids || []).map(Number).filter(Boolean))];
  const addons = addonIds.length
    ? all(`SELECT * FROM addons WHERE active=1 AND id IN (${addonIds.map(() => '?').join(',')}) AND (service_id=? OR category_id=?)`, ...addonIds, service.id, service.category_id)
    : [];

  const out = {
    service_id: service.id, service_name: service.name, segment, frequency, condition, sqft, rooms,
    custom_quote: false, reason: null, lines: [], addons: addons.map((a) => ({ id: a.id, name: a.name, price_cents: a.price_cents })),
  };

  if (service.pricing_type === 'quote' || input.force_quote) {
    out.custom_quote = true; out.reason = service.pricing_type === 'quote' ? 'This service is priced after a quick review of the job.' : 'You asked for a custom quote.';
    return out;
  }
  if (service.pricing_type === 'sqft') {
    if (sqft < 1) throw bad('Enter the approximate square footage', { sqft: 'Required' });
    if (sqft > S.max_auto_sqft) { out.custom_quote = true; out.reason = 'Large properties are quoted individually.'; return out; }
  }
  if (service.pricing_type === 'room') {
    if (rooms < 1) throw bad('Enter the number of rooms', { rooms: 'Required' });
    if (rooms > S.max_auto_rooms) { out.custom_quote = true; out.reason = 'Large properties are quoted individually.'; return out; }
  }

  let base = service.base_cents;
  if (service.pricing_type === 'sqft') base += service.unit_cents * sqft;
  if (service.pricing_type === 'room') base += service.unit_cents * rooms;
  base = Math.max(base, service.min_cents);
  out.lines.push({ label: service.name, cents: base });

  let serviceCents = base;
  if (segment === 'commercial' && S.commercial_multiplier !== 1) {
    const add = Math.round(base * (S.commercial_multiplier - 1));
    if (add) { out.lines.push({ label: 'Commercial rate', cents: add }); serviceCents += add; }
  }
  const condMult = S.condition_multipliers[condition] || 1;
  if (condMult !== 1) {
    const add = Math.round(serviceCents * (condMult - 1));
    out.lines.push({ label: 'Heavy soil / extra effort', cents: add }); serviceCents += add;
  }
  for (const a of addons) out.lines.push({ label: a.name, cents: a.price_cents });
  const addonsCents = addons.reduce((s, a) => s + a.price_cents, 0);

  let remaining = serviceCents + addonsCents;
  const discounts = [];
  const push = (label, cents) => { if (cents > 0) { discounts.push({ label, cents }); remaining -= cents; } };

  if (frequency !== 'once') {
    const pct = S.frequency_discounts[frequency] || 0;
    push(`${frequency[0].toUpperCase() + frequency.slice(1)} plan (${pct}% off service)`, Math.round((serviceCents * pct) / 100));
  }
  const customer = ctx.customer;
  if (customer) {
    const m = get(`SELECT p.discount_pct, p.name FROM memberships m JOIN membership_plans p ON p.id=m.plan_id WHERE m.customer_id=? AND m.status='active'`, customer.id);
    if (m && m.discount_pct) push(`${m.name} member (${m.discount_pct}% off)`, Math.round((remaining * m.discount_pct) / 100));
  }
  let couponApplied = null;
  if (input.coupon_code) {
    const r = findCoupon(input.coupon_code, remaining, 'services');
    couponApplied = r.coupon.code;
    push(`Code ${r.coupon.code}`, r.discount_cents);
  }
  let pointsUsed = 0;
  if (customer && input.use_points) {
    const pv = pointsValue(Number(input.use_points), customer.loyalty_points, remaining);
    pointsUsed = pv.points;
    push(`Loyalty points (${pv.points} pts)`, pv.cents);
  }
  const taxable = Math.max(0, remaining);
  const tax = Math.round((taxable * S.tax_rate) / 100);
  const total = taxable + tax;
  const deposit = Math.min(total, Math.max(S.min_deposit_cents, Math.round((total * S.deposit_pct) / 100)));

  Object.assign(out, {
    discounts, coupon_code: couponApplied, points_used: pointsUsed,
    gross_cents: serviceCents + addonsCents, service_cents: serviceCents, addons_cents: addonsCents,
    subtotal_cents: taxable, tax_rate: S.tax_rate, tax_cents: tax, total_cents: total, deposit_cents: deposit,
  });
  return out;
}

// Smart recommendations: complementary services + add-ons for the chosen service
function recommendations(serviceId) {
  const s = get('SELECT * FROM services WHERE id=?', Number(serviceId));
  if (!s) return { services: [], addons: [] };
  const slugs = json(s.recommend) || [];
  const services = slugs.length
    ? all(`SELECT id,slug,name,image,pricing_type,base_cents,unit_cents,min_cents FROM services WHERE active=1 AND slug IN (${slugs.map(() => '?').join(',')})`, ...slugs)
    : [];
  const addons = all('SELECT id,name,price_cents FROM addons WHERE active=1 AND (service_id=? OR category_id=?) ORDER BY sort,id', s.id, s.category_id);
  return { services, addons };
}

module.exports = { estimate, findCoupon, pointsValue, recommendations, FREQS };
