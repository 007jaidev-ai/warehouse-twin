import puppeteer from 'puppeteer-core';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], protocolTimeout: 600000 });
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 900, deviceScaleFactor: 2 });
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const t0 = Date.now();
await p.goto('http://localhost:4173/?view=optimized&pickers=4&iot=1', { waitUntil: 'networkidle0' });
await p.waitForFunction(() => document.querySelectorAll('#teamTable tr').length === 6, { timeout: 60000 });
console.log('team table ready in', Date.now() - t0, 'ms');
await p.keyboard.press('Space'); await wait(1500);
await p.$eval('#speed', (e) => { e.value = 30; e.dispatchEvent(new Event('input')); });
await wait(6000);
await p.screenshot({ path: 'C:/Users/ASUS/Documents/Studies/ElectroSolve/build/shots/app_team.png' });
console.log('screenshot');
await p.evaluate(() => document.querySelector('#teamSection').scrollIntoView());
await wait(300);
await p.screenshot({ path: 'C:/Users/ASUS/.claude/jobs/c92d7887/tmp/team_panel.png' });
// stress: cycle pickers/cap/modes/layouts while playing, skip trips, run to the end
for (const k of ['p', 'p', 'b', '2', 'p', '5', 'Space', 'b', 'p', 'Space']) { await p.keyboard.press(k); await wait(250); }
await p.click('#capButtons button[data-cap="2"]'); await wait(300);
await p.evaluate(() => { for (let i = 0; i < 50; i++) document.querySelector('#stepOrder').click(); });
// finish the month quickly by skipping trip by trip
await p.evaluate(() => { const b = document.querySelector('#stepOrder'); for (let i = 0; i < 3000 && !document.querySelector('#play').textContent.includes('Month replayed'); i++) b.click(); });
console.log('team month done:', await p.$eval('#cOrders', (e) => e.textContent), await p.$eval('#cTime', (e) => e.textContent), await p.$eval('#cCompare', (e) => e.textContent));
console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'NO ERRORS');
await b.close();
