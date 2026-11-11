'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const cfg = require('./lib/config');
const { get, all, settings } = require('./lib/db');
const { HttpError, json: parseJson } = require('./lib/util');
const { currentUser } = require('./lib/auth');
const { tr } = require('./lib/i18n');
const notify = require('./lib/notify');

const PUBLIC = path.join(__dirname, 'public');
const MEDIA = path.join(cfg.dataDir, 'media');
fs.mkdirSync(MEDIA, { recursive: true });
const TRUST_PROXY = process.env.TRUST_PROXY ? process.env.TRUST_PROXY === '1' : cfg.prod;

// ------------------------------------------------------------------ router
const routes = [];
function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler, opts });
}
const app = { route, get: (p, h, o) => route('GET', p, h, o), post: (p, h, o) => route('POST', p, h, o), put: (p, h, o) => route('PUT', p, h, o), del: (p, h, o) => route('DELETE', p, h, o) };

// ------------------------------------------------------------------ helpers
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.xml', '.webmanifest']);

function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xff) return xff;
  }
  return req.socket.remoteAddress || '';
}
function baseUrlFor(req) {
  if (cfg.baseUrl) return cfg.baseUrl;
  const proto = req.secure ? 'https' : 'http';
  const host = (TRUST_PROXY && req.headers['x-forwarded-host']) || req.headers.host || `localhost:${cfg.port}`;
  return `${proto}://${host}`;
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new HttpError(413, 'That request is too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function securityHeaders(res, req) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=(self)');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self' https://www.googletagmanager.com", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:", "img-src 'self' data: blob: https:", "connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com",
    'frame-src https://www.google.com https://maps.google.com', "form-action 'self'", "base-uri 'self'", "frame-ancestors 'none'", "object-src 'none'",
  ].join('; '));
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}
function sendBuf(req, res, status, buf, type, extra = {}) {
  const headers = { 'Content-Type': type, ...extra };
  const ext = Object.keys(MIME).find((k) => MIME[k] === type);
  if (buf.length > 1024 && (COMPRESSIBLE.has(ext) || /json|html|text/.test(type)) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    headers['Content-Encoding'] = 'gzip'; headers.Vary = 'Accept-Encoding';
    buf = zlib.gzipSync(buf);
  }
  headers['Content-Length'] = buf.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : buf);
}
function decorate(req, res) {
  req.secure = !!req.socket.encrypted || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https') || cfg.baseUrl.startsWith('https');
  req.ip = clientIp(req);
  res.json = (obj, status = 200, headers = {}) => sendBuf(req, res, status, Buffer.from(JSON.stringify(obj)), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store', ...headers });
  res.send = (buf, type, status = 200, headers = {}) => sendBuf(req, res, status, Buffer.isBuffer(buf) ? buf : Buffer.from(buf), type, headers);
}

// ------------------------------------------------------------------ static files + index
const tplCache = {};
function indexHtml(req) {
  if (!tplCache.html || !cfg.prod) tplCache.html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const S = settings();
  const base = baseUrlFor(req);
  const rating = get('SELECT COUNT(*) n, AVG(rating) a FROM reviews WHERE published=1');
  const ld = {
    '@context': 'https://schema.org', '@type': 'ProfessionalService', name: S.business.name, description: S.site.about, url: base, telephone: S.business.phone,
    image: `${base}/img/og.jpg`, logo: `${base}/img/logo.png`, areaServed: S.site.service_area_label,
    ...(S.business.email ? { email: S.business.email } : {}), ...(S.business.address ? { address: S.business.address } : {}),
    ...(rating.n ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: Number(rating.a.toFixed(1)), reviewCount: rating.n } } : {}),
    priceRange: '$$',
  };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const title = `${S.business.name} — Professional Cleaning & Pressure Washing | Book Online`;
  const desc = S.site.hero_sub.slice(0, 200);
  const seo = `<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(base)}/">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(base)}/"><meta property="og:image" content="${esc(base)}/img/og.jpg">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`;
  const boot = JSON.stringify({ gaId: cfg.gaId, mapsKey: cfg.mapsKey, baseUrl: base }).replace(/</g, '\\u003c');
  return tplCache.html.replace('<!--SEO-->', seo).replace('<!--BOOT-->', `<script type="application/json" id="boot">${boot}</script>`);
}

function serveFile(req, res, file, cache) {
  let st;
  try { st = fs.statSync(file); } catch { return false; }
  if (!st.isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  const etag = `W/"${st.size}-${Math.floor(st.mtimeMs)}"`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); res.end(); return true; }
  const buf = fs.readFileSync(file);
  sendBuf(req, res, 200, buf, MIME[ext] || 'application/octet-stream', { ETag: etag, 'Cache-Control': cache });
  return true;
}
function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return false; }
  if (rel.includes('\0')) return false;
  if (rel.startsWith('/media/')) {
    const f = path.join(MEDIA, path.basename(rel));
    return serveFile(req, res, f, 'public, max-age=86400');
  }
  const f = path.normalize(path.join(PUBLIC, rel));
  if (!f.startsWith(PUBLIC + path.sep)) return false;
  const ext = path.extname(f).toLowerCase();
  const cache = ['.jpg', '.jpeg', '.png', '.webp', '.svg', '.woff2', '.ico'].includes(ext) ? 'public, max-age=604800' : cfg.prod ? 'public, max-age=300' : 'no-cache';
  return serveFile(req, res, f, cache);
}

// ------------------------------------------------------------------ dispatcher
const server = http.createServer(async (req, res) => {
  decorate(req, res);
  securityHeaders(res, req);
  const url = new URL(req.url, 'http://x');
  const pathname = url.pathname;
  try {
    if (!['GET', 'HEAD', 'POST', 'PUT', 'DELETE'].includes(req.method)) throw new HttpError(405, 'Method not allowed');
    if (!cfg.baseUrl) notify.runtime.baseUrl = baseUrlFor(req);

    // dynamic text routes
    if (pathname === '/robots.txt') return res.send(`User-agent: *\nDisallow: /api/\nDisallow: /pay/\nSitemap: ${baseUrlFor(req)}/sitemap.xml\n`, 'text/plain; charset=utf-8');
    if (pathname === '/sitemap.xml') return res.send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${baseUrlFor(req)}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url></urlset>`, 'application/xml');
    if (pathname === '/js/ga.js') {
      const js = cfg.gaId ? `window.dataLayer=window.dataLayer||[];window.gtag=function(){dataLayer.push(arguments)};gtag('js',new Date());gtag('config','${cfg.gaId}',{anonymize_ip:true});var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id=${cfg.gaId}';document.head.appendChild(s);` : 'window.gtag=function(){};';
      return res.send(js, 'text/javascript; charset=utf-8', 200, { 'Cache-Control': 'public, max-age=300' });
    }

    // API + pay pages
    if (pathname.startsWith('/api/') || pathname.startsWith('/pay/')) {
      const r = routes.find((x) => x.method === req.method && x.re.test(pathname));
      if (!r) {
        if (routes.some((x) => x.re.test(pathname))) throw new HttpError(405, 'Method not allowed');
        throw new HttpError(404, 'Not found');
      }
      const m = pathname.match(r.re);
      const params = {}; r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      const query = Object.fromEntries(url.searchParams);
      const c = { req, res, params, query, body: {}, raw: null, user: null, ip: req.ip, base: baseUrlFor(req), lang: req.headers['x-lang'] === 'es' ? 'es' : 'en' };
      req.lang = c.lang;

      if (req.method !== 'GET' && req.method !== 'HEAD' && !r.opts.noCsrf) {
        // CSRF: custom header + same-origin check
        if (req.headers['x-requested-with'] !== 'fetch') throw new HttpError(403, 'Invalid request');
        const origin = req.headers.origin;
        if (origin) {
          const host = (TRUST_PROXY && req.headers['x-forwarded-host']) || req.headers.host;
          let oh; try { oh = new URL(origin).host; } catch { oh = ''; }
          if (oh !== host) throw new HttpError(403, 'Cross-origin request blocked');
        }
      }
      if (req.method === 'POST' || req.method === 'PUT') {
        const raw = await readBody(req, r.opts.limit || 1_000_000);
        if (r.opts.raw) c.raw = raw;
        else if (raw.length) {
          if (!/json/.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Expected JSON');
          const b = parseJson(raw.toString('utf8'));
          if (b === null || typeof b !== 'object') throw new HttpError(400, 'Invalid JSON');
          c.body = b;
        }
      }
      c.user = currentUser(req);
      return await r.handler(c);
    }

    // pages & static
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    if (pathname === '/' || pathname === '/index.html') return res.send(indexHtml(req), 'text/html; charset=utf-8', 200, { 'Cache-Control': 'no-cache' });
    if (serveStatic(req, res, pathname)) return;
    // one-page app: unknown non-file paths fall back to the homepage
    if (!path.extname(pathname) && /^\/[\w-]+\/?$/.test(pathname)) return res.send(indexHtml(req), 'text/html; charset=utf-8', 200, { 'Cache-Control': 'no-cache' });
    throw new HttpError(404, 'Not found');
  } catch (e) {
    if (res.headersSent) return res.end();
    const isApi = pathname.startsWith('/api/') || pathname.startsWith('/pay/');
    if (e instanceof HttpError) {
      if (isApi) return res.json({ error: tr(e.message, req.lang), fields: e.fields }, e.status);
      return res.send(e.message, 'text/plain; charset=utf-8', e.status);
    }
    console.error(`[${new Date().toISOString()}] ${req.method} ${pathname}`, e);
    if (isApi) return res.json({ error: tr('Something went wrong on our side. Please try again.', req.lang) }, 500);
    res.send('Server error', 'text/plain; charset=utf-8', 500);
  }
});

module.exports = { app, server, route };

// Register routes (after `app` exists)
require('./routes/public')(app);
require('./routes/customer')(app);
require('./routes/pay')(app);
require('./routes/employee')(app);
require('./routes/admin')(app);

async function start() {
  await require('./lib/seed').seedIfEmpty();
  require('./lib/jobs').start();
  server.listen(cfg.port, () => {
    console.log(`Toro Pinto platform running on http://localhost:${cfg.port}  (payments: ${require('./lib/pay').mode()}${cfg.prod ? '' : ', dev mode'})`);
  });
}
if (require.main === module) start().catch((e) => { console.error(e); process.exit(1); });
module.exports.start = start;
