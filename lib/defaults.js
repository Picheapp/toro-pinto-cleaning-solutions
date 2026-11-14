'use strict';
// Default business settings. Everything here can be changed from Admin → Settings / Content.
// Prices, tax rate and copy are STARTING POINTS — review them before launch.
module.exports = {
  business: {
    name: 'Toro Pinto Cleaning Solutions',
    tagline: 'Limpieza de Exterior Profesional',
    tagline_en: 'Professional Exterior Cleaning',
    phone: '787-427-8122',
    whatsapp: '17874278122', // digits only, with country code
    email: '',
    address: '',
    license_note: 'Licensed & Insured',
    license_note_es: 'Con licencia y seguro',
    social: { facebook: '', instagram: '', tiktok: '' },
  },
  timezone: 'America/Puerto_Rico',
  hours: {
    // 0 = Sunday … 6 = Saturday
    0: { enabled: false, open: '08:00', close: '17:00' },
    1: { enabled: true, open: '08:00', close: '17:00' },
    2: { enabled: true, open: '08:00', close: '17:00' },
    3: { enabled: true, open: '08:00', close: '17:00' },
    4: { enabled: true, open: '08:00', close: '17:00' },
    5: { enabled: true, open: '08:00', close: '17:00' },
    6: { enabled: true, open: '08:00', close: '14:00' },
  },
  slots: ['08:00', '10:00', '12:00', '14:00'],
  crews: 2,               // how many jobs can start in the same slot
  lead_hours: 12,         // minimum notice for online bookings
  max_days_ahead: 90,
  blocked_dates: [],
  tax_rate: 0,            // percent — set to your sales tax (e.g. IVU) in Admin → Settings
  deposit_pct: 25,
  min_deposit_cents: 2500,
  commercial_multiplier: 1.15,
  condition_multipliers: { standard: 1, heavy: 1.25 },
  frequency_discounts: { weekly: 15, biweekly: 10, monthly: 5 },
  max_auto_sqft: 25000,
  max_auto_rooms: 15,
  vip_cents: 150000,
  loyalty: { points_per_dollar: 1, redeem_points: 100, redeem_value_cents: 500, min_redeem: 100 },
  referral: { referrer_points: 500, referred_points: 250 },
  shipping: { flat_cents: 995, free_over_cents: 7500, pickup_enabled: true, ship_enabled: true, pickup_address: '' },
  invoice: {
    prefix: 'TP-', next: 1001, due_days: 7,
    terms: 'Payment is due by the due date shown. A deposit may be required to confirm your booking. Cancellations within 24 hours of the appointment may forfeit the deposit. / El pago vence en la fecha indicada. Puede requerirse un depósito para confirmar su cita. Las cancelaciones con menos de 24 horas de aviso pueden perder el depósito.',
    footer: 'Thank you for choosing Toro Pinto Cleaning Solutions. / Gracias por elegir Toro Pinto Cleaning Solutions.',
  },
  notifications: { email: true, whatsapp: true, reminder_hours: 24, review_delay_hours: 24, overdue_every_days: 3, overdue_max: 4, inactive_days: 90 },
  site: {
    hero_title: 'A Cleaner Space. A Better Life.',
    hero_title_es: 'Un Espacio Más Limpio. Una Vida Mejor.',
    hero_sub: 'Professional exterior pressure washing for homes and businesses, plus industrial kitchen cleaning for restaurants and fast-food locations. Book online in minutes, pay securely and track everything from your account.',
    hero_sub_es: 'Lavado a presión exterior profesional para hogares y negocios, y limpieza de cocinas industriales para restaurantes y comida rápida. Reserva en línea en minutos, paga de forma segura y controla todo desde tu cuenta.',
    promos: [
      { id: 'welcome', text: 'New customer? Get 10% off your first booking with code WELCOME10', text_es: '¿Cliente nuevo? Obtén 10% de descuento en tu primera reserva con el código WELCOME10', code: 'WELCOME10', active: true },
    ],
    faqs: [
      { q: 'How does online booking work?', a: 'Pick a service, tell us about the property, choose a date and time, review your instant estimate and confirm. A small deposit secures your slot; the balance is due after the job.', q_es: '¿Cómo funciona la reserva en línea?', a_es: 'Elige un servicio, cuéntanos de la propiedad, escoge fecha y hora, revisa tu estimado instantáneo y confirma. Un pequeño depósito asegura tu espacio; el balance se paga al terminar el trabajo.' },
      { q: 'What if my job needs a custom quote?', a: 'Some jobs (very large properties, gas stations, restaurant kitchens) cannot be priced automatically. Choose "Request a custom quote" and we will follow up quickly — quotes are free.', q_es: '¿Y si mi trabajo necesita una cotización personalizada?', a_es: 'Algunos trabajos (propiedades muy grandes, gasolineras, cocinas de restaurante) no se pueden cotizar automáticamente. Elige "Pedir cotización personalizada" y te contactaremos rápido — las cotizaciones son gratis.' },
      { q: 'Are you licensed and insured?', a: 'Yes. Toro Pinto Cleaning Solutions operates licensed and insured for residential, commercial and industrial exterior cleaning.', q_es: '¿Tienen licencia y seguro?', a_es: 'Sí. Toro Pinto Cleaning Solutions opera con licencia y seguro para limpieza exterior residencial, comercial e industrial.' },
      { q: 'Can I reschedule or cancel?', a: 'Yes — from your account, open the booking and send a reschedule or cancel request. Please give at least 24 hours notice.', q_es: '¿Puedo reprogramar o cancelar?', a_es: 'Sí — desde tu cuenta, abre la reserva y envía una solicitud para reprogramar o cancelar. Por favor avisa con al menos 24 horas.' },
      { q: 'How do recurring plans work?', a: 'Choose weekly, biweekly or monthly service when booking and save automatically on every visit. You can pause or cancel any time by contacting us.', q_es: '¿Cómo funcionan los planes recurrentes?', a_es: 'Elige servicio semanal, quincenal o mensual al reservar y ahorra automáticamente en cada visita. Puedes pausar o cancelar cuando quieras contactándonos.' },
    ],
    service_area_label: 'Puerto Rico',
    service_areas: [],
    about: 'Toro Pinto Cleaning Solutions is a professional cleaning company serving homes, businesses, restaurants and industrial sites. We bring our own fully equipped mobile pressure-washing rig and trained crews to every job.',
    about_es: 'Toro Pinto Cleaning Solutions es una empresa profesional de limpieza que sirve hogares, negocios, restaurantes y sitios industriales. Llevamos nuestro propio equipo móvil de lavado a presión totalmente equipado y personal capacitado a cada trabajo.',
    highlights: ['Licensed & Insured', 'Free Quotes', 'Exterior · Restaurant Kitchens · Industrial'],
    highlights_es: ['Con licencia y seguro', 'Cotización gratis', 'Exterior · Cocinas de restaurante · Industrial'],
  },
};
