// The spike's Electron main: one suite per launch (run.mjs launches them all), each printing `RESULT {json}` lines,
// one per condition part: { cond, part, status: pass|fail|not-run|record, observed, detail }.
//
//   electron . --suite=<name> [--ports=<file>] [--listener-log=<file>] [--dns-log=<file>] [--runs=<dir>] [--samples=<dir>]
//
// Architecture A: a window loaded as the app's is (a file page under the app's CSP, frame-src extended by maws-viewer:,
// sandbox, context isolation, a preload with one name), the frame `<iframe sandbox="allow-scripts"
// src="maws-viewer://<32 hex>/viewer.html?format=…">`, bytes in by postMessage after `ready`. Main only observes
// (no request filter, no permission handler, no WebRTC policy, no navigation guard) unless --variant says otherwise.
// Architecture B: the same page as the top-level document of a WebContentsView with a session of its own.
import { app, BrowserWindow, Menu, WebContentsView, ipcMain, nativeTheme, protocol, session } from 'electron';
import JSZip from 'jszip';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readlinkSync, statSync, writeFileSync } from 'node:fs';
import os, { homedir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const argv = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || true]; }));
const SUITE = argv.suite ?? 'basic';
const NARROW = /dns|appframe/.test(SUITE); // the DNS follow-up puts a control window beside the app's
const VARIANT = argv.variant ?? 'as-specified';
// A variant is a `+`-joined set of layers added to the setup as specified (the result of the setup as specified is
// always the `as-specified` run): rtcpolicy (the window's setWebRTCIPHandlingPolicy('disable_non_proxied_udp'), as the
// app's guardFrames), deadproxy (the window's session proxied to a port that reaches nothing, loopback included),
// perms (permission handlers that refuse maws-viewer: frames), noprefetch (app.commandLine.appendSwitch('blink-settings',
// 'dnsPrefetchingEnabled=false') before ready), offline (the frame's or view's session in offline emulation), nodnsprefetch (the viewer's answers carry
// `X-DNS-Prefetch-Control: off`), anchor (B: main moves the view with the window's resize), applayers (the app's request filter, window-open deny).
const LAYERS = new Set(VARIANT === 'as-specified' ? [] : VARIANT.split('+'));
if (LAYERS.has('app-layers')) for (const l of ['applayers', 'rtcpolicy', 'perms']) LAYERS.add(l);
// variant `noprefetch`: Blink's dnsPrefetchingEnabled setting off for every renderer, set the way the app would set it
if (LAYERS.has('noprefetch')) app.commandLine.appendSwitch('blink-settings', 'dnsPrefetchingEnabled=false');
const RUNS = argv.runs ?? join(here, 'runs');
const SAMPLES = argv.samples ?? process.env.VIEWER_SPIKE_SAMPLES ?? join(homedir(), 'preview-probe', 'samples');
const VIEWER_DIR = join(here, 'out', 'viewer');
const MANIFEST = new Set(JSON.parse(readFileSync(join(VIEWER_DIR, 'manifest.json'), 'utf8')));
mkdirSync(RUNS, { recursive: true });
const execFileP = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mint = () => randomBytes(16).toString('hex');
const t0 = performance.now();
const since = () => Math.round(performance.now() - t0);

function report(cond, part, status, observed, detail) {
  process.stdout.write(`RESULT ${JSON.stringify({ suite: SUITE, variant: VARIANT, cond: String(cond), part, status, observed, detail })}\n`);
}
const note = (...a) => process.stdout.write(`NOTE [${since()} ms] ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`);

// ---- policies ---------------------------------------------------------------------------------------------------------
const policy = ({ script, connect, webrtc = true }) => [
  'sandbox allow-scripts', "default-src 'none'", `script-src ${script}`, "style-src maws-viewer: 'unsafe-inline'", 'img-src maws-viewer: data: blob:',
  'font-src maws-viewer: data: blob:', `connect-src ${connect}`, "media-src 'none'", "worker-src 'none'", "frame-src 'none'", "object-src 'none'",
  "base-uri 'none'", "form-action 'none'", ...(webrtc ? ["webrtc 'block'"] : []),
].join('; ');
const POLICIES = {
  word: policy({ script: 'maws-viewer:', connect: "'none'" }),
  excel: policy({ script: "maws-viewer: 'wasm-unsafe-eval'", connect: 'maws-viewer: data: blob:' }),
  'word-noblock': policy({ script: 'maws-viewer:', connect: "'none'", webrtc: false }),
  'excel-noblock': policy({ script: "maws-viewer: 'wasm-unsafe-eval'", connect: 'maws-viewer: data: blob:', webrtc: false }),
  // B: the file is fetched once from the page's own host, so the Word policy admits its own scheme for that one fetch.
  'b-word': policy({ script: 'maws-viewer:', connect: 'maws-viewer:' }),
  'b-word-noblock': policy({ script: 'maws-viewer:', connect: 'maws-viewer:', webrtc: false }),
  none: null, // the control: an unrestricted page
  // the DNS follow-up's patched-factory mode: every HTML string sink goes through the page's Trusted Types default policy
  'word-tt': `${policy({ script: 'maws-viewer:', connect: "'none'" })}; require-trusted-types-for 'script'; trusted-types default raw`,
  'excel-tt': `${policy({ script: "maws-viewer: 'wasm-unsafe-eval'", connect: 'maws-viewer: data: blob:' })}; require-trusted-types-for 'script'; trusted-types default raw`,
};
const byFormat = (format) => (format === 'xlsx' ? 'excel' : 'word');
const hostPolicy = new Map(); // host -> a POLICIES key; the spike's harness chooses, a product would not
const onceFiles = new Map(); // host -> bytes served once at /file (B)
const schemeLog = [];
const artifactLog = [];

// The app's renderer CSP (src/main/csp.ts, production), frame-src extended by maws-viewer:.
const WINDOW_CSP = [
  ["default-src", "'self'"], ['script-src', "'self'"], ['style-src', "'self'", "'unsafe-inline'"], ['img-src', "'self'", 'data:', 'blob:', 'maws-artifact:'],
  ['font-src', "'self'", 'data:', 'maws-artifact:'], ['connect-src', "'self'"], ['frame-src', "'self'", 'maws-artifact:', 'maws-viewer:'], ['media-src', "'self'", 'maws-artifact:'],
].map((d) => d.join(' ')).join('; ');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css' };

// The scheme: GET/HEAD of the fixed list for any host of 32 hex characters; `nosniff`, `ACAO: *` and the policy.
async function viewerScheme(request) {
  const url = new URL(request.url);
  schemeLog.push({ at: since(), method: request.method, url: request.url });
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('method not allowed', { status: 405 });
  if (!/^[0-9a-f]{32}$/.test(url.hostname)) return new Response('not found', { status: 404 });
  const name = url.pathname.slice(1);
  const key = hostPolicy.get(url.hostname) ?? byFormat(url.searchParams.get('format'));
  const headers = { 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
  if (POLICIES[key]) headers['Content-Security-Policy'] = POLICIES[key];
  if (LAYERS.has('nodnsprefetch')) headers['X-DNS-Prefetch-Control'] = 'off'; // variant: no DNS prefetch for the page
  if (name === 'file' && onceFiles.has(url.hostname)) {
    const bytes = onceFiles.get(url.hostname);
    onceFiles.delete(url.hostname); // served once
    return new Response(request.method === 'HEAD' ? null : bytes, { status: 200, headers: { ...headers, 'Content-Type': 'application/octet-stream' } });
  }
  if (!MANIFEST.has(name)) return new Response('not found', { status: 404, headers });
  const body = readFileSync(join(VIEWER_DIR, name));
  return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers: { ...headers, 'Content-Type': TYPES[extname(name)] ?? 'application/octet-stream' } });
}
// The app's store scheme, standing for "an artifact the frame must not reach": a listener that logs.
const artifactPages = new Map(); // path -> { html, csp }: the HTML-artifact frame of the DNS follow-up
function artifactScheme(request) {
  artifactLog.push({ at: since(), url: request.url });
  const page = artifactPages.get(new URL(request.url).pathname);
  if (page) return new Response(page.html, { status: 200, headers: { 'Content-Type': 'text/html', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': page.csp, 'Cache-Control': 'no-store' } });
  return new Response('artifact', { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'maws-viewer', privileges: { standard: true, secure: true, stream: true, corsEnabled: true, supportFetchAPI: true } },
  { scheme: 'maws-app', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
  { scheme: 'maws-artifact', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: false, corsEnabled: false } },
]);

// ---- observation ---------------------------------------------------------------------------------------------------
const events = []; // main-side signals, in order
const ev = (type, data = {}) => { events.push({ at: since(), type, ...data }); };
app.on('render-process-gone', (_e, wc, d) => ev('app:render-process-gone', { wc: wc.id, reason: d.reason, exitCode: d.exitCode }));
app.on('child-process-gone', (_e, d) => ev('app:child-process-gone', { type: d.type, reason: d.reason }));
app.on('web-contents-created', (_e, wc) => ev('app:web-contents-created', { id: wc.id, type: wc.getType() }));

function observe(wc, label) {
  wc.on('render-process-gone', (_e, d) => ev(`${label}:render-process-gone`, { reason: d.reason, exitCode: d.exitCode }));
  wc.on('will-navigate', (e) => ev(`${label}:will-navigate`, { url: e.url }));
  wc.on('will-frame-navigate', (e) => ev(`${label}:will-frame-navigate`, { url: e.url, main: e.isMainFrame }));
  wc.on('did-frame-navigate', (_e, url, code, _t, isMain) => ev(`${label}:did-frame-navigate`, { url, code, main: isMain }));
  wc.on('did-create-window', (w, d) => ev(`${label}:did-create-window`, { url: d.url }));
  wc.on('console-message', (e) => { if (/Content.Security.Policy|Refused|sandbox|blocked|Unrecognized|directive/i.test(e.message)) ev(`${label}:console`, { frame: safeUrl(e.frame), message: e.message.slice(0, 400) }); });
  wc.on('unresponsive', () => ev(`${label}:unresponsive`));
}
const safeUrl = (f) => { try { return f?.url ?? null; } catch { return '<disposed>'; } };

function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
const metricPids = () => new Set(app.getAppMetrics().map((m) => m.pid));
async function waitUntil(pred, timeoutMs, stepMs = 25) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) { if (await pred()) return Math.round(performance.now() - start); await sleep(stepMs); }
  return null;
}
async function withTimeout(p, ms, label = 'timeout') { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} after ${ms} ms`)), ms); })]).finally(() => clearTimeout(t)); }

// Is the process sandboxed by the OS? Linux: seccomp-bpf and a PID namespace of its own; macOS: the metric's flag.
function sandboxOf(pid) {
  if (process.platform === 'linux') {
    const out = {};
    try { out.seccomp = { 0: 'off', 1: 'strict', 2: 'filter' }[/Seccomp:\s*(\d)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1]] ?? 'unknown'; } catch (e) { out.seccomp = `unreadable (${e.code})`; }
    try { out.ownPidNamespace = readlinkSync(`/proc/${pid}/ns/pid`) !== readlinkSync('/proc/self/ns/pid'); } catch (e) { out.pidNamespace = `unreadable from main (${e.code}: the process is not dumpable, as the setuid sandbox leaves it)`; }
    try { const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0'); out.noSandboxSwitch = cmd.includes('--no-sandbox'); out.type = cmd.find((a) => a.startsWith('--type='))?.slice(7); } catch (e) { out.cmdline = `unreadable (${e.code})`; }
    return out;
  }
  return { sandboxed: app.getAppMetrics().find((m) => m.pid === pid)?.sandboxed ?? null };
}

// Real input: xdotool on X11 (Linux); elsewhere none, and the conditions that need it say so.
const xdotool = process.platform === 'linux' && existsSync('/usr/bin/xdotool');
const xdo = (...a) => execFileP('xdotool', a.map(String));

const sample = (name) => readFileSync(join(SAMPLES, name));
const b64 = (buf) => Buffer.from(buf).toString('base64');

// ---- architecture A -------------------------------------------------------------------------------------------------
let win;
const A = {
  js: (expr) => win.webContents.executeJavaScript(expr, true),
  call: (fn, ...args) => A.js(`harness.${fn}(...${JSON.stringify(args)})`),
  frameOf(host) {
    return win.webContents.mainFrame.framesInSubtree.find((f) => { try { return f !== win.webContents.mainFrame && new URL(f.url).hostname === host; } catch { return false; } }) ?? null;
  },
  async addFrame(id, opts) { const ready = await A.call('addFrame', id, opts); return ready; },
  async drawSample(id, host, format, file, timeoutMs = 30000) {
    await A.addFrame(id, { host, format });
    const handed = await A.js(`harness.handOver(${JSON.stringify(id)}, Uint8Array.from(atob(${JSON.stringify(b64(sample(file)))}), (c) => c.charCodeAt(0)).buffer)`);
    if (!handed.handed) return { handed };
    const result = await A.js(`Promise.race([harness.wait(${JSON.stringify(id)}, 'drawn', ${timeoutMs}), harness.wait(${JSON.stringify(id)}, 'draw-failed', ${timeoutMs})])`);
    return { handed, result };
  },
};

async function setupA() {
  const ses = session.defaultSession;
  ses.webRequest.onHeadersReceived((details, callback) => {
    if (details.url.startsWith('maws-viewer:') || details.url.startsWith('maws-artifact:') || details.url.startsWith('maws-app:')) return callback({}); // each carries its own policy
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [WINDOW_CSP] } });
  });
  ses.protocol.handle('maws-viewer', viewerScheme);
  ses.protocol.handle('maws-artifact', artifactScheme);
  ses.on('will-download', (_e, item) => ev('session:will-download', { url: item.getURL() }));
  ipcMain.handle('check-frame', (event, host) => {
    if (event.senderFrame !== event.sender.mainFrame) return null;
    const frame = A.frameOf(host);
    if (!frame) return null;
    const framePid = frame.osProcessId;
    const mainPid = event.sender.mainFrame.osProcessId;
    return { framePid, mainPid, shared: framePid === mainPid };
  });
  if (LAYERS.has('applayers')) installAppLayers(ses);
  if (LAYERS.has('perms')) installPermissionRefusal(ses);
  if (LAYERS.has('deadproxy')) await ses.setProxy({ proxyRules: 'http=127.0.0.1:9;https=127.0.0.1:9;socks=127.0.0.1:9', proxyBypassRules: '<-loopback>' });
  win = new BrowserWindow({
    x: 0, y: 0, width: NARROW ? 900 : 1400, height: 900, title: 'viewer-frame-spike', show: true, backgroundColor: '#faf9f6',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, webSecurity: true, preload: join(here, 'preload.cjs') },
  });
  observe(win.webContents, 'window');
  if (LAYERS.has('applayers')) win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (LAYERS.has('rtcpolicy')) win.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  if (LAYERS.has('appscheme')) {
    // the window page from a standard scheme of its own instead of file: (condition 12's variant)
    ses.protocol.handle('maws-app', (req) => { const name = new URL(req.url).pathname.slice(1) || 'index.html'; const f = join(here, 'out', 'window', name); return existsSync(f) ? new Response(readFileSync(f), { headers: { 'Content-Type': TYPES[extname(name)] ?? 'text/plain', 'Content-Security-Policy': WINDOW_CSP } }) : new Response('nf', { status: 404 }); });
    await win.loadURL('maws-app://app/index.html');
  } else await win.loadFile(join(here, 'out', 'window', 'index.html'));
  const csp = await A.js('harness.cspCheck()');
  report('setup', 'window-csp', csp.inlineRan ? 'fail' : 'record', `window page's own policy in force: an inline script ${csp.inlineRan ? 'ran' : 'was refused'} (${csp.violated ?? 'no violation event'})`);
  return win;
}

// The app's own main-side layers (src/render/policies.ts), adapted to maws-viewer:, for the `app-layers` variant.
function installAppLayers(ses) {
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (d, cb) => {
    let beneath = false;
    try { for (let f = d.frame; f; f = f.parent) if (f.url.startsWith('maws-viewer:')) beneath = true; } catch { beneath = null; }
    const allowed = d.url.startsWith('maws-viewer:');
    const cancel = !allowed && (beneath !== false || (d.initiatorOrigin ?? '').startsWith('maws-viewer:') || d.initiatorOrigin === 'null') && !d.url.startsWith('file:') ? true : false;
    if (cancel) ev('app-layers:cancelled', { url: d.url });
    cb({ cancel });
  });
}
// The app's guardPermissions('store-frames'), adapted: a request or check from a maws-viewer: frame is refused. A
// sandboxed frame's origin is opaque, so its URL is what names it.
function installPermissionRefusal(ses) {
  const fromViewer = (...urls) => urls.some((u) => typeof u === 'string' && (u.startsWith('maws-viewer:') || u === 'null'));
  ses.setPermissionRequestHandler((_wc, permission, cb, d) => { const refuse = fromViewer(d.requestingUrl, d.securityOrigin); ev('perm:request', { permission, url: d.requestingUrl, refused: refuse }); cb(!refuse); });
  ses.setPermissionCheckHandler((_wc, permission, origin, d) => { const refuse = fromViewer(origin, d.requestingUrl, d.securityOrigin); ev('perm:check', { permission, origin, refused: refuse }); return !refuse; });
}

// ---- architecture B -------------------------------------------------------------------------------------------------
let viewSeq = 0;
async function openView({ format = 'docx', policyKey, bytes = null, draw = false, page = 'viewer.html', bounds = { x: 280, y: 20, width: 900, height: 700 } }) {
  const host = mint();
  hostPolicy.set(host, policyKey ?? (format === 'xlsx' ? 'excel' : 'b-word'));
  if (bytes) onceFiles.set(host, bytes);
  const ses = session.fromPartition(`viewer-${++viewSeq}-${host.slice(0, 6)}`); // in memory: no `persist:`
  const own = `maws-viewer://${host}/`;
  ses.protocol.handle('maws-viewer', viewerScheme);
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (d, cb) => { const cancel = !d.url.startsWith(own); if (cancel) ev('view:cancelled', { url: d.url.slice(0, 200) }); cb({ cancel }); });
  await ses.setProxy({ proxyRules: 'http=127.0.0.1:9;https=127.0.0.1:9;socks=127.0.0.1:9', proxyBypassRules: '<-loopback>' });
  ses.setPermissionRequestHandler((_wc, permission, cb) => { ev('view:permission-request', { permission }); cb(false); });
  ses.setPermissionCheckHandler((_wc, permission) => { ev('view:permission-check', { permission }); return false; });
  ses.on('will-download', (e, item) => { ev('view:will-download', { url: item.getURL() }); e.preventDefault(); });
  if (LAYERS.has('offline')) ses.enableNetworkEmulation({ offline: true });
  const view = new WebContentsView({ webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const wc = view.webContents;
  wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  wc.setWindowOpenHandler((d) => { ev('view:window-open', { url: d.url }); return { action: 'deny' }; });
  observe(wc, 'view');
  const messages = [];
  const waiters = [];
  wc.on('did-navigate-in-page', (_e, url, isMain) => {
    if (!isMain) return;
    const m = /#([a-z-]+)=(\d+):(.*)$/.exec(url);
    if (!m) return;
    let message;
    try { message = JSON.parse(decodeURIComponent(m[3])); } catch { return; }
    messages.push(message);
    for (const w of waiters.slice()) if (w.match(message)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(message); }
  });
  const waitFor = (match, timeoutMs) => {
    const seen = messages.find(match);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const w = { match, resolve };
      waiters.push(w);
      setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); reject(new Error(`no message within ${timeoutMs} ms`)); } }, timeoutMs);
    });
  };
  const post = (message) => wc.executeJavaScriptInIsolatedWorld(999, [{ code: `window.postMessage(${JSON.stringify(message)}, '*'); 1` }]);
  let reqSeq = 0;
  const handle = {
    view, wc, host, messages,
    waitFor, post,
    wait: (type, timeoutMs = 15000) => waitFor((m) => m.type === type, timeoutMs),
    async test(name, args = {}, timeoutMs = 60000) { const reqId = ++reqSeq; await withTimeout(post({ type: 'test', name, args, reqId }), 5000, 'post'); return (await waitFor((m) => m.type === 'reply' && m.reqId === reqId, timeoutMs)).result; },
    ping: (timeoutMs) => withTimeout(wc.executeJavaScriptInIsolatedWorld(999, [{ code: '1' }]), timeoutMs, 'ping'),
    close() { try { win.contentView.removeChildView(view); } catch {} if (!wc.isDestroyed()) wc.close(); },
  };
  win.contentView.addChildView(view);
  view.setBounds(bounds);
  wc.loadURL(`maws-viewer://${host}/${page}?format=${format}${draw ? '&draw=1' : ''}`).catch((e) => ev('view:load-error', { error: String(e) }));
  await handle.wait('ready', 15000);
  return handle;
}

let anchorOf = () => null;
let layoutView = null; // the view that follows the window's slot (B1 to B3)
async function setupB() {
  let anchor = null; // the slot's margins to the window's right and bottom edges, as last reported
  ipcMain.on('slot', (_e, rect) => {
    if (!layoutView) return;
    const z = win.webContents.getZoomFactor(); // the page reports CSS pixels; a view's bounds are DIPs
    const b = { x: Math.round(rect.x * z), y: Math.round(rect.y * z), width: Math.round(rect.width * z), height: Math.round(rect.height * z) };
    const c = win.getContentBounds();
    anchor = { x: b.x, y: b.y, right: c.width - (b.x + b.width), bottom: c.height - (b.y + b.height) };
    layoutView.view.setBounds(b);
  });
  // variant `anchor`: main moves the view with the window's own resize, keeping the last reported margins, without
  // waiting for the page to lay out and report
  anchorOf = () => anchor;
  ipcMain.on('menu', (_e, open) => { if (layoutView) layoutView.view.setVisible(!open); });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [WINDOW_CSP] } }));
  win = new BrowserWindow({
    x: 0, y: 0, width: NARROW ? 900 : 1400, height: 900, title: 'viewer-frame-spike', show: true, backgroundColor: '#faf9f6',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, preload: join(here, 'preload.cjs') },
  });
  observe(win.webContents, 'window');
  if (LAYERS.has('anchor')) win.on('resize', () => {
    if (!layoutView || !anchorOf()) return;
    const a = anchorOf(), c = win.getContentBounds();
    layoutView.view.setBounds({ x: a.x, y: a.y, width: Math.max(0, c.width - a.x - a.right), height: Math.max(0, c.height - a.y - a.bottom) });
  });
  await win.loadFile(join(here, 'out', 'window', 'index.html'));
  return win;
}

// ---- shared evidence ------------------------------------------------------------------------------------------------
function listenerLines(fromOffset) {
  const file = argv['listener-log'];
  if (!file || !existsSync(file)) return null;
  return readFileSync(file, 'utf8').slice(fromOffset).split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.listener !== 'all');
}
const logSize = (file) => (file && existsSync(file) ? statSync(file).size : 0);
const ports = () => (argv.ports ? JSON.parse(readFileSync(argv.ports, 'utf8')) : null);
function dnsHits(fromOffset, token) {
  const file = argv['dns-log'];
  if (!file || !existsSync(file)) return null;
  // the names queried, once each (the resolver tries each search domain too)
  const names = new Set();
  for (const l of readFileSync(file, 'utf8').slice(fromOffset).split('\n')) { const m = /A{1,4}\? (\S+)/.exec(l); if (m && m[1].includes(token)) names.add(m[1].replace(/\.$/, '').split('.example.com')[0].replace(/^t[0-9a-f]+-/, '')); }
  return [...names];
}
const shot = async (name) => { try { writeFileSync(join(RUNS, `${SUITE}-${name}.png`), (await win.webContents.capturePage()).toPNG()); } catch {} };

function summarize(obj, keep = 3) { return Object.entries(obj).slice(0, keep).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', '); }

// ---- suites ---------------------------------------------------------------------------------------------------------
const suites = {};

function reachFailures(r) {
  const isErr = (k) => 'error' in r[k];
  const val = (k) => r[k].value ?? r[k].error;
  const checks = {
    'parent.document throws': isErr('parent.document') || String(val('parent.document')).startsWith('top-level'), // B: no parent at all
    'maws undefined': val('typeof maws') === 'undefined',
    'top.maws unreadable': isErr('typeof top.maws') || ['undefined', 'top-level'].includes(val('typeof top.maws')),
    'require undefined': val('typeof require') === 'undefined',
    'process undefined': val('typeof process') === 'undefined',
    'localStorage unusable': isErr('localStorage'),
    'cookie unusable': isErr('document.cookie') || val('document.cookie') === '',
    'clipboard.readText refused': isErr('clipboard.readText'),
    'getUserMedia refused': isErr('getUserMedia'),
    'Notification refused': isErr('Notification.requestPermission') || val('Notification.requestPermission') === 'denied',
    'geolocation refused': isErr('geolocation'),
    'clipboard.writeText refused': isErr('clipboard.writeText'),
  };
  return Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
}

// 1, 2, 3, 5, 11, 13 (A)
suites.basic = async () => {
  await setupA();
  const W = mint(), E = mint();
  // 1
  let ready;
  try { ready = await A.addFrame('w', { host: W, format: 'docx' }); } catch (e) { ready = { error: String(e) }; }
  const page = schemeLog.filter((l) => l.url.includes(W)).map((l) => l.url.replace(`maws-viewer://${W}/`, ''));
  report(1, 'module script', ready.type === 'ready' ? 'pass' : 'fail', ready.type === 'ready' ? `viewer.js ran under the Word policy in the sandboxed frame and said ready (origin ${ready.origin}, secure context ${ready.isSecureContext}); requests: ${page.join(', ')}` : `no ready: ${ready.error}`);
  // 2
  const di = await A.call('test', 'w', 'dynamic-import');
  report(2, 'dynamic import', di.answer === 42 ? 'pass' : 'fail', di.answer === 42 ? `import() of chunk.js from its own host resolved (answer ${di.answer}); the hook itself came in by import() too` : `failed: ${JSON.stringify(di)}`);
  // 3
  await A.addFrame('e', { host: E, format: 'xlsx' });
  const we = await A.call('test', 'e', 'wasm');
  const ww = await A.call('test', 'w', 'wasm');
  const excelOk = we.instantiateStreaming.value === 5 && we.compileFetched.value === 9;
  const wordRefused = 'error' in ww.compileInline && 'error' in ww.syncModule;
  report(3, 'excel admits', excelOk ? 'pass' : 'fail', `Excel policy: instantiateStreaming(fetch own-host .wasm) ${we.instantiateStreaming.value ?? we.instantiateStreaming.error}; compile(fetched bytes) ${we.compileFetched.value ?? we.compileFetched.error}; compile(inline bytes) ${we.compileInline.value ?? we.compileInline.error}`, we);
  report(3, 'word refuses', wordRefused ? 'pass' : 'fail', `Word policy: plain fetch of own-host .wasm ${ww.fetchOnly.error ?? `succeeded (${ww.fetchOnly.value})`}; compile(inline bytes) ${ww.compileInline.error ?? `ran: ${ww.compileInline.value}`} [${ww.compileInline.violations.join('; ')}]; new WebAssembly.Module ${ww.syncModule.error ?? 'ran'}; fetch of .wasm ${ww.instantiateStreaming.error ?? 'ran'}`, ww);
  // 5
  const mainPid = win.webContents.mainFrame.osProcessId;
  const W2 = mint();
  await A.addFrame('w2', { host: W2, format: 'docx' });
  await A.addFrame('w3', { host: W, format: 'docx' });
  const fw = A.frameOf(W), fw2 = A.frameOf(W2);
  const sameHostFrames = win.webContents.mainFrame.framesInSubtree.filter((f) => { try { return new URL(f.url).hostname === W; } catch { return false; } });
  const pids = { main: mainPid, w: fw.osProcessId, w2: fw2.osProcessId, sameHost: sameHostFrames.map((f) => f.osProcessId), excel: A.frameOf(E).osProcessId };
  const ok5 = pids.w !== pids.main && pids.w2 !== pids.main && pids.w !== pids.w2;
  report(5, 'own process', ok5 ? 'pass' : 'fail', `main frame pid ${pids.main}; frame A ${pids.w}; frame B (other host) ${pids.w2}; two frames of one host: ${pids.sameHost.join(' and ')} (${new Set(pids.sameHost).size === 1 ? 'one process' : 'two processes'}); frame pid sandbox ${JSON.stringify(sandboxOf(pids.w))}`, pids);
  // 11
  win.focus();
  await A.js(`(() => { const f = document.querySelector('iframe'); f.focus(); f.contentWindow.focus(); return document.activeElement === f; })()`);
  await sleep(300);
  const focus = await A.call('test', 'w', 'focus-state');
  const r = await A.call('test', 'w', 'reach');
  r['frame focused (no gesture)'] = { value: focus.hasFocus };
  const failed = reachFailures(r);
  report(11, 'out of reach', failed.length ? 'fail' : 'pass', `${failed.length ? `not held: ${failed.join(', ')}; ` : ''}${Object.entries(r).map(([k, v]) => `${k}: ${String(v.value ?? v.error).slice(0, 90)}`).join(' | ')}`, r);
  // 13
  await A.call('test', 'w', 'arm-big');
  const sent = await A.call('sendBig', 'w', 25);
  await sleep(300);
  let got = null;
  await waitUntil(async () => (got = await A.call('test', 'w', 'read-big')) !== null, 5000, 50);
  const whole = got && got.bytes === sent.bytes && got.sum === sent.sum && got.first === 1 && got.last === 2;
  report(13, 'transfer', whole && sent.detached ? 'pass' : 'fail', got ? `25 MiB arrived ${whole ? 'whole' : 'NOT whole'} (${got.bytes} bytes, checksum ${got.sum === sent.sum ? 'equal' : 'differs'}); sender's buffer ${sent.detached ? 'detached (byteLength 0)' : 'NOT detached'}; postMessage call ${sent.postMs.toFixed(1)} ms, post to arrival in the frame ${(got.t1 - sent.t0).toFixed(1)} ms` : 'never arrived', { sent, got });
  const inf = await A.call('test', 'w', 'inflate');
  report(13, 'inflate', inf.exists && inf.abortedMidway && inf.counted > 0 ? 'pass' : 'fail', inf.exists ? `DecompressionStream('deflate-raw') exists; inflated ${inf.compressedBytes} compressed bytes, counted ${inf.counted} of ${inf.inflatedBytes} in ${inf.chunks} chunks, then cancelled mid-way (read after cancel: done=${inf.afterCancelDone})` : 'no DecompressionStream', inf);
};

// 4 (A): the script boundary under both policies, then the three libraries.
suites.boundary = async () => {
  await setupA();
  const fail = [];
  const lines = [];
  for (const [label, format] of [['Word', 'docx'], ['Excel', 'xlsx']]) {
    const host = mint();
    await A.addFrame(label, { host, format });
    const sb = await A.call('test', label, 'script-boundary');
    const dw = await A.call('test', label, 'document-write');
    const ranList = Object.entries(sb).filter(([, v]) => v.ran).map(([k]) => k);
    if (dw.script) ranList.push('document-write-script');
    if (dw.imgOnerror) ranList.push('document-write-img-onerror');
    if (ranList.length) fail.push(`${label}: ${ranList.join(', ')} RAN`);
    const each = Object.entries(sb).map(([k, v]) => `${k}: ${v.ran ? 'RAN' : v.violations.length ? `violation ${v.violations.join(',')}` : v.error ? `refused (${v.error.slice(0, 80)})` : 'no-op'}`);
    each.push(`document.write script: ${dw.script ? 'RAN' : 'no'}, img onerror: ${dw.imgOnerror ? 'RAN' : 'no'} ${dw.violations.length ? `violation ${dw.violations.join(',')}` : 'no violation event'}`);
    lines.push(`${label} policy — ${each.join('; ')}`);
    report(4, `boundary ${label}`, ranList.length ? 'fail' : 'pass', lines[lines.length - 1], { sb, dw });
  }
  // the libraries
  const libs = [['docx-preview 0.4.1', 'docx', 'sample.docx'], ['@aiden0z/pptx-renderer 1.4.0', 'pptx', 'sample.pptx'], ['@extend-ai/react-xlsx 0.23.0', 'xlsx', 'sample.xlsx'], ['@extend-ai/react-xlsx 0.23.0 (recalc sample)', 'xlsx', 'sample-recalc.xlsx']];
  for (const [name, format, file] of libs) {
    const host = mint();
    const before = events.length;
    let out;
    try { out = await A.drawSample(file, host, format, file, 40000); } catch (e) { out = { error: String(e) }; }
    await sleep(800);
    await shot(file.replace(/\W/g, '_'));
    const consoleCsp = events.slice(before).filter((e) => e.type === 'window:console' && (e.frame ?? '').includes(host)).map((e) => e.message);
    const r = out.result;
    const violations = r?.violations ?? [];
    const drawn = r?.type === 'drawn';
    const ok = drawn && violations.length === 0;
    report(4, `library ${format}${file.includes('recalc') ? ' recalc' : ''}`, ok ? 'pass' : 'fail', drawn ? `${name} drew ${file} under the ${format === 'xlsx' ? 'Excel' : 'Word'} policy in ${r.ms} ms (${summarize(r.info, 6)}); CSP violations: ${violations.length ? violations.map((v) => `${v.directive} ${v.blocked} ${v.source ?? ''}:${v.line ?? ''}`).join('; ') : 'none'}${consoleCsp.length ? `; console: ${consoleCsp.join(' / ').slice(0, 400)}` : ''}` : `${name} did not draw ${file}: ${r?.error ?? out.error ?? JSON.stringify(out.handed)}; violations: ${violations.map((v) => `${v.directive} ${v.blocked}`).join('; ')}`, { out, consoleCsp });
    await A.call('removeFrame', file);
  }
};

// 6 (A): a loop is contained and ended.
suites.loop = async () => {
  await setupA();
  const host = mint();
  await A.addFrame('w', { host, format: 'docx' });
  const pid = A.frameOf(host).osProcessId;
  await A.call('test', 'w', 'loop');
  await sleep(400);
  const focused = await A.js('harness.focusField()');
  const start = await A.call('now');
  let typed = 'none';
  if (xdotool) {
    const wid = (await xdo('search', '--name', '^viewer-frame-spike$')).stdout.trim().split('\n')[0];
    await xdo('windowfocus', '--sync', wid).catch(() => {});
    for (const chunk of ['abc', '123', 'xyz']) { await xdo('type', '--delay', '40', chunk); await sleep(900); }
    typed = 'xdotool (X11 XTEST)';
  } else {
    for (const ch of 'abc123xyz') { win.webContents.sendInputEvent({ type: 'char', keyCode: ch }); await sleep(300); }
    typed = 'sendInputEvent (synthetic, through the browser)';
  }
  await sleep(500);
  const ticks = await A.call('tickStats', start);
  const field = await A.call('field');
  const busy = app.getAppMetrics().find((m) => m.pid === pid)?.cpu.percentCPUUsage;
  await A.call('removeFrame', 'w');
  const goneMs = await waitUntil(() => !metricPids().has(pid), 5000);
  const osGone = await waitUntil(() => !pidAlive(pid), 5000);
  const ok = ticks.maxGapMs < 400 && field === 'abc123xyz' && goneMs !== null;
  report(6, 'loop contained', ticks.maxGapMs < 400 && field === 'abc123xyz' ? 'pass' : 'fail', `frame pid ${pid} looping (cpu ${busy?.toFixed?.(0)}%); window timer: ${ticks.count} ticks over the typing, longest gap ${ticks.maxGapMs} ms; field focused ${focused}, typed by ${typed}: field reads "${field}"`, { ticks, field });
  report(6, 'removal ends it', goneMs !== null ? 'pass' : 'fail', goneMs !== null ? `iframe removed: pid ${pid} left getAppMetrics in ${goneMs} ms; OS process gone in ${osGone ?? '>5000'} ms` : `pid ${pid} still in getAppMetrics 5 s after removal (OS alive ${pidAlive(pid)})`);
  void ok;
};

// 7 (A): a hang after `drawn` is detected.
suites.hang = async () => {
  await setupA();
  const host = mint();
  const d = await A.drawSample('w', host, 'docx', 'sample.docx');
  const pid = A.frameOf(host).osProcessId;
  await A.call('test', 'w', 'hang-after-ping');
  const pl = await A.call('pingLoop', 'w', { everyMs: 500, boundMs: 3000, forMs: 12000 });
  const tripped = pl.trippedAtMs !== null && pl.answered === 1;
  report(7, 'hang detected', tripped ? 'pass' : 'fail', `page said ${d.result?.type}; window pings every 500 ms with a 3 s bound (the design's 30 s, shortened): ${pl.pings} pings, ${pl.answered} answered, bound tripped at ${pl.trippedAtMs} ms`, pl);
  await A.call('removeFrame', 'w');
  const goneMs = await waitUntil(() => !metricPids().has(pid), 5000);
  report(7, 'removal ends it', goneMs !== null ? 'pass' : 'fail', goneMs !== null ? `removed: pid ${pid} left getAppMetrics in ${goneMs} ms (OS ${pidAlive(pid) ? 'still alive' : 'gone'})` : `pid ${pid} still listed 5 s after removal`);
};

// 8 (A): the process dying, by SIGKILL and by running out of memory.
async function dying(how) {
  await setupA();
  const host = mint();
  await A.drawSample('w', host, 'docx', 'sample.docx');
  const frame = A.frameOf(host);
  const pid = frame.osProcessId;
  const before = events.length;
  const seen = {};
  const mark = (k) => { if (!(k in seen)) seen[k] = since(); };
  const startAt = since();
  if (how === 'kill') process.kill(pid, 'SIGKILL');
  else await A.call('test', 'w', 'allocate-until-death');
  const deadline = how === 'kill' ? 4000 : 120000;
  await waitUntil(() => {
    if (!pidAlive(pid)) mark('os pid gone');
    if (!metricPids().has(pid)) mark('pid gone from getAppMetrics');
    let inTree = false;
    try { inTree = win.webContents.mainFrame.framesInSubtree.includes(frame) || A.frameOf(host) !== null; } catch {}
    if (!inTree) mark('frame gone from framesInSubtree');
    try { if (frame.isDestroyed()) mark('WebFrameMain.isDestroyed()'); } catch { mark('WebFrameMain throws'); }
    try { if (frame.detached) mark('WebFrameMain.detached'); } catch {}
    try { if (frame.osProcessId !== pid) mark(`osProcessId changed to ${frame.osProcessId}`); } catch {}
    for (const e of events.slice(before)) mark(e.type + (e.reason ? `(${e.reason})` : ''));
    return how === 'kill' ? since() - startAt > 3000 : 'pid gone from getAppMetrics' in seen && since() - seen['pid gone from getAppMetrics'] > 2500;
  }, deadline, 20);
  const rel = Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, v - startAt]).sort((a, b) => a[1] - b[1]));
  const deathAt = how === 'kill' ? 0 : Math.min(...Object.values(rel));
  const within2 = Object.entries(rel).filter(([k, v]) => k !== 'os pid gone' && v - deathAt <= 2000).map(([k]) => k);
  const msgs = await A.call('messages', 'w');
  // then the window removes the frame and a fresh frame draws
  await A.call('removeFrame', 'w');
  const fresh = await A.drawSample('w2', mint(), 'docx', 'sample.docx').catch((e) => ({ error: String(e) }));
  const label = how === 'kill' ? 'SIGKILL' : 'out of memory';
  report(8, label, Object.keys(rel).length && within2.length && fresh.result?.type === 'drawn' ? 'pass' : 'fail',
    `${label} of frame pid ${pid}: signals (ms after ${how === 'kill' ? 'the kill' : 'the first'}): ${Object.entries(rel).map(([k, v]) => `${k} +${v - deathAt}`).join(', ') || 'none within the deadline'}; main learns within 2 s by: ${within2.join(', ') || 'nothing'}; the window saw no message (${msgs.slice(-2).join(',')}); fresh frame: ${fresh.result?.type ?? fresh.error}`, { rel, fresh: fresh.result?.type });
}
suites.kill = () => dying('kill');
suites.oom = () => dying('oom');

// 9 (A): metrics by pid.
suites.metrics = async () => {
  await setupA();
  const host = mint();
  await A.addFrame('w', { host, format: 'docx' });
  const pid = A.frameOf(host).osProcessId;
  const entry = () => app.getAppMetrics().find((m) => m.pid === pid);
  entry(); await sleep(1000);
  const idle = entry();
  await A.call('test', 'w', 'alloc-hold', { mb: 600 });
  await sleep(500);
  const afterAlloc = entry();
  entry();
  await A.call('test', 'w', 'busy', { ms: 2000 });
  const afterBusy = entry();
  const ok = idle && afterAlloc.memory.workingSetSize > idle.memory.workingSetSize + 300 * 1024 && afterBusy.cpu.percentCPUUsage > idle.cpu.percentCPUUsage + 5;
  report(9, 'metrics by pid', ok ? 'pass' : 'fail', idle ? `entry for frame pid ${pid} (type ${idle.type}): workingSetSize idle ${Math.round(idle.memory.workingSetSize / 1024)} MiB -> after holding 600 MiB ${Math.round(afterAlloc.memory.workingSetSize / 1024)} MiB; percentCPUUsage idle ${idle.cpu.percentCPUUsage.toFixed(1)} -> over a 2 s loop ${afterBusy.cpu.percentCPUUsage.toFixed(1)} (a share of all ${os.cpus().length} cores: ${(afterBusy.cpu.percentCPUUsage * os.cpus().length).toFixed(0)}% of one core)` : `no entry for pid ${pid}`, { idle, afterAlloc, afterBusy });
};

// 10 (A): nothing leaves, but WebRTC.
async function egress({ control = false } = {}) {
  await setupA();
  const p = ports();
  if (!p) { report(10, 'egress', 'not-run', 'no listeners (run through run.mjs)'); return; }
  const token = `t${mint().slice(0, 10)}`;
  const offset = logSize(argv['listener-log']);
  const dnsOffset = logSize(argv['dns-log']);
  const targets = p.map((x) => ({ ...x }));
  const artifact = `maws-artifact://${mint()}/${token}`;
  const out = {};
  const policies = control ? [['control', 'docx']] : [['Word', 'docx'], ['Excel', 'xlsx']];
  for (const [label, format] of policies) {
    const host = mint();
    if (control) hostPolicy.set(host, 'none');
    await A.addFrame(label, { host, format, sandbox: control ? null : 'allow-scripts' });
    out[label] = await A.call('test', label, 'egress', { token: `${token}/${label}`, targets, artifactUrl: `${artifact}/${label}`, fileUrl: pathToFileURL(join(here, 'package.json')).href }, 400000)
      .catch(async (e) => { const last = await A.call('lastProgress', label); const f = A.frameOf(host); note('egress stalled', { last, frameUrl: f ? f.url : 'no frame of the host', events: events.filter((x) => /navigate|gone|create-window|download/.test(x.type)).slice(-8) }); throw e; });
  }
  // navigations, one frame each
  const nav = {};
  for (const how of ['self', 'top', 'form', 'form-target-top', 'meta-refresh', 'anchor-top', 'anchor-blank', 'a-download']) {
    const host = mint();
    if (control) hostPolicy.set(host, 'none');
    const id = `nav-${how}`;
    const before = events.length;
    await A.addFrame(id, { host, format: 'docx', sandbox: control ? null : 'allow-scripts' });
    const url = `http://${targets[0].address}:${targets[0].http}/${token}/nav/${how}`;
    await A.call('test', id, 'navigate', { how, url });
    await sleep(2500);
    const windowUrl = win.webContents.getURL();
    const left = A.frameOf(host) === null;
    nav[how] = { frameLeftItsPage: left, windowUrl: windowUrl.startsWith('file:') ? 'unchanged' : windowUrl, mainEvents: events.slice(before).filter((e) => /navigate|create-window|download|console/.test(e.type)).map((e) => `${e.type} ${e.url ?? e.message ?? ''}`.slice(0, 200)) };
    if (!windowUrl.startsWith('file:')) { await win.loadFile(join(here, 'out', 'window', 'index.html')); }
    else await A.call('removeFrame', id);
  }
  await sleep(1500);
  const hits = (listenerLines(offset) ?? []).filter((e) => !control || true);
  const dns = dnsHits(dnsOffset, token);
  const tokenHits = hits.filter((h) => (h.url ?? '').includes(token));
  const anyHits = hits;
  const artifactHits = artifactLog.filter((l) => l.url.includes(token));
  const label = control ? 'control (no policy, no sandbox attribute)' : 'as specified';
  const inPage = Object.entries(out).flatMap(([pol, r]) => Object.entries(r).map(([k, v]) => `${pol}/${k}: ${v.error ? `err ${v.error.slice(0, 60)}` : `value ${JSON.stringify(v.value).slice(0, 40)}`}${v.violations?.length ? ` [${v.violations.length} violation${v.violations.length > 1 ? 's' : ''}]` : ''}`));
  const listenerSummary = summarizeHits(anyHits);
  writeFileSync(join(RUNS, `${SUITE}-${VARIANT}-egress.json`), JSON.stringify({ out, nav, hits: anyHits, dns, artifactHits, events }, null, 1));
  if (control) {
    report(10, 'control', anyHits.length ? 'record' : 'fail', `control page reached the listeners: ${listenerSummary}; maws-artifact: ${artifactHits.length} request(s); DNS: ${dns === null ? 'no DNS capture' : dns.length ? `queries for ${dns.join(', ')}` : 'no query'}; navigations: ${Object.entries(nav).map(([k, v]) => `${k} -> window ${v.windowUrl}`).join(', ')}`);
    return;
  }
  const ok = anyHits.length === 0 && artifactHits.length === 0 && (dns === null || dns.length === 0) && Object.values(nav).every((n) => n.windowUrl === 'unchanged');
  report(10, 'egress (not WebRTC)', ok ? 'pass' : 'fail', `${label}: listeners saw ${anyHits.length ? listenerSummary : 'nothing'} (${p.map((x) => `${x.tag} ${x.address}`).join(', ')}); maws-artifact handler saw ${artifactHits.length}; DNS capture: ${dns === null ? 'not running' : dns.length ? `queries left for ${dns.join(', ')}` : 'no query with the token'}; window stayed on its page for every navigation (${Object.entries(nav).map(([k, v]) => `${k}: ${v.windowUrl}${v.mainEvents.length ? ` [${v.mainEvents.join(' | ').slice(0, 160)}]` : ''}`).join('; ')})`, { inPage });
}
function summarizeHits(hits) {
  const by = {};
  for (const h of hits) { const k = `${h.listener}/${h.tag}${h.url ? ` ${h.url.split('/').slice(-1)[0]}` : h.event ? ` ${h.event}` : ''}`; by[k] = (by[k] ?? 0) + 1; }
  return Object.entries(by).map(([k, n]) => `${k}${n > 1 ? ` x${n}` : ''}`).join(', ') || 'nothing';
}
suites.egress = () => egress();
suites['egress-control'] = () => egress({ control: true });

// 10, WebRTC (A): with and without `webrtc 'block'`, and a control that does reach the listeners.
function webrtcConfigs(p) {
  const c = {};
  for (const t of p) {
    c[`${t.tag} turn-tcp relay`] = { iceServers: [{ urls: `turn:${t.address}:${t.tcp}?transport=tcp`, username: 'spike', credential: 'spike' }], iceTransportPolicy: 'relay' };
    c[`${t.tag} stun`] = { iceServers: [{ urls: `stun:${t.address}:${t.udp}` }] };
    c[`${t.tag} turn-udp relay`] = { iceServers: [{ urls: `turn:${t.address}:${t.udp}?transport=udp`, username: 'spike', credential: 'spike' }], iceTransportPolicy: 'relay' };
  }
  return c;
}
async function webrtcA(mode) {
  await setupA();
  const p = ports();
  if (!p) { report(10, `webrtc ${mode}`, 'not-run', 'no listeners'); return; }
  const offset = logSize(argv['listener-log']);
  const results = {};
  const kinds = mode === 'control' ? [['control', 'docx', 'none']] : mode === 'block' ? [['Word', 'docx', 'word'], ['Excel', 'xlsx', 'excel']] : [['Word', 'docx', 'word-noblock'], ['Excel', 'xlsx', 'excel-noblock']];
  for (const [label, format, key] of kinds) {
    const host = mint();
    hostPolicy.set(host, key);
    await A.addFrame(label, { host, format, sandbox: mode === 'control' ? null : 'allow-scripts' });
    const stamp = since();
    results[label] = await A.call('test', label, 'webrtc', { configs: webrtcConfigs(p), waitMs: 4000 }, 120000);
    results[label].__window = [stamp, since()];
  }
  await sleep(1500);
  const hits = listenerLines(offset) ?? [];
  const rtcHits = hits.filter((h) => h.listener === 'tcp-turn' || h.listener === 'udp');
  writeFileSync(join(RUNS, `${SUITE}-${VARIANT}-webrtc.json`), JSON.stringify({ results, hits }, null, 1));
  const inPage = Object.entries(results).map(([label, r]) => `${label}: ${Object.entries(r).filter(([k]) => k !== '__window').map(([k, v]) => `${k} ${v.error ? `threw ${v.error.slice(0, 70)}` : typeof v.value === 'string' ? v.value : `gathered ${v.value.gathering}, candidates [${v.value.candidates.join(', ') || 'none'}]`}`).join('; ')}`).join(' || ');
  const listenerLog = rtcHits.length ? rtcHits.map((h) => `${h.listener}/${h.tag} ${h.event}${h.head ? ` ${h.head.slice(0, 8)}` : ''}`).join(', ') : 'silent';
  const name = mode === 'control' ? 'webrtc control' : mode === 'block' ? "webrtc with webrtc 'block'" : "webrtc without webrtc 'block'";
  const status = mode === 'control' ? (rtcHits.length ? 'record' : 'fail') : rtcHits.some((h) => h.listener === 'tcp-turn') ? 'fail' : rtcHits.length ? 'fail' : 'pass';
  report(10, name, status, `listener log (TURN-TCP and UDP listeners): ${listenerLog}. In page: ${inPage}`, { results, rtcHits });
}
suites['webrtc-block'] = () => webrtcA('block');
suites['webrtc-noblock'] = () => webrtcA('noblock');
suites['webrtc-control'] = () => webrtcA('control');

// 12 (A): launched with site isolation off; the check sees the shared process and no bytes go.
suites.shared = async () => {
  await setupA();
  const host = mint();
  await A.addFrame('w', { host, format: 'docx' });
  const framePid = A.frameOf(host).osProcessId;
  const mainPid = win.webContents.mainFrame.osProcessId;
  const handed = await A.js(`harness.handOver('w', Uint8Array.from(atob(${JSON.stringify(b64(sample('sample.docx')))}), (c) => c.charCodeAt(0)).buffer)`);
  await sleep(2500);
  const msgs = await A.call('messages', 'w');
  const switches = [...new Set(process.argv.filter((a) => a.startsWith('--disable-') || a.startsWith('--site-') || a.startsWith('--process-')))];
  const page = win.webContents.getURL().split(':')[0];
  const shared = framePid === mainPid;
  report(12, 'shared process', shared && !handed.handed && !msgs.includes('drawn') ? 'pass' : shared ? 'fail' : 'not-run', `window page on ${page}:, ${switches.join(' ') || 'no switch'}: frame pid ${framePid}, main-frame pid ${mainPid} (${shared ? 'shared' : 'still separate'}); check says ${JSON.stringify(handed.check)}; bytes ${handed.handed ? 'HANDED' : 'not handed'}; frame messages: ${msgs.join(',')}`);
};

// 14, 15 (A): input scoped to the viewer, and which chords reach the app.
suites.input = async () => {
  await setupA();
  if (!xdotool) { report(14, 'input', 'not-run', 'no real input source on this platform (xdotool on X11 only)'); report(15, 'chords', 'not-run', 'no real input source'); return; }
  const menuHits = [];
  const before = [];
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'Spike', submenu: [
    { label: 'Close tab', accelerator: 'CmdOrCtrl+W', click: () => menuHits.push('CmdOrCtrl+W') },
    { label: 'Palette', accelerator: 'CmdOrCtrl+K', click: () => menuHits.push('CmdOrCtrl+K') },
    { label: 'Next pane', accelerator: 'F6', click: () => menuHits.push('F6') },
  ] }]));
  win.webContents.on('before-input-event', (_e, i) => { if (i.type === 'keyDown') before.push(`${i.control ? 'Ctrl+' : ''}${i.meta ? 'Meta+' : ''}${i.key}`); });
  const inputs = [];
  win.webContents.on('input-event', (_e, i) => inputs.push({ at: since(), type: i.type }));
  const host = mint();
  await A.drawSample('w', host, 'docx', 'sample.docx');
  const bounds = win.getContentBounds();
  const rect = await A.call('frameRect', 'w');
  const cx = Math.round(bounds.x + rect.x + rect.width / 2), cy = Math.round(bounds.y + rect.y + rect.height / 2);
  const wid = (await xdo('search', '--name', '^viewer-frame-spike$')).stdout.trim().split('\n')[0];
  await xdo('windowfocus', '--sync', wid).catch(() => {});
  await A.call('clearPointer');
  const ctl = inputs.length;
  await xdo('mousemove', bounds.x + 100, bounds.y + 300); await sleep(150);
  await xdo('mousemove', bounds.x + 120, bounds.y + 320); await sleep(150);
  await xdo('type', 'n'); await sleep(300);
  const outsideTypes = [...new Set(inputs.slice(ctl).map((i) => i.type))];
  await xdo('mousemove', cx, cy); await sleep(400);
  const inside = await A.call('pointerEvents');
  const inMark = inputs.length;
  await xdo('mousemove', cx + 20, cy + 15); await sleep(200);
  await xdo('click', 1); await sleep(400);
  const activeAfterClick = await A.call('activeIsFrame', 'w');
  await A.call('test', 'w', 'keys-arm');
  await xdo('type', '--delay', '60', 'qz'); await sleep(400);
  const frameKeys = await A.call('test', 'w', 'keys-read');
  const inputsInFrame = inputs.slice(inMark).map((i) => i.type);
  await xdo('mousemove', bounds.x + 100, bounds.y + 300); await sleep(400);
  const after = await A.call('pointerEvents');
  // the field: keyboard leaves the frame
  const fieldRect = await A.js('(() => { const r = document.getElementById("field").getBoundingClientRect(); return { x: r.x + 10, y: r.y + r.height / 2 }; })()');
  await xdo('mousemove', bounds.x + Math.round(fieldRect.x), bounds.y + Math.round(fieldRect.y)); await xdo('click', 1); await sleep(300);
  const activeAfterField = await A.call('activeIsFrame', 'w');
  const enter = inside.some((e) => e.type === 'mouseenter'), leave = after.some((e) => e.type === 'mouseleave');
  const keyTypes = new Set(inputsInFrame);
  const ok = enter && leave && activeAfterClick && !activeAfterField && frameKeys.keys.join('') === 'qz' && (keyTypes.has('keyDown') || keyTypes.has('rawKeyDown') || keyTypes.has('char')) && keyTypes.has('mouseDown');
  report(14, 'input scoped', ok ? 'pass' : 'fail', `pointer: mouseenter ${enter}, mouseleave ${leave}; after a click in the frame document.activeElement === iframe: ${activeAfterClick}, after a click on the field: ${activeAfterField}; the frame's own keydowns: [${frameKeys.keys.join(',')}]; main's input-event for input inside the frame: ${[...keyTypes].join(',') || 'none'} (real X11 input through xdotool); control, the same input over the window outside the frame: input-event ${outsideTypes.join(',') || 'none'}; before-input-event saw the keys typed in the frame: ${before.filter((k) => k === 'q' || k === 'z').join(',') || 'no'}`, { inside, after, inputsInFrame, outsideTypes });
  // 15: chords with the keyboard in the frame
  await xdo('mousemove', cx, cy); await xdo('click', 1); await sleep(300);
  await A.call('test', 'w', 'keys-arm');
  const chords = {};
  for (const [label, key] of [['Ctrl+W (CmdOrCtrl+W on Linux)', 'ctrl+w'], ['Ctrl+K', 'ctrl+k'], ['F6', 'F6'], ['Super+W (the Cmd key position)', 'super+w'], ['Super+K', 'super+k']]) {
    const m0 = menuHits.length, b0 = before.length, w0 = (await A.js('harness.windowKeys.length'));
    const f0 = (await A.call('test', 'w', 'keys-read')).keys.length;
    await xdo('key', key); await sleep(400);
    const fk = (await A.call('test', 'w', 'keys-read')).keys.slice(f0);
    const wk = (await A.js('harness.windowKeys')).slice(w0);
    chords[label] = { menu: menuHits.slice(m0), beforeInput: before.slice(b0), windowKeydown: wk, frameKeydown: fk, stillInFrame: await A.call('activeIsFrame', 'w') };
  }
  report(15, 'chords', 'record', Object.entries(chords).map(([k, v]) => `${k}: menu accelerator ${v.menu.length ? 'fired' : 'no'}, before-input-event ${v.beforeInput.length ? v.beforeInput.join('/') : 'no'}, window keydown ${v.windowKeydown.length ? 'yes' : 'no'}, frame keydown ${v.frameKeydown.length ? v.frameKeydown.join('/') : 'no'}`).join('; '), chords);
};

// ---- B suites -------------------------------------------------------------------------------------------------------
const B = {};
B.basic = async () => {
  await setupB();
  const v = await openView({ format: 'docx' });
  report(1, 'B module script', 'pass', `viewer.js ran as the view's top-level document under the Word policy (B's connect-src admits its own scheme) and said ready by fragment; origin ${v.messages[0].origin}`);
  const di = await v.test('dynamic-import');
  report(2, 'B dynamic import', di.answer === 42 ? 'pass' : 'fail', `import() of chunk.js: ${di.answer ?? JSON.stringify(di)}`);
  const ve = await openView({ format: 'xlsx', bounds: { x: 0, y: 0, width: 10, height: 10 } });
  const we = await ve.test('wasm');
  const ww = await v.test('wasm');
  report(3, 'B excel admits', we.instantiateStreaming.value === 5 && we.compileFetched.value === 9 ? 'pass' : 'fail', `Excel: instantiateStreaming ${we.instantiateStreaming.value ?? we.instantiateStreaming.error}; compile(fetched) ${we.compileFetched.value ?? we.compileFetched.error}`);
  report(3, 'B word refuses', 'error' in ww.compileInline ? 'pass' : 'fail', `Word: compile(inline bytes) ${ww.compileInline.error ?? 'RAN'}`);
  const pids = { window: win.webContents.getOSProcessId(), view: v.wc.getOSProcessId(), view2: ve.wc.getOSProcessId() };
  report(5, 'B own process', pids.view !== pids.window && pids.view !== pids.view2 ? 'pass' : 'fail', `by construction: window pid ${pids.window}, view pid ${pids.view}, second view ${pids.view2}; sandbox ${JSON.stringify(sandboxOf(pids.view))}`);
  report(12, 'B shared process', 'record', 'holds by construction: a webContents of its own is a process of its own; not exercised with site isolation off');
  win.focus();
  v.wc.focus();
  await sleep(300);
  const focus = await v.test('focus-state');
  const r = await v.test('reach');
  r['view focused (no gesture)'] = { value: focus.hasFocus };
  const failedB = reachFailures(r);
  report(11, 'B out of reach', failedB.length ? 'fail' : 'pass', `${failedB.length ? `not held: ${failedB.join(', ')}; ` : ''}` + Object.entries(r).map(([k, x]) => `${k}: ${String(x.value ?? x.error).slice(0, 80)}`).join(' | '), r);
  // 13: the bytes served once from the page's own host
  const big = Buffer.alloc(25 << 20, 7);
  const vb = await openView({ format: 'docx', bytes: big, bounds: { x: 0, y: 0, width: 10, height: 10 } });
  const fetched = await vb.test('fetch-own-file');
  report(13, 'B served once', fetched.first?.bytes === big.length && fetched.second?.status === 404 ? 'pass' : 'fail', `25 MiB fetched from the page's own host in ${fetched.first?.ms} ms (${fetched.first?.bytes} bytes); a second fetch: ${fetched.second?.status}`, fetched);
  const inf = await v.test('inflate');
  report(13, 'B inflate', inf.exists && inf.abortedMidway ? 'pass' : 'fail', `DecompressionStream('deflate-raw'): counted ${inf.counted} of ${inf.inflatedBytes}, cancelled mid-way`);
};
suites['b-basic'] = B.basic;

suites['b-boundary'] = async () => {
  await setupB();
  for (const [label, format] of [['Word', 'docx'], ['Excel', 'xlsx']]) {
    const v = await openView({ format, bounds: { x: 0, y: 0, width: 10, height: 10 } });
    const sb = await v.test('script-boundary');
    const dw = await v.test('document-write');
    const ranList = Object.entries(sb).filter(([, x]) => x.ran).map(([k]) => k).concat(dw.script ? ['document-write'] : [], dw.imgOnerror ? ['document-write-img'] : []);
    report(4, `B boundary ${label}`, ranList.length ? 'fail' : 'pass', ranList.length ? `RAN: ${ranList.join(', ')}` : `none of ${Object.keys(sb).length + 2} attempts ran`);
    v.close();
  }
  for (const [format, file] of [['docx', 'sample.docx'], ['pptx', 'sample.pptx'], ['xlsx', 'sample.xlsx'], ['xlsx', 'sample-recalc.xlsx']]) {
    const v = await openView({ format, bytes: sample(file), draw: true });
    const r = await Promise.race([v.wait('drawn', 40000), v.wait('draw-failed', 40000)]).catch((e) => ({ type: 'timeout', error: String(e) }));
    const ok = r.type === 'drawn' && r.violations.length === 0;
    report(4, `B library ${file}`, ok ? 'pass' : 'fail', r.type === 'drawn' ? `drew ${file} in ${r.ms} ms; violations: ${r.violations.map((x) => `${x.directive} ${x.blocked}`).join('; ') || 'none'}` : `${r.type}: ${r.error}`);
    v.close();
  }
};

suites['b-loop'] = async () => {
  await setupB();
  const v = await openView({ format: 'docx' });
  const pid = v.wc.getOSProcessId();
  await v.test('loop');
  await sleep(400);
  win.focus();
  win.webContents.focus(); // keyboard focus back from the view's webContents to the window's
  await A.js('harness.focusField()');
  const start = await A.call('now');
  if (xdotool) { const wid = (await xdo('search', '--name', '^viewer-frame-spike$')).stdout.trim().split('\n')[0]; await xdo('windowfocus', '--sync', wid).catch(() => {}); for (const c of ['abc', '123', 'xyz']) { await xdo('type', '--delay', '40', c); await sleep(900); } }
  else for (const ch of 'abc123xyz') { win.webContents.sendInputEvent({ type: 'char', keyCode: ch }); await sleep(300); }
  await sleep(400);
  const ticks = await A.call('tickStats', start);
  const field = await A.call('field');
  report(6, 'B loop contained', ticks.maxGapMs < 400 && field === 'abc123xyz' ? 'pass' : 'fail', `view pid ${pid} looping; window timer longest gap ${ticks.maxGapMs} ms over ${ticks.count} ticks; field "${field}"`);
  const t = since();
  v.close();
  const gone = await waitUntil(() => !metricPids().has(pid), 5000);
  report(6, 'B removal ends it', gone !== null ? 'pass' : 'fail', `view closed (removeChildView + webContents.close()): pid ${pid} ${gone !== null ? `left getAppMetrics in ${gone} ms` : 'still listed after 5 s'}`);
  void t;
};

suites['b-hang'] = async () => {
  await setupB();
  const v = await openView({ format: 'docx', bytes: sample('sample.docx'), draw: true });
  const d = await v.wait('drawn', 30000).catch((e) => ({ type: String(e) }));
  const pid = v.wc.getOSProcessId();
  await v.test('hang-after-ping');
  // the watchdog: isolated-world pings; the first is passed to the page as a message it answers once, then it loops
  const pong = v.post({ type: 'ping', n: 1 }).then(() => v.waitFor((m) => m.type === 'pong', 3000)).then(() => 'answered', (e) => String(e));
  const first = await pong;
  let trippedAt = null;
  const start = since();
  for (let i = 0; i < 10 && trippedAt === null; i++) { try { await v.ping(3000); await sleep(500); } catch { trippedAt = since() - start; } }
  report(7, 'B hang detected', first === 'answered' && trippedAt !== null ? 'pass' : 'fail', `page said ${d.type}; first ping ${first}; isolated-world ping with a 3 s bound tripped at ${trippedAt} ms`);
  v.close();
  const gone = await waitUntil(() => !metricPids().has(pid), 5000);
  report(7, 'B removal ends it', gone !== null ? 'pass' : 'fail', `pid ${pid} ${gone !== null ? `left getAppMetrics in ${gone} ms` : 'still listed after 5 s'}`);
};

async function bDying(how) {
  await setupB();
  const v = await openView({ format: 'docx', bytes: sample('sample.docx'), draw: true });
  await v.wait('drawn', 30000);
  const pid = v.wc.getOSProcessId();
  const before = events.length;
  const startAt = since();
  if (how === 'kill') process.kill(pid, 'SIGKILL'); else await v.test('allocate-until-death');
  let gone = null;
  await waitUntil(() => { gone = events.slice(before).find((e) => e.type === 'view:render-process-gone'); return !!gone; }, how === 'kill' ? 4000 : 120000, 20);
  const others = events.slice(before).filter((e) => /gone/.test(e.type)).map((e) => `${e.type}(${e.reason}) +${e.at - startAt}`);
  v.close();
  const fresh = await openView({ format: 'docx', bytes: sample('sample.docx'), draw: true });
  const drew = await fresh.wait('drawn', 30000).then(() => 'drawn', (e) => String(e));
  report(8, `B ${how === 'kill' ? 'SIGKILL' : 'out of memory'}`, gone && drew === 'drawn' ? 'pass' : 'fail', `pid ${pid}: ${others.join(', ') || 'no event'}; isDestroyed ${v.wc.isDestroyed()}; fresh view ${drew}`);
}
suites['b-kill'] = () => bDying('kill');
suites['b-oom'] = () => bDying('oom');

suites['b-metrics'] = async () => {
  await setupB();
  const v = await openView({ format: 'docx' });
  const pid = v.wc.getOSProcessId();
  const entry = () => app.getAppMetrics().find((m) => m.pid === pid);
  entry(); await sleep(1000);
  const idle = entry();
  await v.test('alloc-hold', { mb: 600 });
  await sleep(500);
  const afterAlloc = entry();
  entry();
  await v.test('busy', { ms: 2000 });
  const afterBusy = entry();
  const ok = afterAlloc.memory.workingSetSize > idle.memory.workingSetSize + 300 * 1024 && afterBusy.cpu.percentCPUUsage > idle.cpu.percentCPUUsage + 5;
  report(9, 'B metrics by pid', ok ? 'pass' : 'fail', `view pid ${pid}: workingSet ${Math.round(idle.memory.workingSetSize / 1024)} -> ${Math.round(afterAlloc.memory.workingSetSize / 1024)} MiB; cpu ${idle.cpu.percentCPUUsage.toFixed(1)} -> ${afterBusy.cpu.percentCPUUsage.toFixed(1)}%`);
};

suites['b-egress'] = async () => {
  await setupB();
  const p = ports();
  if (!p) { report(10, 'B egress', 'not-run', 'no listeners'); return; }
  const token = `t${mint().slice(0, 10)}`;
  const offset = logSize(argv['listener-log']);
  const dnsOffset = logSize(argv['dns-log']);
  const out = {};
  for (const [label, format] of [['Word', 'docx'], ['Excel', 'xlsx']]) {
    const v = await openView({ format, bounds: { x: 0, y: 0, width: 300, height: 300 } });
    out[label] = await v.test('egress', { token: `${token}/${label}`, targets: p, artifactUrl: `maws-artifact://${mint()}/${token}/${label}`, fileUrl: pathToFileURL(join(here, 'package.json')).href }, 400000);
    v.close();
  }
  const nav = {};
  for (const how of ['self', 'top', 'form', 'meta-refresh', 'anchor-blank', 'a-download']) {
    const v = await openView({ format: 'docx', bounds: { x: 0, y: 0, width: 300, height: 300 } });
    const before = events.length;
    await v.test('navigate', { how, url: `http://${p[0].address}:${p[0].http}/${token}/nav/${how}` });
    await sleep(2500);
    nav[how] = { url: v.wc.getURL().startsWith(`maws-viewer://${v.host}/`) ? 'unchanged' : v.wc.getURL(), events: events.slice(before).filter((e) => /navigate|cancelled|window-open/.test(e.type)).map((e) => e.type) };
    v.close();
  }
  await sleep(1500);
  const hits = listenerLines(offset) ?? [];
  const dns = dnsHits(dnsOffset, token);
  const artifactHits = artifactLog.filter((l) => l.url.includes(token));
  writeFileSync(join(RUNS, `${SUITE}-egress.json`), JSON.stringify({ out, nav, hits, dns, events }, null, 1));
  const ok = hits.length === 0 && artifactHits.length === 0 && (dns === null || dns.length === 0);
  report(10, 'B egress (not WebRTC)', ok ? 'pass' : 'fail', `listeners saw ${hits.length ? summarizeHits(hits) : 'nothing'}; maws-artifact ${artifactHits.length}; DNS ${dns === null ? 'not captured' : dns.length ? `queries for ${dns.join(', ')}` : 'no query'}; navigations: ${Object.entries(nav).map(([k, x]) => `${k} ${x.url} [${[...new Set(x.events)].join(',')}]`).join('; ')}; requests cancelled by the view's filter: ${events.filter((e) => e.type === 'view:cancelled').length}`);
};

async function bWebrtc(block) {
  await setupB();
  const p = ports();
  if (!p) { report(10, 'B webrtc', 'not-run', 'no listeners'); return; }
  const offset = logSize(argv['listener-log']);
  const results = {};
  for (const [label, format, key] of block ? [['Word', 'docx', 'b-word'], ['Excel', 'xlsx', 'excel']] : [['Word', 'docx', 'b-word-noblock'], ['Excel', 'xlsx', 'excel-noblock']]) {
    const v = await openView({ format, policyKey: key, bounds: { x: 0, y: 0, width: 300, height: 300 } });
    results[label] = await v.test('webrtc', { configs: webrtcConfigs(p), waitMs: 4000 }, 120000);
    v.close();
  }
  await sleep(1500);
  const rtcHits = (listenerLines(offset) ?? []).filter((h) => h.listener === 'tcp-turn' || h.listener === 'udp');
  writeFileSync(join(RUNS, `${SUITE}-webrtc.json`), JSON.stringify({ results, rtcHits }, null, 1));
  const inPage = Object.entries(results).map(([l, r]) => `${l}: ${Object.entries(r).map(([k, x]) => `${k} ${x.error ? `threw ${x.error.slice(0, 60)}` : typeof x.value === 'string' ? x.value : `[${x.value.candidates.join(', ') || 'no candidates'}]`}`).join('; ')}`).join(' || ');
  report(10, `B webrtc ${block ? "with webrtc 'block'" : "without webrtc 'block'"}`, rtcHits.length ? 'fail' : 'pass', `listener log: ${rtcHits.length ? rtcHits.map((h) => `${h.listener}/${h.tag} ${h.event}`).join(', ') : 'silent'}. In page: ${inPage}`);
}
suites['b-webrtc-block'] = () => bWebrtc(true);
suites['b-webrtc-noblock'] = () => bWebrtc(false);

// B1 to B3: the view under its rectangle, seen in frames captured from the X display (ffmpeg x11grab, 60 per second).
const COLORS = { green: [0, 192, 0], black: [0, 0, 0], magenta: [255, 0, 255], cyan: [0, 255, 255], orange: [255, 128, 0], yellow: [255, 208, 0] };
const near = (px, c) => Math.abs(px[0] - c[0]) < 12 && Math.abs(px[1] - c[1]) < 12 && Math.abs(px[2] - c[2]) < 12;
function capture({ y, height = 1, width = 1400, seconds, x = 0 }) {
  const file = join(RUNS, `cap-${mint().slice(0, 8)}.rgb`);
  const p = execFile('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'x11grab', '-framerate', '60', '-video_size', `${width}x${height}`, '-i', `${process.env.DISPLAY}+${x},${y}`, '-t', String(seconds), '-f', 'rawvideo', '-pix_fmt', 'rgb24', file]);
  const done = new Promise((resolve) => p.on('exit', (code) => resolve(code)));
  return { file, done, width, height };
}
function framesOf({ file, width, height }) {
  const buf = readFileSync(file);
  const size = width * height * 3;
  const frames = [];
  for (let off = 0; off + size <= buf.length; off += size) frames.push(buf.subarray(off, off + size));
  return frames;
}
function rowCounts(frame, width, row = 0, from = 0, to = width) {
  const counts = Object.fromEntries(Object.keys(COLORS).map((k) => [k, 0]));
  let firstMagenta = -1;
  for (let x = from; x < to; x++) {
    const i = (row * width + x) * 3;
    const px = [frame[i], frame[i + 1], frame[i + 2]];
    for (const [k, c] of Object.entries(COLORS)) if (near(px, c)) { counts[k]++; if (k === 'magenta' && firstMagenta < 0) firstMagenta = x; }
  }
  return { ...counts, firstMagenta };
}
const hasXCapture = () => process.platform === 'linux' && existsSync('/usr/bin/ffmpeg') && xdotool;

suites['b-layout'] = async () => {
  await setupB();
  if (!hasXCapture()) { for (const c of ['B1', 'B2', 'B3']) report(c, 'layout', 'not-run', 'needs frame capture from the display (ffmpeg x11grab) and real input (xdotool): Linux only in this harness'); return; }
  await A.js("document.body.classList.add('view')");
  layoutView = await openView({ format: 'docx', page: 'paint.html' });
  await A.call('setSide', 260);
  await sleep(600);
  const content = win.getContentBounds();
  // B1: the drag of the side column's edge, then a resize of the window
  const rowY = content.y + 400;
  const judge = (frames) => {
    let overlap = 0, gap = 0, noView = 0;
    for (const f of frames) {
      const whole = rowCounts(f, 1400);
      if (whole.magenta === 0) { noView++; continue; }
      const left = rowCounts(f, 1400, 0, 0, whole.firstMagenta);
      if (left.black < 3 || whole.orange < 118) overlap++;
      if (whole.cyan > 1) gap++;
    }
    return { frames: frames.length, overlap, gap, noView };
  };
  const wid = (await xdo('search', '--name', '^viewer-frame-spike$')).stdout.trim().split('\n')[0];
  await xdo('windowfocus', '--sync', wid).catch(() => {});
  const cap1 = capture({ y: rowY, seconds: 4 });
  await sleep(500);
  const edgeX = content.x + 262;
  await xdo('mousemove', edgeX, rowY); await xdo('mousedown', 1);
  for (let i = 1; i <= 40; i++) { await xdo('mousemove', edgeX + i * 8, rowY); await sleep(16); }
  const peakSide = await A.js("getComputedStyle(document.documentElement).getPropertyValue('--side')");
  for (let i = 39; i >= -15; i--) { await xdo('mousemove', edgeX + i * 8, rowY); await sleep(16); }
  await xdo('mouseup', 1);
  const endSide = await A.js("getComputedStyle(document.documentElement).getPropertyValue('--side')");
  await cap1.done;
  const drag = { ...judge(framesOf(cap1)), peakSide, endSide };
  await A.call('setSide', 260);
  await sleep(400);
  const cap2 = capture({ y: rowY, seconds: 4 });
  await sleep(500);
  for (let w = 1400; w >= 1000; w -= 10) { win.setBounds({ x: 0, y: 0, width: w, height: 900 }); await sleep(16); }
  for (let w = 1000; w <= 1400; w += 10) { win.setBounds({ x: 0, y: 0, width: w, height: 900 }); await sleep(16); }
  await cap2.done;
  const resize = judge(framesOf(cap2));
  // the control: the same resize with the view hidden, so only the window page draws (its own lag under this display)
  layoutView.view.setVisible(false);
  await sleep(300);
  const capC = capture({ y: rowY, seconds: 4 });
  await sleep(500);
  for (let w = 1400; w >= 1000; w -= 10) { win.setBounds({ x: 0, y: 0, width: w, height: 900 }); await sleep(16); }
  for (let w = 1000; w <= 1400; w += 10) { win.setBounds({ x: 0, y: 0, width: w, height: 900 }); await sleep(16); }
  await capC.done;
  let pageLag = 0;
  const controlFrames = framesOf(capC);
  for (const f of controlFrames) { const c = rowCounts(f, 1400); if (c.orange < 118 || c.black < 3) pageLag++; }
  layoutView.view.setVisible(true);
  await sleep(300);
  const b1ok = drag.overlap === 0 && resize.overlap === 0;
  report('B1', 'follows its rectangle', b1ok ? 'pass' : 'fail', `edge drag (xdotool, 95 moves at ~16 ms): ${drag.frames} frames captured, ${drag.overlap} with the view over the edge or the right panel, ${drag.gap} with the slot exposed (view behind), ${drag.noView} without the view; window resize (setBounds 1400 -> 1000 -> 1400 px in 10 px steps at ~16 ms): ${resize.frames} frames, ${resize.overlap} overlapping, ${resize.gap} exposing the slot, ${resize.noView} without the view; drag moved the edge to ${drag.peakSide.trim()} and back to ${drag.endSide.trim()}; control resize with the view hidden: ${pageLag} of ${controlFrames.length} frames where the window page itself had not caught up (right panel clipped or edge missing)`, { drag, resize, pageLag });
  // B2: a menu of the window over the view's rectangle, ten times
  await A.call('setSide', 260);
  await sleep(400);
  const menuY = content.y + 140;
  const cap3 = capture({ y: menuY, seconds: 7.5 });
  await sleep(500);
  for (let i = 0; i < 10; i++) { await A.call('menu', true); await sleep(300); await A.call('menu', false); await sleep(300); }
  await cap3.done;
  let covered = 0, exposed = 0, openOk = 0, closedOk = 0, other = 0;
  for (const f of framesOf(cap3)) {
    const side = rowCounts(f, 1400, 0, 170, 255), over = rowCounts(f, 1400, 0, 280, 660);
    if (side.yellow > 0 && over.magenta > 0) covered++;
    else if (side.yellow === 0 && over.cyan > 0) exposed++;
    else if (side.yellow > 0 && over.yellow > 0) openOk++;
    else if (side.yellow === 0 && over.magenta > 0) closedOk++;
    else other++;
  }
  report('B2', 'hidden and shown in one frame', covered === 0 && exposed === 0 ? 'pass' : 'fail', `10 opens and closes of a menu that spans the side column and the view's rectangle (main hides the view with setVisible on the window's IPC): frames with the menu drawn but the view still over it ${covered}, with the menu gone and the view not yet back (slot exposed) ${exposed}; consistent frames: open ${openOk}, closed ${closedOk}; other ${other}`, { covered, exposed, openOk, closedOk, other });
  // B3: window zoom
  const zooms = {};
  for (const z of [0.8, 1.25, 1]) {
    win.webContents.setZoomFactor(z);
    await sleep(700);
    const slot = await A.call('reportSlot');
    await sleep(500);
    const cap = capture({ y: content.y, height: 900, width: 1400, seconds: 0.2 });
    await cap.done;
    const frame = framesOf(cap).at(-1);
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, cyan = 0;
    for (let yy = 0; yy < 900; yy++) for (let xx = 0; xx < 1400; xx++) { const i = (yy * 1400 + xx) * 3; const px = [frame[i], frame[i + 1], frame[i + 2]]; if (near(px, COLORS.magenta)) { minX = Math.min(minX, xx); maxX = Math.max(maxX, xx); minY = Math.min(minY, yy); maxY = Math.max(maxY, yy); } else if (near(px, COLORS.cyan)) cyan++; }
    const want = { x: slot.x * z, y: slot.y * z, right: (slot.x + slot.width) * z, bottom: (slot.y + slot.height) * z };
    const got = { x: minX, y: minY, right: maxX + 1, bottom: maxY + 1 };
    const delta = { x: got.x - want.x, y: got.y - want.y, right: got.right - want.right, bottom: got.bottom - want.bottom };
    zooms[z] = { want, got, delta, cyan, bounds: layoutView.view.getBounds() };
  }
  const worst = Math.max(...Object.values(zooms).flatMap((r) => Object.values(r.delta).map(Math.abs)));
  report('B3', 'zoom', worst <= 1 && Object.values(zooms).every((r) => r.cyan < 2000) ? 'pass' : 'fail', Object.entries(zooms).map(([z, r]) => `${Math.round(z * 100)}%: slot ${r.want.x.toFixed(1)},${r.want.y.toFixed(1)}..${r.want.right.toFixed(1)},${r.want.bottom.toFixed(1)} DIP, view drawn ${r.got.x},${r.got.y}..${r.got.right},${r.got.bottom}, edge deltas ${Object.values(r.delta).map((d) => d.toFixed(1)).join('/')} px, exposed slot pixels ${r.cyan}`).join('; '), zooms);
};

// ---- the DNS follow-up (2026-11-14) ---------------------------------------------------------------------------------
// Which carriers send a name the page chooses to the resolver, under which settings, and with what control beside it.
// Names are `<tok>-<phase>-<carrier>.example.com`; the capture is read only for names with the run's token, and a name
// is reported up to `.example.com` (the resolver's search domains, which follow it, are never printed).
function dnsQueries(fromOffset, tok) {
  const file = argv['dns-log'];
  if (!file || !existsSync(file)) return null;
  const out = [];
  for (const l of readFileSync(file, 'utf8').slice(fromOffset).split('\n')) {
    const m = /^(\d+):(\d+):([\d.]+)\s+(\S+)\s+(In|Out)\s+IP6?\s.*?\s(A|AAAA)\?\s(\S+)/.exec(l);
    if (!m || !m[7].includes(tok)) continue;
    out.push({ t: Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]), iface: m[4], dir: m[5], name: m[7].split('.example.com')[0] });
  }
  return out;
}
const labelOf = (name, tok) => (name.startsWith(`${tok}-`) ? name.slice(tok.length + 1) : name.replace(/^([0-9a-f]+\.)+/, (h) => `(${h.split('.').length - 1} hex labels).`).replace(`${tok}-`, ''));
const CARRIERS = ['link-script', 'link-inner', 'mo-removed-link', 'preconnect', 'a-parse', 'a-hover', 'a-down', 'detached-never', 'detached-never-a', 'detached-filtered-link', 'detached-filtered-a'];
const carriersSource = () => readFileSync(join(here, 'viewer', 'carriers.js'), 'utf8').replace('export async function carriers', 'async function carriers');

async function hoverAndPress(origin, rects) {
  if (!xdotool || !rects?.hover) return 'no real input';
  const at = (q) => [Math.round(origin.x + q.x), Math.round(origin.y + q.y)];
  await xdo('mousemove', ...at(rects.hover)); await sleep(900);
  await xdo('mousemove', ...at(rects.down)); await sleep(200);
  await xdo('mousedown', 1); await sleep(600);
  await xdo('mousemove', ...at(rects.away)); await sleep(100);
  await xdo('mouseup', 1); await sleep(300);
  return 'hovered, pressed (no click)';
}
async function frameOrigin(id) { const b = win.getContentBounds(); const r = await A.call('frameRect', id); return { x: b.x + r.x, y: b.y + r.y }; }

// The control: a window on a session of its own (standing for the in-app browser), on an http page, the same carriers.
async function standin(p, tok) {
  const ses = session.fromPartition('standin');
  const w = new BrowserWindow({ x: 910, y: 0, width: 680, height: 800, show: true, title: 'standin', webPreferences: { session: ses, sandbox: true, contextIsolation: true } });
  const res = {};
  try { await withTimeout(w.loadURL('http://example.com/'), 15000, 'load'); res.example = `loaded "${w.webContents.getTitle()}"`; } catch (e) { res.example = `failed: ${String(e).slice(0, 80)}`; }
  await w.loadURL(`http://127.0.0.1:${p[0].http}/${tok}/page`);
  const rects = await w.webContents.executeJavaScript(`${carriersSource()}; carriers(${JSON.stringify({ tok, phase: 'standin' })})`);
  const b = w.getContentBounds();
  res.input = await hoverAndPress({ x: b.x, y: b.y }, rects);
  return res;
}

function reportDns(arch, tok, offset, phases, control) {
  const q = dnsQueries(offset, tok);
  if (q === null) { report('dns', `${arch} capture`, 'not-run', 'no DNS capture (needs tcpdump without a password)'); return; }
  const seen = (phase) => { const lo = new Set(), out = new Set(); for (const e of q) { const l = labelOf(e.name, tok); if (!l.startsWith(`${phase}-`)) continue; const c = l.slice(phase.length + 1); (e.iface === 'lo' ? lo : out).add(c); } return { lo: [...lo], out: [...out] }; };
  for (const [phase, label] of phases) {
    const s = seen(phase);
    const left = [...new Set([...s.lo, ...s.out])];
    report('dns', `${arch} ${phase}`, left.length ? 'fail' : 'pass', `${label}: names sent ${left.length ? left.join(', ') : 'none'}${s.out.length ? `; of them out of the machine (not loopback): ${s.out.join(', ')}` : ''}; not sent: ${CARRIERS.filter((c) => !left.includes(c)).join(', ')}`, s);
  }
  const s = seen('standin');
  report('dns', `${arch} control`, 'record', `control (own session, http page, real input): ${control.example}; names sent ${s.lo.concat(s.out).filter((v, i, a) => a.indexOf(v) === i).join(', ') || 'none'}; input ${control.input}`, s);
}

const DNS_PHASES = [['plain', 'viewer.html', false, 'wrapper without meta'], ['metaoff', 'viewer-meta.html', false, 'wrapper with x-dns-prefetch-control off first'], ['metaon', 'viewer-meta.html', true, 'off first, then a meta "on" later in the body']];
suites.dns = async () => {
  await setupA();
  if (LAYERS.has('offline')) session.defaultSession.enableNetworkEmulation({ offline: true });
  const p = ports();
  const tok = `t${mint().slice(0, 10)}`;
  const offset = logSize(argv['dns-log']);
  for (const [phase, page, metaOnLater] of DNS_PHASES) {
    await A.addFrame(phase, { host: mint(), format: 'docx', page });
    const rects = await A.call('test', phase, 'carriers', { tok, phase, metaOnLater });
    await hoverAndPress(await frameOrigin(phase), rects);
    await sleep(400);
    await A.call('removeFrame', phase);
  }
  // a frame made before a theme change (which sends the renderers new web preferences), its carriers inserted after it,
  // and the window zoomed: whether a preferences update turns prefetching back on under a switch that turned it off
  await A.addFrame('aftertheme', { host: mint(), format: 'docx' });
  nativeTheme.themeSource = 'dark';
  await sleep(600);
  nativeTheme.themeSource = 'light';
  win.webContents.setZoomFactor(1.1);
  await sleep(600);
  const rects = await A.call('test', 'aftertheme', 'carriers', { tok, phase: 'aftertheme' });
  await hoverAndPress(await frameOrigin('aftertheme'), rects);
  await A.call('removeFrame', 'aftertheme');
  win.webContents.setZoomFactor(1);
  const control = await standin(p, tok);
  await sleep(3000);
  reportDns('A', tok, offset, [...DNS_PHASES.map(([ph, , , label]) => [ph, label]), ['aftertheme', 'a frame made before a theme change and a zoom, its carriers inserted after']], control);
};
suites['b-dns'] = async () => {
  await setupB();
  const p = ports();
  const tok = `t${mint().slice(0, 10)}`;
  const offset = logSize(argv['dns-log']);
  for (const [phase, page, metaOnLater] of DNS_PHASES) {
    const v = await openView({ format: 'docx', page, bounds: { x: 280, y: 20, width: 600, height: 700 } });
    const rects = await v.test('carriers', { tok, phase, metaOnLater });
    const b = win.getContentBounds();
    await hoverAndPress({ x: b.x + 280, y: b.y + 20 }, rects);
    await sleep(400);
    v.close();
  }
  const control = await standin(p, tok);
  await sleep(3000);
  reportDns('B', tok, offset, DNS_PHASES.map(([ph, , , label]) => [ph, label]), control);
};

// Crafted files: the sample with one external hyperlink to a name of the run's.
async function crafted(format, host) {
  const zip = await JSZip.loadAsync(sample(`sample.${format}`));
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const rel = `<Relationship Id="rIdSpike1" Type="${R}/hyperlink" Target="http://${host}/" TargetMode="External"/>`;
  const addRel = async (path) => { const f = zip.file(path); const x = f ? await f.async('string') : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`; zip.file(path, x.replace('</Relationships>', `${rel}</Relationships>`)); };
  const withR = (xml, root) => (xml.includes('xmlns:r=') ? xml : xml.replace(`<${root} `, `<${root} xmlns:r="${R}" `));
  if (format === 'docx') {
    await addRel('word/_rels/document.xml.rels');
    const doc = withR(await zip.file('word/document.xml').async('string'), 'w:document');
    zip.file('word/document.xml', doc.replace(/<w:body>/, '<w:body><w:p><w:hyperlink r:id="rIdSpike1"><w:r><w:t>spike link</w:t></w:r></w:hyperlink></w:p>'));
  } else if (format === 'pptx') {
    await addRel('ppt/slides/_rels/slide1.xml.rels');
    let x = withR(await zip.file('ppt/slides/slide1.xml').async('string'), 'p:sld');
    const i = x.indexOf('<a:r>');
    const j = x.indexOf('<a:t>', i);
    const run = x.slice(i, j);
    const link = '<a:hlinkClick r:id="rIdSpike1"/>';
    let fixed;
    if (/<a:rPr[^>]*\/>/.test(run)) fixed = run.replace(/<a:rPr([^>]*)\/>/, `<a:rPr$1>${link}</a:rPr>`);
    else if (run.includes('</a:rPr>')) fixed = run.replace('</a:rPr>', `${link}</a:rPr>`);
    else fixed = `${run}<a:rPr>${link}</a:rPr>`;
    x = x.slice(0, i) + fixed + x.slice(j);
    zip.file('ppt/slides/slide1.xml', x);
  } else {
    await addRel('xl/worksheets/_rels/sheet1.xml.rels');
    let x = withR(await zip.file('xl/worksheets/sheet1.xml').async('string'), 'worksheet');
    const tag = '<hyperlinks><hyperlink ref="A1" r:id="rIdSpike1"/></hyperlinks>';
    const at = ['<printOptions', '<pageMargins', '<pageSetup', '</worksheet>'].map((t) => x.indexOf(t)).find((k) => k >= 0);
    x = x.slice(0, at) + tag + x.slice(at);
    zip.file('xl/worksheets/sheet1.xml', x);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

suites['dns-libs'] = async () => {
  await setupA();
  const tok = `t${mint().slice(0, 10)}`;
  const offset = logSize(argv['dns-log']);
  const modes = [['live', 'viewer.html', null, 'live, as specified'], ['metalive', 'viewer-meta.html', null, 'live, wrapper meta off'], ['detached', 'viewer-meta.html', 'detached', 'rendered detached, filtered, attached (meta off)'], ['factory', 'viewer-meta.html', 'factory', 'patched element factory + Trusted Types default policy (meta off)']];
  const results = {};
  for (const lib of ['docx', 'pptx', 'xlsx']) {
    for (const [mode, page, drawMode, label] of modes) {
      const phase = `${lib}${mode}`;
      const host = mint();
      if (drawMode === 'factory') hostPolicy.set(host, lib === 'xlsx' ? 'excel-tt' : 'word-tt');
      const bytes = await crafted(lib, `${tok}-${phase}-file-link.example.com`);
      await A.addFrame(phase, { host, format: lib, page, width: 470, height: 400 });
      const r = await A.call('test', phase, 'draw-lib', { format: lib, b64: b64(bytes), mode: drawMode ?? 'live', tok }, 60000);
      const fr = await frameOrigin(phase);
      r.input = r.anchor ? await hoverAndPress(fr, { hover: r.anchor, down: r.anchor, away: { x: 460, y: 390 } }) : 'no anchor to hover';
      results[phase] = { ...r, label };
      await sleep(400);
      await A.call('removeFrame', phase);
    }
  }
  await sleep(3000);
  const q = dnsQueries(offset, tok) ?? [];
  for (const [phase, r] of Object.entries(results)) {
    const sent = [...new Set(q.filter((e) => labelOf(e.name, tok).startsWith(`${phase}-`)).map((e) => labelOf(e.name, tok).slice(phase.length + 1)))];
    const drew = !r.error && (r.after.nodes > 3 || r.after.canvases > 0);
    report('dns', `libs ${phase}`, sent.length ? 'fail' : 'pass', `${r.label}: ${r.error ? `draw failed (${r.error.slice(0, 80)})` : `drew in ${r.ms} ms`}${r.beforeAttach ? `; detached before attaching: ${r.beforeAttach.nodes} nodes, ${r.beforeAttach.text} chars, ${r.beforeAttach.canvases} canvases` : ''}; attached: ${r.after.nodes} nodes, ${r.after.text} chars, ${r.after.canvases} canvases${r.tt ? `; trusted types ${r.tt}` : ''}; the file's URL in the DOM as ${r.after.tokUrls.join(', ') || 'nothing'}; ${r.input}; names sent: ${sent.join(', ') || 'none'}${drew ? '' : ' (DID NOT DRAW)'}`, r);
  }
};

suites['dns-burst'] = async () => {
  await setupA();
  const tok = `t${mint().slice(0, 10)}`;
  const host = mint();
  const count = (off, label) => { const q = (dnsQueries(off, tok) ?? []).filter((e) => labelOf(e.name, tok).startsWith(`${label}-`)); const lo = q.filter((e) => e.iface === 'lo'); const ts = lo.map((e) => e.t); return { names: new Set(lo.map((e) => e.name)).size, queries: lo.length, outNames: new Set(q.filter((e) => e.iface !== 'lo').map((e) => e.name)).size, spanS: ts.length ? +(Math.max(...ts) - Math.min(...ts)).toFixed(1) : 0 }; };
  await A.addFrame('b', { host, format: 'docx' });
  let off = logSize(argv['dns-log']);
  const r1 = await A.call('test', 'b', 'burst', { tok, label: 'k1', from: 0, count: 1000 });
  await sleep(15000);
  const c1 = count(off, 'k1');
  off = logSize(argv['dns-log']);
  const r2 = await A.call('test', 'b', 'burst', { tok, label: 'k5', from: 0, count: 5000 });
  await sleep(25000);
  const c2 = count(off, 'k5');
  // the same 100 names again in the same page, then after a reload (the frame removed and added again, same host and URL)
  off = logSize(argv['dns-log']);
  await A.call('test', 'b', 'burst', { tok, label: 'k1', from: 0, count: 100 });
  await sleep(6000);
  const c3 = count(off, 'k1');
  await A.call('removeFrame', 'b');
  await A.addFrame('b', { host, format: 'docx' });
  off = logSize(argv['dns-log']);
  await A.call('test', 'b', 'burst', { tok, label: 'k1', from: 0, count: 100 });
  await sleep(6000);
  const c4 = count(off, 'k1');
  report('dns', 'bandwidth', 'record', `1000 names inserted in ${r1.ms} ms: ${c1.names} distinct names reached the resolver (${c1.queries} queries, over ${c1.spanS} s; ${c1.outNames} distinct names in queries leaving the machine); 5000 names in ${r2.ms} ms: ${c2.names} distinct (${c2.queries} queries, over ${c2.spanS} s; ${c2.outNames} out); the first 100 again in the same page: ${c3.names} re-sent; after a reload: ${c4.names} re-sent`, { c1, c2, c3, c4 });
};

// The app's existing HTML-artifact frame, as master builds it: `maws-artifact:` answered with STORE_FRAME_CSP
// (src/services/artifacts/scheme/scheme-handler.ts), `<iframe sandbox="allow-scripts" referrerPolicy="no-referrer">`
// (HtmlFrame.tsx), the window's guardFrames (WebRTC policy and the subframe navigation guard), the session's request
// filter and permission handlers (src/render/policies.ts: installFramePolicies, guardPermissions('store-frames')).
const STORE_FRAME_CSP = ['sandbox allow-scripts', "default-src 'none'", "script-src 'unsafe-inline' 'unsafe-eval' data: blob:", "style-src 'unsafe-inline' data: blob:", 'img-src data: blob:', 'font-src data: blob:', 'media-src data: blob:', 'connect-src data: blob:', 'worker-src blob:', "frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"].join('; ');
function installStoreFrameLayers(ses, wc) {
  const beneath = (f) => { try { for (let c = f; c; c = c.parent) if (c.url.startsWith('maws-artifact://')) return true; return false; } catch { return null; } };
  const allowed = (u) => ['maws-artifact://', 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/', 'chrome://resources/'].some((x) => u.startsWith(x));
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (d, cb) => { const cancel = !allowed(d.url) && (beneath(d.frame) === true || (d.initiatorOrigin ?? '').startsWith('maws-artifact://')); if (cancel) ev('store:cancelled', { url: d.url.slice(0, 120) }); cb({ cancel }); });
  const store = (o) => typeof o === 'string' && o.startsWith('maws-artifact://');
  ses.setPermissionRequestHandler((_wc, _p, cb, d) => cb(!(store(d.requestingUrl) || store(d.securityOrigin))));
  ses.setPermissionCheckHandler((_wc, permission, origin, d) => permission !== 'deprecated-sync-clipboard-read' && !(store(origin) || store(d.requestingUrl) || store(d.securityOrigin)));
  wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  wc.on('will-frame-navigate', (e) => { if (e.isMainFrame || allowed(e.url)) return; if (beneath(e.frame) !== false || beneath(e.initiator) === true) { e.preventDefault(); ev('store:blocked-navigation', { url: e.url }); } });
}
suites.appframe = async () => {
  await setupA();
  installStoreFrameLayers(session.defaultSession, win.webContents);
  const p = ports();
  const tok = `t${mint().slice(0, 10)}`;
  const offset = logSize(argv['dns-log']);
  const secret = 'invented owner note: account 4421, meeting Tuesday';
  const page = `<!doctype html><html><head><meta charset="utf-8"><script>${carriersSource()}
addEventListener('DOMContentLoaded', () => carriers(${JSON.stringify({ tok, phase: 'appframe' })}).then((rects) => {
  const text = document.getElementById('secret').textContent;
  const hex = Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, '0')).join('');
  const l = document.createElement('link'); l.rel = 'dns-prefetch'; l.href = '//' + hex.match(/.{1,60}/g).join('.') + '.${tok}-appframe-data.example.com'; document.head.append(l);
  parent.postMessage({ type: 'ready', rects, bytes: text.length }, '*');
}));</script></head><body><p id="secret">${secret}</p></body></html>`;
  artifactPages.set('/page.html', { html: page, csp: STORE_FRAME_CSP });
  const ready = await A.call('addFrame', 'art', { src: `maws-artifact://${mint()}/page.html`, referrerPolicy: 'no-referrer' });
  await hoverAndPress(await frameOrigin('art'), ready.rects);
  await sleep(3000);
  const q = dnsQueries(offset, tok) ?? [];
  const names = [...new Set(q.map((e) => labelOf(e.name, tok)))];
  const data = q.find((e) => e.name.includes('appframe-data'));
  const decoded = data ? Buffer.from(data.name.split(`.${tok}`)[0].replace(/\./g, ''), 'hex').toString('utf8') : null;
  report('dns', 'app HTML frame', names.length ? 'fail' : 'pass', `the app's HTML-artifact frame (STORE_FRAME_CSP, sandbox allow-scripts, the store-frame layers): names sent ${names.join(', ') || 'none'}; the page's own text, hex-encoded into labels, ${decoded === secret ? `arrived whole at the resolver (${ready.bytes} bytes in one name)` : decoded ? 'arrived altered' : 'did not leave'}; cancelled requests ${events.filter((e) => e.type === 'store:cancelled').length}`, { names });
  void p;
};

// ---- run ------------------------------------------------------------------------------------------------------------
app.whenReady().then(async () => {
  note(`suite ${SUITE}, variant ${VARIANT}, electron ${process.versions.electron}, chrome ${process.versions.chrome}, sandbox switch ${app.commandLine.hasSwitch('no-sandbox') ? 'OFF (--no-sandbox)' : 'on'}`);
  const suite = suites[SUITE];
  if (!suite) { report('setup', 'suite', 'fail', `no suite ${SUITE}`); app.exit(2); return; }
  try {
    await suite();
  } catch (e) {
    report('setup', SUITE, 'fail', `suite threw: ${String(e?.stack ?? e).slice(0, 800)}`);
  }
  writeFileSync(join(RUNS, `${SUITE}-${VARIANT}-events.json`), JSON.stringify(events, null, 1));
  setTimeout(() => app.exit(0), 200);
});
app.on('window-all-closed', () => {});
