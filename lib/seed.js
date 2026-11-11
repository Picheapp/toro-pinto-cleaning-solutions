'use strict';
// First-run seed: catalog, plans, coupons, sample gallery and the first admin account.
// ALL prices and perks below are PLACEHOLDERS — edit them in Admin before launch.
const { get, all, insert, run, tx, settings } = require('./db');
const { nowISO, uid } = require('./util');
const { hashPassword } = require('./auth');
const cfg = require('./config');
const ES = require('./seed-es');

const CATS = [
  ['residential-cleaning', 'Residential Cleaning', 'Homes, driveways and patios — freshly cleaned inside and out.'],
  ['commercial-cleaning', 'Commercial Cleaning', 'Storefronts, parking lots and gas stations kept spotless for your customers.'],
  ['deep-cleaning', 'Deep Cleaning', 'Top-to-bottom detail cleaning for when "regular" is not enough.'],
  ['move-in-move-out', 'Move-In / Move-Out Cleaning', 'Hand over (or receive) a spotless property.'],
  ['office-cleaning', 'Office Cleaning', 'Healthy, professional workspaces your team will love.'],
  ['post-construction', 'Post-Construction Cleaning', 'Dust, residue and debris removed after renovation or build.'],
  ['recurring-cleaning', 'Recurring Cleaning', 'Set it and forget it — weekly, biweekly or monthly service with savings.'],
  ['specialized', 'Specialized Cleaning Services', 'Roof soft wash, graffiti removal, glass and other specialty work.'],
];

// [cat, slug, name, desc, pricing, base, unit, min, segments, duration, recurring, image, details[], recommend[]]
const photo = (n) => `/img/${n}.jpg`;
const art = (slug) => `/img/art/cat-${slug}.svg`;
const SERVICES = [
  ['residential-cleaning', 'house-wash', 'House Exterior Wash', 'Gentle soft-wash and pressure cleaning that removes mildew, algae and dirt from siding, walls and trim without damaging paint.', 'sqft', 10000, 15, 15000, 'residential', 180, 0, photo('crop-front'), ['Soft-wash safe for paint and siding', 'Removes mildew, algae and road grime', 'Plants and windows protected', 'Fully equipped mobile rig — we bring our own water'], ['driveway-patio', 'roof-soft-wash']],
  ['residential-cleaning', 'driveway-patio', 'Driveway & Patio Pressure Washing', 'High-pressure surface cleaning that restores concrete, pavers and walkways and lifts oil and tire marks.', 'sqft', 5000, 18, 12000, 'both', 150, 0, photo('crop-reels'), ['Hot-spot treatment for oil and rust stains', 'Edges and joints detailed', 'Great before sealing or painting', 'Residential and commercial surfaces'], ['house-wash', 'window-glass']],
  ['residential-cleaning', 'home-cleaning', 'Standard Home Cleaning', 'Reliable interior cleaning — kitchens, bathrooms, bedrooms and living areas, dusted, wiped, vacuumed and mopped.', 'room', 6000, 3500, 9000, 'residential', 150, 1, art('residential-cleaning'), ['Kitchen & bathroom sanitizing', 'Dusting, vacuuming and mopping', 'Trash removal and surface wipe-down', 'Eco-friendly products available'], ['deep-home', 'recurring-home']],

  ['commercial-cleaning', 'storefront', 'Storefront & Sidewalk Washing', 'Make a great first impression: pressure washing for storefronts, sidewalks, entrances and walkways.', 'sqft', 10000, 14, 15000, 'commercial', 120, 1, photo('crop-side'), ['Early-morning and after-hours scheduling', 'Gum and stain removal', 'Recurring maintenance plans', 'Licensed and insured crews'], ['parking-lot', 'window-glass']],
  ['commercial-cleaning', 'parking-lot', 'Parking Lot & Pavement Cleaning', 'Remove oil, grease and buildup from lots, loading areas and drive lanes with powerful surface cleaners.', 'sqft', 15000, 8, 25000, 'commercial', 240, 1, photo('crop-engine'), ['Large-area surface cleaners', 'Oil and grease degreasing', 'Dumpster pad cleaning available', 'Water reclaim on request'], ['storefront', 'graffiti']],
  ['commercial-cleaning', 'gas-station', 'Gas Station & Forecourt Cleaning', 'Specialized degreasing and pressure cleaning for fuel stations — pumps islands, canopies, forecourts and lots.', 'quote', 0, 0, 0, 'commercial', 360, 1, photo('trailer-1'), ['Canopy, pump island and slab degreasing', 'Safe, fuel-station-appropriate procedures', 'Night and weekend scheduling', 'Free site walkthrough and quote'], ['parking-lot', 'recurring-commercial']],

  ['deep-cleaning', 'deep-home', 'Whole-Home Deep Clean', 'A detailed, room-by-room deep clean — baseboards, grout, appliances, fixtures and all the places a regular clean skips.', 'room', 9000, 5500, 18000, 'residential', 300, 0, art('deep-cleaning'), ['Baseboards, door frames and light switches', 'Tile and grout scrubbing', 'Appliance exteriors and cabinet fronts', 'Perfect for seasonal resets'], ['kitchen-bath', 'recurring-home']],
  ['deep-cleaning', 'kitchen-bath', 'Kitchen & Bath Deep Clean', 'Concentrated deep cleaning for the two hardest-working rooms in your home.', 'flat', 15000, 0, 15000, 'residential', 180, 0, art('deep-cleaning'), ['Degreasing and descaling', 'Shower, tub and tile detail', 'Sink, counter and fixture polish', 'Optional inside-appliance add-ons'], ['deep-home']],

  ['move-in-move-out', 'move-out', 'Move-In / Move-Out Cleaning', 'Get your deposit back — or start fresh in your new place — with a complete empty-home clean.', 'room', 8000, 6000, 20000, 'residential', 300, 0, art('move-in-move-out'), ['Inside cabinets, closets and drawers', 'Appliance and fixture cleaning', 'Floors, walls and baseboards', 'Checklist-based for landlords and agents'], ['deep-home', 'driveway-patio']],

  ['office-cleaning', 'office-cleaning', 'Office Cleaning', 'Professional janitorial-style cleaning that keeps workspaces healthy and presentable — one-time or recurring.', 'sqft', 6000, 10, 12000, 'commercial', 180, 1, art('office-cleaning'), ['Desks, common areas and restrooms', 'Break room and kitchenette', 'Floors, trash and recycling', 'Flexible after-hours schedule'], ['recurring-commercial', 'storefront']],

  ['post-construction', 'post-construction', 'Post-Construction Cleanup', 'Fine dust, paint splatter, adhesive and debris removed so your finished space is move-in ready.', 'sqft', 20000, 22, 30000, 'both', 360, 0, art('post-construction'), ['Dust removal from every surface', 'Window, frame and track detail', 'Sticker, paint and adhesive removal', 'Final inspection walk-through'], ['window-glass', 'driveway-patio']],

  ['recurring-cleaning', 'recurring-home', 'Recurring Home Cleaning', 'Keep your home consistently fresh with a regular crew and automatic scheduling — and save on every visit.', 'room', 5500, 3000, 8500, 'residential', 150, 1, art('recurring-cleaning'), ['Same trusted crew each visit', 'Weekly, biweekly or monthly', 'Automatic scheduling and invoicing', 'Plan discounts applied automatically'], ['deep-home', 'kitchen-bath']],
  ['recurring-cleaning', 'recurring-commercial', 'Recurring Commercial Maintenance', 'Tailored maintenance programs for offices, retail and industrial sites — scoped after a quick walkthrough.', 'quote', 0, 0, 0, 'commercial', 240, 1, art('recurring-cleaning'), ['Custom scope and schedule', 'Volume pricing', 'Single point of contact', 'Monthly invoicing available'], ['office-cleaning', 'storefront']],

  ['specialized', 'roof-soft-wash', 'Roof Soft Wash', 'Low-pressure roof cleaning that removes black streaks, algae and mildew without damaging shingles or tiles.', 'sqft', 15000, 20, 25000, 'both', 240, 0, photo('trailer-3'), ['Low-pressure, roof-safe method', 'Kills algae and mildew at the root', 'Extends roof life', 'Landscaping protected'], ['house-wash']],
  ['specialized', 'graffiti', 'Graffiti & Gum Removal', 'Targeted removal of graffiti, paint overspray and stuck-on gum from masonry, concrete and metal.', 'quote', 0, 0, 0, 'both', 180, 0, photo('trailer-2'), ['Surface-appropriate removal methods', 'Fast response for businesses', 'Optional protective coating', 'Free quote from photos'], ['storefront', 'parking-lot']],
  ['specialized', 'window-glass', 'Window & Glass Cleaning', 'Streak-free interior and exterior glass cleaning — storefronts, patio doors and residential windows.', 'flat', 12000, 0, 12000, 'both', 120, 1, art('specialized'), ['Up to 15 windows included', 'Frames, sills and tracks wiped', 'Hard-water spot treatment available', 'Pure-water systems for exterior glass'], ['house-wash', 'storefront']],
];

const ADDONS = [
  ['residential-cleaning', 'Window cleaning (interior)', 3500], ['residential-cleaning', 'Gutter rinse', 6000], ['residential-cleaning', 'Oil / rust stain treatment', 4500], ['residential-cleaning', 'Protective sealant', 8000],
  ['commercial-cleaning', 'Graffiti spot treatment', 7500], ['commercial-cleaning', 'Dumpster pad cleaning', 9000], ['commercial-cleaning', 'Gum removal', 6000],
  ['deep-cleaning', 'Inside refrigerator', 3000], ['deep-cleaning', 'Inside oven', 3500], ['deep-cleaning', 'Inside cabinets', 4000], ['deep-cleaning', 'Detailed baseboards', 3000],
  ['move-in-move-out', 'Carpet deodorize', 4500], ['move-in-move-out', 'Wall spot cleaning', 5000],
  ['office-cleaning', 'Disinfectant spray treatment', 8500], ['office-cleaning', 'Break room deep clean', 6000],
  ['post-construction', 'Small debris haul-away', 12000], ['post-construction', 'Window & track detail', 7000],
  ['recurring-cleaning', 'Inside refrigerator', 2500], ['recurring-cleaning', 'Laundry fold', 3000],
  ['specialized', 'Rust stain removal', 5500], ['specialized', 'Protective sealant', 9000],
];

const PRODUCTS = [
  // slug, category, name, desc, image, bundle, variants[[name, price, stock, compare]]
  ['all-purpose-cleaner', 'Cleaners', 'Pro All-Purpose Cleaner', 'Streak-free concentrate that cuts through everyday grime on counters, floors and walls. Pleasant, low-odor scent.', 'prod-all-purpose', 0, [['32 oz spray', 899, 40], ['1 gallon', 1999, 30], ['5 gallon pail', 6499, 10]]],
  ['heavy-duty-degreaser', 'Cleaners', 'Heavy-Duty Degreaser', 'Professional-strength degreaser for grills, garage floors, engines and commercial kitchens.', 'prod-degreaser', 0, [['1 gallon', 2499, 25], ['5 gallon pail', 8999, 8]]],
  ['glass-cleaner', 'Cleaners', 'Streak-Free Glass Cleaner', 'Ammonia-free glass and mirror cleaner that dries crystal clear.', 'prod-glass', 0, [['32 oz spray', 799, 50], ['1 gallon', 1799, 20]]],
  ['floor-cleaner', 'Cleaners', 'Eco Floor Cleaner', 'Plant-based floor cleaner safe for tile, vinyl, laminate and sealed wood.', 'prod-floor', 0, [['1 gallon', 1899, 30]]],
  ['surface-sanitizer', 'Cleaners', 'Surface Sanitizer Spray', 'Fast-acting sanitizing spray for high-touch surfaces at home or in the office.', 'prod-sanitizer', 0, [['24 oz spray', 999, 45]]],
  ['microfiber-cloths', 'Tools', 'Microfiber Cloth Pack', 'Lint-free, ultra-absorbent microfiber cloths. Machine washable and reusable.', 'prod-microfiber', 0, [['6-pack', 1199, 60], ['12-pack', 1999, 40]]],
  ['window-squeegee-kit', 'Tools', 'Professional Window Squeegee Kit', 'Stainless steel squeegee with rubber blade, scrubber sleeve and extension handle.', 'prod-squeegee', 0, [['Standard kit', 2999, 15]]],
  ['pro-cleaning-bucket-kit', 'Tools', 'Pro Cleaning Bucket Kit', 'Heavy-duty bucket with wringer, scrub brush and sponge — everything for floors and walls.', 'prod-bucket', 0, [['Standard kit', 3499, 12]]],
  ['home-refresh-bundle', 'Bundles', 'Home Refresh Bundle', 'All-Purpose Cleaner (32 oz) + Glass Cleaner (32 oz) + 6 microfiber cloths. A ready-to-go cleaning starter set.', 'prod-bundle-home', 1, [['Bundle', 2299, 0, 2897]], [['all-purpose-cleaner', '32 oz spray', 1], ['glass-cleaner', '32 oz spray', 1], ['microfiber-cloths', '6-pack', 1]]],
  ['office-care-bundle', 'Bundles', 'Office Care Bundle', 'Surface Sanitizer + All-Purpose Cleaner (1 gal) + 12 microfiber cloths for shared workspaces.', 'prod-bundle-office', 1, [['Bundle', 3299, 0, 4197]], [['surface-sanitizer', '24 oz spray', 1], ['all-purpose-cleaner', '1 gallon', 1], ['microfiber-cloths', '12-pack', 1]]],
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
