// Employee (crew) app: assigned jobs, status updates, before/after photos, notes. Never shows prices.
import { S, t, tl, html, mount, $, icon, api, post, fmtDate, fmtTime, toast, errToast, act, form, onLang, openModal, closeAllModals, confirmDialog, bookingBadge, badge, phoneHref, fileToDataUrl } from './core.js';
import { openApp, frame, paint, currentApp } from './appshell.js';

const E = { tab: 'jobs', data: null, hist: null, err: '', open: null };
const TABS = () => [{ id: 'jobs', label: t('My jobs'), icon: 'briefcase' }, { id: 'done', label: t('Completed'), icon: 'check' }];
const nm = (j) => (S.lang === 'es' && j.service_name_es ? j.service_name_es : j.service_name);
const mapLink = (j) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([j.address, j.city, j.zip, 'Puerto Rico'].filter(Boolean).join(', '))}`;

export async function openWork() {
  openApp('work', (id) => { E.tab = id; draw(); if (id === 'done' && !E.hist) loadHist(); });
  draw(); await load();
}
async function load() {
  try { E.data = await api('/api/employee/jobs'); E.err = ''; } catch (e) { E.err = e.message; }
  if (currentApp()?.kind === 'work') draw();
}
async function loadHist() {
  const today = (E.data?.today) || new Date().toISOString().slice(0, 10); const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 30);
  try { const r = await api(`/api/employee/jobs?from=${d.toISOString().slice(0, 10)}&to=${today}`); E.hist = r.jobs.filter((j) => j.status === 'completed').reverse(); } catch (e) { E.hist = []; }
  draw();
}
onLang(() => { if (currentApp()?.kind === 'work') { draw(); if (E.open) openJob(E.open, true); } });

function draw() {
  let body;
  if (E.err) body = html`<div class="alert bad">${E.err}</div>`;
  else if (!E.data) body = html`<div class="skel" style="height:140px"></div>`;
  else if (E.tab === 'done') body = html`<div class="pg-h"><h2>${t('Completed')}</h2></div>${E.hist ? (E.hist.length ? E.hist.map(card) : html`<div class="empty card">${t('Nothing here yet.')}</div>`) : html`<div class="skel" style="height:120px"></div>`}`;
  else {
    const { jobs, stats, today } = E.data; const groups = new Map();
    for (const j of jobs) { if (!groups.has(j.date)) groups.set(j.date, []); groups.get(j.date).push(j); }
    body = html`<div class="pg-h"><h2>${t('My jobs')}</h2></div>
      <div class="kpis"><div class="kpi hl"><small>${t('Today')}</small><b>${stats.today}</b></div><div class="kpi"><small>${t('In progress')}</small><b>${stats.in_progress}</b></div><div class="kpi"><small>${t('Done this week')}</small><b>${stats.completed_week}</b></div></div>
      ${jobs.length ? [...groups].map(([date, list]) => html`<h3 style="margin:1rem 0 .5rem">${date === today ? t('Today') + ' · ' : ''}${fmtDate(date, { weekday: 'long', month: 'long', day: 'numeric' })}</h3>${list.map(card)}`) : html`<div class="empty card">${t('No jobs assigned to you right now.')}</div>`}`;
  }
  paint(frame({ title: t('Crew'), tabs: TABS(), active: E.tab, body }));
}
function card(j) {
  return html`<article class="job" data-act="job-open" data-id="${j.id}"><div class="row between"><b>${nm(j)}</b>${bookingBadge(j.status)}</div>
    <div class="muted">${icon('clock')} ${fmtTime(j.slot)} · ${j.segment === 'commercial' ? t('Commercial') : t('Residential')}</div><div class="muted tiny">${icon('pin')} ${j.address}${j.city ? ', ' + j.city : ''}</div></article>`;
}
act('job-open', (el) => openJob(Number(el.dataset.id)));
let modal = null;
async function openJob(id, keep) {
  E.open = id; if (!keep) modal = openModal(html`<div class="skel" style="height:260px"></div>`, { title: t('Job'), size: 'wide', onClose: () => { E.open = null; load(); } });
  let j; try { j = (await api(`/api/employee/jobs/${id}`)).job; } catch (e) { modal?.set(html`<div class="alert bad">${e.message}</div>`); return; }
  const steps = { confirmed: ['en_route', t('I am on my way')], en_route: ['in_progress', t('Start job')], in_progress: ['completed', t('Mark job complete')] }[j.status];
  const list = S.lang === 'es' && j.checklist_es?.length ? j.checklist_es : j.checklist;
  const before = j.photos.filter((p) => p.kind === 'job_before'), after = j.photos.filter((p) => p.kind === 'job_after');
  modal.set(html`<div class="stack"><div class="row between"><h3>${nm(j)}</h3>${bookingBadge(j.status)}</div>
    <div class="sum"><div class="ln"><span>${t('When')}</span><b>${fmtDate(j.date, { weekday: 'short', month: 'short', day: 'numeric' })} · ${fmtTime(j.slot)}</b></div>
      <div class="ln"><span>${t('Customer')}</span><b>${j.contact_name || ''}</b></div>
      <div class="ln"><span>${t('Type')}</span><b>${j.segment === 'commercial' ? t('Commercial') : t('Residential')}</b></div>
      ${j.sqft ? html`<div class="ln"><span>${t('Size')}</span><b>${j.sqft} sq ft</b></div>` : ''}${j.rooms ? html`<div class="ln"><span>${t('Rooms')}</span><b>${j.rooms}</b></div>` : ''}
      ${j.condition === 'heavy' ? html`<div class="ln"><span>${t('Condition')}</span><b>${badge('warn', t('Heavy'))}</b></div>` : ''}
      ${j.addons.length ? html`<div class="ln"><span>${t('Add-ons')}</span><b style="text-align:right">${j.addons.join(', ')}</b></div>` : ''}</div>
    <div class="row">${j.contact_phone ? html`<a class="btn btn-ghost" href="${phoneHref(j.contact_phone)}" data-keep>${icon('phone')} ${t('Call')}</a>` : ''}<a class="btn btn-ghost" href="${mapLink(j)}" target="_blank" rel="noopener" data-keep>${icon('pin')} ${t('Directions')}</a></div>
    <div><b>${icon('pin')} ${j.address}${j.city ? ', ' + j.city : ''} ${j.zip || ''}</b></div>
    ${j.access_notes ? html`<div class="alert"><b>${t('Access')}:</b> ${j.access_notes}</div>` : ''}${j.notes ? html`<div class="alert warn"><b>${t('Customer notes')}:</b> ${j.notes}</div>` : ''}${j.internal_notes ? html`<div class="alert warn"><b>${t('Office notes')}:</b> ${j.internal_notes}</div>` : ''}
    ${list.length ? html`<div><h4>${t('Checklist')}</h4>${list.map((x) => html`<label class="check-li"><input type="checkbox"><span>${x}</span></label>`)}</div>` : ''}
    ${['confirmed', 'en_route', 'in_progress'].includes(j.status) || j.photos.length ? html`<div><h4>${t('Photos')}</h4>
      <p class="tiny muted">${t('Before')} (${before.length}) · ${t('After')} (${after.length})</p>
      <div class="photo-row">${j.photos.map((p) => html`<a href="/api/files/${p.id}" target="_blank" rel="noopener" data-keep><img src="/api/files/${p.id}" alt="${p.kind === 'job_before' ? t('Before') : t('After')}" loading="lazy"></a>`)}</div>
      ${['en_route', 'in_progress', 'completed'].includes(j.status) ? html`<div class="row" style="margin-top:.6rem"><label class="btn btn-ghost btn-sm">${icon('camera')} ${t('Add BEFORE photo')}<input type="file" accept="image/*" capture="environment" hidden data-photo="before" data-id="${j.id}"></label><label class="btn btn-ghost btn-sm">${icon('camera')} ${t('Add AFTER photo')}<input type="file" accept="image/*" capture="environment" hidden data-photo="after" data-id="${j.id}"></label></div>` : ''}</div>` : ''}
    <div><h4>${t('Job notes')}</h4>${j.job_notes.length ? html`<div class="list">${j.job_notes.map((n) => html`<div class="li"><div class="t"><b>${n.note}</b><small>${n.author || ''} · ${fmtDate(n.created_at)}</small></div></div>`)}</div>` : ''}
      <form class="row" data-form="job-note" style="flex-wrap:nowrap;margin-top:.5rem" novalidate><input type="hidden" name="id" value="${j.id}"><input type="text" name="note" placeholder="${t('Add a note for the office…')}" style="flex:1"><button class="btn btn-navy" type="submit">${t('Add')}</button></form></div>
    ${steps ? html`<button class="btn btn-primary btn-lg btn-block" data-act="job-step" data-id="${j.id}" data-s="${steps[0]}">${steps[1]}</button>` : j.status === 'pending' ? html`<div class="alert warn">${t('This booking is not confirmed yet.')}</div>` : ''}</div>`);
}
act('job-step', async (el) => {
  const status = el.dataset.s;
  if (status === 'completed' && !(await confirmDialog(t('Is the job finished and the site left clean?'), { ok: t('Yes, complete') }))) return;
  el.classList.add('busy'); try { await post(`/api/employee/jobs/${el.dataset.id}/status`, { status, confirm: true }); toast(t('Status updated'), 'ok'); await openJob(Number(el.dataset.id), true); } finally { el.classList.remove('busy'); }
});
form('job-note', async (d, f) => { await post(`/api/employee/jobs/${d.id}/notes`, { note: d.note }); await openJob(Number(d.id), true); });
document.addEventListener('change', async (e) => {
  const inp = e.target.closest('input[data-photo]'); if (!inp || !inp.files.length) return;
  const files = [...inp.files]; const kind = inp.dataset.photo; const id = inp.dataset.id; inp.value = '';
  toast(t('Uploading…'));
  for (const f of files) { try { await post(`/api/employee/jobs/${id}/photos`, { kind, data: await fileToDataUrl(f, 1800, 0.84) }); } catch (err) { errToast(err); } }
  toast(t('Photo saved'), 'ok'); await openJob(Number(id), true);
});
