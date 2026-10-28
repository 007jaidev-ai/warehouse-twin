// Several pickers working the same floor, with aisle congestion.
//
// Model: all trips wait in one queue (the month's backlog, in order). Each picker takes the next trip
// at the dock, walks its route along the floor graph and picks. A picking aisle holds at most `cap`
// pickers (a cart blocks a narrow aisle); a picker who reaches a full aisle waits at its entrance
// until someone leaves. A picker leaves one aisle before entering the next, so this cannot deadlock.
// Time advances in small fixed steps, so it is deterministic: the same inputs give the same numbers
// in the browser (animated) and in scripts/congestion.mjs (whole month at once).
import { routeNodes, slotOfProduct, tripNodes } from './route.js';

// Pre-route every trip once: the node sequence and how long the picker dwells at each node.
export function planTrips(wh, productAt, trips) {
  const slotOf = slotOfProduct(productAt);
  return trips.map((t) => {
    const { tour, dist } = routeNodes(wh, tripNodes(wh, slotOf, t));
    const lines = new Map();
    for (const p of t.products) { const n = wh.slots[slotOf[p]].node; lines.set(n, (lines.get(n) || 0) + 1); }
    const nodes = [tour[0]], dwell = [0];
    for (let k = 0; k < tour.length - 1; k++) {
      const path = wh.path(tour[k], tour[k + 1]);
      for (let j = 1; j < path.length; j++) { nodes.push(path[j]); dwell.push(0); }
      const n = tour[k + 1];
      if (n !== wh.DOCK) dwell[dwell.length - 1] = (lines.get(n) || 0) * wh.cfg.pickSecPerLine;
    }
    // order lines (not distinct products) set the pick time, as in scoreLayout
    const linesPerProduct = t.lines / Math.max(1, t.products.length);
    for (let i = 0; i < dwell.length; i++) dwell[i] *= linesPerProduct;
    return { trip: t, nodes, dwell, dist };
  });
}

export class MultiSim {
  constructor(wh, plans, { pickers = 3, cap = 1, step = 0.5 } = {}) {
    this.wh = wh; this.plans = plans; this.cap = cap; this.h = step;
    this.next = 0; this.t = 0; this.done = 0; this.ordersDone = 0;
    this.walked = 0; this.waitSec = 0; this.busySec = 0;
    this.inAisle = new Int32Array(wh.cfg.aisles);
    this.aisleWait = new Float64Array(wh.cfg.aisles);
    this.events = []; // {type, picker, ...} drained by the UI
    this.P = Array.from({ length: pickers }, (_, id) => ({
      id, plan: null, i: 0, seg: 0, dwell: 0, aisle: -1, waiting: false, waited: 0, x: 0, z: 0, heading: Math.PI, idle: false,
    }));
    const [dx, dz] = wh.pos[wh.DOCK];
    this.P.forEach((p) => { p.x = dx; p.z = dz; this.take(p); });
  }

  // aisle index of a node, or -1 for cross-aisle / dock nodes
  aisleOf(n) {
    const { perAisle, DOCK } = this.wh;
    if (n === DOCK) return -1;
    const k = n % perAisle;
    return k === 0 || k === perAisle - 1 ? -1 : Math.floor(n / perAisle);
  }

  take(p) {
    if (this.next >= this.plans.length) { p.plan = null; p.idle = true; return; }
    p.plan = this.plans[this.next++]; p.i = 0; p.seg = 0; p.dwell = 0; p.idle = false;
    this.events.push({ type: 'out', picker: p.id, trip: p.plan.trip });
  }

  get finished() { return this.P.every((p) => p.idle); }

  // advance the whole floor by `sec` simulated seconds (in steps of at most this.h)
  advance(sec) {
    while (sec > 1e-9 && !this.finished) {
      const h = Math.min(this.h, sec);
      for (const p of this.P) this.move(p, h);
      this.t += h; sec -= h;
    }
  }

  move(p, h) {
    if (p.idle) return;
    this.busySec += h;
    let left = h;
    const ws = this.wh.cfg.walkSpeed, pos = this.wh.pos;
    while (left > 1e-9 && p.plan) {
      const { nodes, dwell } = p.plan;
      if (p.dwell > 0) { const u = Math.min(p.dwell, left); p.dwell -= u; left -= u; continue; }
      if (p.i >= nodes.length - 1) { // back at the dock
        this.done++; this.ordersDone += p.plan.trip.orders.length;
        this.events.push({ type: 'in', picker: p.id, trip: p.plan.trip });
        this.take(p);
        if (!p.plan) break;
        continue;
      }
      const a = nodes[p.i], b = nodes[p.i + 1];
      if (p.seg === 0) { // about to start an edge: aisle entry / exit rules
        const from = this.aisleOf(a), to = this.aisleOf(b);
        if (to >= 0 && to !== p.aisle) {
          if (this.inAisle[to] >= this.cap) { // blocked: wait at the entrance
            if (!p.waiting) this.events.push({ type: 'blocked', picker: p.id, aisle: to });
            p.waiting = true; p.waited += left; this.waitSec += left; this.aisleWait[to] += left;
            left = 0; break;
          }
          if (p.waiting) this.events.push({ type: 'enter', picker: p.id, aisle: to });
          p.waiting = false;
          this.inAisle[to]++; p.aisle = to;
        }
        if (to < 0 && from >= 0 && p.aisle === from) { this.inAisle[from]--; p.aisle = -1; }
      }
      const [x1, z1] = pos[a], [x2, z2] = pos[b];
      const L = Math.hypot(x2 - x1, z2 - z1);
      const need = (L - p.seg) / ws;
      if (left < need) { p.seg += left * ws; this.walked += left * ws; left = 0; }
      else {
        this.walked += L - p.seg; left -= need;
        p.i++; p.seg = 0;
        p.dwell = dwell[p.i];
      }
    }
    this.place(p);
  }

  place(p) {
    if (!p.plan) { [p.x, p.z] = this.wh.pos[this.wh.DOCK]; return; }
    const { nodes } = p.plan, pos = this.wh.pos;
    const i = Math.min(p.i, nodes.length - 2);
    const [x1, z1] = pos[nodes[i]], [x2, z2] = pos[nodes[i + 1]];
    const L = Math.hypot(x2 - x1, z2 - z1) || 1;
    const f = p.i >= nodes.length - 1 ? 1 : p.seg / L;
    p.x = x1 + (x2 - x1) * f; p.z = z1 + (z2 - z1) * f;
    if (L > 0.01) p.heading = Math.atan2(x2 - x1, z2 - z1);
  }

  stats() {
    const hours = this.t / 3600;
    return {
      hours, orders: this.ordersDone, trips: this.done,
      ordersPerHour: hours > 0 ? this.ordersDone / hours : 0,
      km: this.walked / 1000,
      waitShare: this.busySec > 0 ? this.waitSec / this.busySec : 0,
      waitPerTrip: this.done > 0 ? this.waitSec / this.done : 0,
      aisleWait: Array.from(this.aisleWait),
    };
  }
}

// Whole month at once. Returns stats plus the congestion loss vs N independent pickers.
export function runTeam(wh, plans, opts) {
  const sim = new MultiSim(wh, plans, opts);
  let guard = 0;
  while (!sim.finished && guard++ < 5e6) sim.advance(60);
  return sim.stats();
}
