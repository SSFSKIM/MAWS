// What every suite shares: the sessions set up as the app sets up its own (the request filter with the owner's check,
// the token responder, the app-wide policy header, the download and permission handlers), app windows made as
// src/main/window.ts makes them, main's own record of what a frame did (navigations, windows, downloads, dialogs,
// processes), and the readers of Chromium's PDF viewer.
import { app, BrowserWindow, session, webContents } from 'electron';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, readlinkSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log, records } from './record.mjs';
import { installFramePolicies, isCspExempt, isStoreFramePermission, ownFilters, shouldBlockFrameNavigation, shouldCancelDownload, beneathStoreFrame, shownArtifact } from './policies.mjs';
import { createTokens, fileFrameResponder } from './responder.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const PDF_VIEWER = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/';
export const PRODUCTION_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: maws-artifact:; font-src 'self' data: maws-artifact:; connect-src 'self'; frame-src 'self' maws-artifact:; media-src 'self' maws-artifact:";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safe = (get, fallback = null) => {
  try {
    return get();
  } catch {
    return fallback;
  }
};
export const within = (promise, ms, fallback = null) => Promise.race([promise, sleep(ms).then(() => fallback)]).catch((error) => ({ error: String(error) }));

export const tokens = createTokens();
export const ownerRule = { on: true };
export const serve = { ranges: true, pauseMs: 20 };
const ownerOf = (host) => (ownerRule.on ? tokens.ownerOf(host) : undefined);

export function setupSession(ses, partition) {
  installFramePolicies(ses, { partition, ownerOf });
  ses.protocol.handle('maws-artifact', fileFrameResponder(tokens, partition, serve));
  ses.webRequest.onHeadersReceived((details, callback) => {
    if (isCspExempt(details.url)) return callback({});
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [PRODUCTION_CSP] } });
  });
  ses.on('will-download', (event, item) => {
    const cancel = shouldCancelDownload({ url: item.getURL(), urlChain: item.getURLChain() });
    log('event', { type: 'download', partition, url: item.getURL(), chain: item.getURLChain(), policy: cancel ? 'cancelled' : 'allowed' });
    event.preventDefault(); // the spike never saves; an allowed download is recorded as allowed
    item.cancel();
  });
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    const store = isStoreFramePermission([details.requestingUrl, details.securityOrigin]);
    log('event', { type: 'permission', partition, permission, requestingUrl: details.requestingUrl ?? null, granted: !store });
    callback(!store);
  });
  ses.setPermissionCheckHandler((_c, permission, requestingOrigin, details) => permission !== 'deprecated-sync-clipboard-read' && !isStoreFramePermission([requestingOrigin, details.requestingUrl, details.securityOrigin]));
}

// The guard src/main/window.ts and policies.ts put on an app window, each act also written to main's record.
export function guard(wc) {
  safe(() => wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp'));
  wc.on('will-frame-navigate', (event) => {
    const frameBeneath = safe(() => beneathStoreFrame(event.frame), null);
    const initiatorBeneath = safe(() => beneathStoreFrame(event.initiator), null);
    let initiatorShows;
    try {
      initiatorShows = shownArtifact(event.initiator);
    } catch {
      initiatorShows = safe(() => shownArtifact(event.frame), undefined);
    }
    const blocked = shouldBlockFrameNavigation({ url: event.url, frameBeneath, initiatorBeneath, initiatorShows });
    log('event', { type: 'will-frame-navigate', wc: wc.id, url: event.url, isMainFrame: event.isMainFrame, frameUrl: safe(() => event.frame?.url), initiatorUrl: safe(() => event.initiator?.url), blocked });
    if (blocked) event.preventDefault();
  });
  wc.on('will-navigate', (event) => {
    log('event', { type: 'will-navigate', wc: wc.id, url: event.url, blocked: true });
    event.preventDefault();
  });
  wc.on('did-frame-navigate', (_e, url, httpResponseCode, _t, isMainFrame, frameProcessId, frameRoutingId) => log('event', { type: 'did-frame-navigate', wc: wc.id, url, httpResponseCode, isMainFrame, frameProcessId, frameRoutingId }));
  wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => log('event', { type: 'did-fail-load', wc: wc.id, errorCode, errorDescription, url: validatedURL, isMainFrame }));
  wc.setWindowOpenHandler((details) => {
    log('event', { type: 'window-open', wc: wc.id, url: details.url, disposition: details.disposition });
    return { action: 'deny' };
  });
  wc.on('did-create-window', (_w, details) => log('event', { type: 'did-create-window', wc: wc.id, url: details.url }));
  wc.on('console-message', (event) => log('event', { type: 'console', wc: wc.id, level: event.level, message: String(event.message).slice(0, 300), frameUrl: safe(() => event.frame?.url) }));
  wc.on('render-process-gone', (_e, details) => log('event', { type: 'render-process-gone', wc: wc.id, reason: details.reason }));
}

app.on('web-contents-created', (_e, wc) => {
  log('event', { type: 'web-contents-created', id: wc.id, wcType: safe(() => wc.getType()) });
  if (safe(() => wc.getType()) !== 'window') guard(wc); // a viewer of its own, should Electron make one
});

export async function openWindow({ partition, width = 1200, height = 900, own, page = 'index.html', show = true } = {}) {
  const win = new BrowserWindow({
    x: 0, y: 0, width, height, show,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, plugins: true, preload: join(here, 'preload.cjs'), ...(partition ? { partition } : {}) },
  });
  guard(win.webContents);
  if (own) ownFilters.set(win.webContents.id, own);
  await win.loadFile(join(here, 'window', page));
  return win;
}

export const page = (win, code) => within(win.webContents.executeJavaScript(code, true), 20000, { error: 'timeout' });
export const mount = (win, spec) => page(win, `spike.mount(${JSON.stringify(spec)})`);
export const stateOf = (win, id) => page(win, `spike.state(${JSON.stringify(id)})`);

// Every web contents and the frames of each: where Chromium put the PDF viewer.
export function frameTree() {
  return webContents.getAllWebContents().map((w) => ({
    id: w.id, type: safe(() => w.getType()), url: safe(() => w.getURL()),
    frames: safe(() => w.mainFrame.framesInSubtree.map((f) => ({ url: f.url, origin: safe(() => f.origin), pid: f.processId, rid: f.routingId, parent: safe(() => f.parent?.url ?? null) })), []),
  }));
}
const allFrames = () => webContents.getAllWebContents().flatMap((w) => safe(() => w.mainFrame.framesInSubtree, []));
const noFragment = (url) => url.split('#')[0];
// The frame that loaded `url` (by its URL less any fragment), and the viewer frames beneath it.
export function frameOf(url) {
  return allFrames().find((f) => safe(() => noFragment(f.url) === noFragment(url))) ?? null;
}
export function viewerFramesOf(url) {
  const top = frameOf(url);
  if (!top) return [];
  return safe(() => top.framesInSubtree.filter((f) => f.url.startsWith(PDF_VIEWER)), []);
}

// Read inside a viewer frame: its elements by tag and id through every shadow root, with their boxes.
const VIEWER_PROBE = `(() => {
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), display: cs.display, visibility: cs.visibility, hidden: el.hidden === true }; };
  const found = {};
  const dump = [];
  const walk = (root, depth) => {
    for (const el of root.querySelectorAll('*')) {
      const tag = el.tagName.toLowerCase();
      if (el.id || tag.includes('-') || tag === 'embed') {
        if (dump.length < 400) dump.push(tag + (el.id ? '#' + el.id : '') + ' d' + depth + ' ' + JSON.stringify(rect(el)));
        if (!found[tag]) found[tag] = el;
        if (el.id && !found['#' + el.id]) found['#' + el.id] = el;
      }
      if (el.shadowRoot && depth < 10) walk(el.shadowRoot, depth + 1);
    }
  };
  walk(document, 0);
  const sel = found['viewer-page-selector'];
  const input = sel && sel.shadowRoot ? sel.shadowRoot.querySelector('input') : null;
  const viewer = found['pdf-viewer'];
  const pick = (k) => rect(found[k]);
  return { href: location.href, title: document.title, inner: [innerWidth, innerHeight], viewerAttrs: viewer ? [...viewer.attributes].map((a) => a.name + '=' + a.value) : null,
    toolbar: pick('viewer-toolbar'), toolbarById: pick('#toolbar'), sidenav: pick('viewer-pdf-sidenav'), sidenavContainer: pick('#sidenav-container'), thumbnails: pick('viewer-thumbnail-bar'),
    embed: pick('embed'), plugin: pick('#plugin'), main: pick('#main'), centerControls: pick('#center'), progress: pick('#progress'),
    pageInput: input ? input.value : null, docLength: sel && 'docLength' in sel ? sel.docLength : null, dump };
})()`;
export async function probeViewer(url) {
  const frames = viewerFramesOf(url);
  const out = [];
  for (const f of frames) out.push({ frameUrl: safe(() => f.url), probe: await within(f.executeJavaScript(VIEWER_PROBE, false), 4000, { error: 'timeout' }) });
  return out;
}
// The viewer drew the document: its plugin element has a box, and (where the page selector says it) the page count is known.
export function drawn(probes) {
  const p = probes.find((x) => x.probe && !x.probe.error && (x.probe.embed || x.probe.plugin))?.probe;
  if (!p) return null;
  const box = p.embed ?? p.plugin;
  return box && box.w > 0 && box.h > 0 ? p : null;
}
export async function waitDrawn(url, ms = 30000, pages = null) {
  const end = Date.now() + ms;
  let last = [];
  while (Date.now() < end) {
    last = await probeViewer(url);
    const p = drawn(last);
    if (p && (pages === null || Number(p.docLength) === pages)) return { ok: true, probe: p, probes: last };
    await sleep(400);
  }
  return { ok: false, probe: drawn(last), probes: last };
}

// A picture of a window, or of a rectangle of it; and how many distinct colours a grid of samples finds in it (a frame
// Chromium left blank has a handful; the large document's noise pictures have hundreds).
export async function picture(win, path, rect) {
  const img = await win.webContents.capturePage(rect);
  writeFileSync(path, img.toPNG());
  const { width, height } = img.getSize();
  const bmp = img.toBitmap();
  const colours = new Set();
  for (let y = 0; y < height; y += 8) for (let x = 0; x < width; x += 8) {
    const i = (y * width + x) * 4;
    colours.add((bmp[i] << 16) | (bmp[i + 1] << 8) | bmp[i + 2]);
  }
  return { width, height, colours: colours.size };
}

// Main's own record of what a frame reached, as snapshots taken before and after a case.
const xwin = join(here, 'xwin.py');
export const xWindows = () => safe(() => JSON.parse(execFileSync('python3', [xwin, 'list'], { encoding: 'utf8', timeout: 10000 })), []);
export const screenShot = (path) => safe(() => (execFileSync('python3', [xwin, 'shot', path], { timeout: 30000 }), true), false);
export function descendants() {
  const rows = readdirSync('/proc').filter((d) => /^\d+$/.test(d)).map((pid) => safe(() => {
    const s = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = s.lastIndexOf(')');
    return { pid: Number(pid), ppid: Number(s.slice(close + 2).split(' ')[1]), comm: s.slice(s.indexOf('(') + 1, close), exe: safe(() => readlinkSync(`/proc/${pid}/exe`)) };
  })).filter(Boolean);
  const mine = new Set([process.pid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const r of rows) if (!mine.has(r.pid) && mine.has(r.ppid)) { mine.add(r.pid); grew = true; }
  }
  return rows.filter((r) => mine.has(r.pid) && r.pid !== process.pid);
}
export const openerLines = (file) => (file && existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);
export const since = (seq) => records.filter((r) => r.seq > seq);
export const lastSeq = () => (records.length ? records[records.length - 1].seq : 0);
export const exists = (p) => safe(() => statSync(p).isFile(), false);
