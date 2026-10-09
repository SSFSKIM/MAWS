// S2 (cua backend, E13): does CDP file-chooser interception work on a MAWS-shaped tab (a WebContentsView driven only
// through `webContents.debugger`, protocol 1.3)?
// Measures, on a view in a hidden window ("placed") and on one never added to a window ("unplaced"):
//   0. Emulation.setFocusEmulationEnabled first (as Playwright's attach sends): without it a hidden window's page reads
//      visibilityState 'hidden' and a dispatched mouse click never reaches it (measured; trigger B below is the fallback);
//   1. with Page.setInterceptFileChooserDialog {enabled:true}, a user-activated click (Input.dispatchMouseEvent
//      moved/pressed/released at <input type=file id=file>'s centre) emits Page.fileChooserOpened {frameId, mode, backendNodeId}
//      and no native panel;
//   2. DOM.setFileInputFiles {files:[tmp file], backendNodeId} fills the input; the page's change handler writes
//      `name:size` into #picked (read back with Runtime.evaluate);
//   3. Page.setInterceptFileChooserDialog {enabled:false} succeeds. No click is made with interception off (it would open
//      a native NSOpenPanel on the owner's screen).
// Bounds: if fileChooserOpened does not arrive within 2 s of a click, a native panel may be up, so the process exits at
// once (exit 3), which closes any panel; hard timeout 15 s.
// Run from the worktree root: node_modules/.bin/electron spikes/cua-backend/s2-file-chooser.mjs
import { app, BaseWindow, WebContentsView } from 'electron';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratch = mkdtempSync(join(tmpdir(), 'maws-s2-'));
app.setPath('userData', join(scratch, 'userData'));
setTimeout(() => { console.log('[s2] HARD TIMEOUT'); app.exit(2); }, 15_000);
process.on('uncaughtException', (e) => console.log('[s2] uncaughtException', e?.stack ?? e));
const log = (...a) => console.log('[s2]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = performance.now();
const ms = () => Math.round(performance.now() - t0);

const upload = join(scratch, 'upload-probe.txt');
writeFileSync(upload, 'hello from s2\n'); // 14 bytes

const PAGE = `<!doctype html><title>s2</title>
<input type=file id=file style="position:absolute;left:100px;top:100px;width:240px;height:40px">
<output id=picked>none</output>
<script>window.seen = [];
for (const t of ['mousedown', 'mouseup', 'click']) document.addEventListener(t, (e) => seen.push(t + (e.isTrusted ? '' : '(untrusted)') + '@' + e.target.id), true);
document.getElementById('file').addEventListener('change', (e) => {
  document.getElementById('picked').textContent = [...e.target.files].map((f) => f.name + ':' + f.size).join(',');
});</script>`;
const server = createServer((_, res) => { res.setHeader('content-type', 'text/html'); res.end(PAGE); });

async function scenario(name, view) {
  log(`==== ${name} ====`);
  const wc = view.webContents;
  const dbg = wc.debugger;
  dbg.attach('1.3');
  const events = [];
  dbg.on('message', (_e, method, params) => { if (method === 'Page.fileChooserOpened') events.push({ params, at: ms() }); });
  const send = async (method, params) => { try { return { ok: await dbg.sendCommand(method, params) }; } catch (e) { return { error: e.message }; } };
  const evaluate = async (expression) => (await dbg.sendCommand('Runtime.evaluate', { expression, returnByValue: true })).result.value;
  log(name, 'Page.enable', JSON.stringify(await send('Page.enable')));
  log(name, 'setInterceptFileChooserDialog {enabled:true}', JSON.stringify(await send('Page.setInterceptFileChooserDialog', { enabled: true })));

  const box = await evaluate(`(() => { const r = document.getElementById('file').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  log(name, 'visibilityState:', await evaluate('document.visibilityState'));
  // Playwright's attach sends this, and E4c measured it makes a hidden/unattached page visible and clickable
  log(name, 'Emulation.setFocusEmulationEnabled {enabled:true}', JSON.stringify(await send('Emulation.setFocusEmulationEnabled', { enabled: true })));
  log(name, 'visibilityState:', await evaluate('document.visibilityState'), '| viewport:', await evaluate('innerWidth + "x" + innerHeight'), '| userActivation.hasBeenActive before:', await evaluate('navigator.userActivation.hasBeenActive'));
  // trigger A: a trusted click through Input.dispatchMouseEvent at the input's centre
  let clickAt = ms();
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await dbg.sendCommand('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  }
  for (let i = 0; i < 20 && events.length === 0; i++) await sleep(100);
  const seenA = await evaluate('JSON.stringify(seen)');
  log(name, 'trigger A (Input.dispatchMouseEvent at', JSON.stringify(box) + '): page saw', seenA, '| hasBeenActive:', await evaluate('navigator.userActivation.hasBeenActive'), '| fileChooserOpened:', events.length);
  if (events.length === 0) {
    if (seenA.includes('click@file')) { log(name, 'the input was clicked but NO Page.fileChooserOpened: exiting now (a native panel may be open)'); app.exit(3); return; }
    // trigger B: the input's click() from an evaluate that carries a user gesture
    clickAt = ms();
    log(name, 'trigger B Runtime.evaluate {userGesture:true} input.click():', JSON.stringify(await send('Runtime.evaluate', { expression: `document.getElementById('file').click(); 'clicked'`, userGesture: true })));
    for (let i = 0; i < 20 && events.length === 0; i++) await sleep(100);
    if (events.length === 0) { log(name, 'trigger B: NO Page.fileChooserOpened within 2 s: exiting now (a native panel may be open)'); app.exit(3); return; }
  }
  const ev = events[0];
  log(name, 'Page.fileChooserOpened', JSON.stringify(ev.params), `(+${ev.at - clickAt} ms after the click)`);

  const set = await send('DOM.setFileInputFiles', { files: [upload], backendNodeId: ev.params.backendNodeId });
  await sleep(200);
  log(name, 'DOM.setFileInputFiles', JSON.stringify(set), '| #picked:', JSON.stringify(await evaluate(`document.getElementById('picked').textContent`)), '| input.files.length:', await evaluate(`document.getElementById('file').files.length`));
  log(name, 'setInterceptFileChooserDialog {enabled:false}', JSON.stringify(await send('Page.setInterceptFileChooserDialog', { enabled: false })));
  log(name, 'fileChooserOpened events total:', events.length, '| renderer crashed?', wc.isCrashed());
}

app.whenReady().then(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  log('electron', process.versions.electron, 'chrome', process.versions.chrome, 'url', url, 'upload', upload);
  const win = new BaseWindow({ width: 800, height: 600, show: false });
  win.on('sheet-begin', () => log('SHEET BEGIN (a native sheet opened)'));
  const placed = new WebContentsView();
  win.contentView.addChildView(placed);
  placed.setBounds({ x: 0, y: 0, width: 800, height: 600 });
  await placed.webContents.loadURL(url);
  await scenario('placed', placed);

  const unplaced = new WebContentsView();
  unplaced.setBounds({ x: 0, y: 0, width: 800, height: 600 }); // E4c variant (b), the agent tab's parking shape
  unplaced.setVisible(true);
  await unplaced.webContents.loadURL(url);
  await scenario('unplaced', unplaced);
  log('DONE total ms', ms());
  app.exit(0);
});
