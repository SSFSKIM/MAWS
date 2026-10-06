// Main-side policies for every deliverable frame, whatever its sandbox (E2 execution document, Design §3 and §12, G3;
// Decision Log 20 and 22): defence in depth for the viewer's sandboxed frames, and the whole defence for a frame the
// PDF trial leaves without a sandbox. On a session (the window's default session and the capture partition): a request
// filter that cancels any request a `maws-deliverable:` frame makes for anything outside the scheme, and a download
// filter. On a webContents (the app window, the capture window): a guard on subframe navigations and the WebRTC policy
// (CSP does not govern WebRTC, and STUN never passes `webRequest`). New windows and top-level navigations are already
// refused on every window (`window.ts`, `capture.ts`). Under MAWS_E2E=1 with MAWS_E2E_OPEN_LOG set, a cancelled
// navigation or download appends `blocked-navigation <url>` or `blocked-download <url>` to the seam log, so the e2e
// sees the policies run on the real session and webContents.
//
// Console attribution (Design §8, Decision Log 9) lives here too: a message an app window's deliverable frame logged,
// read by the frame's URL, becomes the main-owned event `deliverables.console`.
import { appendFile } from 'node:fs/promises';
import type { Session, WebContents } from 'electron';
import type { DeliverableConsole } from '@shared/ipc/schema/deliverables';
import { DELIVERABLE_SCHEME, parseDeliverableUrl } from '@shared/maws/deliverable';

const PREFIX = `${DELIVERABLE_SCHEME}://`;
const isDeliverable = (url: string | null | undefined): boolean => typeof url === 'string' && url.startsWith(PREFIX);

// A frame's URL, or null when the frame is gone (Electron throws on a disposed frame's properties).
function urlOf(frame: (() => { url: string } | null | undefined) | { url: string } | null | undefined): string | null {
  try {
    const value = typeof frame === 'function' ? frame() : frame;
    return value?.url ?? null;
  } catch {
    return null;
  }
}

// ---- the decisions --------------------------------------------------------------------------------------------------

// Chromium's built-in PDF viewer (Electron's internal extension): a PDF frame, which the trial leaves without a sandbox,
// asks for the viewer's own bundled resources from it (`pdf_embedder.css`, measured in the trial), so they pass. They are
// files inside Electron, never the network.
const PDF_VIEWER = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/';

// A request made by a deliverable frame (its document's URL, or an initiator in the scheme, which a frame without a
// sandbox reports) for anything that is not the scheme or the PDF viewer: http, https, ws, wss and file alike. `data:`
// and `blob:` never reach `webRequest`. A sandboxed frame's initiator is the opaque "null", so its frame's URL is what
// names it.
export function shouldCancelRequest(details: { url: string; frameUrl?: string | null; initiatorOrigin?: string }): boolean {
  if (isDeliverable(details.url) || details.url.startsWith(PDF_VIEWER)) return false;
  return isDeliverable(details.frameUrl) || isDeliverable(details.initiatorOrigin);
}

// A subframe navigation asked by a deliverable frame (or, with no initiator, of a deliverable frame) to anything that is
// not the scheme. The app pointing its own frame elsewhere (a version switch, an unmount to about:blank) is its own.
export function shouldBlockFrameNavigation(details: { url: string; frameUrl: string | null; initiatorUrl: string | null }): boolean {
  if (isDeliverable(details.url)) return false;
  return isDeliverable(details.initiatorUrl ?? details.frameUrl);
}

// A download whose URL, or any URL of its redirect chain, is the scheme's. (Electron's DownloadItem reports no
// referrer; a sandboxed frame without `allow-downloads` cannot start one of its own at all.)
export function shouldCancelDownload(details: { url: string; urlChain: readonly string[] }): boolean {
  return isDeliverable(details.url) || details.urlChain.some(isDeliverable);
}

// The app-wide policy (`window.ts`) leaves the scheme's answers alone: each carries its own (`protocol.ts`). It leaves
// the PDF viewer's own pages alone too: they carry Chromium's policy, and the app's (`script-src 'self'`) refuses the
// `chrome://resources` scripts the viewer is built from, so a PDF frame stayed an empty viewer (the PDF trial).
export function isCspExempt(url: string): boolean {
  return isDeliverable(url) || url.startsWith(PDF_VIEWER);
}

// A console message of a deliverable frame, as `deliverables.console` carries it; null for anything else.
export function consoleMessageOf(details: {
  frame: { url: string } | null;
  level: string;
  message: string;
  lineNumber: number;
  sourceId: string;
}): DeliverableConsole | null {
  if (details.level !== 'error' && details.level !== 'warning') return null;
  const url = urlOf(() => details.frame);
  const target = url === null ? null : parseDeliverableUrl(url);
  if (!target) return null;
  return {
    appSessionId: target.appSessionId,
    deliverableId: target.id,
    version: target.version,
    level: details.level,
    message: details.message,
    line: Number.isInteger(details.lineNumber) ? details.lineNumber : null,
    source: details.sourceId || null,
  };
}

// ---- installing them ------------------------------------------------------------------------------------------------

export type SeamEnv = NodeJS.ProcessEnv; // MAWS_E2E and MAWS_E2E_OPEN_LOG, the e2e's seam log (as the files service reads them)

function seam(env: SeamEnv, line: string): void {
  if (env.MAWS_E2E !== '1' || !env.MAWS_E2E_OPEN_LOG) return;
  appendFile(env.MAWS_E2E_OPEN_LOG, `${line}\n`).catch((error: unknown) => console.warn('[deliverables] could not write the e2e seam log', error));
}

// The session's request filter (its only `onBeforeRequest` listener: nothing else in main installs one) and download
// filter.
export function installFramePolicies(session: Session, env: SeamEnv): void {
  session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: shouldCancelRequest({ url: details.url, frameUrl: urlOf(() => details.frame), initiatorOrigin: details.initiatorOrigin }) });
  });
  session.on('will-download', (event, item) => {
    if (!shouldCancelDownload({ url: item.getURL(), urlChain: item.getURLChain() })) return;
    event.preventDefault();
    item.cancel();
    seam(env, `blocked-download ${item.getURL()}`);
  });
}

// A window's guard on its frames' navigations, and its WebRTC policy.
export function guardFrames(contents: WebContents, env: SeamEnv): void {
  contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  contents.on('will-frame-navigate', (event) => {
    if (!shouldBlockFrameNavigation({ url: event.url, frameUrl: urlOf(() => event.frame), initiatorUrl: urlOf(() => event.initiator) })) return;
    event.preventDefault();
    seam(env, `blocked-navigation ${event.url}`);
  });
}

// An app window's deliverable frames' errors and warnings, as `deliverables.console` (the capture window's go into the
// screenshot's result instead: `capture.ts`).
export function attributeConsole(contents: WebContents, emit: (name: 'deliverables.console', payload: DeliverableConsole) => unknown): void {
  contents.on('console-message', (event) => {
    const message = consoleMessageOf(event);
    if (message) emit('deliverables.console', message);
  });
}
