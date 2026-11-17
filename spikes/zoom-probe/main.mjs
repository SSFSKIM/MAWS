// The spike's Electron main (UX wave U6b-5b, M1): one job per launch, on the scratch profile given on the command line,
// each printing `RESULT {json}` lines (what was observed) and, for a job that is to be ended from outside, one `ZOOMED`
// line once the zoom is set. It imports nothing from src/: the window is made as `createWindow` makes the app's (a
// `file:` page, sandboxed, context-isolated, no Node), and a child view as the in-app browser makes a tab's (a
// `WebContentsView` in a partition of its own).
//
//   electron . --job=<zoom|standin|reload|show|windows|view|api> --profile=<dir> [--mode=<default|isolated>]
//              [--factor=<n>] [--end=<quit|hold>] [--way=<f0|f1|f2|f3>] [--move]
//
// zoom     the window in `--mode`, its page set to `--factor`; `--end=quit` quits, `--end=hold` waits to be killed
// standin  the window as a build that knows no zoom makes it: no zoom mode, no zoom call; reads the factor it opens at
// reload   isolated, set to `--factor`, then a reload and a load of the same file with another query (row e)
// show     one way of having `--factor` in force before the window is first shown (row f); f0 is the control at 1
// windows  three windows as a build opens them, the first set to 1.5 in `--mode` (row g)
// view     isolated at `--factor`, a child view of another partition placed over the page's box by decision 27's
//          rule (row h); with `--move`, moved to a display of another scale and back (row j)
// api      what the zoom-mode API answers (row i)
import { app, BrowserWindow, screen, WebContentsView } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const argv = Object.fromEntries(
  process.argv.filter((a) => a.startsWith('--')).map((a) => {
    const [k, ...v] = a.slice(2).split('=');
    return [k, v.length ? v.join('=') : true];
  }),
);
const job = String(argv.job);
const factor = argv.factor === undefined ? 1 : Number(argv.factor);
const PAGE = join(here, 'page', 'index.html');
const OTHER = join(here, 'page', 'other.html');
app.setPath('userData', String(argv.profile));

const result = (part, observed) => console.log(`RESULT ${JSON.stringify({ job, part, ...observed })}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (n, places = 4) => Math.round(n * 10 ** places) / 10 ** places;

// The window as `createWindow` (src/main/window.ts) makes the app's, less what the probe does not need (a preload, the
// traffic lights' position): shown when ready, unless the job shows it itself.
function makeWindow({ mode = null, show = true, zoomFactor = null, width = 900, height = 640 } = {}) {
  const webPreferences = { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true };
  if (mode) webPreferences.zoomMode = mode;
  if (zoomFactor !== null) webPreferences.zoomFactor = zoomFactor;
  const win = new BrowserWindow({ width, height, show: false, backgroundColor: '#ffffff', webPreferences });
  if (show) win.once('ready-to-show', () => win.show());
  return win;
}
const loaded = (wc) => new Promise((resolve) => wc.once('did-finish-load', resolve));
const evaluate = (wc, code) => wc.executeJavaScript(code, true);
// The page's own view of its zoom: devicePixelRatio over the display's scale.
async function pageZoom(win) {
  const dpr = await evaluate(win.webContents, 'window.devicePixelRatio');
  const scale = screen.getDisplayMatching(win.getBounds()).scaleFactor;
  return { dpr, scale, zoom: round(dpr / scale) };
}
// Until the page reflects `want` (its devicePixelRatio is the display's scale times it), at most `ms`: a zoom call
// returns before the renderer has laid the page out again. Answers whether it did.
async function untilPageAt(win, want, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (Math.abs((await pageZoom(win)).zoom - want) < 0.01) return true;
    await sleep(50);
  }
  return false;
}
// The page's next painted frame, at most `ms` (a window never shown may not run animation frames).
const nextFrame = (wc, ms = 2000) =>
  Promise.race([
    evaluate(wc, 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))'),
    sleep(ms).then(() => false),
  ]);
const boxRect = (wc) => evaluate(wc, 'JSON.parse(JSON.stringify(document.getElementById("box").getBoundingClientRect()))');
// Decision 27: each edge multiplied by the factor and rounded to a point; the size is the difference.
function scaled(r, f) {
  const x = Math.round(r.left * f);
  const y = Math.round(r.top * f);
  return { x, y, width: Math.round(r.right * f) - x, height: Math.round(r.bottom * f) - y };
}
function mode(wc) {
  return typeof wc.getZoomMode === 'function' ? wc.getZoomMode() : null;
}

// The height in DIP of the page's red ink (its one line of text) in a capture; null when the capture is empty or holds none.
function inkHeight(image) {
  if (image.isEmpty()) return null;
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap(); // BGRA
  const scale = Math.sqrt(bitmap.length / 4 / (width * height));
  const [pw, ph] = [Math.round(width * scale), Math.round(height * scale)];
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const i = (y * pw + x) * 4;
      if (bitmap[i + 2] > 170 && bitmap[i + 1] < 90 && bitmap[i] < 90) {
        if (top < 0) top = y;
        bottom = y;
        break;
      }
    }
  }
  return top < 0 ? null : round((bottom - top + 1) / scale, 2);
}

const jobs = {
  // rows a to d, the zooming launch
  async zoom() {
    const win = makeWindow({ mode: argv.mode === 'isolated' ? 'isolated' : null });
    const ready = loaded(win.webContents);
    void win.loadFile(PAGE);
    await ready;
    win.webContents.setZoomFactor(factor);
    const reflected = await untilPageAt(win, factor);
    result('zoomed', { mode: argv.mode, asked: factor, factor: win.webContents.getZoomFactor(), zoomMode: mode(win.webContents), pageReflects: reflected, page: await pageZoom(win), url: win.webContents.getURL() });
    console.log('ZOOMED');
    if (argv.end === 'quit') app.quit();
  },

  // rows a to d, the stand-in: no zoom mode, no zoom call, the same file URL on the same profile
  async standin() {
    const win = makeWindow();
    const ready = loaded(win.webContents);
    void win.loadFile(PAGE);
    await ready;
    await nextFrame(win.webContents);
    result('opened', { factor: win.webContents.getZoomFactor(), page: await pageZoom(win), url: win.webContents.getURL() });
    app.quit();
  },

  // row e
  async reload() {
    const win = makeWindow({ mode: 'isolated' });
    let ready = loaded(win.webContents);
    void win.loadFile(PAGE);
    await ready;
    win.webContents.setZoomFactor(factor);
    await untilPageAt(win, factor);
    const set = win.webContents.getZoomFactor();
    ready = loaded(win.webContents);
    win.webContents.reload();
    await ready;
    await nextFrame(win.webContents);
    const afterReload = { factor: win.webContents.getZoomFactor(), page: await pageZoom(win) };
    ready = loaded(win.webContents);
    void win.loadFile(PAGE, { query: { another: '1' } });
    await ready;
    await nextFrame(win.webContents);
    const afterLoad = { factor: win.webContents.getZoomFactor(), page: await pageZoom(win), url: win.webContents.getURL() };
    result('loads', { asked: factor, set, afterReload, afterLoad });
    app.quit();
  },

  // row f: f0 the control (no zoom), f1 the web preference, f2 a call at dom-ready, f3 a call at ready-to-show and the
  // show at the next painted frame
  async show() {
    const way = String(argv.way);
    const win = makeWindow({ mode: 'isolated', show: false, zoomFactor: way === 'f1' ? factor : null });
    const seen = { way, asked: way === 'f0' ? 1 : factor };
    win.webContents.once('dom-ready', () => {
      if (way === 'f2') win.webContents.setZoomFactor(factor);
      seen.atDomReady = win.webContents.getZoomFactor();
    });
    const shown = new Promise((resolve) => win.once('show', resolve));
    win.once('ready-to-show', async () => {
      seen.atReadyToShow = win.webContents.getZoomFactor();
      if (way === 'f3') {
        win.webContents.setZoomFactor(factor);
        seen.frameBeforeShow = await nextFrame(win.webContents);
      }
      win.show();
    });
    void win.loadFile(PAGE);
    await shown;
    seen.atShow = win.webContents.getZoomFactor();
    const first = await win.webContents.capturePage();
    seen.inkAtShow = inkHeight(first);
    seen.captureAtShowEmpty = first.isEmpty();
    // the same measure once the page has settled, for the control to compare against
    await untilPageAt(win, seen.asked);
    await nextFrame(win.webContents);
    seen.inkSettled = inkHeight(await win.webContents.capturePage());
    seen.page = await pageZoom(win);
    result('shown', seen);
    app.quit();
  },

  // row g: the page, the same file with another query (the presenter's shape), another file (the repair page's shape)
  async windows() {
    const isolated = argv.mode === 'isolated';
    const open = async (file, query) => {
      const win = makeWindow({ mode: file === PAGE && !query && isolated ? 'isolated' : null });
      const ready = loaded(win.webContents);
      void win.loadFile(file, query ? { query } : {});
      await ready;
      return win;
    };
    const first = await open(PAGE);
    const present = await open(PAGE, { present: '1' });
    const repair = await open(OTHER);
    first.webContents.setZoomFactor(1.5);
    await untilPageAt(first, 1.5);
    await sleep(500); // a shared zoom reaches the other pages of the host through the browser process
    const openBefore = { present: present.webContents.getZoomFactor(), repair: repair.webContents.getZoomFactor() };
    const presentAfter = await open(PAGE, { present: '2' });
    const repairAfter = await open(OTHER);
    await nextFrame(repairAfter.webContents);
    const openedAfter = { present: presentAfter.webContents.getZoomFactor(), repair: repairAfter.webContents.getZoomFactor() };
    result('others', { mode: argv.mode, first: first.webContents.getZoomFactor(), openBefore, openedAfter });
    app.quit();
  },

  // rows h and j
  async view() {
    const win = makeWindow({ mode: 'isolated', width: 1000, height: 700 });
    const ready = loaded(win.webContents);
    void win.loadFile(PAGE);
    await ready;
    win.webContents.setZoomFactor(factor);
    await untilPageAt(win, factor);
    const view = new WebContentsView({ webPreferences: { partition: 'zoom-probe-tab', sandbox: true, contextIsolation: true } });
    win.contentView.addChildView(view);
    const viewReady = loaded(view.webContents);
    void view.webContents.loadURL('data:text/html,<body style="margin:0;background:%23cfe">a page of another partition</body>');
    await viewReady;
    const box = await boxRect(win.webContents);
    const want = scaled(box, factor);
    view.setBounds(want);
    await nextFrame(view.webContents);
    const read = async () => ({
      appFactor: win.webContents.getZoomFactor(),
      page: await pageZoom(win),
      box: await boxRect(win.webContents),
      viewFactor: view.webContents.getZoomFactor(),
      viewBounds: view.getBounds(),
      viewInner: await evaluate(view.webContents, '({ width: innerWidth, height: innerHeight })'),
      display: screen.getDisplayMatching(win.getBounds()).id,
    });
    const placed = await read();
    result('placed', { factor, want, ...placed });
    if (!argv.move) return app.quit();

    // row j: to a display of another scale and back
    const from = screen.getDisplayMatching(win.getBounds());
    const other = screen.getAllDisplays().find((d) => d.id !== from.id && d.scaleFactor !== from.scaleFactor);
    if (!other) {
      result('moved', { notRun: true, displays: screen.getAllDisplays().map((d) => ({ id: d.id, scale: d.scaleFactor })) });
      return app.quit();
    }
    const moveTo = async (display) => {
      win.setPosition(display.workArea.x + 40, display.workArea.y + 40);
      const end = Date.now() + 5000;
      while (Date.now() < end && screen.getDisplayMatching(win.getBounds()).id !== display.id) await sleep(50);
      // the page's devicePixelRatio follows the display once Chromium has the new screen info
      const settled = await untilPageAt(win, factor, 5000);
      await nextFrame(win.webContents);
      return { settled, ...(await read()), againstBox: { want: scaled(await boxRect(win.webContents), factor), bounds: view.getBounds() } };
    };
    const there = await moveTo(other);
    const back = await moveTo(from);
    result('moved', { factor, from: { id: from.id, scale: from.scaleFactor }, to: { id: other.id, scale: other.scaleFactor }, before: placed, there, back });
    app.quit();
  },

  // row i
  async api() {
    const win = makeWindow({ mode: 'isolated' });
    const ready = loaded(win.webContents);
    void win.loadFile(PAGE);
    await ready;
    const wc = win.webContents;
    result('api', { setZoomMode: typeof wc.setZoomMode, getZoomMode: typeof wc.getZoomMode, mode: mode(wc), electron: process.versions.electron });
    app.quit();
  },
};

process.on('unhandledRejection', (error) => {
  result('error', { error: String(error?.stack ?? error) });
  app.exit(1);
});
app.on('window-all-closed', () => {}); // each job quits itself
app.whenReady().then(() => {
  if (!jobs[job]) {
    result('error', { error: `no job ${job}` });
    return app.exit(2);
  }
  return jobs[job]();
}).catch((error) => {
  result('error', { error: String(error?.stack ?? error) });
  app.exit(1);
});
