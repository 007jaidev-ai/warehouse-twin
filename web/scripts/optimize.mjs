// Builds the four reference layouts and writes public/data/layouts.json.
//   node scripts/optimize.mjs [iterations]
// Uses the exact same routing/scoring modules as the browser, so the numbers match.
import { readFileSync, writeFileSync } from 'node:fs';
import { buildWarehouse } from '../src/sim/warehouse.js';
import { buildTrips, routeNodes, scoreLayout, slotOfProduct, tripNodes } from '../src/sim/route.js';
import { abcLayout, affinityLayout, coOccurrence, originalLayout } from '../src/sim/layouts.js';

const DATA = new URL('../public/data/', import.meta.url);
const products = JSON.parse(readFileSync(new URL('products.json', DATA)));
const orders = JSON.parse(readFileSync(new URL('orders.json', DATA)));
const ITERS = Number(process.argv[2] || 60000);
const wh = buildWarehouse();

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Simulated annealing over slot swaps. Objective = exact replay distance of all trips.
// Only trips that contain one of the two swapped products are re-routed (delta evaluation).
function anneal(start, trips, { iters, T0 = 40, T1 = 0.2, seed = 42 }) {
  const rand = mulberry32(seed);
  const productAt = start.slice();
  const slotOf = slotOfProduct(productAt);
  const tripsOf = Array.from({ length: products.length }, () => []);
  trips.forEach((t, i) => t.products.forEach((p) => tripsOf[p].push(i)));
  const tripDist = trips.map((t) => routeNodes(wh, tripNodes(wh, slotOf, t)).dist);
  let total = tripDist.reduce((a, b) => a + b, 0);
  let best = total, bestLayout = productAt.slice();
  const stamp = new Int32Array(trips.length);
  const newDist = new Float64Array(trips.length);
  let accepted = 0;

  for (let it = 1; it <= iters; it++) {
    const s1 = Math.floor(rand() * wh.nSlots), s2 = Math.floor(rand() * wh.nSlots);
    if (wh.slots[s1].node === wh.slots[s2].node) continue; // same pick face: no effect
    const p1 = productAt[s1], p2 = productAt[s2];
    const affected = [];
    for (const t of tripsOf[p1]) { stamp[t] = it; affected.push(t); }
    for (const t of tripsOf[p2]) if (stamp[t] !== it) affected.push(t);

    productAt[s1] = p2; productAt[s2] = p1; slotOf[p1] = s2; slotOf[p2] = s1;
    let delta = 0;
    for (const t of affected) {
      newDist[t] = routeNodes(wh, tripNodes(wh, slotOf, trips[t])).dist;
      delta += newDist[t] - tripDist[t];
    }
    const T = T0 * Math.pow(T1 / T0, it / iters);
    if (delta <= 0 || rand() < Math.exp(-delta / T)) {
      for (const t of affected) tripDist[t] = newDist[t];
      total += delta;
      accepted++;
      if (total < best - 1e-6) { best = total; bestLayout = productAt.slice(); }
    } else {
      productAt[s1] = p1; productAt[s2] = p2; slotOf[p1] = s1; slotOf[p2] = s2;
    }
    if (it % 10000 === 0) console.log(`  SA ${it}/${iters}  T=${T.toFixed(2)}  current=${(total / 1000).toFixed(2)} km  best=${(best / 1000).toFixed(2)} km`);
  }
  return { layout: bestLayout, accepted };
}

function buildAll(prods, trainOrders, iters) {
  const trips = buildTrips(trainOrders, 1);
  const score = (l) => scoreLayout(wh, l, trips, trainOrders.length).dist;
  const original = originalLayout(wh, prods);
  const abc = abcLayout(wh, prods);
  const co = coOccurrence(prods.length, trainOrders);
  let affinity = abc, affinityW = 0, affScore = score(abc);
  for (const w of [0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 5, 8]) {
    const l = affinityLayout(wh, prods, co, w);
    const s = score(l);
    if (s < affScore) { affScore = s; affinity = l; affinityW = w; }
  }
  const t0 = Date.now();
  const { layout: optimized, accepted } = anneal(affinity, trips, { iters });
  return { original, abc, affinity, optimized, affinityW, accepted, saSeconds: (Date.now() - t0) / 1000 };
}

function report(name, layouts, evalOrders) {
  const out = {};
  for (const batch of [1, wh.cfg.batchSize]) {
    const trips = buildTrips(evalOrders, batch);
    for (const k of ['original', 'abc', 'affinity', 'optimized']) {
      const s = scoreLayout(wh, layouts[k], trips, evalOrders.length);
      (out[k] ||= {})[batch === 1 ? 'single' : 'batch'] = {
        km: +(s.dist / 1000).toFixed(3), mPerOrder: +s.distPerOrder.toFixed(1), secPerOrder: +s.secPerOrder.toFixed(1),
      };
    }
  }
  console.log(`\n${name}`);
  const base = out.original.single.km;
  for (const [k, v] of Object.entries(out))
    console.log(`  ${k.padEnd(10)} ${v.single.km.toFixed(2).padStart(7)} km  ${v.single.mPerOrder.toFixed(1).padStart(6)} m/order  ${v.single.secPerOrder.toFixed(0).padStart(4)} s/order  (${((1 - v.single.km / base) * 100).toFixed(1)}% saved)   batch: ${v.batch.km.toFixed(2)} km`);
  return out;
}

// 1) Full month: the layouts used in the game
console.log(`Full month: ${orders.length} orders, SA ${ITERS} iterations`);
const full = buildAll(products, orders, ITERS);
const fullScores = report('Full month (Nov 2010)', full, orders);

// 2) Hold-out check: design layouts on weeks 1-3 only, test on the last week they never saw
const SPLIT = '2010-11-22';
const train = orders.filter((o) => o.t < SPLIT), test = orders.filter((o) => o.t >= SPLIT);
const trainProducts = products.map((p) => ({ ...p, picks: 0 }));
for (const o of train) for (const [p] of o.items) trainProducts[p].picks++;
console.log(`\nHold-out: train ${train.length} orders (< ${SPLIT}), test ${test.length} orders`);
const ho = buildAll(trainProducts, train, Math.round(ITERS / 2));
const hoScores = report('Hold-out test week (layouts built without seeing it)', ho, test);

writeFileSync(new URL('layouts.json', DATA), JSON.stringify({
  layouts: { original: full.original, abc: full.abc, affinity: full.affinity, optimized: full.optimized },
  meta: {
    affinityW: full.affinityW, saIterations: ITERS, saAccepted: full.accepted, saSeconds: full.saSeconds,
    scores: fullScores,
    holdout: { split: SPLIT, trainOrders: train.length, testOrders: test.length, affinityW: ho.affinityW, scores: hoScores },
  },
}));
console.log('\nwrote public/data/layouts.json');
