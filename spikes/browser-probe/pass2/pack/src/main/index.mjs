// (6): the packaged driver app. Runs from inside an asar: opens a window with a page, starts E0b's debugger bridge,
// connects playwright-core over it, snapshots and clicks, and writes what happened to $PROBE_PACK_RESULT after every
// step (so a hang leaves its last step on disk). playwright-core is loaded inside main through a dynamic import that
// the build compiles to require() (bundled or external, as the variant says), in a try, so a failure inside the asar
// is a recorded step rather than Electron's uncaught-exception dialog.
import { app, BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { startDebuggerBridge } from '../../../../cdp/bridge.mjs';

const require = createRequire(import.meta.url);
const resolvedPath = (name) => { try { return require.resolve(name); } catch (e) { return `not resolvable at run time: ${e.message.split('\n')[0]}`; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();
const resultFile = process.env.PROBE_PACK_RESULT ?? '/tmp/maws-e4-0/pack-result.json';
const out = { steps: [], errors: [] };
const flush = () => { try { writeFileSync(resultFile, JSON.stringify(out, null, 2)); } catch (e) { console.error('cannot write result', e); } };
const step = (name, value) => { out.steps.push({ name, at: Math.round(now()), ...value }); flush(); };
app.setPath('userData', '/tmp/maws-e4-0/userData-pack');
process.on('uncaughtException', (e) => { out.errors.push(`uncaught: ${(e.stack ?? String(e)).split('\n').slice(0, 6).join('\n')}`); finish(1); });
process.on('unhandledRejection', (e) => { out.errors.push(`unhandled: ${(e?.stack ?? String(e)).split('\n').slice(0, 6).join('\n')}`); finish(1); });

function finish(code) {
  flush();
  setTimeout(() => process.kill(process.pid, 'SIGKILL'), 2000).unref();
  app.exit(code);
}

async function main() {
  step('ready', {
    filename: typeof __filename === 'string' ? __filename : null,
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    insideAsar: /app\.asar/.test(app.getAppPath()),
    electron: process.versions.electron,
  });
  let chromium;
  try {
    const t = now();
    ({ chromium } = await import('playwright-core'));
    step('load playwright-core', { ok: true, ms: Math.round(now() - t), resolvedAtRunTime: resolvedPath('playwright-core'), bufferutilAtRunTime: resolvedPath('bufferutil') });
  } catch (e) {
    step('load playwright-core', { ok: false, error: (e.stack ?? String(e)).split('\n').slice(0, 4).join('\n') });
    return finish(1);
  }
  const win = new BrowserWindow({ width: 500, height: 300, show: false, webPreferences: { sandbox: true } });
  await win.loadURL('data:text/html,<title>packed</title><button id="b" onclick="this.textContent=\'clicked\'">Click me</button><input aria-label="Name">');
  win.showInactive();
  await sleep(200);
  step('window', { ok: true });
  let bridge;
  let browser;
  try {
    const t0 = now();
    bridge = await startDebuggerBridge(win.webContents, { log: () => {} });
    step('bridge start', { ok: true, ms: Math.round((now() - t0) * 10) / 10 });
    const t1 = now();
    browser = await Promise.race([chromium.connectOverCDP(bridge.wsUrl), sleep(15000).then(() => { throw new Error('connectOverCDP timed out'); })]);
    step('connectOverCDP', { ok: true, ms: Math.round((now() - t1) * 10) / 10, version: browser.version() });
    const page = browser.contexts()[0]?.pages()[0];
    if (!page) throw new Error('no page announced');
    page.setDefaultTimeout(8000);
    const t2 = now();
    const snap = await page.ariaSnapshot({ mode: 'ai' });
    step('ariaSnapshot', { ok: true, ms: Math.round((now() - t2) * 10) / 10, chars: snap.length, text: snap });
    const ref = /button "Click me" \[ref=([a-z0-9]+)\]/.exec(snap)?.[1];
    const t3 = now();
    await page.locator(`aria-ref=${ref}`).click();
    step('click by ref', { ok: true, ms: Math.round((now() - t3) * 10) / 10, textAfter: await page.locator('#b').textContent() });
    await page.getByLabel('Name').fill('packed');
    step('fill', { ok: true, value: await page.getByLabel('Name').inputValue() });
    const shot = await page.screenshot();
    step('screenshot', { ok: true, bytes: shot.length });
    step('evaluate', { ok: true, title: await page.evaluate(() => document.title) });
  } catch (e) {
    out.errors.push((e.stack ?? String(e)).split('\n').slice(0, 6).join('\n'));
  }
  try { await browser?.close(); } catch { /* closed */ }
  try { await bridge?.close(); } catch { /* closed */ }
  finish(out.errors.length ? 1 : 0);
}

app.whenReady().then(main).catch((e) => { out.errors.push((e.stack ?? String(e)).split('\n').slice(0, 6).join('\n')); finish(1); });
app.on('window-all-closed', () => {});
