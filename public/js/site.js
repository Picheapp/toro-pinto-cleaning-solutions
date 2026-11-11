// Public one-page site: hero, trust, services, plans, gallery, reviews, rewards, area, FAQ, footer.
import { S, t, tl, tlist, html, raw, mount, $, $$, icon, stars, post, money, num, fmtDate, toast, act, form, onLang, openModal, closeAllModals, findSvc, findCat, svcName, LS, phoneHref, waLink, confirmDialog, scrollToEl } from './core.js';
import { startBooking, startPrice, renderQuoteSection } from './booking.js';
import { addToCart } from './shop.js';
import { openAuth, onAuthed } from './auth.js';

const V = { cat: 'all', segment: 'residential' };
const B = () => S.settings.business;

export function renderSite() {
  renderPromo(); renderHero(); renderTrust(); renderServices(); renderPlans(); renderGallery(); renderReviews(); renderRewards(); renderArea(); renderFaq(); renderFooter(); renderQuoteSection();
  const phone = B().phone; const np = $('#nav-phone'); if (np) { np.href = phoneHref(phone); np.querySelector('span').textContent = phone; }
  const wa = $('#wa-fab'); if (wa) wa.href = waLink('');
  const badge = $('#hero-badge'); if (badge) badge.textContent = (S.lang === 'es' ? B().license_note_es : B().license_note) || t('Licensed & Insured');
}
export function initSite() { onLang(renderSite); renderSite(); }

function renderPromo() {
  const host = $('#promo'); const p = (S.boot.promos || [])[0];
  if (!p || LS.get('tp_promo') === p.id) { host.hidden = true; return; }
  host.hidden = false;
  mount(host, html`${S.lang === 'es' && p.text_es ? p.text_es : p.text}${p.code && !(S.lang === 'es' && p.text_es ? p.text_es : p.text).includes(p.code) ? html` <b>${p.code}</b>` : ''}<button type="button" data-act="promo-x" aria-label="${t('Close')}">${icon('x')}</button>`);
}
act('promo-x', () => { const p = (S.boot.promos || [])[0]; if (p) LS.set('tp_promo', p.id); $('#promo').hidden = true; });

function renderHero() {
  const site = S.settings.site;
  $('#hero-title').textContent = tl(site, 'hero_title') || t('A Cleaner Space. A Better Life.');
  $('#hero-sub').textContent = tl(site, 'hero_sub');
  const sel = $('#hero-service'); const cur = sel.value;
  mount(sel, html`${S.cat.categories.map((c) => html`<optgroup label="${tl(c, 'name')}">${S.cat.services.filter((s) => s.category_id === c.id).map((s) => html`<option value="${s.id}">${svcName(s)}</option>`)}</optgroup>`)}`);
  if (cur) sel.value = cur;
  $$('#hero-form [data-act=hero-seg]').forEach((b) => b.classList.toggle('on', b.dataset.v === V.segment));
}
act('hero-seg', (el) => { V.segment = el.dataset.v; $$('#hero-form [data-act=hero-seg]').forEach((b) => b.classList.toggle('on', b === el)); });
form('hero', (d) => { startBooking({ service_id: Number(d.service_id), segment: V.segment }); });

function renderTrust() {
  const st = S.boot.stats || {}; const items = [
    { i: 'shield', b: t('Licensed & Insured'), s: t('Peace of mind on every job') },
    { i: 'dollar', b: t('Free quotes'), s: t('Clear pricing, no surprises') },
    { i: 'globe', b: t('Bilingual team'), s: t('Se habla español') },
  ];
  if (st.review_count >= 3 && st.rating) items.push({ i: 'star', b: `${st.rating} / 5`, s: t('{n} verified reviews', { n: st.review_count }) });
  else if (st.jobs_completed >= 25) items.push({ i: 'award', b: `${num(st.jobs_completed)}+`, s: t('Jobs completed') });
  else items.push({ i: 'lock', b: t('Secure payments'), s: t('Card, Apple Pay & Google Pay') });
  mount('#trust', html`${items.map((x) => html`<div class="trust-i">${icon(x.i)}<div><b>${x.b}</b><span>${x.s}</span></div></div>`)}`);
}

// ---------------------------------------------------------------- services
function renderServices() {
  mount('#svc-chips', html`<button class="chip ${V.cat === 'all' ? 'on' : ''}" data-act="svc-cat" data-v="all">${t('All services')}</button>${S.cat.categories.map((c) => html`<button class="chip ${String(V.cat) === String(c.id) ? 'on' : ''}" data-act="svc-cat" data-v="${c.id}">${tl(c, 'name')}</button>`)}`);
  const list = S.cat.services.filter((s) => V.cat === 'all' || s.category_id === Number(V.cat));
  mount('#svc-grid', html`${list.map((s) => { const p = startPrice(s); return html`<article class="card svc">
    <div class="svc-img" style="background-image:url('${s.image}')" role="img" aria-label="${svcName(s)}"><span class="tag">${tl(findCat(s.category_id), 'name')}</span></div>
    <div class="svc-body"><h3>${svcName(s)}</h3><p>${tl(s, 'description')}</p>
      <div class="price">${p.custom ? p.text : html`${p.text}${s.pricing_type === 'sqft' ? html` <small>/ ${t('size-based')}</small>` : ''}`}</div>
      <div class="svc-actions"><button class="btn btn-ghost btn-sm" data-act="svc-detail" data-id="${s.id}">${t('Details')}</button><button class="btn btn-primary btn-sm" data-act="svc-book" data-id="${s.id}">${p.custom ? t('Get a quote') : t('Book now')}</button></div></div></article>`; })}`);
}
act('svc-cat', (el) => { V.cat = el.dataset.v; renderServices(); });
act('svc-book', (el) => { startBooking({ service_id: Number(el.dataset.id) }); });
act('svc-detail', (el) => {
  const s = findSvc(el.dataset.id); const p = startPrice(s);
  const addons = S.cat.addons.filter((a) => a.service_id === s.id || (a.category_id === s.category_id && !a.service_id));
  const m = openModal(html`<div class="svc-img" style="background-image:url('${s.image}');border-radius:14px;margin-bottom:1rem"></div>
    <p>${tl(s, 'description')}</p>
    <h4 style="margin:1rem 0 .4rem">${t("What's included")}</h4><ul class="stack" style="list-style:none;padding:0">${tlist(s, 'details').map((d) => html`<li class="row" style="flex-wrap:nowrap;align-items:flex-start">${icon('check')}<span>${d}</span></li>`)}</ul>
    ${addons.length ? html`<h4 style="margin:1rem 0 .4rem">${t('Available add-ons')}</h4><div class="list">${addons.map((a) => html`<div class="li"><span>${tl(a, 'name')}</span><b>+${money(a.price_cents)}</b></div>`)}</div>` : ''}
    <div class="row between" style="margin-top:1.2rem"><div><div class="price">${p.text}</div><small class="muted">${s.duration_min ? t('About {h} hours', { h: Math.max(1, Math.round(s.duration_min / 60 * 2) / 2) }) : ''}</small></div>
      <button class="btn btn-primary" data-act="svc-book-close" data-id="${s.id}">${p.custom ? t('Get a quote') : t('Book now')}</button></div>`, { title: svcName(s), size: 'wide' });
  m.el.dataset.svc = s.id;
});
act('svc-book-close', (el) => { closeAllModals(); startBooking({ service_id: Number(el.dataset.id) }); });

// ---------------------------------------------------------------- plans
function renderPlans() {
  const fd = S.settings.frequency_discounts;
  mount('#freq', html`${['weekly', 'biweekly', 'monthly'].map((f) => html`<div class="card fcard"><b>${fd[f]}%</b><h3>${t({ weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly' }[f])}</h3><p class="muted tiny">${t('off recurring services')}</p></div>`)}`);
  mount('#plan-grid', html`${S.cat.plans.map((p) => html`<div class="card plan ${p.highlight ? 'hl' : ''}">${p.highlight ? html`<span class="ribbon">${t('Most popular')}</span>` : ''}
    <h3>${p.name}</h3><div class="price">${money(p.price_cents)} <small>/ ${t('month')}</small></div>
    <ul>${(S.lang === 'es' && p.perks_es.length ? p.perks_es : p.perks).map((x) => html`<li>${icon('check')}<span>${x}</span></li>`)}</ul>
    <button class="btn ${p.highlight ? 'btn-primary' : 'btn-navy'} btn-block" data-act="plan-sub" data-id="${p.id}">${t('Join {plan}', { plan: p.name })}</button></div>`)}`);
}
act('plan-sub', async (el) => {
  const id = Number(el.dataset.id);
  if (S.user?.role !== 'customer') { openAuth('register'); toast(t('Create an account to join a plan.')); const un = onAuthed((u) => { un(); if (u?.role === 'customer') subscribe(id); }); return; }
  await subscribe(id);
});
async function subscribe(id) {
  const plan = S.cat.plans.find((p) => p.id === id);
  if (!(await confirmDialog(t('Join {plan} for {price} per month?', { plan: plan.name, price: money(plan.price_cents) }), { ok: t('Continue to payment') }))) return;
  const r = await post('/api/membership/subscribe', { plan_id: id });
  const p = await post('/api/pay/checkout', { invoice_id: r.invoice_id, purpose: 'full' }); location.href = p.url;
}

// ---------------------------------------------------------------- gallery
function renderGallery() {
  const g = S.cat.gallery;
  mount('#gallery-grid', g.length ? html`${g.map((x) => html`<figure><div class="ba" data-ba style="--pos:50%"><img src="${x.before_img}" alt="${t('Before')}: ${tl(x, 'title')}" loading="lazy"><img class="after" src="${x.after_img}" alt="${t('After')}: ${tl(x, 'title')}" loading="lazy">
    <span class="lb b">${t('Before')}</span><span class="lb a">${t('After')}</span><div class="handle"><i>↔</i></div><input type="range" min="0" max="100" value="50" aria-label="${t('Before and after slider')}"></div>
    <figcaption class="cap"><b>${tl(x, 'title')}</b>${tl(x, 'caption') ? html` — ${tl(x, 'caption')}` : ''}</figcaption></figure>`)}` : html`<div class="empty">${t('Job photos coming soon.')}</div>`);
  mount('#trailer', html`${[1, 2, 3].map((n) => html`<img src="/img/trailer-${n}-sm.jpg" alt="${t('Toro Pinto mobile cleaning trailer')}" loading="lazy" width="400" height="400">`)}`);
}
document.addEventListener('input', (e) => { const r = e.target; if (r.matches('.ba input[type=range]')) r.closest('.ba').style.setProperty('--pos', r.value + '%'); });

// ---------------------------------------------------------------- reviews
function renderReviews() {
  const R = S.boot.reviews || { items: [], count: 0 };
  if (!R.count) return mount('#reviews-body', html`<div class="empty card pad"><div class="stars">${stars(5)}</div><h3 style="margin:.5rem 0">${t('Be our first review')}</h3><p>${t('Reviews on this page come only from verified customers after a completed service.')}</p><a class="btn btn-primary" href="#book" style="margin-top:1rem">${t('Book a cleaning')}</a></div>`);
  mount('#reviews-body', html`<div class="row" style="justify-content:center;margin-bottom:1.2rem"><b style="font:800 2rem var(--head)">${R.avg}</b>${stars(R.avg)}<span class="muted">${t('{n} verified reviews', { n: R.count })}</span></div>
    <div class="rev-grid">${R.items.map((r) => html`<article class="card rev">${stars(r.rating)}<p>${r.comment || ''}</p><div class="row between"><b>${r.name}</b><span class="bdg ok">${icon('check')} ${t('Verified customer')}</span></div>${r.reply ? html`<div class="alert"><b>${t('Toro Pinto')}:</b> ${r.reply}</div>` : ''}</article>`)}</div>`);
}

// ---------------------------------------------------------------- rewards
function renderRewards() {
  const L = S.settings.loyalty, R = S.settings.referral;
  mount('#rewards-body', html`
    <div class="reward">${icon('award')}<h3>${t('Earn points')}</h3><p>${t('Earn {n} point per $1 on every service and product order.', { n: L.points_per_dollar })}</p></div>
    <div class="reward">${icon('gift')}<h3>${t('Redeem for savings')}</h3><p>${t('Every {pts} points = {amt} off your next booking or order.', { pts: L.redeem_points, amt: money(L.redeem_value_cents) })}</p></div>
    <div class="reward">${icon('users')}<h3>${t('Refer a friend')}</h3><p>${t('Share your code: you get {a} points and your friend gets {b} points after their first payment.', { a: num(R.referrer_points), b: num(R.referred_points) })}</p><button class="btn btn-primary btn-sm" data-act="account" style="width:max-content">${S.user ? t('See my code') : t('Join free')}</button></div>`);
}

// ---------------------------------------------------------------- service area
function renderArea() {
  const site = S.settings.site; const areas = site.service_areas || []; const label = site.service_area_label || 'Puerto Rico';
  const q = encodeURIComponent(label + (label.toLowerCase().includes('puerto') ? '' : ', Puerto Rico'));
  const src = S.cfg.mapsKey ? `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(S.cfg.mapsKey)}&q=${q}` : `https://maps.google.com/maps?q=${q}&z=9&output=embed`;
  mount('#area-body', html`<div class="stack"><div class="card pad"><h3>${t('We come to you')}</h3><p class="muted" style="margin:.5rem 0 1rem">${t('Our fully equipped mobile unit travels to homes and businesses across {area}.', { area: label })}</p>
    ${areas.length ? html`<div class="tags">${areas.map((a) => html`<span class="tag-s">${a}</span>`)}</div>` : ''}
    <div class="divider"></div><div class="row"><a class="btn btn-ghost" href="${phoneHref(B().phone)}">${icon('phone')} ${B().phone}</a><a class="btn btn-ghost" href="${waLink(t('Hi Toro Pinto, do you service my area?'))}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp</a></div></div></div>
    <div class="map"><iframe title="${t('Service area map')}" src="${src}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe></div>`);
}

function renderFaq() {
  const f = S.settings.site.faqs || [];
  mount('#faq-body', html`${f.map((x, i) => html`<details ${i === 0 ? 'open' : ''}><summary>${S.lang === 'es' && x.q_es ? x.q_es : x.q}</summary><p>${S.lang === 'es' && x.a_es ? x.a_es : x.a}</p></details>`)}`);
}

function renderFooter() {
  const b = B(); const h = S.settings.hours; const days = [1, 2, 3, 4, 5, 6, 0];
  const dn = (i) => new Intl.DateTimeFormat(S.lang === 'es' ? 'es-PR' : 'en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + i, 12)));
  const open = days.filter((d) => h[d]?.enabled);
  mount('#foot', html`<div class="wrap"><div class="foot-grid">
    <div><a class="brand" href="#home"><img src="/img/logo.png" alt="" width="54" height="54"><span><b>Toro Pinto</b><small>${t('Cleaning Solutions')}</small></span></a><p style="margin-top:.8rem">${S.lang === 'es' ? S.settings.site.about_es || '' : S.settings.site.about || ''}</p></div>
    <div><h4>${t('Contact')}</h4><a href="${phoneHref(b.phone)}">${icon('phone')} ${b.phone}</a><a href="${waLink('')}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp</a>${b.email ? html`<a href="mailto:${b.email}">${icon('mail')} ${b.email}</a>` : ''}${b.address ? html`<a>${icon('pin')} ${b.address}</a>` : ''}</div>
    <div><h4>${t('Explore')}</h4><a href="#services">${t('Services')}</a><a href="#book">${t('Book online')}</a><a href="#shop">${t('Shop')}</a><a href="#plans">${t('Plans')}</a><a href="#faq">FAQ</a><a href="#account" data-act="account">${t('My account')}</a></div>
    <div><h4>${t('Hours')}</h4>${open.map((d) => html`<span style="display:flex;justify-content:space-between;gap:1rem;padding:.12rem 0"><span>${dn(d)}</span><span>${h[d].open}–${h[d].close}</span></span>`)}
      ${['facebook', 'instagram', 'tiktok'].filter((k) => b.social?.[k]).map((k) => html`<a href="${b.social[k]}" target="_blank" rel="noopener" style="text-transform:capitalize">${k}</a>`)}</div>
    </div><div class="foot-bot"><span>© ${new Date().getFullYear()} ${b.name}. ${S.lang === 'es' ? b.license_note_es : b.license_note}.</span><a href="#staff" data-act="staff" style="display:inline">${t('Staff sign in')}</a></div></div>`);
}
act('staff', () => { if (S.user && S.user.role !== 'customer') location.hash = S.user.role === 'admin' ? '#admin' : '#work'; else openAuth('login'); });
