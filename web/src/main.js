import './style.css';
import * as THREE from 'three';
import { buildWarehouse } from './sim/warehouse.js';
import { buildTrips, edgeTraffic, routeNodes, scoreLayout, slotOfProduct, tripNodes } from './sim/route.js';
import { coOccurrence, partners } from './sim/layouts.js';
import { createScene } from './scene/scene.js';

const $ = (id) => document.getElementById(id);
const fmt = (n, d = 0) => n.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
const hms = (s) => {
  s = Math.round(s);
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const mmss = (s) => { s = Math.round(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const RAMP = ['#24396b', '#2c7fb8', '#3db68a', '#f2c14e', '#f0602b'].map((c) => new THREE.Color(c));
function ramp(v) {
  const x = Math.max(0, Math.min(1, v)) * (RAMP.length - 1);
  const i = Math.min(Math.floor(x), RAMP.length - 2);
  return RAMP[i].clone().lerp(RAMP[i + 1], x - i);
}

const LAYOUTS = [
  { k: 'original', n: 'Original', t: 'As received', d: 'Products shelved in stock-code order, aisle by aisle: how a store room usually starts out.' },
  { k: 'abc', n: 'ABC', t: 'Intuition', d: 'Velocity slotting: the most-picked products go in the slots closest to the packing dock. The "obvious" fix.' },
  { k: 'affinity', n: 'Affinity', t: 'Data insight', d: 'Correlated slotting: products that real orders buy together are pulled into the same aisle, while fast movers still sit near the dock. A typical order enters fewer aisles.' },
  { k: 'optimized', n: 'Optimized', t: 'Algorithm', d: '' },
  { k: 'player', n: 'You', t: 'Your layout', d: 'Your own layout. Click a rack, then another, to swap their products. Can you beat ABC? Affinity? The optimizer?' },
];

const store = {
  get(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

async function main() {
  const load = (f) => fetch(`${import.meta.env.BASE_URL}data/${f}`).then((r) => r.json());
  const [products, orders, stats, ref] = await Promise.all(['products.json', 'orders.json', 'stats.json', 'layouts.json'].map(load));
  const wh = buildWarehouse();
  const scene = createScene($('canvas'), wh);
  const co = coOccurrence(products.length, orders);
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const isPerm = (l) => Array.isArray(l) && l.length === wh.nSlots && new Set(l).size === wh.nSlots && l.every((p) => p >= 0 && p < products.length);
  LAYOUTS[3].d = `Simulated annealing: ${fmt(ref.meta.saIterations)} random slot swaps, each one judged by re-routing every affected order of the month. The best layout found by the machine.`;

  const S = {
    view: 'original', batch: false, traffic: false, sel: -1, history: [],
    layouts: { ...ref.layouts, player: isPerm(store.get('wt-player')) ? store.get('wt-player') : ref.layouts.original.slice() },
  };

  $('subtitle').innerHTML = `Online Retail II (UCI) · ${new Date(stats.month + '-01').toLocaleString('en', { month: 'long', year: 'numeric' })}<br>${fmt(orders.length)} real orders · ${fmt(stats.lines_replayed)} pick lines · top ${products.length} products`;

  // ---------- scoring ----------
  const tripCache = {};
  const trips = (batch = S.batch) => (tripCache[batch] ||= buildTrips(orders, batch ? wh.cfg.batchSize : 1));
  let scores = {};
  const score = (k) => { scores[k] = scoreLayout(wh, S.layouts[k], trips(), orders.length); };
  const scoreAll = () => { scores = {}; LAYOUTS.forEach(({ k }) => score(k)); };
  let trafficCache = {};

  function renderScoreboard() {
    const base = scores.original.dist;
    const rows = LAYOUTS.map(({ k, n }) => {
      const s = scores[k];
      const saved = 1 - s.dist / base;
      let badges = '';
      if (k === 'player') {
        if (s.dist < scores.optimized.dist - 1) badges = '<span class="badge">beats the optimizer!</span>';
        else if (s.dist < scores.affinity.dist - 1) badges = '<span class="badge">beats Affinity</span>';
        else if (s.dist < scores.abc.dist - 1) badges = '<span class="badge">beats ABC</span>';
      }
      const cls = `${k === S.view ? 'cur' : ''} ${k === 'player' ? 'player' : ''}`;
      const savedCell = k === 'original' ? '<span class="k">–</span>'
        : Math.abs(saved) < 0.0005 ? '0.0%'
        : `<span class="${saved > 0 ? 'saved' : 'worse'}">${saved > 0 ? '−' : '+'}${fmt(Math.abs(saved) * 100, 1)}%</span>`;
      return `<tr class="${cls}"><td>${n}${badges}<div class="bar"><i style="width:${(s.dist / base) * 100}%"></i></div></td>
        <td>${fmt(s.dist / 1000, 1)}</td><td>${fmt(s.distPerOrder, 1)}</td><td>${mmss(s.secPerOrder)}</td><td>${savedCell}</td></tr>`;
    });
    $('scoreboard').innerHTML = `<tr><th>Layout</th><th>km / month</th><th>m / order</th><th>time / order</th><th>walk saved</th></tr>${rows.join('')}`;
    $('scoreNote').textContent = (S.batch
      ? `Batch picking: ${wh.cfg.batchSize} consecutive orders share one trip (one cart, ${wh.cfg.batchSize} totes). `
      : 'One trip per order. ')
      + `Every layout replays the same ${fmt(orders.length)} orders. Route = shortest path along aisles (nearest neighbour + 2-opt), walk ${wh.cfg.walkSpeed} m/s, ${wh.cfg.pickSecPerLine} s per pick line.`;
  }

  // ---------- view ----------
  // colour scale shared by all layouts (sqrt min-max), so a product keeps its colour when it moves
  function paintRacks() {
    const all = LAYOUTS.flatMap(({ k }) => Array.from(scores[k].visits));
    const lo = Math.sqrt(Math.min(...all)), hi = Math.sqrt(Math.max(...all));
    scene.setSlotColors(Array.from(scores[S.view].visits, (v) => ramp((Math.sqrt(v) - lo) / (hi - lo || 1))));
  }
  function paintTraffic() {
    if (!S.traffic) { scene.setTraffic(null); return; }
    const key = `${S.view}|${S.batch}`;
    trafficCache[key] ||= edgeTraffic(wh, S.layouts[S.view], trips());
    const origKey = `original|${S.batch}`;
    trafficCache[origKey] ||= edgeTraffic(wh, S.layouts.original, trips());
    // normalise to the Original layout so colours compare across layouts
    const mx = Math.max(...trafficCache[origKey]);
    scene.setTraffic(trafficCache[key].map((v) => Math.min(v / mx, 1)), ramp);
  }
  function renderLegend() {
    const grad = `linear-gradient(90deg, ${RAMP.map((c) => '#' + c.getHexString()).join(',')})`;
    $('legend').innerHTML = `Rack colour = visits this month<div class="ramp" style="background:${grad}"></div><div class="ends"><span>rare</span><span>very frequent</span></div>`
      + (S.traffic ? '<div style="margin-top:6px">Floor strips = walking passes over each aisle section</div>' : '');
  }
  function applyView() {
    document.querySelectorAll('#layoutButtons button').forEach((b) => b.classList.toggle('on', b.dataset.k === S.view));
    $('layoutDesc').textContent = LAYOUTS.find((l) => l.k === S.view).d;
    $('copyRow').classList.toggle('hidden', S.view === 'player');
    select(-1);
    paintRacks(); paintTraffic(); renderLegend(); renderScoreboard();
    $('cCompareBox').classList.toggle('hidden', S.view === 'original');
    resetReplay();
  }
  function setView(k) { S.view = k; applyView(); }

  $('layoutButtons').innerHTML = LAYOUTS.map(({ k, n, t }) => `<button data-k="${k}"><span class="n">${n}</span><span class="t">${t}</span></button>`).join('');
  $('layoutButtons').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setView(b.dataset.k); });
  $('modeButtons').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.batch = b.dataset.mode === 'batch';
    document.querySelectorAll('#modeButtons button').forEach((x) => x.classList.toggle('on', x === b));
    scoreAll(); applyView();
  });
  $('trafficToggle').addEventListener('change', (e) => { S.traffic = e.target.checked; paintTraffic(); renderLegend(); });
  $('resetView').addEventListener('click', () => scene.resetView());

  // ---------- selection, hover, swapping ----------
  const curLayout = () => S.layouts[S.view];
  function select(id) {
    S.sel = id;
    scene.setSelection(id);
    if (id < 0) { scene.setPartners([]); return; }
    const slotOf = slotOfProduct(curLayout());
    scene.setPartners(partners(co, products.length, curLayout()[id]).map(([q]) => slotOf[q]));
  }

  function tooltipHtml(id) {
    const s = wh.slots[id], p = products[curLayout()[id]];
    const ps = partners(co, products.length, p.id).map(([q, c]) => `<div class="pk">◆ ${esc(products[q].name)} <span class="k">(${c} orders)</span></div>`).join('');
    const action = S.view !== 'player' ? 'Switch to “You” to move products'
      : S.sel < 0 ? 'Click to pick up' : S.sel === id ? 'Click again to cancel' : `Click to swap with ${wh.slots[S.sel].label}`;
    return `<div class="name">${esc(p.name)}</div><div class="k">${p.code} · slot ${s.label}</div>
      <div>${fmt(p.picks)} picks this month · ${fmt(s.dockDist, 1)} m from dock</div>
      ${ps ? `<div class="k" style="margin-top:6px">Often bought with:</div>${ps}` : ''}
      <div class="k" style="margin-top:6px;font-style:italic">${action}</div>`;
  }
  scene.onSlotHover((id, e) => {
    scene.setHover(id);
    scene.setSwapTarget(S.view === 'player' && S.sel >= 0 && id !== S.sel ? id : -1);
    const tt = $('tooltip');
    if (id < 0) { tt.classList.add('hidden'); return; }
    const r = $('stage').getBoundingClientRect();
    tt.innerHTML = tooltipHtml(id);
    tt.classList.remove('hidden');
    const x = e.clientX - r.left + 16, y = e.clientY - r.top + 16;
    tt.style.left = `${Math.min(x, r.width - tt.offsetWidth - 8)}px`;
    tt.style.top = `${Math.min(y, r.height - tt.offsetHeight - 8)}px`;
  });
  scene.onSlotClick((id) => {
    if (id < 0) { select(-1); return; }
    if (S.view !== 'player') { select(S.sel === id ? -1 : id); return; }
    if (S.sel < 0) select(id);
    else if (S.sel === id) select(-1);
    else { swap(S.sel, id, true); select(-1); }
    scene.setSwapTarget(-1);
  });

  let toastTimer;
  function toast(msg, bad = false) {
    const t = $('toast');
    t.textContent = msg; t.classList.toggle('bad', bad); t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
  }

  function playerChanged() {
    store.set('wt-player', S.layouts.player);
    delete trafficCache[`player|true`]; delete trafficCache[`player|false`];
    paintRacks(); paintTraffic(); renderScoreboard(); resetReplay();
  }
  function swap(a, b, record) {
    const L = S.layouts.player, before = scores.player.dist;
    const pa = products[L[a]].name, pb = products[L[b]].name;
    [L[a], L[b]] = [L[b], L[a]];
    if (record) S.history.push([a, b]);
    score('player');
    const delta = scores.player.dist - before;
    scene.flashSlot(a); scene.flashSlot(b);
    const vsAbc = scores.player.dist - scores.abc.dist;
    $('swapInfo').innerHTML = `Swapped <b>${esc(pa)}</b> ↔ <b>${esc(pb)}</b><br>`
      + `<span class="${delta <= 0 ? 'saved' : 'worse'}">${delta <= 0 ? 'Saves' : 'Costs'} ${fmt(Math.abs(delta))} m per month</span>`
      + ` · ${S.history.length} swap${S.history.length === 1 ? '' : 's'} · ${vsAbc < 0 ? `<span class="saved">${fmt(-vsAbc)} m better than ABC</span>` : `${fmt(vsAbc)} m behind ABC`}`;
    if (record) toast(`${delta <= 0 ? '−' : '+'}${fmt(Math.abs(delta))} m walking per month`, delta > 0);
    playerChanged();
  }
  $('undo').addEventListener('click', () => {
    const last = S.history.pop();
    if (!last) { toast('Nothing to undo', true); return; }
    swap(last[0], last[1], false);
    $('swapInfo').textContent = `Undone · ${S.history.length} swaps`;
  });
  function loadIntoPlayer(layout, msg) {
    S.layouts.player = layout.slice(); S.history = [];
    score('player');
    $('swapInfo').textContent = msg;
    playerChanged();
    setView('player');
  }
  $('resetOriginal').addEventListener('click', () => loadIntoPlayer(ref.layouts.original, 'Reset to the Original layout.'));
  $('copyToPlayer').addEventListener('click', () => {
    const n = LAYOUTS.find((l) => l.k === S.view).n;
    loadIntoPlayer(S.layouts[S.view], `Started from the ${n} layout. Now improve it!`);
  });

  // ---------- leaderboard (single-order mode distance, so entries are comparable) ----------
  function renderLeaderboard() {
    const lb = store.get('wt-leaderboard', []);
    $('leaderboard').innerHTML = lb.slice(0, 8).map((e, i) =>
      `<li data-i="${i}"><b>${esc(e.name)}</b> · ${fmt(e.km, 2)} km · ${e.saved >= 0 ? '−' : '+'}${fmt(Math.abs(e.saved), 1)}% vs Original</li>`).join('')
      || '<li style="list-style:none;margin-left:-22px">No saved layouts yet. Be the first!</li>';
  }
  $('saveScore').addEventListener('click', () => {
    const name = $('playerName').value.trim() || 'Anonymous';
    const t1 = trips(false);
    const km = scoreLayout(wh, S.layouts.player, t1, orders.length).dist / 1000;
    const orig = scoreLayout(wh, S.layouts.original, t1, orders.length).dist / 1000;
    const lb = store.get('wt-leaderboard', []);
    lb.push({ name, km, saved: (1 - km / orig) * 100, layout: S.layouts.player.slice(), ts: Date.now() });
    lb.sort((a, b) => a.km - b.km);
    store.set('wt-leaderboard', lb.slice(0, 50));
    renderLeaderboard();
    toast(`Saved: ${name}, ${fmt(km, 2)} km per month (rank #${lb.findIndex((e) => e.name === name && Math.abs(e.km - km) < 1e-9) + 1})`);
  });
  $('leaderboard').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-i]'); if (!li) return;
    const entry = store.get('wt-leaderboard', [])[li.dataset.i];
    if (entry && isPerm(entry.layout)) loadIntoPlayer(entry.layout, `Loaded ${entry.name}'s layout.`);
  });

  // ---------- replay (animated picker) ----------
  const speedOf = (v) => Math.max(1, Math.round(Math.pow(10, (v / 100) * Math.log10(300))));
  let speed = speedOf(+$('speed').value);
  const showSpeed = () => { $('speedVal').textContent = `${speed}×`; };
  $('speed').addEventListener('input', (e) => { speed = speedOf(+e.target.value); showSpeed(); });
  showSpeed();

  let R;
  function resetReplay() {
    R = { playing: false, i: 0, done: 0, walked: 0, sim: 0, doneDist: 0, origDist: 0, P: null };
    const d = wh.pos[wh.DOCK];
    scene.setPicker(d[0], d[1], Math.PI, false);
    scene.setRoute([]); scene.setPending([]);
    $('orderCard').classList.add('hidden');
    $('play').textContent = '▶ Replay orders';
    renderCounters();
  }

  function startTrip() {
    const t = trips()[R.i];
    if (!t) { R.playing = false; R.P = null; $('play').textContent = '✓ Month replayed'; return; }
    const layout = curLayout(), slotOf = slotOfProduct(layout);
    const { tour, dist } = routeNodes(wh, tripNodes(wh, slotOf, t));
    const tripOrders = t.orders.map((id) => orderById.get(id));
    const lines = new Map(), qty = new Map();
    for (const o of tripOrders) for (const [p, q] of o.items) { lines.set(p, (lines.get(p) || 0) + 1); qty.set(p, (qty.get(p) || 0) + q); }
    const slotsAtNode = new Map();
    for (const p of t.products) {
      const s = slotOf[p], n = wh.slots[s].node;
      if (!slotsAtNode.has(n)) slotsAtNode.set(n, []);
      slotsAtNode.get(n).push(s);
    }
    const pts = [wh.pos[tour[0]]], stops = new Map();
    for (let k = 0; k < tour.length - 1; k++) {
      const path = wh.path(tour[k], tour[k + 1]);
      for (let j = 1; j < path.length; j++) pts.push(wh.pos[path[j]]);
      if (tour[k + 1] !== wh.DOCK) stops.set(pts.length - 1, tour[k + 1]);
    }
    let origDist = dist;
    if (S.view !== 'original') origDist = routeNodes(wh, tripNodes(wh, slotOfProduct(S.layouts.original), t)).dist;
    R.P = { t, pts, stops, seg: 0, segT: 0, dwell: 0, dist, origDist, slotsAtNode, lines, slotOf, picked: new Set(),
            walkStart: R.walked, simStart: R.sim, pending: t.products.map((p) => slotOf[p]) };
    scene.setRoute(pts);
    scene.setPending(R.P.pending);
    renderOrderCard(tripOrders, qty);
  }

  function renderOrderCard(tripOrders, qty) {
    const P = R.P, o0 = tripOrders[0];
    const title = tripOrders.length === 1 ? `Order ${o0.id}` : `Batch of ${tripOrders.length} orders`;
    const meta = tripOrders.length === 1 ? `${o0.t} · ${o0.items.length} lines` : `${tripOrders.map((o) => o.id).join(', ')} · ${P.t.lines} lines`;
    $('orderCard').innerHTML = `<h3>${title}</h3><div class="meta">${meta} · route ${fmt(P.dist)} m</div><ul>`
      + P.t.products.map((p) => `<li data-p="${p}"><span class="ck"></span><span>${esc(products[p].name)}</span><span class="q">×${qty.get(p)}</span></li>`).join('')
      + '</ul>';
    $('orderCard').classList.remove('hidden');
  }

  function arrive(node) {
    const P = R.P;
    let n = 0;
    for (const s of P.slotsAtNode.get(node) || []) {
      const p = curLayout()[s];
      if (P.picked.has(p)) continue;
      P.picked.add(p);
      n += P.lines.get(p);
      scene.flashSlot(s);
      const li = $('orderCard').querySelector(`li[data-p="${p}"]`);
      if (li) { li.classList.add('done'); li.querySelector('.ck').textContent = '✓'; }
    }
    P.pending = P.pending.filter((s) => !P.picked.has(curLayout()[s]));
    scene.setPending(P.pending);
    P.dwell = n * wh.cfg.pickSecPerLine;
  }

  function finishTrip() {
    const P = R.P;
    R.done += P.t.orders.length;
    R.doneDist += P.dist;
    R.origDist += P.origDist;
    R.walked = P.walkStart + P.dist;
    R.sim = P.simStart + P.dist / wh.cfg.walkSpeed + P.t.lines * wh.cfg.pickSecPerLine;
    R.i++;
    startTrip();
  }

  function step(dt) {
    if (!R.playing || !R.P) return;
    let sim = dt * speed;
    const ws = wh.cfg.walkSpeed;
    let guard = 0;
    while (sim > 1e-9 && R.playing && R.P && guard++ < 10000) {
      const P = R.P;
      if (P.dwell > 0) { const u = Math.min(P.dwell, sim); P.dwell -= u; sim -= u; R.sim += u; continue; }
      if (P.seg >= P.pts.length - 1) { finishTrip(); continue; }
      const [x1, z1] = P.pts[P.seg], [x2, z2] = P.pts[P.seg + 1];
      const remain = Math.hypot(x2 - x1, z2 - z1) - P.segT;
      const can = sim * ws;
      if (can < remain) { P.segT += can; R.walked += can; R.sim += sim; sim = 0; }
      else {
        R.walked += remain; R.sim += remain / ws; sim -= remain / ws;
        P.seg++; P.segT = 0;
        if (P.stops.has(P.seg)) arrive(P.stops.get(P.seg));
      }
    }
    placePicker();
  }

  function placePicker() {
    const P = R.P;
    if (!P) return;
    const i = Math.min(P.seg, P.pts.length - 2);
    const [x1, z1] = P.pts[i], [x2, z2] = P.pts[i + 1];
    const L = Math.hypot(x2 - x1, z2 - z1) || 1;
    const f = P.seg >= P.pts.length - 1 ? 1 : P.segT / L;
    const heading = L > 0.01 ? Math.atan2(x2 - x1, z2 - z1) : null;
    scene.setPicker(x1 + (x2 - x1) * f, z1 + (z2 - z1) * f, heading, P.dwell <= 0);
  }

  function renderCounters() {
    $('cOrders').textContent = `${fmt(R.done)} / ${fmt(orders.length)}`;
    $('cDist').textContent = `${fmt(R.walked)} m`;
    $('cTime').textContent = hms(R.sim);
    if (R.done > 0 && S.view !== 'original') {
      const saved = 1 - R.doneDist / R.origDist;
      $('cCompare').innerHTML = `${fmt(R.origDist)} m <span class="${saved >= 0 ? 'saved' : 'worse'}" style="font-size:13px">(${saved >= 0 ? '−' : '+'}${fmt(Math.abs(saved) * 100, 1)}% here)</span>`;
    } else $('cCompare').textContent = '–';
  }

  $('play').addEventListener('click', togglePlay);
  function togglePlay() {
    if (!R.P && R.i >= trips().length) resetReplay();
    R.playing = !R.playing;
    if (R.playing && !R.P) startTrip();
    $('play').textContent = R.playing ? '❚❚ Pause' : '▶ Resume';
  }
  $('stepOrder').addEventListener('click', () => {
    if (!R.P) startTrip();
    if (R.P) { finishTrip(); placePicker(); renderCounters(); }
  });

  let hudTimer = 0;
  scene.onFrame((dt) => {
    step(dt);
    hudTimer += dt;
    if (hudTimer > 0.1) { hudTimer = 0; renderCounters(); }
  });

  // ---------- keyboard shortcuts (handy during the demo) ----------
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key >= '1' && e.key <= '5') setView(LAYOUTS[+e.key - 1].k);
    else if (e.key === 'h') { $('trafficToggle').click(); }
    else if (e.key === 'b') { document.querySelector(`#modeButtons button[data-mode=${S.batch ? 'single' : 'batch'}]`).click(); }
    else if (e.key === 'Escape') select(-1);
  });

  // ---------- about ----------
  const ho = ref.meta.holdout, hs = ho.scores;
  const hoSaved = (k) => fmt((1 - hs[k].single.km / hs.original.single.km) * 100, 1);
  $('about').innerHTML = `
    <p><b>Data pipeline</b> (pandas, <code>preprocess.py</code>)</p>
    <table>
      <tr><td>Order lines in ${stats.month}</td><td>${fmt(stats.raw_lines)}</td></tr>
      <tr><td>Cancelled invoices ("C…") removed</td><td>−${fmt(stats.cancelled_lines_removed)}</td></tr>
      <tr><td>Non-product codes (postage, fees…) removed</td><td>−${fmt(stats.non_product_lines_removed)}</td></tr>
      <tr><td>Invalid qty / price / description removed</td><td>−${fmt(stats.invalid_lines_removed)}</td></tr>
      <tr><td>Clean lines · distinct products</td><td>${fmt(stats.clean_lines)} · ${fmt(stats.distinct_products)}</td></tr>
      <tr><td>Top ${products.length} products' share of all picks</td><td>${fmt(stats.top_share_of_picks * 100, 1)}%</td></tr>
      <tr><td>Orders replayed (lines on top ${products.length})</td><td>${fmt(stats.orders_replayed)}</td></tr>
    </table>
    <p><b>Floor</b>: ${wh.cfg.aisles} aisles × 2 rack sides × ${wh.cfg.bays} bays = ${wh.nSlots} slots ·
      bay ${wh.cfg.bayW} m · aisle ${wh.cfg.aisleW} m · cross-aisles front & back · dock front-centre ·
      walk ${wh.cfg.walkSpeed} m/s · ${wh.cfg.pickSecPerLine} s per line.</p>
    <p><b>Hold-out check</b>: layouts designed only from orders before ${ho.split} (${fmt(ho.trainOrders)} orders),
      then tested on the ${fmt(ho.testOrders)} orders of the final week they never saw:
      ABC −${hoSaved('abc')}% · Affinity −${hoSaved('affinity')}% · Optimized −${hoSaved('optimized')}% walking vs Original.
      The gains carry over to future orders.</p>
    <p><b>Affinity</b> weight w = ${ref.meta.affinityW} (picked by replay). <b>Optimizer</b>: ${fmt(ref.meta.saIterations)} iterations,
      ${fmt(ref.meta.saAccepted)} swaps accepted, ${fmt(ref.meta.saSeconds, 0)} s offline.</p>
    <p class="note">Shortcuts: Space play/pause · 1–5 layouts · H traffic heatmap · B batch mode · Esc deselect</p>`;

  // URL presets for the demo screen, e.g. ?view=affinity&batch=1&traffic=1&play=1&speed=80
  const q = new URLSearchParams(location.search);
  if (LAYOUTS.some((l) => l.k === q.get('view'))) S.view = q.get('view');
  if (q.get('batch') === '1') {
    S.batch = true;
    document.querySelectorAll('#modeButtons button').forEach((x) => x.classList.toggle('on', x.dataset.mode === 'batch'));
  }
  if (q.get('traffic') === '1') { S.traffic = true; $('trafficToggle').checked = true; }
  if (q.has('speed')) { $('speed').value = q.get('speed'); speed = speedOf(+q.get('speed')); showSpeed(); }

  scoreAll();
  renderLeaderboard();
  applyView();
  if (q.get('play') === '1') togglePlay();
  if (q.has('select')) select(+q.get('select'));
}

main();
