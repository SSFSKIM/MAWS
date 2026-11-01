// The render host as a tab engine (P5 O17 M4; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M4's Proves), composed
// as root.ts composes it, under a stand-in Electron (electron.fake.ts; the real Electron run is M8's), over real Unix
// sockets with the cua stand's fake host on the other end. The darwin policy throughout, with a stand-in addon that reads
// every peer as `mawsd` (the relay): production's admission, by the daemon this link reaches, confirmed by
// machine.identity on the link. `mawsd`'s side is a recording `call`.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Session } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { ipcError } from '@shared/ipc/errors';
import type { CommandResult } from '@shared/ipc/schema';
import type { BrowserEngineRequest, EngineInventory } from '@shared/ipc/schema/browser-engine';
import { connectFakeHost } from '../../test/support/cua-fake-host';
import type { PeerAddon } from '../main/browser/cua/peer';
import { tabWebPreferences } from '../main/browser/view';
import { FakePage, made, reset, type WebContentsView as FakeView } from './electron.fake';
import type { EngineCall } from './host';
import { HEADLESS_VIEWPORT, HEADLESS_WEBRTC_IP_POLICY, OffscreenViews, offscreenPreferences } from './offscreen-views';
import { HEADLESS_TABS, headlessPartition, startTabEngine, type TabEngine } from './tab-engine';

vi.mock('electron', () => import('./electron.fake'));

const A = 'A' as AppSessionId;
const B = 'B' as AppSessionId;
const S = 'S' as AppSessionId; // a side thread of A
const MAWSD = 4242; // the daemon's pid as the stand-in addon reads every peer

const uid = process.getuid!();
const addon: PeerAddon = { version: 1, peer: () => ({ pid: MAWSD, uid }), process: (pid) => (pid === MAWSD ? { ppid: 1, start: 77 } : null) };

// A deferred answer, so a case decides when mawsd answers
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
beforeEach(() => reset());

// A partition's session as the browser's preparers use it, and as a drop clears it
function fakeSession(cleared: (what: 'storage' | 'cache') => Promise<void>) {
  const handlers = new Map<string, unknown>();
  const record = (name: string) => (handler: unknown) => void handlers.set(name, handler);
  const session = {
    handlers,
    getUserAgent: () => 'Mozilla/5.0 Chrome/140 Electron/39.0.0 maws/1.0.0',
    setUserAgent: record('userAgent'),
    webRequest: { onBeforeRequest: record('onBeforeRequest') },
    setPermissionRequestHandler: record('permissionRequest'),
    setPermissionCheckHandler: record('permissionCheck'),
    setDevicePermissionHandler: record('devicePermission'),
    setDisplayMediaRequestHandler: record('displayMedia'),
    on: (event: string, handler: unknown) => (handlers.set(`on ${event}`, handler), session),
    clearStorageData: () => cleared('storage'),
    clearCache: () => cleared('cache'),
  };
  return session;
}

interface Call {
  name: string;
  input: Record<string, unknown>;
}

function stand(
  options: {
    caps?: { session: number; total: number };
    work?: (input: { appSessionId: string; held: boolean }) => Promise<CommandResult<'browserEngine.work'>>;
    identity?: () => Promise<boolean>;
    lineage?: Record<string, AppSessionId>; // the parent mawsd names in a side thread's prepare (M5)
    clear?: (partition: string, what: 'storage' | 'cache') => Promise<void>;
    frameRefused?: boolean; // M6: mawsd refuses every frame (a subscription it settled)
  } = {},
) {
  const root = mkdtempSync('/tmp/mrt-');
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const calls: Call[] = [];
  const frames = paints(); // M6: each tab's paints, by tab id
  const sessions = new Map<string, ReturnType<typeof fakeSession>>();
  const logs: string[] = [];
  const call = (async (name: string, input: Record<string, unknown>) => {
    calls.push({ name, input });
    switch (name) {
      case 'machine.identity':
        return (await (options.identity?.() ?? Promise.resolve(true))) ? { ok: true, value: {} } : { ok: false, error: ipcError('host_unavailable', 'gone') };
      case 'browserEngine.work':
        return options.work ? options.work(input as { appSessionId: string; held: boolean }) : { ok: true, value: undefined };
      case 'browserEngine.frame':
        return options.frameRefused ? { ok: false, error: ipcError('forbidden_sender', 'no such subscription outstanding') } : { ok: true, value: undefined };
      default:
        return { ok: true, value: undefined };
    }
  }) as unknown as EngineCall;
  // Electron's own `-run-dialog` listener, one on every webContents: a box (for an offscreen page, a parentless one)
  const native = vi.fn((_info: unknown, callback: (accept: boolean, text: string) => void) => callback(true, ''));
  const engine: TabEngine = startTabEngine({
    call,
    socketFd: () => 3,
    views: (partitions) => {
      const views = new OffscreenViews(partitions);
      const create = views.createView;
      views.createView = (tab, adopted) => {
        const view = create(tab, adopted);
        const contents = view.webContents as unknown as NodeJS.EventEmitter;
        if (contents.listenerCount('-run-dialog') === 0) contents.on('-run-dialog', native);
        return view;
      };
      return views;
    },
    fromPartition: (partition) => {
      const session = fakeSession(async (what) => {
        calls.push({ name: `clear ${what}`, input: { partition } });
        await options.clear?.(partition, what);
      });
      sessions.set(partition, session);
      return session as unknown as Session;
    },
    socketDir: join(root, 'render-cua'),
    userData: join(root, 'render-host'),
    peer: { addon, platform: 'darwin' },
    machine: 'mini',
    version: '9.9.9',
    caps: options.caps,
    frames: { source: (entry) => frames.source(entry.tab.tabId), encode: async (image) => ({ jpeg: new Uint8Array([(image as { n: number }).n]), width: 1280, height: 800 }) }, // M6
    log: (line) => void logs.push(line),
  });
  cleanups.push(() => engine.dispose());
  let next = 0;
  const answers = () => calls.filter((c) => c.name === 'browserEngine.answer').map((c) => c.input as { id: string; result: { ok: boolean; value?: unknown; error?: string } });
  // A request as mawsd sends it, and its answer
  const ask = async (appSessionId: AppSessionId, op: BrowserEngineRequest['operation']['op']) => {
    const id = `q${++next}`;
    const parent = op === 'prepare' ? options.lineage?.[appSessionId] : undefined;
    engine.request({ id, appSessionId, operation: { op, ...(parent && { parent }) } } as BrowserEngineRequest);
    await expect.poll(() => answers().find((a) => a.id === id), { timeout: 3000 }).toBeDefined();
    return answers().find((a) => a.id === id)!.result;
  };
  const socketOf = (appSessionId: AppSessionId) => join(root, 'render-cua', `${appSessionId}.sock`);
  const host = async (appSessionId: AppSessionId) => {
    const connected = await connectFakeHost(socketOf(appSessionId));
    cleanups.push(() => connected.close());
    return connected;
  };
  const states = (appSessionId: AppSessionId) => calls.filter((c) => c.name === 'browserEngine.state' && c.input.appSessionId === appSessionId).map((c) => c.input.inventory as EngineInventory);
  const works = () => calls.filter((c) => c.name === 'browserEngine.work').map((c) => `${String(c.input.appSessionId)} ${c.input.held ? 'held' : 'zero'}`);
  return { engine, calls, ask, host, socketOf, states, works, sessions, logs, native, frames };
}

// M6: a tab's frame source as the producer subscribes it (the real frame subscription is M8's pass 3): each paint a
// numbered image; `live` the tabs subscribed now
function paints() {
  const live = new Map<string, (image: { n: number }) => void>();
  let painted = 0;
  return {
    live,
    source: (tabId: string) => ({ start: (paint: (image: unknown) => void) => void live.set(tabId, paint), stop: () => void live.delete(tabId) }),
    paint: (tabId: string) => live.get(tabId)?.({ n: ++painted }),
  };
}

const pageOf = (view: FakeView) => view.webContents;
// The page a `tabs.create` made: the newest view's
const newestPage = () => pageOf(made.views.at(-1)!);
// A page's own `window.open` of `url` after an activation, as Chromium hands it to the handler
function popup(page: FakePage, url: string) {
  return page.openHandler!({ url, disposition: 'foreground-tab', referrer: { url: '', policy: 'default' }, postBody: undefined, frameName: '', features: '' });
}

describe('the tab engine under a stand-in Electron', () => {
  it('serves a prepared session’s tab offscreen in one sizing window that is never shown, at 1280×800, sandboxed and guarded', async () => {
    const t = stand();
    expect(await t.ask(A, 'prepare')).toEqual({ ok: true, value: null });
    const host = await t.host(A);
    expect(host.hello).toMatchObject({ extensionInstanceId: 'maws:A', version: '9.9.9', profileName: 'MAWS' });
    expect(await host.request('windows.query')).toEqual([{ id: 1, focused: true, type: 'normal' }]);
    const created = await host.request<{ id: number; windowId: number }>('tabs.create', { url: 'http://127.0.0.1:4000/' });
    expect(created.windowId).toBe(1); // the window windows.query answered
    expect(made.views).toHaveLength(1);
    const [view] = made.views;
    expect(view!.options.webPreferences).toEqual({ ...offscreenPreferences(), partition: headlessPartition(A) });
    expect(view!.options.webPreferences).toMatchObject({ offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false });
    expect(pageOf(view!).webRtcPolicy).toBe(HEADLESS_WEBRTC_IP_POLICY);
    expect(view!.bounds).toEqual({ x: 0, y: 0, ...HEADLESS_VIEWPORT });
    expect(made.windows).toHaveLength(1);
    const [window] = made.windows;
    expect(window!.options).toMatchObject({ show: false, width: 1280, height: 800, frame: false, skipTaskbar: true });
    expect(window!.children).toEqual([view]);
    expect(window!.shown).toEqual([]);
    // the partition's guards: the user agent without Electron's token, the request rules, the permission handlers, and
    // a refused download
    const session = t.sessions.get(headlessPartition(A))!;
    expect(session.handlers.get('userAgent')).toBe('Mozilla/5.0 Chrome/140');
    expect([...session.handlers.keys()]).toEqual(expect.arrayContaining(['onBeforeRequest', 'permissionRequest', 'permissionCheck', 'devicePermission', 'displayMedia', 'on will-download']));
    const download = { preventDefault: vi.fn() };
    (session.handlers.get('on will-download') as (event: unknown) => void)(download);
    expect(download.preventDefault).toHaveBeenCalled();
    // the last tab closed takes the window with it
    await host.request('tabs.remove', { tabId: created.id });
    expect(window!.destroyed).toBe(true);
    expect(window!.shown).toEqual([]);
  });

  it('places an adopted popup the same way, offscreen, in the same window, with no acquire of its own', async () => {
    const t = stand();
    await t.ask(A, 'prepare');
    const host = await t.host(A);
    await host.request('tabs.create', { url: 'http://127.0.0.1:4000/' });
    const answer = popup(activated(newestPage()), 'http://127.0.0.1:4000/popup');
    expect(answer).toMatchObject({ action: 'allow', overrideBrowserWindowOptions: { webPreferences: offscreenPreferences() } });
    const child = new (await import('./electron.fake')).FakePage();
    (answer as { createWindow(options: unknown): unknown }).createWindow({ webContents: child });
    expect(made.views).toHaveLength(2);
    expect(made.views[1]!.webContents).toBe(child);
    expect(made.windows).toHaveLength(1);
    expect(made.windows[0]!.children).toEqual(made.views);
    expect(made.views[1]!.bounds).toEqual({ x: 0, y: 0, ...HEADLESS_VIEWPORT });
    expect(t.works()).toEqual(['A held']); // the opener's acquire alone
    expect(t.engine.inspect().sessions.A).toMatchObject({ tabs: 2, held: 'held' });
  });

  it('keeps view.ts’s page preferences and WebRTC policy, offscreen', () => {
    expect(offscreenPreferences()).toEqual({ ...tabWebPreferences(), offscreen: true });
    expect(readFileSync(resolve(__dirname, '../main/browser/view.ts'), 'utf8')).toContain(`const TAB_WEBRTC_IP_POLICY = '${HEADLESS_WEBRTC_IP_POLICY}';`);
  });
});

// The page pressed (input.ts's `before-mouse-event`), the activation a page's `window.open` needs (window-open.ts)
function activated(page: FakePage): FakePage {
  page.emit('before-mouse-event', {}, { type: 'mouseDown', button: 'left', x: 1, y: 1 });
  return page;
}

describe('the tab engine’s sessions', () => {
  it('answers prepare once the socket listens and mawsd’s relay is confirmed on the link, then pushes the session ready', async () => {
    const identity = deferred<boolean>();
    const t = stand({ identity: () => identity.promise });
    t.engine.request({ id: 'p1', appSessionId: A, operation: { op: 'prepare' } });
    await expect.poll(() => existsSync(t.socketOf(A))).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(t.calls.filter((c) => c.name === 'browserEngine.answer'), 'not before the relay is confirmed').toEqual([]);
    identity.resolve(true);
    await expect.poll(() => t.calls.filter((c) => c.name === 'browserEngine.answer')).toHaveLength(1);
    const order = t.calls.filter((c) => c.name.startsWith('browserEngine.')).map((c) => c.name);
    expect(order).toEqual(['browserEngine.answer', 'browserEngine.state']); // the answer first: then the session is ready
    expect(t.states(A)).toEqual([{ tabs: [], selected: null, state: 'ready' }]);
    expect(await t.ask(A, 'prepare'), 'a session already served answers at once').toEqual({ ok: true, value: null });
  });

  it('refuses prepare when the relay cannot be confirmed, and listens no longer', async () => {
    const t = stand({ identity: async () => false });
    expect(await t.ask(A, 'prepare')).toEqual({ ok: false, error: "the headless browser on mini could not confirm mawsd's relay" });
    await expect.poll(() => existsSync(t.socketOf(A))).toBe(false);
    expect(await t.ask(A, 'inventory')).toEqual({ ok: true, value: { tabs: [], selected: null, state: 'unavailable', reason: 'the headless browser on mini does not serve this session' } });
  });

  it('gives each session its own partition and inventory; an unrelated session reaches nothing of another’s', async () => {
    const t = stand();
    await t.ask(A, 'prepare');
    await t.ask(B, 'prepare');
    const [hostA, hostB] = [await t.host(A), await t.host(B)];
    await hostA.request('tabs.create', { url: 'http://127.0.0.1:4000/a' });
    await hostB.request('tabs.create', { url: 'http://127.0.0.1:4000/b' });
    expect(made.views.map((view) => view.options.webPreferences?.partition)).toEqual([headlessPartition(A), headlessPartition(B)]);
    expect(headlessPartition(A).startsWith('persist:')).toBe(false); // in memory: nothing outlives the process
    expect((await hostB.request<{ url: string }[]>('tabs.query')).map((tab) => tab.url)).toEqual(['http://127.0.0.1:4000/b']);
    const inventoryA = (await t.ask(A, 'inventory')) as { ok: true; value: EngineInventory };
    expect(inventoryA.value).toEqual({ tabs: [{ tabId: expect.stringMatching(/^b_[0-9a-f]{12}$/), title: '', url: 'http://127.0.0.1:4000/a', control: 'idle' }], selected: inventoryA.value.tabs[0]!.tabId, state: 'ready' });
    const inventoryB = (await t.ask(B, 'inventory')) as { ok: true; value: EngineInventory };
    expect(inventoryB.value.tabs.map((tab) => tab.url)).toEqual(['http://127.0.0.1:4000/b']);
    await expect.poll(() => t.states(A).at(-1)?.tabs.length).toBe(1); // pushed at the change
  });

  it('lets a side thread reach its parent’s tabs by the existing rule, the parent named in its prepare (M5), reading nothing over the link', async () => {
    const t = stand({ lineage: { S: A } });
    await t.ask(A, 'prepare');
    await t.ask(S, 'prepare');
    await t.ask(B, 'prepare');
    expect(t.calls.filter((c) => c.name === 'session.get'), 'no lineage read: a spine release could hold it with no deadline').toEqual([]);
    const hostA = await t.host(A);
    await hostA.request('tabs.create', { url: 'http://127.0.0.1:4000/parent' });
    expect((await (await t.host(S)).request<{ url: string }[]>('tabs.query')).map((tab) => tab.url)).toEqual(['http://127.0.0.1:4000/parent']);
    expect(await (await t.host(B)).request('tabs.query')).toEqual([]);
  });

  it('drops only that session’s tabs, and answers once its connections are gone and its work is reported zero', async () => {
    const t = stand();
    await t.ask(A, 'prepare');
    await t.ask(B, 'prepare');
    const [hostA, hostB] = [await t.host(A), await t.host(B)];
    const created = await hostA.request<{ id: number }>('tabs.create', { url: 'http://127.0.0.1:4000/a' });
    await hostA.request('debugger.attach', { tabId: created.id });
    await hostB.request('tabs.create', { url: 'http://127.0.0.1:4000/b' });
    t.engine.request({ id: 'd1', appSessionId: A, operation: { op: 'drop' } });
    await expect.poll(() => t.calls.some((c) => c.name === 'browserEngine.answer' && c.input.id === 'd1')).toBe(true);
    await hostA.closed; // ended by MAWS (the server's side closed before the answer: cua/index.test.ts's closeSession)
    const tail = t.calls.slice(-2).map((c) => `${c.name} ${String(c.input.appSessionId ?? c.input.id)}`);
    expect(tail).toEqual(['browserEngine.work A', 'browserEngine.answer d1']); // the zero before the answer
    expect(t.works()).toEqual(['A held', 'B held', 'A zero']);
    expect(existsSync(t.socketOf(A))).toBe(false);
    expect(Object.keys(t.engine.inspect().sessions)).toEqual([B]);
    expect((await hostB.request<unknown[]>('tabs.query')).length).toBe(1); // B's tab stands
    expect(await t.ask(A, 'drop'), 'a session not served answers at once').toEqual({ ok: true, value: null });
  });

  it('clears the dropped session’s partition, its storage and cache, before it answers; a re-prepare waits for it', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const t = stand({ clear: (_partition, what) => (what === 'storage' ? held : Promise.resolve()) });
    await t.ask(A, 'prepare');
    await t.ask(B, 'prepare');
    const host = await t.host(A);
    await host.request('tabs.create', { url: 'http://127.0.0.1:4000/a' });
    t.engine.request({ id: 'd1', appSessionId: A, operation: { op: 'drop' } });
    await expect.poll(() => t.calls.filter((c) => c.name.startsWith('clear')).length).toBe(2);
    t.engine.request({ id: 'p2', appSessionId: A, operation: { op: 'prepare' } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const pending = () => t.calls.filter((c) => c.name === 'browserEngine.answer' && ['d1', 'p2'].includes(c.input.id as string)).map((c) => c.input.id);
    expect(pending(), 'neither answered while the storage is being cleared').toEqual([]);
    release();
    await expect.poll(pending).toEqual(['d1', 'p2']);
    expect(t.calls.filter((c) => c.name.startsWith('clear')).map((c) => `${c.name} ${String(c.input.partition)}`)).toEqual([`clear storage ${headlessPartition(A)}`, `clear cache ${headlessPartition(A)}`]);
    expect(await t.ask(B, 'drop'), 'a session that opened no tab has no partition to clear').toEqual({ ok: true, value: null });
    expect(t.calls.filter((c) => c.name.startsWith('clear'))).toHaveLength(2);
  });

  it('answers a drop whose partition could not be cleared with the reason, its tabs closed and its work reported zero all the same', async () => {
    const t = stand({ clear: async () => Promise.reject(new Error('the disk said no')) });
    await t.ask(A, 'prepare');
    const host = await t.host(A);
    await host.request('tabs.create', { url: 'http://127.0.0.1:4000/a' });
    expect(await t.ask(A, 'drop')).toEqual({ ok: false, error: 'the headless browser on mini could not clear this session’s partition: the disk said no' });
    expect(t.works()).toEqual(['A held', 'A zero']);
    expect(t.engine.inspect().sessions).toEqual({});
  });
});

// The drop's cleanup as a barrier (fix 2; the task re-review's regressions, m4-drop-order.test.ts): a second drop joins
// the one in flight, both clears settle before anything answers, and a partition left uncleared is cleaned by the next
// prepare or that prepare is refused.
describe('the drop’s cleanup', () => {
  // A prepared session with one tab, its partition opened; `clear` decides each clear's outcome
  async function droppable(clear: (what: 'storage' | 'cache') => Promise<void>) {
    const t = stand({ clear: (_partition, what) => clear(what) });
    await t.ask(A, 'prepare');
    const host = await t.host(A);
    await host.request('tabs.create', { url: 'http://127.0.0.1:4000/' });
    const answered = (id: string) => t.calls.find((c) => c.name === 'browserEngine.answer' && c.input.id === id)?.input.result as { ok: boolean; error?: string } | undefined;
    const send = (id: string, op: 'prepare' | 'drop') => t.engine.request({ id, appSessionId: A, operation: { op } });
    return { ...t, answered, send };
  }

  it('makes a second drop join the one in flight: neither drop nor a prepare answers while its storage is being cleared', async () => {
    let release!: () => void;
    const storage = new Promise<void>((resolve) => (release = resolve));
    const t = await droppable((what) => (what === 'storage' ? storage : Promise.resolve()));
    t.send('d1', 'drop');
    await expect.poll(() => t.calls.some((c) => c.name === 'clear storage')).toBe(true);
    t.send('d2', 'drop');
    t.send('p2', 'prepare');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect([t.answered('d1'), t.answered('d2'), t.answered('p2')]).toEqual([undefined, undefined, undefined]);
    release();
    await expect.poll(() => [t.answered('d1'), t.answered('d2'), t.answered('p2')]).toEqual([{ ok: true, value: null }, { ok: true, value: null }, { ok: true, value: null }]);
    expect(t.calls.filter((c) => c.name.startsWith('clear')).map((c) => c.name)).toEqual(['clear storage', 'clear cache']); // one cleanup
  });

  it('waits for both clears when one fails, answering the drop with the reason only once the other has settled', async () => {
    let release!: () => void;
    const cache = new Promise<void>((resolve) => (release = resolve));
    const t = await droppable((what) => (what === 'storage' ? Promise.reject(new Error('storage failed')) : cache));
    t.send('d1', 'drop');
    await expect.poll(() => t.calls.some((c) => c.name === 'clear cache')).toBe(true);
    t.send('p2', 'prepare');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect([t.answered('d1'), t.answered('p2')]).toEqual([undefined, undefined]);
    release();
    await expect.poll(() => t.answered('d1')).toEqual({ ok: false, error: 'the headless browser on mini could not clear this session’s partition: storage failed' });
  });

  it('refuses a prepare while the partition its last drop could not clear still cannot be cleared', async () => {
    const t = await droppable((what) => (what === 'storage' ? Promise.reject(new Error('storage failed')) : Promise.resolve()));
    t.send('d1', 'drop');
    await expect.poll(() => t.answered('d1')?.ok).toBe(false);
    t.send('p2', 'prepare');
    await expect.poll(() => t.answered('p2')).toEqual({ ok: false, error: 'the headless browser on mini could not clear this session’s partition: storage failed' });
    expect(t.engine.inspect().sessions).toEqual({});
    expect(existsSync(t.socketOf(A)), 'no socket listens for the refused session').toBe(false);
  });

  it('makes a drop sent while a prepare cleans the partition wait for that clear, cancelling the prepare, then answer', async () => {
    let release!: () => void;
    const retry = new Promise<void>((resolve) => (release = resolve));
    let storage = 0;
    const t = await droppable((what) => {
      if (what === 'cache') return Promise.resolve();
      storage += 1;
      return storage === 1 ? Promise.reject(new Error('first clear failed')) : storage === 2 ? retry : Promise.resolve();
    });
    t.send('d1', 'drop');
    await expect.poll(() => t.answered('d1')?.ok).toBe(false);
    t.send('p2', 'prepare');
    await expect.poll(() => storage).toBe(2); // the prepare's clear of what d1 left, held
    t.send('d2', 'drop');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect([t.answered('p2'), t.answered('d2')]).toEqual([undefined, undefined]);
    release();
    await expect.poll(() => [t.answered('p2'), t.answered('d2')]).toEqual([{ ok: false, error: 'the headless browser on mini dropped this session while preparing it' }, { ok: true, value: null }]);
    expect(existsSync(t.socketOf(A)), 'the cancelled prepare made no socket').toBe(false);
    expect(t.engine.inspect().sessions).toEqual({});
  });

  it('cancels a prepare stuck on a live link’s missing answer at a drop, which answers without it, the socket closed', async () => {
    let confirm!: (ok: boolean) => void;
    const t = stand({ identity: () => new Promise<boolean>((resolve) => (confirm = resolve)) });
    t.engine.request({ id: 'p1', appSessionId: A, operation: { op: 'prepare' } });
    await expect.poll(() => existsSync(t.socketOf(A))).toBe(true);
    t.engine.request({ id: 'd1', appSessionId: A, operation: { op: 'drop' } });
    const answered = (id: string) => t.calls.find((c) => c.name === 'browserEngine.answer' && c.input.id === id)?.input.result;
    await expect.poll(() => [answered('p1'), answered('d1')]).toEqual([{ ok: false, error: 'the headless browser on mini dropped this session while preparing it' }, { ok: true, value: null }]);
    expect(existsSync(t.socketOf(A))).toBe(false);
    expect(t.engine.inspect().sessions).toEqual({});
    confirm(true); // the late answer does nothing
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(t.calls.filter((c) => c.name === 'browserEngine.answer')).toHaveLength(2);
    expect(existsSync(t.socketOf(A))).toBe(false);
  });

  it('cancels a prepare still queued behind a drop when another drop follows it', async () => {
    let release!: () => void;
    const storage = new Promise<void>((resolve) => (release = resolve));
    const t = await droppable((what) => (what === 'storage' ? storage : Promise.resolve()));
    t.send('d1', 'drop');
    await expect.poll(() => t.calls.some((c) => c.name === 'clear storage')).toBe(true);
    t.send('p2', 'prepare');
    t.send('d2', 'drop');
    release();
    await expect.poll(() => [t.answered('d1'), t.answered('p2'), t.answered('d2')]).toEqual([
      { ok: true, value: null },
      { ok: false, error: 'the headless browser on mini dropped this session while preparing it' },
      { ok: true, value: null },
    ]);
    expect(existsSync(t.socketOf(A))).toBe(false);
  });

  it('cancels a running prepare at dispose', async () => {
    const t = stand({ identity: () => new Promise<boolean>(() => {}) });
    t.engine.request({ id: 'p1', appSessionId: A, operation: { op: 'prepare' } });
    await expect.poll(() => existsSync(t.socketOf(A))).toBe(true);
    t.engine.dispose();
    await expect.poll(() => t.calls.find((c) => c.name === 'browserEngine.answer')?.input.result).toEqual({ ok: false, error: 'the headless browser on mini is ending' });
    expect(existsSync(t.socketOf(A))).toBe(false);
  });

  it('serves a prepare once it has cleaned the partition its last drop left uncleared', async () => {
    let failures = 1;
    const t = await droppable(async (what) => {
      if (what === 'storage' && failures-- > 0) throw new Error('storage failed');
    });
    t.send('d1', 'drop');
    await expect.poll(() => t.answered('d1')?.ok).toBe(false);
    t.send('p2', 'prepare');
    await expect.poll(() => t.answered('p2')).toEqual({ ok: true, value: null });
    expect(t.calls.filter((c) => c.name === 'clear storage')).toHaveLength(2); // cleaned again before serving
  });
});

describe('a headless page’s JavaScript dialogs', () => {
  const dialog = (page: FakePage, dialogType: string) => {
    const answered = vi.fn();
    page.emit('-run-dialog', { dialogType, messageText: 'onload' }, answered);
    return answered;
  };

  it('answers an unleased page’s alert and confirm with the defaults and never raises Electron’s box; a prompt stays Electron’s', async () => {
    const t = stand();
    await t.ask(A, 'prepare');
    const host = await t.host(A);
    await host.request('tabs.create', { url: 'http://127.0.0.1:4000/' });
    expect(dialog(newestPage(), 'alert')).toHaveBeenCalledWith(false, '');
    expect(dialog(newestPage(), 'confirm')).toHaveBeenCalledWith(false, '');
    expect(t.native).not.toHaveBeenCalled();
    dialog(newestPage(), 'prompt'); // its renderer refuses prompt() first; Electron's listener answers at once, showing nothing
    expect(t.native).toHaveBeenCalledTimes(1);
  });

  it('holds a leased page’s alert for cua, unanswered and with no box, for the vendor to answer through CDP', async () => {
    const t = stand();
    await t.ask(A, 'prepare');
    const host = await t.host(A);
    const created = await host.request<{ id: number }>('tabs.create', { url: 'http://127.0.0.1:4000/' });
    await host.request('debugger.attach', { tabId: created.id });
    const answered = dialog(newestPage(), 'alert');
    expect(answered).not.toHaveBeenCalled();
    expect(t.native).not.toHaveBeenCalled();
  });

  it('treats an adopted popup’s dialogs the same way', async () => {
    const t = stand();
    await t.ask(A, 'prepare');
    const host = await t.host(A);
    await host.request('tabs.create', { url: 'http://127.0.0.1:4000/' });
    const child = new FakePage();
    (popup(activated(newestPage()), 'http://127.0.0.1:4000/popup') as { createWindow(options: unknown): unknown }).createWindow({ webContents: child });
    expect(dialog(child, 'alert')).toHaveBeenCalledWith(false, '');
    expect(t.native).not.toHaveBeenCalled();
  });
});

describe('the fence and the caps', () => {
  it('acquires before the session’s first tab, one acquire for concurrent creations, and reports zero after its last', async () => {
    const held = deferred<CommandResult<'browserEngine.work'>>();
    const t = stand({ work: (input) => (input.held ? held.promise : Promise.resolve({ ok: true, value: undefined })) });
    await t.ask(A, 'prepare');
    const host = await t.host(A);
    const first = host.request<{ id: number }>('tabs.create', { url: 'http://127.0.0.1:4000/1' });
    const second = host.request<{ id: number }>('tabs.create', { url: 'http://127.0.0.1:4000/2' });
    await expect.poll(() => t.engine.inspect().sessions.A).toEqual({ tabs: 0, creating: 2, held: 'acquiring' });
    expect(made.views, 'no tab before the fence').toEqual([]);
    expect(t.works()).toEqual(['A held']);
    held.resolve({ ok: true, value: undefined });
    const ids = [(await first).id, (await second).id];
    expect(t.engine.inspect().sessions.A).toEqual({ tabs: 2, creating: 0, held: 'held' });
    await host.request<{ id: number }>('tabs.create', { url: 'http://127.0.0.1:4000/3' });
    expect(t.works(), 'the session holds: no second acquire').toEqual(['A held']);
    const third = (await host.request<{ id: number }[]>('tabs.query')).at(-1)!.id;
    for (const tabId of [...ids, third].slice(0, 2)) await host.request('tabs.remove', { tabId });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(t.works()).toEqual(['A held']);
    await host.request('tabs.remove', { tabId: third });
    await expect.poll(() => t.works()).toEqual(['A held', 'A zero']);
    expect(t.engine.inspect().sessions.A).toEqual({ tabs: 0, creating: 0, held: 'none' });
  });

  it('makes no tab when the fence cannot be had, and answers the primitive with the reason', async () => {
    const t = stand({ work: async () => ({ ok: false, error: ipcError('host_unavailable', 'the engine host on mini is reconnecting') }) });
    await t.ask(A, 'prepare');
    const host = await t.host(A);
    await expect(host.request('tabs.create', { url: 'http://127.0.0.1:4000/' })).rejects.toThrow('the engine host on mini is reconnecting');
    expect(made.views).toEqual([]);
    expect(await host.request('tabs.query')).toEqual([]);
    expect(t.engine.inspect().sessions.A).toEqual({ tabs: 0, creating: 0, held: 'none' });
    await expect(host.request('tabs.create', { url: 'file:///etc/passwd' })).rejects.toThrow('Invalid url');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(t.works(), 'a refused URL takes nothing of the gate; a refused acquire is followed by no zero').toEqual(['A held']);
  });

  it('waits out an acquire in flight at a drop: no zero after one refused, the zero after one granted, and no tab either way', async () => {
    for (const granted of [false, true]) {
      const held = deferred<CommandResult<'browserEngine.work'>>();
      const t = stand({ work: (input) => (input.held ? held.promise : Promise.resolve({ ok: true, value: undefined })) });
      await t.ask(A, 'prepare');
      const host = await t.host(A);
      const creating = host.request('tabs.create', { url: 'http://127.0.0.1:4000/' }).then(() => 'made', () => 'failed');
      await expect.poll(() => t.engine.inspect().sessions.A?.held).toBe('acquiring');
      t.engine.request({ id: 'd1', appSessionId: A, operation: { op: 'drop' } });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(t.calls.some((c) => c.name === 'browserEngine.answer' && c.input.id === 'd1'), 'the drop waits for the acquire').toBe(false);
      held.resolve(granted ? { ok: true, value: undefined } : { ok: false, error: ipcError('forbidden_sender', 'the session’s period was retired') });
      await expect.poll(() => t.calls.some((c) => c.name === 'browserEngine.answer' && c.input.id === 'd1')).toBe(true);
      expect(t.works(), granted ? 'granted' : 'refused').toEqual(granted ? ['A held', 'A zero'] : ['A held']);
      expect(await creating).toBe('failed');
      expect(made.views).toEqual([]);
      reset();
    }
  });

  it('keeps the hold while an adopted popup outlives its opener, and reports zero at the popup’s close', async () => {
    const t = stand();
    await t.ask(A, 'prepare');
    const host = await t.host(A);
    const opener = await host.request<{ id: number }>('tabs.create', { url: 'http://127.0.0.1:4000/' });
    await host.request('debugger.attach', { tabId: opener.id }); // the agent drives the page that opens it
    const answer = popup(activated(newestPage()), 'http://127.0.0.1:4000/popup');
    (answer as { createWindow(options: unknown): unknown }).createWindow({ webContents: new (await import('./electron.fake')).FakePage() });
    await host.request('tabs.remove', { tabId: opener.id });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(t.works()).toEqual(['A held']);
    expect(t.engine.inspect().sessions.A).toMatchObject({ tabs: 1, held: 'held' });
    // the popup is adopted to the opener's connection (cua's tabs.adopted): it may close it
    const adopted = await host.waitFor('tabs.adopted');
    await host.request('tabs.remove', { tabId: adopted.params.tabId as number });
    await expect.poll(() => t.works()).toEqual(['A held', 'A zero']);
  });

  it('caps the tabs per session and per render host, answering why; a popup past them is denied', async () => {
    const t = stand({ caps: { session: 2, total: 3 } });
    expect(HEADLESS_TABS).toEqual({ session: 32, total: 64 });
    await t.ask(A, 'prepare');
    await t.ask(B, 'prepare');
    const [hostA, hostB] = [await t.host(A), await t.host(B)];
    await hostA.request('tabs.create', { url: 'http://127.0.0.1:4000/1' });
    await hostA.request('tabs.create', { url: 'http://127.0.0.1:4000/2' });
    await expect(hostA.request('tabs.create', { url: 'http://127.0.0.1:4000/3' })).rejects.toThrow('the headless browser on mini already holds its 2 tabs');
    expect(popup(activated(newestPage()), 'http://127.0.0.1:4000/popup')).toEqual({ action: 'deny' });
    await hostB.request('tabs.create', { url: 'http://127.0.0.1:4000/b1' });
    await expect(hostB.request('tabs.create', { url: 'http://127.0.0.1:4000/b2' })).rejects.toThrow('the headless browser on mini already holds its 3 tabs');
    expect(made.views).toHaveLength(3);
  });

  it('checks a popup again when Chromium hands its child over: two admitted past the cap make one tab, the other child closed', async () => {
    const refused = vi.spyOn(console, 'error').mockImplementation(() => {}); // window-open.ts's line for a child not adopted
    const t = stand({ caps: { session: 3, total: 4 } });
    await t.ask(A, 'prepare');
    const host = await t.host(A);
    await host.request('tabs.create', { url: 'http://127.0.0.1:4000/1' });
    await host.request('tabs.create', { url: 'http://127.0.0.1:4000/2' });
    const [one, two] = made.views.map((view) => popup(activated(pageOf(view)), 'http://127.0.0.1:4000/popup') as { action: string; createWindow(options: unknown): unknown });
    expect([one!.action, two!.action]).toEqual(['allow', 'allow']); // each admitted while there was room for one
    const children = [new FakePage(), new FakePage()];
    one!.createWindow({ webContents: children[0] });
    two!.createWindow({ webContents: children[1] });
    expect(t.engine.inspect().sessions.A!.tabs).toBe(3);
    await expect.poll(() => children[1]!.isDestroyed()).toBe(true);
    expect(children[0]!.isDestroyed()).toBe(false);
    expect(refused).toHaveBeenCalledWith('[browser] a window.open child could not be adopted:', new Error('a page’s popup was refused: the headless browser on mini already holds its 3 tabs'));
    // a modifier-clicked link (no child: the page is opened as a tab) is held to the same caps, and opens nothing
    two!.createWindow({});
    expect(t.engine.inspect().sessions.A!.tabs).toBe(3);
    const [, second] = await host.request<{ id: number; blockedPopups?: number }[]>('tabs.query');
    expect(second).toBeDefined();
    expect(t.logs.filter((line) => line.includes('popup was refused'))).toHaveLength(2);
    refused.mockRestore();
  });

  it('makes no tab of a popup whose child arrives after its session was dropped', async () => {
    const refused = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = stand();
    await t.ask(A, 'prepare');
    const host = await t.host(A);
    await host.request('tabs.create', { url: 'http://127.0.0.1:4000/' });
    const late = popup(activated(newestPage()), 'http://127.0.0.1:4000/late') as { action: string; createWindow(options: unknown): unknown };
    expect(late.action).toBe('allow');
    expect(await t.ask(A, 'drop')).toEqual({ ok: true, value: null });
    const views = made.views.length;
    const child = new FakePage();
    late.createWindow({ webContents: child });
    late.createWindow({});
    expect(made.views).toHaveLength(views);
    await expect.poll(() => child.isDestroyed()).toBe(true);
    refused.mockRestore();
  });
});

describe('the orphan policy (D1)', () => {
  it('lets a new connection of the session close a tab whose creator is gone, clearing the count and the work; another session’s connection is refused it', async () => {
    const t = stand({ lineage: { S: A } });
    await t.ask(A, 'prepare');
    await t.ask(S, 'prepare');
    const creator = await t.host(A);
    await creator.request('tabs.create', { url: 'http://127.0.0.1:4000/kept' });
    await creator.close();
    await expect.poll(() => t.logs.some((line) => line.includes('connection on A'))).toBe(true);
    expect(t.engine.inspect().sessions.A).toMatchObject({ tabs: 1, held: 'held' }); // the tab outlives its creator
    // a side thread reaches it, but it is not its session's: refused to lease and to close
    const side = await t.host(S);
    const [seen] = await side.request<{ id: number }[]>('tabs.query');
    await expect(side.request('tabs.remove', { tabId: seen!.id })).rejects.toThrow('Tab is held by another agent session');
    await expect(side.request('debugger.attach', { tabId: seen!.id })).rejects.toThrow('Tab is held by another agent session');
    // the session's next connection adopts it at its close
    const next = await t.host(A);
    const [orphan] = await next.request<{ id: number }[]>('tabs.query');
    expect(await next.request('tabs.remove', { tabId: orphan!.id })).toEqual({});
    await expect.poll(() => t.works()).toEqual(['A held', 'A zero']);
    expect(t.engine.inspect().sessions.A).toEqual({ tabs: 0, creating: 0, held: 'none' });
    await expect.poll(() => t.states(A).at(-1)?.tabs).toEqual([]);
  });
});

// Condition 4 of O5's M7 verdict: nothing on the render host's path holds a power save blocker. The render host's graph,
// from its root through every relative and `@shared` import, names none.
// M6 (Interfaces §F, §G): a viewer's subscription to a session's tab, served by the producer over the session's chain
describe('a viewer’s subscription', () => {
  // A prepared session with one tab; `op` sends one operation as mawsd does and reads its answer
  async function viewed(options: Parameters<typeof stand>[0] = {}) {
    const t = stand(options);
    await t.ask(A, 'prepare');
    const host = await t.host(A);
    await host.request('tabs.create', { url: 'http://127.0.0.1:4000/' });
    await expect.poll(() => t.states(A).at(-1)?.tabs.length).toBe(1);
    const tabId = t.states(A).at(-1)!.tabs[0]!.tabId;
    let next = 0;
    const answerOf = (id: string) => t.calls.find((c) => c.name === 'browserEngine.answer' && c.input.id === id)?.input.result as { ok: boolean; value?: unknown; error?: string } | undefined;
    const send = (appSessionId: AppSessionId, operation: BrowserEngineRequest['operation']) => {
      const id = `m${++next}`;
      t.engine.request({ id, appSessionId, operation });
      return id;
    };
    const op = async (appSessionId: AppSessionId, operation: BrowserEngineRequest['operation']) => {
      const id = send(appSessionId, operation);
      await expect.poll(() => answerOf(id)).toBeDefined();
      return answerOf(id)!;
    };
    const sent = (name: string) => t.calls.filter((c) => c.name === name).map((c) => c.input);
    return { ...t, host, tabId, op, send, answerOf, sent };
  }

  it('opens a session’s tab, sends its paints as frames with the viewport, one in flight until the ack, and closes it', async () => {
    const t = await viewed();
    expect(await t.op(A, { op: 'open', subscriptionId: 'v1', tabId: t.tabId, control: false })).toEqual({ ok: true, value: null });
    t.frames.paint(t.tabId);
    await expect.poll(() => t.sent('browserEngine.frame')).toHaveLength(1);
    expect(t.sent('browserEngine.frame')[0]).toMatchObject({ subscriptionId: 'v1', frame: { tabId: t.tabId, seq: 1, width: 1280, height: 800, viewport: HEADLESS_VIEWPORT, jpegBase64: Buffer.from([1]).toString('base64') } });
    t.frames.paint(t.tabId);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(t.sent('browserEngine.frame'), 'nothing past the unacknowledged frame').toHaveLength(1);
    expect(await t.op(A, { op: 'ack', subscriptionId: 'v1', seq: 1 })).toEqual({ ok: true, value: null });
    await expect.poll(() => t.sent('browserEngine.frame')).toHaveLength(2);
    expect(await t.op(A, { op: 'ack', subscriptionId: 'v1', seq: 9 })).toMatchObject({ ok: false, error: expect.stringContaining('future') });
    expect(await t.op(A, { op: 'close', subscriptionId: 'v1' })).toEqual({ ok: true, value: null });
    expect(t.frames.live.size, 'the source stopped with its last viewer').toBe(0);
    expect(await t.op(A, { op: 'close', subscriptionId: 'v1' }), 'a second close finds nothing').toEqual({ ok: true, value: null });
  });

  it('refuses an open of another session’s tab, of a session it does not serve, and a second controlling one; takes a person’s input on a controlling one', async () => {
    const t = await viewed();
    await t.ask(B, 'prepare');
    expect(await t.op(B, { op: 'open', subscriptionId: 'v1', tabId: t.tabId, control: false })).toEqual({ ok: false, error: 'tab_closed' });
    expect(await t.op('C' as AppSessionId, { op: 'open', subscriptionId: 'v1', tabId: t.tabId, control: false })).toMatchObject({ ok: false, error: expect.stringContaining('does not serve') });
    expect((await t.op(A, { op: 'open', subscriptionId: 'v1', tabId: t.tabId, control: true })).ok).toBe(true);
    expect(await t.op(A, { op: 'open', subscriptionId: 'v2', tabId: t.tabId, control: true })).toEqual({ ok: false, error: 'control_busy' });
    expect(await t.op(A, { op: 'input', subscriptionId: 'v1', seq: 1, event: { kind: 'pointer', type: 'down', x: 3, y: 4, button: 'left', buttons: 1, clickCount: 1, modifiers: [] } })).toEqual({ ok: true, value: null });
    expect(newestPage().input).toEqual([{ type: 'mouseDown', x: 3, y: 4, button: 'left', clickCount: 1, modifiers: [] }]);
    expect(await t.op(B, { op: 'input', subscriptionId: 'v1', seq: 2, event: { kind: 'blur' } }), 'bound to its session').toMatchObject({ ok: false });
  });

  it('ends a subscription tab_closed when cua closes its tab, and closes one whose frame mawsd refused', async () => {
    const t = await viewed({ frameRefused: true });
    await t.op(A, { op: 'open', subscriptionId: 'v1', tabId: t.tabId, control: false });
    t.frames.paint(t.tabId);
    await expect.poll(() => t.frames.live.size).toBe(0); // a refused frame closes its subscription here too
    expect(t.sent('browserEngine.ended')).toEqual([]);
    await t.op(A, { op: 'open', subscriptionId: 'v2', tabId: t.tabId, control: false });
    await t.host.request('tabs.remove', { tabId: 1 });
    await expect.poll(() => t.sent('browserEngine.ended')).toEqual([{ subscriptionId: 'v2', reason: 'tab_closed' }]);
  });

  it('closes the session’s subscriptions at its drop, telling no one, and refuses an open queued behind a prepare that drop cancels', async () => {
    const identity = deferred<boolean>();
    const t = await viewed();
    await t.op(A, { op: 'open', subscriptionId: 'v1', tabId: t.tabId, control: true });
    await t.op(A, { op: 'input', subscriptionId: 'v1', seq: 1, event: { kind: 'key', type: 'down', key: 'a', code: 'KeyA', repeat: false, modifiers: [] } });
    const page = newestPage();
    expect(await t.ask(A, 'drop')).toEqual({ ok: true, value: null });
    expect(page.input.at(-1), 'its held key released before the page went').toEqual({ type: 'keyUp', keyCode: 'a', modifiers: [] });
    expect(t.sent('browserEngine.ended')).toEqual([]);
    expect(t.frames.live.size).toBe(0);
    // the drop-cancels-prepare guarantee holds with an open on the chain: the prepare stuck on the relay's confirmation
    // is cancelled by the next drop, the open behind it refused, the drop answered
    const stuck = stand({ identity: () => identity.promise });
    stuck.engine.request({ id: 'p1', appSessionId: A, operation: { op: 'prepare' } });
    stuck.engine.request({ id: 'o1', appSessionId: A, operation: { op: 'open', subscriptionId: 'v9', tabId: t.tabId, control: false } });
    stuck.engine.request({ id: 'd1', appSessionId: A, operation: { op: 'drop' } });
    const answered = () => stuck.calls.filter((c) => c.name === 'browserEngine.answer').map((c) => `${String(c.input.id)} ${(c.input.result as { ok: boolean }).ok}`);
    await expect.poll(answered).toEqual(['p1 false', 'o1 false', 'd1 true']);
  });
});

describe('no power save blocker on the render host’s path', () => {
  it('is named in no module the render host’s root reaches', () => {
    const repo = resolve(__dirname, '../..');
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = readFileSync(file, 'utf8');
      for (const [, spec] of text.matchAll(/(?:from|import\()\s*'([^']+)'/g)) {
        const base = spec!.startsWith('@shared/') ? join(repo, 'src/shared', spec!.slice('@shared/'.length)) : spec!.startsWith('.') ? resolve(dirname(file), spec!) : null;
        if (base === null) continue;
        const found = [`${base}.ts`, join(base, 'index.ts')].find((candidate) => existsSync(candidate));
        if (found) visit(found);
      }
    };
    visit(join(repo, 'src/render-host/root.ts'));
    expect([...seen].some((file) => file.endsWith('src/render-host/tab-engine.ts'))).toBe(true);
    expect([...seen].some((file) => file.endsWith('src/main/browser/cua/index.ts'))).toBe(true);
    expect([...seen].filter((file) => /powerSaveBlocker/.test(readFileSync(file, 'utf8')))).toEqual([]);
  });
});
