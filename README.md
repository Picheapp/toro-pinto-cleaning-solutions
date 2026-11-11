# Toro Pinto Cleaning Solutions — website & business platform

One-page, mobile-first, **bilingual (ES / EN)** site with online booking, store, customer portal, CRM, invoicing, crew app and admin dashboard.
Zero npm dependencies: Node.js ≥ 22.5 (uses the built-in `node:sqlite`).

## Run it
```bash
cp .env.example .env        # fill in what you have (see below)
npm start                   # http://localhost:3000
npm test                    # 70+ end-to-end checks on a temp database
```
On first boot an admin account is created from `ADMIN_EMAIL` / `ADMIN_PASSWORD` (if the password is empty a random one is printed **once** in the log).
Sign in from the footer link **Staff sign in**. Crew members are created under **Admin → Team** and see only their own jobs (never prices).

## What is included
| Area | Where |
|---|---|
| Public one-page site, instant estimator, 10-step booking wizard, custom-quote path | `/` |
| Store (variants, bundles, stock, cart drawer, pickup / shipping) | `#shop` |
| Customer portal: bookings, reschedule/cancel requests, invoices + PDF, orders, rewards, referrals, memberships, messages, saved cards | Account |
| Admin: dashboard, CRM pipeline, customers, bookings, invoices (PDF/CSV), orders, catalog, team, messages, reports, settings, activity log | `#admin` |
| Crew app: assigned jobs, status steps, before/after photos, notes | `#work` |
| Payments: Stripe Checkout + signature-verified webhook (amounts re-checked server-side) | `/api/webhooks/stripe` |
| Emails + WhatsApp automations: confirmations, reminders, invoices, overdue, review requests, win-back | Admin → Settings → Automations |

Everything on the site is editable from **Admin → Catalog** and **Admin → Settings → Website content** (both languages).

## Configure (all optional until you go live)
| Variable | Purpose |
|---|---|
| `BASE_URL` | Public URL, used in emails, Stripe redirects and the sitemap |
| `DATA_DIR` | Folder for the database + uploads — **must be a persistent disk** |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Card payments. Webhook endpoint: `BASE_URL/api/webhooks/stripe` (events `checkout.session.completed`, `checkout.session.expired`) |
| `RESEND_API_KEY`, `EMAIL_FROM` | Transactional email (verify your sending domain in Resend) |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` | WhatsApp Cloud API. Business-initiated messages need templates approved by Meta |
| `GA_MEASUREMENT_ID` | Google Analytics 4 |
| `GOOGLE_MAPS_API_KEY` | Interactive service-area map (a keyless embed is used otherwise) |

Without Stripe, production shows "call us to pay" (a clearly-labelled **demo** payment screen is used only in development or with `ALLOW_DEMO_PAYMENTS=1`).
Without email / WhatsApp keys, messages are queued and visible in Admin → Settings → Automations → Message log.

## Deploy
Needs a long-running Node server with a persistent disk. **Vercel / serverless will not work** (SQLite file + uploads).
Good fits: Render, Railway, Fly.io (volume), or any VPS behind Caddy/nginx. Set `NODE_ENV=production`, `BASE_URL`, `DATA_DIR`, and put HTTPS in front (the app trusts `X-Forwarded-*` in production).
Back up `DATA_DIR` regularly (database + `uploads/` + `media/`).

## Before launch — please review
1. **Tax:** the default sales tax / IVU rate is `0`. Confirm the correct rate with your accountant and set it in Settings → Pricing & invoices.
2. **Prices, services, products, plans, promo code (`WELCOME10`)** are placeholders — replace them in Admin → Catalog.
3. **Gallery** images are samples (labelled “Sample”) until you upload real before/after photos. **Reviews** are empty until real customers submit them — nothing is fabricated.
4. **Photos:** the trailer photos came from your Project; swap/add images in the catalog as needed.
5. Terms/cancellation text on invoices and FAQ answers are drafts — have them reviewed.
6. Set your real service towns (Settings → Website content) and business address/email (Settings → Business).

## Language
Spanish (Puerto Rico) is the default for Spanish browsers; the **ES | EN** toggle is everywhere (site, portal, admin, crew app, emails, server errors).
UI strings live in `public/js/es.js` (generated from `scripts/es/*.json` by `node scripts/build-es.js`; `node scripts/extract-i18n.js --missing` lists untranslated strings).
Catalog / content fields have `…_es` twins in the admin editors.

## Security notes
Passwords hashed with scrypt; HttpOnly SameSite cookie sessions; CSRF header + Origin check; strict CSP (no inline scripts); rate-limited auth and uploads; images re-validated by magic bytes; prices are always recomputed on the server; Stripe webhooks are HMAC-verified with replay tolerance.
