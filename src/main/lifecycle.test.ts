import { beforeAll, describe, expect, it, vi } from 'vitest';

// Loads the real `src/main/index.ts` against a fake Electron `app` that records its listeners, with the modules it
// wires (hosts, router, settings, window) replaced, so what is under test is the app lifecycle alone.
const fake = vi.hoisted(() => {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const windows: object[] = [];
  const hosts = { start: vi.fn(async () => {}), stop: vi.fn(), dispatch: vi.fn() };
  const app = {
    on(event: string, listener: (...args: unknown[]) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return app;
    },
    whenReady: () => Promise.resolve(),
    getPath: () => '/tmp/maws-lifecycle-test',
    isPackaged: false,
    setPath: vi.fn(),
    commandLine: { appendSwitch: vi.fn() },
    quit: vi.fn(),
    exit: vi.fn(),
  };
  const emit = (event: string) => (listeners.get(event) ?? []).forEach((listener) => listener());
  return { listeners, windows, hosts, app, emit, createWindow: vi.fn(() => void windows.push({})) };
});

vi.mock('electron', () => {
  const display = { workArea: { x: 0, y: 0, width: 1440, height: 900 } };
  return {
    app: fake.app,
    BrowserWindow: { getAllWindows: () => fake.windows },
    screen: { getAllDisplays: () => [display], getPrimaryDisplay: () => display },
  };
});
vi.mock('./hosts', () => ({ createHosts: () => fake.hosts }));
vi.mock('./ipc/router', () => ({ installRouter: vi.fn(), registerMainHandler: vi.fn() /* C3 */ }));
// C3 start: main's attention service and its store, started from index.ts, are replaced like the other wired modules
vi.mock('./attention/service', () => ({ startAttentionService: vi.fn() }));
vi.mock('./attention/file-attention-store', () => ({ FileAttentionStore: vi.fn() }));
// C3 end
vi.mock('./settings', () => ({ startSettings: () => ({ state: () => ({ resolvedTheme: 'light' }) }) }));
vi.mock('./window', () => ({ appUrl: 'file:///index.html', createWindow: fake.createWindow, installContentSecurityPolicy: vi.fn() }));
// C4: the index and its session source are replaced too; the lifecycle only has to open, start and close them.
const c4 = vi.hoisted(() => ({ close: vi.fn(), stopSource: vi.fn(), stopAttention: vi.fn(), started: 0 }));
vi.mock('./index/index', () => ({ Index: class { close = c4.close; } }));
vi.mock('./index/register', () => ({ registerIndexHandlers: vi.fn() }));
vi.mock('./index/source', () => ({ IndexSessionSource: class { start = () => ((c4.started += 1), c4.stopSource); } }));
vi.mock('./index/attention-service', () => ({ startIndexAttention: () => ({ stop: c4.stopAttention }) })); // C3's service over the index
vi.mock('./ipc/events', () => ({ emit: vi.fn() }));
vi.mock('./index/replay', () => ({ registerReplayHandlers: () => ({ dispose: vi.fn() }) }));
vi.mock('./index/replay-fixtures', () => ({ appRoot: (path: string) => path, seedReplayFixtures: vi.fn() }));
const git = vi.hoisted(() => ({ dispose: vi.fn(), registered: 0 }));
vi.mock('./git/service', () => ({ GitService: class { dispose = git.dispose; } }));
vi.mock('./git/register', () => ({ registerGitHandlers: () => void (git.registered += 1) }));
// end C4
// C5 start: the layout store, the external-link command and the read side
vi.mock('./layout/store', () => ({ LayoutFileStore: class { flush() {} get() { return null; } set() {} }, registerLayoutHandlers: vi.fn(), dropPanelKeysOfRemovedSessions: vi.fn() }));
vi.mock('./open-external', () => ({ registerOpenExternal: vi.fn() }));
// The read model starts C4's index source and stops it with the sessions, at will-quit.
vi.mock('./sessions', () => ({
  startSessions: ({ indexSource }: { indexSource: { start(writer: unknown): () => void } }) => ({ model: {}, stop: indexSource.start({}) }),
}));
vi.mock('./menu', () => ({ startMenu: vi.fn(), registerMenuHandlers: vi.fn() }));
vi.mock('./window-state', () => ({ restoreWindowState: vi.fn(() => null), trackWindowState: vi.fn() }));
vi.mock('./attention', () => ({ startAttention: vi.fn() }));
vi.mock('./lifecycle/quit-guard', () => ({ installQuitGuard: vi.fn(), askToQuit: vi.fn() }));
// C5 end

beforeAll(async () => {
  await import('./index');
  await Promise.resolve(); // let `whenReady().then(...)` run
});

describe('app lifecycle (macOS, D-11)', () => {
  it('keeps the app, its hosts and their ptys running when the last window closes', () => {
    // Electron quits when the last window closes unless a `window-all-closed` listener exists.
    expect(fake.listeners.get('window-all-closed')).toHaveLength(1);
    fake.windows.length = 0;
    fake.emit('window-all-closed');
    expect(fake.app.quit).not.toHaveBeenCalled();
    expect(fake.app.exit).not.toHaveBeenCalled();
    expect(fake.hosts.stop).not.toHaveBeenCalled();
  });

  it('re-creates the window on activate when none is open, and not otherwise', () => {
    fake.windows.length = 0;
    const created = fake.createWindow.mock.calls.length;
    fake.emit('activate');
    expect(fake.createWindow).toHaveBeenCalledTimes(created + 1);
    fake.emit('activate');
    expect(fake.createWindow).toHaveBeenCalledTimes(created + 1);
  });

  it('stops the hosts on will-quit', () => {
    fake.emit('will-quit');
    expect(fake.hosts.stop).toHaveBeenCalledOnce();
    // C4: the session source was started at ready and stops, with the index closed, at will-quit.
    expect(c4.started).toBe(1);
    expect(c4.stopSource).toHaveBeenCalledOnce();
    expect(c4.close).toHaveBeenCalledOnce();
    expect(c4.stopAttention).toHaveBeenCalledOnce();
    // M6: the git service's handlers were registered at ready, and its watches close at will-quit.
    expect(git.registered).toBe(1);
    expect(git.dispose).toHaveBeenCalledOnce();
    // end C4
  });
});
