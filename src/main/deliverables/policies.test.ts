import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session, WebContents } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliverableConsoleSchema } from '@shared/ipc/schema/deliverables';
import { deliverableUrl } from '@shared/maws/deliverable';
import type { AppSessionId } from '@shared/graph/ids';
import {
  attributeConsole,
  consoleMessageOf,
  guardFrames,
  installFramePolicies,
  isCspExempt,
  beneathDeliverable,
  consoleLimiter,
  CONSOLE_BURST,
  CONSOLE_WINDOW_MS,
  guardPermissions,
  isDeliverablePermission,
  shouldBlockFrameNavigation,
  type FrameLike,
  shouldCancelDownload,
  shouldCancelRequest,
} from './policies';

const A = 'App-A' as AppSessionId;
const ID = '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
const FRAME = deliverableUrl(A, ID, 2);
const APP = 'file:///Applications/MAWS.app/Contents/Resources/app/out/renderer/index.html';

let dir: string;
let log: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'maws-policies-'));
  log = join(dir, 'open.log');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
const e2e = () => ({ MAWS_E2E: '1', MAWS_E2E_OPEN_LOG: log });
const logLines = () => readFile(log, 'utf8').then((text) => text.split('\n').filter(Boolean), () => []);
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

// Faked frames: a chain of urls from the top frame down, each the parent of the next; the last is answered.
const chain = (...urls: string[]): FrameLike => urls.reduce<FrameLike | null>((parent, url) => ({ url, parent }), null)!;
const VIEWER = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html';
const disposed: FrameLike = {
  get url(): string {
    throw new Error('Render frame was disposed');
  },
  parent: null,
};

describe('a frame’s ancestry (Decision Log 31): a deliverable frame and every frame beneath it', () => {
  it('finds a deliverable frame itself, its children and grandchildren, and nothing in the app beside them', () => {
    expect(beneathDeliverable(chain(APP, FRAME))).toBe(true);
    expect(beneathDeliverable(chain(APP, FRAME, VIEWER))).toBe(true); // Chromium's PDF viewer inside a PDF frame
    expect(beneathDeliverable(chain(APP, FRAME, VIEWER, 'about:blank'))).toBe(true);
    expect(beneathDeliverable(chain(APP))).toBe(false);
    expect(beneathDeliverable(chain(APP, 'about:srcdoc'))).toBe(false); // the request card's own frame
    expect(beneathDeliverable(null)).toBe(false);
  });

  it('answers null when a frame can no longer be read', () => {
    expect(beneathDeliverable(disposed)).toBeNull();
    expect(beneathDeliverable({ url: 'about:blank', parent: disposed })).toBeNull();
  });
});

describe('the request filter’s decision (E2 Design §3): beneath a deliverable frame, nothing outside Electron', () => {
  it('cancels a request from a deliverable frame, or from beneath one, for anything outside the scheme and the viewer', () => {
    for (const url of ['https://example.com/x.png', 'http://127.0.0.1:8641/', 'wss://example.com/', 'file:///etc/hosts', 'chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh/x.js', 'chrome://settings/']) {
      expect(shouldCancelRequest({ url, beneath: true }), url).toBe(true);
    }
    expect(shouldCancelRequest({ url: 'https://example.com/', beneath: beneathDeliverable(chain(APP, FRAME, VIEWER)) })).toBe(true); // a PDF link the viewer follows
  });

  it('passes the scheme, the PDF viewer’s files (the PDF trial) and chrome://resources/ beneath one', () => {
    for (const url of [deliverableUrl(A, ID, 1), 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/pdf_embedder.css', 'chrome://resources/js/assert.js']) {
      expect(shouldCancelRequest({ url, beneath: true }), url).toBe(false);
    }
  });

  it('passes the app’s own requests, and a request the browser itself started', () => {
    expect(shouldCancelRequest({ url: 'https://example.com/', beneath: false })).toBe(false);
    expect(shouldCancelRequest({ url: 'https://example.com/', beneath: null })).toBe(false);
  });

  it('judges by the initiator too, which an opaque frame reports as "null" and an unsandboxed one as the scheme', () => {
    expect(shouldCancelRequest({ url: 'https://example.com/', beneath: null, initiatorOrigin: `maws-deliverable://${ID}` })).toBe(true);
    expect(shouldCancelRequest({ url: 'https://example.com/', beneath: false, initiatorOrigin: 'null' })).toBe(false);
  });
});

describe('the frame-navigation decision', () => {
  const decide = (url: string, frame: FrameLike | null, initiator: FrameLike | null) => shouldBlockFrameNavigation({ url, frameBeneath: beneathDeliverable(frame), initiatorBeneath: beneathDeliverable(initiator) });

  it('prevents a navigation of, or asked by, a frame at or beneath a deliverable frame to anything outside the three', () => {
    expect(decide('https://example.invalid/', chain(APP, FRAME), chain(APP, FRAME))).toBe(true); // a link in the page
    expect(decide('https://example.invalid/', chain(APP, FRAME), null)).toBe(true);
    expect(decide('about:blank', chain(APP, FRAME, 'about:blank'), chain(APP, FRAME))).toBe(true); // a frame inside it
    expect(decide('https://example.invalid/', chain(APP, FRAME, VIEWER), chain(APP, FRAME, VIEWER))).toBe(true); // a PDF link in the viewer
    expect(decide('https://example.invalid/', chain(APP, FRAME), chain(APP))).toBe(true); // the app never points it elsewhere
    expect(decide('https://example.invalid/', disposed, null)).toBe(true); // unreadable counts as beneath
  });

  it('lets a version switch, the frame’s first load and the viewer’s own frames through, and leaves the app’s frames alone', () => {
    expect(decide(deliverableUrl(A, ID, 1), chain(APP, FRAME), chain(APP))).toBe(false);
    expect(decide(FRAME, chain(APP, 'about:blank'), chain(APP))).toBe(false);
    expect(decide('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/23200f28', chain(APP, FRAME, VIEWER, 'about:blank'), chain(APP, FRAME, VIEWER))).toBe(false);
    expect(decide('about:srcdoc', chain(APP, 'about:blank'), chain(APP))).toBe(false);
  });
});

describe('the download decision', () => {
  it('cancels a download whose URL or redirect chain is the scheme’s or the PDF viewer’s save, and nothing else', () => {
    expect(shouldCancelDownload({ url: FRAME, urlChain: [FRAME] })).toBe(true);
    expect(shouldCancelDownload({ url: 'https://cdn.example/x', urlChain: [FRAME, 'https://cdn.example/x'] })).toBe(true);
    expect(shouldCancelDownload({ url: 'blob:chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/5b1e', urlChain: ['blob:chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/5b1e'] })).toBe(true);
    expect(shouldCancelDownload({ url: 'https://example.com/x.zip', urlChain: ['https://example.com/x.zip'] })).toBe(false);
    expect(shouldCancelDownload({ url: 'blob:file:///7c2a', urlChain: ['blob:file:///7c2a'] })).toBe(false); // the app page's own
  });
});

describe('permission attribution', () => {
  it('names a deliverable frame by any origin Electron reports, and nothing else', () => {
    expect(isDeliverablePermission([`maws-deliverable://${ID}`])).toBe(true);
    expect(isDeliverablePermission([undefined, FRAME])).toBe(true);
    expect(isDeliverablePermission([APP, 'file:///'])).toBe(false);
    expect(isDeliverablePermission([VIEWER])).toBe(false); // the viewer's own needs keep the default
    expect(isDeliverablePermission([])).toBe(false);
  });
});

describe('the app-wide policy’s exemption', () => {
  it('exempts the scheme’s answers, which carry their own policy, and the PDF viewer’s own pages, and nothing else', () => {
    expect(isCspExempt(FRAME)).toBe(true);
    expect(isCspExempt('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html')).toBe(true); // the app's policy refuses its chrome://resources scripts
    expect(isCspExempt('chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh/index.html')).toBe(false);
    expect(isCspExempt(APP)).toBe(false);
    expect(isCspExempt('http://localhost:5173/')).toBe(false);
  });
});

describe('console attribution', () => {
  it('reads a deliverable frame’s error and warning, and nothing else', () => {
    const at = { frame: { url: `${FRAME}#section` }, lineNumber: 7, sourceId: FRAME };
    expect(consoleMessageOf({ ...at, level: 'error', message: 'Uncaught Error: E2_BOOM' })).toEqual({ appSessionId: A, deliverableId: ID, version: 2, level: 'error', message: 'Uncaught Error: E2_BOOM', line: 7, source: FRAME });
    expect(consoleMessageOf({ ...at, level: 'warning', message: 'w', sourceId: '' })).toMatchObject({ level: 'warning', source: null });
    expect(consoleMessageOf({ ...at, level: 'info', message: 'i' })).toBeNull();
    expect(consoleMessageOf({ ...at, frame: { url: APP }, level: 'error', message: 'app' })).toBeNull();
    expect(consoleMessageOf({ ...at, frame: null, level: 'error', message: 'gone' })).toBeNull();
  });

  it('emits deliverables.console from the window’s webContents', () => {
    const contents = new EventEmitter();
    const emit = vi.fn();
    attributeConsole(contents as unknown as WebContents, emit);
    contents.emit('console-message', { frame: { url: FRAME }, level: 'error', message: 'boom', lineNumber: 1, sourceId: FRAME });
    contents.emit('console-message', { frame: { url: APP }, level: 'error', message: 'app', lineNumber: 1, sourceId: APP });
    expect(emit).toHaveBeenCalledExactlyOnceWith('deliverables.console', expect.objectContaining({ deliverableId: ID, message: 'boom' }));
  });

  it('cuts a message at 2,000 characters, which the event’s schema bounds too', () => {
    const message = consoleMessageOf({ frame: { url: FRAME }, level: 'error', message: 'x'.repeat(5000), lineNumber: 1, sourceId: FRAME })!;
    expect(message.message).toHaveLength(2000);
    expect(DeliverableConsoleSchema.safeParse(message).success).toBe(true);
    expect(DeliverableConsoleSchema.safeParse({ ...message, message: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('admits at most CONSOLE_BURST messages per deliverable version in a window, each version counted apart', () => {
    let now = 0;
    const admit = consoleLimiter(() => now);
    const v2 = consoleMessageOf({ frame: { url: FRAME }, level: 'error', message: 'loop', lineNumber: 1, sourceId: FRAME })!;
    const v1 = { ...v2, version: 1 };
    const admitted = Array.from({ length: CONSOLE_BURST + 10 }, () => admit(v2)).filter(Boolean);
    expect(admitted).toHaveLength(CONSOLE_BURST);
    expect(admit(v1)).toBe(true); // another version has its own budget
    now += CONSOLE_WINDOW_MS - 1;
    expect(admit(v2)).toBe(false);
    now += 1;
    expect(admit(v2)).toBe(true); // a new window
  });

  it('drops what the bound refuses on the real listener', () => {
    const contents = new EventEmitter();
    const emit = vi.fn();
    attributeConsole(contents as unknown as WebContents, emit, () => 0);
    for (let k = 0; k < CONSOLE_BURST + 5; k++) contents.emit('console-message', { frame: { url: FRAME }, level: 'error', message: `m${k}`, lineNumber: 1, sourceId: FRAME });
    expect(emit).toHaveBeenCalledTimes(CONSOLE_BURST);
  });
});

describe('the policies installed on a session and a window', () => {
  class FakeSession extends EventEmitter {
    beforeRequest: ((details: unknown, callback: (response: { cancel: boolean }) => void) => void) | null = null;
    filter: unknown = null;
    webRequest = {
      onBeforeRequest: (filter: unknown, listener: FakeSession['beforeRequest']) => {
        this.filter = filter;
        this.beforeRequest = listener;
      },
    };
  }
  const item = (url: string) => ({ getURL: () => url, getURLChain: () => [url], cancel: vi.fn() });

  it('cancels a deliverable frame’s request on the real listener, over every URL', () => {
    const session = new FakeSession();
    installFramePolicies(session as unknown as Session, {});
    expect(session.filter).toEqual({ urls: ['<all_urls>'] });
    const answers: boolean[] = [];
    session.beforeRequest!({ url: 'https://example.com/', frame: chain(APP, FRAME) }, ({ cancel }) => answers.push(cancel));
    session.beforeRequest!({ url: 'https://example.com/', frame: chain(APP, FRAME, VIEWER) }, ({ cancel }) => answers.push(cancel)); // the PDF viewer's frame
    session.beforeRequest!({ url: 'chrome://resources/js/assert.js', frame: chain(APP, FRAME, VIEWER) }, ({ cancel }) => answers.push(cancel));
    session.beforeRequest!({ url: 'https://example.com/', frame: chain(APP) }, ({ cancel }) => answers.push(cancel));
    session.beforeRequest!({ url: 'https://example.com/', get frame(): never { throw new Error('Render frame was disposed') } }, ({ cancel }) => answers.push(cancel));
    expect(answers).toEqual([true, true, false, false, false]);
  });

  it('cancels a deliverable download and writes the seam line under MAWS_E2E', async () => {
    const session = new FakeSession();
    installFramePolicies(session as unknown as Session, e2e());
    const blocked = { preventDefault: vi.fn() };
    const allowed = { preventDefault: vi.fn() };
    const download = item(FRAME);
    const save = { preventDefault: vi.fn() };
    session.emit('will-download', blocked, download, null);
    session.emit('will-download', save, item('blob:chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/5b1e'), null); // the PDF viewer's Save
    session.emit('will-download', allowed, item('https://example.com/x.zip'), null);
    await settle();
    expect(blocked.preventDefault).toHaveBeenCalled();
    expect(download.cancel).toHaveBeenCalled();
    expect(allowed.preventDefault).not.toHaveBeenCalled();
    expect(save.preventDefault).toHaveBeenCalled();
    expect(await logLines()).toEqual([`blocked-download ${FRAME}`, 'blocked-download blob:chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/5b1e']);
  });

  it('writes no seam line outside the e2e', async () => {
    const session = new FakeSession();
    installFramePolicies(session as unknown as Session, { MAWS_E2E_OPEN_LOG: log });
    session.emit('will-download', { preventDefault: vi.fn() }, item(FRAME), null);
    await settle();
    expect(await logLines()).toEqual([]);
  });

  it('prevents a deliverable frame’s navigation, writes the seam line, and turns off non-proxied UDP for WebRTC', async () => {
    const contents = Object.assign(new EventEmitter(), { setWebRTCIPHandlingPolicy: vi.fn() });
    guardFrames(contents as unknown as WebContents, e2e());
    expect(contents.setWebRTCIPHandlingPolicy).toHaveBeenCalledWith('disable_non_proxied_udp');
    const blocked = { url: 'https://example.invalid/', isMainFrame: false, frame: chain(APP, FRAME), initiator: chain(APP, FRAME), preventDefault: vi.fn() };
    const fromViewer = { url: 'https://example.invalid/pdf-link', isMainFrame: false, frame: chain(APP, FRAME, VIEWER), initiator: chain(APP, FRAME, VIEWER), preventDefault: vi.fn() };
    const allowed = { url: deliverableUrl(A, ID, 1), isMainFrame: false, frame: chain(APP, FRAME), initiator: chain(APP), preventDefault: vi.fn() };
    const app = { url: 'about:srcdoc', isMainFrame: false, frame: chain(APP, 'about:blank'), initiator: chain(APP), preventDefault: vi.fn() };
    for (const event of [blocked, fromViewer, allowed, app]) contents.emit('will-frame-navigate', event);
    await settle();
    expect(blocked.preventDefault).toHaveBeenCalled();
    expect(fromViewer.preventDefault).toHaveBeenCalled();
    expect(allowed.preventDefault).not.toHaveBeenCalled();
    expect(app.preventDefault).not.toHaveBeenCalled();
    expect(await logLines()).toEqual(['blocked-navigation https://example.invalid/', 'blocked-navigation https://example.invalid/pdf-link']);
  });

  class PermissionSession {
    request: ((contents: unknown, permission: string, callback: (granted: boolean) => void, details: Record<string, unknown>) => void) | null = null;
    check: ((contents: unknown, permission: string, origin: string, details: Record<string, unknown>) => boolean) | null = null;
    setPermissionRequestHandler(handler: PermissionSession['request']) {
      this.request = handler;
    }
    setPermissionCheckHandler(handler: PermissionSession['check']) {
      this.check = handler;
    }
    asked(permission: string, details: Record<string, unknown>): boolean {
      let granted: boolean | null = null;
      this.request!(null, permission, (answer) => (granted = answer), { isMainFrame: false, ...details });
      return granted!;
    }
  }

  it('denies every permission request and check on the capture partition', () => {
    const session = new PermissionSession();
    guardPermissions(session as unknown as Session, 'all');
    expect(session.asked('media', { requestingUrl: FRAME })).toBe(false);
    expect(session.asked('notifications', { requestingUrl: APP })).toBe(false);
    expect(session.check!(null, 'clipboard-read', 'file:///', { isMainFrame: true })).toBe(false);
  });

  it('denies a deliverable frame’s permissions on the app’s session and keeps the default for the app and the PDF viewer', () => {
    const session = new PermissionSession();
    guardPermissions(session as unknown as Session, 'deliverables');
    expect(session.asked('media', { requestingUrl: FRAME })).toBe(false);
    expect(session.asked('geolocation', { requestingUrl: 'about:blank', securityOrigin: `maws-deliverable://${ID}` })).toBe(false);
    expect(session.check!(null, 'clipboard-read', `maws-deliverable://${ID}`, { isMainFrame: false })).toBe(false);
    expect(session.check!(null, 'clipboard-read', 'chrome-extension://x', { isMainFrame: false, requestingUrl: FRAME })).toBe(false);
    expect(session.asked('clipboard-sanitized-write', { requestingUrl: APP })).toBe(true);
    expect(session.asked('clipboard-sanitized-write', { requestingUrl: VIEWER })).toBe(true);
    expect(session.check!(null, 'clipboard-sanitized-write', 'file:///', { isMainFrame: true, requestingUrl: APP })).toBe(true);
  });
});
