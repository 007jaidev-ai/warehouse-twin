/* Landing page motion engine — dependency-free, offline-safe.
   Scroll-reveals, number count-ups, bar fills, SVG route draw,
   scroll progress + sticky nav, and a page-exit transition to the app.
   Everything degrades gracefully and honours prefers-reduced-motion. */
import './landing.css';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---- count-up: eases a number from 0 to its data-count when revealed ---- */
function countUp(el) {
  const target = parseFloat(el.dataset.count);
  if (!isFinite(target)) return;
  const suffix = el.dataset.suffix || '';
  const decimals = (String(target).split('.')[1] || '').length;
  const fmt = (n) =>
    n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
  if (reduce) { el.textContent = fmt(target); return; }
  const dur = 1100, t0 = performance.now();
  const ease = (x) => 1 - Math.pow(1 - x, 3); // ease-out cubic
  const tick = (now) => {
    const p = Math.min((now - t0) / dur, 1);
    el.textContent = fmt(target * ease(p));
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = fmt(target);
  };
  requestAnimationFrame(tick);
}

/* ---- fill a bar: set width from its data-w (percent) ---- */
const fillBars = (root) => $$('[data-w]', root).forEach((i) => { i.style.width = i.dataset.w + '%'; });

/* ---- reveal on scroll: add .in, then run any counters/bars inside ---- */
const seen = new WeakSet();
const activate = (el) => {
  if (seen.has(el)) return;
  seen.add(el);
  el.classList.add('in');
  $$('[data-count]', el).forEach(countUp);
  if (el.matches('[data-count]')) countUp(el);
  fillBars(el);
};

const io = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries, obs) => {
      entries.forEach((e) => { if (e.isIntersecting) { activate(e.target); obs.unobserve(e.target); } });
    }, { threshold: 0.18, rootMargin: '0px 0px -8% 0px' })
  : null;

const watch = $$('.reveal, .ribbon, .datacard, .rung, .results, .pull');
if (io) watch.forEach((el) => io.observe(el));
else watch.forEach(activate); // no IO: just show everything, filled

// Elements that carry counters/bars but aren't .reveal (ribbon cells live inside .ribbon) are covered above.

/* ---- SVG hero route: draw the line, then pop the pick dots ---- */
function playRoute() {
  const route = $('#route');
  if (route) route.classList.add('draw');
  if (reduce) { $$('.pick').forEach((p) => p.classList.add('pop')); return; }
  $$('.pick').forEach((p) => {
    const at = parseInt(p.dataset.at || '0', 10);
    setTimeout(() => p.classList.add('pop'), 500 + at); // 500ms = route draw start delay
  });
}
// kick the hero animation once the first paint has settled
requestAnimationFrame(() => requestAnimationFrame(playRoute));
// hero copy + plan are .reveal — reveal them immediately on load (they're above the fold)
$$('.hero .reveal').forEach((el) => requestAnimationFrame(() => activate(el)));

/* ---- scroll progress bar + sticky-nav shadow ---- */
const bar = $('#progress'), nav = $('#nav');
let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    const h = document.documentElement;
    const max = h.scrollHeight - h.clientHeight;
    bar.style.width = (max > 0 ? (h.scrollTop / max) * 100 : 0) + '%';
    nav.classList.toggle('stuck', h.scrollTop > 24);
    ticking = false;
  });
}
addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ---- page-exit transition: curtain wipe, then go to the app ---- */
const curtain = $('#curtain');
$$('a.launch').forEach((a) => {
  a.addEventListener('click', (e) => {
    const href = a.getAttribute('href');
    if (reduce || !curtain || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // let the browser handle it
    e.preventDefault();
    // Prefer the native View Transitions API when available, else the CSS curtain.
    if (document.startViewTransition) {
      curtain.classList.add('play');
      setTimeout(() => (location.href = href), 460);
    } else {
      curtain.classList.add('play');
      setTimeout(() => (location.href = href), 480);
    }
  });
});
