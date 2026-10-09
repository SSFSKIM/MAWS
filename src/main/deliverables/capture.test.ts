import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import type { MawsArtifactCapture } from '@shared/ipc/schema/maws';
import type { DeliverableRecord } from '@shared/maws/deliverable';
import { ARTIFACT_SCREENSHOT_MAX_BYTES } from '@shared/maws/tools';

// A fake Electron: a BrowserWindow whose construction announces itself as Electron's does (`browser-window-created`,
// before the constructor returns), and whose page "loads" by a script each test sets.
const electron = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter: Emitter } = require('node:events') as typeof import('node:events');
  const app = new Emitter();
  type Image = { toPNG(): Buffer; getSize(): { width: number; height: number }; resize(o: { width: number }): Image };
  const image = (width: number, height: number, bytes: (w: number) => number): Image => ({
    toPNG: () => Buffer.alloc(bytes(width), 1),
    getSize: () => ({ width, height }),
    resize: ({ width: w }) => image(w, Math.round((height * w) / width), bytes),
  });
  const state = {
    windows: [] as FakeWindow[],
    // what a page does once loaded: by default it finishes, paints and is captured at its size in 100 bytes
    load: (win: FakeWindow) => {
      win.webContents.emit('did-finish-load');
      win.webContents.emit('paint');
    },
    bytes: (() => 100) as (width: number) => number,
  };
  class FakeContents extends Emitter {
    url: string | null = null;
    openHandler: unknown = null;
    webrtc: string | null = null;
    constructor(private readonly win: FakeWindow) {
      super();
    }
    setWindowOpenHandler(handler: unknown) {
      this.openHandler = handler;
    }
    setWebRTCIPHandlingPolicy(policy: string) {
      this.webrtc = policy;
    }
    loadURL(url: string) {
      this.url = url;
      this.emit('did-start-loading');
      queueMicrotask(() => state.load(this.win));
      return Promise.resolve();
    }
    capturePage() {
      const { width, height } = this.win.options as { width: number; height: number };
      return Promise.resolve(image(width, height, state.bytes));
    }
  }
  class FakeWindow extends Emitter {
    webContents: FakeContents;
    destroyed = false;
    constructor(readonly options: Record<string, unknown>) {
      super();
      this.webContents = new FakeContents(this);
      state.windows.push(this);
      app.emit('browser-window-created', {}, this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
      this.emit('closed');
    }
  }
  return { app, BrowserWindow: FakeWindow, state, FakeWindow };
});
vi.mock('electron', () => ({ app: electron.app, BrowserWindow: electron.BrowserWindow }));

import { followAppPages } from '../attention';
import { createNavigationRelay } from '../attention/navigation';
import { registerAppWindow } from '../windows';
import { CAPTURE_QUEUE_MS, captureArtifact, startCaptureService } from './capture';

vi.mock('../ipc/router', () => ({ registerMainHandler: vi.fn() }));

const A = 'App-A' as AppSessionId;
const ID = '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
const record = (versions: number): DeliverableRecord => ({
  id: ID, appSessionId: A, kind: 'artifact', artifactId: 'dash', title: 'Dashboard', path: `/u/v${versions}.html`,
  versions: Array.from({ length: versions }, (_, k) => ({ path: `/u/v${k + 1}.html`, at: 't' })), createdAt: 't', updatedAt: 't',
});
const reader = (versions = 2, present = [true, true]) => ({ get: vi.fn(async () => ({ record: record(versions), present })) });
const request = (over: Partial<MawsArtifactCapture> = {}): MawsArtifactCapture => ({ appSessionId: A, requestId: 'req-1' as RequestId, deliverableId: ID, version: 2, width: 640, height: 480, ...over });
type FakeWindow = InstanceType<typeof electron.FakeWindow>;
const lastWindow = () => electron.state.windows.at(-1)!;

beforeEach(() => {
  electron.state.windows = [];
  electron.state.load = (win: FakeWindow) => {
    win.webContents.emit('did-finish-load');
    win.webContents.emit('paint');
  };
  electron.state.bytes = () => 100;
});
afterEach(() => {
  vi.useRealTimers();
  electron.app.removeAllListeners();
});

describe('captureArtifact (E2 Design §7): an offscreen window renders the version and is destroyed', () => {
  it('loads the scheme URL in an offscreen, sandboxed, dialog-less window on the capture partition and answers the PNG', async () => {
    const result = await captureArtifact(request(), { reader: reader(), env: {} });
    expect(result).toEqual({ ok: true, png: Buffer.alloc(100, 1).toString('base64'), width: 640, height: 480, consoleErrors: [] });
    const win = lastWindow();
    expect(win.options).toMatchObject({
      show: false,
      width: 640,
      height: 480,
      webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, partition: 'maws-capture', backgroundThrottling: false, disableDialogs: true },
    });
    expect((win.options.webPreferences as Record<string, unknown>).preload).toBeUndefined();
    expect(win.webContents.url).toBe(`maws-deliverable://${ID}/${A}/2`);
    expect(win.webContents.webrtc).toBe('disable_non_proxied_udp');
    expect((win.webContents.openHandler as () => unknown)()).toEqual({ action: 'deny' });
    expect(win.destroyed).toBe(true);
  });

  it('collects the page’s errors (at most 20, each cut at 500 characters) and nothing of a lower level', async () => {
    electron.state.load = (win) => {
      for (let k = 0; k < 25; k++) win.webContents.emit('console-message', { level: 'error', message: k === 0 ? 'x'.repeat(600) : `error ${k}`, frame: { url: win.webContents.url } });
      win.webContents.emit('console-message', { level: 'warning', message: 'a warning', frame: null });
      win.webContents.emit('did-finish-load');
      win.webContents.emit('paint');
    };
    const result = await captureArtifact(request(), { reader: reader(), env: {} });
    expect(result.ok && result.consoleErrors).toHaveLength(20);
    expect(result.ok && result.consoleErrors[0]).toBe('x'.repeat(500));
    expect(result.ok && result.consoleErrors).not.toContain('a warning');
  });

  // P2-E1 (D10): a side thread's screenshot of its ancestor's artifact
  it("reads an ancestor's record and renders its URL when the request names the owner; the requester's own otherwise", async () => {
    const OWNER = 'App-Parent' as AppSessionId;
    const read = reader();
    expect((await captureArtifact(request({ ownerAppSessionId: OWNER }), { reader: read, env: {} })).ok).toBe(true);
    expect(read.get).toHaveBeenCalledExactlyOnceWith(OWNER, ID);
    expect(lastWindow().webContents.url).toBe(`maws-deliverable://${ID}/${OWNER}/2`);
    read.get.mockClear();
    await captureArtifact(request(), { reader: read, env: {} });
    expect(read.get).toHaveBeenCalledExactlyOnceWith(A, ID);
  });

  it('answers why when the record, the version or its file is gone, and opens no window', async () => {
    const gone = { get: vi.fn(async () => ({ record: null, present: [] })) };
    expect(await captureArtifact(request(), { reader: gone, env: {} })).toEqual({ ok: false, error: `no deliverable ${ID} in this session` });
    expect(await captureArtifact(request({ version: 3 }), { reader: reader(), env: {} })).toEqual({ ok: false, error: 'version 3 does not exist' });
    expect(await captureArtifact(request(), { reader: reader(2, [true, false]), env: {} })).toEqual({ ok: false, error: 'version 2 is not on disk any more' });
    expect(electron.state.windows).toHaveLength(0);
  });

  it('answers the load failure’s code and description, and destroys the window', async () => {
    electron.state.load = (win) => {
      win.webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'about:blank', false); // a subframe's failure is not the page's
      win.webContents.emit('did-fail-load', {}, -2, 'ERR_FAILED', win.webContents.url, true);
    };
    expect(await captureArtifact(request(), { reader: reader(), env: {} })).toEqual({ ok: false, error: 'the page did not load (-2 ERR_FAILED)' });
    expect(lastWindow().destroyed).toBe(true);
  });

  it('gives up after 20 s on a page that never finishes loading, and destroys the window', async () => {
    vi.useFakeTimers();
    electron.state.load = () => {};
    const answer = captureArtifact(request(), { reader: reader(), env: {} });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await answer).toEqual({ ok: false, error: 'the page did not finish loading within 20 s' });
    expect(lastWindow().destroyed).toBe(true);
  });

  it('captures after 500 ms when no paint arrives', async () => {
    vi.useFakeTimers();
    electron.state.load = (win) => win.webContents.emit('did-finish-load');
    const answer = captureArtifact(request(), { reader: reader(), env: {} });
    await vi.advanceTimersByTimeAsync(499);
    expect(lastWindow().destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await answer).ok).toBe(true);
  });

  it('halves a capture past 3.5 MiB once (a 3.75 MiB PNG is past the cap), and refuses one still past it', async () => {
    electron.state.bytes = (width) => (width >= 640 ? 3.75 * 1024 * 1024 : 1000);
    expect(await captureArtifact(request(), { reader: reader(), env: {} })).toMatchObject({ ok: true, width: 320, height: 240 });
    electron.state.bytes = (width) => (width >= 640 ? ARTIFACT_SCREENSHOT_MAX_BYTES + 1 : 1000);
    expect(await captureArtifact(request(), { reader: reader(), env: {} })).toMatchObject({ ok: true, width: 320, height: 240 });
    electron.state.bytes = () => ARTIFACT_SCREENSHOT_MAX_BYTES + 7;
    expect(await captureArtifact(request(), { reader: reader(), env: {} })).toEqual({ ok: false, error: `screenshot too large (${ARTIFACT_SCREENSHOT_MAX_BYTES + 7} bytes); ask for a smaller size` });
  });
});

describe('the capture service: the event in, the host command out, two at a time', () => {
  it('runs two captures at once and holds the third until one finishes, answering each through maws.artifact.captured', async () => {
    const loads: FakeWindow[] = [];
    electron.state.load = (win) => void loads.push(win);
    let listener!: (payload: MawsArtifactCapture) => void;
    const dispatch = vi.fn(async () => ({ ok: true }));
    const stop = startCaptureService({ onEvent: (_name, l) => ((listener = l), () => {}), dispatch, reader: reader(), env: {} });
    for (const id of ['r1', 'r2', 'r3']) listener(request({ requestId: id as RequestId }));
    await vi.waitFor(() => expect(loads).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(electron.state.windows).toHaveLength(2); // the third waits for a slot
    const finish = (win: FakeWindow) => {
      win.webContents.emit('did-finish-load');
      win.webContents.emit('paint');
    };
    finish(loads[0]);
    await vi.waitFor(() => expect(loads).toHaveLength(3));
    finish(loads[1]);
    finish(loads[2]);
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(3));
    expect(dispatch.mock.calls.map((call) => (call as unknown[])[0] as { requestId: string }).map((input) => input.requestId)).toEqual(['r1', 'r2', 'r3']);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ appSessionId: A, requestId: 'r1', result: expect.objectContaining({ ok: true, width: 640, height: 480 }) }));
    stop();
  });

  it("P2-E1: a capture of an ancestor's artifact is answered to the requesting session", async () => {
    let listener!: (payload: MawsArtifactCapture) => void;
    const dispatch = vi.fn(async () => ({ ok: true }));
    const read = reader();
    const stop = startCaptureService({ onEvent: (_name, l) => ((listener = l), () => {}), dispatch, reader: read, env: {} });
    listener(request({ requestId: 'r-owner' as RequestId, ownerAppSessionId: 'App-Parent' as AppSessionId }));
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    expect(read.get).toHaveBeenCalledWith('App-Parent', ID);
    expect(dispatch).toHaveBeenCalledWith({ appSessionId: A, requestId: 'r-owner', result: expect.objectContaining({ ok: true }) });
    stop();
  });
});

describe('the capture queue answers within the host’s deadline', () => {
  it('answers a request still queued after CAPTURE_QUEUE_MS with the busy reason instead of running it late', async () => {
    vi.useFakeTimers();
    electron.state.load = () => {}; // every page hangs, so each capture holds its slot until its 20 s guard
    let listener!: (payload: MawsArtifactCapture) => void;
    const answered: { requestId: string; at: number; result: { ok: boolean; error?: string } }[] = [];
    const dispatch = vi.fn(async (input: { requestId: string; result: { ok: boolean; error?: string } }) => void answered.push({ requestId: input.requestId, at: Date.now(), result: input.result }));
    const start = Date.now();
    const stop = startCaptureService({ onEvent: (_name, l) => ((listener = l), () => {}), dispatch, reader: reader(), env: {} });
    for (const id of ['r1', 'r2', 'r3', 'r4', 'r5']) listener(request({ requestId: id as RequestId }));
    await vi.advanceTimersByTimeAsync(CAPTURE_QUEUE_MS);
    // r1 and r2 hit their guard at 20 s and handed their slots to r3 and r4; r5 waited CAPTURE_QUEUE_MS and is answered
    expect(answered.map((a) => [a.requestId, a.at - start])).toEqual([['r1', 20_000], ['r2', 20_000], ['r5', CAPTURE_QUEUE_MS]]);
    expect(answered[2].result).toEqual({ ok: false, error: `MAWS was busy with other captures for ${CAPTURE_QUEUE_MS / 1000} s; try again` });
    expect(electron.state.windows).toHaveLength(4); // r5 never opened a window
    await vi.advanceTimersByTimeAsync(20_000);
    expect(answered.map((a) => a.requestId)).toEqual(['r1', 'r2', 'r5', 'r3', 'r4']);
    expect(CAPTURE_QUEUE_MS + 20_000).toBeLessThan(45_000); // queued plus guarded stays inside CAPTURE_ANSWER_MS
    stop();
  });
});

describe('a capture window is not an app window (Decision Log 21)', () => {
  it('leaves the attention relay’s pending navigation deliverable, where an app window’s load would not', async () => {
    const emit = vi.fn();
    const relay = createNavigationRelay(emit);
    followAppPages(electron.app as never, relay.pageGone);
    relay.take(); // the app's page announced itself
    await captureArtifact(request(), { reader: reader(), env: {} }); // the capture window loads and closes
    const navigation = { appSessionId: A, kind: 'session' } as never;
    relay.deliver(navigation);
    expect(emit).toHaveBeenCalledWith('attention.navigate', navigation); // delivered to the page, not queued
    const app = new electron.BrowserWindow({});
    registerAppWindow(app as never);
    app.webContents.emit('did-start-loading'); // the app's page reloads
    relay.deliver(navigation);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(relay.take()).toBe(navigation); // queued for the page to pull
    app.destroy();
  });
});
