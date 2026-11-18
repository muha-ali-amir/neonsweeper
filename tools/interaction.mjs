import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = 'shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'],
});

const logs = [];
function watch(page, tag) {
  page.on('console', (msg) => logs.push(`[${tag}:${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => logs.push(`[${tag}:PAGEERROR] ${err.message}\n${err.stack}`));
  page.on('requestfailed', (req) => logs.push(`[${tag}:REQFAIL] ${req.url()} :: ${req.failure()?.errorText}`));
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
      z: v.z,
    };
  }, index);
}

async function clickCell(page, index, button = 'left') {
  const p = await project(page, index);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(80);
  await page.mouse.click(p.x, p.y, { button });
  await page.waitForTimeout(450);
  return p;
}

async function snapshot(page, label) {
  const data = await page.evaluate(() => {
    const app = window.__NEONSWEEPER__;
    return {
      phase: app.game.phase,
      config: { cols: app.game.cols, rows: app.game.rows, mines: app.game.mineTotal },
      revealed: app.game.revealedCount,
      flagged: app.game.flagCount,
      remaining: app.game.remainingMines,
      score: app.game.getScore(),
      charges: { ...app.charges },
      flagMode: app.flagMode,
      timer: document.getElementById('timer')?.textContent,
      log: [...document.querySelectorAll('.log-entry')].map((e) => e.textContent.trim()).slice(0, 5),
      endOpen: !document.getElementById('end-screen').classList.contains('is-hidden'),
      endTitle: document.getElementById('end-title')?.textContent,
      abilities: {
        scanDisabled: document.getElementById('scan-btn')?.disabled,
        defuseDisabled: document.getElementById('defuse-btn')?.disabled,
      },
      panelRight: document.getElementById('panel-right')?.getBoundingClientRect().toJSON(),
    };
  });
  console.log(label, JSON.stringify(data, null, 2));
  return data;
}

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
watch(page, 'desktop');

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/01-boot-desktop.png` });
await page.click('#jack-in-btn');
await page.waitForTimeout(4200);
await page.screenshot({ path: `${OUT}/02-game-desktop.png` });

// Close-up board inspection
await page.evaluate(() => {
  const app = window.__NEONSWEEPER__;
  app.scene.camera.position.set(0, 18, 19);
  app.scene.controls.target.set(0, 0, 0);
  app.scene.controls.update();
});
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/02b-board-closeup.png`, clip: { x: 260, y: 150, width: 920, height: 620 } });
await page.evaluate(() => window.__NEONSWEEPER__.scene.resize());
await page.waitForTimeout(900);

// First reveal (center cell is guaranteed safe)
const center = (await page.evaluate(() => window.__NEONSWEEPER__.game.cols * 8 + 8));
await clickCell(page, center);
await page.waitForTimeout(1100);
await page.screenshot({ path: `${OUT}/03-revealed.png` });
await snapshot(page, 'AFTER FIRST REVEAL');

// Flag a hidden cell
const hidden = await page.evaluate(() => {
  const app = window.__NEONSWEEPER__;
  return app.game.tiles.findIndex((t) => !t.revealed && !t.flagged);
});
await clickCell(page, hidden, 'right');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/04-flagged.png` });
let state = await snapshot(page, 'AFTER FLAG');

// Unflag
await clickCell(page, hidden, 'right');
await snapshot(page, 'AFTER UNFLAG');

// Deep scan
await page.click('#scan-btn');
await page.waitForTimeout(1100);
await page.screenshot({ path: `${OUT}/05-scan.png` });
await snapshot(page, 'AFTER SCAN');

// Ice break
await page.click('#defuse-btn');
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/06-icebreak.png` });
await snapshot(page, 'AFTER ICE BREAK');

// Flag mode toggle
await page.click('#flag-btn');
await page.waitForTimeout(300);
await snapshot(page, 'FLAG MODE ON');
await page.click('#flag-btn');

// Help modal
await page.click('#help-btn');
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/07-help.png` });
const helpOpen = await page.evaluate(() => !document.getElementById('help-modal').classList.contains('is-hidden'));
console.log('HELP OPEN', helpOpen);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// Custom modal
await page.click('[data-preset="custom"]');
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/08-custom-modal.png` });
await page.evaluate(() => {
  const set = (id, value) => {
    const input = document.getElementById(id);
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set('custom-cols', 24);
  set('custom-rows', 12);
  set('custom-mines', 70);
});
await page.waitForTimeout(400);
const customPreview = await page.evaluate(() => ({
  text: document.getElementById('custom-preview-text')?.textContent,
  warn: document.getElementById('custom-warn')?.textContent,
  max: document.getElementById('custom-mines')?.max,
}));
console.log('CUSTOM PREVIEW', customPreview);
await page.click('#custom-deploy');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/09-custom-grid.png` });
state = await snapshot(page, 'AFTER CUSTOM DEPLOY');

// Switch to rookie for a controlled win
await page.click('[data-preset="rookie"]');
await page.waitForTimeout(2200);
await snapshot(page, 'AFTER ROOKIE SELECT');

// Reveal all safe cells through the public flow to trigger the win screen
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
await page.waitForTimeout(3200);
await page.screenshot({ path: `${OUT}/10-win.png` });
state = await snapshot(page, 'AFTER WIN');
const winUI = await page.evaluate(() => ({
  stats: {
    time: document.getElementById('end-time')?.textContent,
    score: document.getElementById('end-score')?.textContent,
    mines: document.getElementById('end-mines')?.textContent,
    cells: document.getElementById('end-cells')?.textContent,
    record: document.getElementById('end-record')?.textContent,
    recordHidden: document.getElementById('end-record')?.classList.contains('is-hidden'),
  },
  bestRows: [...document.querySelectorAll('.best-row')].map((r) => r.textContent.trim()),
}));
console.log('WIN UI', JSON.stringify(winUI, null, 2));

// Run it back, absorb the first hostile with Ghost Protocol, then detonate a second
await page.click('#end-again');
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const app = window.__NEONSWEEPER__;
  const g = app.game;
  const center = g.cols * Math.floor(g.rows / 2) + Math.floor(g.cols / 2);
  app.handleResult(g.reveal(center), center);
  const mines = g.tiles.map((t, i) => (t.mine ? i : -1)).filter((i) => i >= 0);
  if (mines[0] >= 0) setTimeout(() => app.doReveal(mines[0]), 350);
  if (mines[1] >= 0) setTimeout(() => app.doReveal(mines[1]), 900);
});
await page.waitForTimeout(5200);
await page.screenshot({ path: `${OUT}/11-loss.png` });
state = await snapshot(page, 'AFTER LOSS');

console.log('DESKTOP LOGS');
for (const line of logs) console.log(line);
await context.close();

// ————— mobile —————
const mobileLogs = [];
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const mp = await mobile.newPage();
watch(mp, 'mobile');
await mp.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await mp.waitForTimeout(2800);
await mp.screenshot({ path: `${OUT}/12-boot-mobile.png` });
await mp.tap('#jack-in-btn');
await mp.waitForTimeout(4200);
await mp.screenshot({ path: `${OUT}/13-game-mobile.png` });
const mobileLayout = await mp.evaluate(() => {
  const r = (sel) => document.querySelector(sel)?.getBoundingClientRect().toJSON();
  const cs = (sel) => {
    const el = document.querySelector(sel);
    return el ? { display: getComputedStyle(el).display, opacity: getComputedStyle(el).opacity } : null;
  };
  return {
    viewport: { w: innerWidth, h: innerHeight },
    hudTop: r('#hud-top'),
    readout: r('#mobile-readout'),
    hudBottom: r('#hud-bottom'),
    ticker: r('.ticker'),
    canvas: r('#stage canvas'),
    panels: { left: cs('#panel-left'), right: cs('#panel-right') },
    mobileButtons: {
      scan: cs('#scan-mobile'),
      defuse: cs('#defuse-mobile'),
      sonar: cs('#sonar-mobile'),
      ghost: cs('#ghost-mobile'),
      siphon: cs('#siphon-mobile'),
    },
    interactive: window.__NEONSWEEPER__?.scene?.interactive,
    config: window.__NEONSWEEPER__?.game ? {
      cols: window.__NEONSWEEPER__.game.cols,
      rows: window.__NEONSWEEPER__.game.rows,
    } : null,
  };
});
console.log('MOBILE LAYOUT', JSON.stringify(mobileLayout, null, 2));

// mobile first reveal via tap at center
const mcenter = await mp.evaluate(() => {
  const app = window.__NEONSWEEPER__;
  const idx = app.game.cols * Math.floor(app.game.rows / 2) + Math.floor(app.game.cols / 2);
  const tile = app.scene.tiles[idx];
  const V = app.scene.camera.position.constructor;
  const v = new V(tile.x, 0.2, tile.z);
  v.project(app.scene.camera);
  const rect = app.scene.canvas.getBoundingClientRect();
  return { x: rect.left + (v.x * 0.5 + 0.5) * rect.width, y: rect.top + (-v.y * 0.5 + 0.5) * rect.height };
});
await mp.touchscreen.tap(mcenter.x, mcenter.y);
await mp.waitForTimeout(1400);
await mp.screenshot({ path: `${OUT}/14-mobile-revealed.png` });

await mp.tap('#help-btn');
await mp.waitForTimeout(800);
await mp.screenshot({ path: `${OUT}/15-help-mobile.png` });
const helpMobile = await mp.evaluate(() => {
  const m = document.querySelector('.modal-help');
  return {
    open: !document.getElementById('help-modal').classList.contains('is-hidden'),
    rect: m?.getBoundingClientRect().toJSON(),
    scrollHeight: m?.querySelector('.modal-body')?.scrollHeight,
    clientHeight: m?.querySelector('.modal-body')?.clientHeight,
  };
});
console.log('MOBILE HELP', JSON.stringify(helpMobile, null, 2));

console.log('MOBILE LOGS');
for (const line of mobileLogs) console.log(line);

await browser.close();
