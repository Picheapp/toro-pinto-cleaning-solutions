// Dev-only: generates the placeholder illustrations (category art, product art, before/after samples).
// Replace them with real photos from Admin → Services / Products / Content at any time.
const fs = require('fs');
const path = require('path');
const out = path.join(__dirname, '..', 'public', 'img', 'art');
fs.mkdirSync(out, { recursive: true });

const NAVY = '#0B1F3A', NAVY2 = '#12335F', TEAL = '#14C8C0', ICE = '#E6FBFA';

function bubbles(seed, n = 14) {
  let s = seed; const r = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  let o = '';
  for (let i = 0; i < n; i++) {
    const cx = r() * 800, cy = r() * 560, rad = 10 + r() * 46;
    o += `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${rad.toFixed(0)}" fill="none" stroke="#fff" stroke-opacity="${(0.1 + r() * 0.22).toFixed(2)}" stroke-width="2"/><circle cx="${(cx - rad * 0.3).toFixed(0)}" cy="${(cy - rad * 0.3).toFixed(0)}" r="${(rad * 0.18).toFixed(0)}" fill="#fff" fill-opacity="0.25"/>`;
  }
  return o;
}
const icons = {
  house: '<path d="M300 300 L400 210 L500 300 M320 285 V380 H480 V285 M375 380 V325 H425 V380" />',
  building: '<path d="M335 380 V225 H445 V380 M445 280 H485 V380 M335 380 H485 M360 250 H380 M400 250 H420 M360 290 H380 M400 290 H420 M360 330 H380 M400 330 H420" />',
  sparkle: '<path d="M400 215 L418 275 L478 293 L418 311 L400 371 L382 311 L322 293 L382 275 Z M475 220 L482 243 L505 250 L482 257 L475 280 L468 257 L445 250 L468 243 Z" />',
  box: '<path d="M320 270 L400 230 L480 270 V350 L400 390 L320 350 Z M320 270 L400 310 L480 270 M400 310 V390" />',
  office: '<path d="M320 250 H480 V335 H320 Z M370 380 H430 M400 335 V380 M345 285 H410" />',
  hardhat: '<path d="M315 335 H485 M330 335 C330 270 365 235 400 235 C435 235 470 270 470 335 M400 235 V335 M365 250 V335 M435 250 V335" />',
  refresh: '<path d="M470 275 A75 75 0 0 0 335 270 M335 270 L330 235 M335 270 L372 268 M330 320 A75 75 0 0 0 465 330 M465 330 L470 365 M465 330 L428 332" />',
  spray: '<path d="M360 380 V300 H430 V380 Z M375 300 V270 H415 V300 M415 280 H455 M470 262 L492 250 M470 282 H498 M470 302 L492 314" />',
};
function categoryArt(name, icon, seed, hueShift) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 560" preserveAspectRatio="xMidYMid slice">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${NAVY}"/><stop offset=".65" stop-color="${NAVY2}"/><stop offset="1" stop-color="${hueShift}"/></linearGradient>
<radialGradient id="r" cx=".72" cy=".3" r=".6"><stop offset="0" stop-color="${TEAL}" stop-opacity=".45"/><stop offset="1" stop-color="${TEAL}" stop-opacity="0"/></radialGradient></defs>
<rect width="800" height="560" fill="url(#g)"/><rect width="800" height="560" fill="url(#r)"/>${bubbles(seed)}
<circle cx="400" cy="300" r="150" fill="#fff" fill-opacity=".07"/><circle cx="400" cy="300" r="118" fill="#fff" fill-opacity=".08"/>
<g fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">${icons[icon]}</g></svg>`;
}
const cats = [
  ['residential-cleaning', 'house', 11, '#0F8F94'], ['commercial-cleaning', 'building', 22, '#1A4E8C'], ['deep-cleaning', 'sparkle', 33, '#14A7B5'],
  ['move-in-move-out', 'box', 44, '#2A5F9E'], ['office-cleaning', 'office', 55, '#0F7F8E'], ['post-construction', 'hardhat', 66, '#27508A'],
  ['recurring-cleaning', 'refresh', 77, '#12A19E'], ['specialized', 'spray', 88, '#1E6AA8'],
];
for (const [slug, icon, seed, c] of cats) fs.writeFileSync(path.join(out, `cat-${slug}.svg`), categoryArt(slug, icon, seed, c));

// ---------- products ----------
function productArt(kind, label, accent = TEAL, seed = 3) {
  const bg = `<defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F4F8FB"/><stop offset="1" stop-color="#DCE8F2"/></linearGradient></defs><rect width="600" height="600" fill="url(#b)"/><ellipse cx="300" cy="520" rx="170" ry="22" fill="#0B1F3A" fill-opacity=".12"/>`;
  const lab = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="#fff"/><rect x="${x}" y="${y}" width="${w}" height="12" rx="6" fill="${NAVY}"/><text x="${x + w / 2}" y="${y + h / 2 + 12}" text-anchor="middle" font-family="Arial" font-weight="800" font-size="30" fill="${NAVY}">${label}</text><text x="${x + w / 2}" y="${y + h - 18}" text-anchor="middle" font-family="Arial" font-weight="700" font-size="15" fill="${accent}">TORO PINTO</text>`;
  const shapes = {
    spray: `<rect x="215" y="230" width="170" height="290" rx="32" fill="${accent}"/>${lab(225, 300, 150, 150)}<rect x="260" y="170" width="80" height="70" rx="12" fill="${NAVY}"/><rect x="250" y="130" width="140" height="48" rx="14" fill="${NAVY2}"/><rect x="368" y="142" width="46" height="18" rx="8" fill="${NAVY2}"/>`,
    jug: `<path d="M170 230 H430 V500 Q430 520 410 520 H190 Q170 520 170 500 Z" fill="${accent}"/><path d="M330 230 V170 Q330 140 360 140 H410 V230" fill="${accent}" stroke="${NAVY}" stroke-opacity=".15" stroke-width="3"/><rect x="215" y="115" width="110" height="60" rx="14" fill="${NAVY}"/>${lab(195, 300, 210, 170)}`,
    cloth: `<g>${[0, 1, 2, 3].map((i) => `<rect x="${170 + i * 14}" y="${210 + i * 18}" width="250" height="170" rx="16" fill="${['#FFC83D', accent, '#4C8DFF', '#fff'][i]}" stroke="${NAVY}" stroke-opacity=".12"/>`).join('')}</g><rect x="150" y="400" width="300" height="100" rx="16" fill="${NAVY}"/><text x="300" y="460" text-anchor="middle" font-family="Arial" font-weight="800" font-size="30" fill="#fff">${label}</text>`,
    squeegee: `<rect x="130" y="230" width="340" height="46" rx="12" fill="${NAVY}"/><rect x="150" y="270" width="300" height="14" rx="6" fill="${accent}"/><rect x="285" y="276" width="30" height="230" rx="14" fill="${accent}"/><rect x="278" y="400" width="44" height="110" rx="16" fill="${NAVY}"/>`,
    bucket: `<path d="M170 250 H430 L405 510 H195 Z" fill="${accent}"/><ellipse cx="300" cy="250" rx="130" ry="26" fill="${NAVY}"/><path d="M185 235 Q300 90 415 235" fill="none" stroke="${NAVY}" stroke-width="10" stroke-linecap="round"/>${lab(225, 320, 150, 130)}`,
    bundle: `<rect x="130" y="270" width="340" height="240" rx="18" fill="${NAVY}"/><rect x="130" y="270" width="340" height="52" rx="18" fill="${accent}"/><rect x="280" y="270" width="40" height="240" fill="${accent}" fill-opacity=".9"/><rect x="200" y="150" width="70" height="140" rx="14" fill="${accent}" stroke="#fff" stroke-width="4"/><rect x="290" y="130" width="70" height="160" rx="14" fill="#fff" stroke="${accent}" stroke-width="4"/><rect x="380" y="170" width="70" height="120" rx="14" fill="#FFC83D"/><text x="300" y="440" text-anchor="middle" font-family="Arial" font-weight="800" font-size="38" fill="#fff">${label}</text>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">${bg}${shapes[kind]}</svg>`;
}
const prods = [
  ['all-purpose', 'spray', 'ALL-PURPOSE', TEAL], ['degreaser', 'jug', 'DEGREASER', '#F2A300'], ['glass', 'spray', 'GLASS', '#4C8DFF'],
  ['microfiber', 'cloth', 'MICROFIBER', TEAL], ['squeegee', 'squeegee', 'SQUEEGEE', TEAL], ['floor', 'jug', 'FLOOR', '#25B26B'],
  ['sanitizer', 'spray', 'SANITIZER', '#8B5CF6'], ['bundle-home', 'bundle', 'HOME BUNDLE', TEAL], ['bundle-office', 'bundle', 'OFFICE BUNDLE', '#4C8DFF'], ['bucket', 'bucket', 'PRO KIT', TEAL],
];
for (const [slug, kind, label, accent] of prods) fs.writeFileSync(path.join(out, `prod-${slug}.svg`), productArt(kind, label, accent));

// ---------- before / after illustrations ----------
function scene(dirty, v) {
  const wall = v === 1 ? '#CFE3F5' : '#F2E9DC';
  const ground = v === 1 ? '#C9CED4' : '#D8D1C7';
  const sky = v === 1 ? ['#BFE6FF', '#EAF7FF'] : ['#FFE3B8', '#FFF6E6'];
  const grime = dirty ? `
  <filter id="gr${v}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".012 .03" numOctaves="4" seed="${v * 7}"/><feColorMatrix values="0 0 0 0 .16  0 0 0 0 .13  0 0 0 0 .09  0 0 0 1.35 -.35"/></filter>
  <filter id="mold${v}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="3" seed="${v * 3}"/><feColorMatrix values="0 0 0 0 .18  0 0 0 0 .32  0 0 0 0 .12  0 0 0 1.8 -.7"/></filter>
  <rect x="0" y="120" width="800" height="440" filter="url(#gr${v})" opacity=".62"/>
  <rect x="0" y="230" width="800" height="110" filter="url(#mold${v})" opacity=".7"/>
  <ellipse cx="250" cy="450" rx="150" ry="38" fill="#3b2f23" opacity=".28"/><ellipse cx="560" cy="500" rx="110" ry="30" fill="#2b241c" opacity=".3"/><ellipse cx="640" cy="380" rx="80" ry="16" fill="#1f3a1a" opacity=".22"/>
  <rect x="0" y="330" width="800" height="14" fill="#2c2418" opacity=".16"/>` : '';
  let siding = '';
  for (let y = 135; y < 330; y += 22) siding += `<line x1="0" y1="${y}" x2="800" y2="${y}" stroke="#000" stroke-opacity=".08" stroke-width="2"/>`;
  let joints = '';
  for (let x = 0; x <= 800; x += 160) joints += `<line x1="${x}" y1="344" x2="${x}" y2="560" stroke="#000" stroke-opacity=".12" stroke-width="3"/>`;
  joints += `<line x1="0" y1="452" x2="800" y2="452" stroke="#000" stroke-opacity=".1" stroke-width="3"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 560" preserveAspectRatio="xMidYMid slice">
<defs><linearGradient id="sk${v}${dirty}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient></defs>
<rect width="800" height="130" fill="url(#sk${v}${dirty})"/><rect y="120" width="800" height="224" fill="${wall}"/>${siding}
<rect x="90" y="165" width="170" height="130" rx="6" fill="#fff"/><rect x="100" y="175" width="150" height="110" fill="#9fd4f0"/><line x1="175" y1="175" x2="175" y2="285" stroke="#fff" stroke-width="6"/><line x1="100" y1="230" x2="250" y2="230" stroke="#fff" stroke-width="6"/>
<rect x="520" y="150" width="130" height="194" rx="6" fill="#8a5a3c"/><circle cx="632" cy="250" r="7" fill="#e7c36b"/>
<rect y="344" width="800" height="216" fill="${ground}"/>${joints}${grime}
${dirty ? '' : `<g fill="#fff" fill-opacity=".55"><circle cx="150" cy="420" r="6"/><circle cx="460" cy="380" r="4"/><circle cx="700" cy="440" r="7"/><path d="M330 480 l6 -14 l6 14 l14 6 l-14 6 l-6 14 l-6 -14 l-14 -6z"/></g>`}</svg>`;
}
for (const v of [1, 2]) {
  fs.writeFileSync(path.join(out, `sample-before-${v}.svg`), scene(true, v));
  fs.writeFileSync(path.join(out, `sample-after-${v}.svg`), scene(false, v));
}
console.log('art generated →', out);
