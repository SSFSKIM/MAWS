import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session, WebContents } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtifactConsoleSchema } from '@shared/ipc/schema/artifacts';
import { artifactUrl } from '@shared/artifacts/scheme';
import {
  appOriginOf,
  artifactConsoleMessageOf,
  attributeConsole,
  guardFrames,
  guardWindowNavigation,
  installFramePolicies,
  isCspExempt,
  beneathStoreFrame,
  consoleLimiter,
  CONSOLE_BURST,
  CONSOLE_WINDOW_MS,
  guardPermissions,
  isStoreFramePermission,
  restrictRequests,
  shownArtifact,
  shouldBlockFrameNavigation,
  type FrameLike,
  shouldCancelDownload,
  shouldCancelForOwner,
  shouldCancelRequest,
  writeSeam,
} from './policies';
import { endableClientRef } from '@shared/ipc/client';
import { createFrameTokens, type FrameFixed } from '../main/file-frames/tokens';

const ID = '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
// P3-L M6b: E2's store frame was the first store frame these policies guarded; an artifact's page at a revision is
// the one they guard now
const FRAME = artifactUrl(ID, 2, 'index.html');
const LEGACY = `maws-deliverable://${ID}/App-A/2`; // E2's scheme, no store frame of this build
const APP = 'file:///Applications/MAWS.app/Contents/Resources/app/out/renderer/index.html';
const ARTIFACT = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const PAGE = artifactUrl(ARTIFACT, 'live', 'index.html'); // P3-A M7: the artifact store's frame

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

describe('a frame’s ancestry (Decision Log 31): a store frame and every frame beneath it', () => {
  it('finds a store frame itself, its children and grandchildren, and nothing in the app beside them', () => {
    expect(beneathStoreFrame(chain(APP, FRAME))).toBe(true);
    expect(beneathStoreFrame(chain(APP, FRAME, VIEWER))).toBe(true); // Chromium's PDF viewer inside a PDF frame
    expect(beneathStoreFrame(chain(APP, FRAME, VIEWER, 'about:blank'))).toBe(true);
    expect(beneathStoreFrame(chain(APP))).toBe(false);
    expect(beneathStoreFrame(chain(APP, 'about:srcdoc'))).toBe(false); // the request card's own frame
    expect(beneathStoreFrame(null)).toBe(false);
    expect(beneathStoreFrame(chain(APP, LEGACY))).toBe(false); // P3-L M6b: E2's scheme is no store frame
    expect(isCspExempt(LEGACY)).toBe(false);
  });

  it('answers null when a frame can no longer be read', () => {
    expect(beneathStoreFrame(disposed)).toBeNull();
    expect(beneathStoreFrame({ url: 'about:blank', parent: disposed })).toBeNull();
  });
});

describe('the request filter’s decision (E2 Design §3): beneath a store frame, nothing outside Electron', () => {
  it('cancels a request from a store frame, or from beneath one, for anything outside the scheme and the viewer', () => {
    for (const url of ['https://example.com/x.png', 'http://127.0.0.1:8641/', 'wss://example.com/', 'file:///etc/hosts', 'chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh/x.js', 'chrome://settings/']) {
      expect(shouldCancelRequest({ url, beneath: true }), url).toBe(true);
    }
    expect(shouldCancelRequest({ url: 'https://example.com/', beneath: beneathStoreFrame(chain(APP, FRAME, VIEWER)) })).toBe(true); // a PDF link the viewer follows
  });

  it('passes the scheme, the PDF viewer’s files (the PDF trial) and chrome://resources/ beneath one', () => {
    for (const url of [artifactUrl(ID, 1, 'index.html'), 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/pdf_embedder.css', 'chrome://resources/js/assert.js']) {
      expect(shouldCancelRequest({ url, beneath: true }), url).toBe(false);
    }
  });

  it('passes the app’s own requests, and a request the browser itself started', () => {
    expect(shouldCancelRequest({ url: 'https://example.com/', beneath: false })).toBe(false);
    expect(shouldCancelRequest({ url: 'https://example.com/', beneath: null })).toBe(false);
  });

  it('judges by the initiator too, which an opaque frame reports as "null" and an unsandboxed one as the scheme', () => {
    expect(shouldCancelRequest({ url: 'https://example.com/', beneath: null, initiatorOrigin: `maws-artifact://${ID}` })).toBe(true);
    expect(shouldCancelRequest({ url: 'https://example.com/', beneath: false, initiatorOrigin: 'null' })).toBe(false);
  });
});

describe('the frame-navigation decision', () => {
  const decide = (url: string, frame: FrameLike | null, initiator: FrameLike | null) => shouldBlockFrameNavigation({ url, frameBeneath: beneathStoreFrame(frame), initiatorBeneath: beneathStoreFrame(initiator) });

  it('prevents a navigation of, or asked by, a frame at or beneath a store frame to anything outside the three', () => {
    expect(decide('https://example.invalid/', chain(APP, FRAME), chain(APP, FRAME))).toBe(true); // a link in the page
    expect(decide('https://example.invalid/', chain(APP, FRAME), null)).toBe(true);
    expect(decide('about:blank', chain(APP, FRAME, 'about:blank'), chain(APP, FRAME))).toBe(true); // a frame inside it
    expect(decide('https://example.invalid/', chain(APP, FRAME, VIEWER), chain(APP, FRAME, VIEWER))).toBe(true); // a PDF link in the viewer
    expect(decide('https://example.invalid/', chain(APP, FRAME), chain(APP))).toBe(true); // the app never points it elsewhere
    expect(decide('https://example.invalid/', disposed, null)).toBe(true); // unreadable counts as beneath
  });

  it('lets a version switch, the frame’s first load and the viewer’s own frames through, and leaves the app’s frames alone', () => {
    expect(decide(artifactUrl(ID, 1, 'index.html'), chain(APP, FRAME), chain(APP))).toBe(false);
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
  it('names a store frame by any origin Electron reports, and nothing else', () => {
    expect(isStoreFramePermission([`maws-artifact://${ID}`])).toBe(true);
    expect(isStoreFramePermission([undefined, FRAME])).toBe(true);
    expect(isStoreFramePermission([APP, 'file:///'])).toBe(false);
    expect(isStoreFramePermission([VIEWER])).toBe(false); // the viewer's own needs keep the default
    expect(isStoreFramePermission([])).toBe(false);
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

// P3-A M7 (Decision Log 35e): the artifact store's frames, with what an artifact frame may reach of the others
describe('the policies over a maws-artifact: frame', () => {
  it('judges a maws-artifact: frame and what lies beneath it as a store frame, and lets it reach either scheme', () => {
    expect(beneathStoreFrame(chain(APP, PAGE, 'about:blank'))).toBe(true);
    expect(shouldCancelRequest({ url: 'https://example.com/x.png', beneath: beneathStoreFrame(chain(APP, PAGE)) })).toBe(true);
    expect(shouldCancelRequest({ url: 'https://example.com/', beneath: null, initiatorOrigin: `maws-artifact://${ARTIFACT}` })).toBe(true);
    expect(shouldCancelRequest({ url: artifactUrl(ARTIFACT, 3, 'assets/a.png'), beneath: true })).toBe(false);
    expect(shouldBlockFrameNavigation({ url: 'https://example.invalid/', frameBeneath: beneathStoreFrame(chain(APP, PAGE)), initiatorBeneath: null })).toBe(true);
    expect(shouldBlockFrameNavigation({ url: artifactUrl(ARTIFACT, 3, 'index.html'), frameBeneath: beneathStoreFrame(chain(APP, PAGE)), initiatorBeneath: null })).toBe(false); // a revision switch
    expect(shouldCancelDownload({ url: PAGE, urlChain: [PAGE] })).toBe(true);
    expect(isStoreFramePermission([`maws-artifact://${ARTIFACT}`])).toBe(true);
    expect(isCspExempt(PAGE)).toBe(true); // its answers carry their own policy
  });

  // fix wave 1 (Decision Log 44a): an artifact frame reaches its own artifact only; the app reaches every one
  it('refuses a request from an artifact frame, or beneath one, for another artifact by its UUID, and lets the app’s own through', () => {
    const OTHER = '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f';
    const fromFrame = (url: string, frame: FrameLike | null, initiatorOrigin = 'null') => shouldCancelRequest({ url, beneath: beneathStoreFrame(frame), shown: shownArtifact(frame), initiatorOrigin, appOrigin: 'file://' });
    expect(fromFrame(artifactUrl(OTHER, 'live', 'index.html'), chain(APP, PAGE))).toBe(true); // a sandboxed page's request
    expect(fromFrame(artifactUrl(OTHER, 'live', 'assets/a.png'), chain(APP, PAGE, 'about:blank'))).toBe(true); // a frame beneath it
    expect(fromFrame(artifactUrl(OTHER, 3, 'index.html'), chain(APP, PAGE), `maws-artifact://${ARTIFACT}`)).toBe(true); // an unsandboxed one's
    expect(fromFrame(artifactUrl(OTHER, 'live', 'index.html'), chain(APP, FRAME))).toBe(true); // another artifact's frame
    expect(fromFrame(artifactUrl(ARTIFACT, 3, 'assets/a.png'), chain(APP, PAGE))).toBe(false); // its own artifact, any revision
    expect(fromFrame(artifactUrl(OTHER, 'live', 'index.html'), chain(APP, PAGE), 'file://')).toBe(false); // the app points its frame elsewhere
    expect(fromFrame(artifactUrl(OTHER, 'live', 'assets/a.png'), chain(APP), 'file://')).toBe(false); // the app page's own image
    expect(shouldCancelRequest({ url: artifactUrl(OTHER, 'live', 'a.png'), beneath: null, shown: undefined, initiatorOrigin: 'null', appOrigin: 'file://' })).toBe(false); // unreadable: the page's CSP holds
  });

  // fix wave 2 (the re-review's finding 4): only the app's renderer is the app, not any origin that is not opaque
  it('trusts the app’s renderer origin alone: the file-loaded page or the dev server, never another origin beneath an artifact frame', () => {
    const OTHER = '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f';
    const cross = (initiatorOrigin: string, appOrigin: string) =>
      shouldCancelRequest({ url: artifactUrl(OTHER, 'live', 'index.html'), beneath: true, shown: ARTIFACT, initiatorOrigin, appOrigin });
    expect(cross('file://', 'file://')).toBe(false);
    expect(cross('http://localhost:5173', 'http://localhost:5173')).toBe(false);
    expect(cross('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai', 'file://')).toBe(true); // the PDF viewer beneath an artifact frame
    expect(cross('https://example.com', 'file://')).toBe(true);
    expect(cross('http://localhost:5173', 'file://')).toBe(true); // a dev server origin is the app's only in development
    expect(appOriginOf('file:///Applications/MAWS.app/Contents/Resources/app/out/renderer/index.html')).toBe('file://');
    expect(appOriginOf('http://localhost:5173/')).toBe('http://localhost:5173');
    expect(appOriginOf('http://localhost:5173/harness.html')).toBe('http://localhost:5173');
  });

  it('prevents an artifact frame’s navigation to another artifact, and lets the app navigate it anywhere', () => {
    const OTHER = '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f';
    const decide = (url: string, frame: FrameLike, initiator: FrameLike | null) =>
      shouldBlockFrameNavigation({ url, frameBeneath: beneathStoreFrame(frame), initiatorBeneath: beneathStoreFrame(initiator), initiatorShows: shownArtifact(initiator) });
    expect(decide(artifactUrl(OTHER, 'live', 'index.html'), chain(APP, PAGE), chain(APP, PAGE))).toBe(true); // its own link
    expect(decide(artifactUrl(ARTIFACT, 2, 'index.html'), chain(APP, PAGE), chain(APP, PAGE))).toBe(false); // a revision of its own
    expect(decide(artifactUrl(OTHER, 'live', 'index.html'), chain(APP, PAGE), chain(APP))).toBe(false); // the app's switch
  });

  it('reads the artifact a frame shows from the nearest store frame at or above it', () => {
    expect(shownArtifact(chain(APP, PAGE, 'about:blank'))).toBe(ARTIFACT);
    expect(shownArtifact(chain(APP, FRAME))).toBe(ID);
    expect(shownArtifact(chain(APP, LEGACY))).toBeUndefined(); // P3-L M6b: E2's scheme is no store frame
    expect(shownArtifact(chain(APP, 'about:srcdoc'))).toBeUndefined(); // the app's own
    expect(shownArtifact(null)).toBeUndefined();
    expect(() => shownArtifact(disposed)).toThrow();
  });

  it('reads an artifact frame’s error and warning as artifacts.console, live or at a revision, cut to the schema’s bound', () => {
    const at = { frame: { url: `${PAGE}#top` }, lineNumber: 4, sourceId: PAGE };
    expect(artifactConsoleMessageOf({ ...at, level: 'error', message: 'boom' })).toEqual({ artifactId: ARTIFACT, revision: null, level: 'error', message: 'boom', line: 4, source: PAGE });
    expect(artifactConsoleMessageOf({ ...at, frame: { url: artifactUrl(ARTIFACT, 12, 'index.html') }, level: 'warning', message: 'w' })).toMatchObject({ revision: 12, level: 'warning' });
    expect(artifactConsoleMessageOf({ ...at, level: 'info', message: 'i' })).toBeNull();
    expect(artifactConsoleMessageOf({ ...at, frame: { url: LEGACY }, level: 'error', message: 'E2’s' })).toBeNull();
    expect(ArtifactConsoleSchema.safeParse(artifactConsoleMessageOf({ ...at, level: 'error', message: 'x'.repeat(5000) })).success).toBe(true);
  });

  it('emits artifacts.console from the window’s webContents, bounded per artifact revision, each counted apart', () => {
    const contents = new EventEmitter();
    const emit = vi.fn();
    attributeConsole(contents as unknown as WebContents, emit, () => 0);
    for (let k = 0; k < CONSOLE_BURST + 5; k++) contents.emit('console-message', { frame: { url: PAGE }, level: 'error', message: `m${k}`, lineNumber: 1, sourceId: PAGE });
    contents.emit('console-message', { frame: { url: FRAME }, level: 'error', message: 'another', lineNumber: 1, sourceId: FRAME });
    contents.emit('console-message', { frame: { url: LEGACY }, level: 'error', message: 'E2’s', lineNumber: 1, sourceId: LEGACY });
    expect(emit.mock.calls.filter(([name]) => name === 'artifacts.console')).toHaveLength(CONSOLE_BURST + 1);
    expect(emit).toHaveBeenCalledWith('artifacts.console', expect.objectContaining({ artifactId: ARTIFACT, message: 'm0' }));
    expect(emit).toHaveBeenCalledWith('artifacts.console', expect.objectContaining({ artifactId: ID, revision: 2, message: 'another' }));
  });
});

describe('console attribution', () => {
  it('reads an artifact frame’s error and warning, and nothing else', () => {
    const at = { frame: { url: `${FRAME}#section` }, lineNumber: 7, sourceId: FRAME };
    expect(artifactConsoleMessageOf({ ...at, level: 'error', message: 'Uncaught Error: E2_BOOM' })).toEqual({ artifactId: ID, revision: 2, level: 'error', message: 'Uncaught Error: E2_BOOM', line: 7, source: FRAME });
    expect(artifactConsoleMessageOf({ ...at, level: 'warning', message: 'w', sourceId: '' })).toMatchObject({ level: 'warning', source: null });
    expect(artifactConsoleMessageOf({ ...at, level: 'info', message: 'i' })).toBeNull();
    expect(artifactConsoleMessageOf({ ...at, frame: { url: APP }, level: 'error', message: 'app' })).toBeNull();
    expect(artifactConsoleMessageOf({ ...at, frame: null, level: 'error', message: 'gone' })).toBeNull();
  });

  it('cuts a message and a source at 2,000 characters, which the event’s schema bounds too', () => {
    const message = artifactConsoleMessageOf({ frame: { url: FRAME }, level: 'error', message: 'x'.repeat(5000), lineNumber: 1, sourceId: FRAME })!;
    expect(message.message).toHaveLength(2000);
    expect(ArtifactConsoleSchema.safeParse(message).success).toBe(true);
    expect(ArtifactConsoleSchema.safeParse({ ...message, message: 'x'.repeat(2001) }).success).toBe(false);
    const longSource = `${FRAME}?${'q'.repeat(5000)}`;
    const sourced = artifactConsoleMessageOf({ frame: { url: FRAME }, level: 'error', message: 'boom', lineNumber: 1, sourceId: longSource })!;
    expect(sourced.source).toHaveLength(2000);
    expect(longSource.startsWith(sourced.source!)).toBe(true);
    expect(ArtifactConsoleSchema.safeParse({ ...sourced, source: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('admits at most CONSOLE_BURST messages per artifact revision in a window, each revision counted apart', () => {
    let now = 0;
    const admit = consoleLimiter(() => now);
    const r2 = artifactConsoleMessageOf({ frame: { url: FRAME }, level: 'error', message: 'loop', lineNumber: 1, sourceId: FRAME })!;
    const r1 = { ...r2, revision: 1 };
    const admitted = Array.from({ length: CONSOLE_BURST + 10 }, () => admit(r2)).filter(Boolean);
    expect(admitted).toHaveLength(CONSOLE_BURST);
    expect(admit(r1)).toBe(true); // another revision has its own budget
    now += CONSOLE_WINDOW_MS - 1;
    expect(admit(r2)).toBe(false);
    now += 1;
    expect(admit(r2)).toBe(true); // a new window
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

  it('cancels a store frame’s request on the real listener, over every URL', () => {
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

  // fix wave 1 (Decision Log 44b): a window with a filter of its own (the export's PDF printer) is judged by it alone
  it('asks a webContents’ own filter first, and the frame policies for every other webContents', () => {
    const session = new FakeSession();
    installFramePolicies(session as unknown as Session, {});
    const answers: boolean[] = [];
    const remove = restrictRequests(41, (url) => !url.startsWith('data:'));
    session.beforeRequest!({ url: 'https://example.com/a.png', webContentsId: 41, frame: chain(APP) }, ({ cancel }) => answers.push(cancel)); // the app would let it through
    session.beforeRequest!({ url: 'data:image/png;base64,AA==', webContentsId: 41, frame: chain(APP) }, ({ cancel }) => answers.push(cancel));
    session.beforeRequest!({ url: 'https://example.com/a.png', webContentsId: 7, frame: chain(APP) }, ({ cancel }) => answers.push(cancel));
    remove();
    session.beforeRequest!({ url: 'https://example.com/a.png', webContentsId: 41, frame: chain(APP) }, ({ cancel }) => answers.push(cancel));
    expect(answers).toEqual([true, false, false, false]);
  });

  it('cancels a store frame’s download and writes the seam line under MAWS_E2E', async () => {
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
    await vi.waitFor(async () => expect(await logLines()).toEqual([`blocked-download ${FRAME}`, 'blocked-download blob:chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/5b1e']));
  });

  it('writes no seam line outside the e2e', async () => {
    const session = new FakeSession();
    installFramePolicies(session as unknown as Session, { MAWS_E2E_OPEN_LOG: log });
    session.emit('will-download', { preventDefault: vi.fn() }, item(FRAME), null);
    await settle();
    expect(await logLines()).toEqual([]);
  });

  it('prevents a store frame’s navigation, writes the seam line, and turns off non-proxied UDP for WebRTC', async () => {
    const contents = Object.assign(new EventEmitter(), { setWebRTCIPHandlingPolicy: vi.fn() });
    guardFrames(contents as unknown as WebContents, e2e());
    expect(contents.setWebRTCIPHandlingPolicy).toHaveBeenCalledWith('disable_non_proxied_udp');
    const blocked = { url: 'https://example.invalid/', isMainFrame: false, frame: chain(APP, FRAME), initiator: chain(APP, FRAME), preventDefault: vi.fn() };
    const fromViewer = { url: 'https://example.invalid/pdf-link', isMainFrame: false, frame: chain(APP, FRAME, VIEWER), initiator: chain(APP, FRAME, VIEWER), preventDefault: vi.fn() };
    const allowed = { url: artifactUrl(ID, 1, 'index.html'), isMainFrame: false, frame: chain(APP, FRAME), initiator: chain(APP), preventDefault: vi.fn() };
    const app = { url: 'about:srcdoc', isMainFrame: false, frame: chain(APP, 'about:blank'), initiator: chain(APP), preventDefault: vi.fn() };
    for (const event of [blocked, fromViewer, allowed, app]) contents.emit('will-frame-navigate', event);
    await settle();
    expect(blocked.preventDefault).toHaveBeenCalled();
    expect(fromViewer.preventDefault).toHaveBeenCalled();
    expect(allowed.preventDefault).not.toHaveBeenCalled();
    expect(app.preventDefault).not.toHaveBeenCalled();
    await vi.waitFor(async () => expect(await logLines()).toEqual(['blocked-navigation https://example.invalid/', 'blocked-navigation https://example.invalid/pdf-link']));
  });

  // P4 W2-C (tracker 2026-10-06, E2): the window's own guard writes the line the frame guard writes, so the e2e sees a
  // PDF's link refused at the top level (Chromium's viewer navigates the window itself) as it sees a frame's
  it('refuses every navigation of the app window itself and writes the seam line under MAWS_E2E', async () => {
    const contents = new EventEmitter();
    guardWindowNavigation(contents as unknown as WebContents, e2e());
    const link = { url: 'https://example.invalid/pdf-link', isMainFrame: true, preventDefault: vi.fn() };
    const app = { url: APP, isMainFrame: true, preventDefault: vi.fn() };
    for (const event of [link, app]) contents.emit('will-navigate', event);
    await settle();
    expect(link.preventDefault).toHaveBeenCalled();
    expect(app.preventDefault).toHaveBeenCalled();
    await vi.waitFor(async () => expect(await logLines()).toEqual(['blocked-navigation https://example.invalid/pdf-link', `blocked-navigation ${APP}`]));
  });

  // P4 W2-C (tracker 2026-09-28, C6): in development a page's own `location.reload()` reaches `will-navigate` (a renderer
  // navigation to its own URL), and the transcript store's hot update reloads that way
  it('lets the dev server’s page reload itself, and refuses every other navigation there', async () => {
    const DEV = 'http://localhost:5173/harness.html';
    const contents = Object.assign(new EventEmitter(), { getURL: () => DEV });
    guardWindowNavigation(contents as unknown as WebContents, e2e(), { reloads: true });
    const reload = { url: DEV, isMainFrame: true, preventDefault: vi.fn() };
    const away = { url: 'http://localhost:5173/index.html', isMainFrame: true, preventDefault: vi.fn() };
    for (const event of [reload, away]) contents.emit('will-navigate', event);
    const built = Object.assign(new EventEmitter(), { getURL: () => APP });
    guardWindowNavigation(built as unknown as WebContents, e2e());
    const rebuilt = { url: APP, isMainFrame: true, preventDefault: vi.fn() };
    built.emit('will-navigate', rebuilt);
    await settle();
    expect(reload.preventDefault).not.toHaveBeenCalled();
    expect(away.preventDefault).toHaveBeenCalled();
    expect(rebuilt.preventDefault).toHaveBeenCalled(); // a built app's page never reloads itself this way
    await vi.waitFor(async () => expect(await logLines()).toEqual(['blocked-navigation http://localhost:5173/index.html', `blocked-navigation ${APP}`]));
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
    expect(session.check!(null, 'deprecated-sync-clipboard-read', 'file:///', { isMainFrame: true })).toBe(false);
  });

  it('denies a store frame’s permissions on the app’s session and keeps the default for the app and the PDF viewer', () => {
    const session = new PermissionSession();
    guardPermissions(session as unknown as Session, 'store-frames');
    expect(session.asked('media', { requestingUrl: FRAME })).toBe(false);
    expect(session.asked('geolocation', { requestingUrl: 'about:blank', securityOrigin: `maws-artifact://${ID}` })).toBe(false);
    expect(session.check!(null, 'clipboard-read', `maws-artifact://${ID}`, { isMainFrame: false })).toBe(false);
    expect(session.check!(null, 'clipboard-read', 'chrome-extension://x', { isMainFrame: false, requestingUrl: FRAME })).toBe(false);
    expect(session.asked('clipboard-sanitized-write', { requestingUrl: APP })).toBe(true);
    expect(session.asked('clipboard-sanitized-write', { requestingUrl: VIEWER })).toBe(true);
    expect(session.check!(null, 'clipboard-sanitized-write', 'file:///', { isMainFrame: true, requestingUrl: APP })).toBe(true);
  });

  // An installed check handler replaces Electron's built-in answer, which (Electron 32+) denies this one to every origin.
  it('denies deprecated-sync-clipboard-read to every origin on both sessions, as Electron does without a handler', () => {
    for (const scope of ['all', 'store-frames'] as const) {
      const session = new PermissionSession();
      guardPermissions(session as unknown as Session, scope);
      for (const [origin, requestingUrl] of [['file:///', APP], ['chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai', VIEWER], [`maws-artifact://${ID}`, FRAME]]) {
        expect(session.check!(null, 'deprecated-sync-clipboard-read', origin!, { isMainFrame: false, requestingUrl })).toBe(false);
      }
    }
  });
});

// UX wave U6b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, "Main's decisions, each with a token
// host"; R1, A1): a file frame's URL, `maws-artifact://<32 hex>/<the file's name>`, is a store frame's to every existing
// predicate, which none of them is edited to be; and the one new question, which web contents asks, is the request
// listener's first. Every token and name here is invented.
describe('a file frame’s token host', () => {
  const TOKEN = '3f9c2b7e4d1a8c6f0e5b9a2d7c4f1e8b';
  const OTHER_TOKEN = 'c0ffee11d00d4e5fa6b7c8d9e0f1a2b3';
  const FILE = `maws-artifact://${TOKEN}/ledger draft.pdf`;
  const OTHER_FILE = `maws-artifact://${OTHER_TOKEN}/notes.html`;

  /** A live token of web contents `contentsId`, issued in a real table; the table and the token. */
  function held(contentsId: number) {
    const tokens = createFrameTokens();
    const fixed: FrameFixed = { name: 'ledger draft.pdf', framed: 'pdf', mime: 'application/pdf', csp: null, source: { read: async () => ({ bytes: new Uint8Array(), size: 0, identity: 'one' }), close: async () => {} } };
    const owner = endableClientRef(`page:${contentsId}.1`);
    const issued = tokens.issue(owner, contentsId, fixed);
    if (typeof issued === 'string') throw new Error(`not issued: ${issued}`);
    return { tokens, owner, url: `maws-artifact://${issued.token}/ledger%20draft.pdf`, token: issued.token };
  }

  it('finds a token’s frame and the viewer beneath it, and nothing in the app beside them', () => {
    expect(beneathStoreFrame(chain(APP, FILE))).toBe(true);
    expect(beneathStoreFrame(chain(APP, FILE, VIEWER))).toBe(true);
    expect(beneathStoreFrame(chain(APP, FILE, VIEWER, 'about:blank'))).toBe(true);
    expect(beneathStoreFrame(chain(APP))).toBe(false);
    expect(beneathStoreFrame(chain(APP, 'about:srcdoc'))).toBe(false);
  });

  it('cancels a request from a token’s frame, or from beneath it, for anything outside the scheme and the viewer', () => {
    const from = (url: string, frame: FrameLike, initiatorOrigin = 'null') => shouldCancelRequest({ url, beneath: beneathStoreFrame(frame), shown: shownArtifact(frame), initiatorOrigin, appOrigin: 'file://' });
    for (const url of ['http://127.0.0.1:8641/', 'https://example.com/x.png', 'ws://example.com/', 'wss://example.com/', 'file:///etc/hosts']) {
      expect(from(url, chain(APP, FILE)), url).toBe(true);
      expect(from(url, chain(APP, FILE, VIEWER)), `${url} beneath`).toBe(true);
    }
    expect(shouldCancelRequest({ url: 'https://example.com/', beneath: null, initiatorOrigin: `maws-artifact://${TOKEN}` })).toBe(true); // an unsandboxed frame's initiator
    expect(from(FILE, chain(APP, FILE))).toBe(false); // its own host
    expect(from('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/pdf_embedder.css', chain(APP, FILE))).toBe(false);
    expect(from('chrome://resources/js/assert.js', chain(APP, FILE, VIEWER))).toBe(false);
  });

  it('refuses a token’s frame an artifact, an artifact’s frame a token, and one token’s frame another’s', () => {
    const from = (url: string, frame: FrameLike, initiatorOrigin = 'null') => shouldCancelRequest({ url, beneath: beneathStoreFrame(frame), shown: shownArtifact(frame), initiatorOrigin, appOrigin: 'file://' });
    expect(from(PAGE, chain(APP, FILE))).toBe(true);
    expect(from(artifactUrl(ARTIFACT, 3, 'assets/a.png'), chain(APP, FILE, VIEWER))).toBe(true);
    expect(from(FILE, chain(APP, PAGE))).toBe(true);
    expect(from(OTHER_FILE, chain(APP, FILE))).toBe(true);
    expect(from(FILE, chain(APP, OTHER_FILE), `maws-artifact://${OTHER_TOKEN}`)).toBe(true);
    expect(from(FILE, chain(APP), 'file://')).toBe(false); // the app's own origin points its frame there
    expect(from(FILE, chain(APP, PAGE), 'file://')).toBe(false);
  });

  it('cancels a token asked by another web contents, by none, and after its release; passes its owner’s; leaves an artifact’s id alone', () => {
    const { tokens, owner, url, token } = held(7);
    const ask = (asked: string, webContentsId: number | undefined) => shouldCancelForOwner({ url: asked, webContentsId, ownerOf: tokens.ownerOf });
    expect(ask(url, 7)).toBe(false);
    expect(ask(`${url}#toolbar=0`, 7)).toBe(false);
    expect(ask(url, 8)).toBe(true);
    expect(ask(url, undefined)).toBe(true); // a request the browser itself started
    expect(ask(FILE, 7)).toBe(true); // a token of the shape that nobody holds
    expect(ask(PAGE, 8)).toBe(false); // an artifact's id is not this question's
    expect(ask(PAGE, undefined)).toBe(false);
    expect(ask('https://example.com/', 8)).toBe(false);
    expect(tokens.release(token, owner)).toBe(true);
    expect(ask(url, 7)).toBe(true);
  });

  it('prevents a token’s frame from navigating anywhere but its own host', () => {
    const decide = (url: string, frame: FrameLike, initiator: FrameLike | null) =>
      shouldBlockFrameNavigation({ url, frameBeneath: beneathStoreFrame(frame), initiatorBeneath: beneathStoreFrame(initiator), initiatorShows: shownArtifact(initiator) });
    for (const url of ['https://example.invalid/', 'data:text/html,<p>x</p>', 'blob:null/5b1e', 'about:blank', PAGE, OTHER_FILE]) {
      expect(decide(url, chain(APP, FILE), chain(APP, FILE)), url).toBe(true);
    }
    expect(decide('about:blank', chain(APP, FILE, 'about:blank'), chain(APP, FILE))).toBe(true); // a frame inside it
    expect(decide('https://example.invalid/', chain(APP, FILE, VIEWER), chain(APP, FILE, VIEWER))).toBe(true); // a PDF's link in the viewer
    expect(decide(FILE, chain(APP, 'about:blank'), chain(APP))).toBe(false); // its first load, by the app
    expect(decide(`maws-artifact://${TOKEN}/other.pdf`, chain(APP, FILE), chain(APP, FILE))).toBe(false); // its own host: the responder answers any other path 404
  });

  it('cancels a download of a token’s URL and of the viewer’s save from it', () => {
    expect(shouldCancelDownload({ url: FILE, urlChain: [FILE] })).toBe(true);
    expect(shouldCancelDownload({ url: 'https://cdn.example/x', urlChain: [FILE, 'https://cdn.example/x'] })).toBe(true);
    expect(shouldCancelDownload({ url: 'blob:chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/9c1d', urlChain: ['blob:chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/9c1d'] })).toBe(true);
  });

  it('names a token’s frame by any origin Electron reports', () => {
    expect(isStoreFramePermission([`maws-artifact://${TOKEN}`])).toBe(true);
    expect(isStoreFramePermission([undefined, FILE])).toBe(true);
    expect(isStoreFramePermission([null, 'about:blank', OTHER_FILE])).toBe(true);
  });

  it('exempts a token’s answer', () => {
    expect(isCspExempt(FILE)).toBe(true);
    expect(isCspExempt(OTHER_FILE)).toBe(true);
  });

  it('reads no artifact from a token frame’s message', () => {
    expect(artifactConsoleMessageOf({ frame: { url: OTHER_FILE }, level: 'error', message: 'from a file', lineNumber: 1, sourceId: OTHER_FILE })).toBeNull();
    expect(artifactConsoleMessageOf({ frame: { url: FILE }, level: 'warning', message: 'from a file', lineNumber: 1, sourceId: FILE })).toBeNull();
  });

  describe('on the real listener', () => {
    class FakeSession extends EventEmitter {
      beforeRequest: ((details: unknown, callback: (response: { cancel: boolean }) => void) => void) | null = null;
      webRequest = {
        onBeforeRequest: (_filter: unknown, listener: FakeSession['beforeRequest']) => {
          this.beforeRequest = listener;
        },
      };
      asked(details: Record<string, unknown>): boolean {
        let cancel: boolean | null = null;
        this.beforeRequest!({ method: 'GET', ...details }, (answer) => (cancel = answer.cancel));
        return cancel!;
      }
    }

    it('a web contents with its own filter that asks for a token it does not own is cancelled before its filter is asked, on the real listener', () => {
      const { tokens, url } = held(7);
      const session = new FakeSession();
      installFramePolicies(session as unknown as Session, {}, 'file://', tokens.ownerOf);
      const printer = vi.fn(() => false); // its own filter cancels nothing
      const owners = vi.fn(() => false);
      const removePrinter = restrictRequests(41, printer);
      const removeOwners = restrictRequests(7, owners);
      try {
        expect(session.asked({ url, webContentsId: 41, frame: chain(APP) })).toBe(true);
        expect(printer).not.toHaveBeenCalled();
        expect(session.asked({ url: 'data:image/png;base64,AA==', webContentsId: 41, frame: chain(APP) })).toBe(false);
        expect(printer).toHaveBeenCalledTimes(1); // every other request of its own is its filter's, as before
        expect(session.asked({ url, webContentsId: 7, frame: chain(APP) })).toBe(false); // the owner's passes the check, then its own filter is asked
        expect(owners).toHaveBeenCalledWith(url);
      } finally {
        removePrinter();
        removeOwners();
      }
      expect(session.asked({ url, webContentsId: 9, frame: chain(APP) })).toBe(true); // a window with no filter of its own
      expect(session.asked({ url, frame: null })).toBe(true); // no web contents at all
      expect(session.asked({ url: PAGE, webContentsId: 9, frame: chain(APP), initiatorOrigin: 'file://' })).toBe(false); // an artifact as before
    });

    it('writes a frame-decision line for a token host under MAWS_E2E, and none outside it', async () => {
      const { tokens, url } = held(7);
      const session = new FakeSession();
      installFramePolicies(session as unknown as Session, e2e(), 'file://', tokens.ownerOf);
      session.asked({ url, webContentsId: 7, frame: chain(APP) });
      session.asked({ url, method: 'HEAD', webContentsId: 9, frame: chain(APP) });
      session.asked({ url, frame: null });
      session.asked({ url: FILE, webContentsId: 7, frame: chain(APP) }); // a token nobody holds
      session.asked({ url: PAGE, webContentsId: 7, frame: chain(APP), initiatorOrigin: 'file://' }); // an artifact: no line
      session.asked({ url: 'https://example.com/', webContentsId: 7, frame: chain(APP) }); // no line
      writeSeam(e2e(), `frame-entry GET - ${url}`); // the responder's line, through the same ordered writer
      await vi.waitFor(async () => expect(await logLines()).toEqual([`frame-decision pass 7 GET ${url}`, `frame-decision cancel 9 HEAD ${url}`, `frame-decision cancel none GET ${url}`, `frame-decision cancel 7 GET ${FILE}`, `frame-entry GET - ${url}`]));

      const quiet = new FakeSession();
      installFramePolicies(quiet as unknown as Session, { MAWS_E2E_OPEN_LOG: log }, 'file://', tokens.ownerOf);
      quiet.asked({ url, webContentsId: 9, frame: chain(APP) });
      writeSeam({ MAWS_E2E_OPEN_LOG: log }, `frame-entry GET - ${url}`);
      await settle();
      expect(await logLines()).toHaveLength(5);
    });
  });
});
