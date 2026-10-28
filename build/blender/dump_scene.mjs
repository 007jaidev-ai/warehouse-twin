// Dumps warehouse geometry + per-layout rack visit counts for the Blender scene (build/blender/scene.py).
import { readFileSync, writeFileSync } from 'node:fs';
import { buildWarehouse } from '../../web/src/sim/warehouse.js';
import { buildTrips, scoreLayout, edgeTraffic, routeNodes, slotOfProduct, tripNodes } from '../../web/src/sim/route.js';

const DATA = new URL('../../web/public/data/', import.meta.url);
const orders = JSON.parse(readFileSync(new URL('orders.json', DATA)));
const ref = JSON.parse(readFileSync(new URL('layouts.json', DATA)));
const wh = buildWarehouse();
const trips = buildTrips(orders, 1);
const out = { cfg: wh.cfg, width: wh.width, depth: wh.depth, frontZ: wh.frontZ, backZ: wh.backZ,
  aisleX: Array.from({ length: wh.cfg.aisles }, (_, a) => wh.aisleX(a)), dock: wh.pos[wh.DOCK],
  slots: wh.slots.map(({ id, x, z, aisle, side, bay }) => ({ id, x, z, aisle, side, bay })),
  pos: wh.pos, edges: wh.edges.map(([u, v]) => [u, v]), layouts: {} };
for (const [k, l] of Object.entries(ref.layouts)) {
  const s = scoreLayout(wh, l, trips, orders.length);
  out.layouts[k] = { visits: Array.from(s.visits), km: s.dist / 1000, traffic: edgeTraffic(wh, l, trips) };
}
// one real order, routed on Original and Optimized (for the route renders)
const routeOf = (layout, t) => {
  const slotOf = slotOfProduct(layout);
  const { tour, dist } = routeNodes(wh, tripNodes(wh, slotOf, t));
  const pts = [wh.pos[tour[0]]];
  for (let k = 0; k < tour.length - 1; k++) pts.push(...wh.path(tour[k], tour[k + 1]).slice(1).map((n) => wh.pos[n]));
  return { pts, dist, slots: t.products.map((p) => slotOf[p]) };
};
let pick = null;
for (const t of trips) {
  if (t.lines < 7 || t.lines > 9) continue;
  const a = routeOf(ref.layouts.original, t), b = routeOf(ref.layouts.optimized, t);
  const gain = a.dist - b.dist;
  if (!pick || gain > pick.gain) pick = { gain, order: t.orders[0], lines: t.lines, original: a, optimized: b };
}
out.sampleRoute = pick;
console.log('sample order', pick.order, pick.lines, 'lines', pick.original.dist, '->', pick.optimized.dist);
writeFileSync(new URL('scene.json', import.meta.url), JSON.stringify(out));
console.log(Object.entries(out.layouts).map(([k, v]) => `${k} ${v.km.toFixed(1)}`).join(' | '));
