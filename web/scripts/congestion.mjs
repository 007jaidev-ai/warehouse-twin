// Multi-picker congestion study: the whole month for 1..6 pickers on every layout.
//   node scripts/congestion.mjs [cap]      cap = pickers allowed in one aisle at a time (default 1)
// Writes public/data/congestion.json (read by the deck/poster builders) and prints a table.
import { readFileSync, writeFileSync } from 'node:fs';
import { buildWarehouse } from '../src/sim/warehouse.js';
import { buildTrips } from '../src/sim/route.js';
import { planTrips, runTeam } from '../src/sim/multi.js';

const DATA = new URL('../public/data/', import.meta.url);
const orders = JSON.parse(readFileSync(new URL('orders.json', DATA)));
const { layouts } = JSON.parse(readFileSync(new URL('layouts.json', DATA)));
const wh = buildWarehouse();
const trips = buildTrips(orders, 1);
const out = { pickers: [1, 2, 3, 4, 5, 6], caps: {} };

for (const cap of process.argv[2] ? [Number(process.argv[2])] : [1, 2]) {
  out.caps[cap] = {};
  console.log(`\naisle capacity ${cap}   (hours to clear the month · orders/h · time spent waiting)`);
  for (const [k, layout] of Object.entries(layouts)) {
    const plans = planTrips(wh, layout, trips);
    const rows = out.pickers.map((n) => runTeam(wh, plans, { pickers: n, cap }));
    out.caps[cap][k] = rows.map(({ hours, ordersPerHour, waitShare, km }) => ({ hours, ordersPerHour, waitShare, km }));
    console.log(k.padEnd(10), rows.map((r, i) => `${i + 1}p ${r.hours.toFixed(1)}h ${r.ordersPerHour.toFixed(1)}/h ${(r.waitShare * 100).toFixed(1)}%`).join(' | '));
  }
}
writeFileSync(new URL('congestion.json', DATA), JSON.stringify(out, null, 1));
