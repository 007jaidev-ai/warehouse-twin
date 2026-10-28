// Layout = productAt[slot] -> product id. 100 products, 100 slots.

// "As received": products shelved in stock-code order, aisle by aisle.
export function originalLayout(wh, products) {
  const ids = products.map((p) => p.id).sort((a, b) =>
    products[a].code.localeCompare(products[b].code, 'en', { numeric: true }));
  return ids.slice(0, wh.nSlots);
}

const slotsByDockDist = (wh) => wh.slots.slice().sort((a, b) => a.dockDist - b.dockDist || a.id - b.id);

// ABC / velocity slotting: most-picked products in the slots closest to the dock.
export function abcLayout(wh, products) {
  const byPicks = products.slice().sort((a, b) => b.picks - a.picks || a.id - b.id);
  const productAt = new Array(wh.nSlots);
  slotsByDockDist(wh).forEach((s, i) => { productAt[s.id] = byPicks[i].id; });
  return productAt;
}

// co[i*n+j] = number of orders that contain both product i and product j
export function coOccurrence(nProducts, orders) {
  const co = new Float64Array(nProducts * nProducts);
  for (const o of orders) {
    const ps = [...new Set(o.items.map(([p]) => p))];
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++) {
        co[ps[i] * nProducts + ps[j]]++;
        co[ps[j] * nProducts + ps[i]]++;
      }
  }
  return co;
}

// Affinity (correlated) slotting: fill slots in order of closeness to the dock, but pick each slot's
// product by  picks + w * (co-picks with products already placed in the same aisle).
// w = 0 reproduces ABC; w > 0 pulls "bought-together" products into the same aisle,
// so a typical order enters fewer aisles.
export function affinityLayout(wh, products, co, w) {
  const n = products.length;
  const placed = new Uint8Array(n);
  const inAisle = Array.from({ length: wh.cfg.aisles }, () => []);
  const productAt = new Array(wh.nSlots);
  for (const s of slotsByDockDist(wh)) {
    let best = -1, bestScore = -Infinity;
    for (let p = 0; p < n; p++) {
      if (placed[p]) continue;
      let aff = 0;
      for (const q of inAisle[s.aisle]) aff += co[p * n + q];
      const score = products[p].picks + w * aff;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    placed[best] = 1;
    inAisle[s.aisle].push(best);
    productAt[s.id] = best;
  }
  return productAt;
}

// Top co-picked partners of a product (for the tooltip hint).
export function partners(co, n, p, k = 3) {
  const arr = [];
  for (let q = 0; q < n; q++) if (q !== p && co[p * n + q] > 0) arr.push([q, co[p * n + q]]);
  return arr.sort((a, b) => b[1] - a[1]).slice(0, k);
}
