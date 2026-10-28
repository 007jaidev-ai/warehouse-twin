// Runs the optimizer live in a Web Worker so the 3D view stays smooth while it searches.
import { buildWarehouse } from './warehouse.js';
import { buildTrips } from './route.js';
import { anneal } from './anneal.js';

self.onmessage = ({ data }) => {
  const { orders, nProducts, start, iters, seed } = data;
  const wh = buildWarehouse();
  const trips = buildTrips(orders, 1);
  const t0 = performance.now();
  const res = anneal(wh, nProducts, start, trips, {
    iters, seed, T0: 30, every: 400,
    onProgress: (p) => self.postMessage({ type: 'progress', ...p, sec: (performance.now() - t0) / 1000 }),
  });
  self.postMessage({ type: 'done', ...res, sec: (performance.now() - t0) / 1000 });
};
