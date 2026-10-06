// The probe app: a BaseWindow with a WebContentsView (the in-app browser stand-in), a local HTTP server for the test
// pages, and the scenarios. Launch: `electron . --scenario=<cdp-port|cdp-bridge|cdp-pipe|import|extensions|all>`.
// Results print as `[probe]` lines and land in out/<scenario>.json. The app quits when the scenario ends (except
// cdp-pipe, which an external launcher drives and closes).
import { app, BaseWindow, WebContentsView, session, ipcMain } from 'electron';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { startDebuggerBridge } from './cdp/bridge.mjs';
import { findProbePage, inventory, runDriver } from './cdp/driver.mjs';
import { buildSyntheticProfile, SYNTHETIC_LOGINS } from './import/synthetic.mjs';
import { deriveKey } from './import/crypto.mjs';
import { readCookieRows, readHistory, readLocalStateProfiles, readLogins, toElectronCookie } from './import/stores.mjs';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const now = () => performance.now();
const round = (n) => Math.round(n * 10) / 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, label) => Promise.race([p, sleep(ms).then(() => { throw new Error(`${label}: timed out after ${ms}ms`); })]);

const args = Object.fromEntries(process.argv.slice(1).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const scenario = args.scenario ?? 'all';
const HTTP_PORT = 17333;
const CDP_PORT = Number(process.env.PROBE_CDP_PORT ?? 9339);
const PARTITION = 'persist:maws-probe';
const SCRATCH_CHROME = process.env.PROBE_CHROME_COPY ?? '/tmp/maws-e0b-chrome/Default';
const SYNTH_DIR = process.env.PROBE_SYNTH_DIR ?? '/tmp/maws-e0b-synth';
const useRemotePort = scenario === 'cdp-port' || scenario === 'all';
if (useRemotePort) app.commandLine.appendSwitch('remote-debugging-port', String(CDP_PORT));

const log = (...a) => console.log('[probe]', ...a);
const results = { scenario, electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, startedAt: new Date().toISOString() };

// ---- local server: the test pages, a cookie echo, the extension report sink ----
const extReports = [];
function startServer() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${HTTP_PORT}`);
    if (url.pathname === '/echo-cookies') {
      res.setHeader('content-type', 'text/plain');
      res.end(JSON.stringify({ cookie: req.headers.cookie ?? null }));
      return;
    }
    if (url.pathname === '/ext-report' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try { extReports.push({ from: url.searchParams.get('from'), ...JSON.parse(body) }); } catch { extReports.push({ from: url.searchParams.get('from'), raw: body }); }
        res.setHeader('access-control-allow-origin', '*');
        res.end('ok');
      });
      return;
    }
    if (url.pathname === '/login' && req.method === 'POST') { res.end('ok'); return; }
    const file = join(here, 'page', url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(join(here, 'page')) || !existsSync(file)) { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(HTTP_PORT, '127.0.0.1', () => resolve(server)));
}
const PAGE_URL = `http://127.0.0.1:${HTTP_PORT}/index.html`;

// ---- the window and the view ----
let win;
let view;
let shellView;
function makeWindow({ withShell }) {
  win = new BaseWindow({ width: 1100, height: 820, show: true, title: 'MAWS browser probe' });
  const shellHeight = withShell ? 60 : 0;
  if (withShell) {
    // A stand-in for MAWS's own renderer: shows what a remote-debugging port exposes beside the browser view.
    shellView = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true } });
    win.contentView.addChildView(shellView);
    shellView.setBounds({ x: 0, y: 0, width: 1100, height: shellHeight });
    shellView.webContents.loadURL('data:text/html,<title>MAWS shell stand-in</title><body style="font:14px system-ui;margin:12px">MAWS shell stand-in (a second WebContents in the same app)</body>');
  }
  view = new WebContentsView({
    webPreferences: { preload: join(here, 'preload.cjs'), sandbox: false, contextIsolation: true, nodeIntegration: false, partition: PARTITION },
  });
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: shellHeight, width: 1100, height: 820 - shellHeight });
  win.on('resize', () => { const b = win.getContentBounds(); view.setBounds({ x: 0, y: shellHeight, width: b.width, height: b.height - shellHeight }); });
  const ses = session.fromPartition(PARTITION);
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  return ses;
}

const picks = [];
ipcMain.on('probe:pick', (_e, picked) => picks.push(picked));

async function loadTimed(wc, url) {
  const t = now();
  await wc.loadURL(url);
  return round(now() - t);
}
async function idleCpu(wc, ms) {
  const pid = wc.getOSProcessId();
  app.getAppMetrics();
  await sleep(ms);
  const m = app.getAppMetrics().find((p) => p.pid === pid);
  const main = app.getAppMetrics().find((p) => p.pid === process.pid);
  return { rendererPercentCPU: round(m?.cpu.percentCPUUsage ?? -1), rendererWorkingSetKB: m?.memory?.workingSetSize ?? null, mainPercentCPU: round(main?.cpu.percentCPUUsage ?? -1) };
}
async function jsThroughput(wc) {
  return round(await wc.executeJavaScript(`(() => { const t = performance.now(); let x = 0; for (let i = 0; i < 3e7; i++) x = (x + i) | 0; return performance.now() - t; })()`));
}
async function loadSeries(wc, n) {
  const s = [];
  for (let i = 0; i < n; i++) s.push(await loadTimed(wc, PAGE_URL));
  return s;
}
const altClickVia = (wc) => async (x, y) => {
  wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1, modifiers: ['alt'] });
  wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1, modifiers: ['alt'] });
};
const cssPathSource = readFileSync(join(here, 'shared', 'locator.cjs'), 'utf8').replace(/module\.exports[^\n]*\n?/g, '');

// ---- S2 (a) route 1: --remote-debugging-port ----
async function cdpPortScenario() {
  const { chromium } = require('playwright-core');
  const wc = view.webContents;
  const out = { route: 'remote-debugging-port', endpoint: `http://127.0.0.1:${CDP_PORT}` };
  await loadTimed(wc, PAGE_URL);
  out.before = { idle: await idleCpu(wc, 2000), jsLoopMs: await jsThroughput(wc), loadMs: await loadSeries(wc, 5) };

  const t0 = now();
  const browser = await withTimeout(chromium.connectOverCDP(out.endpoint), 15000, 'connectOverCDP(port)');
  out.attachMs = round(now() - t0);
  out.inventory = inventory(browser);
  out.attached = { idle: await idleCpu(wc, 2000), jsLoopMs: await jsThroughput(wc), loadMs: await loadSeries(wc, 5) };
  const page = await findProbePage(browser, `http://127.0.0.1:${HTTP_PORT}/`);
  if (!page) throw new Error(`no page for ${PAGE_URL} in ${JSON.stringify(out.inventory)}`);
  out.driver = await runDriver({ browser, page, pageUrl: PAGE_URL, cssPathSource, log, sendInputEvent: altClickVia(wc) });
  out.ipcPicks = picks.length;

  // webContents.debugger beside a connected Playwright client
  out.debuggerBeside = {};
  try {
    wc.debugger.attach('1.3');
    out.debuggerBeside.attach = 'ok';
    out.debuggerBeside.evaluateFromMain = (await wc.debugger.sendCommand('Runtime.evaluate', { expression: 'document.title', returnByValue: true })).result.value;
    out.debuggerBeside.playwrightStillWorks = await page.evaluate(() => document.title);
    out.debuggerBeside.playwrightClickStillWorks = await page.locator('#increment').click().then(() => 'ok', (e) => `error: ${e.message.split('\n')[0]}`);
    wc.debugger.detach();
    out.debuggerBeside.playwrightAfterDetach = await page.evaluate(() => 1 + 1);
  } catch (e) {
    out.debuggerBeside.error = e.message;
  }
  // DevTools open beside Playwright (the chrome has an Inspect item)
  try {
    wc.openDevTools({ mode: 'detach', activate: false });
    await sleep(800);
    out.devtoolsBeside = { opened: wc.isDevToolsOpened(), playwrightEvaluate: await page.evaluate(() => document.title), inventoryWhileOpen: inventory(browser).pageCount };
    wc.closeDevTools();
  } catch (e) {
    out.devtoolsBeside = { error: e.message };
  }

  const t1 = now();
  await browser.close();
  out.disconnectMs = round(now() - t1);
  out.viewAliveAfterDisconnect = await wc.executeJavaScript('document.title');
  out.after = { idle: await idleCpu(wc, 2000), jsLoopMs: await jsThroughput(wc) };
  const t2 = now();
  const browser2 = await chromium.connectOverCDP(out.endpoint);
  out.reattachMs = round(now() - t2);
  await browser2.close();
  return out;
}

// ---- S2 (a) route 2: webContents.debugger bridged to a browser-level endpoint ----
async function cdpBridgeScenario() {
  const { chromium } = require('playwright-core');
  const wc = view.webContents;
  const out = { route: 'webContents.debugger bridge' };
  await loadTimed(wc, PAGE_URL);
  out.before = { idle: await idleCpu(wc, 2000), jsLoopMs: await jsThroughput(wc), loadMs: await loadSeries(wc, 5) };
  const t0 = now();
  const bridge = await startDebuggerBridge(wc, { log });
  out.bridgeStartMs = round(now() - t0);
  out.endpoint = bridge.wsUrl;
  const t1 = now();
  const browser = await withTimeout(chromium.connectOverCDP(bridge.wsUrl), 15000, 'connectOverCDP(bridge)');
  out.attachMs = round(now() - t1);
  out.inventory = inventory(browser);
  out.attached = { idle: await idleCpu(wc, 2000), jsLoopMs: await jsThroughput(wc), loadMs: await loadSeries(wc, 5) };
  out.pageLookup = [];
  const page = await findProbePage(browser, `http://127.0.0.1:${HTTP_PORT}/`, { timeoutMs: 2000, diagnostics: out.pageLookup });
  if (!page) throw new Error(`bridge: no page in ${JSON.stringify(out.inventory)} ${JSON.stringify(out.pageLookup)}`);
  out.clientUrlTracking = { atLookup: out.pageLookup[0]?.clientUrl ?? page.url() };
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) out.clientUrlTracking.lastNavigatedEvent = f.url(); });
  out.driver = await runDriver({ browser, page, pageUrl: PAGE_URL, cssPathSource, log, sendInputEvent: altClickVia(wc) });
  out.ipcPicks = picks.length;
  out.newPage = await browser.contexts()[0].newPage().then(() => 'unexpectedly ok', (e) => `error: ${e.message.split('\n')[0]}`);
  out.debuggerBeside = {};
  try {
    wc.debugger.attach('1.3');
    out.debuggerBeside.secondAttach = 'ok (no throw)';
  } catch (e) {
    out.debuggerBeside.secondAttach = `throws: ${e.message}`;
  }
  out.debuggerBeside.mainSendCommandSharesSession = (await wc.debugger.sendCommand('Runtime.evaluate', { expression: 'document.title', returnByValue: true })).result.value;
  out.debuggerBeside.playwrightStillWorks = await page.evaluate(() => document.title);
  try {
    wc.openDevTools({ mode: 'detach', activate: false });
    await sleep(800);
    out.devtoolsBeside = { opened: wc.isDevToolsOpened(), playwrightEvaluate: await page.evaluate(() => document.title), debuggerStillAttached: wc.debugger.isAttached() };
    wc.closeDevTools();
    await sleep(300);
    out.devtoolsBeside.afterClose = { playwrightEvaluate: await page.evaluate(() => 1 + 1), debuggerStillAttached: wc.debugger.isAttached() };
  } catch (e) {
    out.devtoolsBeside = { error: e.message };
  }
  out.bridgeStats = { ...bridge.stats, unknownBrowserMethods: [...bridge.stats.unknownBrowserMethods] };
  const t2 = now();
  await browser.close();
  out.disconnectMs = round(now() - t2);
  await bridge.close();
  out.viewAliveAfterClose = await wc.executeJavaScript('document.title');
  out.after = { idle: await idleCpu(wc, 2000), jsLoopMs: await jsThroughput(wc) };
  return out;
}

// ---- S1: profile import by copy ----
async function importScenario() {
  const ses = session.fromPartition(PARTITION);
  const wc = view.webContents;
  const out = {};
  const synth = buildSyntheticProfile(SYNTH_DIR);
  out.synthetic = { dir: synth.dir, note: 'key derived from a generated password written beside the stores as the Keychain stand-in; neither is printed' };
  const key = deriveKey(readFileSync(join(SYNTH_DIR, 'safe-storage-password.txt'), 'utf8'));

  // cookies: decrypt -> cookies.set -> request carries them
  await ses.clearStorageData({ storages: ['cookies'] });
  const cookieRows = readCookieRows(join(SYNTH_DIR, 'Cookies'));
  const cookieResult = { storeVersion: cookieRows.version, rows: cookieRows.rows.length, set: 0, skipped: [], errors: [], hashedPrefix: 0 };
  const t0 = now();
  for (const row of cookieRows.rows) {
    const mapped = toElectronCookie(row, key);
    if (mapped.skipped) { cookieResult.skipped.push(`${row.host_key}/${row.name}: ${mapped.skipped}`); continue; }
    if (mapped.hashed) cookieResult.hashedPrefix++;
    try { await ses.cookies.set(mapped.details); cookieResult.set++; } catch (e) { cookieResult.errors.push(`${row.host_key}/${row.name}: ${e.message}`); }
  }
  cookieResult.setMs = round(now() - t0);
  cookieResult.inJar = (await ses.cookies.get({})).map((c) => ({ domain: c.domain, name: c.name, hostOnly: c.hostOnly, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, session: c.session, hasExpiration: typeof c.expirationDate === 'number' }));
  await wc.loadURL(`http://localhost:${HTTP_PORT}/echo-cookies`);
  const echoed = JSON.parse(await wc.executeJavaScript('document.body.innerText'));
  cookieResult.sentOnRequest = { names: (echoed.cookie ?? '').split(';').map((s) => s.trim().split('=')[0]).filter(Boolean), httpOnlyIncluded: /probe_session=/.test(echoed.cookie ?? ''), valueMatches: /probe_session=synthetic-session-token-1/.test(echoed.cookie ?? '') };
  await wc.loadURL(PAGE_URL);
  cookieResult.documentCookieSeesOnlyNonHttpOnly = await wc.executeJavaScript('document.cookie');
  out.cookies = cookieResult;

  // logins: decrypt with the right key, then with a wrong key
  const logins = readLogins(join(SYNTH_DIR, 'Login Data'), key);
  const expected = SYNTHETIC_LOGINS.filter((l) => l.password);
  out.logins = {
    storeVersion: logins.version, total: logins.total, blocklist: logins.blocklist, decrypted: logins.decrypted, failed: logins.failed,
    allMatchSynthetic: expected.every((l) => logins.credentials.some((c) => c.signon_realm === l.signon_realm && c.username_value === l.username_value && c.password === l.password)),
    shapePerCredential: Object.keys(logins.credentials[0] ?? {}),
    wrongKey: (() => { const w = readLogins(join(SYNTH_DIR, 'Login Data'), deriveKey('not-the-password')); return { decrypted: w.decrypted, failed: w.failed, matchesSynthetic: w.credentials.some((c) => expected.some((l) => l.password === c.password)) }; })(),
  };
  // What Electron offers a consumer of these credentials
  out.electronConsumerSurface = {
    passwordManager: 'none (Chromium password manager is not compiled into Electron)',
    autofillApi: typeof ses.setPreloads === 'function' ? 'preload scripts only; no chrome.autofill, no Autofill CDP domain exposed through webContents' : 'unknown',
    httpAuthLogin: 'webContents "login" event handles HTTP Basic/Digest auth only',
    debuggerDomains: await (async () => {
      try {
        wc.debugger.attach('1.3');
        const r = await wc.debugger.sendCommand('Autofill.enable').then(() => 'Autofill.enable ok', (e) => `Autofill.enable: ${e.message}`);
        wc.debugger.detach();
        return r;
      } catch (e) { return `attach: ${e.message}`; }
    })(),
  };

  // the owner's real copies (counts and shapes only; no decrypt, no values)
  out.realCopies = {};
  const historyPath = join(SCRATCH_CHROME, 'History');
  if (existsSync(historyPath)) {
    const t = now();
    const h = readHistory(historyPath);
    out.realCopies.history = { ...h, readMs: round(now() - t) };
  }
  for (const name of ['Cookies']) {
    const p = join(SCRATCH_CHROME, name);
    if (!existsSync(p)) continue;
    const t = now();
    const c = readCookieRows(p);
    const prefixes = {};
    for (const r of c.rows) { const k = Buffer.from(r.encrypted_value ?? []).subarray(0, 3).toString('latin1') || '(plain)'; prefixes[k] = (prefixes[k] ?? 0) + 1; }
    out.realCopies.cookies = { storeVersion: c.version, rows: c.rows.length, prefixes, partitioned: c.rows.filter((r) => r.top_frame_site_key).length, plainValues: c.rows.filter((r) => r.value).length, distinctHosts: new Set(c.rows.map((r) => r.host_key)).size, readMs: round(now() - t), decrypted: 'not attempted (real key never fetched)' };
  }
  for (const name of ['Login Data', 'Login Data For Account']) {
    const p = join(SCRATCH_CHROME, name);
    if (!existsSync(p)) continue;
    const l = readLogins(p, null);
    out.realCopies[name] = { storeVersion: l.version, total: l.total, blocklist: l.blocklist, withEncryptedPassword: l.total - l.blocklist - l.emptyPassword, emptyPassword: l.emptyPassword, keychainIdentifierRows: l.keychainIdentifier };
  }
  const localState = join(SCRATCH_CHROME, 'Local State');
  if (existsSync(localState)) {
    const profiles = readLocalStateProfiles(readFileSync(localState, 'utf8'));
    out.realCopies.localState = { profiles: profiles.length, fieldsOfFirst: profiles[0]?.fields, everyProfileHasName: profiles.every((p) => p.hasName) };
  }
  return out;
}

// ---- S1 (d): extensions ----
async function extensionsScenario() {
  const ses = session.fromPartition(PARTITION);
  const wc = view.webContents;
  const out = {};
  await wc.loadURL('about:blank');
  extReports.length = 0;
  const t0 = now();
  const ext = await ses.extensions.loadExtension(join(here, 'ext', 'test-ext'));
  out.testExtension = { loadMs: round(now() - t0), id: ext.id, name: ext.name, version: ext.version, url: ext.url, manifestKeys: Object.keys(ext.manifest) };
  await sleep(1500);
  await wc.loadURL(PAGE_URL);
  const deadline = now() + 8000;
  while (now() < deadline && !(extReports.some((r) => r.from === 'sw' && r.trigger === 'message-after-page') && extReports.some((r) => r.from === 'cs'))) await sleep(200);
  await sleep(500);
  out.testExtension.serviceWorkersRunning = Object.values(ses.serviceWorkers.getAllRunning()).map((w) => ({ scope: w.scope, scriptUrl: w.scriptUrl }));
  out.testExtension.contentScriptMarker = await wc.executeJavaScript('document.documentElement.dataset.probeContentScript ?? null');
  out.testExtension.executeScriptMarker = await wc.executeJavaScript('document.documentElement.dataset.probeExecuteScript ?? null');
  out.testExtension.reports = extReports.map((r) => ({ from: r.from, trigger: r.trigger, present: r.present, results: r.results }));
  ses.extensions.removeExtension(ext.id);
  out.testExtension.removed = ses.extensions.getAllExtensions().length;

  // the owner's installed extensions, from the scratch copy
  out.realExtensions = [];
  const extRoot = join(SCRATCH_CHROME, 'Extensions');
  if (existsSync(extRoot)) {
    for (const id of readdirSync(extRoot).filter((d) => /^[a-p]{32}$/.test(d))) {
      const versions = readdirSync(join(extRoot, id)).filter((v) => existsSync(join(extRoot, id, v, 'manifest.json')));
      for (const v of versions) {
        const dir = join(extRoot, id, v);
        const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
        const entry = { id, version: v, manifestVersion: manifest.manifest_version, rawName: manifest.name, background: manifest.background?.service_worker ? 'service_worker' : manifest.background ? 'page/scripts' : 'none', contentScripts: (manifest.content_scripts ?? []).length };
        const t = now();
        try {
          const loaded = await withTimeout(ses.extensions.loadExtension(dir), 15000, `loadExtension ${id}`);
          entry.ok = true;
          entry.loadMs = round(now() - t);
          entry.resolvedName = loaded.name;
          await sleep(1200);
          entry.serviceWorkerRunning = Object.values(ses.serviceWorkers.getAllRunning()).some((w) => w.scope.startsWith(`chrome-extension://${id}`));
          ses.extensions.removeExtension(id);
        } catch (e) {
          entry.ok = false;
          entry.error = e.message.split('\n')[0];
          entry.loadMs = round(now() - t);
          try { ses.extensions.removeExtension(id); } catch { /* not loaded */ }
        }
        out.realExtensions.push(entry);
      }
    }
  }
  return out;
}

async function main() {
  await startServer();
  const ses = makeWindow({ withShell: useRemotePort });
  results.partitionPath = ses.storagePath;
  await view.webContents.loadURL(PAGE_URL);
  if (scenario === 'cdp-pipe') { log('hosting for an external driver (launch-pipe.mjs)'); return; }
  const run = async (name, fn) => {
    log(`--- ${name} ---`);
    const t = now();
    try { results[name] = await fn(); results[name].totalMs = round(now() - t); } catch (e) { results[name] = { error: e.stack ?? String(e) }; log(`${name} failed: ${e.message}`); }
  };
  if (scenario === 'cdp-port' || scenario === 'all') await run('cdpPort', cdpPortScenario);
  if (scenario === 'cdp-bridge' || scenario === 'all') await run('cdpBridge', cdpBridgeScenario);
  if (scenario === 'import' || scenario === 'all') await run('import', importScenario);
  if (scenario === 'extensions' || scenario === 'all') await run('extensions', extensionsScenario);
  mkdirSync(join(here, 'out'), { recursive: true });
  const file = join(here, 'out', `${scenario}.json`);
  writeFileSync(file, JSON.stringify(results, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  log(`results written to ${file}`);
  console.log(JSON.stringify(results, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  const failed = Object.values(results).some((r) => r && typeof r === 'object' && 'error' in r);
  app.exit(failed ? 1 : 0);
}

app.whenReady().then(main).catch((e) => { console.error(e); app.exit(1); });
app.on('window-all-closed', () => app.quit());
