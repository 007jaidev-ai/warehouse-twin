// Simulated annealing over slot swaps. Objective = exact replay distance of all trips.
// Only trips that contain one of the two swapped products are re-routed (delta evaluation).
// Shared by scripts/optimize.mjs (offline) and src/sim/optWorker.js (live, in the browser).
import { routeNodes, slotOfProduct, tripNodes } from './route.js';

export function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function anneal(wh, nProducts, start, trips, { iters, T0 = 40, T1 = 0.2, seed = 42, every = 10000, onProgress = () => {} }) {
  const rand = mulberry32(seed);
  const productAt = start.slice();
  const slotOf = slotOfProduct(productAt);
  const tripsOf = Array.from({ length: nProducts }, () => []);
  trips.forEach((t, i) => t.products.forEach((p) => tripsOf[p].push(i)));
  const tripDist = trips.map((t) => routeNodes(wh, tripNodes(wh, slotOf, t)).dist);
  let total = tripDist.reduce((a, b) => a + b, 0);
  const startDist = total;
  let best = total, bestLayout = productAt.slice();
  const stamp = new Int32Array(trips.length);
  const newDist = new Float64Array(trips.length);
  let accepted = 0;

  for (let it = 1; it <= iters; it++) {
    const s1 = Math.floor(rand() * wh.nSlots), s2 = Math.floor(rand() * wh.nSlots);
    const T = T0 * Math.pow(T1 / T0, it / iters);
    if (wh.slots[s1].node !== wh.slots[s2].node) { // same pick face: no effect
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
      if (delta <= 0 || rand() < Math.exp(-delta / T)) {
        for (const t of affected) tripDist[t] = newDist[t];
        total += delta;
        accepted++;
        if (total < best - 1e-6) { best = total; bestLayout = productAt.slice(); }
      } else {
        productAt[s1] = p1; productAt[s2] = p2; slotOf[p1] = s1; slotOf[p2] = s2;
      }
    }
    if (it % every === 0) onProgress({ it, iters, T, current: total, best, startDist, accepted, layout: bestLayout });
  }
  return { layout: bestLayout, accepted, best, startDist };
}
