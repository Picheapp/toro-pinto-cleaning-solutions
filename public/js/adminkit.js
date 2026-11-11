// Admin helpers: field builders, tables, uploads, CSV links.
import { S, t, html, raw, mount, $, $$, icon, post, money, toast, errToast, act, fileToDataUrl, esc, fmtDate } from './core.js';

export const dollars = (c) => ((c || 0) / 100).toFixed(2);
export const cents = (v) => Math.round(parseFloat(String(v || '0').replace(/[^0-9.\-]/g, '') || '0') * 100);

// def: { k, l, t: text|area|num|money|select|bool|lines|image|date|email|tel|pass, opts:[[v,label]], req, full, hint, ph, step }
export function fld(d, item = {}) {
  const v = item[d.k]; const id = `f_${d.k}`;
  const cls = `field ${d.full ? 'full' : ''}`; const label = html`<span>${d.l}${d.req ? ' *' : ''}</span>`;
  const hint = d.hint ? html`<small class="hint">${d.hint}</small>` : '';
  switch (d.t) {
    case 'area': return html`<label class="${cls}">${label}<textarea name="${d.k}" ${d.req ? 'required' : ''} placeholder="${d.ph || ''}">${v ?? ''}</textarea>${hint}</label>`;
    case 'lines': return html`<label class="${cls}">${label}<textarea name="${d.k}" rows="5" placeholder="${d.ph || t('One per line')}">${[].concat(v || []).join('\n')}</textarea>${hint}</label>`;
    case 'num': return html`<label class="${cls}">${label}<input type="number" name="${d.k}" value="${v ?? ''}" step="${d.step || 1}" inputmode="decimal" ${d.req ? 'required' : ''}>${hint}</label>`;
    case 'money': return html`<label class="${cls}">${label}<input type="number" name="${d.k}" data-money value="${v === null || v === undefined || v === '' ? '' : dollars(v)}" step="0.01" min="0" inputmode="decimal" ${d.req ? 'required' : ''}>${hint}</label>`;
    case 'date': return html`<label class="${cls}">${label}<input type="date" name="${d.k}" value="${v || ''}" ${d.req ? 'required' : ''}>${hint}</label>`;
    case 'bool': return html`<label class="check ${d.full ? 'full' : ''}" style="align-self:end;min-height:46px"><input type="checkbox" name="${d.k}" ${v === undefined ? (d.def ? 'checked' : '') : v ? 'checked' : ''}><span>${d.l}</span></label>`;
    case 'select': return html`<label class="${cls}">${label}<select name="${d.k}">${d.opts.map(([val, lab]) => html`<option value="${val}" ${String(v ?? d.def ?? '') === String(val) ? 'selected' : ''}>${lab}</option>`)}</select>${hint}</label>`;
    case 'image': return html`<div class="${cls}">${label}<div class="row"><img src="${v || ''}" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:10px;background:var(--gray-2);${v ? '' : 'visibility:hidden'}" data-preview="${d.k}"><input type="hidden" name="${d.k}" value="${v || ''}"><label class="btn btn-ghost btn-sm">${icon('camera')} ${t('Upload image')}<input type="file" accept="image/*" hidden data-upload="${d.k}"></label>${v ? '' : ''}</div>${hint}</div>`;
    case 'pass': return html`<label class="${cls}">${label}<input type="password" name="${d.k}" autocomplete="new-password" minlength="8" ${d.req ? 'required' : ''}>${hint}</label>`;
    default: return html`<label class="${cls}">${label}<input type="${d.t === 'email' ? 'email' : d.t === 'tel' ? 'tel' : 'text'}" name="${d.k}" value="${v ?? ''}" placeholder="${d.ph || ''}" ${d.req ? 'required' : ''} ${d.t === 'email' ? 'inputmode="email"' : ''}>${hint}</label>`;
  }
}
export const fieldsHtml = (defs, item) => html`<div class="form-grid" style="padding:0">${defs.map((d) => fld(d, item))}</div>`;
export function readFields(defs, data) {
  const o = {};
  for (const d of defs) {
    const v = data[d.k];
    if (d.t === 'money') o[d.k] = v === '' || v === undefined ? '' : cents(v);
    else if (d.t === 'bool') o[d.k] = !!v;
    else o[d.k] = v ?? '';
  }
  return o;
}
document.addEventListener('change', async (e) => {
  const inp = e.target.closest('input[data-upload]'); if (!inp || !inp.files[0]) return;
  const key = inp.dataset.upload; const form = inp.closest('form') || document;
  try {
    toast(t('Uploading…')); const data = await fileToDataUrl(inp.files[0], 1800, 0.84);
    const r = await post('/api/admin/media', { data });
    form.querySelector(`input[type=hidden][name="${key}"]`).value = r.url; const pv = form.querySelector(`[data-preview="${key}"]`); pv.src = r.url; pv.style.visibility = 'visible';
    toast(t('Image uploaded'), 'ok');
  } catch (err) { errToast(err); } finally { inp.value = ''; }
});

// table: cols [{h, c:(row)=>content, cls}], rows; rowAct => data-act on <tr>
export function table(cols, rows, { rowAct, empty = t('Nothing here yet.') } = {}) {
  if (!rows.length) return html`<div class="empty card">${empty}</div>`;
  return html`<div class="tbl-wrap"><table class="tbl"><thead><tr>${cols.map((c) => html`<th class="${c.cls || ''}">${c.h}</th>`)}</tr></thead>
    <tbody>${rows.map((r) => html`<tr ${rowAct ? raw(`class="click" data-act="${esc(rowAct)}" data-id="${esc(r.id)}"`) : ''}>${cols.map((c) => html`<td class="${c.cls || ''}">${c.c(r)}</td>`)}</tr>`)}</tbody></table></div>`;
}
export const csvHref = (type, from, to) => `/api/admin/export/${type}?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}`;
export const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10); };
export const sel = (name, opts, cur, extra = '') => html`<select name="${name}" ${raw(extra)}>${opts.map(([v, l]) => html`<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${l}</option>`)}</select>`;
export const svcLabel = (s) => (S.lang === 'es' && s.name_es ? s.name_es : s.name);
export const when = (d, slot) => `${fmtDate(d)}${slot ? ' · ' + slot : ''}`;
