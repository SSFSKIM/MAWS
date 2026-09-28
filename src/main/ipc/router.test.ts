import { beforeEach, describe, expect, it, vi } from 'vitest';

// Electron is faked: `ipcMain.handle` records one handler per channel, and each fake window is the one whose
// webContents the fake event names as its sender.
const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>(),
  windows: new Map<object, { webContents: { mainFrame: object } }>(),
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, input: unknown) => Promise<unknown>) => {
      if (electron.handlers.has(channel)) throw new Error(`second handler for ${channel}`);
      electron.handlers.set(channel, handler);
    },
  },
  BrowserWindow: { fromWebContents: (webContents: object) => electron.windows.get(webContents) ?? null },
}));

const DEV_URL = 'http://localhost:5173/';

function appWindow(url = DEV_URL) {
  const mainFrame = { url, parent: null };
  const webContents = { mainFrame };
  electron.windows.set(webContents, { webContents });
  return { sender: webContents, senderFrame: mainFrame };
}

type Router = typeof import('./router');
let router: Router;

async function load(appUrl = DEV_URL, dispatchToHost?: Parameters<Router['installRouter']>[0]['dispatchToHost']) {
  vi.resetModules();
  electron.handlers.clear();
  electron.windows.clear();
  router = await import('./router');
  router.installRouter({ appUrl, dispatchToHost });
}

const invoke = (event: unknown, name: string, input?: unknown) => {
  const handler = electron.handlers.get(`maws:cmd:${name}`);
  if (!handler) throw new Error(`no ipcMain handler for ${name}`);
  return handler(event, input);
};

const LIGHT = { settings: { version: 1, theme: 'light' }, resolvedTheme: 'light' } as const;

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
    await expect(invoke(appWindow(), 'settings.get')).resolves.toEqual({ ok: true, value: LIGHT });
    expect(handler).toHaveBeenCalledWith(undefined);
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

  it('routes host-owned commands to the host dispatcher, which answers host_unavailable until M4', async () => {
    await expect(invoke(appWindow(), 'engine.ping')).resolves.toMatchObject({
      ok: false,
      error: { code: 'host_unavailable' },
    });
    await expect(invoke(appWindow(), 'pty.write', { ptyId: 'p1', data: 'x' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'host_unavailable' },
    });
  });

  it('hands a host dispatcher the owner, the name and the validated input', async () => {
    const dispatch = vi.fn(async () => ({ ok: true as const, value: { pid: 7, uptimeMs: 1, hostVersion: '0' } }));
    await load(DEV_URL, dispatch);
    await expect(invoke(appWindow(), 'engine.ping')).resolves.toEqual({
      ok: true,
      value: { pid: 7, uptimeMs: 1, hostVersion: '0' },
    });
    await invoke(appWindow(), 'pty.spawn', { cwd: '/', cols: 80, rows: 24 });
    expect(dispatch.mock.calls).toEqual([
      ['engine-host', 'engine.ping', undefined],
      ['pty-host', 'pty.spawn', { cwd: '/', cols: 80, rows: 24 }],
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

  it('refuses a handler for a host-owned command or a second handler for the same command', () => {
    expect(() => router.registerMainHandler('engine.ping' as never, () => ({}) as never)).toThrow(
      'engine.ping is owned by engine-host, not main',
    );
    router.registerMainHandler('settings.get', () => LIGHT);
    expect(() => router.registerMainHandler('settings.get', () => LIGHT)).toThrow('already registered');
  });
});
