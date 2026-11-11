// Dev-only: builds optimized brand assets from the source logo + trailer photos.
// Usage: NODE_PATH=/path/to/node_modules node scripts/make-assets.js <srcDir> <outDir>
const sharp = require('sharp');
const path = require('path');
const [src, out] = [process.argv[2], process.argv[3]];

async function logo() {
  const { data, info } = await sharp(path.join(src, 'logo.jpg')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const isDark = (i) => data[i] < 70 && data[i + 1] < 70 && data[i + 2] < 80;
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop();
    if (seen[p] || !isDark(p * 4)) continue;
    seen[p] = 1;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  // grow the transparent area by 2px to eat the dark JPEG fringe
  let cur = seen;
  for (let pass = 0; pass < 2; pass++) {
    const nxt = Uint8Array.from(cur);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (!cur[p] && (cur[p - 1] || cur[p + 1] || cur[p - w] || cur[p + w])) {
        const i = p * 4;
        if (data[i] + data[i + 1] + data[i + 2] < 330) nxt[p] = 1;
      }
    }
    cur = nxt;
  }
  for (let p = 0; p < w * h; p++) if (cur[p]) data[p * 4 + 3] = 0;
  const base = sharp(data, { raw: { width: w, height: h, channels: 4 } }).trim({ threshold: 1 });
  await base.clone().resize({ width: 640 }).png({ compressionLevel: 9 }).toFile(path.join(out, 'logo.png'));
  await base.clone().resize({ width: 192, height: 192, fit: 'contain', background: { r: 11, g: 31, b: 58, alpha: 1 } }).png().toFile(path.join(out, 'icon-192.png'));
  await base.clone().resize({ width: 512, height: 512, fit: 'contain', background: { r: 11, g: 31, b: 58, alpha: 1 } }).png().toFile(path.join(out, 'icon-512.png'));
  await base.clone().resize({ width: 64, height: 64, fit: 'contain', background: { r: 11, g: 31, b: 58, alpha: 1 } }).png().toFile(path.join(out, 'favicon.png'));
}

async function photos() {
  for (const [n, f] of [['trailer-1', 't1.jpg'], ['trailer-2', 't2.jpg'], ['trailer-3', 't3.jpg']]) {
    await sharp(path.join(src, f)).resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 76, mozjpeg: true }).toFile(path.join(out, n + '.jpg'));
    await sharp(path.join(src, f)).resize({ width: 640, withoutEnlargement: true }).jpeg({ quality: 72, mozjpeg: true }).toFile(path.join(out, n + '-sm.jpg'));
  }
  // OG image 1200x630: photo + navy gradient + logo
  const photo = await sharp(path.join(src, 't1.jpg')).resize(1200, 630, { fit: 'cover', position: 'centre' }).toBuffer();
  const grad = Buffer.from(`<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#0B1F3A" stop-opacity=".95"/><stop offset=".6" stop-color="#0B1F3A" stop-opacity=".55"/><stop offset="1" stop-color="#0B1F3A" stop-opacity=".1"/></linearGradient></defs><rect width="1200" height="630" fill="url(#g)"/><text x="64" y="330" font-family="Arial,Helvetica,sans-serif" font-size="64" font-weight="800" fill="#fff">A Cleaner Space.</text><text x="64" y="405" font-family="Arial,Helvetica,sans-serif" font-size="64" font-weight="800" fill="#2DD4CF">A Better Life.</text><text x="64" y="470" font-family="Arial,Helvetica,sans-serif" font-size="28" fill="#cfe3f5">Toro Pinto Cleaning Solutions · Book online · Free quotes</text></svg>`);
  const logoBuf = await sharp(path.join(out, 'logo.png')).resize({ height: 200 }).toBuffer();
  await sharp(photo).composite([{ input: grad }, { input: logoBuf, left: 64, top: 60 }]).jpeg({ quality: 80 }).toFile(path.join(out, 'og.jpg'));
  // card crops
  const crops = [['crop-reels', 't1.jpg', { left: 120, top: 380, width: 760, height: 560 }], ['crop-engine', 't1.jpg', { left: 640, top: 520, width: 760, height: 560 }], ['crop-side', 't2.jpg', { left: 560, top: 380, width: 800, height: 600 }], ['crop-front', 't3.jpg', { left: 330, top: 220, width: 900, height: 675 }]];
  for (const [n, f, r] of crops) await sharp(path.join(src, f)).extract(r).resize({ width: 640 }).jpeg({ quality: 74, mozjpeg: true }).toFile(path.join(out, n + '.jpg'));
}
(async () => { await logo(); await photos(); console.log('assets done'); })();
