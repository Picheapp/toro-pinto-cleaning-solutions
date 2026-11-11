'use strict';
// Notification engine: templates → outbox table → email (Resend) / WhatsApp (Meta Cloud API).
// With no provider configured, messages are kept in the outbox with status "unconfigured" (visible in Admin → Notifications).
const cfg = require('./config');
const { get, all, run, insert, settings } = require('./db');
const { nowISO, money } = require('./util');

const runtime = { baseUrl: cfg.baseUrl };
const base = () => runtime.baseUrl || `http://localhost:${cfg.port}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const T = {
  welcome: (v) => ({ subject: `Welcome to ${v.biz}!`, lines: [`Hi ${v.name}, your account is ready.`, `Your referral code is ${v.referral_code} — friends who book with it earn you loyalty points.`], cta: ['Open my account', `${base()}/#account`] }),
  booking_confirmation: (v) => ({ subject: `Booking received — ${v.code}`, lines: [`Hi ${v.name}, thanks for booking ${v.service}.`, `When: ${v.when}`, `Where: ${v.address}`, `Estimated total: ${v.total}${v.deposit ? ` · Deposit to secure your slot: ${v.deposit}` : ''}`], cta: ['View booking & pay deposit', `${base()}/#account`] }),
  booking_cancelled: (v) => ({ subject: `Booking ${v.code} cancelled`, lines: [`Hi ${v.name}, your booking ${v.code} (${v.service}, ${v.when}) has been cancelled.`, 'If this was a mistake, just book a new time online or call us.'], cta: ['Book again', `${base()}/#book`] }),
  booking_rescheduled: (v) => ({ subject: `Booking ${v.code} rescheduled`, lines: [`Hi ${v.name}, your ${v.service} is now scheduled for ${v.when}.`], cta: ['View booking', `${base()}/#account`] }),
  booking_confirmed: (v) => ({ subject: `Your booking is confirmed — ${v.code}`, lines: [`Hi ${v.name}, your ${v.service} is confirmed for ${v.when}.`, 'Our crew will arrive within the scheduled window.'], cta: ['View booking', `${base()}/#account`] }),
  appointment_reminder: (v) => ({ subject: `Reminder: ${v.service} ${v.when_short}`, lines: [`Hi ${v.name}, a friendly reminder of your appointment.`, `When: ${v.when}`, `Where: ${v.address}`, 'Need to change it? Send a reschedule request from your account.'], cta: ['Open my account', `${base()}/#account`] }),
  quote_received: (v) => ({ subject: 'We received your quote request', lines: [`Hi ${v.name}, thanks for contacting ${v.biz}.`, 'Our team will review your request and reply shortly with a free quote.'] }),
  quote_sent: (v) => ({ subject: `Your free quote from ${v.biz}`, lines: [`Hi ${v.name}, here is your quote${v.service ? ` for ${v.service}` : ''}: ${v.amount}.`, 'Reply to this message or call us to approve it and pick a date.'], cta: ['Book now', `${base()}/#book`] }),
  invoice_generated: (v) => ({ subject: `Invoice ${v.number} — ${v.total}`, lines: [`Hi ${v.name}, invoice ${v.number} for ${v.total} is ready. Due ${v.due}.`, `Balance: ${v.balance}`], cta: ['View & pay invoice', `${base()}/#account`] }),
  payment_confirmation: (v) => ({ subject: `Payment received — thank you!`, lines: [`Hi ${v.name}, we received your payment of ${v.amount} for invoice ${v.number}.`, v.balance_cents > 0 ? `Remaining balance: ${v.balance}` : 'Your invoice is paid in full.'], cta: ['View receipt', `${base()}/#account`] }),
  payment_overdue: (v) => ({ subject: `Invoice ${v.number} is overdue`, lines: [`Hi ${v.name}, invoice ${v.number} was due ${v.due} and has a balance of ${v.balance}.`, 'You can pay securely online from your account.'], cta: ['Pay now', `${base()}/#account`] }),
  job_completed: (v) => ({ subject: `Your service is complete`, lines: [`Hi ${v.name}, your ${v.service} on ${v.date} is complete.`, 'Thank you for choosing us!'], cta: ['View details', `${base()}/#account`] }),
  review_request: (v) => ({ subject: 'How did we do?', lines: [`Hi ${v.name}, we hope you love your freshly cleaned space.`, 'Would you take a moment to rate your service? It really helps our small business.'], cta: ['Leave a review', `${base()}/#account`] }),
  inactive_followup: (v) => ({ subject: `We miss you, ${v.name}!`, lines: [`It has been a while since your last cleaning with ${v.biz}.`, v.code ? `Come back and enjoy ${v.offer} with code ${v.code}.` : 'Book your next cleaning in minutes online.'], cta: ['Book your cleaning', `${base()}/#book`] }),
  order_confirmation: (v) => ({ subject: `Order ${v.code} received`, lines: [`Hi ${v.name}, thanks for your order of ${v.total}.`, v.fulfillment === 'pickup' ? 'We will let you know when it is ready for local pickup.' : 'We will email tracking details when it ships.'], cta: ['View order', `${base()}/#account`] }),
  order_update: (v) => ({ subject: `Order ${v.code}: ${v.status_label}`, lines: [`Hi ${v.name}, your order status is now: ${v.status_label}.`, v.tracking ? `Tracking: ${v.tracking}${v.carrier ? ' (' + v.carrier + ')' : ''}` : ''].filter(Boolean), cta: ['View order', `${base()}/#account`] }),
  change_request_update: (v) => ({ subject: `Your ${v.type} request was ${v.status}`, lines: [`Hi ${v.name}, your ${v.type} request for booking ${v.code} was ${v.status}.`, v.note || ''].filter(Boolean), cta: ['View booking', `${base()}/#account`] }),
  membership_invoice: (v) => ({ subject: `${v.plan} membership — invoice ${v.number}`, lines: [`Hi ${v.name}, your monthly ${v.plan} membership invoice (${v.total}) is ready.`], cta: ['View & pay', `${base()}/#account`] }),
  password_reset: (v) => ({ subject: 'Reset your password', lines: [`Hi ${v.name}, use the button below to choose a new password. The link works for 1 hour.`, 'If you did not ask for this, you can ignore this message.'], cta: ['Reset password', v.link] }),
  support_reply: (v) => ({ subject: `New message from ${v.biz}`, lines: [`Hi ${v.name}, we replied to your message:`, `“${v.preview}”`], cta: ['Open messages', `${base()}/#account`] }),
  admin_alert: (v) => ({ subject: v.subject, lines: v.lines, cta: ['Open admin dashboard', `${base()}/#admin`] }),
};

// Spanish (Puerto Rico) versions of every template
const TES = {
  welcome: (v) => ({ subject: `¡Bienvenido a ${v.biz}!`, lines: [`Hola ${v.name}, tu cuenta está lista.`, `Tu código de referido es ${v.referral_code} — los amigos que reserven con él te dan puntos de lealtad.`], cta: ['Abrir mi cuenta', `${base()}/#account`] }),
  booking_confirmation: (v) => ({ subject: `Reserva recibida — ${v.code}`, lines: [`Hola ${v.name}, gracias por reservar ${v.service}.`, `Cuándo: ${v.when}`, `Dónde: ${v.address}`, `Total estimado: ${v.total}${v.deposit ? ` · Depósito para asegurar tu espacio: ${v.deposit}` : ''}`], cta: ['Ver reserva y pagar depósito', `${base()}/#account`] }),
  booking_cancelled: (v) => ({ subject: `Reserva ${v.code} cancelada`, lines: [`Hola ${v.name}, tu reserva ${v.code} (${v.service}, ${v.when}) fue cancelada.`, 'Si fue un error, reserva un nuevo horario en línea o llámanos.'], cta: ['Reservar de nuevo', `${base()}/#book`] }),
  booking_rescheduled: (v) => ({ subject: `Reserva ${v.code} reprogramada`, lines: [`Hola ${v.name}, tu servicio de ${v.service} ahora está programado para ${v.when}.`], cta: ['Ver reserva', `${base()}/#account`] }),
  booking_confirmed: (v) => ({ subject: `Tu reserva está confirmada — ${v.code}`, lines: [`Hola ${v.name}, tu servicio de ${v.service} está confirmado para ${v.when}.`, 'Nuestro equipo llegará dentro del horario acordado.'], cta: ['Ver reserva', `${base()}/#account`] }),
  appointment_reminder: (v) => ({ subject: `Recordatorio: ${v.service} ${v.when_short}`, lines: [`Hola ${v.name}, un recordatorio amistoso de tu cita.`, `Cuándo: ${v.when}`, `Dónde: ${v.address}`, '¿Necesitas cambiarla? Envía una solicitud de reprogramación desde tu cuenta.'], cta: ['Abrir mi cuenta', `${base()}/#account`] }),
  quote_received: (v) => ({ subject: 'Recibimos tu solicitud de cotización', lines: [`Hola ${v.name}, gracias por contactar a ${v.biz}.`, 'Nuestro equipo revisará tu solicitud y te responderá pronto con una cotización gratis.'] }),
  quote_sent: (v) => ({ subject: `Tu cotización gratis de ${v.biz}`, lines: [`Hola ${v.name}, aquí está tu cotización${v.service ? ` para ${v.service}` : ''}: ${v.amount}.`, 'Responde a este mensaje o llámanos para aprobarla y escoger una fecha.'], cta: ['Reservar ahora', `${base()}/#book`] }),
  invoice_generated: (v) => ({ subject: `Factura ${v.number} — ${v.total}`, lines: [`Hola ${v.name}, la factura ${v.number} por ${v.total} está lista. Vence el ${v.due}.`, `Balance: ${v.balance}`], cta: ['Ver y pagar factura', `${base()}/#account`] }),
  payment_confirmation: (v) => ({ subject: 'Pago recibido — ¡gracias!', lines: [`Hola ${v.name}, recibimos tu pago de ${v.amount} para la factura ${v.number}.`, v.balance_cents > 0 ? `Balance pendiente: ${v.balance}` : 'Tu factura está pagada en su totalidad.'], cta: ['Ver recibo', `${base()}/#account`] }),
  payment_overdue: (v) => ({ subject: `La factura ${v.number} está vencida`, lines: [`Hola ${v.name}, la factura ${v.number} venció el ${v.due} y tiene un balance de ${v.balance}.`, 'Puedes pagar de forma segura en línea desde tu cuenta.'], cta: ['Pagar ahora', `${base()}/#account`] }),
  job_completed: (v) => ({ subject: 'Tu servicio está completo', lines: [`Hola ${v.name}, tu servicio de ${v.service} del ${v.date} está completo.`, '¡Gracias por elegirnos!'], cta: ['Ver detalles', `${base()}/#account`] }),
  review_request: (v) => ({ subject: '¿Cómo lo hicimos?', lines: [`Hola ${v.name}, esperamos que disfrutes tu espacio recién limpio.`, '¿Nos regalas un momento para calificar tu servicio? Ayuda muchísimo a nuestro pequeño negocio.'], cta: ['Dejar una reseña', `${base()}/#account`] }),
  inactive_followup: (v) => ({ subject: `¡Te extrañamos, ${v.name}!`, lines: [`Ha pasado un tiempo desde tu última limpieza con ${v.biz}.`, v.code ? `Vuelve y disfruta ${v.offer} con el código ${v.code}.` : 'Reserva tu próxima limpieza en minutos en línea.'], cta: ['Reservar mi limpieza', `${base()}/#book`] }),
  order_confirmation: (v) => ({ subject: `Pedido ${v.code} recibido`, lines: [`Hola ${v.name}, gracias por tu pedido de ${v.total}.`, v.fulfillment === 'pickup' ? 'Te avisaremos cuando esté listo para recoger.' : 'Te enviaremos el número de rastreo cuando salga.'], cta: ['Ver pedido', `${base()}/#account`] }),
  order_update: (v) => ({ subject: `Pedido ${v.code}: ${v.status_label}`, lines: [`Hola ${v.name}, el estado de tu pedido ahora es: ${v.status_label}.`, v.tracking ? `Rastreo: ${v.tracking}${v.carrier ? ' (' + v.carrier + ')' : ''}` : ''].filter(Boolean), cta: ['Ver pedido', `${base()}/#account`] }),
  change_request_update: (v) => ({ subject: `Tu solicitud de ${v.type_es} fue ${v.status_es}`, lines: [`Hola ${v.name}, tu solicitud de ${v.type_es} para la reserva ${v.code} fue ${v.status_es}.`, v.note || ''].filter(Boolean), cta: ['Ver reserva', `${base()}/#account`] }),
  membership_invoice: (v) => ({ subject: `Membresía ${v.plan} — factura ${v.number}`, lines: [`Hola ${v.name}, la factura mensual de tu membresía ${v.plan} (${v.total}) está lista.`], cta: ['Ver y pagar', `${base()}/#account`] }),
  password_reset: (v) => ({ subject: 'Restablece tu contraseña', lines: [`Hola ${v.name}, usa el botón para elegir una nueva contraseña. El enlace funciona por 1 hora.`, 'Si no lo pediste, puedes ignorar este mensaje.'], cta: ['Restablecer contraseña', v.link] }),
  support_reply: (v) => ({ subject: `Nuevo mensaje de ${v.biz}`, lines: [`Hola ${v.name}, respondimos tu mensaje:`, `“${v.preview}”`], cta: ['Abrir mensajes', `${base()}/#account`] }),
  admin_alert: (v) => ({ subject: v.subject, lines: v.lines, cta: ['Abrir panel de administración', `${base()}/#admin`] }),
};

function render(template, vars, lang = 'en') {
  const S = settings();
  const es = lang === 'es';
  const t = (es ? TES : T)[template](Object.assign({ biz: S.business.name }, vars));
  const text = [...t.lines, t.cta ? `${t.cta[0]}: ${t.cta[1]}` : '', `— ${S.business.name}${S.business.phone ? ' · ' + S.business.phone : ''}`].filter(Boolean).join('\n\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f3f6f9;font-family:Arial,Helvetica,sans-serif;color:#1c2a3d">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden">
<tr><td style="background:#0b1f3a;padding:22px 28px;border-bottom:4px solid #14c8c0"><span style="color:#fff;font-size:18px;font-weight:700">${esc(S.business.name)}</span><br><span style="color:#8fd9d5;font-size:12px">${esc(es ? S.business.tagline : S.business.tagline_en || S.business.tagline)}</span></td></tr>
<tr><td style="padding:28px">
<h2 style="margin:0 0 14px;color:#0b1f3a;font-size:20px">${esc(t.subject)}</h2>
${t.lines.map((l) => `<p style="margin:0 0 12px;line-height:1.55;font-size:15px">${esc(l)}</p>`).join('')}
${t.cta ? `<p style="margin:22px 0 4px"><a href="${esc(t.cta[1])}" style="background:#14c8c0;color:#06213a;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px;display:inline-block">${esc(t.cta[0])}</a></p>` : ''}
</td></tr>
<tr><td style="padding:16px 28px;background:#f3f6f9;color:#6b7a8c;font-size:12px">${esc(S.business.name)}${S.business.phone ? ' · ' + esc(S.business.phone) : ''}${S.business.address ? '<br>' + esc(S.business.address) : ''}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: t.subject, text, html };
}

// Queue a notification. Returns array of created row ids.
// opts: { customer, email, phone, vars, dedupe, ref_type, ref_id, channels:['email','whatsapp'] }
function send(template, opts) {
  const S = settings();
  const c = opts.customer || null;
  const email = opts.email ?? c?.email;
  const phone = opts.phone ?? c?.phone;
  const channels = opts.channels || ['email', 'whatsapp'];
  const lang = opts.lang || c?.lang || 'en';
  const msg = render(template, typeof opts.vars === 'function' ? opts.vars(lang) : opts.vars || {}, lang);
  const ids = [];
  const add = (channel, to) => {
    const dk = opts.dedupe ? `${opts.dedupe}:${channel}` : null;
    if (dk && get('SELECT id FROM notifications WHERE dedupe_key=?', dk)) return;
    const body = channel === 'email' ? msg.html : msg.text;
    const id = insert('INSERT INTO notifications(customer_id,channel,template,to_addr,subject,body,status,dedupe_key,ref_type,ref_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      c?.id || null, channel, template, to, msg.subject, body, 'queued', dk, opts.ref_type || null, opts.ref_id || null, nowISO());
    ids.push(id);
  };
  if (channels.includes('email') && S.notifications.email && email) add('email', email);
  if (channels.includes('whatsapp') && S.notifications.whatsapp && phone && (!c || c.whatsapp_opt_in)) {
    const digits = String(phone).replace(/\D/g, '');
    const intl = digits.length === 10 ? '1' + digits : digits; // assume US/PR numbers when 10 digits
    if (intl.length >= 10) add('whatsapp', intl);
  }
  for (const id of ids) setImmediate(() => deliver(id).catch(() => {}));
  return ids;
}

async function post(url, headers, body) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
    return text;
  } finally { clearTimeout(t); }
}

async function deliver(id) {
  const n = get('SELECT * FROM notifications WHERE id=?', id);
  if (!n || n.status === 'sent') return;
  try {
    if (n.channel === 'email') {
      if (!cfg.email.resendKey || !cfg.email.from) { run(`UPDATE notifications SET status='unconfigured', error='Email provider not configured (set RESEND_API_KEY and EMAIL_FROM)' WHERE id=?`, id); return; }
      const payload = { from: cfg.email.from, to: [n.to_addr], subject: n.subject, html: n.body };
      if (n.ref_type === 'invoice' && ['invoice_generated', 'payment_confirmation', 'membership_invoice'].includes(n.template)) {
        try { payload.attachments = [{ filename: 'invoice.pdf', content: require('./core').buildInvoicePdf(n.ref_id).toString('base64') }]; } catch {}
      }
      await post(`${cfg.email.apiBase}/emails`, { Authorization: `Bearer ${cfg.email.resendKey}`, 'Content-Type': 'application/json' }, payload);
    } else if (n.channel === 'whatsapp') {
      if (!cfg.whatsapp.token || !cfg.whatsapp.phoneId) { run(`UPDATE notifications SET status='unconfigured', error='WhatsApp not configured (set WHATSAPP_TOKEN and WHATSAPP_PHONE_ID)' WHERE id=?`, id); return; }
      const text = `${n.subject}\n\n${n.body}`.slice(0, 1000);
      const payload = process.env.WHATSAPP_TEMPLATE_NAME
        ? { messaging_product: 'whatsapp', to: n.to_addr, type: 'template', template: { name: process.env.WHATSAPP_TEMPLATE_NAME, language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'en_US' }, components: [{ type: 'body', parameters: [{ type: 'text', text: text.replace(/\s+/g, ' ').slice(0, 900) }] }] } }
        : { messaging_product: 'whatsapp', to: n.to_addr, type: 'text', text: { body: text } };
      await post(`${cfg.whatsapp.apiBase}/${cfg.whatsapp.phoneId}/messages`, { Authorization: `Bearer ${cfg.whatsapp.token}`, 'Content-Type': 'application/json' }, payload);
    }
    run(`UPDATE notifications SET status='sent', sent_at=?, error=NULL WHERE id=?`, nowISO(), id);
  } catch (e) {
    run(`UPDATE notifications SET status='failed', error=? WHERE id=?`, String(e.message).slice(0, 300), id);
  }
}

// retry queued/failed (called by scheduler); failed rows are retried only if recent
async function retryPending() {
  const rows = all(`SELECT id FROM notifications WHERE status='queued' OR (status='failed' AND created_at > ?) ORDER BY id LIMIT 25`, new Date(Date.now() - 6 * 3600000).toISOString());
  for (const r of rows) await deliver(r.id);
}

// Alert the business owner (email only, if a business email is set)
function alertAdmin(subject, lines, dedupe, ref) {
  const S = settings();
  const to = S.business.email;
  if (!to) return;
  send('admin_alert', { email: to, channels: ['email'], vars: { subject, lines }, dedupe, ref_type: ref?.type, ref_id: ref?.id });
}

module.exports = { send, deliver, retryPending, alertAdmin, runtime, base, T, money };
