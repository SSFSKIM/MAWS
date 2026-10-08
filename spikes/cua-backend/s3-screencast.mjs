// S3 (cua backend, E13 whole-branch review): does a MAWS-shaped tab answer the vendor's plain screenshot, which is a
// screencast first (Page.startScreencast, the first fresh Page.screencastFrame, stopScreencast + screencastFrameAck) and
// falls back to Page.captureScreenshot only when no frame comes within 2 s (vendor browser-service.mjs BS:43892-44050)?
// Measures, per view, through `webContents.debugger` (protocol 1.3) exactly as the vendor's sequence runs:
//   - placed: a view in a shown window (transparent, click-through, as MAWS_E2E_QUIET's), without and with focus
//     emulation;
//   - placed-hidden: a view in a window that is never shown;
//   - parked: a view never added to a window, at 1280 x 800 (MAWS's parking, agent/visible.ts PARKED_BOUNDS);
//   - parked+focus: the same after Emulation.setFocusEmulationEnabled {enabled:true}, which the vendor sends at attach.
// For each: whether a frame arrives within the vendor's 2 s, the time to it, whether it is fresh by the vendor's test
// (metadata.timestamp >= the wall-clock second the start was sent), and Page.captureScreenshot's time for comparison.
// Three rounds per view (the first is cold). No input is dispatched; nothing native opens.
// Run from the worktree root: node_modules/.bin/electron spikes/cua-backend/s3-screencast.mjs
import { app, BaseWindow, WebContentsView } from 'electron';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratch = mkdtempSync(join(tmpdir(), 'maws-s3-'));
app.setPath('userData', join(scratch, 'userData'));
setTimeout(() => { console.log('[s3] HARD TIMEOUT'); app.exit(2); }, 60_000);
const log = (...a) => console.log('[s3]', ...a);
const FRAME_WAIT_MS = 2_000; // the vendor's UG

const PAGE = `<!doctype html><title>s3</title><style>body{margin:0;font:32px system-ui}</style>
<h1 id=marker>screencast probe</h1><p>static page: nothing animates</p>`;
const server = createServer((_, res) => { res.setHeader('content-type', 'text/html'); res.end(PAGE); });

async function round(dbg) {
  const frames = [];
  const onMessage = (_e, method, params) => { if (method === 'Page.screencastFrame') frames.push({ params, at: performance.now() }); };
  dbg.on('message', onMessage);
  const startedSec = Date.now() / 1000;
  const t0 = performance.now();
  await dbg.sendCommand('Page.startScreencast', { everyNthFrame: 1, format: 'jpeg', quality: 80 });
  while (frames.length === 0 && performance.now() - t0 < FRAME_WAIT_MS) await new Promise((r) => setTimeout(r, 5));
  const first = frames[0];
  await dbg.sendCommand('Page.stopScreencast');
  if (first) await dbg.sendCommand('Page.screencastFrameAck', { sessionId: first.params.sessionId });
  dbg.off('message', onMessage);
  const c0 = performance.now();
  const shot = await dbg.sendCommand('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
  const captureMs = Math.round(performance.now() - c0);
  return first
    ? { frame: true, ms: Math.round(first.at - t0), fresh: first.params.metadata.timestamp >= startedSec, staleBySec: +(startedSec - first.params.metadata.timestamp).toFixed(3), bytes: first.params.data.length, captureMs, captureBytes: shot.data.length }
    : { frame: false, ms: FRAME_WAIT_MS, captureMs, captureBytes: shot.data.length };
}

async function scenario(name, view, { focus = false } = {}) {
  const dbg = view.webContents.debugger;
  dbg.attach('1.3');
  await dbg.sendCommand('Page.enable');
  if (focus) await dbg.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  const visibility = (await dbg.sendCommand('Runtime.evaluate', { expression: 'document.visibilityState + " " + innerWidth + "x" + innerHeight', returnByValue: true })).result.value;
  const rounds = [];
  for (let i = 0; i < 3; i++) rounds.push(await round(dbg));
  log(name, visibility, JSON.stringify(rounds));
  dbg.detach();
}

app.whenReady().then(async () => {
  log('electron', process.versions.electron, 'chrome', process.versions.chrome);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const make = async () => {
    const view = new WebContentsView();
    view.setBounds({ x: 0, y: 0, width: 1280, height: 800 });
    await view.webContents.loadURL(url);
    return view;
  };

  const shown = new BaseWindow({ width: 1280, height: 800, show: false, transparent: true, frame: false, hasShadow: false });
  shown.setIgnoreMouseEvents(true);
  const placed = await make();
  shown.contentView.addChildView(placed);
  shown.showInactive();
  await new Promise((r) => setTimeout(r, 300));
  await scenario('placed', placed);
  const placedFocus = await make();
  shown.contentView.addChildView(placedFocus);
  await new Promise((r) => setTimeout(r, 300));
  await scenario('placed+focus', placedFocus, { focus: true });

  const hiddenWindow = new BaseWindow({ width: 1280, height: 800, show: false });
  const placedHidden = await make();
  hiddenWindow.contentView.addChildView(placedHidden);
  await scenario('placed-hidden', placedHidden);

  await scenario('parked', await make());
  await scenario('parked+focus', await make(), { focus: true });

  server.close();
  app.exit(0);
});
