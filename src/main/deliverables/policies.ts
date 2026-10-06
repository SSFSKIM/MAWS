// Main-side policies for every deliverable frame, whatever its sandbox (E2 execution document, Design §3 and §12, G3;
// Decision Log 20, 22 and 31): defence in depth for the viewer's sandboxed frames, and the whole defence for the PDF
// frame, which the trial leaves without a sandbox. A frame is judged by its ancestry: a `maws-deliverable:` frame and
// every frame beneath it (Chromium's PDF viewer is a `chrome-extension:` child of the PDF's frame, and it is where the
// PDF's links are handled) may reach only the scheme, the PDF viewer's own files and `chrome://resources/`, all inside
// Electron. On a session (the window's default session and the capture partition): a request filter, a download filter
// and permission handlers. On a webContents (the app window, the capture window): a guard on subframe navigations and
// the WebRTC policy (CSP does not govern WebRTC, and STUN never passes `webRequest`). New windows and top-level
// navigations are already refused on every window (`window.ts`, `capture.ts`). Under MAWS_E2E=1 with
// MAWS_E2E_OPEN_LOG set, a cancelled navigation or download appends `blocked-navigation <url>` or
// `blocked-download <url>` to the seam log, so the e2e sees the policies run on the real session and webContents.
//
// Console attribution (Design §8, Decision Log 9) lives here too: a message an app window's deliverable frame logged,
// read by the frame's URL, becomes the main-owned event `deliverables.console`, cut and rate-bounded.
import { appendFile } from 'node:fs/promises';
import type { Session, WebContents } from 'electron';
import { DELIVERABLE_CONSOLE_MESSAGE_MAX, type DeliverableConsole } from '@shared/ipc/schema/deliverables';
import { DELIVERABLE_SCHEME, parseDeliverableUrl } from '@shared/maws/deliverable';

const PREFIX = `${DELIVERABLE_SCHEME}://`;
const isDeliverable = (url: string | null | undefined): boolean => typeof url === 'string' && url.startsWith(PREFIX);

// Chromium's built-in PDF viewer (Electron's internal extension, a fixed id): the PDF frame asks it for its bundled
// files (`pdf_embedder.css`, measured in the trial), and the viewer's own page loads `chrome://resources/` scripts.
// These are files inside Electron, never the network. Its Save writes a `blob:` of its own origin.
const PDF_VIEWER = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/';
const PDF_VIEWER_BLOB = `blob:${PDF_VIEWER}`;
const ALLOWED_BENEATH = [PREFIX, PDF_VIEWER, 'chrome://resources/'];
const allowedBeneath = (url: string) => ALLOWED_BENEATH.some((prefix) => url.startsWith(prefix));

// ---- the decisions --------------------------------------------------------------------------------------------------

// What a frame offers of itself: Electron's WebFrameMain, or a test's stand-in.
export interface FrameLike {
  readonly url: string;
  readonly parent: FrameLike | null;
}

const MAX_DEPTH = 64; // frames nest far less deep; a bound keeps a malformed chain from looping

// Whether a frame is a deliverable frame or lies beneath one; null when that cannot be read (Electron throws on a
// disposed frame's properties), so the caller falls back to what else it knows.
export function beneathDeliverable(frame: FrameLike | null | undefined): boolean | null {
  try {
    let current = frame ?? null;
    for (let depth = 0; current && depth < MAX_DEPTH; depth++, current = current.parent) {
      if (isDeliverable(current.url)) return true;
    }
    return false;
  } catch {
    return null;
  }
}

// A request whose frame is (or lies beneath) a deliverable frame, or whose initiator is the scheme (an unsandboxed frame
// reports it; a sandboxed one reports the opaque "null"), for anything outside the scheme, the PDF viewer's files and
// `chrome://resources/`: http, https, ws, wss and file alike. `data:` and `blob:` never reach `webRequest`.
export function shouldCancelRequest(details: { url: string; beneath: boolean | null; initiatorOrigin?: string }): boolean {
  if (allowedBeneath(details.url)) return false;
  return details.beneath === true || isDeliverable(details.initiatorOrigin);
}

// A subframe navigation of a frame that is (or lies beneath) a deliverable frame, or asked by one, to anything outside
// the same three. The app never points a deliverable frame elsewhere (a version switch stays in the scheme; React
// removes the frame rather than navigating it away). A frame that can no longer be read counts as beneath one.
export function shouldBlockFrameNavigation(details: { url: string; frameBeneath: boolean | null; initiatorBeneath: boolean | null }): boolean {
  if (allowedBeneath(details.url)) return false;
  return details.frameBeneath !== false || details.initiatorBeneath === true;
}

// A download whose URL, or any URL of its redirect chain, is the scheme's or the PDF viewer's save (`blob:` of its
// origin). Electron's DownloadItem reports no referrer; a sandboxed frame without `allow-downloads` cannot start one at
// all. The app's own page never downloads (exports go through main's save dialog), and its blobs are `blob:file:`.
export function shouldCancelDownload(details: { url: string; urlChain: readonly string[] }): boolean {
  return [details.url, ...details.urlChain].some((url) => isDeliverable(url) || url.startsWith(PDF_VIEWER_BLOB));
}

// The app-wide policy (`window.ts`) leaves the scheme's answers alone: each carries its own (`protocol.ts`). It leaves
// the PDF viewer's own pages alone too: they carry Chromium's policy, and the app's (`script-src 'self'`) refuses the
// `chrome://resources` scripts the viewer is built from, so a PDF frame stayed an empty viewer (the PDF trial).
export function isCspExempt(url: string): boolean {
  return isDeliverable(url) || url.startsWith(PDF_VIEWER);
}

// Whether a permission request or check comes from a deliverable frame, by every origin Electron reports for it.
// (Permission details carry no frame, so no ancestry: the only frames that can lie beneath a deliverable frame are the
// scheme's own, whose origin is the scheme, and the PDF viewer's, whose needs are Chromium's and keep the default.)
export function isDeliverablePermission(origins: readonly (string | null | undefined)[]): boolean {
  return origins.some(isDeliverable);
}

// A console message of a deliverable frame, as `deliverables.console` carries it (the message cut to its schema's
// bound); null for anything else.
export function consoleMessageOf(details: {
  frame: { url: string } | null;
  level: string;
  message: string;
  lineNumber: number;
  sourceId: string;
}): DeliverableConsole | null {
  if (details.level !== 'error' && details.level !== 'warning') return null;
  let url: string | null;
  try {
    url = details.frame?.url ?? null;
  } catch {
    url = null;
  }
  const target = url === null ? null : parseDeliverableUrl(url);
  if (!target) return null;
  return {
    appSessionId: target.appSessionId,
    deliverableId: target.id,
    version: target.version,
    level: details.level,
    message: details.message.slice(0, DELIVERABLE_CONSOLE_MESSAGE_MAX),
    line: Number.isInteger(details.lineNumber) ? details.lineNumber : null,
    source: details.sourceId || null,
  };
}

// The console's rate bound: at most CONSOLE_BURST messages per (appSessionId, deliverableId, version) in any
// CONSOLE_WINDOW_MS window; the rest of that window is dropped. 50 is what the renderer's ring buffer keeps per key, so
// a page logging in a loop costs at most one buffer's worth of IPC every ten seconds.
export const CONSOLE_BURST = 50;
export const CONSOLE_WINDOW_MS = 10_000;
const CONSOLE_KEYS_PRUNE_AT = 256;

export function consoleLimiter(now: () => number = Date.now): (message: DeliverableConsole) => boolean {
  const windows = new Map<string, { start: number; count: number }>();
  return (message) => {
    const at = now();
    const key = `${message.appSessionId}/${message.deliverableId}/${message.version}`;
    let window = windows.get(key);
    if (!window || at - window.start >= CONSOLE_WINDOW_MS) {
      if (windows.size >= CONSOLE_KEYS_PRUNE_AT) for (const [k, w] of windows) if (at - w.start >= CONSOLE_WINDOW_MS) windows.delete(k);
      window = { start: at, count: 0 };
      windows.set(key, window);
    }
    window.count++;
    return window.count <= CONSOLE_BURST;
  };
}

// ---- installing them ------------------------------------------------------------------------------------------------

// `beneathDeliverable` of a frame read from an Electron event, whose getter itself throws for a disposed frame.
function beneathRead(read: () => FrameLike | null | undefined): boolean | null {
  try {
    return beneathDeliverable(read());
  } catch {
    return null;
  }
}

export type SeamEnv = NodeJS.ProcessEnv; // MAWS_E2E and MAWS_E2E_OPEN_LOG, the e2e's seam log (as the files service reads them)

function seam(env: SeamEnv, line: string): void {
  if (env.MAWS_E2E !== '1' || !env.MAWS_E2E_OPEN_LOG) return;
  appendFile(env.MAWS_E2E_OPEN_LOG, `${line}\n`).catch((error: unknown) => console.warn('[deliverables] could not write the e2e seam log', error));
}

// The session's request filter (its only `onBeforeRequest` listener: nothing else in main installs one) and download
// filter.
export function installFramePolicies(session: Session, env: SeamEnv): void {
  session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: shouldCancelRequest({ url: details.url, beneath: beneathRead(() => details.frame), initiatorOrigin: details.initiatorOrigin }) });
  });
  session.on('will-download', (event, item) => {
    if (!shouldCancelDownload({ url: item.getURL(), urlChain: item.getURLChain() })) return;
    event.preventDefault();
    item.cancel();
    seam(env, `blocked-download ${item.getURL()}`);
  });
}

// Permissions (the session's only handlers: nothing else in main installs one). `all`: the capture partition, which
// holds nothing but captures, denies every request and check. `deliverables`: the app's session denies a deliverable
// frame's and keeps Electron's default (granted) for everything else, the app page and the PDF viewer included.
export function guardPermissions(session: Session, scope: 'all' | 'deliverables'): void {
  if (scope === 'all') {
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    return;
  }
  session.setPermissionRequestHandler((_contents, _permission, callback, details) => {
    const { requestingUrl, securityOrigin } = details as { requestingUrl?: string; securityOrigin?: string };
    callback(!isDeliverablePermission([requestingUrl, securityOrigin]));
  });
  session.setPermissionCheckHandler((_contents, _permission, requestingOrigin, details) => !isDeliverablePermission([requestingOrigin, details.requestingUrl, details.securityOrigin]));
}

// A window's guard on its frames' navigations, and its WebRTC policy.
export function guardFrames(contents: WebContents, env: SeamEnv): void {
  contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  contents.on('will-frame-navigate', (event) => {
    const frameBeneath = beneathRead(() => event.frame);
    const initiatorBeneath = beneathRead(() => event.initiator);
    if (!shouldBlockFrameNavigation({ url: event.url, frameBeneath, initiatorBeneath })) return;
    event.preventDefault();
    seam(env, `blocked-navigation ${event.url}`);
  });
}

// An app window's deliverable frames' errors and warnings, as `deliverables.console` (the capture window's go into the
// screenshot's result instead: `capture.ts`), at most CONSOLE_BURST per deliverable version per window of time.
export function attributeConsole(contents: WebContents, emit: (name: 'deliverables.console', payload: DeliverableConsole) => unknown, now?: () => number): void {
  const admit = consoleLimiter(now);
  contents.on('console-message', (event) => {
    const message = consoleMessageOf(event);
    if (message && admit(message)) emit('deliverables.console', message);
  });
}
