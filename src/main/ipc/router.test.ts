import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import type { MachineRef } from '@shared/machine/ref';
import type { HostDispatch, MainContext, RemoteDispatch } from './router';

const LOCAL = 'LocalMachineRef0000000' as MachineRef;
const OTHER = 'OtherMachineRef0000000' as MachineRef;

// Electron is faked: `ipcMain.handle` records one handler per channel, and each fake window is the one whose
// webContents the fake event names as its sender.
const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown, machine?: unknown) => Promise<unknown>>(),
  windows: new Map<object, { webContents: { mainFrame: object } }>(),
  opened: [] as string[], // C9: what `shell.openExternal` was asked to open
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, input: unknown, machine?: unknown) => Promise<unknown>) => {
      if (electron.handlers.has(channel)) throw new Error(`second handler for ${channel}`);
      electron.handlers.set(channel, handler);
    },
  },
  BrowserWindow: { fromWebContents: (webContents: object) => electron.windows.get(webContents) ?? null },
  shell: { openExternal: async (url: string) => void electron.opened.push(url) },
}));

const DEV_URL = 'http://localhost:5173/';

// An app window's webContents: an EventEmitter with an id, as the router's ClientRef needs it (./clients.ts).
let pageIds = 0;
function appWindow(url = DEV_URL) {
  const mainFrame = { url, parent: null };
  const webContents = Object.assign(new EventEmitter(), { id: ++pageIds, mainFrame, isDestroyed: () => false });
  electron.windows.set(webContents, { webContents });
  return { sender: webContents, senderFrame: mainFrame };
}

type Router = typeof import('./router');
let router: Router;

async function load(appUrl = DEV_URL, dispatchToHost?: Parameters<Router['installRouter']>[0]['dispatchToHost'], remote?: RemoteDispatch) {
  vi.resetModules();
  electron.handlers.clear();
  electron.windows.clear();
  electron.opened.length = 0;
  router = await import('./router');
  router.installRouter({ appUrl, local: LOCAL, dispatchToHost, remote });
}

// P5 O6 M2: the preload sends the machine as the invoke's last argument; none is the local machine.
const invoke = (event: unknown, name: string, input?: unknown, ...machine: [unknown?]) => {
  const handler = electron.handlers.get(`maws:cmd:${name}`);
  if (!handler) throw new Error(`no ipcMain handler for ${name}`);
  return handler(event, input, ...machine);
};

const LIGHT = { settings: { ...SETTINGS_DEFAULTS_V21, theme: 'light' }, resolvedTheme: 'light' } as const;

describe('main ipc router', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await load();
  });

  it('registers one ipcMain handler per command in the registry and nothing else', async () => {
    const { commands } = await import('@shared/ipc/schema');
    expect([...electron.handlers.keys()].sort()).toEqual(Object.keys(commands).map((n) => `maws:cmd:${n}`).sort());
  });

  it('dispatches a valid command from the app window to its main handler', async () => {
    const handler = vi.fn(() => LIGHT);
    router.registerMainHandler('settings.get', handler);
    const event = appWindow();
    await expect(invoke(event, 'settings.get')).resolves.toEqual({ ok: true, value: LIGHT });
    expect(handler).toHaveBeenCalledWith(undefined, { client: expect.objectContaining({ id: `page:${event.sender.id}.1` }), target: LOCAL }); // who asked, for per-client state
  });

  // P5 O6 M2 (OX2): the machine each invoke names
  describe('the machine an invoke names', () => {
    it('treats an invoke that names none, or names the local machine, as the local machine’s', async () => {
      const handler = vi.fn<(input: unknown, context: MainContext) => typeof LIGHT>(() => LIGHT);
      router.registerMainHandler('settings.get', handler);
      const event = appWindow();
      await expect(invoke(event, 'settings.get', undefined)).resolves.toEqual({ ok: true, value: LIGHT });
      await expect(invoke(event, 'settings.get', undefined, LOCAL)).resolves.toEqual({ ok: true, value: LIGHT });
      expect(handler.mock.calls.map(([, context]) => context.target)).toEqual([LOCAL, LOCAL]);
    });

    it('refuses a machine that is not a MachineRef with invalid_input, before the handler', async () => {
      const handler = vi.fn(() => LIGHT);
      router.registerMainHandler('settings.get', handler);
      for (const machine of ['', 'a/b', 42, null]) {
        await expect(invoke(appWindow(), 'settings.get', undefined, machine)).resolves.toMatchObject({ ok: false, error: { code: 'invalid_input' } });
      }
      expect(handler).not.toHaveBeenCalled();
    });

    it('answers a command for another machine host_unavailable until the connection manager reaches it, running no handler', async () => {
      const handler = vi.fn(() => LIGHT);
      router.registerMainHandler('settings.get', handler);
      await expect(invoke(appWindow(), 'settings.get', undefined, OTHER)).resolves.toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
      expect(handler).not.toHaveBeenCalled();
    });

    it('refuses a client command whose ids name another machine before its handler runs, and hands the local one as ctx.target', async () => {
      const handler = vi.fn<(input: unknown, context: MainContext) => { navigate: null }>(() => ({ navigate: null }));
      router.registerMainHandler('attention.pendingNavigate', handler);
      await expect(invoke(appWindow(), 'attention.pendingNavigate', undefined, OTHER)).resolves.toEqual({
        ok: false,
        error: { code: 'host_unavailable', message: 'attention.pendingNavigate: not available for a session on another machine yet' },
      });
      expect(handler).not.toHaveBeenCalled();
      await invoke(appWindow(), 'attention.pendingNavigate', undefined, LOCAL);
      expect(handler.mock.calls.map(([, context]) => context.target)).toEqual([LOCAL]);
    });

    // P5 O6 M3: the connection manager reaches another machine
    it('hands a command for another machine to the connection manager, validated, with the asker and the target, and answers what it answers', async () => {
      const handler = vi.fn(() => ({ sessions: [], revision: 0 }));
      const remote = vi.fn<RemoteDispatch>(async () => ({ ok: true, value: { sessions: [], revision: 7 } }));
      await load(DEV_URL, undefined, remote);
      router.registerMachineHandler('session.list', handler);
      const event = appWindow();
      await expect(invoke(event, 'session.list', {}, OTHER)).resolves.toEqual({ ok: true, value: { sessions: [], revision: 7 } });
      expect(remote).toHaveBeenCalledWith(OTHER, 'session.list', {}, { client: expect.objectContaining({ id: `page:${event.sender.id}.1` }), target: OTHER });
      expect(handler).not.toHaveBeenCalled();
      await expect(invoke(event, 'session.list', { includeArchived: 'yes' }, OTHER)).resolves.toMatchObject({ ok: false, error: { code: 'invalid_input' } });
      expect(remote).toHaveBeenCalledOnce(); // an invalid input never leaves this machine
      await invoke(event, 'session.list', {}, LOCAL);
      expect(handler).toHaveBeenCalledOnce(); // the local machine's stays local
    });

    it('answers internal when the connection manager rejects, and still refuses a client command for another machine itself', async () => {
      const remote = vi.fn<RemoteDispatch>(async () => {
        throw new Error('the manager broke');
      });
      await load(DEV_URL, undefined, remote);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(invoke(appWindow(), 'session.list', {}, OTHER)).resolves.toMatchObject({ ok: false, error: { code: 'internal', message: 'the manager broke' } });
      await expect(invoke(appWindow(), 'attention.pendingNavigate', undefined, OTHER)).resolves.toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
      expect(remote).toHaveBeenCalledOnce();
    });

    it('answers attention.viewing for another machine with no effect', async () => {
      const handler = vi.fn(() => undefined);
      router.registerMainHandler('attention.viewing', handler);
      await expect(invoke(appWindow(), 'attention.viewing', { appSessionId: 'app-1' }, OTHER)).resolves.toEqual({ ok: true, value: undefined });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // P5 O6 M3: the local link's entry (src/main/machines/local-link.ts): the route minus the sender check
  describe('dispatchLocal', () => {
    const remoteClient = { id: 'remote:1/page:3.1', onGone: () => () => {} } as unknown as MainContext['client'];

    it('validates and dispatches with no sender, handing the given client and target to the handler', async () => {
      const handler = vi.fn<(input: unknown, context: unknown) => { sessions: never[]; revision: number }>(() => ({ sessions: [], revision: 3 })); // a machine handler, handed the main context all the same
      router.registerMachineHandler('session.list', handler);
      await expect(router.dispatchLocal('session.list', {}, { client: remoteClient, target: LOCAL })).resolves.toEqual({ ok: true, value: { sessions: [], revision: 3 } });
      expect(handler).toHaveBeenCalledWith({}, { client: remoteClient, target: LOCAL });
      await expect(router.dispatchLocal('session.list', { includeArchived: 1 }, { client: remoteClient, target: LOCAL })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_input' } });
      expect(handler).toHaveBeenCalledOnce();
    });

    it('answers a handler’s CommandFailure with its IpcError, and refuses a main-only command', async () => {
      router.registerMachineHandler('session.list', () => {
        throw new router.CommandFailure({ code: 'timeout', message: 'too slow' });
      });
      await expect(router.dispatchLocal('session.list', {}, { client: remoteClient, target: LOCAL })).resolves.toEqual({ ok: false, error: { code: 'timeout', message: 'too slow' } });
      await expect(router.dispatchLocal('host.configure' as never, {}, { client: remoteClient, target: LOCAL })).resolves.toMatchObject({ ok: false, error: { code: 'forbidden_sender' } });
    });

    it('answers internal before the router is installed', async () => {
      vi.resetModules();
      const fresh = await import('./router');
      await expect(fresh.dispatchLocal('session.list', {}, { client: remoteClient, target: LOCAL })).resolves.toMatchObject({ ok: false, error: { code: 'internal' } });
    });
  });

  // P5 O3-E M2 (docs/doperpowers/plans/2026-10-30-p5-o3-e-checkout.md, Interfaces §D): main's own route, past the
  // main-only refusal a page's call and dispatchLocal meet, through the same owner switch
  describe('invokeOwn', () => {
    const output = { encoding: 'utf8', content: 'x', bytes: 1, offset: 0, length: 1, truncated: false, mime: 'text/plain', hash: null, utf8: null } as const;

    it('answers a main-only machine command through the embedded binding, which a window and dispatchLocal are refused', async () => {
      const { mainClient } = await import('./clients');
      const handler = vi.fn(() => output);
      router.registerMachineHandler('files.readResolved', handler);
      await expect(router.invokeOwn('files.readResolved', { path: '/a/b.txt' }, { client: mainClient, target: LOCAL })).resolves.toEqual({ ok: true, value: output });
      expect(handler).toHaveBeenCalledWith({ path: '/a/b.txt' }, { client: mainClient, target: LOCAL });
      await expect(router.dispatchLocal('files.readResolved', { path: '/a/b.txt' }, { client: mainClient, target: LOCAL })).resolves.toMatchObject({ ok: false, error: { code: 'forbidden_sender' } });
      await expect(invoke(appWindow(), 'files.readResolved', { path: '/a/b.txt' })).resolves.toMatchObject({ ok: false, error: { code: 'forbidden_sender' } });
      expect(handler).toHaveBeenCalledOnce();
      await expect(router.invokeOwn('files.readResolved', { path: 1 }, { client: mainClient, target: LOCAL })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    });

    it('forwards it to the machine host with main’s own client on the host binding', async () => {
      const dispatchToHost = vi.fn<HostDispatch>(async () => ({ ok: true, value: output }));
      vi.resetModules();
      electron.handlers.clear();
      router = await import('./router');
      router.installRouter({ appUrl: DEV_URL, local: LOCAL, dispatchToHost, machine: { kind: 'host' } });
      const { mainClient } = await import('./clients');
      await expect(router.invokeOwn('files.readResolved', { path: '/a/b.txt' }, { client: mainClient, target: LOCAL })).resolves.toEqual({ ok: true, value: output });
      expect(dispatchToHost).toHaveBeenCalledWith('machine', 'files.readResolved', { path: '/a/b.txt' }, mainClient);
    });
  });

  // P5 O5 M4 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, "One answerer, both directions"): on the host binding,
  // artifacts.export is answered by the root's own registration while the attached daemon does not render, and forwarded
  // once it does; no other machine command moves
  describe('artifacts.export’s local fallback on an older daemon', () => {
    const ARTIFACT = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f';
    const exported = { path: '/p/artifacts/x/exports/2.pdf', revision: 2 };
    const listed = { encoding: 'utf8', content: 'x', bytes: 1, offset: 0, length: 1, truncated: false, mime: 'text/plain', hash: null, utf8: null } as const;

    it('answers it in main while the daemon does not render, forwards it once it does, and forwards every other machine command throughout', async () => {
      const dispatchToHost = vi.fn<HostDispatch>(async (_owner, name) => ({ ok: true, value: name === 'artifacts.export' ? { ...exported, revision: 3 } : listed }));
      let renders = false;
      vi.resetModules();
      electron.handlers.clear();
      router = await import('./router');
      router.installRouter({ appUrl: DEV_URL, local: LOCAL, dispatchToHost, machine: { kind: 'host', daemonRenders: () => renders } });
      const local = vi.fn(() => exported);
      router.registerMachineHandler('artifacts.export', local);
      const { mainClient } = await import('./clients');
      const ctx = { client: mainClient, target: LOCAL };
      await expect(router.invokeOwn('artifacts.export', { artifactId: ARTIFACT, format: 'pdf', dialect: 'notion' }, ctx)).resolves.toEqual({ ok: true, value: exported });
      expect(local).toHaveBeenCalledWith({ artifactId: ARTIFACT, format: 'pdf', dialect: 'notion' }, ctx);
      await expect(router.invokeOwn('files.readResolved', { path: '/a/b.txt' }, ctx)).resolves.toEqual({ ok: true, value: listed });
      expect(dispatchToHost).toHaveBeenCalledOnce();
      expect(dispatchToHost).toHaveBeenCalledWith('machine', 'files.readResolved', { path: '/a/b.txt' }, mainClient);

      renders = true;
      await expect(router.invokeOwn('artifacts.export', { artifactId: ARTIFACT, format: 'pdf' }, ctx)).resolves.toEqual({ ok: true, value: { ...exported, revision: 3 } });
      expect(dispatchToHost).toHaveBeenLastCalledWith('machine', 'artifacts.export', { artifactId: ARTIFACT, format: 'pdf' }, mainClient);
      expect(local).toHaveBeenCalledOnce();
    });
  });

  it('hands a handler the asking page instance’s ClientRef: the same one per page, a new one after a reload', async () => {
    const { pageOf } = await import('./clients');
    const handler = vi.fn<(input: unknown, context: MainContext) => typeof LIGHT>(() => LIGHT);
    router.registerMainHandler('settings.get', handler);
    const event = appWindow();
    await invoke(event, 'settings.get');
    await invoke(event, 'settings.get');
    const [first, second] = handler.mock.calls.map(([, context]) => context.client);
    expect(second).toBe(first);
    expect(pageOf(first!)).toBe(event.sender);
    const gone = vi.fn();
    first!.onGone(gone);
    event.sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    expect(gone).toHaveBeenCalledOnce();
    await invoke(event, 'settings.get');
    expect(handler.mock.calls[2]![1].client.id).toBe(`page:${event.sender.id}.2`);
    expect(handler).not.toHaveBeenCalledWith(undefined, expect.objectContaining({ sender: expect.anything() })); // never the WebContents itself
  });

  it('answers settings.set({ theme: "sepia" }) with invalid_input and never calls the handler', async () => {
    const handler = vi.fn(() => LIGHT);
    router.registerMainHandler('settings.set', handler);
    const result = await invoke(appWindow(), 'settings.set', { theme: 'sepia' });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input', issues: [{ path: ['theme'] }] } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses an invoke from a frame whose URL origin is not the app’s with forbidden_sender', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handler = vi.fn(() => LIGHT);
    router.registerMainHandler('settings.get', handler);
    const result = await invoke(appWindow('https://evil.example/'), 'settings.get');
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden_sender' } });
    expect(handler).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('refuses a subframe of the app window, a frame gone before dispatch, and a sender that is not a window', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    router.registerMainHandler('settings.get', () => LIGHT);
    const top = appWindow();
    const subframe = { sender: top.sender, senderFrame: { url: DEV_URL, parent: top.senderFrame } };
    const gone = { sender: top.sender, senderFrame: null };
    const stray = { sender: {}, senderFrame: { url: DEV_URL, parent: null } };
    for (const event of [subframe, gone, stray]) {
      await expect(invoke(event, 'settings.get')).resolves.toMatchObject({ ok: false, error: { code: 'forbidden_sender' } });
    }
  });

  it('accepts file: frames in production and refuses the dev origin there', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await load('file:///Applications/MAWS.app/Contents/Resources/app.asar/out/renderer/index.html');
    router.registerMainHandler('settings.get', () => LIGHT);
    const packaged = appWindow('file:///Applications/MAWS.app/Contents/Resources/app.asar/out/renderer/index.html');
    await expect(invoke(packaged, 'settings.get')).resolves.toEqual({ ok: true, value: LIGHT });
    await expect(invoke(appWindow(DEV_URL), 'settings.get')).resolves.toMatchObject({ error: { code: 'forbidden_sender' } });
  });

  it('answers host-owned commands with host_unavailable when no supervisor is passed', async () => {
    await expect(invoke(appWindow(), 'engine.ping')).resolves.toMatchObject({
      ok: false,
      error: { code: 'host_unavailable' },
    });
    await expect(invoke(appWindow(), 'pty.write', { ptyId: 'p1', data: 'x' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'host_unavailable' },
    });
  });

  it('refuses main-only engine configuration even from the app top frame, before interception or host dispatch', async () => {
    const dispatch = vi.fn(async () => ({ ok: true as const, value: undefined }));
    await load(DEV_URL, dispatch);
    const intercept = vi.fn();
    router.interceptCommand('engine.configure', intercept);
    await expect(invoke(appWindow(), 'engine.configure', { binaryPath: '/tmp/other-engine' })).resolves.toMatchObject({
      ok: false, error: { code: 'forbidden_sender' },
    });
    await expect(invoke(appWindow(), 'engine.policy.set', { enabled: true, limitKiB: 1024, statefulMcpServers: [] })).resolves.toMatchObject({
      ok: false, error: { code: 'forbidden_sender' },
    });
    expect(intercept).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    const { isBridgedCommandName } = await import('@shared/ipc/names');
    expect(isBridgedCommandName('engine.configure')).toBe(false);
  });

  // P3-F (artifact-protocol finding 6): the answer to the host's export request is main's export service's alone, so a
  // window that saw the request cannot settle it first
  it('refuses a window’s maws.artifact.exported before host dispatch', async () => {
    const dispatch = vi.fn<HostDispatch>(async () => ({ ok: true, value: { outcome: 'delivered' } }));
    await load(DEV_URL, dispatch);
    const fabricated = { appSessionId: 'app-1', requestId: 'mcp-export', answer: { ok: false, error: 'fabricated' } };
    await expect(invoke(appWindow(), 'maws.artifact.exported', fabricated)).resolves.toMatchObject({ ok: false, error: { code: 'forbidden_sender' } });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('hands a host dispatcher the owner, the name and the validated input', async () => {
    const dispatch = vi.fn(async () => ({ ok: true as const, value: { pid: 7, uptimeMs: 1, hostVersion: '0' } }));
    await load(DEV_URL, dispatch);
    await expect(invoke(appWindow(), 'engine.ping')).resolves.toEqual({
      ok: true,
      value: { pid: 7, uptimeMs: 1, hostVersion: '0' },
    });
    const spawn = { appSessionId: 'a1', label: 'terminal-1', cwd: '/', cols: 80, rows: 24 };
    await invoke(appWindow(), 'pty.spawn', spawn);
    expect(dispatch.mock.calls).toEqual([
      ['engine-host', 'engine.ping', undefined],
      ['pty-host', 'pty.spawn', spawn],
    ]);
  });

  it('answers internal, and logs, when the host dispatcher rejects instead of answering', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await load(DEV_URL, async () => {
      throw new Error('port closed');
    });
    await expect(invoke(appWindow(), 'engine.ping')).resolves.toEqual({
      ok: false,
      error: { code: 'internal', message: 'port closed' },
    });
    expect(log).toHaveBeenCalledOnce();
  });

  it('answers internal when a main-owned command has no handler yet', async () => {
    await expect(invoke(appWindow(), 'engine.hostState')).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal', message: 'no main handler registered for engine.hostState' },
    });
  });

  it('answers internal, and logs, when a handler throws', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    router.registerMainHandler('settings.get', () => {
      throw new Error('disk on fire');
    });
    await expect(invoke(appWindow(), 'settings.get')).resolves.toEqual({
      ok: false,
      error: { code: 'internal', message: 'disk on fire' },
    });
    expect(log).toHaveBeenCalledOnce();
  });

  // C4 (M5): session.replay.start fails with the host dispatch's own error (a `timeout` is not an `internal`).
  it('answers the IpcError a handler fails with through CommandFailure, code and all, without logging it as a fault', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    router.registerMainHandler('settings.get', () => {
      throw new router.CommandFailure({ code: 'timeout', message: 'engine-host did not answer session.replay.launch within 10 s' });
    });
    await expect(invoke(appWindow(), 'settings.get')).resolves.toEqual({
      ok: false,
      error: { code: 'timeout', message: 'engine-host did not answer session.replay.launch within 10 s' },
    });
    expect(log).not.toHaveBeenCalled();
  });
  // end C4

  // C9 block begin: pty.openLink, main-owned, through the one scheme-checked shell.openExternal
  it('opens an http(s) or mailto link from pty.openLink and refuses any other scheme with opened false', async () => {
    (await import('../pty-links')).registerPtyOpenLink(); // against the router module load() just imported
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(invoke(appWindow(), 'pty.openLink', { url: 'https://example.com/a?b=1' })).resolves.toEqual({ ok: true, value: { opened: true } });
    await expect(invoke(appWindow(), 'pty.openLink', { url: 'mailto:owner@example.com' })).resolves.toEqual({ ok: true, value: { opened: true } });
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'x-apple.systempreferences:com.apple.preference']) {
      await expect(invoke(appWindow(), 'pty.openLink', { url })).resolves.toEqual({ ok: true, value: { opened: false } });
    }
    expect(electron.opened).toEqual(['https://example.com/a?b=1', 'mailto:owner@example.com']);
    expect(warn).toHaveBeenCalledTimes(3);
  });
  // C9 block end

  it('refuses a handler for a host-owned command or a second handler for the same command', () => {
    expect(() => router.registerMainHandler('engine.ping' as never, () => ({}) as never)).toThrow(
      'engine.ping is owned by engine-host, not main',
    );
    router.registerMainHandler('settings.get', () => LIGHT);
    expect(() => router.registerMainHandler('settings.get', () => LIGHT)).toThrow('already registered');
  });

  // P5 O1 M5: the router reads "bridged" as the registry's commands less `mainOnly`; for production that is exactly the
  // preload's bridged set
  it('treats as bridged exactly the names the preload bridges', async () => {
    const { REGISTRY } = await import('@shared/ipc/registry');
    const { isBridgedCommandName } = await import('@shared/ipc/names');
    const bridged = Object.keys(REGISTRY.commands).filter((name) => !REGISTRY.mainOnly.has(name));
    expect(bridged.sort()).toEqual(Object.keys(REGISTRY.commands).filter(isBridgedCommandName).sort());
  });

  // P5 O1 M5 (machine-forward.test.ts drives a fixture namespace); P5 O3-D M1: the spine's commands are `machine`-owned
  it('refuses a machine handler for a command not owned by machine, and a main handler for one that is', () => {
    expect(() => router.registerMainHandler('session.list', () => ({ sessions: [], revision: 0 }))).toThrow('session.list is owned by machine, not main');
    expect(() => router.registerMachineHandler('settings.get', () => LIGHT)).toThrow('settings.get is owned by main, not machine');
    expect(() => router.registerMachineHandler('engine.ping', () => ({}) as never)).toThrow('engine.ping is owned by engine-host, not machine');
  });

  // P5 O3-D M1 (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §I): the spine's commands retagged
  // `machine` are answered by the embedded binding on either shape until M5, each output checked as a host runtime checks
  // it before answering
  describe('the embedded machine binding over a retagged command', () => {
    it('answers session.list through its machine handler, with the asker and the local machine', async () => {
      const handler = vi.fn(() => ({ sessions: [], revision: 4 }));
      router.registerMachineHandler('session.list', handler);
      const event = appWindow();
      await expect(invoke(event, 'session.list', { includeArchived: true })).resolves.toEqual({ ok: true, value: { sessions: [], revision: 4 } });
      expect(handler).toHaveBeenCalledWith({ includeArchived: true }, { client: expect.objectContaining({ id: `page:${event.sender.id}.1` }), target: LOCAL });
    });

    it('answers internal, and logs, when the handler’s output fails the registry, as a host runtime would', async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      router.registerMachineHandler('session.list', () => ({ sessions: [], revision: 'four' }) as never);
      await expect(invoke(appWindow(), 'session.list', {})).resolves.toMatchObject({ ok: false, error: { code: 'internal' } });
      expect(log).toHaveBeenCalledWith('[ipc] session.list produced an invalid output', expect.any(Array));
    });

    it('answers internal for a retagged command with no handler, as for any machine command', async () => {
      await expect(invoke(appWindow(), 'session.get', { appSessionId: 'app-1' })).resolves.toEqual({ ok: false, error: { code: 'internal', message: 'no machine handler registered for session.get' } });
    });
  });

  // P5 O3-D M1 (Interfaces §I): what only main or mawsd sends is refused from a window before any handler or host
  it('refuses a window every command O3-D makes main-only, before any handler or host dispatch', async () => {
    const dispatch = vi.fn<HostDispatch>(async () => ({ ok: true, value: undefined }));
    await load(DEV_URL, dispatch);
    const names = ['session.follow', 'session.visible', 'library.fileLinkedPaths', 'machine.client', 'clientPort.answer', 'machine.op', 'machine.opQuery', 'host.attachment', 'fs.scan', 'fs.bind', 'fs.unbind', 'maws.artifact.captured', 'maws.download.recorded'];
    const { isBridgedCommandName } = await import('@shared/ipc/names');
    for (const name of names) {
      expect(isBridgedCommandName(name), `${name} is bridged by the preload`).toBe(false);
      await expect(invoke(appWindow(), name, {}), name).resolves.toEqual({ ok: false, error: { code: 'forbidden_sender', message: `${name} may only be invoked by main` } });
    }
    expect(dispatch).not.toHaveBeenCalled();
  });

  describe('interceptCommand (C5 stub source seam)', () => {
    it('is consulted before the handler for exactly the intercepted name, and removed by its disposer', async () => {
      const machine = vi.fn(() => ({ digests: [] }));
      const stub = vi.fn(() => ({ sessions: [], revision: 7 }));
      router.registerMachineHandler('session.digests', machine); // P5 O3-D M1: the spine's, `machine`-owned
      const dispose = router.interceptCommand('session.list', stub);
      await expect(invoke(appWindow(), 'session.list', {})).resolves.toEqual({ ok: true, value: { sessions: [], revision: 7 } });
      await expect(invoke(appWindow(), 'session.digests')).resolves.toEqual({ ok: true, value: { digests: [] } });
      expect(stub).toHaveBeenCalledWith({}, { client: expect.objectContaining({ id: expect.stringMatching(/^page:\d+\.1$/) }), target: LOCAL });
      dispose();
      await expect(invoke(appWindow(), 'session.list', {})).resolves.toMatchObject({ ok: false, error: { code: 'internal' } });
    });

    it('shadows a registered handler and the host dispatcher alike', async () => {
      const host = vi.fn(async () => ({ ok: true as const, value: { outcome: 'not_pending' as const } }));
      await load(DEV_URL, host);
      router.interceptCommand('session.answer', () => ({ outcome: 'delivered' }));
      const answer = { kind: 'permission', decision: 'allow', scope: 'once' };
      await expect(invoke(appWindow(), 'session.answer', { appSessionId: 'a', requestId: 'r', answer })).resolves.toEqual({
        ok: true,
        value: { outcome: 'delivered' },
      });
      expect(host).not.toHaveBeenCalled();
      const handler = vi.fn(() => ({ sessions: [], revision: 0 }));
      router.registerMachineHandler('session.list', handler);
      router.interceptCommand('session.list', () => ({ sessions: [], revision: 9 }));
      await expect(invoke(appWindow(), 'session.list', {})).resolves.toMatchObject({ value: { revision: 9 } });
      expect(handler).not.toHaveBeenCalled();
    });

    it('still checks the sender and the input first', async () => {
      const stub = vi.fn(() => ({ sessions: [], revision: 0 }));
      router.interceptCommand('session.list', stub);
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await expect(invoke(appWindow('https://evil.example/'), 'session.list', {})).resolves.toMatchObject({ error: { code: 'forbidden_sender' } });
      await expect(invoke(appWindow(), 'session.list', { includeArchived: 'yes' })).resolves.toMatchObject({ error: { code: 'invalid_input' } });
      expect(stub).not.toHaveBeenCalled();
    });

    it('refuses a second interceptor for the same name', () => {
      router.interceptCommand('attention.list', () => []);
      expect(() => router.interceptCommand('attention.list', () => [])).toThrow('already intercepted');
    });
  });
});
