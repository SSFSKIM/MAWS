// (2), supplement three: which attachment wakes a child WebContentsView's page. visibility2 showed the page presents
// no frames and gets no requestAnimationFrame with nothing attached, and that a bare webContents.debugger attach with
// Page.enable changes nothing; yet Playwright's clicks (which wait on rAF) worked in the input scenario. So: the full
// Playwright attach through the bridge, then the bare debugger with Playwright's enable sequence one command at a
// time, then setBackgroundThrottling(false) across a navigation. Launch: Electron spikes/browser-probe/pass2/visibility3.mjs
import { app, BrowserWindow, WebContentsView } from 'electron';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDebuggerBridge } from '../cdp/bridge.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const here = dirname(fileURLToPath(import.meta.url));
app.setPath('userData', '/tmp/maws-e4-0/userData-visibility3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE = 'data:text/html,<title>v</title><body style="background:%23cde;font:40px monospace"><div id="t">0</div><script>let n=0;setInterval(()=>{document.getElementById("t").textContent=String(++n)},100);</script></body>';

async function probe(wc, label, frameWindowMs = 1000) {
  const visibility = await wc.executeJavaScript('document.visibilityState');
  const raf = await wc.executeJavaScript('new Promise(r => { let done = false; requestAnimationFrame(() => { done = true; r(true); }); setTimeout(() => { if (!done) r(false); }, 700); })');
  let frames = 0;
  try {
    wc.beginFrameSubscription(false, () => { frames++; });
    await sleep(frameWindowMs);
    wc.endFrameSubscription();
  } catch (e) { frames = `error: ${e.message.split('\n')[0]}`; }
  const r = { label, visibility, rafFires: raf, framesPresented: frames, inMs: frameWindowMs };
  console.log('[probe]', JSON.stringify(r));
  return r;
}

async function main() {
  const results = { electron: process.versions.electron, chrome: process.versions.chrome, steps: [] };
  const win = new BrowserWindow({ width: 700, height: 400, show: false, webPreferences: { sandbox: true } });
  await win.loadURL('data:text/html,<title>shell</title>shell');
  const view = new WebContentsView({ webPreferences: { sandbox: true } });
  win.contentView.addChildView(view);
  view.setBounds({ x: 350, y: 0, width: 350, height: 400 });
  win.showInactive();
  const wc = view.webContents;
  await wc.loadURL(PAGE);
  await sleep(500);
  results.steps.push(await probe(wc, 'child view, nothing attached'));

  // A. the full Playwright attach through the bridge
  const bridge = await startDebuggerBridge(wc, { log: () => {} });
  const browser = await chromium.connectOverCDP(bridge.wsUrl);
  await sleep(300);
  results.steps.push(await probe(wc, 'A: Playwright connected through the bridge'));
  const page = browser.contexts()[0].pages()[0];
  results.steps[results.steps.length - 1].clickMs = page ? await (async () => { const t = performance.now(); await page.locator('#t').click({ timeout: 3000 }).catch(() => {}); return Math.round(performance.now() - t); })() : null;
  await browser.close();
  await bridge.close();
  await sleep(300);
  results.steps.push(await probe(wc, 'A: after Playwright disconnected and the bridge closed (debugger detached)'));

  // B. the bare debugger, Playwright's enable sequence one command at a time
  wc.debugger.attach('1.3');
  const sequence = [
    ['Page.enable', {}],
    ['Runtime.enable', {}],
    ['Page.setLifecycleEventsEnabled', { enabled: true }],
    ['Log.enable', {}],
    ['Network.enable', {}],
    ['Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }],
    ['Page.addScriptToEvaluateOnNewDocument', { source: '1' }],
    ['Page.setInterceptFileChooserDialog', { enabled: true }],
    ['Emulation.setFocusEmulationEnabled', { enabled: true }],
    ['Emulation.setDeviceMetricsOverride', { width: 0, height: 0, deviceScaleFactor: 0, mobile: false }],
    ['Page.captureScreenshot', {}],
  ];
  for (const [method, params] of sequence) {
    let error = null;
    try { await wc.debugger.sendCommand(method, params); } catch (e) { error = e.message.split('\n')[0]; }
    await sleep(150);
    const r = await probe(wc, `B: after ${method}`, 600);
    if (error) r.error = error;
    results.steps.push(r);
    if (r.rafFires) break;
  }
  try { await wc.debugger.sendCommand('Emulation.clearDeviceMetricsOverride'); } catch { /* not set */ }
  wc.debugger.detach();
  await sleep(300);
  results.steps.push(await probe(wc, 'B: after debugger detach'));

  // C. the workaround: setBackgroundThrottling(false), then a navigation
  wc.setBackgroundThrottling(false);
  await sleep(300);
  results.steps.push(await probe(wc, 'C: after setBackgroundThrottling(false)'));
  await wc.loadURL(PAGE.replace('%23cde', '%23dfd'));
  await sleep(500);
  results.steps.push(await probe(wc, 'C: after a navigation with backgroundThrottling off'));
  view.setVisible(false);
  await sleep(300);
  results.steps.push(await probe(wc, 'C: setVisible(false) with backgroundThrottling off (the cover)'));
  view.setVisible(true);
  await sleep(300);
  results.steps.push(await probe(wc, 'C: setVisible(true) again'));
  wc.setBackgroundThrottling(true);
  await sleep(1500);
  results.steps.push(await probe(wc, 'C: setBackgroundThrottling(true) again, 1.5 s later'));

  writeFileSync(join(here, '..', 'results', 'pass2', 'visibility3.json'), JSON.stringify(results, null, 2));
  console.log('[probe] visibility3 written');
  win.destroy();
  setTimeout(() => process.kill(process.pid, 'SIGKILL'), 3000).unref();
  app.exit(0);
}
app.whenReady().then(main).catch((e) => { console.error(e); app.exit(1); });
app.on('window-all-closed', () => {});
