'use strict';
const path = require('path');
const fs = require('fs');

// Tiny .env loader (no dependencies). Real environment variables win over the file.
(function loadEnv() {
  const f = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
  }
})();

const env = process.env;
const prod = env.NODE_ENV === 'production';
const stripeSecret = env.STRIPE_SECRET_KEY || '';

module.exports = {
  prod,
  port: Number(env.PORT) || 3000,
  baseUrl: (env.BASE_URL || '').replace(/\/+$/, ''),
  dataDir: path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data')),
  adminEmail: (env.ADMIN_EMAIL || '').trim().toLowerCase(),
  adminPassword: env.ADMIN_PASSWORD || '',
  stripe: {
    secret: stripeSecret,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
    apiBase: (env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/+$/, ''),
  },
  email: { resendKey: env.RESEND_API_KEY || '', from: env.EMAIL_FROM || '', apiBase: (env.RESEND_API_BASE || 'https://api.resend.com').replace(/\/+$/, '') },
  whatsapp: { token: env.WHATSAPP_TOKEN || '', phoneId: env.WHATSAPP_PHONE_ID || '', apiBase: (env.WHATSAPP_API_BASE || 'https://graph.facebook.com/v20.0').replace(/\/+$/, '') },
  gaId: /^G-[A-Z0-9]+$/i.test(env.GA_MEASUREMENT_ID || '') ? env.GA_MEASUREMENT_ID : '',
  mapsKey: env.GOOGLE_MAPS_API_KEY || '',
  // Demo payments never run when Stripe is configured, and never in production unless explicitly allowed.
  demoPayments: !stripeSecret && (env.ALLOW_DEMO_PAYMENTS === '1' || !prod),
};
