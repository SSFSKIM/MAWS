// (2), supplement: why a WebContentsView layered over a BrowserWindow reports document.visibilityState 'hidden', and
// which construction order or call brings it to 'visible'. Each variant builds a fresh window, adds the view, loads a
// page in it, waits, and reads the page's visibility and whether requestAnimationFrame fires. Launch:
//   Electron spikes/browser-probe/pass2/visibility.mjs
import { app, BaseWindow, BrowserWindow, WebContentsView } from 'electron';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
app.setPath('userData', '/tmp/maws-e4-0/userData-visibility');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE = 'data:text/html,<title>v</title><body style="background:%23cde"><p>view</p></body>';

async function probe(wc) {
  const visibility = await wc.executeJavaScript('document.visibilityState');
  const raf = await wc.executeJavaScript('new Promise(r => { let done = false; requestAnimationFrame(() => { done = true; r(true); }); setTimeout(() => { if (!done) r(false); }, 1000); })');
  return { visibility, rafFiresWithin1s: raf };
}

const variants = [
  {
    name: 'BrowserWindow show:false, addChildView, then showInactive() (the pass-two probe and MAWS e2e)',
    async run() {
      const win = new BrowserWindow({ width: 600, height: 400, show: false, webPreferences: { sandbox: true } });
      const view = new WebContentsView({ webPreferences: { sandbox: true } });
      win.contentView.addChildView(view);
      view.setBounds({ x: 200, y: 0, width: 400, height: 400 });
      await win.loadURL('data:text/html,<title>shell</title>shell');
      win.showInactive();
      return { win, view };
    },
  },
  {
    name: 'BrowserWindow show:false, addChildView, then show() (active)',
    async run() {
      const win = new BrowserWindow({ width: 600, height: 400, show: false, webPreferences: { sandbox: true } });
      const view = new WebContentsView({ webPreferences: { sandbox: true } });
      win.contentView.addChildView(view);
      view.setBounds({ x: 200, y: 0, width: 400, height: 400 });
      await win.loadURL('data:text/html,<title>shell</title>shell');
      win.show();
      return { win, view };
    },
  },
  {
    name: 'BrowserWindow showInactive() first, then addChildView',
    async run() {
      const win = new BrowserWindow({ width: 600, height: 400, show: false, webPreferences: { sandbox: true } });
      await win.loadURL('data:text/html,<title>shell</title>shell');
      win.showInactive();
      await sleep(200);
      const view = new WebContentsView({ webPreferences: { sandbox: true } });
      win.contentView.addChildView(view);
      view.setBounds({ x: 200, y: 0, width: 400, height: 400 });
      return { win, view };
    },
  },
  {
    name: 'BrowserWindow showInactive(), view with backgroundThrottling:false',
    async run() {
      const win = new BrowserWindow({ width: 600, height: 400, show: false, webPreferences: { sandbox: true } });
      const view = new WebContentsView({ webPreferences: { sandbox: true, backgroundThrottling: false } });
      win.contentView.addChildView(view);
      view.setBounds({ x: 200, y: 0, width: 400, height: 400 });
      await win.loadURL('data:text/html,<title>shell</title>shell');
      win.showInactive();
      return { win, view };
    },
  },
  {
    name: 'BaseWindow show:true at construction, addChildView (pass one)',
    async run() {
      const win = new BaseWindow({ width: 600, height: 400, show: true });
      const view = new WebContentsView({ webPreferences: { sandbox: true } });
      win.contentView.addChildView(view);
      view.setBounds({ x: 0, y: 0, width: 600, height: 400 });
      return { win, view };
    },
  },
  {
    name: 'BaseWindow show:false, addChildView, showInactive()',
    async run() {
      const win = new BaseWindow({ width: 600, height: 400, show: false });
      const view = new WebContentsView({ webPreferences: { sandbox: true } });
      win.contentView.addChildView(view);
      view.setBounds({ x: 0, y: 0, width: 600, height: 400 });
      win.showInactive();
      return { win, view };
    },
  },
  {
    name: 'BrowserWindow show:true at construction, addChildView after ready-to-show',
    async run() {
      const win = new BrowserWindow({ width: 600, height: 400, show: true, webPreferences: { sandbox: true } });
      await win.loadURL('data:text/html,<title>shell</title>shell');
      await sleep(200);
      const view = new WebContentsView({ webPreferences: { sandbox: true } });
      win.contentView.addChildView(view);
      view.setBounds({ x: 200, y: 0, width: 400, height: 400 });
      return { win, view };
    },
  },
];

async function main() {
  const results = { electron: process.versions.electron, chrome: process.versions.chrome, variants: [] };
  for (const v of variants) {
    const r = { name: v.name };
    let win;
    try {
      const built = await v.run();
      win = built.win;
      const wc = built.view.webContents;
      await wc.loadURL(PAGE);
      await sleep(600);
      r.windowFocused = win.isFocused();
      r.windowVisible = win.isVisible();
      r.afterLoad = await probe(wc);
      if (r.afterLoad.visibility !== 'visible') {
        wc.focus();
        await sleep(300);
        r.afterWebContentsFocus = await probe(wc);
      }
      if ((r.afterWebContentsFocus ?? r.afterLoad).visibility !== 'visible') {
        built.view.setVisible(false);
        await sleep(100);
        built.view.setVisible(true);
        await sleep(300);
        r.afterSetVisibleToggle = await probe(wc);
      }
      if ((r.afterSetVisibleToggle ?? r.afterWebContentsFocus ?? r.afterLoad).visibility !== 'visible') {
        win.focus();
        await sleep(400);
        r.afterWindowFocus = await probe(wc);
        r.windowFocusedAfter = win.isFocused();
      }
      if ((r.afterWindowFocus ?? r.afterSetVisibleToggle ?? r.afterWebContentsFocus ?? r.afterLoad).visibility !== 'visible') {
        win.blur();
        await sleep(300);
        r.afterBlur = await probe(wc);
      }
    } catch (e) {
      r.error = e.stack ?? String(e);
    }
    results.variants.push(r);
    console.log('[probe]', JSON.stringify(r));
    if (win && !win.isDestroyed()) win.destroy();
    await sleep(200);
  }
  writeFileSync(join(here, '..', 'results', 'pass2', 'visibility.json'), JSON.stringify(results, null, 2));
  console.log('[probe] visibility written');
  setTimeout(() => process.kill(process.pid, 'SIGKILL'), 3000).unref();
  app.exit(0);
}
app.whenReady().then(main).catch((e) => { console.error(e); app.exit(1); });
app.on('window-all-closed', () => {});
