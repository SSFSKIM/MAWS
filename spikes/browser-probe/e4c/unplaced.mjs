// E4c M0 Task 0.3 (docs/doperpowers/plans/2026-10-06-e4c-browser-tools.md, Design §9, Decision Log 7, 33, 34): the
// unplaced-view probe. Findings only, never product code.
//
// Parking (variants a to e): a tab E4a created but no pane placed. For each variant a fresh WebContentsView, built as
// E4a builds a tab's (src/main/browser/view.ts: its webPreferences, `setVisible(false)` at creation, no initial bounds),
// loads a loopback page with a button and a counter; Playwright connects through E0b's bridge (cdp/bridge.mjs) and reads
// visibilityState, requestAnimationFrame within 1 s, the viewport, ariaSnapshot's length, a locator click (5 s; the
// counter must advance) and a viewport screenshot's decoded size.
//   (a) never attached, as E4a leaves it          (b) never attached, setBounds 1280 x 800 and setVisible(true)
//   (c) attached to the shown window, visible, at x = the content width (off the content area)
//   (d) as (c) then setVisible(false) (the known-paused control)
//   (e) attached to a hidden host window of its own (show: false, 1280 x 800), visible, at (0, 0, 1280, 800)
// Dialogs (variant f): alert/confirm/prompt on a placed view and on a never-attached one, read three ways: CDP alone
// (Page.javascriptDialogOpening, Page.handleJavaScriptDialog), Playwright with and without a `dialog` listener, and a
// wrap of Electron's own `-run-dialog` listener (lib/browser/api/web-contents.ts in Electron 44.4.5). The last step, a
// never-attached view's alert with Electron's own handler (which shows a parentless NSAlert through `runModal`), runs
// under a watchdog that kills this process; every result is written before it.
//
// Launch (ELECTRON_RUN_AS_NODE unset): <repo>/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron
//   <worktree>/spikes/browser-probe/e4c/unplaced.mjs [--skip-native=1]
// Results: results/e4c/unplaced.json. Scratch: /tmp/maws-e4c/ (deleted after the run by the operator).
import { app, BrowserWindow, WebContentsView, session } from 'electron';
import { spawn } from 'node:child_process';
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
const resultsFile = join(resultsDir, 'unplaced.json');
const args = Object.fromEntries(process.argv.slice(1).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
app.setPath('userData', '/tmp/maws-e4c/userData');

const PORT = 17401;
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
const results = { meta: {}, parking: {}, dialogs: {} };
const save = () => writeFileSync(resultsFile, JSON.stringify(results, null, 2));

// ---- the loopback pages -------------------------------------------------------------------------------------------
const PAGES = {
  '/button.html': `<!doctype html><title>E4c button</title><main><h1>Parking probe</h1><button id="b">Press</button><output id="n">0</output></main>
<script>document.getElementById('b').addEventListener('click', () => { const o = document.getElementById('n'); o.textContent = String(Number(o.textContent) + 1); });</script>`,
  '/dialog.html': '<!doctype html><title>E4c dialogs</title><main><h1>Dialogs probe</h1></main>',
};
const server = createServer((req, res) => {
  const body = PAGES[new URL(req.url, ORIGIN).pathname];
  res.statusCode = body ? 200 : 404;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(body ?? 'not found');
});

// ---- the window (MAWS's shape) and the views (E4a's shape) ------------------------------------------------------------
let win;
const sheets = [];
async function makeWindow() {
  win = new BrowserWindow({
    title: 'MAWS E4c probe', width: 1200, height: 800, show: false, backgroundColor: '#faf9f6', titleBarStyle: 'hiddenInset',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.on('sheet-begin', () => sheets.push({ event: 'sheet-begin', at: now() }));
  win.on('sheet-end', () => sheets.push({ event: 'sheet-end', at: now() }));
  await win.loadURL('data:text/html,<title>MAWS E4c probe</title><body style="font:14px system-ui">E4c probe window</body>');
  win.showInactive();
  win.setAlwaysOnTop(true, 'floating'); // on screen and unoccluded for the readings, without taking focus (E4-0's --front)
  await sleep(300);
}
// tabWebPreferences() of src/main/browser/view.ts, without the preload (it exposes nothing in E4a)
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
  return { bounds: view.getBounds(), visible: view.getVisible(), ownerWindowId: owner ? owner.id : null, ownerIsProbeWindow: owner === win };
}
const pngSize = (buf) => (buf.length > 24 && buf.readUInt32BE(12) === 0x49484452 ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length } : { bytes: buf.length });

// ---- parking ------------------------------------------------------------------------------------------------------
const RAF_PROBE = `new Promise((resolve) => { let frames = 0; const t0 = performance.now(); const tick = () => { frames++; if (performance.now() - t0 < 1000) requestAnimationFrame(tick); }; requestAnimationFrame(tick); setTimeout(() => resolve(frames), 1100); })`;
async function readParking(view) {
  const out = { view: viewFacts(view) };
  const t = now();
  const bridge = await startDebuggerBridge(view.webContents, {});
  const connect = await attempt(() => chromium.connectOverCDP(bridge.wsUrl, { timeout: 10000 }), 12000, 'connectOverCDP');
  out.connectMs = round(now() - t);
  if (!connect.ok) { out.connect = connect; await bridge.close(); return out; }
  const browser = connect.value;
  try {
    const page = browser.contexts()[0].pages()[0];
    out.state = await attempt(() => page.evaluate(() => ({ visibilityState: document.visibilityState, hidden: document.hidden, hasFocus: document.hasFocus(), innerWidth, innerHeight })), 5000, 'state');
    out.rafFramesIn1s = await attempt(() => page.evaluate(RAF_PROBE), 3000, 'raf');
    const snap = await attempt(() => page.ariaSnapshot({ mode: 'ai', timeout: 5000 }), 7000, 'ariaSnapshot');
    out.snapshot = snap.ok ? { ok: true, chars: snap.value.length, hasButton: /button "Press" \[ref=e\d+\]/.test(snap.value), ms: snap.ms } : snap;
    const before = await page.evaluate(() => document.getElementById('n').textContent).catch(() => null);
    out.click = await attempt(() => page.locator('#b').click({ timeout: 5000 }), 7000, 'click');
    const after = await page.evaluate(() => document.getElementById('n').textContent).catch(() => null);
    out.click.counter = { before, after, advanced: before !== null && after !== null && Number(after) === Number(before) + 1 };
    const shot = await attempt(() => page.screenshot({ timeout: 5000 }), 7000, 'screenshot');
    out.screenshot = shot.ok ? { ok: true, ...pngSize(shot.value), ms: shot.ms } : shot;
    out.stateAfter = await attempt(() => page.evaluate(() => ({ visibilityState: document.visibilityState, innerWidth, innerHeight })), 3000, 'stateAfter');
    out.view.after = viewFacts(view);
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
async function parking() {
  const content = win.getContentBounds();
  results.meta.windowContent = content;
  const variants = {
    a: async (view) => ({ host: null }),
    b: async (view) => { view.setBounds({ x: 0, y: 0, width: 1280, height: 800 }); view.setVisible(true); return { host: null }; },
    c: async (view) => { win.contentView.addChildView(view); view.setBounds({ x: content.width, y: 0, width: 1280, height: 800 }); view.setVisible(true); return { host: win }; },
    d: async (view) => { win.contentView.addChildView(view); view.setBounds({ x: content.width, y: 0, width: 1280, height: 800 }); view.setVisible(true); await sleep(200); view.setVisible(false); return { host: win }; },
    e: async (view) => {
      const host = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { sandbox: true, contextIsolation: true } });
      host.contentView.addChildView(view);
      view.setBounds({ x: 0, y: 0, width: 1280, height: 800 });
      view.setVisible(true);
      return { host, ownHost: true };
    },
  };
  for (const [name, apply] of Object.entries(variants)) {
    log(`parking ${name}`);
    const view = newView();
    let host = null;
    let ownHost = false;
    try {
      // the page loads in the variant's state, as a tab's load would (the agent's open creates and loads the view)
      ({ host, ownHost } = await apply(view));
      await load(view, '/button.html');
      await sleep(300);
      results.parking[name] = await withTimeout(readParking(view), 60000, `variant ${name}`);
    } catch (e) {
      results.parking[name] = { error: firstLine(e) };
    } finally {
      dispose(view, host);
      if (ownHost && host && !host.isDestroyed()) host.destroy();
    }
    save();
  }
  const first = ['a', 'b', 'c', 'e'].find((name) => results.parking[name]?.passes);
  results.parking.verdict = first ?? null;
  save();
}

// ---- dialogs ------------------------------------------------------------------------------------------------------
// Raw CDP on the view's debugger: Page enabled, the dialog events recorded, optionally answered after `answerAfterMs`.
function cdpWatch(wc, { answer = null, answerAfterMs = 300 } = {}) {
  const events = [];
  const onMessage = (_e, method, params, sessionId) => {
    if (!method.startsWith('Page.javascriptDialog')) return;
    events.push({ method, type: params.type, message: params.message, hasBrowserHandler: params.hasBrowserHandler, defaultPrompt: params.defaultPrompt, result: params.result, userInput: params.userInput, sessionId: sessionId || '', at: now() });
    if (method === 'Page.javascriptDialogOpening' && answer) {
      setTimeout(() => {
        const t = now();
        wc.debugger.sendCommand('Page.handleJavaScriptDialog', answer(params))
          .then(() => events.push({ method: 'handleJavaScriptDialog', ok: true, at: t }))
          .catch((e) => events.push({ method: 'handleJavaScriptDialog', ok: false, error: firstLine(e), at: t }));
      }, answerAfterMs);
    }
  };
  wc.debugger.on('message', onMessage);
  return { events, stop: () => wc.debugger.removeListener('message', onMessage) };
}
async function enablePage(wc) {
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
  await wc.debugger.sendCommand('Page.enable');
}
// Runs `expression` in the page (it blocks while a dialog is open); reports when it returned and what, and the sheets.
async function runDialog(wc, expression, waitMs = 2500) {
  const sheetMark = sheets.length;
  const t0 = now();
  let returned = null;
  const call = wc.executeJavaScript(expression).then((value) => { returned = { value, afterMs: round(now() - t0) }; }, (e) => { returned = { error: firstLine(e), afterMs: round(now() - t0) }; });
  await Promise.race([call, sleep(waitMs)]);
  await sleep(400); // a sheet-end that follows the page's return
  return { expression, returned, pageBlocked: returned === null, sheets: sheets.slice(sheetMark).map((s) => ({ event: s.event, atMs: round(s.at - t0) })) };
}
const rel = (events, t0) => events.map((e) => ({ ...e, at: round(e.at - t0) }));
// After a step that may leave Electron's sheet up: a reload cancels the page's dialogs (`-cancel-dialogs`), which
// aborts the message box (`CloseMessageBox`), so the window is clean for the next step.
async function cleanUp(view) {
  const sheetMark = sheets.length;
  const open = sheets.filter((s) => s.event === 'sheet-begin').length - sheets.filter((s) => s.event === 'sheet-end').length;
  if (open <= 0) return { openSheets: 0 };
  view.webContents.reload();
  await sleep(1500);
  return { openSheets: open, afterReload: sheets.slice(sheetMark).map((s) => s.event), reloadClosedIt: sheets.slice(sheetMark).some((s) => s.event === 'sheet-end') };
}
// The rule Decision Log 33 states, applied at Electron's own `-run-dialog`: alert dismissed, confirm false, prompt
// accepted with its default text. Electron's listeners are kept and restored; `delegate` hands a call to them.
function wrapRunDialog(wc, decide) {
  const original = wc.listeners('-run-dialog');
  const seen = [];
  wc.removeAllListeners('-run-dialog');
  const listener = (info, callback) => {
    seen.push({ dialogType: info.dialogType, messageText: info.messageText, defaultPromptText: info.defaultPromptText, frameUrl: info.frame?.url ?? null, at: now() });
    const decision = decide(info);
    if (decision === 'delegate') { for (const l of original) l.call(wc, info, callback); return; }
    callback(decision.accept, decision.text);
  };
  wc.on('-run-dialog', listener);
  return { originalCount: original.length, seen, restore: () => { wc.removeListener('-run-dialog', listener); for (const l of original) wc.on('-run-dialog', l); } };
}
const RULE = (info) => (info.dialogType === 'prompt' ? { accept: true, text: info.defaultPromptText } : { accept: false, text: '' });

async function dialogsPlaced() {
  const out = {};
  const view = newView();
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 600, height: 400 });
  view.setVisible(true);
  const wc = view.webContents;
  try {
    await load(view, '/dialog.html');
    out.view = viewFacts(view);
    out.runDialogListeners = wc.listenerCount('-run-dialog');

    // (1) no debugger, Electron alone: prompt() (Electron answers it at once; no box)
    out.nativePrompt = await runDialog(wc, `prompt('native prompt', 'dflt')`);

    // (2) CDP alone, Page enabled, each dialog answered 300 ms after the event through Page.handleJavaScriptDialog
    await enablePage(wc);
    for (const [name, expression, answer] of [
      ['confirm', `confirm('cdp confirm')`, () => ({ accept: false })],
      ['alert', `alert('cdp alert'), 'alert returned'`, () => ({ accept: true })],
      ['prompt', `prompt('cdp prompt', 'dflt')`, (p) => ({ accept: true, promptText: p.defaultPrompt })],
    ]) {
      const watch = cdpWatch(wc, { answer });
      const t0 = now();
      const step = await runDialog(wc, expression);
      watch.stop();
      out[`cdp_${name}`] = { ...step, cdp: rel(watch.events, t0), cleanUp: await cleanUp(view) };
      save();
    }

    // (3) the wrap of Electron's -run-dialog, Page still enabled (do the CDP events still arrive and close?)
    {
      const wrap = wrapRunDialog(wc, RULE);
      const watch = cdpWatch(wc);
      const t0 = now();
      out.wrap = { originalListeners: wrap.originalCount, steps: [] };
      for (const expression of [`alert('wrapped alert'), 'alert returned'`, `confirm('wrapped confirm')`, `prompt('wrapped prompt', 'dflt')`]) out.wrap.steps.push(await runDialog(wc, expression, 1500));
      watch.stop();
      wrap.restore();
      out.wrap.seen = rel(wrap.seen, t0);
      out.wrap.cdp = rel(watch.events, t0);
      out.wrap.restoredListeners = wc.listenerCount('-run-dialog');
      out.wrap.cleanUp = await cleanUp(view);
      save();
    }
    await wc.debugger.sendCommand('Page.disable').catch(() => {});

    // (4) Playwright through the bridge: no dialog listener (it auto-dismisses), then a no-op listener (it leaves the
    // dialog to someone else; CDP answers after 1 s), then no listener with the wrap installed
    const bridge = await startDebuggerBridge(wc, {});
    const browser = await chromium.connectOverCDP(bridge.wsUrl, { timeout: 10000 });
    const page = browser.contexts()[0].pages()[0];
    const rejections = [];
    const onRejection = (reason) => rejections.push(firstLine(reason));
    process.on('unhandledRejection', onRejection);
    try {
      {
        const sheetMark = sheets.length;
        const t0 = now();
        const r = await attempt(() => page.evaluate(() => confirm('pw no listener')), 5000, 'evaluate confirm');
        await sleep(400);
        out.playwrightNoListener = { evaluate: r, sheets: sheets.slice(sheetMark).map((s) => ({ event: s.event, atMs: round(s.at - t0) })), cleanUp: await cleanUp(view) };
        save();
      }
      {
        const seen = [];
        const noop = (dialog) => seen.push({ type: dialog.type(), message: dialog.message() });
        page.on('dialog', noop);
        const watch = cdpWatch(wc, { answer: () => ({ accept: false }), answerAfterMs: 1000 });
        const sheetMark = sheets.length;
        const t0 = now();
        const r = await attempt(() => page.evaluate(() => confirm('pw noop listener')), 5000, 'evaluate confirm');
        await sleep(400);
        watch.stop();
        page.off('dialog', noop);
        out.playwrightNoopListener = { evaluate: r, seen, cdp: rel(watch.events, t0), sheets: sheets.slice(sheetMark).map((s) => ({ event: s.event, atMs: round(s.at - t0) })), cleanUp: await cleanUp(view) };
        save();
      }
      {
        const wrap = wrapRunDialog(wc, RULE);
        const sheetMark = sheets.length;
        const t0 = now();
        const r1 = await attempt(() => page.evaluate(() => confirm('pw wrapped confirm')), 5000, 'evaluate confirm');
        const r2 = await attempt(() => page.evaluate(() => prompt('pw wrapped prompt', 'dflt')), 5000, 'evaluate prompt');
        await sleep(400);
        wrap.restore();
        out.playwrightWrapped = { confirm: r1, prompt: r2, seen: rel(wrap.seen, t0), sheets: sheets.slice(sheetMark).map((s) => s.event), rejections: [...rejections] };
        save();
      }
    } finally {
      process.off('unhandledRejection', onRejection);
      await browser.close().catch(() => {});
      await bridge.close().catch(() => {});
    }
  } catch (e) {
    out.error = e.stack ?? String(e);
  } finally {
    dispose(view, win);
  }
  return out;
}

async function dialogsUnplacedWrapped() {
  const out = {};
  const view = newView();
  const wc = view.webContents;
  try {
    await load(view, '/dialog.html');
    out.view = viewFacts(view); // the owner window Electron would give its message box: null for a never-attached view
    await enablePage(wc);
    const wrap = wrapRunDialog(wc, RULE);
    const watch = cdpWatch(wc);
    const t0 = now();
    out.steps = [];
    for (const expression of [`alert('unplaced alert'), 'alert returned'`, `confirm('unplaced confirm')`, `prompt('unplaced prompt', 'dflt')`]) out.steps.push(await runDialog(wc, expression, 1500));
    watch.stop();
    wrap.restore();
    out.seen = rel(wrap.seen, t0);
    out.cdp = rel(watch.events, t0);
  } catch (e) {
    out.error = e.stack ?? String(e);
  } finally {
    dispose(view, null);
  }
  return out;
}

// The last step: a never-attached view's confirm() with Electron's own handler, CDP answering 300 ms after the event.
// Electron shows a parentless NSAlert through `runModal`; the readings say whether main's event loop kept running and
// whether CDP's answer returned the page's call and closed the box. A watchdog kills this process after 15 s.
async function dialogsUnplacedNative() {
  const out = { startedAt: new Date().toISOString(), ticks: [] };
  results.dialogs.unplacedNative = out;
  save();
  spawn('/bin/sh', ['-c', `sleep 15; kill -9 ${process.pid}`], { detached: true, stdio: 'ignore' }).unref();
  const view = newView();
  const wc = view.webContents;
  await load(view, '/dialog.html');
  out.view = viewFacts(view);
  await enablePage(wc);
  const watch = cdpWatch(wc, { answer: () => ({ accept: false }), answerAfterMs: 300 });
  const t0 = now();
  const tick = setInterval(() => {
    out.ticks.push(round(now() - t0));
    out.cdp = rel(watch.events, t0);
    try { writeFileSync(resultsFile, JSON.stringify(results, null, 2)); } catch {}
  }, 250);
  const step = await runDialog(wc, `confirm('unplaced native confirm')`, 6000);
  clearInterval(tick);
  watch.stop();
  out.step = step;
  out.cdp = rel(watch.events, t0);
  out.completed = true;
  save();
  dispose(view, null);
}

async function main() {
  mkdirSync(resultsDir, { recursive: true });
  results.meta = { electron: process.versions.electron, chrome: process.versions.chrome, playwrightCore: require('playwright-core/package.json').version, startedAt: new Date().toISOString(), platform: `${process.platform} ${process.arch}` };
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  session.fromPartition(PARTITION).setPermissionRequestHandler((_wc, _p, cb) => cb(false));
  await makeWindow();
  await parking();
  log('dialogs, placed');
  results.dialogs.placed = await withTimeout(dialogsPlaced(), 90000, 'dialogs placed').catch((e) => ({ error: firstLine(e) }));
  save();
  log('dialogs, unplaced, wrapped');
  results.dialogs.unplacedWrapped = await withTimeout(dialogsUnplacedWrapped(), 30000, 'dialogs unplaced wrapped').catch((e) => ({ error: firstLine(e) }));
  save();
  if (!args['skip-native']) {
    log('dialogs, unplaced, native (watchdog armed)');
    await withTimeout(dialogsUnplacedNative(), 12000, 'dialogs unplaced native').catch((e) => { results.dialogs.unplacedNative.error = firstLine(e); });
    save();
  }
  results.meta.finishedAt = new Date().toISOString();
  save();
  server.close();
  log('done');
  setTimeout(() => process.kill(process.pid, 'SIGKILL'), 3000).unref();
  app.exit(0);
}

app.whenReady().then(main).catch((e) => { console.error(e); app.exit(1); });
app.on('window-all-closed', () => {});
