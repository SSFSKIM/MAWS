// (2), supplement four: does Emulation.setFocusEmulationEnabled on the tab's debugger session (the one command of
// Playwright's attach that wakes a child WebContentsView's page, visibility3) hold across a same-site navigation, a
// cross-site process swap, a reload and the cover (setVisible false/true); and what it costs (document.hasFocus()).
// Two tiny sites (localhost and 127.0.0.1) serve the timer page. Launch: Electron spikes/browser-probe/pass2/visibility4.mjs
import { app, BrowserWindow, WebContentsView } from 'electron';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
app.setPath('userData', '/tmp/maws-e4-0/userData-visibility4');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE = '<!doctype html><title>v</title><body style="background:#cde;font:40px monospace"><div id="t">0</div><script>let n=0;setInterval(()=>{document.getElementById("t").textContent=String(++n)},100);</script></body>';
const servers = [];
const listen = (port, host) => new Promise((resolve) => { const s = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end(PAGE); }); s.listen(port, host, () => { servers.push(s); resolve(); }); });
const A = 'http://localhost:17344/';
const B = 'http://127.0.0.1:17345/';

async function probe(wc, label, frameWindowMs = 1000) {
  const visibility = await wc.executeJavaScript('document.visibilityState');
  const hasFocus = await wc.executeJavaScript('document.hasFocus()');
  const raf = await wc.executeJavaScript('new Promise(r => { let done = false; requestAnimationFrame(() => { done = true; r(true); }); setTimeout(() => { if (!done) r(false); }, 700); })');
  let frames = 0;
  try {
    wc.beginFrameSubscription(false, () => { frames++; });
    await sleep(frameWindowMs);
    wc.endFrameSubscription();
  } catch (e) { frames = `error: ${e.message.split('\n')[0]}`; }
  const r = { label, visibility, hasFocus, rafFires: raf, framesPresented: frames, inMs: frameWindowMs, processId: wc.mainFrame.processId, url: wc.getURL() };
  console.log('[probe]', JSON.stringify(r));
  return r;
}

async function main() {
  await listen(17344, '127.0.0.1'); await listen(17344, '::1'); await listen(17345, '127.0.0.1');
  const results = { electron: process.versions.electron, chrome: process.versions.chrome, steps: [] };
  const win = new BrowserWindow({ width: 700, height: 400, show: false, webPreferences: { sandbox: true } });
  await win.loadURL('data:text/html,<title>shell</title>shell');
  const view = new WebContentsView({ webPreferences: { sandbox: true } });
  win.contentView.addChildView(view);
  view.setBounds({ x: 350, y: 0, width: 350, height: 400 });
  win.showInactive();
  const wc = view.webContents;
  await wc.loadURL(A);
  await sleep(500);
  results.steps.push(await probe(wc, 'nothing attached, on A'));
  results.steps.push(await probe(win.webContents, "the window's own renderer (hasFocus baseline)", 300));
  wc.debugger.attach('1.3');
  await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  await sleep(300);
  results.steps.push(await probe(wc, 'debugger attached + Emulation.setFocusEmulationEnabled(true), on A'));
  await wc.loadURL(A + '?second');
  await sleep(500);
  results.steps.push(await probe(wc, 'after a same-site navigation (A -> A?second)'));
  await wc.loadURL(B);
  await sleep(500);
  results.steps.push(await probe(wc, 'after a cross-site navigation (A -> B, process swap)'));
  wc.reload();
  await sleep(700);
  results.steps.push(await probe(wc, 'after a reload on B'));
  view.setVisible(false);
  await sleep(300);
  results.steps.push(await probe(wc, 'cover: setVisible(false)'));
  view.setVisible(true);
  await sleep(300);
  results.steps.push(await probe(wc, 'cover lifted: setVisible(true)'));
  await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: false });
  await sleep(300);
  results.steps.push(await probe(wc, 'focus emulation switched off, debugger still attached'));
  await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  await sleep(300);
  results.steps.push(await probe(wc, 'focus emulation on again'));
  wc.debugger.detach();
  await sleep(300);
  results.steps.push(await probe(wc, 'debugger detached'));
  writeFileSync(join(here, '..', 'results', 'pass2', 'visibility4.json'), JSON.stringify(results, null, 2));
  console.log('[probe] visibility4 written');
  for (const s of servers) s.close();
  win.destroy();
  setTimeout(() => process.kill(process.pid, 'SIGKILL'), 3000).unref();
  app.exit(0);
}
app.whenReady().then(main).catch((e) => { console.error(e); app.exit(1); });
app.on('window-all-closed', () => {});
