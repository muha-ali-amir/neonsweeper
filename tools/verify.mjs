import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'],
});

const problems = [];
function watch(page, tag) {
  page.on('pageerror', (err) => problems.push(`[${tag}:PAGEERROR] ${err.message}`));
  page.on('requestfailed', (req) => problems.push(`[${tag}:REQFAIL] ${req.url()} :: ${req.failure()?.errorText}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`[${tag}:CONSOLE] ${msg.text()}`);
  });
}

async function waitInteractive(page) {
  await page.waitForFunction(() => window.__NEONSWEEPER__?.scene?.interactive === true, null, { timeout: 15000 });
}

async function state(page) {
  return page.evaluate(() => {
    const app = window.__NEONSWEEPER__;
    return {
      presetId: app.presetId,
      config: { ...app.config },
      phase: app.game?.phase,
      revealed: app.game?.revealedCount,
      flagged: app.game?.flagCount,
      charges: { ...app.charges },
      ghostShield: app.game?.ghostShield,
      siphonTokens: app.game?.siphonTokens,
      sonarArmed: app.sonarArmed,
      flagMode: app.flagMode,
      settings: { ...app.settings },
      musicEnabled: app.audio.musicEnabled,
      sfxEnabled: app.audio.sfxEnabled,
      audioReady: app.audio.ready,
      helpOpen: !document.getElementById('help-modal').classList.contains('is-hidden'),
      endOpen: !document.getElementById('end-screen').classList.contains('is-hidden'),
    };
  });
}

async function project(page, index) {
  return page.evaluate((idx) => {
    const app = window.__NEONSWEEPER__;
    const tile = app.scene.tiles[idx];
    const V = app.scene.camera.position.constructor;
    const v = new V(tile.x, 0.2, tile.z);
    v.project(app.scene.camera);
    const rect = app.scene.canvas.getBoundingClientRect();
    return {
      x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
    };
  }, index);
}

async function clickCell(page, index, button = 'left') {
  const p = await project(page, index);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(80);
  await page.mouse.click(p.x, p.y, { button });
  await page.waitForTimeout(550);
}

function log(label, value) {
  console.log(label, JSON.stringify(value));
}

/* ————— desktop: keyboard, audio, persistence ————— */
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
watch(page, 'desktop');
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.click('#jack-in-btn');
await page.waitForTimeout(4500);
await waitInteractive(page);

let s = await state(page);
assert.equal(s.audioReady, true, 'audio engine should initialize after JACK IN');
assert.equal(s.presetId, 'runner', 'default preset should be runner');
assert.deepEqual(s.config, { cols: 16, rows: 16, mines: 40 });
log('baseline', s);

// Keyboard: music toggle
await page.keyboard.press('m');
await page.waitForTimeout(300);
s = await state(page);
assert.equal(s.settings.music, false, 'M should mute music');
assert.equal(s.musicEnabled, false);
assert.equal(await page.getAttribute('#music-btn', 'aria-pressed'), 'false');
assert.equal(await page.locator('#music-btn').evaluate((el) => el.classList.contains('is-on')), false);
assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('neonsweeper.settings.v1')).music), false);
await page.keyboard.press('m');
await page.waitForTimeout(300);
s = await state(page);
assert.equal(s.settings.music, true, 'M should unmute music');
assert.equal(s.musicEnabled, true);
log('music toggle', s.settings);

// Keyboard: sfx toggle
await page.keyboard.press('s');
await page.waitForTimeout(300);
s = await state(page);
assert.equal(s.settings.sfx, false, 'S should mute sfx');
assert.equal(s.sfxEnabled, false);
assert.equal(await page.getAttribute('#sfx-btn', 'aria-pressed'), 'false');
await page.keyboard.press('s');
await page.waitForTimeout(300);
s = await state(page);
assert.equal(s.settings.sfx, true, 'S should unmute sfx');
log('sfx toggle', s.settings);

// Keyboard: flag mode
await page.keyboard.press('f');
await page.waitForTimeout(300);
s = await state(page);
assert.equal(s.flagMode, true, 'F should enable flag mode');
assert.equal(await page.getAttribute('#flag-btn', 'aria-pressed'), 'true');
await page.keyboard.press('f');
await page.waitForTimeout(250);
s = await state(page);
assert.equal(s.flagMode, false, 'F should disable flag mode');

// Keyboard: help + Escape
await page.keyboard.press('h');
await page.waitForTimeout(500);
s = await state(page);
assert.equal(s.helpOpen, true, 'H should open the field manual');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
s = await state(page);
assert.equal(s.helpOpen, false, 'Escape should close the field manual');

// Keyboard: modal blocks game hotkeys
await page.keyboard.press('h');
await page.waitForTimeout(400);
await page.keyboard.press('f');
await page.waitForTimeout(300);
s = await state(page);
assert.equal(s.helpOpen, true);
assert.equal(s.flagMode, false, 'game hotkeys should not fire while a modal is open');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// Keyboard: difficulty presets 1/2/3
await page.keyboard.press('1');
await page.waitForTimeout(3200);
s = await state(page);
assert.equal(s.presetId, 'rookie');
assert.deepEqual(s.config, { cols: 9, rows: 9, mines: 10 });
await page.keyboard.press('3');
await page.waitForTimeout(3200);
s = await state(page);
assert.equal(s.presetId, 'blackice');
assert.deepEqual(s.config, { cols: 30, rows: 16, mines: 99 });
await page.keyboard.press('2');
await page.waitForTimeout(3200);
s = await state(page);
assert.equal(s.presetId, 'runner');
await waitInteractive(page);

// Keyboard: new run
await page.keyboard.press('r');
await page.waitForTimeout(2200);
s = await state(page);
assert.equal(s.phase, 'ready', 'R should rebuild the run');
assert.equal(s.revealed, 0);
assert.deepEqual(s.charges, { scan: 1, defuse: 1, sonar: 2 });
await waitInteractive(page);

// Real first reveal, then Q/E abilities via keyboard
const center = await page.evaluate(() => {
  const g = window.__NEONSWEEPER__.game;
  return g.cols * Math.floor(g.rows / 2) + Math.floor(g.cols / 2);
});
await clickCell(page, center);
s = await state(page);
assert.equal(s.phase, 'playing', 'first click should start the run');
assert.ok(s.revealed > 0, 'first click should reveal at least one tile');
const revealedBefore = s.revealed;
await page.keyboard.press('q');
await page.waitForTimeout(900);
s = await state(page);
log('after Q', { ...s, interactive: await page.evaluate(() => window.__NEONSWEEPER__.scene.interactive) });
assert.equal(s.charges.scan, 0, 'Q should spend the Deep Scan charge');
assert.ok(s.revealed > revealedBefore, 'Deep Scan should reveal a safe tile');
assert.equal(await page.locator('#scan-btn').isDisabled(), true);
await page.keyboard.press('e');
await page.waitForTimeout(700);
s = await state(page);
log('after E', { ...s, interactive: await page.evaluate(() => window.__NEONSWEEPER__.scene.interactive) });
assert.equal(s.charges.defuse, 0, 'E should spend the Ice Break charge');
assert.ok(s.flagged >= 1, 'Ice Break should flag a hostile');
assert.equal(await page.locator('#defuse-btn').isDisabled(), true);
assert.equal(s.ghostShield, 1, 'Ghost Protocol should start armed');
await page.keyboard.press('t');
await page.waitForTimeout(250);
s = await state(page);
assert.equal(s.sonarArmed, true, 'T should arm Sonar Ping');
await clickCell(page, center);
await page.waitForTimeout(500);
s = await state(page);
assert.equal(s.charges.sonar, 1, 'Sonar Ping should spend one of two charges');
assert.equal(s.sonarArmed, false, 'Sonar Ping disarms after a sweep');
assert.equal(s.phase, 'playing', 'Sonar Ping must not breach or lose the run');
log('abilities via keyboard', s);

// Audio volume sliders + labels + settings storage
await page.keyboard.press('h');
await page.waitForTimeout(500);
await page.evaluate(() => {
  const set = (id, value) => {
    const el = document.getElementById(id);
    el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set('music-volume', 30);
  set('sfx-volume', 45);
});
await page.waitForTimeout(400);
s = await state(page);
assert.equal(s.settings.musicVolume, 30, 'music slider should update settings');
assert.equal(s.settings.sfxVolume, 45, 'sfx slider should update settings');
assert.equal(await page.textContent('#music-volume-val'), '30');
assert.equal(await page.textContent('#sfx-volume-val'), '45');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// Finish a rookie run for a persisted personal best
await page.keyboard.press('1');
await page.waitForTimeout(3200);
await waitInteractive(page);
await page.evaluate(() => {
  const app = window.__NEONSWEEPER__;
  const g = app.game;
  const first = g.tiles.findIndex((t) => !t.mine);
  if (first >= 0) app.handleResult(g.reveal(first), first);
  for (let i = 0; i < g.total && g.phase !== 'won'; i++) {
    const tile = g.tiles[i];
    if (tile.revealed || tile.mine) continue;
    app.handleResult(g.reveal(i), i);
  }
});
await page.waitForTimeout(3000);
const winData = await page.evaluate(() => {
  const app = window.__NEONSWEEPER__;
  const stats = JSON.parse(localStorage.getItem('neonsweeper.stats.v1'));
  return {
    phase: app.game.phase,
    endOpen: !document.getElementById('end-screen').classList.contains('is-hidden'),
    endTime: document.getElementById('end-time').textContent,
    endScore: document.getElementById('end-score').textContent,
    recordVisible: !document.getElementById('end-record').classList.contains('is-hidden'),
    stats,
    bestRows: [...document.querySelectorAll('.best-row')].map((r) => r.textContent.trim()),
    bestTime: document.getElementById('best-time').textContent,
  };
});
log('win persistence', winData);
assert.equal(winData.phase, 'won');
assert.equal(winData.endOpen, true, 'win report should appear');
assert.equal(winData.recordVisible, true, 'first win should set a personal best');
assert.equal(winData.stats.wins, 1, 'stats should persist one win');
assert.ok(winData.stats.records.rookie, 'stats should store the rookie record');
assert.ok(winData.bestRows.some((row) => row.includes('ROOKIE')), 'best runs list should show the rookie record');

const savedBest = winData.stats.records.rookie.time;
const savedTimeText = winData.bestTime;
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.evaluate(() => window.__NEONSWEEPER__.selectPreset('rookie'));
await page.waitForTimeout(700);
const afterReload = await page.evaluate(() => {
  const app = window.__NEONSWEEPER__;
  return {
    stats: app.stats,
    settings: app.settings,
    bestTime: document.getElementById('best-time').textContent,
    bestRows: [...document.querySelectorAll('.best-row')].map((r) => r.textContent.trim()),
    musicBtn: document.getElementById('music-btn').getAttribute('aria-pressed'),
    sfxBtn: document.getElementById('sfx-btn').getAttribute('aria-pressed'),
  };
});
log('after reload', afterReload);
assert.equal(afterReload.stats.wins, 1, 'wins should survive reload');
assert.equal(afterReload.stats.records.rookie.time, savedBest, 'best time should survive reload');
assert.equal(afterReload.bestTime, savedTimeText, 'PERSONAL BEST should be restored after selecting the saved sector');
assert.ok(afterReload.bestRows.some((row) => row.includes('ROOKIE')), 'best runs list should be restored after reload');
assert.equal(afterReload.settings.musicVolume, 30, 'music volume should persist after reload');
assert.equal(afterReload.settings.sfxVolume, 45, 'sfx volume should persist after reload');
assert.equal(afterReload.musicBtn, 'true', 'music toggle should be restored after reload');
assert.equal(afterReload.sfxBtn, 'true', 'sfx toggle should be restored after reload');

await context.close();

/* ————— mobile: long-press flags ————— */
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const mp = await mobile.newPage();
watch(mp, 'mobile');
const cdp = await mobile.newCDPSession(mp);
await mp.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await mp.waitForTimeout(1800);
await mp.tap('#jack-in-btn');
await mp.waitForTimeout(4200);
await waitInteractive(mp);

async function longPress(x, y, hold = 650) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }],
  });
  await mp.waitForTimeout(hold);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await mp.waitForTimeout(500);
}

const mobileTile = await mp.evaluate(() => {
  const app = window.__NEONSWEEPER__;
  const idx = app.game.tiles.findIndex((t) => !t.revealed && !t.flagged);
  const tile = app.scene.tiles[idx];
  const V = app.scene.camera.position.constructor;
  const v = new V(tile.x, 0.2, tile.z);
  v.project(app.scene.camera);
  const rect = app.scene.canvas.getBoundingClientRect();
  return {
    idx,
    x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
    y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
  };
});
log('mobile target', mobileTile);

let m = await state(mp);
assert.equal(m.phase, 'ready');
const revealedBeforePress = m.revealed;
await longPress(mobileTile.x, mobileTile.y);
m = await state(mp);
assert.equal(m.phase, 'ready', 'long-press flagging should not start the run');
assert.equal(m.revealed, revealedBeforePress, 'long-press should not reveal a tile');
assert.equal(m.flagged, 1, 'long-press should place a flag');
const flaggedAfterLongPress = await mp.evaluate((idx) => window.__NEONSWEEPER__.game.tiles[idx].flagged, mobileTile.idx);
assert.equal(flaggedAfterLongPress, true, 'long-pressed tile should be flagged');
await mp.screenshot({ path: 'shots/17-mobile-longpress.png' });

// Short tap on the flagged tile should leave it flagged.
await mp.touchscreen.tap(mobileTile.x, mobileTile.y);
await mp.waitForTimeout(500);
m = await state(mp);
assert.equal(m.phase, 'ready', 'tapping a flagged tile should not reveal it');
assert.equal(m.flagged, 1, 'tapping a flagged tile should keep the flag');

// Long-press again to unflag.
await longPress(mobileTile.x, mobileTile.y);
m = await state(mp);
assert.equal(m.flagged, 0, 'second long-press should unflag the tile');

// Flag mode tap-to-flag.
await mp.tap('#flag-btn');
await mp.waitForTimeout(400);
m = await state(mp);
assert.equal(m.flagMode, true);
await mp.touchscreen.tap(mobileTile.x, mobileTile.y);
await mp.waitForTimeout(500);
m = await state(mp);
assert.equal(m.flagged, 1, 'tap should flag while flag mode is on');
assert.equal(m.phase, 'ready', 'flag-mode tap should not reveal');
await mp.tap('#flag-btn');
await mp.waitForTimeout(300);

// A normal tap starts the run; the flag from before remains (flag mode is off).
const centerTile = await mp.evaluate(() => {
  const app = window.__NEONSWEEPER__;
  const idx = app.game.cols * Math.floor(app.game.rows / 2) + Math.floor(app.game.cols / 2);
  const tile = app.scene.tiles[idx];
  const V = app.scene.camera.position.constructor;
  const v = new V(tile.x, 0.2, tile.z);
  v.project(app.scene.camera);
  const rect = app.scene.canvas.getBoundingClientRect();
  return {
    idx,
    x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
    y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
  };
});
await mp.touchscreen.tap(centerTile.x, centerTile.y);
await mp.waitForTimeout(1200);
m = await state(mp);
assert.equal(m.phase, 'playing', 'normal tap should reveal and start the run');
assert.equal(m.flagged, 1, 'pre-start flag should remain after the run starts');
log('mobile final', m);

await mobile.close();
await browser.close();

if (problems.length) {
  console.error('\nPROBLEMS DETECTED:');
  for (const p of problems) console.error(p);
  process.exit(1);
}
console.log('\nALL VERIFICATION CHECKS PASSED');
