// (2), E4a M0's discriminating supplement: visibility2's last step read a child view hidden after a second window opened
// (show: true, centered, partly over the first, taking focus) on an unlocked display. This run separates the causes: a
// second window of the app taking focus while clear of the first, the same window partly over the first, and both again
// with showInactive; each step reads the first window's own renderer AND its child view, with both windows' bounds and
// focus. Launch: Electron spikes/browser-probe/pass2/visibility6.mjs
import { app, BrowserWindow, WebContentsView, screen } from 'electron';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
app.setPath('userData', '/tmp/maws-e4a/userData-visibility6');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE = (bg) => `data:text/html,<title>v</title><body style="background:%23${bg};font:40px monospace"><div id="t">0</div><script>let n=0;setInterval(()=>{document.getElementById("t").textContent=String(++n)},100);</script></body>`;

async function read(wc) {
  const visibility = await wc.executeJavaScript('document.visibilityState');
  const raf = await wc.executeJavaScript('new Promise(r => { let done = false; requestAnimationFrame(() => { done = true; r(true); }); setTimeout(() => { if (!done) r(false); }, 700); })');
  let frames = 0;
  try {
    wc.beginFrameSubscription(false, () => { frames++; });
    await sleep(1000);
    wc.endFrameSubscription();
  } catch (e) { frames = `error: ${e.message.split('\n')[0]}`; }
  return { visibility, rafFires: raf, framesPresented: frames };
}

const state = (w) => (w && !w.isDestroyed() ? { bounds: w.getBounds(), isFocused: w.isFocused(), isVisibleApi: w.isVisible() } : null);

async function main() {
  const results = { electron: process.versions.electron, chrome: process.versions.chrome, steps: [] };
  const wa = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({ x: wa.x + 40, y: wa.y + 40, width: 700, height: 400, show: false, webPreferences: { sandbox: true } });
  await win.loadURL(PAGE('eee'));
  const view = new WebContentsView({ webPreferences: { sandbox: true } });
  win.contentView.addChildView(view);
  view.setBounds({ x: 350, y: 0, width: 350, height: 400 });
  win.showInactive();
  await view.webContents.loadURL(PAGE('cde'));
  await sleep(600);
  let win2 = null;
  const step = async (label) => {
    await sleep(600);
    const s = { label, shell: await read(win.webContents), child: await read(view.webContents), win: state(win), win2: state(win2) };
    console.log('[probe]', JSON.stringify(s));
    results.steps.push(s);
  };
  await step('baseline: first window shown inactive, alone');
  const clear = { x: wa.x + wa.width - 340, y: wa.y + wa.height - 240, width: 300, height: 200 };
  const over = { x: wa.x + 40 + 450, y: wa.y + 40 + 100, width: 300, height: 200 }; // partly over the child's right half
  win2 = new BrowserWindow({ ...clear, show: true, webPreferences: { sandbox: true } });
  await win2.loadURL(PAGE('fed'));
  await step('second window show:true (focused), clear of the first');
  win2.setBounds(over);
  await step('the same focused second window, moved partly over the child');
  win2.destroy();
  win2 = null;
  await step('second window destroyed');
  win2 = new BrowserWindow({ ...clear, show: false, webPreferences: { sandbox: true } });
  await win2.loadURL(PAGE('fed'));
  win2.showInactive();
  await step('second window showInactive, clear of the first');
  win2.setBounds(over);
  await step('the inactive second window moved partly over the child');
  win2.destroy();
  win2 = null;
  win.focus();
  await step('second window destroyed, first focused');
  writeFileSync(join(here, '..', 'results', 'pass2', 'visibility6-onscreen.json'), JSON.stringify(results, null, 2));
  console.log('[probe] visibility6 written');
  win.destroy();
  setTimeout(() => process.kill(process.pid, 'SIGKILL'), 3000).unref();
  app.exit(0);
}
app.whenReady().then(main).catch((e) => { console.error(e); app.exit(1); });
app.on('window-all-closed', () => {});
