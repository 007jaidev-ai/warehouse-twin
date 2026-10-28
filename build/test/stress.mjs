// Run: npm i puppeteer-core (any scratch dir), npm run build && npm run preview in web/, then node build/test/stress.mjs
// Stress test for the warehouse twin: drives the real app in headless Edge and fails on any JS error.
import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = process.argv[2] || 'http://localhost:4173/';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1500,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 900 });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
// count draw calls so we can verify render-on-demand
await page.evaluateOnNewDocument(() => {
  window.__draws = 0;
  for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype])
    for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const o = P[f]; if (o) P[f] = function (...a) { window.__draws++; return o.apply(this, a); };
    }
});
await page.goto(URL + '?speed=100', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelectorAll('#scoreboard tr').length === 6);
const txt = (sel) => page.$eval(sel, (e) => e.textContent);
const step = (name) => console.log(`[${errors.length} err] ${name}`);

// 1. idle: no draws once the camera settles
await wait(1500);
let d0 = await page.evaluate(() => window.__draws); await wait(2000);
let d1 = await page.evaluate(() => window.__draws);
console.log('idle draw calls over 2 s:', d1 - d0);

// 2. play at 300x, flip layouts / modes / overlays while playing
await page.keyboard.press('Space'); await wait(2500);
console.log('playing: draws over 1 s:', await page.evaluate(async () => { const a = window.__draws; await new Promise((r) => setTimeout(r, 1000)); return window.__draws - a; }));
for (const k of ['2', '3', 'b', 'Space', 'h', 'i', '4', 'Space', 'b', 'b', '1', 'Space']) { await page.keyboard.press(k); await wait(400); }
step('layouts/modes/overlays while playing: ' + await txt('#cOrders'));

// 3. player view: swap racks by clicking around the canvas while a replay runs
await page.keyboard.press('5'); await page.keyboard.press('Space');
const box = await (await page.$('#canvas')).boundingBox();
let clicks = 0;
for (let i = 0; i < 40; i++) {
  await page.mouse.click(box.x + box.width * (0.35 + 0.5 * Math.random()), box.y + box.height * (0.25 + 0.5 * Math.random()));
  clicks++; await wait(60);
}
step(`${clicks} clicks in player view; swap info: ${(await txt('#swapInfo')).slice(0, 80)}`);
await page.click('#undo'); await page.click('#undo');

// 4. optimizer while the replay keeps running; clicking racks must be refused, not corrupt state
await page.click('#optRun'); await wait(500);
await page.keyboard.press('Space');
for (let i = 0; i < 10; i++) { await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.45); await wait(150); }
await page.keyboard.press('b'); await wait(300);
await page.waitForFunction(() => !document.querySelector('#optStop') || document.querySelector('#optStop').disabled, { timeout: 240000 });
step('optimizer finished: ' + await txt('#optStatus'));
const you = await page.$eval('#scoreboard tr.player', (r) => r.textContent.replace(/\s+/g, ' '));
console.log('  You row:', you);

// 5. stop-start optimizer quickly, then reset
await page.click('#optRun'); await wait(300); await page.click('#optStop'); await wait(200);
await page.click('#optRun'); await wait(300); await page.click('#resetOriginal'); await wait(300);
step('optimizer start/stop/reset: ' + await txt('#optStatus'));

// 6. skip through the whole month in every mode, then restart
for (const mode of ['single', 'batch', 'smart']) {
  await page.click(`#modeButtons button[data-mode=${mode}]`);
  await page.evaluate(() => { const b = document.querySelector('#stepOrder'); for (let i = 0; i < 2400; i++) b.click(); });
  step(`${mode}: after skipping all trips: ${await txt('#play')} · ${await txt('#cOrders')} · ${await txt('#cDist')}`);
  await page.keyboard.press('Space'); await wait(300);
  step(`${mode}: restart -> ${await txt('#play')} · ${await txt('#cOrders')}`);
}

// 7. leaderboard with junk in localStorage, then save
await page.evaluate(() => localStorage.setItem('wt-leaderboard', JSON.stringify([{ name: '<b>x', km: 'NaN' }, null, 5])));
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelectorAll('#scoreboard tr').length === 6);
await page.type('#playerName', 'tester'); await page.click('#saveScore'); await wait(300);
step('leaderboard: ' + await txt('#leaderboard'));
await page.evaluate(() => localStorage.clear());

// 8. hostile URL params
await page.goto(URL + '?select=abc&speed=1e9&view=nope&batch=smart&iot=1&play=1', { waitUntil: 'networkidle0' });
await wait(2500);
step('hostile params: ' + await txt('#cOrders'));

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO ERRORS');
await browser.close();
process.exit(errors.length ? 1 : 0);
