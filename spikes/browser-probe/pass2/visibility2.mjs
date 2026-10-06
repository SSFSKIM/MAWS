// (2), supplement two: what brings a child WebContentsView's page to 'visible', and whether a 'hidden' page still
// paints. One BrowserWindow (MAWS's shape), one child view, a page whose timer updates text, and a frame subscription
// counting presented frames. Each step reads document.visibilityState, whether requestAnimationFrame fires, and the
// frames presented in a 1.5 s window. Launch: Electron spikes/browser-probe/pass2/visibility2.mjs
import { app, BrowserWindow, WebContentsView } from 'electron';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
app.setPath('userData', '/tmp/maws-e4-0/userData-visibility2');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE = 'data:text/html,<title>v</title><body style="background:%23cde;font:40px monospace"><div id="t">0</div><script>let n=0;setInterval(()=>{document.getElementById("t").textContent=String(++n)},100);</script></body>';

async function probe(wc, label) {
  const visibility = await wc.executeJavaScript('document.visibilityState');
  const raf = await wc.executeJavaScript('new Promise(r => { let done = false; requestAnimationFrame(() => { done = true; r(true); }); setTimeout(() => { if (!done) r(false); }, 1000); })');
  let frames = 0;
  try {
    wc.beginFrameSubscription(false, () => { frames++; });
    await sleep(1500);
    wc.endFrameSubscription();
  } catch (e) { frames = `error: ${e.message.split('\n')[0]}`; }
  const ticks = await wc.executeJavaScript('document.getElementById("t").textContent');
  return { label, visibility, rafFiresWithin1s: raf, framesPresentedIn1500ms: frames, timerTicksSoFar: Number(ticks) };
}

async function main() {
  const results = { electron: process.versions.electron, chrome: process.versions.chrome, steps: [] };
  const win = new BrowserWindow({ width: 700, height: 400, show: false, webPreferences: { sandbox: true } });
  await win.loadURL(PAGE.replace('%23cde', '%23eee'));
  const view = new WebContentsView({ webPreferences: { sandbox: true } });
  win.contentView.addChildView(view);
  view.setBounds({ x: 350, y: 0, width: 350, height: 400 });
  win.showInactive();
  const wc = view.webContents;
  await wc.loadURL(PAGE);
  await sleep(500);
  results.steps.push(await probe(win.webContents, "the window's own renderer (baseline)"));
  results.steps.push(await probe(wc, 'child view after load, nothing attached'));
  // the agent's attachment
  wc.debugger.attach('1.3');
  await wc.debugger.sendCommand('Page.enable');
  await sleep(300);
  results.steps.push(await probe(wc, 'child view with webContents.debugger attached and Page.enable'));
  wc.debugger.detach();
  await sleep(300);
  results.steps.push(await probe(wc, 'child view after debugger detach'));
  // Electron's un-hide path: setBackgroundThrottling(false) calls ShowWithVisibility(kHiddenButPainting) on a hidden widget
  wc.setBackgroundThrottling(false);
  await sleep(300);
  results.steps.push(await probe(wc, 'child view after setBackgroundThrottling(false)'));
  wc.setBackgroundThrottling(true);
  await sleep(300);
  results.steps.push(await probe(wc, 'child view after setBackgroundThrottling(true) again'));
  // a reload while attached to nothing
  await wc.loadURL(PAGE);
  await sleep(500);
  results.steps.push(await probe(wc, 'child view after a reload, nothing attached'));
  // the view hidden and shown through the cover protocol
  view.setVisible(false);
  await sleep(300);
  results.steps.push(await probe(wc, 'child view after setVisible(false)'));
  view.setVisible(true);
  await sleep(300);
  results.steps.push(await probe(wc, 'child view after setVisible(true)'));
  // a second window's own renderer, created shown, as the second baseline
  const win2 = new BrowserWindow({ width: 300, height: 200, show: true, webPreferences: { sandbox: true } });
  await win2.loadURL(PAGE);
  await sleep(500);
  results.steps.push(await probe(win2.webContents, 'a second BrowserWindow, show:true, its own renderer'));
  results.steps.push(await probe(wc, 'child view in the first window, after the second window opened'));
  win2.destroy();
  for (const s of results.steps) console.log('[probe]', JSON.stringify(s));
  writeFileSync(join(here, '..', 'results', 'pass2', 'visibility2.json'), JSON.stringify(results, null, 2));
  console.log('[probe] visibility2 written');
  win.destroy();
  setTimeout(() => process.kill(process.pid, 'SIGKILL'), 3000).unref();
  app.exit(0);
}
app.whenReady().then(main).catch((e) => { console.error(e); app.exit(1); });
app.on('window-all-closed', () => {});
