// The clock probe's Electron main (P5 O17 M8; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M8, Decisions and
// Concrete Steps; U3's FINDINGS: an offscreen tab's clocks run throttled, about 110 ms click to paint and 100 ms timers
// near 6 Hz). One process measures one variant of one fresh offscreen tab on page.html and writes <out> (JSON):
//   baseline    the render host's view as src/render-host/offscreen-views.ts makes it: offscreen, 1280x800, held in a
//               sizing BaseWindow that is never shown, in a windowless process under the accessory policy
//   fps30/fps60 the same with webContents.setFrameRate(30 | 60)
//   beginframe  the same with main pacing frames itself: webContents.invalidate() every 16 ms. invalidate() is the one
//               public, documented API that asks an offscreen view for a new frame ("If offscreen rendering is enabled
//               invalidates the frame and generates a new one through the 'paint' event", electron.d.ts); Electron
//               exposes no external BeginFrame source. beginFrameSubscription only observes frames (a capture
//               callback), `backgroundThrottling: false` U3 pass 3 already measured (offscreen-nothrottle: 108.5 ms,
//               6.6 Hz, no change), and `offscreen.useSharedTexture` is @experimental and changes the frame transport,
//               not its pacing.
// Readings: the page's visibilityState and hidden; the host's visibility as main sees it; requestAnimationFrame and 16 ms
// and 100 ms setInterval rates over a 5 s window; click to paint (sendInputEvent mouseDown/mouseUp at the button's
// centre, timed from the send to the first offscreen `paint` whose bitmap shows the new panel colour), 30 clicks about
// 300 ms apart; which of the APIs the pinned Electron has (typeof). No private Chromium switch, no powerSaveBlocker.
//
// Run by run.sh only (`pnpm install --frozen-lockfile && bash spikes/u3-remote-browser/macos/clock/run.sh`), on a Mac
// other than the owner's MacBook:
//   Electron probe.cjs --variant <name> --out <file.json> --user-data <scratch dir>
// Self-contained: it imports nothing from src/ (the webPreferences and the sizing window below are restated from
// src/render-host/offscreen-views.ts's offscreenPreferences() and OffscreenViews.place()), and no product code imports it.
// It is a measurement, not a gate.
'use strict';
const { app, BaseWindow, WebContentsView } = require('electron');
const { writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { performance } = require('node:perf_hooks');
const os = require('node:os');

const args = process.argv;
const arg = (name) => {
  const at = args.indexOf(name);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : null;
};
const VARIANTS = {
  baseline: { frameRate: null, invalidateHz: null },
  fps30: { frameRate: 30, invalidateHz: null },
  fps60: { frameRate: 60, invalidateHz: null },
  beginframe: { frameRate: null, invalidateHz: 60 },
};
const VIEWPORT = { width: 1280, height: 800 }; // offscreen-views.ts HEADLESS_VIEWPORT
const BUTTON = { x: 40 + 120, y: 40 + 40 }; // page.html #target's centre
const SAMPLE = { x: 640, y: 480 }; // inside page.html #panel (y >= 160)
const MEASURE_MS = 5000;
const CLICKS = 30;
const CLICK_SPACING_MS = 300;
const CLICK_TIMEOUT_MS = 2000;
const SETTLE_MS = 1000;
const SELF_TIMEOUT_MS = 100_000; // under run.sh's guard, so a stuck variant still writes what it has

const variantName = arg('--variant') ?? 'baseline';
const variant = VARIANTS[variantName];
const out = arg('--out');
const userData = arg('--user-data');
if (!variant || !out || !userData) {
  // no throw before `ready`: Electron answers an uncaught error at load with a dialog
  console.error(`[clock] usage: --variant <${Object.keys(VARIANTS).join('|')}> --out <file> --user-data <dir>`);
  process.exit(64);
}

const now = () => Math.round(performance.now() * 10) / 10;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const t0 = now();
const result = {
  variant: variantName,
  setup: { ...variant },
  versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
  platform: { os: process.platform, arch: process.arch, release: os.release() },
  supported: null,
  host: {},
  page: {},
  clocks: null,
  main: {},
  clicks: [],
  errors: [],
  done: false,
};
const save = () => writeFileSync(out, JSON.stringify(result, null, 2));
const fail = (name, error) => {
  result.errors.push({ name, message: error instanceof Error ? (error.stack ?? error.message) : String(error) });
  save();
};
let finishing = false;
const finish = (code) => {
  if (finishing) return;
  finishing = true;
  result.totalMs = Math.round(now() - t0);
  save();
  app.exit(code);
};
// no dialog for an uncaught error in main: record it and leave
process.on('uncaughtException', (error) => (fail('uncaughtException', error), finish(1)));
process.on('unhandledRejection', (error) => (fail('unhandledRejection', error), finish(1)));

rmSync(userData, { recursive: true, force: true });
app.setPath('userData', userData); // a scratch profile, never the app's
if (process.platform === 'darwin') app.setActivationPolicy('accessory'); // the render host's policy: no Dock icon
app.on('window-all-closed', () => {});

const safe = (fn) => {
  try {
    return fn();
  } catch (error) {
    return `error: ${error instanceof Error ? error.message : String(error)}`;
  }
};
const callIf = (target, name) => (typeof target?.[name] === 'function' ? safe(() => target[name]()) : null);

function supportedOn(wc) {
  const has = (target, name) => typeof target?.[name] === 'function';
  return {
    setFrameRate: has(wc, 'setFrameRate'),
    getFrameRate: has(wc, 'getFrameRate'),
    invalidate: has(wc, 'invalidate'),
    beginFrameSubscription: has(wc, 'beginFrameSubscription'),
    isOffscreen: has(wc, 'isOffscreen'),
    isPainting: has(wc, 'isPainting'),
    startPainting: has(wc, 'startPainting'),
    getBackgroundThrottling: has(wc, 'getBackgroundThrottling'),
    setBackgroundThrottling: has(wc, 'setBackgroundThrottling'),
    isBackgroundThrottling: has(wc, 'isBackgroundThrottling'),
    sendInputEvent: has(wc, 'sendInputEvent'),
    appSetActivationPolicy: has(app, 'setActivationPolicy'),
    appDockHide: has(app.dock, 'hide'),
  };
}

function hostState(win, wc) {
  return {
    atMs: Math.round(now() - t0),
    isOffscreen: callIf(wc, 'isOffscreen'),
    frameRate: callIf(wc, 'getFrameRate'),
    isPainting: callIf(wc, 'isPainting'),
    backgroundThrottling: callIf(wc, 'getBackgroundThrottling') ?? callIf(wc, 'isBackgroundThrottling'),
    webContentsFocused: callIf(wc, 'isFocused'),
    windowVisible: callIf(win, 'isVisible'),
    windowMinimized: callIf(win, 'isMinimized'),
    windowFocused: callIf(win, 'isFocused'),
    dockVisible: process.platform === 'darwin' ? callIf(app.dock, 'isVisible') : null,
  };
}

// The pixel at SAMPLE in a paint's image, 4 bytes, or null when this paint does not cover it. The image is the whole
// frame in current Electron; the dirty-rect case is read too, since the paint event's docs say only the dirty area.
function samplePixel(image, dirty) {
  const size = image.getSize();
  if (size.width === 0 || size.height === 0) return null;
  let x, y;
  if (size.width >= VIEWPORT.width && size.height >= VIEWPORT.height) {
    const scale = size.width / VIEWPORT.width;
    x = Math.floor(SAMPLE.x * scale);
    y = Math.floor(SAMPLE.y * scale);
  } else {
    if (SAMPLE.x < dirty.x || SAMPLE.y < dirty.y || SAMPLE.x >= dirty.x + dirty.width || SAMPLE.y >= dirty.y + dirty.height) return null;
    const scale = size.width / dirty.width;
    x = Math.floor((SAMPLE.x - dirty.x) * scale);
    y = Math.floor((SAMPLE.y - dirty.y) * scale);
  }
  return image.crop({ x, y, width: 1, height: 1 }).toBitmap();
}

// green (0,160,0) and magenta (160,0,160) as page.html sets them; bytes 0 and 2 are red and blue in either order
function classify(px) {
  if (!px || px.length < 3) return null;
  const [a, g, b] = px;
  if (g > 100 && a < 80 && b < 80) return 'green';
  if (g < 80 && a > 100 && b > 100) return 'magenta';
  if (g > 200 && a > 200 && b > 200) return 'white';
  return 'other';
}
const colourAfter = (clickCount) => ((clickCount - 1) % 2 === 0 ? 'green' : 'magenta');

async function main() {
  await app.whenReady();
  if (process.platform === 'darwin') app.dock?.hide();
  setTimeout(() => (fail('selfTimeout', `still running after ${SELF_TIMEOUT_MS} ms`), finish(2)), SELF_TIMEOUT_MS);

  // offscreen-views.ts: offscreenPreferences() and the never-shown sizing window of OffscreenViews.place()
  const webPreferences = { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: true, safeDialogs: true, offscreen: true };
  const view = new WebContentsView({ webPreferences });
  const win = new BaseWindow({ show: false, width: VIEWPORT.width, height: VIEWPORT.height, useContentSize: true, frame: false, skipTaskbar: true });
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height });
  const wc = view.webContents;
  result.supported = supportedOn(wc);
  result.setup.webPreferences = webPreferences;
  result.host.created = hostState(win, wc);

  if (variant.frameRate !== null) {
    result.setup.frameRateBefore = callIf(wc, 'getFrameRate');
    wc.setFrameRate(variant.frameRate);
    result.setup.frameRateAfter = callIf(wc, 'getFrameRate');
  }

  // paints: every arrival's time, and the pending click's resolution
  const paints = [];
  let imageShape = null;
  let pending = null; // { expect, resolve }
  wc.on('paint', (_event, dirty, image) => {
    const at = now();
    paints.push(at);
    if (!pending) return;
    let px;
    try {
      px = samplePixel(image, dirty);
    } catch (error) {
      fail('samplePixel', error);
      return;
    }
    if (!imageShape) imageShape = { image: image.getSize(), dirty };
    const colour = classify(px);
    if (colour === pending.expect) {
      const done = pending;
      pending = null;
      done.resolve({ at, colour });
    }
  });
  const handlerAt = new Map(); // click number -> when main saw the page's console line
  wc.on('console-message', (details, _level, legacyMessage) => {
    // Electron 44 passes one details object; older ones (event, level, message, ...)
    const message = typeof details?.message === 'string' ? details.message : String(legacyMessage ?? '');
    const match = /^clock-probe click (\d+)$/.exec(message);
    if (match) handlerAt.set(Number(match[1]), now());
  });

  await wc.loadFile(join(__dirname, 'page.html'));
  result.host.loaded = hostState(win, wc);

  const invalidates = [];
  let invalidateTimer = null;
  if (variant.invalidateHz !== null) {
    invalidateTimer = setInterval(() => {
      invalidates.push(now());
      wc.invalidate();
    }, Math.round(1000 / variant.invalidateHz));
  }

  await sleep(SETTLE_MS);
  result.page.beforeClocks = await wc.executeJavaScript('window.__state()');
  result.host.beforeClocks = hostState(win, wc);
  save();

  // the clock window: the page's three clocks, and in main the paints, a 100 ms main timer and the invalidate cadence
  const mainTicks = [];
  const mainTimer = setInterval(() => mainTicks.push(now()), 100);
  const from = now();
  result.clocks = await wc.executeJavaScript(`window.__measure(${MEASURE_MS})`);
  const to = now();
  clearInterval(mainTimer);
  const inWindow = (times) => times.filter((at) => at >= from && at <= to).map((at) => Math.round((at - from) * 10) / 10);
  result.main.clockWindow = { windowMs: Math.round((to - from) * 10) / 10, paints: inWindow(paints), timer100: inWindow(mainTicks), invalidates: inWindow(invalidates) };
  result.host.afterClocks = hostState(win, wc);
  save();

  // the clicks
  wc.sendInputEvent({ type: 'mouseMove', x: BUTTON.x, y: BUTTON.y });
  await sleep(100);
  let count = await wc.executeJavaScript('window.__clicks');
  for (let i = 1; i <= CLICKS; i += 1) {
    const expect = colourAfter(count + 1);
    const landed = new Promise((resolve) => (pending = { expect, resolve }));
    const timeout = sleep(CLICK_TIMEOUT_MS).then(() => null);
    const sentAt = now();
    wc.sendInputEvent({ type: 'mouseDown', x: BUTTON.x, y: BUTTON.y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: BUTTON.x, y: BUTTON.y, button: 'left', clickCount: 1 });
    const painted = await Promise.race([landed, timeout]);
    pending = null;
    count += 1;
    const handler = handlerAt.get(count);
    const click = { i, expect, sentAt: Math.round((sentAt - t0) * 10) / 10, toPaintMs: painted ? Math.round((painted.at - sentAt) * 10) / 10 : null, toHandlerMs: handler !== undefined ? Math.round((handler - sentAt) * 10) / 10 : null };
    if (!painted) {
      // resynchronise the expected colour with the page's own count (a click that never reached the handler)
      count = await wc.executeJavaScript('window.__clicks');
      click.pageClicksAfterTimeout = count;
    }
    result.clicks.push(click);
    const elapsed = now() - sentAt;
    await sleep(Math.max(50, CLICK_SPACING_MS - elapsed));
  }
  result.main.paintImage = imageShape;
  result.page.afterClicks = await wc.executeJavaScript('({ ...window.__state(), trusted: window.__trusted })');
  result.host.afterClicks = hostState(win, wc);

  if (invalidateTimer) clearInterval(invalidateTimer);
  result.done = true;
  win.destroy();
  finish(0);
}

main().catch((error) => (fail('main', error), finish(1)));
