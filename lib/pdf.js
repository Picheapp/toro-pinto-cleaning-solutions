'use strict';
// Minimal dependency-free PDF writer — enough for professional multi-page invoices.
const fs = require('fs');
const path = require('path');
const { money } = require('./util');

const W = 612, H = 792;
const NAVY = [0.043, 0.122, 0.227], TEAL = [0.078, 0.784, 0.753], GRAY = [0.42, 0.47, 0.54], LIGHT = [0.953, 0.965, 0.976];

const WIN = { '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"', '\u2013': '-', '\u2014': '-', '\u2026': '...', '\u00b7': '\xb7', '\u2022': '\xb7' };
function enc(s) {
  s = String(s ?? '');
  let out = '';
  for (const ch of s) {
    const c = WIN[ch] ?? ch;
    const code = c.codePointAt(0);
    out += code < 256 ? c : '?';
  }
  // escape per PDF string rules, emit as latin1 bytes
  return out.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[\r\n]+/g, ' ');
}
// approximate Helvetica widths (per 1000 em)
function tw(s, size, bold) {
  let w = 0;
  for (const ch of String(s)) {
    if (/[0-9$#]/.test(ch)) w += 556;
    else if (/[.,:;'|!ilI\xb7 ]/.test(ch)) w += 278;
    else if (/[mwMW@]/.test(ch)) w += 833;
    else if (/[A-Z]/.test(ch)) w += 670;
    else if (/[()\-\[\]\/]/.test(ch)) w += 333;
    else w += bold ? 590 : 540;
  }
  return (w / 1000) * size;
}
const fmt = (n) => (Math.round(n * 100) / 100).toString();
const col = (c) => c.map(fmt).join(' ');

class Doc {
  constructor() { this.pages = []; this.newPage(); }
  newPage() { this.ops = []; this.pages.push(this.ops); this.y = H - 48; }
  text(x, y, s, { size = 10, bold = false, color = [0, 0, 0], align = 'left', maxW } = {}) {
    s = String(s ?? '');
    if (maxW) while (s.length > 1 && tw(s, size, bold) > maxW) s = s.slice(0, -2) + '…';
    const w = tw(s, size, bold);
    const px = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${fmt(size)} Tf ${col(color)} rg ${fmt(px)} ${fmt(y)} Td (${enc(s)}) Tj ET`);
  }
  rect(x, y, w, h, color) { this.ops.push(`${col(color)} rg ${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re f`); }
  line(x1, y1, x2, y2, color = [0.88, 0.9, 0.93], width = 0.7) { this.ops.push(`${col(color)} RG ${width} w ${fmt(x1)} ${fmt(y1)} m ${fmt(x2)} ${fmt(y2)} l S`); }
  image(x, y, w, h) { this.ops.push(`q ${fmt(w)} 0 0 ${fmt(h)} ${fmt(x)} ${fmt(y)} cm /Im1 Do Q`); }

  build(logo) {
    const objs = [];
    const add = (body) => { objs.push(body); return objs.length; };
    const catalog = add(''), pagesId = add('');
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    let imId = 0;
    if (logo) {
      imId = objs.length + 1;
      objs.push({ stream: logo.data, dict: `<< /Type /XObject /Subtype /Image /Width ${logo.w} /Height ${logo.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode` });
    }
    const kids = [];
    for (const ops of this.pages) {
      const content = Buffer.from(ops.join('\n'), 'latin1');
      const cId = objs.length + 1;
      objs.push({ stream: content, dict: '<<' });
      const pId = objs.length + 1;
      objs.push(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${cId} 0 R /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${imId ? ` /XObject << /Im1 ${imId} 0 R >>` : ''} >> >>`);
      kids.push(pId);
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

    const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    const offsets = [];
    let pos = chunks[0].length;
    objs.forEach((o, i) => {
      offsets.push(pos);
      let buf;
      if (typeof o === 'string') buf = Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1');
      else buf = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n${o.dict} /Length ${o.stream.length} >>\nstream\n`, 'latin1'), o.stream, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
      chunks.push(buf); pos += buf.length;
    });
    const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`];
    for (const off of offsets) xref.push(String(off).padStart(10, '0') + ' 00000 n \n');
    xref.push(`trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${pos}\n%%EOF`);
    chunks.push(Buffer.from(xref.join(''), 'latin1'));
    return Buffer.concat(chunks);
  }
}

let logoCache;
function loadLogo() {
  if (logoCache !== undefined) return logoCache;
  try {
    const data = fs.readFileSync(path.join(__dirname, 'logo-pdf.jpg'));
    // parse SOF0/SOF2 for dimensions
    let i = 2, w = 0, h = 0;
    while (i < data.length) {
      if (data[i] !== 0xff) { i++; continue; }
      const m = data[i + 1];
      if (m >= 0xc0 && m <= 0xc3) { h = data.readUInt16BE(i + 5); w = data.readUInt16BE(i + 7); break; }
      i += 2 + data.readUInt16BE(i + 2);
    }
    logoCache = w && h ? { data, w, h } : null;
  } catch { logoCache = null; }
  return logoCache;
}

const STATUS_LABEL = { draft: 'DRAFT', sent: 'SENT', unpaid: 'UNPAID', partial: 'PARTIALLY PAID', paid: 'PAID', overdue: 'OVERDUE', cancelled: 'CANCELLED' };

// inv: invoice row + items[] + payments[] + customer + business settings
function invoicePdf({ invoice: inv, items, payments, customer, business, footer, terms }) {
  const d = new Doc();
  const logo = loadLogo();
  const L = 48, R = W - 48;

  const header = () => {
    d.rect(0, H - 8, W, 8, NAVY);
    d.rect(0, H - 8, 150, 3, TEAL);
    let tx = L;
    if (logo) { const lh = 62, lw = (logo.w / logo.h) * lh; d.image(L, H - 22 - lh, lw, lh); tx = L + lw + 14; }
    d.text(tx, H - 48, business.name, { size: 15, bold: true, color: NAVY });
    let y = H - 63;
    for (const line of [business.tagline, business.phone && `Tel ${business.phone}`, business.email, business.address].filter(Boolean)) { d.text(tx, y, line, { size: 9, color: GRAY }); y -= 12; }
    d.text(R, H - 48, 'INVOICE', { size: 26, bold: true, color: NAVY, align: 'right' });
    d.text(R, H - 66, `# ${inv.number}`, { size: 11, bold: true, color: GRAY, align: 'right' });
  };
  header();

  let y = H - 128;
  const st = STATUS_LABEL[inv.status] || inv.status.toUpperCase();
  const stColor = inv.status === 'paid' ? [0.09, 0.64, 0.36] : inv.status === 'overdue' ? [0.8, 0.15, 0.15] : inv.status === 'cancelled' ? GRAY : NAVY;
  d.rect(R - tw(st, 9, true) - 16, y - 4, tw(st, 9, true) + 16, 20, stColor);
  d.text(R - 8, y + 2, st, { size: 9, bold: true, color: [1, 1, 1], align: 'right' });

  d.text(L, y + 6, 'BILL TO', { size: 8, bold: true, color: TEAL });
  y -= 10;
  d.text(L, y, customer.name, { size: 11, bold: true, color: NAVY });
  y -= 13;
  for (const l of [customer.company, customer.email, customer.phone].filter(Boolean)) { d.text(L, y, l, { size: 9, color: GRAY }); y -= 12; }

  let ry = H - 160;
  const kv = (k, v) => { d.text(R - 130, ry, k, { size: 9, color: GRAY }); d.text(R, ry, v, { size: 9, bold: true, color: NAVY, align: 'right' }); ry -= 14; };
  kv('Issue date', inv.issue_date); kv('Due date', inv.due_date);
  if (inv.booking_code) kv('Booking', inv.booking_code);
  if (inv.order_code) kv('Order', inv.order_code);

  y = Math.min(y, ry) - 18;
  const tableHead = () => {
    d.rect(L, y - 6, R - L, 22, NAVY);
    d.text(L + 8, y, 'DESCRIPTION', { size: 8, bold: true, color: [1, 1, 1] });
    d.text(R - 190, y, 'QTY', { size: 8, bold: true, color: [1, 1, 1], align: 'right' });
    d.text(R - 105, y, 'UNIT PRICE', { size: 8, bold: true, color: [1, 1, 1], align: 'right' });
    d.text(R - 8, y, 'AMOUNT', { size: 8, bold: true, color: [1, 1, 1], align: 'right' });
    y -= 26;
  };
  tableHead();
  let zebra = false;
  for (const it of items) {
    if (y < 150) { d.newPage(); header(); y = H - 140; tableHead(); }
    if (zebra) d.rect(L, y - 7, R - L, 21, LIGHT);
    zebra = !zebra;
    d.text(L + 8, y, it.description, { size: 9.5, color: [0.1, 0.12, 0.16], maxW: 300 });
    d.text(R - 190, y, String(Number.isInteger(it.qty) ? it.qty : it.qty.toFixed(2)), { size: 9.5, align: 'right' });
    d.text(R - 105, y, money(it.unit_cents), { size: 9.5, align: 'right' });
    d.text(R - 8, y, money(it.total_cents), { size: 9.5, bold: true, align: 'right' });
    y -= 21;
  }
  y -= 8;
  d.line(L, y + 12, R, y + 12);
  if (y < 190) { d.newPage(); header(); y = H - 150; }

  const tot = (k, v, { bold = false, color = [0.1, 0.12, 0.16], big = false } = {}) => {
    d.text(R - 150, y, k, { size: big ? 11 : 9.5, bold, color: bold ? NAVY : GRAY });
    d.text(R - 8, y, v, { size: big ? 12 : 9.5, bold, color, align: 'right' });
    y -= big ? 22 : 15;
  };
  tot('Subtotal', money(inv.subtotal_cents));
  if (inv.discount_cents) tot('Discounts', '-' + money(inv.discount_cents), { color: [0.09, 0.64, 0.36] });
  tot(`Tax (${inv.tax_rate}%)`, money(inv.tax_cents));
  d.rect(R - 160, y - 6, 160, 24, LIGHT);
  tot('Total', money(inv.total_cents), { bold: true, big: true });
  if (inv.paid_cents) tot('Paid', '-' + money(inv.paid_cents), { color: [0.09, 0.64, 0.36] });
  const bal = Math.max(0, inv.total_cents - inv.paid_cents);
  d.rect(R - 160, y - 8, 160, 26, TEAL);
  d.text(R - 150, y, 'BALANCE DUE', { size: 9, bold: true, color: NAVY });
  d.text(R - 8, y, money(inv.cancelled ? 0 : bal), { size: 13, bold: true, color: NAVY, align: 'right' });
  y -= 36;

  if (payments.length) {
    if (y < 140) { d.newPage(); header(); y = H - 150; }
    d.text(L, y, 'PAYMENTS RECEIVED', { size: 8, bold: true, color: TEAL }); y -= 13;
    for (const p of payments) {
      d.text(L, y, `${(p.paid_at || p.created_at).slice(0, 10)}  ·  ${p.method}${p.note ? ' · ' + p.note : ''}`, { size: 9, color: GRAY, maxW: 380 });
      d.text(R - 8, y, money(p.amount_cents), { size: 9, align: 'right' }); y -= 13;
    }
    y -= 6;
  }
  if (inv.notes) { if (y < 110) { d.newPage(); header(); y = H - 150; } d.text(L, y, 'NOTES', { size: 8, bold: true, color: TEAL }); y -= 12; for (const l of wrap(inv.notes, 100)) { d.text(L, y, l, { size: 9, color: GRAY }); y -= 12; } y -= 4; }
  if (terms) { if (y < 100) { d.newPage(); header(); y = H - 150; } d.text(L, y, 'TERMS', { size: 8, bold: true, color: TEAL }); y -= 12; for (const l of wrap(terms, 110)) { d.text(L, y, l, { size: 8.5, color: GRAY }); y -= 11; } }

  d.pages.forEach((ops, i) => {
    d.ops = ops;
    d.line(L, 44, R, 44);
    d.text(L, 30, footer || 'Thank you for your business.', { size: 8.5, color: GRAY });
    d.text(R, 30, `Page ${i + 1} of ${d.pages.length}`, { size: 8.5, color: GRAY, align: 'right' });
  });
  return d.build(logo);
}
function wrap(s, n) {
  const out = [];
  for (const para of String(s).split(/\r?\n/)) {
    let line = '';
    for (const w of para.split(/\s+/)) {
      if ((line + ' ' + w).trim().length > n) { out.push(line); line = w; } else line = (line + ' ' + w).trim();
    }
    out.push(line);
  }
  return out;
}

module.exports = { invoicePdf };
