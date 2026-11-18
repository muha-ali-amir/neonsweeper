import { chromium } from 'playwright';

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'],
});

async function start(page) {
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);
  await page.click('#jack-in-btn');
  await page.waitForTimeout(4300);
  await page.waitForFunction(() => window.__NEONSWEEPER__?.scene?.interactive === true, null, { timeout: 15000 });
}

async function tapCenter(page) {
  const p = await page.evaluate(() => {
    const app = window.__NEONSWEEPER__;
    const idx = app.game.cols * Math.floor(app.game.rows / 2) + Math.floor(app.game.cols / 2);
    const tile = app.scene.tiles[idx];
    const V = app.scene.camera.position.constructor;
    const v = new V(tile.x, 0.2, tile.z);
    v.project(app.scene.camera);
    const rect = app.scene.canvas.getBoundingClientRect();
    return {
      x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
    };
  });
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(2600);
}

const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const dp = await desktop.newPage();
await start(dp);
await dp.screenshot({ path: 'shots/hierarchy-desktop-ready.png' });
await tapCenter(dp);
await dp.screenshot({ path: 'shots/hierarchy-desktop.png' });
await dp.screenshot({ path: 'shots/hierarchy-top-crop.png', clip: { x: 450, y: 0, width: 640, height: 100 } });
await dp.screenshot({ path: 'shots/hierarchy-left-crop.png', clip: { x: 0, y: 90, width: 275, height: 470 } });
await dp.screenshot({ path: 'shots/hierarchy-right-crop.png', clip: { x: 1170, y: 90, width: 270, height: 400 } });
await dp.hover('#scan-btn');
await dp.waitForTimeout(500);
await dp.screenshot({ path: 'shots/hierarchy-hover.png' });
await dp.screenshot({ path: 'shots/hierarchy-dock-hover.png', clip: { x: 280, y: 775, width: 880, height: 105 } });

// README hero art: 16:9 frame, captured after the first breach so the
// countermeasures and difficulty controls show their interactive state.
const heroCtx = await browser.newContext({ viewport: { width: 1440, height: 810 } });
const heroPage = await heroCtx.newPage();
await start(heroPage);
await tapCenter(heroPage);
await heroPage.waitForTimeout(1400); // let the boot toast clear the stack
await heroPage.screenshot({ path: 'docs/hero.jpg', type: 'jpeg', quality: 84 });
await heroCtx.close();

const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const mp = await mobile.newPage();
await start(mp);
await mp.screenshot({ path: 'shots/hierarchy-mobile-ready.png' });
const center = await mp.evaluate(() => {
  const app = window.__NEONSWEEPER__;
  const idx = app.game.cols * Math.floor(app.game.rows / 2) + Math.floor(app.game.cols / 2);
  const tile = app.scene.tiles[idx];
  const V = app.scene.camera.position.constructor;
  const v = new V(tile.x, 0.2, tile.z);
  v.project(app.scene.camera);
  const rect = app.scene.canvas.getBoundingClientRect();
  return { x: rect.left + (v.x * 0.5 + 0.5) * rect.width, y: rect.top + (-v.y * 0.5 + 0.5) * rect.height };
});
await mp.touchscreen.tap(center.x, center.y);
await mp.waitForTimeout(2600);
await mp.screenshot({ path: 'shots/hierarchy-mobile.png' });

const extraSizes = [
  ['narrow-desktop', { width: 1200, height: 800 }, false],
  ['laptop', { width: 1366, height: 768 }, false],
  ['tablet', { width: 820, height: 1180 }, true],
  ['small-phone', { width: 360, height: 640 }, true],
];

for (const [label, viewport, touch] of extraSizes) {
  const ctx = await browser.newContext({ viewport, isMobile: touch, hasTouch: touch });
  const page = await ctx.newPage();
  await start(page);
  await tapCenter(page);
  await page.screenshot({ path: `shots/hierarchy-${label}.png` });
  const layout = await page.evaluate(() => {
    const rect = (sel) => document.querySelector(sel)?.getBoundingClientRect().toJSON();
    const overlap = (a, b) => Boolean(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
    const brand = rect('.brand');
    const diff = rect('.difficulty');
    const topActions = rect('.top-actions');
    const hudTop = rect('.hud-top');
    const readout = rect('.mobile-readout');
    const hints = rect('.hints');
    const dock = rect('.countermeasures');
    const bottomActions = rect('.bottom-actions');
    const bottom = rect('.hud-bottom');
    const ticker = rect('.ticker');
    return {
      viewport: { w: innerWidth, h: innerHeight },
      overflowX: document.documentElement.scrollWidth > innerWidth,
      brandVsDiff: overlap(brand, diff),
      diffVsActions: overlap(diff, topActions),
      diffVsReadout: overlap(diff, readout),
      hudVsBottom: overlap(hudTop, bottom),
      hintsVsDock: overlap(hints, dock),
      dockVsActions: overlap(dock, bottomActions),
      dockVsTicker: overlap(dock, ticker),
      hintsVsActions: overlap(hints, bottomActions),
      bottomVsTicker: overlap(bottom, ticker),
      diffInContainer: [...document.querySelectorAll('.diff')].every((el) => {
        const d = el.getBoundingClientRect();
        const c = document.querySelector('.difficulty').getBoundingClientRect();
        return d.left >= c.left - 0.5 && d.right <= c.right + 0.5;
      }),
      abilityRow: (() => {
        const cards = [...document.querySelectorAll('.cm-cards .ability')].map((el) => el.getBoundingClientRect());
        if (!cards.length) return true;
        return cards.every((card, i) => i === 0
          || (Math.abs(card.top - cards[0].top) < 1 && cards[i - 1].right <= card.left));
      })(),
      abilityCount: document.querySelectorAll('.cm-cards .ability').length,
    };
  });
  console.log(label, JSON.stringify(layout));
  await ctx.close();
}

await browser.close();
console.log('Saved hierarchy screenshots for desktop, laptop, tablet, and phone.');
