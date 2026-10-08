// S1 (cua backend, E13): can a cua host answer a tab's alert/confirm through CDP alone while MAWS's `-run-dialog` wrap
// only HOLDS Electron's callback (never calls Electron's own listener, so no native box)?
// Measures, on a WebContentsView in a hidden window ("placed") and on one never added to a window ("unplaced"):
//   1. Page.javascriptDialogOpening params while the callback is held;
//   2. Page.handleJavaScriptDialog {accept:false|true} resolves alert/confirm (page variable + title read back), and
//      Page.javascriptDialogClosed arrives;
//   3a. calling the held callback after CDP answered (error? second answer visible? a later dialog still fine?);
//   3b. dropping the held callback uncalled, global.gc() x5, then a new dialog answered by CDP (still works? crash?);
//   3c. a callback the wrap never retains (dropped and GC'd BEFORE CDP answers), then CDP answers;
//   3d. the wrap answering through the held callback first: does CDP see javascriptDialogClosed, and what does a later
//       Page.handleJavaScriptDialog return?
//   3e. a stale held callback (its dialog already answered by CDP) called WHILE a newer dialog is open: does it answer
//       or close the newer one?
//   4. main stays responsive (a 50 ms setInterval's max gap) — no app-modal freeze, no native box (the wrap never calls
//      Electron's listener, so none can be shown; the listener count is recorded).
// Run from the worktree root (exits by itself; hard timeout 30 s):
//   node_modules/.bin/electron --js-flags=--expose-gc spikes/cua-backend/s1-dialogs.mjs
import { app, BaseWindow, WebContentsView } from 'electron';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

app.setPath('userData', mkdtempSync(join(tmpdir(), 'maws-s1-')));
setTimeout(() => { console.log('[s1] HARD TIMEOUT'); app.exit(2); }, 30_000);
process.on('uncaughtException', (e) => console.log('[s1] uncaughtException', e?.stack ?? e));

const log = (...a) => console.log('[s1]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = performance.now();
const ms = () => Math.round(performance.now() - t0);

// main responsiveness: the largest gap between ticks of a 50 ms interval
// proof that a dropped callback was actually collected
const collected = [];
const registry = new FinalizationRegistry((label) => collected.push(label));

let lastTick = performance.now(), maxGap = 0;
setInterval(() => { const n = performance.now(); maxGap = Math.max(maxGap, n - lastTick); lastTick = n; }, 50);

const server = createServer((_, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>s1</title><p>dialogs</p>'); });

function setup(view) {
  const wc = view.webContents;
  const held = [];
  const mode = { drop: false };
  const originals = wc.listeners('-run-dialog');
  wc.removeAllListeners('-run-dialog');
  wc.on('-run-dialog', (info, callback) => { log('  -run-dialog', info.dialogType, JSON.stringify(info.messageText), 'at', ms(), mode.drop ? '(dropped)' : '(held)'); registry.register(callback, `${info.dialogType}:${info.messageText}`); if (mode.drop) return; held.push({ info: { dialogType: info.dialogType, messageText: info.messageText }, callback, at: ms() }); });
  const events = [];
  const waiters = [];
  wc.debugger.attach('1.3');
  wc.debugger.on('message', (_e, method, params) => {
    if (!method.startsWith('Page.javascriptDialog')) return;
    events.push({ method, params, at: ms() });
    for (const w of waiters.splice(0)) w();
  });
  wc.debugger.on('detach', (_e, reason) => log('debugger detached:', reason));
  // resolves with the first `method` event delivered after the call, or null after `timeout`
  const next = (method, timeout = 3000) => new Promise((resolve) => {
    const start = events.length;
    const check = () => { const e = events.slice(start).find((x) => x.method === method); if (e) resolve(e); else waiters.push(check); };
    check();
    setTimeout(() => resolve(null), timeout);
  });
  const evaluate = async (expression) => (await wc.debugger.sendCommand('Runtime.evaluate', { expression, returnByValue: true })).result.value;
  // fire the dialog from a page task so the evaluate itself returns before the renderer blocks
  const open = (js) => evaluate(`setTimeout(() => { ${js} }, 0); 'scheduled'`);
  return { wc, mode, held, events, next, evaluate, open, originalCount: originals.length };
}

async function dialogRound(p, label, js, answer) {
  const opening = p.next('Page.javascriptDialogOpening');
  await p.open(js);
  const ev = await opening;
  if (answer.beforeAnswer) await answer.beforeAnswer();
  log(label, 'opening:', ev ? JSON.stringify(ev.params) : 'NONE (3 s)', '| held callbacks:', p.held.length);
  if (!ev) return { ev: null };
  const closed = p.next('Page.javascriptDialogClosed');
  let handleResult;
  try { handleResult = await p.wc.debugger.sendCommand('Page.handleJavaScriptDialog', { accept: answer.accept }); } catch (e) { handleResult = 'ERROR ' + e.message; }
  const c = await closed;
  await sleep(100);
  const state = await Promise.race([p.evaluate('JSON.stringify({r: window.r, title: document.title, after: window.after})'), sleep(2000).then(() => 'EVALUATE TIMED OUT (page blocked)')]);
  log(label, 'handle', JSON.stringify({ accept: answer.accept }), '->', JSON.stringify(handleResult), '| closed:', c ? JSON.stringify(c.params) : 'NONE', '| page:', state);
  return { ev, c, state };
}

async function scenario(name, view) {
  log(`==== ${name} ====`);
  maxGap = 0;
  const p = setup(view);
  await p.wc.debugger.sendCommand('Page.enable');
  await p.wc.debugger.sendCommand('Runtime.enable');
  log(name, 'Electron -run-dialog listeners before wrap:', p.originalCount, 'after:', p.wc.listenerCount('-run-dialog'));

  // 1+2: alert dismissed, confirm false, confirm true
  await dialogRound(p, `${name} alert/accept:false`, `window.r = 'pre'; alert('hello alert'); window.r = 'alert-returned'; document.title = 'after-alert';`, { accept: false });
  await dialogRound(p, `${name} confirm/accept:false`, `window.r = confirm('ok to proceed?'); document.title = 'confirm:' + window.r;`, { accept: false });
  await dialogRound(p, `${name} confirm/accept:true`, `window.r = confirm('second?'); document.title = 'confirm:' + window.r;`, { accept: true });

  // 3a: call the last held callback (its CDP answer was accept:true) with accept:false, late
  const late = p.held.at(-1);
  let lateResult = 'ok (no throw)';
  try { late.callback(false, ''); } catch (e) { lateResult = 'THROW ' + e.message; }
  await sleep(300);
  log(name, '3a late callback(false) after CDP accept:true ->', lateResult, '| page:', await p.evaluate('JSON.stringify({r: window.r, title: document.title})'));
  // calling an earlier one too, twice
  let late2 = 'ok (no throw)';
  try { p.held[0].callback(true, ''); p.held[0].callback(true, ''); } catch (e) { late2 = 'THROW ' + e.message; }
  log(name, '3a held[0] called twice ->', late2);
  await dialogRound(p, `${name} after-late confirm/accept:true`, `window.r = confirm('after late?'); document.title = 'confirm:' + window.r;`, { accept: true });

  // 3b: drop every held callback, GC, then another dialog
  const before = p.held.length;
  p.held.length = 0;
  for (let i = 0; i < 5; i++) { global.gc?.(); await sleep(100); }
  log(name, `3b dropped ${before} callbacks, gc available:`, typeof global.gc === 'function', '| finalized so far:', JSON.stringify(collected));
  await sleep(500);
  await dialogRound(p, `${name} after-gc confirm/accept:false`, `window.r = confirm('after gc?'); document.title = 'confirm:' + window.r;`, { accept: false });
  // drop one that CDP answered, without ever calling it — and also one never answered by anyone until GC? (left out: it would leave the renderer blocked)
  p.held.length = 0;
  for (let i = 0; i < 5; i++) { global.gc?.(); await sleep(100); }
  await dialogRound(p, `${name} after-gc2 alert/accept:true`, `alert('after gc 2'); window.r = 'alert2-returned'; document.title = 'after-alert2';`, { accept: true });
  // 3c: the wrap keeps no reference; GC runs while the dialog is open, then CDP answers
  p.mode.drop = true;
  await dialogRound(p, `${name} 3c dropped-before-answer confirm/accept:true`, `window.r = confirm('dropped before answer?'); document.title = 'confirm:' + window.r;`, {
    accept: true,
    beforeAnswer: async () => { for (let i = 0; i < 5; i++) { global.gc?.(); await sleep(100); } await sleep(300); log('  3c finalized before CDP answer:', JSON.stringify(collected.filter((l) => l.includes('dropped before')))); },
  });
  await dialogRound(p, `${name} 3c next alert/accept:false`, `alert('next after 3c'); window.r = 'alert3c-returned'; document.title = 'after-alert3c';`, { accept: false });
  p.mode.drop = false;

  // 3d: the wrap answers first through the held callback (true), CDP afterwards
  {
    const opening = p.next('Page.javascriptDialogOpening');
    await p.open(`window.r = confirm('wrap answers first'); document.title = 'confirm:' + window.r;`);
    await opening;
    await sleep(50);
    const closed = p.next('Page.javascriptDialogClosed', 1500);
    p.held.at(-1).callback(true, '');
    const c = await closed;
    let h;
    try { h = JSON.stringify(await p.wc.debugger.sendCommand('Page.handleJavaScriptDialog', { accept: false })); } catch (e) { h = 'ERROR ' + e.message; }
    await sleep(100);
    log(name, '3d callback(true) first -> closed:', c ? JSON.stringify(c.params) : 'NONE', '| later handle(false):', h, '| page:', await p.evaluate('JSON.stringify({r: window.r, title: document.title})'));
  }
  // 3e: a stale callback called while a newer dialog is pending
  {
    const opening = p.next('Page.javascriptDialogOpening');
    await p.open(`window.r = confirm('stale target A'); document.title = 'confirm:' + window.r;`);
    await opening;
    await p.wc.debugger.sendCommand('Page.handleJavaScriptDialog', { accept: true });
    await sleep(100);
    const stale = p.held.at(-1);
    const opening2 = p.next('Page.javascriptDialogOpening');
    await p.open(`window.r = confirm('newer B'); document.title = 'confirm:' + window.r;`);
    await opening2;
    await sleep(50);
    const closedEarly = p.next('Page.javascriptDialogClosed', 800);
    let s3 = 'ok (no throw)';
    try { stale.callback(false, ''); } catch (e) { s3 = 'THROW ' + e.message; }
    const ce = await closedEarly;
    const during = await Promise.race([p.evaluate('JSON.stringify({r: window.r, title: document.title})'), sleep(800).then(() => 'evaluate blocked (B still open)')]);
    log(name, '3e stale callback(false) while B open ->', s3, '| closed event:', ce ? JSON.stringify(ce.params) : 'NONE (800 ms)', '| page:', during);
    const closed = p.next('Page.javascriptDialogClosed');
    let h;
    try { h = JSON.stringify(await p.wc.debugger.sendCommand('Page.handleJavaScriptDialog', { accept: true })); } catch (e) { h = 'ERROR ' + e.message; }
    const c = await closed;
    await sleep(100);
    log(name, '3e then CDP handle(true) on B ->', h, '| closed:', c ? JSON.stringify(c.params) : 'NONE', '| page:', await p.evaluate('JSON.stringify({r: window.r, title: document.title})'));
  }
  log(name, 'renderer crashed?', p.wc.isCrashed(), '| debugger attached?', p.wc.debugger.isAttached(), '| max main tick gap so far (ms):', Math.round(maxGap));
}

app.whenReady().then(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  log('electron', process.versions.electron, 'chrome', process.versions.chrome, 'url', url);
  app.on('render-process-gone', (_e, _wc, d) => log('render-process-gone', JSON.stringify(d)));
  app.on('child-process-gone', (_e, d) => log('child-process-gone', JSON.stringify(d)));

  const win = new BaseWindow({ width: 1000, height: 700, show: false });
  win.on('sheet-begin', () => log('SHEET BEGIN (a native sheet opened)'));
  const placed = new WebContentsView();
  win.contentView.addChildView(placed);
  placed.setBounds({ x: 0, y: 0, width: 1000, height: 700 });
  await placed.webContents.loadURL(url);
  await scenario('placed', placed);

  const unplaced = new WebContentsView();
  await unplaced.webContents.loadURL(url);
  await scenario('unplaced', unplaced);

  log('DONE max main tick gap (ms):', Math.round(maxGap), 'total ms', ms());
  app.exit(0);
});
