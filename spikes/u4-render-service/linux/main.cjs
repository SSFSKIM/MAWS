// U4's Linux half (P5 §13, O5's execution document): a windowless Electron render on a machine with no display. The
// app registers a privileged scheme and serves a fixture from memory (as src/main/artifacts/protocol.ts serves the
// store), renders it in an offscreen window with capture.ts's webPreferences, captures a PNG, prints a PDF with the
// page's own CSS size, tries the hidden-window fallback, then measures the process tree's idle memory and exits.
// Every step's outcome and timing goes into <out>/result.json; a step that fails is recorded, never fatal.
//
//   electron [--headless] [--no-sandbox] main.cjs --out <dir> [--fixture <dir>]
'use strict';
const { app, BrowserWindow, protocol, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(process.defaultApp ? 2 : 1);
const argOf = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const out = argOf('--out', path.join(process.cwd(), 'out'));
const fixtureDir = argOf('--fixture', __dirname);
fs.mkdirSync(out, { recursive: true });
// Each run keeps its Chromium profile under its own result directory, never Electron's default (~/Library/Application
// Support/Electron on a Mac, ~/.config/Electron on Linux), which the first mini run wrote; set before ready.
app.setPath('userData', path.join(out, 'userData'));
// The macOS half (../macos/run.sh): the render host's own line, an accessory app with no Dock icon, set before ready.
const accessory = args.includes('--accessory');
if (accessory && process.platform === 'darwin') app.setActivationPolicy('accessory');

const result = { argv: process.argv, env: { DISPLAY: process.env.DISPLAY ?? null, WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY ?? null, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? null, INVOCATION_ID: process.env.INVOCATION_ID ?? null }, steps: [], errors: [] };
const t0 = Date.now();
const save = () => fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
// Saved after every step and every failure, so a crash in a later step (round 1's GTK abort at the first window) still
// leaves what ran before it.
const step = (name, data) => { result.steps.push({ name, atMs: Date.now() - t0, ...data }); save(); };
const fail = (name, error) => { result.errors.push({ name, atMs: Date.now() - t0, message: error instanceof Error ? error.stack ?? error.message : String(error) }); save(); };

process.on('uncaughtException', (error) => { fail('uncaughtException', error); save(); });
process.on('unhandledRejection', (error) => { fail('unhandledRejection', error); save(); });

// The scheme, as the store's: standard, secure, streamed, CORS for fonts (STORE_SCHEME_PRIVILEGES in scheme-handler.ts).
const SCHEME = 'maws-probe';
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: true, stream: true } }]);

const CSP = [
  'sandbox allow-scripts', "default-src 'none'", "script-src 'unsafe-inline' 'unsafe-eval' data: blob:", "style-src 'unsafe-inline' data: blob:",
  'img-src data: blob:', 'font-src data: blob:', 'media-src data: blob:', 'connect-src data: blob:', 'worker-src blob:', "frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'",
].join('; ');

// The page's face is inlined as a data: URL, as the product's exporters inline a design system's faces (the store frame
// policy's `font-src data: blob:` admits no scheme load of a font; round 2 showed the fixture's scheme load blocked).
const fontDataUrl = () => `data:font/woff2;base64,${fs.readFileSync(path.join(fixtureDir, 'NotoSerifKR-Regular-full.woff2')).toString('base64')}`;
const files = {
  'index.html': { type: 'text/html; charset=utf-8', body: () => Buffer.from(fs.readFileSync(path.join(fixtureDir, 'fixture.html'), 'utf8').replace("url('assets/NotoSerifKR-Regular-full.woff2')", `url('${fontDataUrl()}')`), 'utf8') },
  'assets/NotoSerifKR-Regular-full.woff2': { type: 'font/woff2', body: () => fs.readFileSync(path.join(fixtureDir, 'NotoSerifKR-Regular-full.woff2')) },
};
// Electron quits on window-all-closed everywhere but macOS: the probe destroys its windows between steps and goes on.
app.on('window-all-closed', () => {});
// The scheme serves the fixture's files: `maws-probe://fixture/<path>`, the font with CORS as the artifact scheme does.
const serve = (request) => {
  const url = new URL(request.url);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const file = files[name];
  if (!file) return new Response('not found', { status: 404 });
  const headers = { 'Content-Type': file.type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Content-Security-Policy': CSP };
  return new Response(file.body(), { status: 200, headers });
};

function windowOf({ offscreen, javascript = true }) {
  const win = new BrowserWindow({
    show: false, width: 1280, height: 800, useContentSize: true,
    webPreferences: { offscreen, javascript, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, partition: 'maws-capture', backgroundThrottling: false, disableDialogs: true },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  return win;
}

// capture.ts's loadSettled: the load, then the first paint or 500 ms.
function loadSettled(win, url, guardMs = 20_000) {
  const contents = win.webContents;
  const consoleErrors = [];
  contents.on('console-message', (event) => { if (event.level === 'error' && consoleErrors.length < 20) consoleErrors.push(String(event.message).slice(0, 500)); });
  const loaded = new Promise((resolve, reject) => {
    const guard = setTimeout(() => reject(new Error(`the page did not finish loading within ${guardMs} ms`)), guardMs);
    contents.once('did-finish-load', () => { clearTimeout(guard); resolve(); });
    contents.on('did-fail-load', (_e, code, description, _url, isMainFrame) => { if (isMainFrame) { clearTimeout(guard); reject(new Error(`did-fail-load ${code} ${description}`)); } });
  });
  contents.loadURL(url).catch(() => {});
  return loaded.then(() => new Promise((resolve) => {
    const timer = setTimeout(() => { contents.off('paint', painted); resolve('settle-timeout'); }, 500);
    const painted = () => { clearTimeout(timer); resolve('paint'); };
    contents.once('paint', painted);
  })).then((settledBy) => ({ settledBy, consoleErrors }));
}

// How much of a PNG's bitmap is not the page background: a picture of a blank page reads near 0.
function coverage(image) {
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap(); // BGRA
  let dark = 0;
  const total = width * height;
  for (let i = 0; i < bitmap.length; i += 4) {
    const b = bitmap[i], g = bitmap[i + 1], r = bitmap[i + 2];
    if (r + g + b < 3 * 240) dark += 1;
  }
  return { width, height, bytes: bitmap.length, nonBackgroundFraction: total ? dark / total : 0 };
}

const countOf = (text, needle) => text.split(needle).length - 1;

async function renderOffscreen() {
  const started = Date.now();
  const win = windowOf({ offscreen: true });
  try {
    const url = `${SCHEME}://fixture/index.html`;
    const settled = await loadSettled(win, url);
    const fontsReady = await win.webContents.executeJavaScript('document.fonts.ready.then(() => ({ status: document.fonts.status, loaded: [...document.fonts].map((f) => `${f.family}:${f.status}`) }))');
    const metrics = await win.webContents.executeJavaScript('window.__probeMetrics ? window.__probeMetrics() : null');
    const image = await win.webContents.capturePage();
    const png = image.toPNG();
    fs.writeFileSync(path.join(out, 'offscreen.png'), png);
    step('offscreen capture', { ms: Date.now() - started, settledBy: settled.settledBy, consoleErrors: settled.consoleErrors, fonts: fontsReady, metrics, pngBytes: png.length, ...coverage(image) });

    // A whole-page PNG, as registerHtmlExporters's png does: the page measured, the window resized, captured again.
    const whole = Number(await win.webContents.executeJavaScript('Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)'));
    const height = Math.min(8192, Math.max(16, Math.ceil(whole)));
    const t = Date.now();
    win.setContentSize(1280, height);
    await new Promise((resolve) => { const timer = setTimeout(resolve, 500); win.webContents.once('paint', () => { clearTimeout(timer); resolve(); }); });
    const wholeImage = await win.webContents.capturePage();
    const wholePng = wholeImage.toPNG();
    fs.writeFileSync(path.join(out, 'offscreen-whole.png'), wholePng);
    step('offscreen whole-page capture', { ms: Date.now() - t, pageHeight: whole, pngBytes: wholePng.length, ...coverage(wholeImage) });

    const t2 = Date.now();
    const pdf = await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, generateDocumentOutline: true });
    fs.writeFileSync(path.join(out, 'offscreen.pdf'), pdf);
    const text = pdf.toString('latin1');
    step('offscreen printToPDF', { ms: Date.now() - t2, pdfBytes: pdf.length, header: text.slice(0, 8), pages: countOf(text, '/Type /Page\n') + countOf(text, '/Type /Page/') + countOf(text, '/Type/Page\n') + countOf(text, '/Type/Page/'), fontFiles: countOf(text, '/FontFile'), outline: text.includes('/Outlines') });
  } catch (error) {
    fail('offscreen', error);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

// The named fallback of capture.ts: a hidden window captured with stayHidden.
async function renderHidden() {
  const started = Date.now();
  let win;
  try {
    win = windowOf({ offscreen: false });
    const settled = await Promise.race([loadSettled(win, `${SCHEME}://fixture/index.html`), new Promise((_, reject) => setTimeout(() => reject(new Error('hidden window: no load within 20 s')), 20_000))]);
    win.webContents.incrementCapturerCount?.(undefined, true);
    const image = await win.webContents.capturePage(undefined, { stayHidden: true });
    const png = image.toPNG();
    fs.writeFileSync(path.join(out, 'hidden.png'), png);
    step('hidden-window capture', { ms: Date.now() - started, settledBy: settled.settledBy, pngBytes: png.length, ...coverage(image) });
  } catch (error) {
    fail('hidden', error);
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
  }
}

// The PDF printer's window (printHtmlToPdf): a non-offscreen hidden window, JavaScript off, printed.
async function printHidden() {
  const started = Date.now();
  let win;
  try {
    win = windowOf({ offscreen: false, javascript: false });
    await Promise.race([loadSettled(win, `${SCHEME}://fixture/index.html`), new Promise((_, reject) => setTimeout(() => reject(new Error('print window: no load within 20 s')), 20_000))]);
    const pdf = await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, generateDocumentOutline: true });
    fs.writeFileSync(path.join(out, 'hidden.pdf'), pdf);
    const text = pdf.toString('latin1');
    step('hidden-window printToPDF (no JS)', { ms: Date.now() - started, pdfBytes: pdf.length, fontFiles: countOf(text, '/FontFile') });
  } catch (error) {
    fail('print-hidden', error);
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
  }
}

function memory(label) {
  const metrics = app.getAppMetrics().map((m) => ({ type: m.type, pid: m.pid, name: m.name ?? null, serviceName: m.serviceName ?? null, workingSetKiB: Math.round(m.memory.workingSetSize), privateKiB: Math.round(m.memory.privateBytes ?? 0), cpu: m.cpu.percentCPUUsage }));
  const rssKiB = Math.round(process.memoryUsage().rss / 1024);
  const sumWorkingSetKiB = metrics.reduce((sum, m) => sum + m.workingSetKiB, 0);
  // /proc, the same way a unit's reader would sum a tree
  const statusRss = (pid) => { try { const m = /VmRSS:\s+(\d+) kB/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8')); return m ? Number(m[1]) : null; } catch { return null; } };
  const procRss = metrics.map((m) => ({ pid: m.pid, type: m.type, rssKiB: statusRss(m.pid) }));
  step(label, { rssKiB, sumWorkingSetKiB, sumProcRssKiB: procRss.reduce((s, p) => s + (p.rssKiB ?? 0), 0), processes: metrics, procRss });
}

app.whenReady().then(async () => {
  if (accessory && process.platform === 'darwin') { try { app.dock?.hide(); } catch (error) { fail('dock.hide', error); } }
  step('ready', { versions: process.versions, platform: process.platform, arch: process.arch, headless: app.commandLine.hasSwitch('headless'), noSandbox: app.commandLine.hasSwitch('no-sandbox'), gpu: app.getGPUFeatureStatus(), ozone: app.commandLine.getSwitchValue('ozone-platform') || null, accessory, dockVisible: process.platform === 'darwin' ? (() => { try { return app.dock?.isVisible() ?? null; } catch { return null; } })() : null });
  try {
    protocol.handle(SCHEME, serve);
    const { session } = require('electron');
    session.fromPartition('maws-capture').protocol.handle(SCHEME, serve);
  } catch (error) { fail('protocol.handle', error); }
  memory('memory after ready, before any window');
  await renderOffscreen();
  await renderHidden();
  await printHidden();
  save();
  memory('memory right after the renders (windows destroyed)');
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  memory('memory idle 10 s after the renders');
  save();
  app.exit(0);
}).catch((error) => { fail('whenReady', error); save(); app.exit(1); });
