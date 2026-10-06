// (2), supplement five, after review: the earlier matrices never established that the probe window was on screen
// (NativeWindowMac::IsVisible in 44.4.5 returns `[window isVisible] && !(occlusionState == NSWindowOcclusionStateVisible)`,
// so the `windowVisible: true` they recorded means the occlusion state was not "visible"). This run pins the window
// above everything on the current Space without taking focus (floating level, visible on full-screen Spaces), reads
// the child view and the shell with nothing attached, then covers the window with a second window to see what
// occlusion does to each, then uncovers, then the setVisible cover. If the child is still hidden while on screen, the
// last step takes focus (app.focus({steal: true})) and reads again. Launch: Electron spikes/browser-probe/pass2/visibility5.mjs
import { app, BrowserWindow, WebContentsView } from 'electron';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
app.setPath('userData', '/tmp/maws-e4-0/userData-visibility5');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE = (bg) => `data:text/html,<title>v</title><body style="background:%23${bg};font:40px monospace"><div id="t">0</div><script>let n=0;setInterval(()=>{document.getElementById("t").textContent=String(++n)},100);</script></body>`;

async function probe(wc, label, frameWindowMs = 1000) {
  const visibility = await wc.executeJavaScript('document.visibilityState');
  const raf = await wc.executeJavaScript('new Promise(r => { let done = false; requestAnimationFrame(() => { done = true; r(true); }); setTimeout(() => { if (!done) r(false); }, 700); })');
  let frames = 0;
  try {
    wc.beginFrameSubscription(false, () => { frames++; });
    await sleep(frameWindowMs);
    wc.endFrameSubscription();
  } catch (e) { frames = `error: ${e.message.split('\n')[0]}`; }
  return { label, visibility, rafFires: raf, framesPresented: frames, inMs: frameWindowMs };
}
// win.isVisible() through 44.4.5's inverted occlusion test: false while shown means the occlusion state is "visible"
const windowState = (win) => ({ isVisibleApi: win.isVisible(), onScreenByInvertedTest: !win.isVisible(), isFocused: win.isFocused(), isAlwaysOnTop: win.isAlwaysOnTop(), bounds: win.getBounds() });

async function main() {
  const results = { electron: process.versions.electron, chrome: process.versions.chrome, steps: [] };
  const log = async (label, win, wc) => { const r = { ...(await probe(wc, label)), window: windowState(win) }; results.steps.push(r); console.log('[probe]', JSON.stringify(r)); return r; };

  const win = new BrowserWindow({ width: 700, height: 400, x: 80, y: 80, show: false, webPreferences: { sandbox: true } });
  await win.loadURL(PAGE('eee'));
  const view = new WebContentsView({ webPreferences: { sandbox: true } });
  win.contentView.addChildView(view);
  view.setBounds({ x: 350, y: 0, width: 350, height: 400 });
  const wc = view.webContents;
  await wc.loadURL(PAGE('cde'));
  // on screen, above everything, on whatever Space is current, without taking focus
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.showInactive();
  await sleep(800);
  await log('A: window pinned on screen (floating, all Spaces), shell renderer', win, win.webContents);
  await log('A: window pinned on screen, child view, nothing attached', win, wc);

  // occlusion control: a second window exactly over the first, one level higher
  const cover = new BrowserWindow({ width: 760, height: 460, x: 50, y: 50, show: false, webPreferences: { sandbox: true } });
  await cover.loadURL('data:text/html,<title>cover</title><body style="background:%23444;color:%23fff;font:20px system-ui">a window covering the probe window</body>');
  cover.setAlwaysOnTop(true, 'modal-panel');
  cover.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  cover.showInactive();
  await sleep(1200);
  await log('B: covered by another window, shell renderer', win, win.webContents);
  await log('B: covered by another window, child view', win, wc);
  cover.destroy();
  await sleep(1200);
  await log('C: uncovered again, shell renderer', win, win.webContents);
  await log('C: uncovered again, child view', win, wc);

  // the cover protocol while on screen
  view.setVisible(false);
  await sleep(500);
  await log('D: view.setVisible(false) while on screen, child view', win, wc);
  view.setVisible(true);
  await sleep(500);
  await log('D: view.setVisible(true) again, child view', win, wc);

  // a navigation while on screen
  await wc.loadURL(PAGE('dfd'));
  await sleep(600);
  await log('E: after a navigation while on screen, child view', win, wc);

  const last = results.steps[results.steps.length - 1];
  if (last.visibility !== 'visible') {
    app.focus({ steal: true });
    win.show();
    await sleep(800);
    await log('F: app.focus({steal: true}) + show(): child view', win, wc);
  } else {
    results.focusStealSkipped = 'the child was visible on screen without taking focus';
  }
  writeFileSync(join(here, '..', 'results', 'pass2', 'visibility5.json'), JSON.stringify(results, null, 2));
  console.log('[probe] visibility5 written');
  win.destroy();
  setTimeout(() => process.kill(process.pid, 'SIGKILL'), 3000).unref();
  app.exit(0);
}
app.whenReady().then(main).catch((e) => { console.error(e); app.exit(1); });
app.on('window-all-closed', () => {});
