// Warehouse geometry + walking graph. Units: metres, seconds.
// Picker walks only along aisles and the front/back cross-aisles, never through racks.
//
//   back cross-aisle  -------------------------------
//   R|A|R R|A|R R|A|R R|A|R R|A|R     R = rack (1 m deep), A = aisle (3 m)
//   front cross-aisle -------------------------------
//                         [DOCK]

export const CFG = {
  aisles: 5,        // picking aisles, racks on both sides
  bays: 10,         // bays per rack side
  bayW: 2.0,        // shelving bay width along the aisle
  rackD: 1.0,       // rack depth
  rackH: 2.2,       // rack height (visual only)
  aisleW: 3.0,      // aisle width
  crossW: 3.0,      // front/back cross-aisle width
  walkSpeed: 1.2,   // m/s, typical picker with cart
  pickSecPerLine: 10, // seconds to pick one order line at the shelf
  batchSize: 4,     // orders per trip in batch-picking mode
};

export function buildWarehouse(cfg = CFG) {
  const { aisles, bays, bayW, rackD, aisleW, crossW } = cfg;
  const pitch = 2 * rackD + aisleW;
  const width = aisles * pitch;
  const depth = bays * bayW;
  const aisleX = (a) => rackD + aisleW / 2 + a * pitch;
  const frontZ = -crossW / 2;
  const backZ = depth + crossW / 2;
  const perAisle = bays + 2; // front node, bay nodes, back node
  const node = (a, k) => a * perAisle + k;
  const DOCK = aisles * perAisle;
  const N = DOCK + 1;
  const dockAisle = Math.floor(aisles / 2);

  const pos = [];
  for (let a = 0; a < aisles; a++) {
    pos.push([aisleX(a), frontZ]);
    for (let b = 0; b < bays; b++) pos.push([aisleX(a), b * bayW + bayW / 2]);
    pos.push([aisleX(a), backZ]);
  }
  pos.push([aisleX(dockAisle), frontZ - crossW]); // dock

  const edges = [];
  const link = (u, v) => edges.push([u, v, Math.hypot(pos[u][0] - pos[v][0], pos[u][1] - pos[v][1])]);
  for (let a = 0; a < aisles; a++) {
    for (let k = 0; k < perAisle - 1; k++) link(node(a, k), node(a, k + 1));
    if (a > 0) {
      link(node(a - 1, 0), node(a, 0));
      link(node(a - 1, perAisle - 1), node(a, perAisle - 1));
    }
  }
  link(DOCK, node(dockAisle, 0));

  // Floyd-Warshall all-pairs shortest paths with next-hop table for path reconstruction
  const dist = new Float64Array(N * N).fill(Infinity);
  const next = new Int32Array(N * N).fill(-1);
  for (let i = 0; i < N; i++) { dist[i * N + i] = 0; next[i * N + i] = i; }
  for (const [u, v, w] of edges) {
    dist[u * N + v] = dist[v * N + u] = w;
    next[u * N + v] = v; next[v * N + u] = u;
  }
  for (let k = 0; k < N; k++)
    for (let i = 0; i < N; i++) {
      const dik = dist[i * N + k];
      if (dik === Infinity) continue;
      for (let j = 0; j < N; j++) {
        const d = dik + dist[k * N + j];
        if (d < dist[i * N + j]) { dist[i * N + j] = d; next[i * N + j] = next[i * N + k]; }
      }
    }

  // Slots: aisle a, side s (0 = left rack, 1 = right rack), bay b. Picker stands in the aisle at the bay.
  const nSlots = aisles * 2 * bays;
  const slots = [];
  for (let a = 0; a < aisles; a++)
    for (let s = 0; s < 2; s++)
      for (let b = 0; b < bays; b++) {
        const x = aisleX(a) + (s === 0 ? -1 : 1) * (aisleW / 2 + rackD / 2);
        slots.push({
          id: slots.length, aisle: a, side: s, bay: b,
          node: node(a, b + 1), x, z: b * bayW + bayW / 2,
          // aisles are numbered right-to-left in x so they read 1..N left-to-right from the dock
          label: `A${aisles - a}-${s === 0 ? 'R' : 'L'}${String(b + 1).padStart(2, '0')}`,
        });
      }

  const d = (u, v) => dist[u * N + v];
  const path = (u, v) => {
    const out = [u];
    while (u !== v) { u = next[u * N + v]; out.push(u); }
    return out;
  };
  for (const s of slots) s.dockDist = d(DOCK, s.node);

  return { cfg, width, depth, frontZ, backZ, aisleX, pos, edges, N, DOCK, dist, d, path, slots, nSlots, node, perAisle };
}
