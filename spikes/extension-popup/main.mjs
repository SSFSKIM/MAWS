// The spike's Electron main (run by run.mjs; no MAWS code): one persistent partition with a frame preload registered on
// its session as MAWS registers its browser preload, a BaseWindow with an http page view standing in for a tab, every
// extension loaded with `allowFileAccess: false` as MAWS's loader does, then for each one its default_popup in a
// WebContentsView of that session (sandbox, contextIsolation, enablePreferredSizeMode) laid over the window. Prints
// `[spike]` lines only; user data under SPIKE_SCRATCH/userData.
import { app, BaseWindow, WebContentsView, ipcMain, session } from 'electron';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scratch = process.env.SPIKE_SCRATCH;
const extensions = JSON.parse(process.env.SPIKE_EXTENSIONS ?? '[]');
const show = process.env.SPIKE_SHOW === '1';
app.setPath('userData', join(scratch, 'userData'));
app.setPath('sessionData', join(scratch, 'userData'));

const log = (...parts) => console.log('[spike]', ...parts);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (v) => JSON.stringify(v);
const short = (s, n = 160) => (s.length > n ? `${s.slice(0, n)}…` : s);
setTimeout(() => { log('watchdog: 180 s elapsed, exiting'); app.exit(2); }, 180_000).unref();

const preloadHits = [];
ipcMain.on('spike:preload', (_event, href) => preloadHits.push(href));
const created = [];
app.on('web-contents-created', (_e, wc) => created.push(wc));

function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><title>spike page ${req.url}</title><p>spike page ${req.url}</p>`);
    });
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

async function pollEval(wc, expr, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (wc.isDestroyed()) return undefined;
    const v = await wc.executeJavaScript(expr).catch(() => undefined);
    if (v !== undefined && v !== null) return v;
    await sleep(100);
  }
  return undefined;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// One extension page in a view, as M3's popup view would host it.
async function openInView(win, ses, url, { anchorX = 640, anchorY = 44 } = {}) {
  const view = new WebContentsView({ webPreferences: { session: ses, sandbox: true, contextIsolation: true, enablePreferredSizeMode: true } });
  const wc = view.webContents;
  const rec = { sizes: [], opens: [], navigations: [], console: [], failed: null, crashed: null };
  wc.on('preferred-size-changed', (_e, size) => {
    rec.sizes.push(`${size.width}x${size.height}`);
    view.setBounds({ x: anchorX, y: anchorY, width: clamp(size.width, 25, 800), height: clamp(size.height, 25, 600) });
  });
  wc.setWindowOpenHandler((details) => { rec.opens.push({ url: details.url, disposition: details.disposition }); return { action: 'deny' }; });
  wc.on('will-navigate', (event) => { rec.navigations.push(event.url); event.preventDefault(); });
  wc.on('console-message', (event) => { if (event.level === 'error' || event.level === 'warning') rec.console.push(`${event.level}: ${short(event.message)}`); });
  wc.on('did-fail-load', (_e, code, desc, validatedURL, isMainFrame) => { if (isMainFrame) rec.failed = `${code} ${desc} ${validatedURL}`; });
  wc.on('render-process-gone', (_e, d) => { rec.crashed = d.reason; });
  win.contentView.addChildView(view);
  view.setBounds({ x: anchorX, y: anchorY, width: 25, height: 25 });
  let loadError = null;
  await wc.loadURL(url).catch((e) => { loadError = String(e.message ?? e); });
  rec.loadError = loadError;
  rec.view = view;
  rec.wc = wc;
  return rec;
}

function close(win, rec) {
  win.contentView.removeChildView(rec.view);
  if (!rec.wc.isDestroyed()) rec.wc.close();
}

const preloadRan = (prefix) => (preloadHits.some((h) => h.startsWith(prefix)) ? 'yes' : 'no');

async function probeExtension(win, ses, spec, ext, origin) {
  const tag = `[${spec.name}]`;
  const manifest = ext.manifest;
  const action = manifest.action ?? manifest.browser_action ?? null;
  const popup = action?.default_popup ?? null;
  const options = manifest.options_ui?.page ?? manifest.options_page ?? null;
  log(tag, `manifest: v${manifest.manifest_version} ${json(manifest.name)} ${manifest.version} background=${json(manifest.background ?? null)} popup=${json(popup)} options=${json(options)}`);

  if (popup) {
    const url = `${ext.url}${popup}`;
    const rec = await openInView(win, ses, url);
    const loaded = rec.loadError === null && rec.failed === null && !rec.wc.isDestroyed() && rec.wc.getURL().startsWith(ext.url);
    log(tag, `loaded: ${loaded ? 'yes' : 'no'}${loaded ? '' : ` (${rec.loadError ?? rec.failed})`} url=${rec.wc.isDestroyed() ? '-' : rec.wc.getURL()}`);
    let result;
    if (spec.kind === 'probe') {
      result = await pollEval(rec.wc, 'window.__popupResult ?? null', 8000);
      log(tag, `ping reply: ${result ? json(result.ping) : 'no result'}`);
      log(tag, `connect reply: ${result ? json(result.connect) : 'no result'}`);
      log(tag, `tabs.query: ${result ? json(result.tabsActive) : 'no result'}`);
      log(tag, `tabs.query({}): ${result ? json(result.tabsAll) : 'no result'}`);
      log(tag, `popup sees: ${result ? json(result.api) : 'no result'}`);
    } else {
      await sleep(4000);
      const text = await rec.wc.executeJavaScript('document.title + " | body text " + (document.body ? document.body.innerText.length : 0) + " chars"').catch((e) => `eval failed: ${e.message}`);
      log(tag, `page: ${short(text)}`);
    }
    await sleep(800);
    log(tag, `preferred size: ${rec.sizes.length ? rec.sizes.at(-1) : 'none'} (events: ${rec.sizes.join(' ') || 'none'}; view bounds ${json(rec.view.getBounds())})`);
    log(tag, `preload ran: ${preloadRan(url)}`);
    // A still of the popup as hosted (scratch/shots, never committed), to see what the page drew.
    const shots = join(scratch, 'shots');
    mkdirSync(shots, { recursive: true });
    const still = await rec.wc.capturePage().catch((e) => e);
    if (still instanceof Error) log(tag, `still: capturePage failed (${still.message})`);
    else if (still.isEmpty()) log(tag, 'still: empty image');
    else { writeFileSync(join(shots, `${spec.name}-popup.png`), still.toPNG()); log(tag, `still: scratch/shots/${spec.name}-popup.png ${still.getSize().width}x${still.getSize().height}`); }
    if (rec.console.length) log(tag, `console (${rec.console.length}): ${rec.console.slice(0, 4).join(' || ')}`);
    if (rec.crashed) log(tag, `crashed: ${rec.crashed}`);

    if (spec.kind === 'probe' && loaded) {
      // For M3: does the popup's window.open / target=_blank / same-frame link reach the view's handlers?
      await rec.wc.executeJavaScript(`window.open(${json(`${origin}/from-popup?via=window.open`)}); 1`, true).catch(() => {});
      await sleep(300);
      await rec.wc.executeJavaScript(`(() => { const a = document.getElementById('newtab'); a.href = ${json(`${origin}/from-popup?via=target-blank`)}; a.click(); return 1; })()`, true).catch(() => {});
      await sleep(300);
      await rec.wc.executeJavaScript(`(() => { const a = document.getElementById('same'); a.href = ${json(`${origin}/from-popup?via=same-frame-link`)}; a.click(); return 1; })()`, true).catch(() => {});
      await sleep(300);
      await rec.wc.executeJavaScript(`window.open('options.html'); 1`, true).catch(() => {});
      await sleep(300);
      log(tag, `setWindowOpenHandler saw: ${json(rec.opens)}`);
      log(tag, `will-navigate saw: ${json(rec.navigations)}`);
      // chrome.runtime.openOptionsPage from the popup
      const before = created.length;
      const opened = await rec.wc.executeJavaScript(`new Promise((r) => { try { chrome.runtime.openOptionsPage(() => r(chrome.runtime.lastError ? 'lastError: ' + chrome.runtime.lastError.message : 'callback ok')); setTimeout(() => r('no callback in 2000 ms'), 2000); } catch (e) { r('threw: ' + e.message); } })`, true).catch((e) => `eval failed: ${e.message}`);
      await sleep(500);
      const fresh = created.slice(before).map((wc) => (wc.isDestroyed() ? 'destroyed' : `${wc.getType()} ${wc.getURL()}`));
      log(tag, `openOptionsPage: ${opened}; new webContents: ${json(fresh)}; opener view handler saw since: ${json(rec.opens.slice(4))}`);
    }
    close(win, rec);
  } else {
    log(tag, 'loaded: n/a (no default_popup in the manifest)');
  }

  if (options) {
    const url = `${ext.url}${options}`;
    const rec = await openInView(win, ses, url, { anchorX: 40, anchorY: 300 });
    const loaded = rec.loadError === null && rec.failed === null && rec.wc.getURL().startsWith(ext.url);
    const seen = spec.kind === 'probe' ? await pollEval(rec.wc, 'window.__optionsResult ?? null', 3000) : await rec.wc.executeJavaScript('document.title').catch(() => null);
    log(tag, `options page in a view: loaded ${loaded ? 'yes' : `no (${rec.loadError ?? rec.failed})`}; title ${json(rec.wc.getTitle())}; page says ${json(seen ?? null)}; preload ran: ${preloadRan(url)}`);
    if (spec.kind !== 'probe' && rec.console.length) log(tag, `options console (${rec.console.length}): ${rec.console.slice(0, 3).join(' || ')}`);
    close(win, rec);
  }
}

// What Electron offers that could fire chrome.action.onClicked.
async function probeOnClicked(win, ses, page, ext) {
  const tag = '[mv3-nopopup]';
  const names = (o) => { const out = new Set(); for (let p = o; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) for (const k of Object.getOwnPropertyNames(p)) out.add(k); return [...out]; };
  log(tag, `session.extensions members: ${json(names(ses.extensions).filter((k) => !k.startsWith('_') && k !== 'constructor').sort())}`);
  const running = ses.serviceWorkers.getAllRunning();
  const entry = Object.entries(running).find(([, info]) => info.scope.startsWith(ext.url));
  let worker = null;
  if (entry) worker = ses.serviceWorkers.getWorkerFromVersionID(Number(entry[0]));
  log(tag, `ServiceWorkerMain for the extension: ${worker ? 'yes' : 'no'}${worker ? `; members ${json(names(worker).filter((k) => !k.startsWith('_') && k !== 'constructor').sort())}` : ''}`);
  // CDP's Extensions.triggerAction (Chrome's "run an extension's default action"), from the tab's debugger.
  let cdp;
  try {
    page.webContents.debugger.attach('1.3');
    const { targetInfo } = await page.webContents.debugger.sendCommand('Target.getTargetInfo');
    cdp = await page.webContents.debugger.sendCommand('Extensions.triggerAction', { id: ext.id, targetId: targetInfo.targetId }).then((r) => `ok ${json(r)}`, (e) => `error: ${e.message}`);
    page.webContents.debugger.detach();
  } catch (e) {
    cdp = `error: ${e.message}`;
  }
  log(tag, `CDP Extensions.triggerAction: ${cdp}`);
  await sleep(800);
  const rec = await openInView(win, ses, `${ext.url}options.html`, { anchorX: 40, anchorY: 300 });
  const stored = await rec.wc.executeJavaScript('chrome.storage.local.get(["clicks", "onClickedType"])').catch((e) => ({ error: e.message }));
  close(win, rec);
  log(tag, `sw sees chrome.action.onClicked.addListener as: ${json(stored.onClickedType ?? null)}; clicks recorded: ${json(stored.clicks ?? [])}`);
  log(tag, `onClicked: ${(stored.clicks ?? []).length ? 'fired' : 'no API'}`);
}

app.whenReady().then(async () => {
  log(`electron ${process.versions.electron} chrome ${process.versions.chrome} show=${show}`);
  const origin = await startServer();
  const ses = session.fromPartition('persist:spike-extension-popup');
  ses.registerPreloadScript({ type: 'frame', id: 'spike-frame', filePath: join(here, 'preload.cjs') });
  const win = new BaseWindow({ width: 1100, height: 760, show, x: 60, y: 60 });
  const page = new WebContentsView({ webPreferences: { session: ses, sandbox: true, contextIsolation: true } });
  win.contentView.addChildView(page);
  page.setBounds({ x: 0, y: 0, width: 1100, height: 760 });
  await page.webContents.loadURL(`${origin}/tab`);
  log(`tab page loaded: ${page.webContents.getURL()} (webContents id ${page.webContents.id}); preload ran there: ${preloadRan(`${origin}/tab`)}`);

  const loaded = new Map();
  for (const spec of extensions) {
    if (spec.blocked) { log(`[${spec.name}]`, spec.blocked); continue; }
    try {
      const ext = await ses.extensions.loadExtension(spec.dir, { allowFileAccess: false });
      loaded.set(spec.name, ext);
      log(`[${spec.name}]`, `loadExtension: ok id ${ext.id}`);
    } catch (e) {
      log(`[${spec.name}]`, `loadExtension: failed (${short(String(e.message ?? e), 300)})`);
    }
  }
  await sleep(1500); // let backgrounds start
  const running = Object.values(ses.serviceWorkers.getAllRunning()).map((i) => i.scope);
  log(`running service workers: ${json(running)}`);
  const bgPages = created.filter((wc) => !wc.isDestroyed() && wc.getType() === 'backgroundPage').map((wc) => wc.getURL());
  log(`background pages: ${json(bgPages)}`);

  for (const spec of extensions) {
    const ext = loaded.get(spec.name);
    if (!ext || spec.name === 'mv3-nopopup') continue;
    await probeExtension(win, ses, spec, ext, origin);
  }
  if (loaded.has('mv3-nopopup')) await probeOnClicked(win, ses, page, loaded.get('mv3-nopopup'));
  log(`preload documents (all): ${json([...new Set(preloadHits.map((h) => h.replace(/\?.*$/, '')))])}`);
  log('done');
  app.exit(0);
}).catch((e) => { log(`fatal: ${e.stack ?? e}`); app.exit(1); });
