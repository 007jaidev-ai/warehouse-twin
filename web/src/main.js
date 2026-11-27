import './style.css';
import * as THREE from 'three';
import { buildWarehouse } from './sim/warehouse.js';
import { buildSmartTrips, buildTrips, edgeTraffic, routeNodes, scoreLayout, slotOfProduct, tripNodes } from './sim/route.js';
import { coOccurrence, partners } from './sim/layouts.js';
import { createScene } from './scene/scene.js';
import { MultiSim, planTrips, runTeam } from './sim/multi.js';

const $ = (id) => document.getElementById(id);
const fmt = (n, d = 0) => n.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
const hms = (s) => {
  s = Math.round(s);
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const mmss = (s) => { s = Math.round(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// rare -> very frequent; same stops as build/blender/scene.py so the renders match the app
const RAMP = ['#d7d3c8', '#a9c3bb', '#4e978a', '#edb23a', '#e0442a'].map((c) => new THREE.Color(c));
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
    view: 'original', mode: 'single', traffic: false, iot: false, sel: -1, history: [], pickers: 1, cap: 1,
    layouts: { ...ref.layouts, player: isPerm(store.get('wt-player')) ? store.get('wt-player') : ref.layouts.original.slice() },
  };

  $('subtitle').innerHTML = `Online Retail II (UCI) · ${new Date(stats.month + '-01').toLocaleString('en', { month: 'long', year: 'numeric' })}<br>${fmt(orders.length)} real orders · ${fmt(stats.lines_replayed)} pick lines · top ${products.length} products`;

  // ---------- scoring ----------
  // trips depend on the mode; smart batches also depend on the layout (they group orders by aisle overlap)
  const SMART_WINDOW = 12;
  const tripCache = {};
  const trips = (k = S.view, mode = S.mode) => {
    const key = mode === 'smart' ? `smart|${k}` : mode;
    return (tripCache[key] ||= mode === 'smart'
      ? buildSmartTrips(wh, orders, S.layouts[k], wh.cfg.batchSize, SMART_WINDOW)
      : buildTrips(orders, mode === 'batch' ? wh.cfg.batchSize : 1));
  };
  let scores = {};
  const score = (k) => { scores[k] = scoreLayout(wh, S.layouts[k], trips(k), orders.length); };
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
    $('scoreboard').innerHTML = `<tr><th>Layout</th><th>km/mo</th><th>m/order</th><th>t/order</th><th>saved</th></tr>${rows.join('')}`;
    $('scoreNote').textContent = ({
      single: 'One trip per order. ',
      batch: `Batch picking: ${wh.cfg.batchSize} consecutive orders share one trip (one cart, ${wh.cfg.batchSize} totes). `,
      smart: `Smart batching: each trip takes the next order plus the ${wh.cfg.batchSize - 1} orders (from the next ${SMART_WINDOW} waiting) whose aisles overlap it most. `,
    })[S.mode]
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
    const key = `${S.view}|${S.mode}`;
    trafficCache[key] ||= edgeTraffic(wh, S.layouts[S.view], trips(S.view));
    const origKey = `original|${S.mode}`;
    trafficCache[origKey] ||= edgeTraffic(wh, S.layouts.original, trips('original'));
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
    paintRacks(); paintTraffic(); renderLegend(); renderScoreboard(); scheduleTeam();
    $('cCompareBox').classList.toggle('hidden', S.view === 'original' && S.pickers === 1);
    resetReplay();
  }
  function setView(k) { S.view = k; applyView(); }

  $('layoutButtons').innerHTML = LAYOUTS.map(({ k, n, t }) => `<button data-k="${k}"><span class="n">${n}</span><span class="t">${t}</span></button>`).join('');
  $('layoutButtons').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setView(b.dataset.k); });
  $('modeButtons').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.mode = b.dataset.mode;
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
    if (worker) { toast('The optimizer is rearranging this layout. Stop it to swap by hand.', true); return; }
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
    for (const m of ['single', 'batch', 'smart']) delete trafficCache[`player|${m}`];
    delete tripCache['smart|player'];
    forgetTeam('player');
    if (S.mode === 'smart') score('player');
    paintRacks(); paintTraffic(); renderScoreboard(); resetReplay(); scheduleTeam();
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
    if (worker) { toast('Stop the optimizer first', true); return; }
    const last = S.history.pop();
    if (!last) { toast('Nothing to undo', true); return; }
    swap(last[0], last[1], false);
    $('swapInfo').textContent = `Undone · ${S.history.length} swaps`;
  });
  function loadIntoPlayer(layout, msg) {
    if (worker) { $('optStatus').textContent = 'stopped'; stopOptimizer('Optimizer stopped.'); }
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
  // entries live in localStorage, so treat them as untrusted: drop anything malformed
  const leaderboard = () => {
    const lb = store.get('wt-leaderboard', []);
    return Array.isArray(lb) ? lb.filter((e) => e && typeof e.km === 'number' && isFinite(e.km) && typeof e.saved === 'number' && isPerm(e.layout)) : [];
  };
  function renderLeaderboard() {
    const lb = leaderboard();
    $('leaderboard').innerHTML = lb.slice(0, 8).map((e, i) =>
      `<li data-i="${i}"><b>${esc(String(e.name).slice(0, 18))}</b> · ${fmt(e.km, 2)} km · ${Math.abs(e.saved) < 0.05 ? '' : e.saved > 0 ? '−' : '+'}${fmt(Math.abs(e.saved), 1)}% vs Original</li>`).join('')
      || '<li style="list-style:none;margin-left:-22px">No saved layouts yet. Be the first!</li>';
  }
  $('saveScore').addEventListener('click', () => {
    const name = $('playerName').value.trim() || 'Anonymous';
    const t1 = trips('player', 'single');
    const km = scoreLayout(wh, S.layouts.player, t1, orders.length).dist / 1000;
    const orig = scoreLayout(wh, S.layouts.original, t1, orders.length).dist / 1000;
    const lb = leaderboard();
    lb.push({ name, km, saved: (1 - km / orig) * 100, layout: S.layouts.player.slice(), ts: Date.now() });
    lb.sort((a, b) => a.km - b.km);
    store.set('wt-leaderboard', lb.slice(0, 50));
    renderLeaderboard();
    toast(`Saved: ${name}, ${fmt(km, 2)} km per month (rank #${lb.findIndex((e) => e.name === name && Math.abs(e.km - km) < 1e-9) + 1})`);
  });
  $('leaderboard').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-i]'); if (!li) return;
    const entry = leaderboard()[li.dataset.i];
    if (entry) loadIntoPlayer(entry.layout, `Loaded ${entry.name}'s layout.`);
  });

  // ---------- live optimizer (simulated annealing in a Web Worker) ----------
  // Objective = one order per trip, the same yardstick as the offline optimizer and the leaderboard.
  const OPT_ITERS = 24000;
  let worker = null;
  const optHist = [];
  const refKm = {};
  function drawOptChart() {
    const c = $('optChart'), g = c.getContext('2d'), W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    if (!Object.keys(refKm).length) for (const k of ['original', 'abc', 'affinity', 'optimized'])
      refKm[k] = scoreLayout(wh, S.layouts[k], trips(k, 'single'), orders.length).dist / 1000;
    const vals = optHist.length ? optHist : [refKm.original];
    const hi = Math.max(refKm.original, ...vals) + 2, lo = Math.min(refKm.optimized, ...vals) - 2;
    const y = (v) => 8 + (H - 16) * (hi - v) / (hi - lo);
    g.font = "500 19px Bahnschrift, 'Segoe UI', sans-serif"; g.lineWidth = 2;
    for (const [k, col] of [['abc', '#8a8578'], ['affinity', '#2340b8'], ['optimized', '#2e7d4f']]) {
      g.strokeStyle = col; g.globalAlpha = 0.55; g.setLineDash([8, 6]);
      g.beginPath(); g.moveTo(0, y(refKm[k])); g.lineTo(W, y(refKm[k])); g.stroke();
      g.globalAlpha = 0.9; g.fillStyle = col; g.fillText(LAYOUTS.find((l) => l.k === k).n, W - 110, y(refKm[k]) - 5);
    }
    g.setLineDash([]); g.globalAlpha = 1;
    if (optHist.length > 1) {
      g.strokeStyle = '#e0442a'; g.lineWidth = 4; g.beginPath();
      optHist.forEach((v, i) => { const x = Math.min(1, i / (OPT_ITERS / 400)) * W; i ? g.lineTo(x, y(v)) : g.moveTo(x, y(v)); });
      g.stroke();
    }
  }
  function applyOptLayout(layout) {
    S.layouts.player = layout.slice(); S.history = [];
    delete tripCache['smart|player'];
    forgetTeam('player');
    score('player');
    if (S.view === 'player') paintRacks();
    renderScoreboard();
  }
  function stopOptimizer(msg) {
    if (!worker) return;
    worker.terminate(); worker = null;
    $('optRun').disabled = false; $('optStop').disabled = true;
    $('swapInfo').textContent = msg;
    playerChanged();
  }
  $('optRun').addEventListener('click', () => {
    if (worker) return;
    if (S.view !== 'player') setView('player');
    if (R.playing) togglePlay();
    optHist.length = 0;
    worker = new Worker(new URL('./sim/optWorker.js', import.meta.url), { type: 'module' });
    worker.postMessage({ orders, nProducts: products.length, start: S.layouts.player, iters: OPT_ITERS, seed: (Date.now() & 0xffff) + 1 });
    $('optRun').disabled = true; $('optStop').disabled = false;
    $('optStatus').textContent = 'starting…';
    let shown = Infinity;
    worker.onerror = (e) => {
      e.preventDefault?.();
      $('optStatus').textContent = 'error';
      toast('Optimizer failed to start in this browser', true);
      stopOptimizer('Optimizer stopped after an error. Your layout is unchanged.');
    };
    worker.onmessage = ({ data }) => {
      const km = data.best / 1000;
      if (data.type === 'progress') {
        optHist.push(km);
        if (data.best < shown - 1) { shown = data.best; applyOptLayout(data.layout); }
        $('optStatus').textContent = `${Math.round((data.it / data.iters) * 100)}% · ${fmt(km, 1)} km · ${fmt(data.sec, 1)} s`;
        drawOptChart();
      } else {
        applyOptLayout(data.layout);
        const saved = (1 - data.best / data.startDist) * 100;
        $('optStatus').textContent = `done · ${fmt(km, 1)} km in ${fmt(data.sec, 1)} s`;
        toast(`Optimizer: ${fmt(data.startDist / 1000, 1)} → ${fmt(km, 1)} km per month (−${fmt(saved, 1)}%)`);
        stopOptimizer(`Optimizer finished: ${fmt(OPT_ITERS)} swaps tried, ${fmt(data.accepted)} accepted, −${fmt(saved, 1)}% walking.`);
      }
    };
  });
  $('optStop').addEventListener('click', () => { $('optStatus').textContent = 'stopped'; stopOptimizer('Optimizer stopped. Kept the best layout found so far.'); });

  // ---------- team of pickers: whole-month runs with aisle congestion (sim/multi.js) ----------
  const TEAM_COLORS = ['#e0442a', '#2340b8', '#2e7d4f', '#a8307e', '#c98a00', '#3b3f45'];
  const planCache = {}, teamCache = {};
  const plansOf = (k) => (planCache[`${k}|${S.mode}`] ||= planTrips(wh, S.layouts[k], trips(k)));
  const team = (k, n) => (teamCache[`${k}|${S.mode}|${S.cap}|${n}`] ||= runTeam(wh, plansOf(k), { pickers: n, cap: S.cap }));
  const forgetTeam = (k) => {
    for (const c of [planCache, teamCache]) for (const key of Object.keys(c)) if (key.startsWith(`${k}|`)) delete c[key];
  };
  $('pickerButtons').innerHTML = [1, 2, 3, 4, 5, 6].map((n) => `<button data-n="${n}">${n}</button>`).join('');
  const hrs = (h) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
  function renderTeam() {
    document.querySelectorAll('#pickerButtons button').forEach((b) => b.classList.toggle('on', +b.dataset.n === S.pickers));
    document.querySelectorAll('#capButtons button').forEach((b) => b.classList.toggle('on', +b.dataset.cap === S.cap));
    const n = S.pickers, base = team('original', n);
    $('teamTable').innerHTML = '<tr><th>Layout</th><th>month in</th><th>orders/h</th><th>waiting</th><th>vs Orig.</th></tr>'
      + LAYOUTS.map(({ k, n: name }) => {
        const r = team(k, n), gain = r.ordersPerHour / base.ordersPerHour - 1;
        const cls = `${k === S.view ? 'cur' : ''} ${k === 'player' ? 'player' : ''}`;
        return `<tr class="${cls}"><td>${name}</td><td>${hrs(r.hours)} h</td><td>${fmt(r.ordersPerHour, 1)}</td>
          <td class="${r.waitShare > 0.15 ? 'worse' : ''}">${fmt(r.waitShare * 100, 1)}%</td>
          <td>${k === 'original' ? '<span class="k">–</span>' : `<span class="${gain >= 0 ? 'saved' : 'worse'}">${gain >= 0 ? '+' : '−'}${fmt(Math.abs(gain) * 100, 1)}%</span>`}</td></tr>`;
      }).join('');
    // chart: orders per hour vs team size for the layout on screen, against perfect scaling
    const c = $('teamChart'), g = c.getContext('2d'), W = c.width, H = c.height, padL = 40, padB = 26, padT = 12;
    const rows = [1, 2, 3, 4, 5, 6].map((m) => team(S.view, m)), one = rows[0].ordersPerHour;
    const top = one * 6 * 1.05, X = (m) => padL + ((m - 1) / 5) * (W - padL - 16), Y = (v) => padT + (H - padT - padB) * (1 - v / top);
    g.clearRect(0, 0, W, H);
    g.font = "500 17px Bahnschrift, 'Segoe UI', sans-serif"; g.fillStyle = '#7d786c'; g.textAlign = 'center';
    for (let m = 1; m <= 6; m++) g.fillText(m, X(m), H - 6);
    g.textAlign = 'right';
    for (const v of [0, 50, 100, 150]) if (v < top) { g.fillText(v, padL - 8, Y(v) + 5); g.fillStyle = '#e7e1d4'; g.fillRect(padL, Y(v), W - padL - 16, 1); g.fillStyle = '#7d786c'; }
    g.lineWidth = 2.5; g.setLineDash([8, 6]); g.strokeStyle = '#7d786c';
    g.beginPath(); g.moveTo(X(1), Y(one)); g.lineTo(X(6), Y(one * 6)); g.stroke(); g.setLineDash([]);
    g.strokeStyle = '#e0442a'; g.lineWidth = 4; g.beginPath();
    rows.forEach((r, i) => (i ? g.lineTo : g.moveTo).call(g, X(i + 1), Y(r.ordersPerHour))); g.stroke();
    g.fillStyle = '#e0442a';
    rows.forEach((r, i) => { g.beginPath(); g.arc(X(i + 1), Y(r.ordersPerHour), i + 1 === n ? 7 : 4, 0, 7); g.fill(); });
    g.textAlign = 'left'; g.fillStyle = '#7d786c'; g.fillText('perfect scaling', X(4.3), Y(one * 5.2) - 4);
    const r = rows[n - 1], loss = 1 - r.ordersPerHour / (one * n);
    $('teamNote').innerHTML = `Orders per hour vs pickers (${LAYOUTS.find((l) => l.k === S.view).n}). With ${n} picker${n > 1 ? 's' : ''} in ${S.cap === 1 ? 'narrow' : 'wide'} aisles, `
      + (n === 1 ? 'nobody waits.' : `<b>${fmt(loss * 100, 0)}%</b> of the team's capacity is lost to queueing at aisles.`)
      + ` Backlog model: the month's ${fmt(orders.length)} orders queue up, each picker takes the next trip at the dock.`;
  }
  let teamTimer = 0;
  const scheduleTeam = () => { clearTimeout(teamTimer); teamTimer = setTimeout(renderTeam, 30); };
  $('pickerButtons').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.pickers = +b.dataset.n; resetReplay(); scheduleTeam();
  });
  $('capButtons').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.cap = +b.dataset.cap; resetReplay(); scheduleTeam();
  });

  // ---------- replay (animated picker) ----------
  const speedOf = (v) => Math.max(1, Math.round(Math.pow(10, (v / 100) * Math.log10(300))));
  let speed = speedOf(+$('speed').value);
  const showSpeed = () => { $('speedVal').textContent = `${speed}×`; };
  $('speed').addEventListener('input', (e) => { speed = speedOf(+e.target.value); showSpeed(); });
  showSpeed();

  // ---------- IoT sensor mode: the events real devices would stream for this replay ----------
  // RFID gate at the dock, UWB tag on the cart, pick-to-light module per slot, barcode scanner on the picker.
  const IOT = { log: [], buf: [], dirty: false };
  const TAG = { rfid: 'RFID', uwb: 'UWB', ptl: 'PTL', scan: 'SCAN' };
  function iot(type, dev, msg, data = {}) {
    if (!S.iot) return;
    const ev = { t_sim_s: +R.sim.toFixed(1), type, device: dev, ...data };
    IOT.log.push(ev);
    if (IOT.log.length > 50000) IOT.log.splice(0, 10000);
    IOT.buf.push(`<div><span class="ts">${hms(R.sim)}</span><span class="t-${type}">${TAG[type].padEnd(4, ' ')}</span> ${esc(dev)} · ${esc(msg)}</div>`);
    if (IOT.buf.length > 14) IOT.buf.splice(0, IOT.buf.length - 14);
    IOT.dirty = true;
  }
  function flushIot() {
    if (!IOT.dirty) return;
    IOT.dirty = false;
    $('iotFeed').innerHTML = IOT.buf.slice().reverse().join('');
    $('iotCount').textContent = `${fmt(IOT.log.length)} events`;
  }
  const zoneOf = (x, z) => {
    if (z < wh.frontZ + wh.cfg.crossW / 2) return z < wh.frontZ - wh.cfg.crossW / 2 ? 'dock' : 'front cross-aisle';
    if (z > wh.backZ - wh.cfg.crossW / 2) return 'back cross-aisle';
    const a = Math.round((x - wh.aisleX(0)) / (wh.aisleX(1) - wh.aisleX(0)));
    return `aisle ${wh.cfg.aisles - a}`;
  };
  function showPending(ids) {
    scene.setPending(ids);
    scene.setLights(S.iot ? ids : []);
  }
  $('iotToggle').addEventListener('change', (e) => {
    S.iot = e.target.checked;
    $('iotPanel').classList.toggle('hidden', !S.iot);
    if (S.iot) placeIotPanel(store.get('wt-iot-pos'));
    $('stage').classList.toggle('iot', S.iot);
    scene.setUwb(S.iot);
    if (R) scene.setLights(S.iot && R.P ? R.P.pending : []);
  });
  // the IoT panel can be dragged by its header; it stays inside the 3D view and remembers where it was left
  function placeIotPanel(pos) {
    const el = $('iotPanel'), st = $('stage');
    if (!pos || !isFinite(pos.x) || !isFinite(pos.y)) { el.style.left = el.style.top = ''; el.classList.remove('moved'); return; }
    const x = Math.max(0, Math.min(pos.x, st.clientWidth - el.offsetWidth));
    const y = Math.max(0, Math.min(pos.y, st.clientHeight - el.offsetHeight));
    el.style.left = `${x}px`; el.style.top = `${y}px`; el.classList.add('moved');
    return { x, y };
  }
  {
    const head = document.querySelector('#iotPanel .iot-head');
    let drag = null;
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      const el = $('iotPanel'), r = el.getBoundingClientRect(), s = $('stage').getBoundingClientRect();
      drag = { dx: e.clientX - r.left + s.left, dy: e.clientY - r.top + s.top, pos: null };
      head.setPointerCapture(e.pointerId); el.classList.add('dragging');
      e.preventDefault();
    });
    head.addEventListener('pointermove', (e) => {
      if (drag) drag.pos = placeIotPanel({ x: e.clientX - drag.dx, y: e.clientY - drag.dy });
    });
    const end = () => {
      if (!drag) return;
      if (drag.pos) store.set('wt-iot-pos', drag.pos);
      drag = null; $('iotPanel').classList.remove('dragging');
    };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
    head.addEventListener('dblclick', (e) => {
      if (e.target.closest('button')) return;
      store.set('wt-iot-pos', null); placeIotPanel(null);
    });
    window.addEventListener('resize', () => { if (S.iot && $('iotPanel').classList.contains('moved')) placeIotPanel(store.get('wt-iot-pos')); });
  }
  $('iotDownload').addEventListener('click', () => {
    const blob = new Blob([IOT.log.map((e) => JSON.stringify(e)).join('\n')], { type: 'application/x-ndjson' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `warehouse-twin-events-${S.view}.jsonl` });
    a.click(); URL.revokeObjectURL(a.href);
  });

  let R;
  function resetReplay() {
    // the trip list and the layout are snapshotted, so the live optimizer can't desync a replay in progress
    R = { playing: false, i: 0, done: 0, walked: 0, sim: 0, doneDist: 0, origDist: 0, P: null, trips: trips(), layout: curLayout().slice(), team: null };
    const d = wh.pos[wh.DOCK];
    scene.setPicker(d[0], d[1], Math.PI, false);
    // team mode: everyone lines up at the dock until play is pressed
    scene.setTeam(S.pickers > 1 ? Array.from({ length: S.pickers }, (_, i) => ({ x: d[0] + (i - (S.pickers - 1) / 2) * 1.1, z: d[1], heading: Math.PI })) : null);
    scene.setRoute([]); showPending([]);
    IOT.log = []; IOT.buf = []; IOT.dirty = true;
    $('orderCard').classList.add('hidden');
    $('play').textContent = '▶ Replay orders';
    renderCounters();
  }

  function startTrip() {
    const t = R.trips[R.i];
    if (!t) { R.playing = false; R.P = null; $('play').textContent = '✓ Month replayed'; return; }
    const slotOf = slotOfProduct(R.layout);
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
    R.P = { t, pts, stops, seg: 0, segT: 0, dwell: 0, dist, origDist, slotsAtNode, lines, qty, slotOf, picked: new Set(),
            walkStart: R.walked, simStart: R.sim, pending: t.products.map((p) => slotOf[p]) };
    scene.setRoute(pts);
    showPending(R.P.pending);
    renderOrderCard(tripOrders, qty);
    iot('rfid', 'DOCK-GATE', `cart C-01 out · ${t.orders.length} tote${t.orders.length > 1 ? 's' : ''} → ${t.orders.join(', ')}`,
      { event: 'cart_out', cart: 'C-01', orders: t.orders });
    for (const p of t.products) {
      const s = wh.slots[slotOf[p]];
      iot('ptl', `PTL-${s.label}`, `ON · ${products[p].code} qty ${qty.get(p)}`, { event: 'light_on', slot: s.label, sku: products[p].code, qty: qty.get(p) });
    }
  }

  function renderTeamCard() {
    const T = R.team, zone = (p) => {
      const n = p.plan && p.plan.nodes[Math.min(p.i + 1, p.plan.nodes.length - 1)];
      const a = n === undefined ? -1 : T.aisleOf(n);
      return a >= 0 ? `aisle ${wh.cfg.aisles - a}` : 'cross-aisle';
    };
    $('orderCard').innerHTML = `<h3>Team of ${T.P.length} pickers</h3><div class="meta">${S.cap === 1 ? 'narrow aisles · 1 cart per aisle' : 'wide aisles · 2 carts per aisle'} · trip ${fmt(Math.min(T.next, R.trips.length))} / ${fmt(R.trips.length)}</div><ul>`
      + T.P.map((p) => {
        const st = p.idle ? 'done, back at dock' : p.waiting ? `waiting: ${zone(p)} is full` : p.dwell > 0 ? `picking in ${zone(p)}` : `walking · ${p.plan.trip.orders.length > 1 ? 'batch' : `order ${p.plan.trip.orders[0]}`}`;
        return `<li class="${p.waiting ? 'wait' : 'done'}"><span class="tdot" style="background:${TEAM_COLORS[p.id]}">${p.id + 1}</span><span>${st}</span><span class="q">${fmt(p.waited / 60, 0)} min</span></li>`;
      }).join('') + '</ul><div class="meta" style="margin:8px 0 0">right column = minutes spent waiting so far</div>';
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
      const p = R.layout[s];
      if (P.picked.has(p)) continue;
      P.picked.add(p);
      n += P.lines.get(p);
      scene.flashSlot(s);
      const li = $('orderCard').querySelector(`li[data-p="${p}"]`);
      if (li) { li.classList.add('done'); li.querySelector('.ck').textContent = '✓'; }
      const lbl = wh.slots[s].label;
      iot('scan', 'SCANNER-01', `${products[p].code} @${lbl} qty ${P.qty.get(p)} ✓`, { event: 'pick_confirmed', slot: lbl, sku: products[p].code, qty: P.qty.get(p) });
      iot('ptl', `PTL-${lbl}`, 'OFF', { event: 'light_off', slot: lbl });
    }
    P.pending = P.pending.filter((s) => !P.picked.has(R.layout[s]));
    showPending(P.pending);
    P.dwell = n * wh.cfg.pickSecPerLine;
  }

  function finishTrip() {
    const P = R.P;
    iot('rfid', 'DOCK-GATE', `cart C-01 in · ${fmt(P.dist)} m · ${P.t.lines} lines`, { event: 'cart_in', cart: 'C-01', trip_m: +P.dist.toFixed(1), lines: P.t.lines });
    R.done += P.t.orders.length;
    R.doneDist += P.dist;
    R.origDist += P.origDist;
    R.walked = P.walkStart + P.dist;
    R.sim = P.simStart + P.dist / wh.cfg.walkSpeed + P.t.lines * wh.cfg.pickSecPerLine;
    R.i++;
    startTrip();
  }

  function stepTeam(sec) {
    const T = R.team;
    T.advance(sec);
    for (const ev of T.events) {
      const cart = `C-0${ev.picker + 1}`;
      if (ev.type === 'out') iot('rfid', 'DOCK-GATE', `cart ${cart} out · ${ev.trip.orders.join(', ')}`, { event: 'cart_out', cart, orders: ev.trip.orders });
      else if (ev.type === 'in') iot('rfid', 'DOCK-GATE', `cart ${cart} in · ${ev.trip.lines} line${ev.trip.lines === 1 ? '' : 's'}`, { event: 'cart_in', cart, lines: ev.trip.lines });
      else if (ev.type === 'blocked') iot('uwb', `UWB-TAG ${cart}`, `waiting · aisle ${wh.cfg.aisles - ev.aisle} occupied`, { event: 'aisle_blocked', cart, aisle: wh.cfg.aisles - ev.aisle });
      else if (ev.type === 'enter') iot('uwb', `UWB-TAG ${cart}`, `enters aisle ${wh.cfg.aisles - ev.aisle}`, { event: 'aisle_enter', cart, aisle: wh.cfg.aisles - ev.aisle });
    }
    T.events.length = 0;
    R.done = T.ordersDone; R.walked = T.walked; R.sim = T.t;
    scene.setTeam(T.P);
    if (T.finished) { R.playing = false; $('play').textContent = '✓ Month replayed'; }
  }

  function step(dt) {
    if (R.team) { if (R.playing) stepTeam(dt * speed); return; }
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
        if (S.iot) {
          const [x, z] = P.pts[P.seg];
          iot('uwb', 'UWB-TAG C-01', `x ${x.toFixed(1)} z ${z.toFixed(1)} m · ${zoneOf(x, z)}`, { event: 'position', cart: 'C-01', x: +x.toFixed(2), z: +z.toFixed(2) });
        }
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
    $('cCompareK').textContent = R.team || S.pickers > 1 ? 'Team · waiting at aisles' : 'Same orders on Original';
    $('cCompareBox').classList.toggle('hidden', S.pickers === 1 && S.view === 'original');
    if (R.team) {
      const st = R.team.stats();
      $('cCompare').innerHTML = `${fmt(st.waitShare * 100, 1)}% <span class="k" style="font-size:13px">· ${fmt(st.ordersPerHour, 1)} orders/h</span>`;
      renderTeamCard();
    } else if (S.pickers > 1) $('cCompare').textContent = '–';
    else if (R.done > 0 && S.view !== 'original') {
      const saved = 1 - R.doneDist / R.origDist;
      $('cCompare').innerHTML = `${fmt(R.origDist)} m <span class="${saved >= 0 ? 'saved' : 'worse'}" style="font-size:13px">(${saved >= 0 ? '−' : '+'}${fmt(Math.abs(saved) * 100, 1)}% here)</span>`;
    } else $('cCompare').textContent = '–';
  }

  $('play').addEventListener('click', togglePlay);
  function togglePlay() {
    if (S.pickers > 1) {
      if (R.team && R.team.finished) resetReplay();
      R.team ||= new MultiSim(wh, planTrips(wh, R.layout, R.trips), { pickers: S.pickers, cap: S.cap });
      R.playing = !R.playing;
      $('play').textContent = R.playing ? '❚❚ Pause' : '▶ Resume';
      if (R.playing) $('orderCard').classList.remove('hidden');
      return;
    }
    if (!R.P && R.i >= R.trips.length) resetReplay();
    R.playing = !R.playing;
    if (R.playing && !R.P) startTrip();
    $('play').textContent = R.playing ? '❚❚ Pause' : '▶ Resume';
  }
  $('stepOrder').addEventListener('click', () => {
    if (S.pickers > 1) { // run the team until the next trip comes back to the dock
      R.team ||= new MultiSim(wh, planTrips(wh, R.layout, R.trips), { pickers: S.pickers, cap: S.cap });
      const target = R.team.done + 1;
      for (let g = 0; g < 4000 && !R.team.finished && R.team.done < target; g++) stepTeam(1);
      $('orderCard').classList.remove('hidden'); renderCounters(); return;
    }
    if (!R.P) startTrip();
    if (R.P) { finishTrip(); placePicker(); renderCounters(); }
  });

  let hudTimer = 0;
  scene.onFrame((dt) => {
    step(dt);
    hudTimer += dt;
    if (hudTimer > 0.1) { hudTimer = 0; renderCounters(); flushIot(); }
    return R.playing;
  });

  // ---------- keyboard shortcuts (handy during the demo) ----------
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key >= '1' && e.key <= '5') setView(LAYOUTS[+e.key - 1].k);
    else if (e.key === 'h') { $('trafficToggle').click(); }
    else if (e.key === 'b') { const next = { single: 'batch', batch: 'smart', smart: 'single' }[S.mode]; document.querySelector(`#modeButtons button[data-mode=${next}]`).click(); }
    else if (e.key === 'i') { $('iotToggle').click(); }
    else if (e.key === 'o') { $('optRun').click(); }
    else if (e.key === 'p') { document.querySelector(`#pickerButtons button[data-n="${(S.pickers % 6) + 1}"]`).click(); }
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
    <p class="note">Shortcuts: <kbd>P</kbd> pickers · <kbd>Space</kbd> play/pause · <kbd>1</kbd>–<kbd>5</kbd> layouts · <kbd>H</kbd> traffic · <kbd>B</kbd> batch mode · <kbd>I</kbd> IoT · <kbd>O</kbd> optimizer · <kbd>Esc</kbd> deselect</p>`;

  // URL presets for the demo screen, e.g. ?view=affinity&batch=1&traffic=1&play=1&speed=80
  const q = new URLSearchParams(location.search);
  if (LAYOUTS.some((l) => l.k === q.get('view'))) S.view = q.get('view');
  const qMode = q.get('batch') === '1' ? 'batch' : q.get('batch') === 'smart' ? 'smart' : null;
  if (qMode) {
    S.mode = qMode;
    document.querySelectorAll('#modeButtons button').forEach((x) => x.classList.toggle('on', x.dataset.mode === qMode));
  }
  if (q.get('iot') === '1') $('iotToggle').click();
  if (/^[1-6]$/.test(q.get('pickers') || '')) S.pickers = +q.get('pickers');
  if (q.get('cap') === '2') S.cap = 2;
  if (q.get('traffic') === '1') { S.traffic = true; $('trafficToggle').checked = true; }
  if (q.has('speed') && isFinite(+q.get('speed'))) { $('speed').value = Math.max(0, Math.min(100, +q.get('speed'))); speed = speedOf(+$('speed').value); showSpeed(); }

  scoreAll();
  renderLeaderboard();
  applyView();
  drawOptChart();
  if (q.get('play') === '1') togglePlay();
  if (q.get('opt') === '1') $('optRun').click();
  if (q.has('select') && Number.isInteger(+q.get('select')) && +q.get('select') >= 0 && +q.get('select') < wh.nSlots) select(+q.get('select'));
}

main();
