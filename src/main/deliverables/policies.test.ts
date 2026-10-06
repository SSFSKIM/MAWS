import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session, WebContents } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deliverableUrl } from '@shared/maws/deliverable';
import type { AppSessionId } from '@shared/graph/ids';
import {
  attributeConsole,
  consoleMessageOf,
  guardFrames,
  installFramePolicies,
  isCspExempt,
  shouldBlockFrameNavigation,
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

describe('the request filter’s decision (E2 Design §3): a deliverable frame reaches nothing outside the scheme', () => {
  it('cancels a deliverable frame’s request for anything that is not the scheme', () => {
    for (const url of ['https://example.com/x.png', 'http://127.0.0.1:8641/', 'wss://example.com/', 'file:///etc/hosts']) {
      expect(shouldCancelRequest({ url, frameUrl: FRAME }), url).toBe(true);
    }
  });

  it('passes Chromium’s PDF viewer its own bundled resources, which a PDF frame asks for (the PDF trial), and nothing beside them', () => {
    expect(shouldCancelRequest({ url: 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/pdf_embedder.css', frameUrl: FRAME, initiatorOrigin: `maws-deliverable://${ID}` })).toBe(false);
    expect(shouldCancelRequest({ url: 'chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh/x.js', frameUrl: FRAME })).toBe(true);
    expect(shouldCancelRequest({ url: 'chrome://resources/js/assert.js', frameUrl: FRAME })).toBe(true);
  });

  it('passes the scheme’s own requests, and an app frame’s requests', () => {
    expect(shouldCancelRequest({ url: deliverableUrl(A, ID, 1), frameUrl: FRAME })).toBe(false);
    expect(shouldCancelRequest({ url: 'https://example.com/', frameUrl: APP })).toBe(false);
    expect(shouldCancelRequest({ url: 'https://example.com/', frameUrl: null })).toBe(false); // a request the browser itself started
  });

  it('judges by the initiator too, which an opaque frame reports as "null" and a non-sandboxed one as the scheme', () => {
    expect(shouldCancelRequest({ url: 'https://example.com/', frameUrl: null, initiatorOrigin: `maws-deliverable://${ID}` })).toBe(true);
    expect(shouldCancelRequest({ url: 'https://example.com/', frameUrl: APP, initiatorOrigin: 'null' })).toBe(false);
  });
});

describe('the frame-navigation decision', () => {
  it('prevents a deliverable frame’s navigation to anything that is not the scheme', () => {
    expect(shouldBlockFrameNavigation({ url: 'https://example.invalid/', frameUrl: FRAME, initiatorUrl: FRAME })).toBe(true);
    expect(shouldBlockFrameNavigation({ url: 'https://example.invalid/', frameUrl: FRAME, initiatorUrl: null })).toBe(true);
    expect(shouldBlockFrameNavigation({ url: 'about:blank', frameUrl: 'about:blank', initiatorUrl: FRAME })).toBe(true); // a frame inside it
  });

  it('lets the app point a frame anywhere (a version switch, the frame’s first load) and the scheme go to itself', () => {
    expect(shouldBlockFrameNavigation({ url: deliverableUrl(A, ID, 1), frameUrl: FRAME, initiatorUrl: FRAME })).toBe(false);
    expect(shouldBlockFrameNavigation({ url: FRAME, frameUrl: 'about:blank', initiatorUrl: APP })).toBe(false);
    expect(shouldBlockFrameNavigation({ url: 'about:blank', frameUrl: FRAME, initiatorUrl: APP })).toBe(false);
  });
});

describe('the download decision', () => {
  it('cancels a download whose URL or redirect chain began in the scheme, and nothing else', () => {
    expect(shouldCancelDownload({ url: FRAME, urlChain: [FRAME] })).toBe(true);
    expect(shouldCancelDownload({ url: 'https://cdn.example/x', urlChain: [FRAME, 'https://cdn.example/x'] })).toBe(true);
    expect(shouldCancelDownload({ url: 'https://example.com/x.zip', urlChain: ['https://example.com/x.zip'] })).toBe(false);
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
    session.beforeRequest!({ url: 'https://example.com/', frame: { url: FRAME } }, ({ cancel }) => answers.push(cancel));
    session.beforeRequest!({ url: 'https://example.com/', frame: { url: APP } }, ({ cancel }) => answers.push(cancel));
    session.beforeRequest!({ url: 'https://example.com/', get frame(): never { throw new Error('Render frame was disposed') } }, ({ cancel }) => answers.push(cancel));
    expect(answers).toEqual([true, false, false]);
  });

  it('cancels a deliverable download and writes the seam line under MAWS_E2E', async () => {
    const session = new FakeSession();
    installFramePolicies(session as unknown as Session, e2e());
    const blocked = { preventDefault: vi.fn() };
    const allowed = { preventDefault: vi.fn() };
    const download = item(FRAME);
    session.emit('will-download', blocked, download, null);
    session.emit('will-download', allowed, item('https://example.com/x.zip'), null);
    await settle();
    expect(blocked.preventDefault).toHaveBeenCalled();
    expect(download.cancel).toHaveBeenCalled();
    expect(allowed.preventDefault).not.toHaveBeenCalled();
    expect(await logLines()).toEqual([`blocked-download ${FRAME}`]);
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
    const blocked = { url: 'https://example.invalid/', isMainFrame: false, frame: { url: FRAME }, initiator: { url: FRAME }, preventDefault: vi.fn() };
    const allowed = { url: deliverableUrl(A, ID, 1), isMainFrame: false, frame: { url: FRAME }, initiator: { url: APP }, preventDefault: vi.fn() };
    contents.emit('will-frame-navigate', blocked);
    contents.emit('will-frame-navigate', allowed);
    await settle();
    expect(blocked.preventDefault).toHaveBeenCalled();
    expect(allowed.preventDefault).not.toHaveBeenCalled();
    expect(await logLines()).toEqual(['blocked-navigation https://example.invalid/']);
  });
});
