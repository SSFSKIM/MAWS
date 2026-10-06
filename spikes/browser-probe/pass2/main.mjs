// E4-0, browser probes pass two: the probe app. A BrowserWindow built like MAWS's (src/main/window.ts: sandboxed
// renderer, CSP header on the default session, window.open denied) whose renderer (shell.html) reports the browser
// pane's rect over IPC, and a WebContentsView layered over it with win.contentView.addChildView. Three local origins on
// three sites (localhost, 127.0.0.1, [::1]) serve the test pages, so cross-site navigations and cross-site iframes are
// real process swaps and OOPIFs under Chromium's site isolation.
// Launch: pass2/run.sh <input|input2|layer|crosssite|oopif|snapshot|chips|all> [--front=1]. Results land in
// results/pass2/<scenario>.json. --front=1 pins the window on screen above everything (no focus taken).
import { app, BrowserWindow, WebContentsView, session, ipcMain, systemPreferences } from 'electron';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { startDebuggerBridge } from '../cdp/bridge.mjs';
import { findProbePage, parseSnapshot, refOf } from '../cdp/driver.mjs';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const probeRoot = join(here, '..');
const resultsDir = join(probeRoot, 'results', 'pass2');
const epoch = () => performance.timeOrigin + performance.now();
const round = (n, d = 1) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, label) => Promise.race([p, sleep(ms).then(() => { throw new Error(`${label}: timed out after ${ms}ms`); })]);
const firstLine = (e) => (e?.message ?? String(e)).split('\n')[0];
const stats = (samples) => {
  const s = samples.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!s.length) return { n: 0 };
  const pick = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { n: s.length, min: round(s[0], 2), median: round(pick(0.5), 2), p95: round(pick(0.95), 2), max: round(s[s.length - 1], 2) };
};

const args = Object.fromEntries(process.argv.slice(1).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const scenario = args.scenario ?? 'all';
app.setPath('userData', '/tmp/maws-e4-0/userData');
const PARTITION = 'persist:maws-probe2';
const ORIGINS = { A: 'http://localhost:17334', A2: 'http://localhost:17337', B: 'http://127.0.0.1:17335', C: 'http://[::1]:17336' };
const log = (...a) => console.log('[probe]', ...a);
const { chromium } = require('playwright-core');

// ---- three sites, one handler ------------------------------------------------------------------------------------
const cookieLog = [];
const blockedRequests = [];
function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/echo-cookies') {
    const entry = { tag: url.searchParams.get('tag'), cookie: req.headers.cookie ?? null, host: req.headers.host, secFetchSite: req.headers['sec-fetch-site'] ?? null, secFetchDest: req.headers['sec-fetch-dest'] ?? null, at: epoch() };
    cookieLog.push(entry);
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><title>echo</title><pre id="cookie">${(entry.cookie ?? '(none)').replace(/</g, '&lt;')}</pre>`);
    return;
  }
  let file;
  if (url.pathname.startsWith('/saved/')) file = join(resultsDir, url.pathname.slice('/saved/'.length));
  else file = join(here, 'page', url.pathname === '/' ? 'a.html' : url.pathname);
  const root = url.pathname.startsWith('/saved/') ? resultsDir : join(here, 'page');
  if (!file.startsWith(root) || !existsSync(file)) { res.statusCode = 404; res.end('not found'); return; }
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
  res.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
}
const servers = [];
function listen(port, host) {
  return new Promise((resolve, reject) => {
    const s = createServer(handler);
    s.on('error', reject);
    s.listen(port, host, () => { servers.push(s); resolve(s); });
  });
}
async function startServers() {
  // A is reached as `localhost`, which Chromium may resolve to ::1 first, so it listens on both loopbacks.
  await listen(17334, '127.0.0.1'); await listen(17334, '::1');
  await listen(17337, '127.0.0.1'); await listen(17337, '::1');
  await listen(17335, '127.0.0.1');
  await listen(17336, '::1');
}
const isLocalUrl = (u) => { try { const h = new URL(u); return !/^https?:$/.test(h.protocol) || ['localhost', '127.0.0.1', '[::1]'].includes(h.hostname); } catch { return true; } };

// ---- the window (MAWS's shape) and the view ----------------------------------------------------------------------
let win;
let view;
const placeLog = [];
const coverLog = [];
const placeWaiters = [];
const domEvents = [];
ipcMain.on('browser.view.place', (e, r) => {
  if (e.sender !== win?.webContents) return;
  const tRecv = epoch();
  const bounds = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  view.setBounds(bounds);
  const entry = { tSent: r.t, tRecv, tApplied: epoch(), reason: r.reason, frame: r.frame, rect: { x: r.x, y: r.y, width: r.width, height: r.height }, bounds };
  placeLog.push(entry);
  for (const w of placeWaiters.splice(0)) w(entry);
});
ipcMain.on('browser.view.cover', (e, { covered, t }) => {
  if (e.sender !== win?.webContents) return;
  const tRecv = epoch();
  view.setVisible(!covered);
  coverLog.push({ covered, tSent: t, tRecv, tApplied: epoch() });
});
ipcMain.on('probe:dom-event', (e, d) => { if (e.sender === view?.webContents) domEvents.push({ ...d, recvEpoch: epoch() }); });
const nextPlace = (timeoutMs = 2000) => withTimeout(new Promise((r) => placeWaiters.push(r)), timeoutMs, 'place report');

function installContentSecurityPolicy() {
  // As src/main/window.ts does on the default session; the view lives in its own partition and must not see it.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self'"] } });
  });
}

async function makeWindow() {
  installContentSecurityPolicy();
  win = new BrowserWindow({
    title: 'MAWS browser probe, pass two', width: 1200, height: 800, minWidth: 600, minHeight: 400, show: false, backgroundColor: '#faf9f6',
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 15 },
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, preload: join(here, 'shell-preload.cjs') },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  view = new WebContentsView({ webPreferences: { preload: join(here, 'view-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, partition: PARTITION } });
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  view.webContents.on('render-process-gone', (_e, d) => log('view render process gone', d.reason));
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 1, height: 1 });
  const ses = session.fromPartition(PARTITION);
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.webRequest.onBeforeRequest((details, callback) => {
    const local = isLocalUrl(details.url);
    if (!local) blockedRequests.push(details.url.slice(0, 120));
    callback({ cancel: !local });
  });
  const placed = nextPlace(5000);
  await win.loadFile(join(here, 'shell.html'));
  win.showInactive();
  // --front=1 (after review): pin the window above everything on the current Space, without taking focus, so the
  // page is on screen and not occluded (the first runs' window sat on another Space behind the session's terminal)
  if (args.front) {
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  await placed;
  return ses;
}

// ---- helpers ------------------------------------------------------------------------------------------------------
async function attach(wc, opts = {}) {
  const t0 = epoch();
  const bridge = await startDebuggerBridge(wc, { log, ...opts });
  const t1 = epoch();
  const browser = await withTimeout(chromium.connectOverCDP(bridge.wsUrl), 15000, 'connectOverCDP');
  const t2 = epoch();
  return { bridge, browser, bridgeStartMs: round(t1 - t0), connectMs: round(t2 - t1) };
}
async function detach({ bridge, browser }) {
  const t0 = epoch();
  await browser.close().catch(() => {});
  await bridge.close().catch(() => {});
  return round(epoch() - t0);
}
const frameInfo = (wc) => ({ url: wc.getURL(), processId: wc.mainFrame.processId, osPid: wc.getOSProcessId(), routingId: wc.mainFrame.routingId, frameToken: wc.mainFrame.frameToken ?? null });
async function frameTreeId(wc) { return (await wc.debugger.sendCommand('Page.getFrameTree')).frameTree.frame.id; }
function screenPoint(x, y) {
  const c = win.getContentBounds();
  const b = view.getBounds();
  return { x: c.x + b.x + x, y: c.y + b.y + y };
}

// ---- (1) human against synthesised input ---------------------------------------------------------------------------
async function inputScenario() {
  const wc = view.webContents;
  const out = {};
  await wc.loadURL(`${ORIGINS.A}/a.html`);
  const mainEvents = [];
  const beforeInput = [];
  let inputEventKeys = null;
  const onInput = (_e, input) => {
    if (!inputEventKeys) inputEventKeys = Object.keys(input);
    mainEvents.push({ at: epoch(), type: input.type, modifiers: input.modifiers, _modifiers: input._modifiers, x: input.x, y: input.y, globalX: input.globalX, globalY: input.globalY, button: input.button, clickCount: input.clickCount, keyCode: input.keyCode, movementX: input.movementX, movementY: input.movementY });
  };
  const onBefore = (_e, input) => beforeInput.push({ at: epoch(), type: input.type, key: input.key, code: input.code, modifiers: input.modifiers, isAutoRepeat: input.isAutoRepeat });
  wc.on('input-event', onInput);
  wc.on('before-input-event', onBefore);
  const commands = [];
  const a = await attach(wc, { onCommand: (c) => { if (c.method.startsWith('Input.')) commands.push({ ...c, params: { type: c.params.type, x: c.params.x, y: c.params.y, key: c.params.key, text: c.params.text, button: c.params.button } }); } });
  const { bridge, browser } = a;
  const page = await findProbePage(browser, ORIGINS.A);
  if (!page) throw new Error('no page');
  page.setDefaultTimeout(8000);
  const box = await page.locator('#target').boundingBox();
  const cx = Math.round(box.x + box.width / 2);
  const cy = Math.round(box.y + box.height / 2);
  out.target = { cx, cy, viewBounds: view.getBounds(), contentBounds: win.getContentBounds(), screenPointOfTarget: screenPoint(cx, cy), pageScreenOffset: await page.evaluate(() => globalThis.__probeInput.screenOffset()) };

  const phases = [];
  let domCursor = domEvents.length;
  async function phase(label, fn) {
    const before = { main: mainEvents.length, cmd: commands.length, bi: beforeInput.length };
    domCursor = domEvents.length;
    await page.evaluate(() => globalThis.__probeInput.clear());
    const t0 = epoch();
    let error = null;
    try { await fn(); } catch (e) { error = firstLine(e); }
    const t1 = epoch();
    await sleep(300);
    phases.push({ label, t0, t1, actionMs: round(t1 - t0), error, main: mainEvents.slice(before.main), dom: domEvents.slice(domCursor).filter((d) => d.type !== 'focus' && d.type !== 'blur'), commands: commands.slice(before.cmd), beforeInput: beforeInput.slice(before.bi) });
  }
  await phase('playwright locator.click', () => page.locator('#target').click());
  await phase('playwright mouse.click', () => page.mouse.click(cx, cy));
  await phase('raw CDP Input.dispatchMouseEvent from main (same debugger session)', async () => {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type, x: cx, y: cy, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
  });
  await phase('sendInputEvent mouse, no global coords (human stand-in, naive)', async () => {
    wc.sendInputEvent({ type: 'mouseMove', x: cx, y: cy });
    wc.sendInputEvent({ type: 'mouseDown', x: cx, y: cy, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: cx, y: cy, button: 'left', clickCount: 1 });
  });
  await phase('sendInputEvent mouse, globalX/Y = screen point (human stand-in)', async () => {
    const g = screenPoint(cx, cy);
    wc.sendInputEvent({ type: 'mouseMove', x: cx, y: cy, globalX: g.x, globalY: g.y });
    wc.sendInputEvent({ type: 'mouseDown', x: cx, y: cy, globalX: g.x, globalY: g.y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: cx, y: cy, globalX: g.x, globalY: g.y, button: 'left', clickCount: 1 });
  });
  await page.locator('#field').click();
  await sleep(200);
  await phase('playwright keyboard.press a', () => page.keyboard.press('a'));
  await phase('playwright locator.fill', () => page.locator('#field').fill('filled'));
  await phase('playwright keyboard.type bc', () => page.keyboard.type('bc'));
  wc.focus();
  await sleep(200);
  await phase('sendInputEvent key d (human stand-in)', async () => {
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'D' });
    wc.sendInputEvent({ type: 'char', keyCode: 'd' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'D' });
  });
  await phase('playwright mouse.wheel', () => page.mouse.wheel(0, 40));
  await phase('sendInputEvent mouseWheel (human stand-in)', async () => { wc.sendInputEvent({ type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -40, canScroll: true }); });
  out.countAfter = await page.locator('#count').textContent();
  out.fieldValue = await page.locator('#field').inputValue();
  out.inputEventKeys = inputEventKeys;

  // Analysis. For every main-side input-event: the raw modifier bits, whether it fell inside an Input.* command's
  // send..reply window, and whether type and coordinates match the command. For every DOM event: the trust fields.
  const CDP_TO_ELECTRON = { mouseMoved: 'mouseMove', mousePressed: 'mouseDown', mouseReleased: 'mouseUp', keyDown: 'keyDown', rawKeyDown: 'rawKeyDown', keyUp: 'keyUp', char: 'char', mouseWheel: 'mouseWheel' };
  function windowsOf(cmds) {
    const byId = new Map();
    for (const c of cmds) {
      const w = byId.get(c.id) ?? { id: c.id, method: c.method, params: c.params };
      if (c.phase === 'send') w.send = c.at; else w.reply = c.at;
      byId.set(c.id, w);
    }
    return [...byId.values()].map((w) => ({ ...w, durationMs: round((w.reply ?? NaN) - w.send, 2) }));
  }
  const mapped = new Set(['shift', 'control', 'alt', 'meta', 'isKeypad', 'isAutoRepeat', 'leftButtonDown', 'middleButtonDown', 'rightButtonDown', 'capsLock', 'numLock', 'left', 'right']);
  const KNOWN_BITS = { 0: 'shift', 1: 'control', 2: 'alt', 3: 'meta', 4: 'isKeypad', 5: 'isAutoRepeat', 6: 'leftButtonDown', 7: 'middleButtonDown', 8: 'rightButtonDown', 9: 'capsLock', 10: 'numLock', 11: 'isLeft', 12: 'isRight' };
  const bitsOf = (m) => { const b = []; for (let i = 0; i < 32; i++) if (typeof m === 'number' && (m >>> i) & 1) b.push(i); return b; };
  out.phases = phases.map((p) => {
    const windows = windowsOf(p.commands);
    const main = p.main.map((m) => {
      const inside = windows.filter((w) => m.at >= w.send - 0.05 && (w.reply == null || m.at <= w.reply + 0.05));
      const matching = inside.filter((w) => CDP_TO_ELECTRON[w.params.type] === m.type && (w.params.x == null || (Math.round(w.params.x) === Math.round(m.x) && Math.round(w.params.y) === Math.round(m.y))));
      const bits = bitsOf(m._modifiers);
      return { type: m.type, at: round(m.at - p.t0, 2), x: m.x, y: m.y, globalX: m.globalX, globalY: m.globalY, button: m.button, clickCount: m.clickCount, keyCode: m.keyCode, modifiers: m.modifiers, _modifiers: m._modifiers, bits, unmappedBits: bits.filter((b) => !(b in KNOWN_BITS)), insideAnyWindow: inside.length > 0, insideMatchingWindow: matching.length > 0, windowMethod: matching[0]?.method ?? inside[0]?.method ?? null };
    });
    const dom = p.dom.map((d) => ({ type: d.type, target: d.target, isTrusted: d.isTrusted, sourceCapabilities: d.sourceCapabilities, pointerType: d.pointerType ?? null, pointerId: d.pointerId ?? null, pressure: d.pressure ?? null, clientX: d.clientX ?? null, clientY: d.clientY ?? null, screenX: d.screenX ?? null, screenY: d.screenY ?? null, screenMinusClient: d.screenX != null ? { x: d.screenX - d.clientX, y: d.screenY - d.clientY } : null, movementX: d.movementX ?? null, button: d.button ?? null, buttons: d.buttons ?? null, detail: d.detail, key: d.key ?? null, code: d.code ?? null, inputType: d.inputType ?? null, data: d.data ?? null, atEpochRel: round(d.atEpoch - p.t0, 2), seenRel: round(d.seenEpoch - p.t0, 2), recvInMainRel: round(d.recvEpoch - p.t0, 2) }));
    return { label: p.label, actionMs: p.actionMs, error: p.error, commands: windows.map((w) => ({ method: w.method, type: w.params.type, x: w.params.x, y: w.params.y, key: w.params.key, text: w.params.text, sendRel: round(w.send - p.t0, 2), replyRel: round((w.reply ?? NaN) - p.t0, 2), durationMs: w.durationMs })), inputEvents: main, beforeInputEvents: p.beforeInput.map((b) => ({ ...b, at: round(b.at - p.t0, 2) })), domEvents: dom };
  });
  const synthPhases = out.phases.filter((p) => /playwright|raw CDP/.test(p.label));
  const humanPhases = out.phases.filter((p) => /sendInputEvent/.test(p.label));
  // Only events that carry `_modifiers` can show a bit: mouse button events have no modifier field in Electron 44, and
  // the gestureScroll* events Chromium derives from a wheel are not the injected event.
  const carriesBits = (m) => typeof m._modifiers === 'number' && !/^gesture/.test(m.type);
  const bitsIn = (ps) => { const set = new Set(); for (const p of ps) for (const m of p.inputEvents) if (carriesBits(m)) for (const b of m.bits) set.add(b); return [...set].sort((a, b) => a - b); };
  const everyHas = (ps, bit) => ps.flatMap((p) => p.inputEvents).filter(carriesBits).every((m) => m.bits.includes(bit));
  const synthBits = bitsIn(synthPhases);
  const humanBits = bitsIn(humanPhases);
  const signalBits = synthBits.filter((b) => !humanBits.includes(b) && everyHas(synthPhases, b));
  out.analysis = {
    inputEventFiresForCdpInput: synthPhases.filter((p) => p.commands.some((c) => c.method === 'Input.dispatchMouseEvent' || c.method === 'Input.dispatchKeyEvent')).map((p) => ({ label: p.label, inputCommands: p.commands.filter((c) => /dispatch/.test(c.method)).length, inputEvents: p.inputEvents.length })),
    inputEventFiresForSendInputEvent: humanPhases.map((p) => ({ label: p.label, inputEvents: p.inputEvents.length, types: p.inputEvents.map((m) => m.type) })),
    rawModifierBitsSeen: { synthesised: synthBits, humanStandIn: humanBits, candidateSignalBits: signalBits, eventsCarryingModifiers: { synthesised: synthPhases.flatMap((p) => p.inputEvents).filter(carriesBits).length, humanStandIn: humanPhases.flatMap((p) => p.inputEvents).filter(carriesBits).length }, note: 'a bit set on every CDP-dispatched key or wheel event and on no sendInputEvent one; Chromium 152 names bit 23 kFromDebugger (results/pass2/web_input_event-modifiers-152.0.7977.130.txt)' },
    insideWindow: synthPhases.map((p) => ({ label: p.label, events: p.inputEvents.length, insideAny: p.inputEvents.filter((m) => m.insideAnyWindow).length, insideMatching: p.inputEvents.filter((m) => m.insideMatchingWindow).length })),
    humanInsideWindow: humanPhases.map((p) => ({ label: p.label, events: p.inputEvents.length, insideAny: p.inputEvents.filter((m) => m.insideAnyWindow).length })),
    commandWindowMs: stats(out.phases.flatMap((p) => p.commands.filter((c) => /dispatch/.test(c.method)).map((c) => c.durationMs))),
    actionWindowMs: Object.fromEntries(out.phases.map((p) => [p.label, p.actionMs])),
    domTrust: Object.fromEntries(out.phases.map((p) => [p.label, { isTrusted: [...new Set(p.domEvents.map((d) => d.isTrusted))], sourceCapabilities: [...new Set(p.domEvents.map((d) => JSON.stringify(d.sourceCapabilities)))], pointerType: [...new Set(p.domEvents.filter((d) => d.pointerType).map((d) => d.pointerType))], screenMinusClient: [...new Set(p.domEvents.filter((d) => d.screenMinusClient).map((d) => `${d.screenMinusClient.x},${d.screenMinusClient.y}`))] }])),
    ordering: out.phases.filter((p) => p.commands.some((c) => /dispatch/.test(c.method))).map((p) => {
      const press = p.commands.find((c) => c.type === 'mousePressed' || c.type === 'keyDown' || c.type === 'rawKeyDown');
      const ie = p.inputEvents.find((m) => m.type === 'mouseDown' || m.type === 'keyDown' || m.type === 'rawKeyDown');
      const de = p.domEvents.find((d) => d.type === 'mousedown' || d.type === 'keydown');
      return press && ie ? { label: p.label, commandSend: press.sendRel, inputEvent: ie.at, domEvent: de?.atEpochRel ?? null, domReportInMain: de?.recvInMainRel ?? null, commandReply: press.replyRel, inputEventBeforeReply: ie.at <= press.replyRel, domReportBeforeReply: de ? de.recvInMainRel <= press.replyRel : null } : { label: p.label, note: 'no press pair' };
    }),
  };
  await detach(a);
  wc.removeListener('input-event', onInput);
  wc.removeListener('before-input-event', onBefore);
  return out;
}

// ---- (1), second pass after review: before-mouse-event, input inside a cross-site iframe, interleaved presses, zoom --
async function input2Scenario() {
  const wc = view.webContents;
  const out = {};
  await wc.loadURL(`${ORIGINS.A}/embed.html?frame=${encodeURIComponent(`${ORIGINS.B}/frame.html`)}`);
  const mainEvents = [];
  const beforeMouse = [];
  const beforeInput = [];
  let beforeMouseKeys = null;
  const onInput = (_e, input) => mainEvents.push({ at: epoch(), type: input.type, x: input.x, y: input.y, globalX: input.globalX, globalY: input.globalY, _modifiers: input._modifiers });
  const onBeforeMouse = (_e, input) => { if (!beforeMouseKeys) beforeMouseKeys = Object.keys(input); beforeMouse.push({ at: epoch(), type: input.type, x: input.x, y: input.y, globalX: input.globalX, globalY: input.globalY, _modifiers: input._modifiers, modifiers: input.modifiers }); };
  const onBefore = (_e, input) => beforeInput.push({ at: epoch(), type: input.type, key: input.key });
  wc.on('input-event', onInput);
  wc.on('before-mouse-event', onBeforeMouse);
  wc.on('before-input-event', onBefore);
  const commands = [];
  let interleave = null;
  const a = await attach(wc, { onCommand: (c) => {
    if (!c.method.startsWith('Input.')) return;
    commands.push({ ...c, params: { type: c.params.type, x: c.params.x, y: c.params.y, key: c.params.key } });
    // the human stand-in presses while the agent's mousePressed is in flight (inside its send..reply window)
    if (interleave && c.phase === 'send' && c.method === 'Input.dispatchMouseEvent' && c.params.type === 'mousePressed') {
      const p = interleave;
      interleave = null;
      const g = screenPoint(p.x, p.y);
      wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, globalX: g.x, globalY: g.y, button: 'left', clickCount: 1 });
      wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, globalX: g.x, globalY: g.y, button: 'left', clickCount: 1 });
    }
  } });
  const page = await findProbePage(a.browser, ORIGINS.A);
  if (!page) throw new Error('no page');
  page.setDefaultTimeout(8000);
  await page.frameLocator('#f').locator('#fbtn').waitFor({ state: 'visible' });
  const centre = async (loc) => { const b = await loc.boundingBox(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; };
  const top = await centre(page.locator('#top-btn'));
  const frameBtn = await centre(page.frameLocator('#f').locator('#fbtn'));
  const frameField = await centre(page.frameLocator('#f').locator('#ffield'));
  const heading = await centre(page.locator('#origin'));
  out.points = { top, frameBtn, frameField, heading, electronFrames: wc.mainFrame.framesInSubtree.map((f) => ({ url: f.url, processId: f.processId })) };
  const standInClick = (p) => { const g = screenPoint(p.x, p.y); wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y, globalX: g.x, globalY: g.y }); wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, globalX: g.x, globalY: g.y, button: 'left', clickCount: 1 }); wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, globalX: g.x, globalY: g.y, button: 'left', clickCount: 1 }); };
  const standInKey = (k) => { wc.sendInputEvent({ type: 'keyDown', keyCode: k.toUpperCase() }); wc.sendInputEvent({ type: 'char', keyCode: k }); wc.sendInputEvent({ type: 'keyUp', keyCode: k.toUpperCase() }); };

  const CDP_TO_ELECTRON = { mouseMoved: 'mouseMove', mousePressed: 'mouseDown', mouseReleased: 'mouseUp', keyDown: 'keyDown', rawKeyDown: 'rawKeyDown', keyUp: 'keyUp', char: 'char', mouseWheel: 'mouseWheel' };
  const windowsOf = (cmds) => { const byId = new Map(); for (const c of cmds) { const w = byId.get(c.id) ?? { id: c.id, method: c.method, params: c.params }; if (c.phase === 'send') w.send = c.at; else w.reply = c.at; byId.set(c.id, w); } return [...byId.values()]; };
  // the rule as (1) states it: an event is the agent's iff an Input.dispatch* of the same type is in flight (sent, not
  // replied) and not yet consumed by an earlier event of that type; no coordinates (zoom and iframes break them).
  // Mouse events are read from before-mouse-event (the hook that also sees input to OOPIFs), keys from input-event.
  const classify = (events, windows) => {
    const used = new Set();
    return events.map((m) => {
      const w = windows.find((x) => !used.has(x.id) && m.at >= x.send - 0.05 && (x.reply == null || m.at <= x.reply + 0.05) && CDP_TO_ELECTRON[x.params.type] === m.type);
      if (w) used.add(w.id);
      return { type: m.type, at: m.at, x: m.x, y: m.y, _modifiers: m._modifiers, attributed: w ? 'agent' : 'human' };
    });
  };
  const phases = [];
  async function phase(label, fn, expect) {
    const before = { main: mainEvents.length, bm: beforeMouse.length, bi: beforeInput.length, cmd: commands.length };
    const t0 = epoch();
    let error = null;
    try { await fn(); } catch (e) { error = firstLine(e); }
    await sleep(300);
    const main = mainEvents.slice(before.main);
    const windows = windowsOf(commands.slice(before.cmd));
    const isMouse = (m) => /^mouse/.test(m.type);
    // the stated rule's inputs: mouse events from before-mouse-event, key events from input-event
    const source = [...beforeMouse.slice(before.bm).filter(isMouse), ...main.filter((m) => !isMouse(m))].sort((a, b) => a.at - b.at);
    const classified = classify(source, windows).map((m) => ({ ...m, at: round(m.at - t0, 2) }));
    const p = { label, error, expect, attributedEvents: classified, inputEventTypes: main.map((m) => m.type), inputEvents: main.map((m) => ({ ...m, at: round(m.at - t0, 2) })), beforeMouseEvents: beforeMouse.slice(before.bm).map((b) => ({ ...b, at: round(b.at - t0, 2) })), beforeInputEvents: beforeInput.slice(before.bi).map((b) => ({ ...b, at: round(b.at - t0, 2) })), commands: windows.map((w) => ({ type: w.params.type, x: w.params.x, y: w.params.y, sendRel: round(w.send - t0, 2), replyRel: round((w.reply ?? NaN) - t0, 2) })), attributed: { agent: classified.filter((m) => m.attributed === 'agent').length, human: classified.filter((m) => m.attributed === 'human').length, humanPresses: classified.filter((m) => m.attributed === 'human' && (m.type === 'mouseDown' || m.type === 'rawKeyDown' || m.type === 'keyDown')).length } };
    phases.push(p);
    return p;
  }
  const topCount = () => page.locator('#top-count').textContent();
  const frameCount = () => page.frameLocator('#f').locator('#fcount').textContent();

  // before-mouse-event: agent vs stand-in, top frame
  (await phase('agent click, top-frame button (CDP)', () => page.locator('#top-btn').click(), 'before-mouse-event fires?')).topCount = await topCount();
  (await phase('stand-in click, top-frame button (sendInputEvent)', () => standInClick(top), 'before-mouse-event fires?')).topCount = await topCount();
  // input inside the cross-site iframe
  (await phase('agent click, button inside the cross-site iframe (CDP)', () => page.frameLocator('#f').locator('#fbtn').click(), 'does main see input-event / before-mouse-event for an OOPIF?')).frameCount = await frameCount();
  (await phase('stand-in click, button inside the cross-site iframe (sendInputEvent at its page coordinates)', () => standInClick(frameBtn), 'the takeover case that matters: a human click into an iframe')).frameCount = await frameCount();
  await phase('stand-in click into the iframe field, then stand-in key x', async () => { standInClick(frameField); await sleep(150); wc.focus(); standInKey('x'); }, 'does main see before-input-event / input-event for a key into an OOPIF?');
  phases[phases.length - 1].frameFieldValue = await page.frameLocator('#f').locator('#ffield').inputValue().catch((e) => `error: ${firstLine(e)}`);
  // interleaved: the stand-in presses while the agent's mousePressed is in flight
  interleave = heading;
  (await phase('interleaved: agent click on the top button while the stand-in presses at another pixel (the heading)', () => page.locator('#top-btn').click(), 'agent events attributed to the agent, the stand-in press to the human')).topCount = await topCount();
  interleave = top;
  (await phase('interleaved: agent click on the top button while the stand-in presses at the same pixel', () => page.locator('#top-btn').click(), 'one press consumes the window, the other is human: the takeover still fires')).topCount = await topCount();
  // zoom: CDP coordinates are CSS px of the viewport; input-event x,y are widget DIPs
  wc.setZoomFactor(1.25);
  await sleep(300);
  const topZoomed = await centre(page.locator('#top-btn'));
  (await phase('agent click at zoom 1.25', () => page.locator('#top-btn').click(), 'do command x,y and input-event x,y still agree?')).pointAtZoom = topZoomed;
  wc.setZoomFactor(1);
  await sleep(200);
  out.beforeMouseEventKeys = beforeMouseKeys;
  out.phases = phases;
  out.summary = phases.map((p) => ({ label: p.label, inputEvents: p.inputEventTypes.length, beforeMouse: p.beforeMouseEvents.length, beforeInput: p.beforeInputEvents.length, agent: p.attributed.agent, human: p.attributed.human, humanPresses: p.attributed.humanPresses, counts: { top: p.topCount, frame: p.frameCount, field: p.frameFieldValue } }));
  await detach(a);
  wc.removeListener('input-event', onInput);
  wc.removeListener('before-mouse-event', onBeforeMouse);
  wc.removeListener('before-input-event', onBefore);
  return out;
}

// ---- (2) the view layered over the renderer -------------------------------------------------------------------------
async function layerScenario() {
  const wc = view.webContents;
  const out = {};
  const shots = join(resultsDir, 'shots');
  mkdirSync(shots, { recursive: true });
  await wc.loadURL(`${ORIGINS.A}/a.html`);
  const shellInner = await win.webContents.executeJavaScript('window.__shell.inner()');
  out.geometry = {
    windowBounds: win.getBounds(), contentBounds: win.getContentBounds(), contentSize: win.getContentSize(), shellInner,
    innerMatchesContent: shellInner.width === win.getContentSize()[0] && shellInner.height === win.getContentSize()[1],
    initialPlace: placeLog[0], viewBounds: view.getBounds(),
    cspOnDefaultSession: { shellInlineScriptRan: await win.webContents.executeJavaScript('window.__shell.inlineRan()'), viewInlineScriptRan: (await wc.executeJavaScript('document.getElementById("origin").textContent')) !== '' },
  };
  // capturePage throws "Current display surface not available for capture" until a surface has been presented; retry.
  const capture = async (contents) => {
    let last;
    for (let i = 0; i < 8; i++) {
      try { return await contents.capturePage(); } catch (e) { last = e; await sleep(100); }
    }
    throw last;
  };
  const snap = async (label) => {
    const r = { label, viewBounds: view.getBounds() };
    try {
      const t0 = epoch();
      const shell = await capture(win.webContents);
      r.shellMs = round(epoch() - t0);
      r.shellSize = shell.getSize();
      writeFileSync(join(shots, `${label}-shell.png`), shell.toPNG());
    } catch (e) { r.shellError = firstLine(e); }
    try {
      const t1 = epoch();
      const page = await capture(wc);
      r.viewMs = round(epoch() - t1);
      r.viewSize = page.getSize();
      writeFileSync(join(shots, `${label}-view.png`), page.toPNG());
    } catch (e) { r.viewError = firstLine(e); }
    return r;
  };
  await sleep(300);
  out.visibilityAtStart = { view: await wc.executeJavaScript('document.visibilityState'), shell: await win.webContents.executeJavaScript('document.visibilityState'), viewVisible: view.getVisible(), windowVisible: win.isVisible(), windowFocused: win.isFocused() };
  out.shots = [await snap('01-initial')];
  out.visibilityAfterFirstCapture = { view: await wc.executeJavaScript('document.visibilityState') };

  // window resize: main shrinks and grows the window; the renderer's ResizeObserver reports the pane; main places the view
  const resizes = [];
  const sizes = [];
  for (let i = 1; i <= 12; i++) sizes.push([1200 - i * 20, 800 - i * 12]);
  for (let i = 11; i >= 0; i--) sizes.push([1200 - i * 20, 800 - i * 12]);
  for (const [w, h] of sizes) {
    const p = nextPlace(3000);
    const t0 = epoch();
    let tResizeEvent = null;
    win.once('resize', () => { tResizeEvent = epoch(); });
    win.setSize(w, h);
    const entry = await p.catch((e) => ({ error: firstLine(e) }));
    await sleep(40);
    const reports = placeLog.filter((x) => x.tRecv >= t0).length;
    resizes.push({ w, h, resizeEventMs: tResizeEvent == null ? null : round(tResizeEvent - t0), reportRecvMs: entry.error ?? round(entry.tRecv - t0), appliedMs: entry.error ?? round(entry.tApplied - t0), rendererToMainMs: entry.error ?? round(entry.tRecv - entry.tSent), reports, reason: entry.reason, bounds: entry.bounds, contentSize: win.getContentSize() });
  }
  out.resize = { steps: resizes, reportRecvMs: stats(resizes.map((r) => r.reportRecvMs)), rendererToMainMs: stats(resizes.map((r) => r.rendererToMainMs)), reportsPerResize: stats(resizes.map((r) => r.reports)), fractionalRects: placeLog.filter((e) => e.reason === 'window-resize' && (e.rect.x % 1 || e.rect.width % 1)).length };
  out.visibilityAfterResize = { view: await wc.executeJavaScript('document.visibilityState') };
  out.shots.push(await snap('02-after-resize'));

  // split drag: 60 animation frames in the renderer, each reporting its rect
  const before = placeLog.length;
  const t0 = epoch();
  const frames = await win.webContents.executeJavaScript('window.__shell.drag(60, 0.42, 0.2)');
  const dragMs = epoch() - t0;
  await sleep(100);
  const entries = placeLog.slice(before).filter((e) => e.reason === 'drag');
  const perFrame = frames.map((f) => {
    const e = entries.find((x) => x.frame === f.frame);
    return e ? { frame: f.frame, frameToReportMs: round(f.tReport - f.tFrame, 2), reportToMainMs: round(e.tRecv - e.tSent, 2), frameToAppliedMs: round(e.tApplied - f.tFrame, 2), width: e.bounds.width, x: e.bounds.x } : { frame: f.frame, missing: true };
  });
  const applied = perFrame.filter((p) => !p.missing).map((p) => p.frameToAppliedMs);
  out.drag = {
    frames: frames.length, reportsReceived: entries.length, totalMs: round(dragMs), frameIntervalMs: stats(frames.slice(1).map((f, i) => f.tFrame - frames[i].tFrame)),
    reportToMainMs: stats(perFrame.map((p) => p.reportToMainMs)), frameToAppliedMs: stats(applied),
    framesAppliedWithin16ms: applied.filter((x) => x <= 16.7).length, framesAppliedWithin33ms: applied.filter((x) => x <= 33.4).length,
    xTravel: { from: entries[0]?.bounds.x, to: entries[entries.length - 1]?.bounds.x }, perFrame,
  };
  out.shots.push(await snap('03-after-drag'));
  // the ResizeObserver route for the same movement (one jump), for the latency a layout change costs without the rAF report
  {
    const p = nextPlace(3000);
    const tj = epoch();
    await win.webContents.executeJavaScript('document.documentElement.style.setProperty("--split", "0.42"); void 0');
    const e = await p.catch((err) => ({ error: firstLine(err) }));
    out.layoutChangeViaResizeObserver = e.error ?? { reportRecvMs: round(e.tRecv - tj), appliedMs: round(e.tApplied - tj), reason: e.reason };
  }

  // a renderer-drawn sheet: hide the view while it is open
  const countBefore = await wc.executeJavaScript('document.getElementById("count").textContent');
  const tOpen = await win.webContents.executeJavaScript('window.__shell.openSheet()');
  await sleep(50);
  const coverOpen = coverLog.find((c) => c.covered && c.tSent === tOpen);
  await sleep(300);
  const hiddenState = { viewVisible: view.getVisible(), documentVisibility: await wc.executeJavaScript('document.visibilityState'), hidden: await wc.executeJavaScript('document.hidden') };
  const tc = epoch();
  const placeholder = await wc.capturePage();
  const placeholderMs = round(epoch() - tc);
  writeFileSync(join(shots, '04-under-sheet-view-capture.png'), placeholder.toPNG());
  const shellUnderSheet = await win.webContents.capturePage();
  writeFileSync(join(shots, '04-under-sheet-shell.png'), shellUnderSheet.toPNG());
  await sleep(1000);
  const timerRate = await wc.executeJavaScript('new Promise(r => { let n = 0; const t0 = performance.now(); const id = setInterval(() => { if (++n >= 5) { clearInterval(id); r((performance.now() - t0) / 5); } }, 1); })');
  const tClose = await win.webContents.executeJavaScript('window.__shell.closeSheet()');
  await sleep(50);
  const coverClose = coverLog.find((c) => !c.covered && c.tSent === tClose);
  await sleep(300);
  out.sheet = {
    openMs: coverOpen ? round(coverOpen.tApplied - coverOpen.tSent, 2) : null, closeMs: coverClose ? round(coverClose.tApplied - coverClose.tSent, 2) : null,
    whileHidden: { ...hiddenState, placeholderCaptureMs: placeholderMs, placeholderSize: placeholder.getSize(), placeholderEmpty: placeholder.isEmpty(), setInterval1msMeasuredMs: round(timerRate, 2) },
    afterRestore: { viewVisible: view.getVisible(), documentVisibility: await wc.executeJavaScript('document.visibilityState'), countPreserved: (await wc.executeJavaScript('document.getElementById("count").textContent')) === countBefore },
  };
  out.shots.push(await snap('05-after-sheet'));

  // Composited screenshots (both layers in one image) need Screen Recording. The status is recorded; nothing is
  // captured: a first run with the status 'granted' got empty thumbnails from desktopCapturer.getSources after 3 s
  // each and the app then hung on exit (ScreenCaptureKit teardown), and a non-granted status would prompt.
  out.composited = { screenRecordingStatus: systemPreferences.getMediaAccessStatus('screen'), captured: false };

  // Visibility after restore: does the view's document come back to 'visible' by itself, and if not, what brings it back.
  const visibility = async () => ({ view: await wc.executeJavaScript('document.visibilityState'), shell: await win.webContents.executeJavaScript('document.visibilityState'), viewVisible: view.getVisible(), windowVisible: win.isVisible() });
  out.visibility = { afterRestore300ms: await visibility() };
  await sleep(1500);
  out.visibility.afterRestore1800ms = await visibility();
  const fixes = [
    ['setBounds(same)', () => view.setBounds(view.getBounds())],
    ['setVisible(false) then setVisible(true)', () => { view.setVisible(false); view.setVisible(true); }],
    ['webContents.focus()', () => wc.focus()],
    ['removeChildView + addChildView', () => { win.contentView.removeChildView(view); win.contentView.addChildView(view); }],
    ['win.showInactive() again', () => win.showInactive()],
  ];
  out.visibility.fixes = [];
  for (const [label, fn] of fixes) {
    if ((await visibility()).view === 'visible') break;
    fn();
    await sleep(300);
    const v = await visibility();
    out.visibility.fixes.push({ label, after: v });
  }
  out.visibility.final = await visibility();
  out.visibility.timerAfterFinal1msIntervalMs = round(await wc.executeJavaScript('new Promise(r => { let n = 0; const t0 = performance.now(); const id = setInterval(() => { if (++n >= 5) { clearInterval(id); r((performance.now() - t0) / 5); } }, 1); })'), 2);
  out.visibility.rafAfterFinalMs = round(await wc.executeJavaScript('new Promise(r => { const t0 = performance.now(); let n = 0; const step = () => { if (++n >= 5) r((performance.now() - t0) / 5); else requestAnimationFrame(step); }; requestAnimationFrame(step); setTimeout(() => r(-1), 3000); })'), 2);
  return out;
}

// ---- (3) cross-site navigation under the bridge ------------------------------------------------------------------
async function crosssiteScenario() {
  const wc = view.webContents;
  const out = {};
  await wc.loadURL(`${ORIGINS.A}/a.html`);
  out.before = frameInfo(wc);
  const events = [];
  const a = await attach(wc);
  const { bridge, browser } = a;
  out.attach = { bridgeStartMs: a.bridgeStartMs, connectMs: a.connectMs };
  wc.debugger.on('message', (_e, method, params, sessionId) => {
    if (/^Target\.|^Page\.frameNavigated|^Page\.frameStartedNavigating|^Runtime\.executionContextsCleared|^Inspector\./.test(method)) events.push({ at: epoch(), method, sessionId: sessionId || null, url: params?.frame?.url ?? params?.targetInfo?.url ?? params?.url ?? null, type: params?.targetInfo?.type ?? null, frameId: params?.frame?.id ?? params?.frameId ?? null });
  });
  wc.debugger.on('detach', (_e, reason) => events.push({ at: epoch(), method: 'webContents.debugger detach', reason }));
  out.frameIdBefore = await frameTreeId(wc);
  const page = await findProbePage(browser, ORIGINS.A);
  if (!page) throw new Error('no page');
  page.setDefaultTimeout(10000);
  const pwEvents = [];
  const tStart = epoch();
  page.on('framenavigated', (f) => pwEvents.push({ at: epoch(), event: 'framenavigated', url: f.url(), main: f === page.mainFrame() }));
  page.on('crash', () => pwEvents.push({ at: epoch(), event: 'crash' }));
  page.on('close', () => pwEvents.push({ at: epoch(), event: 'close' }));
  browser.on('disconnected', () => pwEvents.push({ at: epoch(), event: 'browser disconnected' }));

  async function navigate(label, go, expectUrlPrefix) {
    const t0 = epoch();
    const evBefore = events.length;
    const pidBefore = wc.mainFrame.processId;
    const result = await go().then((r) => ({ ok: true, status: r?.status?.() ?? null }), (e) => ({ ok: false, error: firstLine(e) }));
    const navMs = round(epoch() - t0);
    const after = frameInfo(wc);
    const r = { label, navMs, result, processSwapped: pidBefore !== after.processId, processBefore: pidBefore, after, frameIdAfter: await frameTreeId(wc).catch((e) => `error: ${firstLine(e)}`), debuggerAttached: wc.debugger.isAttached(), browserConnected: browser.isConnected(), pageUrl: page.url(), pageUrlMatches: page.url().startsWith(expectUrlPrefix) };
    r.evaluateHost = await page.evaluate(() => location.host).catch((e) => `error: ${firstLine(e)}`);
    const tc = epoch();
    r.click = await page.locator('#target').click().then(() => 'ok', (e) => `error: ${firstLine(e)}`);
    r.clickMs = round(epoch() - tc);
    r.count = await page.locator('#count').textContent().catch((e) => `error: ${firstLine(e)}`);
    const ts = epoch();
    const snapText = await page.ariaSnapshot({ mode: 'ai' }).catch((e) => `error: ${firstLine(e)}`);
    r.snapshotMs = round(epoch() - ts);
    r.targetRef = typeof snapText === 'string' ? refOf(parseSnapshot(snapText), 'button', 'Target') : snapText;
    r.debuggerEvents = events.slice(evBefore).map((e) => ({ ...e, at: round(e.at - t0) }));
    return r;
  }
  out.navigations = [];
  out.navigations.push(await navigate('A -> B (localhost -> 127.0.0.1, cross-site)', () => page.goto(`${ORIGINS.B}/a.html`), ORIGINS.B));
  out.navigations.push(await navigate('B -> back to A (history, cross-site)', () => page.goBack(), ORIGINS.A));
  out.navigations.push(await navigate('A -> A2 (localhost:17334 -> localhost:17337, same-site)', () => page.goto(`${ORIGINS.A2}/a.html`), ORIGINS.A2));
  out.navigations.push(await navigate('A2 -> C (localhost -> [::1], cross-site)', () => page.goto(`${ORIGINS.C}/a.html`), ORIGINS.C));
  out.navigations.push(await navigate('C -> A by webContents.loadURL (the chrome address bar, cross-site)', async () => { await wc.loadURL(`${ORIGINS.A}/a.html`); return null; }, ORIGINS.A));
  out.navigations.push(await navigate('A reload', () => page.reload(), ORIGINS.A));
  out.pwEvents = pwEvents.map((e) => ({ ...e, at: round(e.at - tStart) }));
  out.bridgeStats = { ...bridge.stats, unknownBrowserMethods: [...bridge.stats.unknownBrowserMethods], blocked: bridge.stats.blocked.slice(0, 20) };
  out.frameIdsStable = out.navigations.every((n) => n.frameIdAfter === out.frameIdBefore);

  // re-attach cost: tear down and attach again on the page as it stands
  out.detachMs = await detach(a);
  const t0 = epoch();
  const b = await attach(wc);
  const page2 = await findProbePage(b.browser, ORIGINS.A);
  const t1 = epoch();
  const s = await page2.ariaSnapshot({ mode: 'ai' });
  const t2 = epoch();
  out.reattach = { bridgeStartMs: b.bridgeStartMs, connectMs: b.connectMs, findPageMs: round(t1 - t0 - b.bridgeStartMs - b.connectMs), firstSnapshotMs: round(t2 - t1), totalToFirstSnapshotMs: round(t2 - t0), snapshotChars: s.length };
  await detach(b);
  return out;
}

// ---- (4) OOPIF child sessions ------------------------------------------------------------------------------------
async function oopifScenario() {
  const wc = view.webContents;
  const out = {};
  await wc.loadURL(`${ORIGINS.A}/a.html`);
  const commandsBySession = {};
  const a = await attach(wc, { onCommand: (c) => { if (c.phase === 'send') commandsBySession[c.sessionId] = (commandsBySession[c.sessionId] ?? 0) + 1; } });
  const { bridge, browser } = a;
  const targetEvents = [];
  wc.debugger.on('message', (_e, method, params, sessionId) => {
    if (method.startsWith('Target.')) targetEvents.push({ at: epoch(), method, onSession: sessionId || null, childSession: params?.sessionId ?? null, type: params?.targetInfo?.type ?? null, url: params?.targetInfo?.url ?? null, waitingForDebugger: params?.waitingForDebugger ?? null });
  });
  const page = await findProbePage(browser, ORIGINS.A);
  if (!page) throw new Error('no page');
  page.setDefaultTimeout(10000);
  const pwFrameEvents = [];
  page.on('frameattached', (f) => pwFrameEvents.push({ event: 'frameattached', url: f.url() }));
  page.on('framenavigated', (f) => pwFrameEvents.push({ event: 'framenavigated', url: f.url() }));
  page.on('framedetached', (f) => pwFrameEvents.push({ event: 'framedetached', url: f.url() }));

  async function embed(label, frameOrigin) {
    const evBefore = targetEvents.length;
    const t0 = epoch();
    const r = { label };
    await page.goto(`${ORIGINS.A}/embed.html?frame=${encodeURIComponent(`${frameOrigin}/frame.html`)}`);
    const tWait = epoch();
    r.frameButtonVisible = await page.frameLocator('#f').locator('#fbtn').waitFor({ state: 'visible', timeout: 8000 }).then(() => 'ok', (e) => `error: ${firstLine(e)}`);
    r.gotoAndFrameReadyMs = round(epoch() - t0);
    r.frameReadyAfterGotoMs = round(epoch() - tWait);
    const main = wc.mainFrame;
    r.electronFrames = main.framesInSubtree.map((f) => ({ url: f.url, processId: f.processId, isMain: f === main }));
    r.oopif = r.electronFrames.some((f) => !f.isMain && f.processId !== main.processId);
    r.playwrightFrames = page.frames().map((f) => ({ url: f.url(), parent: f.parentFrame()?.url() ?? null }));
    r.targetEvents = targetEvents.slice(evBefore).map((e) => ({ ...e, at: round(e.at - t0) }));
    r.knownChildSessions = r.targetEvents.filter((e) => e.method === 'Target.attachedToTarget').map((e) => e.childSession);
    // act inside the frame: by frameLocator, then by aria-ref from a page-level snapshot
    const tc = epoch();
    r.clickViaFrameLocator = await page.frameLocator('#f').locator('#fbtn').click().then(() => 'ok', (e) => `error: ${firstLine(e)}`);
    r.clickViaFrameLocatorMs = round(epoch() - tc);
    r.frameCountAfterClick = await page.frameLocator('#f').locator('#fcount').textContent().catch((e) => `error: ${firstLine(e)}`);
    const ts = epoch();
    const snapText = await page.ariaSnapshot({ mode: 'ai' });
    r.snapshotMs = round(epoch() - ts);
    const rows = parseSnapshot(snapText);
    r.snapshot = { chars: snapText.length, lines: snapText.split('\n').length, hasIframeNode: /- iframe/.test(snapText), frameButtonRef: refOf(rows, 'button', 'Frame button'), topButtonRef: refOf(rows, 'button', 'Top button'), frameTextboxRef: refOf(rows, 'textbox', 'Frame field'), text: snapText };
    if (r.snapshot.frameButtonRef) {
      const tr = epoch();
      r.clickViaRef = await page.locator(`aria-ref=${r.snapshot.frameButtonRef}`).click().then(() => 'ok', (e) => `error: ${firstLine(e)}`);
      r.clickViaRefMs = round(epoch() - tr);
      r.frameCountAfterRefClick = await page.frameLocator('#f').locator('#fcount').textContent().catch((e) => `error: ${firstLine(e)}`);
      r.fillViaRef = r.snapshot.frameTextboxRef ? await page.locator(`aria-ref=${r.snapshot.frameTextboxRef}`).fill('in the frame').then(() => 'ok', (e) => `error: ${firstLine(e)}`) : 'no ref';
      r.frameFieldValue = await page.frameLocator('#f').locator('#ffield').inputValue().catch((e) => `error: ${firstLine(e)}`);
      r.frameElementScreenshotBytes = await page.locator('#f').screenshot().then((b) => b.length, (e) => `error: ${firstLine(e)}`);
      r.frameButtonScreenshotBytes = await page.locator(`aria-ref=${r.snapshot.frameButtonRef}`).screenshot().then((b) => b.length, (e) => `error: ${firstLine(e)}`);
    }
    r.topClick = await page.locator('#top-btn').click().then(() => 'ok', (e) => `error: ${firstLine(e)}`);
    r.topCount = await page.locator('#top-count').textContent().catch((e) => `error: ${firstLine(e)}`);
    return r;
  }
  out.crossSiteFrame = await embed('A embeds B (cross-site iframe)', ORIGINS.B);
  out.sameSiteFrame = await embed('A embeds A (same-site iframe, control)', ORIGINS.A);
  out.crossSiteFrameAgain = await embed('A embeds C (cross-site iframe, second)', ORIGINS.C);
  out.pwFrameEvents = pwFrameEvents;
  out.commandsBySession = commandsBySession;
  out.bridgeStats = { ...bridge.stats, unknownBrowserMethods: [...bridge.stats.unknownBrowserMethods], blocked: bridge.stats.blocked.slice(0, 20) };
  await detach(a);
  return out;
}

// ---- (5) snapshot size on two saved real pages ---------------------------------------------------------------------
async function snapshotScenario() {
  const wc = view.webContents;
  const out = { pages: [] };
  await wc.loadURL(`${ORIGINS.A}/a.html`);
  const a = await attach(wc);
  const { browser } = a;
  const page = await findProbePage(browser, ORIGINS.A);
  if (!page) throw new Error('no page');
  page.setDefaultTimeout(20000);
  const refsIn = (text) => (text.match(/\[ref=/g) ?? []).length;
  const truncate = (text, cap) => {
    if (text.length <= cap) return { kept: text, dropped: 0 };
    const cut = text.lastIndexOf('\n', cap);
    const kept = text.slice(0, cut > 0 ? cut : cap);
    return { kept, dropped: text.slice(kept.length).split('\n').length - 1 };
  };
  // GitHub and YouTube as the brief asks; Wikipedia's main page and Hacker News's front page as supplements, because
  // YouTube's saved HTML is a JS shell that renders nothing accessible when its scripts cannot load.
  for (const name of ['github-front', 'youtube-front', 'wikipedia-main', 'hn-front'].filter((n) => existsSync(join(resultsDir, `${n}.html`)))) {
    const r = { name, url: `${ORIGINS.A}/saved/${name}.html`, htmlBytes: existsSync(join(resultsDir, `${name}.html`)) ? readFileSync(join(resultsDir, `${name}.html`)).length : null };
    blockedRequests.length = 0;
    const t0 = epoch();
    r.load = await page.goto(r.url, { waitUntil: 'load', timeout: 30000 }).then((res) => ({ ok: true, status: res?.status() }), (e) => ({ ok: false, error: firstLine(e) }));
    r.loadMs = round(epoch() - t0);
    await sleep(800);
    r.title = await page.title().catch(() => null);
    r.domNodes = await page.evaluate(() => document.getElementsByTagName('*').length).catch(() => null);
    r.externalRequestsBlocked = blockedRequests.length;
    const samples = [];
    let text = '';
    for (let i = 0; i < 3; i++) { const t = epoch(); text = await page.ariaSnapshot({ mode: 'ai' }); samples.push(epoch() - t); }
    r.whole = { chars: text.length, lines: text.split('\n').length, refs: refsIn(text), estTokensAt4CharsPerToken: Math.round(text.length / 4), ms: stats(samples), charsPerRef: round(text.length / Math.max(1, refsIn(text))) };
    const rows = parseSnapshot(text);
    const roleCounts = {};
    for (const row of rows) roleCounts[row.role] = (roleCounts[row.role] ?? 0) + 1;
    r.topRoles = Object.entries(roleCounts).sort((x, y) => y[1] - x[1]).slice(0, 12);
    r.landmarks = {};
    for (const role of ['banner', 'navigation', 'main', 'contentinfo', 'search', 'region', 'complementary']) {
      const count = await page.getByRole(role).count().catch(() => 0);
      if (!count) { r.landmarks[role] = { count: 0 }; continue; }
      const t = epoch();
      const s = await page.getByRole(role).first().ariaSnapshot({ mode: 'ai' }).catch((e) => `error: ${firstLine(e)}`);
      r.landmarks[role] = typeof s === 'string' ? { count, chars: s.length, lines: s.split('\n').length, refs: refsIn(s), ms: round(epoch() - t), firstLine: s.split('\n')[0].slice(0, 120) } : { count, error: s };
    }
    r.truncation = {};
    for (const cap of [4000, 8000, 12000, 16000, 24000, 32000, 48000]) {
      const { kept, dropped } = truncate(text, cap);
      r.truncation[cap] = { keptChars: kept.length, keptLines: kept.split('\n').length, droppedLines: dropped, keptRefs: refsIn(kept), keptRefFraction: round(refsIn(kept) / Math.max(1, refsIn(text)), 3) };
    }
    const tb = epoch();
    const boxes = await page.ariaSnapshot({ mode: 'ai', boxes: true }).catch((e) => `error: ${firstLine(e)}`);
    r.withBoxes = typeof boxes === 'string' ? { chars: boxes.length, ms: round(epoch() - tb), growth: round(boxes.length / text.length, 2) } : boxes;
    writeFileSync(join(resultsDir, `snapshot-${name}.txt`), text);
    out.pages.push(r);
  }
  // the probe's own small pages, for scale
  await page.goto(`${ORIGINS.A}/a.html`);
  const small = await page.ariaSnapshot({ mode: 'ai' });
  out.smallPage = { chars: small.length, lines: small.split('\n').length, refs: refsIn(small) };
  await detach(a);
  return out;
}

// ---- (8) a CHIPS cookie sent on a matching embedded request ------------------------------------------------------
async function chipsScenario() {
  const wc = view.webContents;
  const ses = session.fromPartition(PARTITION);
  const out = {};
  await ses.clearStorageData({ storages: ['cookies'] });
  await wc.loadURL('about:blank');
  cookieLog.length = 0;
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
  const set = (params) => wc.debugger.sendCommand('Network.setCookie', params).then((r) => ({ ...r, params }), (e) => ({ error: firstLine(e), params }));
  const chipsBase = { name: 'chips_probe', value: 'partitioned-for-top-level-localhost', domain: '127.0.0.1', path: '/', secure: true, httpOnly: false, sameSite: 'None', partitionKey: { topLevelSite: 'http://localhost', hasCrossSiteAncestor: true } };
  out.setChips = await set({ ...chipsBase, url: `${ORIGINS.B}/` });
  if (out.setChips.error || out.setChips.success === false) out.setChipsHttpsUrl = await set({ ...chipsBase, url: 'https://127.0.0.1/' });
  out.setPlain = await set({ name: 'plain_probe', value: 'unpartitioned', domain: '127.0.0.1', path: '/', secure: true, httpOnly: false, sameSite: 'None', url: `${ORIGINS.B}/` });
  // can Electron's cookies.set take a partition key? (the import would prefer it)
  out.electronCookiesSetWithPartitionKey = await ses.cookies.set({ url: `${ORIGINS.B}/`, name: 'electron_pk_probe', value: 'x', secure: true, sameSite: 'no_restriction', partitionKey: { topLevelSite: 'http://localhost', hasCrossSiteAncestor: true } }).then(() => 'accepted (see jar for whether it is partitioned)', (e) => `error: ${firstLine(e)}`);
  const all = await wc.debugger.sendCommand('Network.getAllCookies');
  out.jar = (all.cookies ?? []).map((c) => ({ name: c.name, domain: c.domain, path: c.path, secure: c.secure, sameSite: c.sameSite, sourceScheme: c.sourceScheme, partitionKey: c.partitionKey ?? null }));
  out.electronCookiesGet = (await ses.cookies.get({})).map((c) => ({ name: c.name, domain: c.domain, secure: c.secure, sameSite: c.sameSite, hasPartitionKeyField: 'partitionKey' in c }));
  wc.debugger.detach();

  const waitTag = async (tag, ms = 8000) => { const t = epoch(); while (epoch() - t < ms) { const e = cookieLog.find((l) => l.tag === tag); if (e) return e; await sleep(50); } return null; };
  const loads = [
    ['A-embeds-B', `${ORIGINS.A}/embed.html?frame=${encodeURIComponent(`${ORIGINS.B}/echo-cookies?tag=A-embeds-B`)}`, 'top-level localhost embeds 127.0.0.1: the partition the cookie was set for'],
    ['C-embeds-B', `${ORIGINS.C}/embed.html?frame=${encodeURIComponent(`${ORIGINS.B}/echo-cookies?tag=C-embeds-B`)}`, 'top-level [::1] embeds 127.0.0.1: another partition'],
    ['B-top', `${ORIGINS.B}/echo-cookies?tag=B-top`, 'top-level 127.0.0.1 itself: the unpartitioned context'],
    ['A-embeds-B-again', `${ORIGINS.A}/embed.html?frame=${encodeURIComponent(`${ORIGINS.B}/echo-cookies?tag=A-embeds-B-again`)}`, 'the matching partition a second time'],
  ];
  out.requests = [];
  for (const [tag, url, meaning] of loads) {
    await wc.loadURL(url).catch((e) => log('load', tag, firstLine(e)));
    const e = await waitTag(tag);
    const names = (e?.cookie ?? '').split(';').map((s) => s.trim().split('=')[0]).filter(Boolean);
    out.requests.push({ tag, meaning, received: Boolean(e), cookieNames: names, chipsSent: names.includes('chips_probe'), plainSent: names.includes('plain_probe'), electronPkSent: names.includes('electron_pk_probe'), secFetchSite: e?.secFetchSite ?? null, secFetchDest: e?.secFetchDest ?? null });
  }
  const byTag = Object.fromEntries(out.requests.map((r) => [r.tag, r]));
  out.verdict = {
    chipsSentOnMatchingEmbed: byTag['A-embeds-B']?.chipsSent === true && byTag['A-embeds-B-again']?.chipsSent === true,
    chipsAbsentOnOtherTopLevelSite: byTag['C-embeds-B']?.chipsSent === false,
    chipsAbsentAtTopLevelB: byTag['B-top']?.chipsSent === false,
    unpartitionedSentEverywhere: out.requests.every((r) => r.plainSent),
  };
  await ses.clearStorageData({ storages: ['cookies'] });
  return out;
}

// ---- run ----------------------------------------------------------------------------------------------------------
async function main() {
  mkdirSync(resultsDir, { recursive: true });
  await startServers();
  await makeWindow();
  const meta = { scenario, electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, playwrightCore: require('playwright-core/package.json').version, platform: `${process.platform} ${process.arch} ${require('node:os').release()}`, startedAt: new Date().toISOString(), loadavg: require('node:os').loadavg().map((x) => round(x)), userData: app.getPath('userData'), origins: ORIGINS };
  const results = { meta };
  const scenarios = { layer: layerScenario, input: inputScenario, input2: input2Scenario, crosssite: crosssiteScenario, oopif: oopifScenario, snapshot: snapshotScenario, chips: chipsScenario };
  meta.front = Boolean(args.front);
  meta.windowIsVisibleApi = win.isVisible();
  const order = scenario === 'all' ? Object.keys(scenarios) : scenario.split(',');
  let failed = false;
  for (const name of order) {
    if (!scenarios[name]) { log(`unknown scenario ${name}`); failed = true; continue; }
    log(`--- ${name} ---`);
    const t = epoch();
    try {
      results[name] = await withTimeout(scenarios[name](), 180000, name);
      results[name].totalMs = round(epoch() - t);
    } catch (e) {
      results[name] = { error: e.stack ?? String(e) };
      failed = true;
      log(`${name} failed: ${e.message}`);
    }
    writeFileSync(join(resultsDir, `${name}.json`), JSON.stringify({ meta, [name]: results[name] }, null, 2));
    log(`${name} written (${round(epoch() - t)} ms)`);
  }
  if (scenario === 'all') writeFileSync(join(resultsDir, 'all.json'), JSON.stringify(results, null, 2));
  for (const s of servers) s.close();
  log(`done, exit ${failed ? 1 : 0}`);
  // a hard stop behind app.exit: a first run never returned from exit after a ScreenCaptureKit capture
  setTimeout(() => process.kill(process.pid, 'SIGKILL'), 3000).unref();
  app.exit(failed ? 1 : 0);
}

app.whenReady().then(main).catch((e) => { console.error(e); app.exit(1); });
app.on('window-all-closed', () => app.quit());
