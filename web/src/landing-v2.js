/* Landing page v2 — dependency-free motion engine.
   Scroll-told layout ladder: as you scroll, the pick route re-routes and
   draws under scroll (scrubbed), the km counts down, and the racks warm up
   and concentrate along the heat ramp. Plus hero route, real-order
   comparison, paper grain, magnetic CTAs. Reduced-motion safe. */
import './landing-v2.css';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

/* ---- draw an SVG path with the stroke-draw animation (hero + comparison) ---- */
function drawPath(path, { restart = true } = {}) {
  if (!path) return;
  let len = 1200;
  try { len = path.getTotalLength() || 1200; } catch { /* not measurable yet */ }
  path.style.setProperty('--len', len);
  if (reduce) { path.classList.add('draw'); return; }
  if (restart) { path.classList.remove('draw'); void path.getBoundingClientRect(); }
  path.classList.add('draw');
}

/* ---- count up to data-count ---- */
function countUp(el) {
  const target = parseFloat(el.dataset.count);
  if (!isFinite(target)) return;
  const suffix = el.dataset.suffix || '';
  const decimals = (String(el.dataset.count).split('.')[1] || '').length;
  const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
  if (reduce) { el.textContent = fmt(target); return; }
  const dur = 1100, t0 = performance.now(), ease = (x) => 1 - Math.pow(1 - x, 3);
  const tick = (now) => { const p = clamp((now - t0) / dur); el.textContent = fmt(target * ease(p)); if (p < 1) requestAnimationFrame(tick); else el.textContent = fmt(target); };
  requestAnimationFrame(tick);
}

/* ---- tween a number between two values ---- */
function tweenNum(el, from, to, decimals = 1) {
  if (reduce || !isFinite(from)) { el.textContent = to.toFixed(decimals); return; }
  const dur = 550, t0 = performance.now(), ease = (x) => 1 - Math.pow(1 - x, 3);
  const step = (now) => { const p = clamp((now - t0) / dur); el.textContent = (from + (to - from) * ease(p)).toFixed(decimals); if (p < 1) requestAnimationFrame(step); else el.textContent = to.toFixed(decimals); };
  requestAnimationFrame(step);
}

const fillBars = (root) => $$('[data-w]', root).forEach((i) => { i.style.width = i.dataset.w + '%'; });

/* ---- reveal-on-scroll ---- */
const seen = new WeakSet();
function activate(el) {
  if (seen.has(el)) return;
  seen.add(el);
  el.classList.add('in');
  $$('[data-count]', el).forEach(countUp);
  if (el.matches?.('[data-count]')) countUp(el);
  fillBars(el);
  const cmp = $('.route.cmp', el);
  if (cmp) setTimeout(() => drawPath(cmp, { restart: false }), 120);
}
const io = 'IntersectionObserver' in window
  ? new IntersectionObserver((es, obs) => es.forEach((e) => { if (e.isIntersecting) { activate(e.target); obs.unobserve(e.target); } }), { threshold: 0.18, rootMargin: '0px 0px -8% 0px' })
  : null;
const watch = $$('.reveal, .ribbon, .results, .panel');
if (io) watch.forEach((el) => io.observe(el)); else watch.forEach(activate);

/* ---- hero route + picks ---- */
function playHero() {
  drawPath($('#heroRoute'), { restart: false });
  const base = reduce ? 0 : 400;
  $$('.hero .pick').forEach((p) => { const at = parseInt(p.dataset.at || '0', 10); if (reduce) p.classList.add('pop'); else setTimeout(() => p.classList.add('pop'), base + at); });
}
requestAnimationFrame(() => requestAnimationFrame(playHero));
$$('.hero .reveal').forEach((el) => requestAnimationFrame(() => activate(el)));

/* ============ SCROLLYTELLING LADDER ============ */
const steps = $$('#steps .step');
const ladderRoute = $('#ladderRoute');
const racks = $$('#ladderSvg .rack');
const nowName = $('#nowName'), ladderKm = $('#ladderKm'), ladderDelta = $('#ladderDelta'), ladderBar = $('#ladderBar');

// heat ramp: sand → sage → teal → amber → red  (rare → picked often)
const RAMP = [[233, 221, 191], [188, 201, 160], [127, 176, 163], [233, 174, 12], [224, 68, 42]];
function heatColor(h) {
  h = clamp(h);
  const x = h * (RAMP.length - 1), i = Math.floor(x), f = x - i;
  const a = RAMP[i], b = RAMP[Math.min(i + 1, RAMP.length - 1)];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}
// per-layout heat for the 10 rack rects (DOM order = aisles 1→5, two sides each)
const HEAT = {
  'Original':   [0.22, 0.9, 0.3, 0.12, 0.7, 0.2, 0.85, 0.16, 0.6, 0.26], // hot racks scattered everywhere
  'ABC':        [0.3, 0.42, 0.55, 0.72, 0.8, 0.85, 0.62, 0.5, 0.34, 0.26],
  'Affinity':   [0.16, 0.24, 0.52, 0.8, 0.92, 0.88, 0.74, 0.42, 0.22, 0.12],
  'Optimized':  [0.1, 0.14, 0.32, 0.72, 0.96, 0.95, 0.66, 0.3, 0.14, 0.09], // tight hot core near the dock
  'Your floor': [0.12, 0.16, 0.34, 0.74, 0.95, 0.94, 0.68, 0.32, 0.16, 0.1],
};
function recolorRacks(name) {
  const heat = HEAT[name]; if (!heat) return;
  racks.forEach((r, k) => { r.style.fill = heatColor(heat[k] ?? 0.2); });
}

let current = -1, ladderLen = 1200;
function setStep(i) {
  const d = steps[i].dataset;
  const prevKm = current >= 0 ? parseFloat(steps[current].dataset.km) : NaN;
  current = i;
  steps.forEach((s, k) => s.classList.toggle('on', k === i));
  if (ladderRoute) { ladderRoute.setAttribute('d', d.d); try { ladderLen = ladderRoute.getTotalLength() || 1200; } catch { ladderLen = 1200; } }
  if (nowName) nowName.textContent = d.name;
  const km = parseFloat(d.km);
  if (ladderKm) { if (isFinite(km)) tweenNum(ladderKm, prevKm, km, 1); else ladderKm.textContent = 'you'; }
  if (ladderBar) ladderBar.style.width = (d.w || '100') + '%';
  if (ladderDelta) { ladderDelta.textContent = d.delta; ladderDelta.classList.toggle('base', d.base === '1'); ladderDelta.classList.toggle('you', d.you === '1'); }
  recolorRacks(d.name);
}

function updateLadder() {
  if (!steps.length) return;
  const mid = innerHeight * 0.5;
  let idx = 0, intra = 0, found = false;
  for (let i = 0; i < steps.length; i++) {
    const r = steps[i].getBoundingClientRect();
    if (r.top <= mid && r.bottom > mid) { idx = i; intra = (mid - r.top) / r.height; found = true; break; }
  }
  if (!found) { // above the first step, or past the last
    idx = steps[0].getBoundingClientRect().top > mid ? 0 : steps.length - 1;
    intra = idx === 0 ? 0 : 1;
  }
  if (idx !== current) setStep(idx);
  // scrub the stroke draw: route finishes drawing over the first 60% of the step
  if (ladderRoute) {
    const p = reduce ? 1 : clamp(intra / 0.6);
    ladderRoute.style.strokeDasharray = ladderLen;
    ladderRoute.style.strokeDashoffset = ladderLen * (1 - p);
  }
}
if (steps.length) { setStep(0); requestAnimationFrame(updateLadder); }

/* ============ magnetic buttons ============ */
if (!reduce && matchMedia('(pointer:fine)').matches) {
  $$('.mag').forEach((wrap) => {
    const btn = $('.btn', wrap); if (!btn) return;
    const k = 0.28;
    wrap.addEventListener('pointermove', (e) => {
      const r = wrap.getBoundingClientRect();
      btn.style.transform = `translate(${(e.clientX - (r.left + r.width / 2)) * k}px, ${(e.clientY - (r.top + r.height / 2)) * k}px)`;
    });
    wrap.addEventListener('pointerleave', () => { btn.style.transform = ''; });
  });
}

/* ============ progress bar + sticky nav + ladder, one scroll handler ============ */
const bar = $('#progress'), nav = $('#nav');
let ticking = false;
function onScroll() {
  if (ticking) return; ticking = true;
  requestAnimationFrame(() => {
    const h = document.documentElement, max = h.scrollHeight - h.clientHeight;
    bar.style.width = (max > 0 ? (h.scrollTop / max) * 100 : 0) + '%';
    nav.classList.toggle('stuck', h.scrollTop > 24);
    updateLadder();
    ticking = false;
  });
}
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', onScroll, { passive: true });
onScroll();

/* ============ page-exit curtain → app ============ */
const curtain = $('#curtain');
$$('a.launch').forEach((a) => {
  a.addEventListener('click', (e) => {
    const href = a.getAttribute('href');
    if (reduce || !curtain || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    curtain.classList.add('play');
    setTimeout(() => (location.href = href), 470);
  });
});
