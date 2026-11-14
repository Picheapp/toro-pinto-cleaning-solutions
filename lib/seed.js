'use strict';
// First-run seed: catalog, plans, coupons, sample gallery and the first admin account.
// ALL prices and perks below are PLACEHOLDERS — edit them in Admin before launch.
const { get, all, insert, run, tx, settings } = require('./db');
const { nowISO, uid } = require('./util');
const { hashPassword } = require('./auth');
const cfg = require('./config');
const ES = require('./seed-es');

const CATS = [
  ['residential-cleaning', 'Residential Cleaning', 'Pressure washing for homes, driveways and patios — outside only.'],
  ['commercial-cleaning', 'Commercial Cleaning', 'Storefronts, parking lots and gas stations kept spotless for your customers.'],
  ['restaurant-kitchen', 'Restaurant & Food Service', 'Industrial restaurant kitchens and fast-food / quick-service locations — hoods, floors, equipment and grease.'],
  ['recurring-cleaning', 'Recurring Cleaning', 'Set it and forget it — weekly, biweekly or monthly service with savings.'],
  ['specialized', 'Specialized Cleaning Services', 'Roof soft wash, graffiti removal, glass and other specialty work.'],
];

// [cat, slug, name, desc, pricing, base, unit, min, segments, duration, recurring, image, details[], recommend[]]
const photo = (n) => `/img/${n}.jpg`;
const art = (slug) => `/img/art/cat-${slug}.svg`;
const SERVICES = [
  ['residential-cleaning', 'house-wash', 'House Exterior Wash', 'Gentle soft-wash and pressure cleaning that removes mildew, algae and dirt from siding, walls and trim without damaging paint.', 'sqft', 10000, 15, 15000, 'residential', 180, 0, photo('crop-front'), ['Soft-wash safe for paint and siding', 'Removes mildew, algae and road grime', 'Plants and windows protected', 'Fully equipped mobile rig — we bring our own water'], ['driveway-patio', 'roof-soft-wash']],
  ['residential-cleaning', 'driveway-patio', 'Driveway & Patio Pressure Washing', 'High-pressure surface cleaning that restores concrete, pavers and walkways and lifts oil and tire marks.', 'sqft', 5000, 18, 12000, 'both', 150, 0, photo('crop-reels'), ['Hot-spot treatment for oil and rust stains', 'Edges and joints detailed', 'Great before sealing or painting', 'Residential and commercial surfaces'], ['house-wash', 'window-glass']],

  ['commercial-cleaning', 'storefront', 'Storefront & Sidewalk Washing', 'Make a great first impression: pressure washing for storefronts, sidewalks, entrances and walkways.', 'sqft', 10000, 14, 15000, 'commercial', 120, 1, photo('crop-side'), ['Early-morning and after-hours scheduling', 'Gum and stain removal', 'Recurring maintenance plans', 'Licensed and insured crews'], ['parking-lot', 'window-glass']],
  ['commercial-cleaning', 'parking-lot', 'Parking Lot & Pavement Cleaning', 'Remove oil, grease and buildup from lots, loading areas and drive lanes with powerful surface cleaners.', 'sqft', 15000, 8, 25000, 'commercial', 240, 1, photo('crop-engine'), ['Large-area surface cleaners', 'Oil and grease degreasing', 'Dumpster pad cleaning available', 'Water reclaim on request'], ['storefront', 'graffiti']],
  ['commercial-cleaning', 'gas-station', 'Gas Station & Forecourt Cleaning', 'Specialized degreasing and pressure cleaning for fuel stations — pumps islands, canopies, forecourts and lots.', 'quote', 0, 0, 0, 'commercial', 360, 1, photo('trailer-1'), ['Canopy, pump island and slab degreasing', 'Safe, fuel-station-appropriate procedures', 'Night and weekend scheduling', 'Free site walkthrough and quote'], ['parking-lot', 'industrial-kitchen']],





  ['recurring-cleaning', 'recurring-commercial', 'Recurring Commercial Maintenance', 'Tailored maintenance programs for restaurants, retail and industrial sites — scoped after a quick walkthrough.', 'quote', 0, 0, 0, 'commercial', 240, 1, art('recurring-cleaning'), ['Custom scope and schedule', 'Volume pricing', 'Single point of contact', 'Monthly invoicing available'], ['industrial-kitchen', 'storefront']],

  ['restaurant-kitchen', 'industrial-kitchen', 'Industrial Restaurant Kitchen Cleaning', 'Heavy-duty degreasing for commercial kitchens — hoods and exhaust, cooking lines, fryers, walls, floors and drains — scoped after a free walkthrough.', 'quote', 0, 0, 0, 'commercial', 300, 1, art('restaurant-kitchen'), ['Hood, exhaust and cooking-line degreasing', 'Walls, floors, drains and grease traps area', 'Night and early-morning scheduling around service', 'Free site walkthrough and quote'], ['fast-food', 'recurring-commercial']],
  ['restaurant-kitchen', 'fast-food', 'Fast-Food & Quick-Service Cleaning', 'Fast, repeatable cleaning programs for fast-food and quick-service shops — kitchens, equipment, floors and drive-thru and entrance pressure washing.', 'quote', 0, 0, 0, 'commercial', 240, 1, art('restaurant-kitchen'), ['Kitchen and equipment degreasing', 'Floor and drain scrubbing', 'Drive-thru, entrance and dumpster pad washing', 'Weekly, biweekly or monthly programs'], ['industrial-kitchen', 'recurring-commercial']],

  ['specialized', 'roof-soft-wash', 'Roof Soft Wash', 'Low-pressure roof cleaning that removes black streaks, algae and mildew without damaging shingles or tiles.', 'sqft', 15000, 20, 25000, 'both', 240, 0, photo('trailer-3'), ['Low-pressure, roof-safe method', 'Kills algae and mildew at the root', 'Extends roof life', 'Landscaping protected'], ['house-wash']],
  ['specialized', 'graffiti', 'Graffiti & Gum Removal', 'Targeted removal of graffiti, paint overspray and stuck-on gum from masonry, concrete and metal.', 'quote', 0, 0, 0, 'both', 180, 0, photo('trailer-2'), ['Surface-appropriate removal methods', 'Fast response for businesses', 'Optional protective coating', 'Free quote from photos'], ['storefront', 'parking-lot']],
  ['specialized', 'window-glass', 'Window & Glass Cleaning', 'Streak-free exterior glass cleaning — storefronts, patio doors and residential windows.', 'flat', 12000, 0, 12000, 'both', 120, 1, art('specialized'), ['Up to 15 windows included', 'Frames, sills and tracks wiped', 'Hard-water spot treatment available', 'Pure-water systems for exterior glass'], ['house-wash', 'storefront']],
];

const ADDONS = [
  ['residential-cleaning', 'Gutter rinse', 6000], ['residential-cleaning', 'Oil / rust stain treatment', 4500], ['residential-cleaning', 'Protective sealant', 8000],
  ['commercial-cleaning', 'Graffiti spot treatment', 7500], ['commercial-cleaning', 'Dumpster pad cleaning', 9000], ['commercial-cleaning', 'Gum removal', 6000],
  ['specialized', 'Rust stain removal', 5500], ['specialized', 'Protective sealant', 9000],
];

const PRODUCTS = [
  // slug, category, name, desc, image, bundle, variants[[name, price, stock, compare]]
  ['all-purpose-cleaner', 'Cleaners', 'Pro All-Purpose Cleaner', 'Streak-free concentrate that cuts through everyday grime on counters, floors and walls. Pleasant, low-odor scent.', 'prod-all-purpose', 0, [['32 oz spray', 899, 40], ['1 gallon', 1999, 30], ['5 gallon pail', 6499, 10]]],
  ['heavy-duty-degreaser', 'Cleaners', 'Heavy-Duty Degreaser', 'Professional-strength degreaser for grills, garage floors, engines and commercial kitchens.', 'prod-degreaser', 0, [['1 gallon', 2499, 25], ['5 gallon pail', 8999, 8]]],
  ['glass-cleaner', 'Cleaners', 'Streak-Free Glass Cleaner', 'Ammonia-free glass and mirror cleaner that dries crystal clear.', 'prod-glass', 0, [['32 oz spray', 799, 50], ['1 gallon', 1799, 20]]],
  ['floor-cleaner', 'Cleaners', 'Eco Floor Cleaner', 'Plant-based floor cleaner safe for tile, vinyl, laminate and sealed wood.', 'prod-floor', 0, [['1 gallon', 1899, 30]]],
  ['surface-sanitizer', 'Cleaners', 'Surface Sanitizer Spray', 'Fast-acting sanitizing spray for high-touch surfaces in kitchens and food-service areas.', 'prod-sanitizer', 0, [['24 oz spray', 999, 45]]],
  ['microfiber-cloths', 'Tools', 'Microfiber Cloth Pack', 'Lint-free, ultra-absorbent microfiber cloths. Machine washable and reusable.', 'prod-microfiber', 0, [['6-pack', 1199, 60], ['12-pack', 1999, 40]]],
  ['window-squeegee-kit', 'Tools', 'Professional Window Squeegee Kit', 'Stainless steel squeegee with rubber blade, scrubber sleeve and extension handle.', 'prod-squeegee', 0, [['Standard kit', 2999, 15]]],
  ['pro-cleaning-bucket-kit', 'Tools', 'Pro Cleaning Bucket Kit', 'Heavy-duty bucket with wringer, scrub brush and sponge — everything for floors and walls.', 'prod-bucket', 0, [['Standard kit', 3499, 12]]],
];

const PLANS = [
  ['Plus', 2900, 5, ['5% off every service', 'Free estimate re-checks', 'Member-only promotions'], 0],
  ['Premium', 5900, 10, ['10% off every service', 'Priority scheduling', 'Member-only promotions', 'Free add-on once per quarter'], 1],
  ['Elite', 9900, 15, ['15% off every service', 'Priority scheduling', 'Dedicated crew lead', 'Free add-on every month'], 0],
];

async function seedIfEmpty() {
  const S = settings();
  if (!get('SELECT 1 x FROM categories LIMIT 1')) {
    tx(() => {
      const catIds = {};
      CATS.forEach(([slug, name, desc], i) => { catIds[slug] = insert('INSERT INTO categories(slug,name,description,image,sort) VALUES(?,?,?,?,?)', slug, name, desc, `/img/art/cat-${slug}.svg`, i); });
      SERVICES.forEach(([cat, slug, name, desc, pt, base, unit, min, seg, dur, rec, img, details, recommend], i) => {
        insert('INSERT INTO services(category_id,slug,name,description,image,pricing_type,base_cents,unit_cents,min_cents,segments,duration_min,details,recommend,recurring_ok,sort) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          catIds[cat], slug, name, desc, img, pt, base, unit, min, seg, dur, JSON.stringify(details), JSON.stringify(recommend), rec, i);
      });
      ADDONS.forEach(([cat, name, price], i) => insert('INSERT INTO addons(category_id,name,price_cents,sort) VALUES(?,?,?,?)', catIds[cat], name, price, i));
      const variantIds = {};
      PRODUCTS.forEach(([slug, category, name, desc, img, bundle, variants, items], i) => {
        const pid = insert('INSERT INTO products(slug,category,name,description,image,is_bundle,sort) VALUES(?,?,?,?,?,?,?)', slug, category, name, desc, `/img/art/${img}.svg`, bundle, i);
        variants.forEach(([vname, price, stock, compare], j) => {
          const vid = insert('INSERT INTO variants(product_id,name,sku,price_cents,compare_cents,stock,sort) VALUES(?,?,?,?,?,?,?)', pid, vname, `${slug.toUpperCase().slice(0, 6)}-${j + 1}`, price, compare || null, stock, j);
          variantIds[`${slug}|${vname}`] = vid;
          if (items) for (const [s, vn, q] of items) insert('INSERT INTO bundle_items(bundle_variant_id,variant_id,qty) VALUES(?,?,?)', vid, variantIds[`${s}|${vn}`], q);
        });
      });
      PLANS.forEach(([name, price, disc, perks, hl], i) => insert('INSERT INTO membership_plans(name,price_cents,discount_pct,perks,highlight,sort) VALUES(?,?,?,?,?,?)', name, price, disc, JSON.stringify(perks), hl, i));
      insert(`INSERT INTO coupons(code,description,type,value,min_cents,applies_to) VALUES('WELCOME10','10% off your first booking','percent',10,0,'services')`);
      insert(`INSERT INTO coupons(code,description,type,value,min_cents,applies_to) VALUES('COMEBACK10','Welcome-back offer for returning customers','percent',10,0,'all')`);
      insert(`INSERT INTO coupons(code,description,type,value,min_cents,applies_to) VALUES('SHOP10','10% off supplies','percent',10,2500,'products')`);
      insert(`INSERT INTO gallery(title,before_img,after_img,caption,is_sample,sort) VALUES(?,?,?,?,1,1)`, 'Driveway & wall wash', '/img/art/sample-before-1.svg', '/img/art/sample-after-1.svg', 'Illustration — replace with your own job photos in Admin → Content');
      insert(`INSERT INTO gallery(title,before_img,after_img,caption,is_sample,sort) VALUES(?,?,?,?,1,2)`, 'Patio & entry restoration', '/img/art/sample-before-2.svg', '/img/art/sample-after-2.svg', 'Illustration — replace with your own job photos in Admin → Content');
      // Spanish content
      for (const [slug, [n, d]] of Object.entries(ES.categories)) run('UPDATE categories SET name_es=?, description_es=? WHERE slug=?', n, d, slug);
      for (const [slug, [n, d, det]] of Object.entries(ES.services)) run('UPDATE services SET name_es=?, description_es=?, details_es=? WHERE slug=?', n, d, JSON.stringify(det), slug);
      for (const [en, es] of Object.entries(ES.addons)) run('UPDATE addons SET name_es=? WHERE name=?', es, en);
      for (const [slug, [n, d, vars, cat]] of Object.entries(ES.products)) {
        run('UPDATE products SET name_es=?, description_es=?, category_es=? WHERE slug=?', n, d, cat, slug);
        for (const [ven, ves] of Object.entries(vars)) run('UPDATE variants SET name_es=? WHERE name=? AND product_id=(SELECT id FROM products WHERE slug=?)', ves, ven, slug);
      }
      for (const [name, perks] of Object.entries(ES.plans)) run('UPDATE membership_plans SET perks_es=? WHERE name=?', JSON.stringify(perks), name);
      for (const [title, [t, c]] of Object.entries(ES.gallery)) run('UPDATE gallery SET title_es=?, caption_es=? WHERE title=?', t, c, title);
    });
  }
  if (!get(`SELECT 1 x FROM users WHERE role='admin' LIMIT 1`)) {
    const email = cfg.adminEmail || 'admin@toropinto.local';
    const generated = !cfg.adminPassword;
    const pw = cfg.adminPassword || uid(6);
    insert('INSERT INTO users(role,name,email,phone,password_hash,created_at) VALUES(?,?,?,?,?,?)', 'admin', 'Toro Pinto Admin', email, S.business.phone, await hashPassword(pw), nowISO());
    console.log('\n================ FIRST ADMIN ACCOUNT ================');
    console.log(` email:    ${email}`);
    if (generated) console.log(` password: ${pw}   (generated — shown only once, change it after logging in)`);
    else console.log(' password: (from ADMIN_PASSWORD)');
    console.log('=====================================================\n');
  }
}

module.exports = { seedIfEmpty };
