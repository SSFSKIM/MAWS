// E4c M2 Task 2.4 (docs/doperpowers/plans/2026-10-06-e4c-browser-tools.md, Decision Log 36, 43): parking a released
// tab. Findings only, never product code. Task 0.3 (unplaced.mjs) measured never-attached views sized before their first
// load; this probe measures the case it left open: a view that was placed in a shown window and painted, then released as
// E4a releases it (hidden, still a child of its window), then parked. And whether sizing alone (no setVisible(true))
// suffices, read before Playwright connects (so its attach-time focus emulation does not mask the answer) and after.
//   (rb)  released, then parked as variant (b): removed from the window, setBounds 1280 x 800, setVisible(true)
//   (rs)  released, then parked by sizing alone: removed from the window, setBounds 1280 x 800, still hidden
//   (ns)  never attached, sized alone: setBounds 1280 x 800, hidden (E4a's created state plus bounds)
//   (re)  released, then moved into a hidden host window of its own (variant (e), the fallback)
// After (rb) the view is placed again in the shown window at a pane's rect, as a pane's claim unparks it.
//
// Launch (ELECTRON_RUN_AS_NODE unset): <repo>/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron
//   <worktree>/spikes/browser-probe/e4c/released.mjs
// Results: results/e4c/released.json. Scratch: /tmp/maws-e4c-t24/ (deleted after the run by the operator).
import { app, BrowserWindow, WebContentsView, session } from 'electron';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDebuggerBridge } from '../cdp/bridge.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(here, '..', 'results', 'e4c');
const resultsFile = join(resultsDir, 'released.json');
app.setPath('userData', '/tmp/maws-e4c-t24/userData');

const PORT = 17402;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PARTITION = 'persist:maws-e4c-probe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.timeOrigin + performance.now();
const round = (n) => Math.round(n);
const firstLine = (e) => (e?.message ?? String(e)).split('\n')[0];
const withTimeout = (p, ms, label) => Promise.race([p, sleep(ms).then(() => { throw new Error(`${label}: timed out after ${ms} ms`); })]);
const attempt = async (fn, ms, label) => {
  const t = now();
  try { return { ok: true, value: await withTimeout(fn(), ms, label), ms: round(now() - t) }; } catch (e) { return { ok: false, error: firstLine(e), ms: round(now() - t) }; }
};
const log = (...a) => console.log('[e4c-probe]', ...a);
const results = { meta: {}, variants: {} };
const save = () => writeFileSync(resultsFile, JSON.stringify(results, null, 2));

// ---- the loopback page --------------------------------------------------------------------------------------------
const PAGES = {
  '/button.html': `<!doctype html><title>E4c button</title><main><h1>Parking probe</h1><button id="b">Press</button><output id="n">0</output></main>
<script>document.getElementById('b').addEventListener('click', () => { const o = document.getElementById('n'); o.textContent = String(Number(o.textContent) + 1); });</script>`,
};
const server = createServer((req, res) => {
  const body = PAGES[new URL(req.url, ORIGIN).pathname];
  res.statusCode = body ? 200 : 404;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(body ?? 'not found');
});

// ---- the window (MAWS's shape) and the views (E4a's shape), as unplaced.mjs builds them --------------------------------
let win;
async function makeWindow() {
  win = new BrowserWindow({
    title: 'MAWS E4c probe', width: 1200, height: 800, show: false, backgroundColor: '#faf9f6', titleBarStyle: 'hiddenInset',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  await win.loadURL('data:text/html,<title>MAWS E4c probe</title><body style="font:14px system-ui">E4c probe window</body>');
  win.showInactive();
  win.setAlwaysOnTop(true, 'floating'); // on screen and unoccluded for the readings, without taking focus
  await sleep(300);
}
const tabPreferences = { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: true, safeDialogs: true };
function newView() {
  const view = new WebContentsView({ webPreferences: tabPreferences });
  view.setVisible(false); // E4a's ViewManager: "a new view is visible until told otherwise"
  return view;
}
async function load(view, path) {
  const wc = view.webContents;
  const done = new Promise((resolve, reject) => {
    wc.once('did-finish-load', resolve);
    wc.once('did-fail-load', (_e, code, desc) => reject(new Error(`load failed ${code} ${desc}`)));
  });
  wc.loadURL(ORIGIN + path).catch(() => {});
  await withTimeout(done, 10000, `load ${path}`);
}
function viewFacts(view) {
  const owner = view.webContents.getOwnerBrowserWindow();
  return { bounds: view.getBounds(), visible: view.getVisible(), ownerWindowId: owner ? owner.id : null, ownerIsProbeWindow: owner === win, inProbeWindow: win.contentView.children.includes(view) };
}
const pngSize = (buf) => (buf.length > 24 && buf.readUInt32BE(12) === 0x49484452 ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length } : { bytes: buf.length });

const RAF_PROBE = `new Promise((resolve) => { let frames = 0; const t0 = performance.now(); const tick = () => { frames++; if (performance.now() - t0 < 1000) requestAnimationFrame(tick); }; requestAnimationFrame(tick); setTimeout(() => resolve(frames), 1100); })`;

// Playwright through E0b's bridge: snapshot, a locator click (the counter must advance), a viewport screenshot.
async function readParking(view) {
  const out = { view: viewFacts(view) };
  const bridge = await startDebuggerBridge(view.webContents, {});
  const connect = await attempt(() => chromium.connectOverCDP(bridge.wsUrl, { timeout: 10000 }), 12000, 'connectOverCDP');
  if (!connect.ok) { out.connect = connect; await bridge.close(); return out; }
  const browser = connect.value;
  try {
    const page = browser.contexts()[0].pages()[0];
    out.state = await attempt(() => page.evaluate(() => ({ visibilityState: document.visibilityState, innerWidth, innerHeight })), 5000, 'state');
    out.rafFramesIn1s = await attempt(() => page.evaluate(RAF_PROBE), 3000, 'raf');
    const snap = await attempt(() => page.ariaSnapshot({ mode: 'ai', timeout: 5000 }), 7000, 'ariaSnapshot');
    out.snapshot = snap.ok ? { ok: true, chars: snap.value.length, hasButton: /button "Press" \[ref=e\d+\]/.test(snap.value), ms: snap.ms } : snap;
    const before = await page.evaluate(() => document.getElementById('n').textContent).catch(() => null);
    out.click = await attempt(() => page.locator('#b').click({ timeout: 5000 }), 7000, 'click');
    const after = await page.evaluate(() => document.getElementById('n').textContent).catch(() => null);
    out.click.counter = { before, after, advanced: before !== null && after !== null && Number(after) === Number(before) + 1 };
    const shot = await attempt(() => page.screenshot({ timeout: 5000, scale: 'css' }), 7000, 'screenshot');
    out.screenshot = shot.ok ? { ok: true, ...pngSize(shot.value), ms: shot.ms } : shot;
  } finally {
    await browser.close().catch(() => {});
    await bridge.close().catch(() => {});
  }
  out.passes = Boolean(out.snapshot?.ok && out.snapshot.hasButton && out.click?.ok && out.click.counter.advanced && out.screenshot?.ok && out.screenshot.width > 1 && out.screenshot.height > 1);
  return out;
}

function dispose(view, host) {
  if (host && !host.isDestroyed()) host.contentView.removeChildView(view);
  if (!view.webContents.isDestroyed()) view.webContents.close();
}

// What the page reads with no CDP client attached (no focus emulation from anyone).
async function bare(view) {
  const wc = view.webContents;
  const state = await attempt(() => wc.executeJavaScript('({ visibilityState: document.visibilityState, innerWidth, innerHeight })'), 3000, 'bare state');
  const raf = await attempt(() => wc.executeJavaScript(RAF_PROBE), 3000, 'bare raf');
  return { view: viewFacts(view), state, rafFramesIn1s: raf };
}

const PANE = { x: 40, y: 60, width: 900, height: 600 };
// Placed in the shown window and painted, then released as E4a's ViewManager releases it: hidden, still its child.
async function placedThenReleased(view) {
  win.contentView.addChildView(view);
  view.setBounds(PANE);
  view.setVisible(true);
  await load(view, '/button.html');
  await sleep(500);
  const placed = await bare(view);
  view.setVisible(false);
  await sleep(300);
  return placed;
}

async function variants() {
  const run = {
    rb: async (view) => {
      const placed = await placedThenReleased(view);
      win.contentView.removeChildView(view);
      view.setBounds({ x: 0, y: 0, width: 1280, height: 800 });
      view.setVisible(true);
      return { placed, host: null };
    },
    rs: async (view) => {
      const placed = await placedThenReleased(view);
      win.contentView.removeChildView(view);
      view.setBounds({ x: 0, y: 0, width: 1280, height: 800 });
      return { placed, host: null };
    },
    ns: async (view) => {
      view.setBounds({ x: 0, y: 0, width: 1280, height: 800 });
      await load(view, '/button.html');
      return { placed: null, host: null };
    },
    re: async (view) => {
      const placed = await placedThenReleased(view);
      win.contentView.removeChildView(view);
      const host = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { sandbox: true, contextIsolation: true } });
      host.contentView.addChildView(view);
      view.setBounds({ x: 0, y: 0, width: 1280, height: 800 });
      view.setVisible(true);
      return { placed, host, ownHost: true };
    },
  };
  for (const [name, apply] of Object.entries(run)) {
    log(`variant ${name}`);
    const view = newView();
    let host = null;
    let ownHost = false;
    const out = {};
    try {
      let placed;
      ({ placed, host, ownHost } = await apply(view));
      out.placed = placed;
      await sleep(300);
      out.parkedBare = await bare(view);
      out.parked = await withTimeout(readParking(view), 60000, `variant ${name}`);
      out.parkedBareAfterPlaywright = await bare(view);
      if (name === 'rb') {
        // a pane claims it: back into the shown window at the pane's rect (E4a's attach), visible
        win.contentView.addChildView(view);
        view.setBounds(PANE);
        view.setVisible(true);
        await sleep(300);
        out.unparkedOntoPane = await bare(view);
      }
    } catch (e) {
      out.error = firstLine(e);
    } finally {
      results.variants[name] = out;
      dispose(view, host);
      if (ownHost && host && !host.isDestroyed()) host.destroy();
    }
    save();
  }
}

async function main() {
  mkdirSync(resultsDir, { recursive: true });
  results.meta = { electron: process.versions.electron, chrome: process.versions.chrome, playwrightCore: require('playwright-core/package.json').version, startedAt: new Date().toISOString(), platform: `${process.platform} ${process.arch}` };
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  session.fromPartition(PARTITION).setPermissionRequestHandler((_wc, _p, cb) => cb(false));
  await makeWindow();
  results.meta.windowContent = win.getContentBounds();
  await variants();
  results.meta.finishedAt = new Date().toISOString();
  save();
  server.close();
  log('done');
  setTimeout(() => process.kill(process.pid, 'SIGKILL'), 3000).unref();
  app.exit(0);
}

const watchdog = setTimeout(() => { console.error('[e4c-probe] watchdog'); process.kill(process.pid, 'SIGKILL'); }, 180000);
watchdog.unref();
app.whenReady().then(main).catch((e) => { console.error(e); app.exit(1); });
app.on('window-all-closed', () => {});
