import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_DEFAULTS_V4 } from '@shared/settings/defaults';

// Electron is faked: `ipcMain.handle` records one handler per channel, and each fake window is the one whose
// webContents the fake event names as its sender.
const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>(),
  windows: new Map<object, { webContents: { mainFrame: object } }>(),
  opened: [] as string[], // C9: what `shell.openExternal` was asked to open
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, input: unknown) => Promise<unknown>) => {
      if (electron.handlers.has(channel)) throw new Error(`second handler for ${channel}`);
      electron.handlers.set(channel, handler);
    },
  },
  BrowserWindow: { fromWebContents: (webContents: object) => electron.windows.get(webContents) ?? null },
  shell: { openExternal: async (url: string) => void electron.opened.push(url) },
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
  electron.opened.length = 0;
  router = await import('./router');
  router.installRouter({ appUrl, dispatchToHost });
}

const invoke = (event: unknown, name: string, input?: unknown) => {
  const handler = electron.handlers.get(`maws:cmd:${name}`);
  if (!handler) throw new Error(`no ipcMain handler for ${name}`);
  return handler(event, input);
};

const LIGHT = { settings: { ...SETTINGS_DEFAULTS_V4, theme: 'light' }, resolvedTheme: 'light' } as const;

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
    expect(handler).toHaveBeenCalledWith(undefined, { sender: event.sender }); // the requesting window, for per-window state
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

  describe('interceptCommand (C5 stub source seam)', () => {
    it('is consulted before the main handler for exactly the intercepted name, and removed by its disposer', async () => {
      const main = vi.fn(() => ({ digests: [] }));
      const stub = vi.fn(() => ({ sessions: [], revision: 7 }));
      router.registerMainHandler('session.digests', main);
      const dispose = router.interceptCommand('session.list', stub);
      await expect(invoke(appWindow(), 'session.list', {})).resolves.toEqual({ ok: true, value: { sessions: [], revision: 7 } });
      await expect(invoke(appWindow(), 'session.digests')).resolves.toEqual({ ok: true, value: { digests: [] } });
      expect(stub).toHaveBeenCalledWith({}, { sender: expect.anything() });
      dispose();
      await expect(invoke(appWindow(), 'session.list', {})).resolves.toMatchObject({ ok: false, error: { code: 'internal' } });
    });

    it('shadows a registered main handler and the host dispatcher alike', async () => {
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
      router.registerMainHandler('session.list', handler);
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
