// Routing + scoring. The same code scores layouts in the browser and in scripts/optimize.mjs,
// so every layout is judged by replaying exactly the same orders with exactly the same rules.

// Tour dock -> pick nodes -> dock: nearest neighbour, then 2-opt. Deterministic for a given input order.
export function routeNodes(wh, nodes) {
  const { d, DOCK } = wh;
  const left = [...new Set(nodes)];
  const tour = [DOCK];
  let cur = DOCK;
  while (left.length) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < left.length; i++) {
      const dd = d(cur, left[i]);
      if (dd < bd) { bd = dd; bi = i; }
    }
    cur = left[bi];
    tour.push(cur);
    left.splice(bi, 1);
  }
  tour.push(DOCK);

  const n = tour.length - 1;
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < n - 1; i++)
      for (let j = i + 1; j < n; j++) {
        const delta = d(tour[i - 1], tour[j]) + d(tour[i], tour[j + 1])
                    - d(tour[i - 1], tour[i]) - d(tour[j], tour[j + 1]);
        if (delta < -1e-9) {
          for (let a = i, b = j; a < b; a++, b--) [tour[a], tour[b]] = [tour[b], tour[a]];
          improved = true;
        }
      }
  }
  let dist = 0;
  for (let i = 0; i < n; i++) dist += d(tour[i], tour[i + 1]);
  return { tour, dist };
}

export function slotOfProduct(productAt) {
  const slotOf = new Int32Array(productAt.length);
  productAt.forEach((p, s) => { slotOf[p] = s; });
  return slotOf;
}

// A trip = one walk from the dock and back. Single-order mode: one order per trip.
// Batch mode: consecutive orders grouped into one trip (one cart, several totes).
export function buildTrips(orders, batchSize = 1) {
  const trips = [];
  for (let i = 0; i < orders.length; i += batchSize) {
    const group = orders.slice(i, i + batchSize);
    const products = [];
    let lines = 0;
    for (const o of group) for (const [p] of o.items) { products.push(p); lines++; }
    trips.push({ orders: group.map((o) => o.id), products: [...new Set(products)], lines });
  }
  return trips;
}

// Smart batching: the next unbatched order seeds a trip, then from the next `window` waiting orders
// (orders that arrived close in time) we add the one whose aisles overlap the trip most (Jaccard).
// Layout-aware, as a WMS would do it: it knows where each product is shelved.
export function buildSmartTrips(wh, orders, productAt, batchSize = 4, window = 12) {
  const slotOf = slotOfProduct(productAt);
  const aisles = orders.map((o) => new Set(o.items.map(([p]) => wh.slots[slotOf[p]].aisle)));
  const used = new Uint8Array(orders.length);
  const trips = [];
  let head = 0;
  while (head < orders.length) {
    if (used[head]) { head++; continue; }
    const group = [head]; used[head] = 1;
    const cover = new Set(aisles[head]);
    while (group.length < batchSize) {
      let best = -1, bestScore = -1, seen = 0;
      for (let j = head + 1; j < orders.length && seen < window; j++) {
        if (used[j]) continue;
        seen++;
        let inter = 0;
        for (const a of aisles[j]) if (cover.has(a)) inter++;
        const score = inter / (cover.size + aisles[j].size - inter);
        if (score > bestScore) { bestScore = score; best = j; }
      }
      if (best < 0) break;
      group.push(best); used[best] = 1;
      for (const a of aisles[best]) cover.add(a);
    }
    const products = [];
    let lines = 0;
    for (const i of group) for (const [p] of orders[i].items) { products.push(p); lines++; }
    trips.push({ orders: group.map((i) => orders[i].id), products: [...new Set(products)], lines });
  }
  return trips;
}

export function tripNodes(wh, slotOf, trip) {
  return trip.products.map((p) => wh.slots[slotOf[p]].node);
}

export function scoreLayout(wh, productAt, trips, nOrders) {
  const slotOf = slotOfProduct(productAt);
  let dist = 0, lines = 0;
  const visits = new Float64Array(wh.nSlots);
  for (const t of trips) {
    dist += routeNodes(wh, tripNodes(wh, slotOf, t)).dist;
    lines += t.lines;
    for (const p of t.products) visits[slotOf[p]]++;
  }
  const walkSec = dist / wh.cfg.walkSpeed;
  const pickSec = lines * wh.cfg.pickSecPerLine;
  return {
    dist, walkSec, pickSec, visits,
    distPerOrder: dist / nOrders,
    secPerOrder: (walkSec + pickSec) / nOrders,
  };
}

// How often each walking-graph edge is used over all trips (for the floor traffic heatmap).
export function edgeTraffic(wh, productAt, trips) {
  const slotOf = slotOfProduct(productAt);
  const key = (u, v) => (u < v ? u * wh.N + v : v * wh.N + u);
  const counts = new Map();
  for (const t of trips) {
    const { tour } = routeNodes(wh, tripNodes(wh, slotOf, t));
    for (let i = 0; i < tour.length - 1; i++) {
      const p = wh.path(tour[i], tour[i + 1]);
      for (let j = 0; j < p.length - 1; j++) {
        const k = key(p[j], p[j + 1]);
        counts.set(k, (counts.get(k) || 0) + 1);
      }
    }
  }
  return wh.edges.map(([u, v]) => counts.get(key(u, v)) || 0);
}
