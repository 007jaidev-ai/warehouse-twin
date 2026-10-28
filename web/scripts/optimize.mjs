// Builds the four reference layouts and writes public/data/layouts.json.
//   node scripts/optimize.mjs [iterations]
// Uses the exact same routing/scoring modules as the browser, so the numbers match.
import { readFileSync, writeFileSync } from 'node:fs';
import { buildWarehouse } from '../src/sim/warehouse.js';
import { buildTrips, scoreLayout } from '../src/sim/route.js';
import { anneal as annealCore } from '../src/sim/anneal.js';
import { abcLayout, affinityLayout, coOccurrence, originalLayout } from '../src/sim/layouts.js';

const DATA = new URL('../public/data/', import.meta.url);
const products = JSON.parse(readFileSync(new URL('products.json', DATA)));
const orders = JSON.parse(readFileSync(new URL('orders.json', DATA)));
const ITERS = Number(process.argv[2] || 60000);
const wh = buildWarehouse();

const anneal = (start, trips, opts) => annealCore(wh, products.length, start, trips, {
  ...opts,
  onProgress: ({ it, iters, T, current, best }) =>
    console.log(`  SA ${it}/${iters}  T=${T.toFixed(2)}  current=${(current / 1000).toFixed(2)} km  best=${(best / 1000).toFixed(2)} km`),
});

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
