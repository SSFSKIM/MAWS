import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Loads the real `src/main/index.ts` against a fake Electron `app` that records its listeners, with the modules it
// wires (hosts, router, settings, window) replaced, so what is under test is the app lifecycle alone.
const fake = vi.hoisted(() => {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const windows: object[] = [];
  const hosts = { start: vi.fn(async () => {}), stop: vi.fn(), dispatch: vi.fn() };
  const appPath = `/tmp/maws-lifecycle-test-app-${process.pid}`;
  const app = {
    on(event: string, listener: (...args: unknown[]) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return app;
    },
    whenReady: () => Promise.resolve(),
    requestSingleInstanceLock: () => true,
    hasSingleInstanceLock: () => true,
    getPath: () => '/tmp/maws-lifecycle-test',
    getAppPath: () => appPath, // E11 F2b: where the development build of main is read from (`out/main/index.js`)
    isPackaged: false,
    setPath: vi.fn(),
    commandLine: { appendSwitch: vi.fn() },
    quit: vi.fn(),
    exit: vi.fn(),
  };
  const emit = (event: string) => (listeners.get(event) ?? []).forEach((listener) => listener());
  return { listeners, windows, hosts, app, appPath, emit, createWindow: vi.fn(() => void windows.push({})), showMessageBox: vi.fn(async () => ({ response: 1 })) };
});

vi.mock('electron', () => {
  const display = { workArea: { x: 0, y: 0, width: 1440, height: 900 } };
  return {
    app: fake.app,
    BrowserWindow: { getAllWindows: () => fake.windows },
    dialog: { showMessageBox: fake.showMessageBox }, // E11 F2b
    screen: { getAllDisplays: () => [display], getPrimaryDisplay: () => display },
  };
});
vi.mock('./hosts', () => ({ createHosts: () => fake.hosts }));
vi.mock('./windows', () => ({ appWindows: () => fake.windows })); // E2: the app-window registry `activate` reads
vi.mock('./deliverables', () => ({ registerDeliverableScheme: vi.fn(), startDeliverables: () => ({ reader: {}, stop: vi.fn() }) })); // E2: the store's main side
vi.mock('./browser', () => ({ startBrowser: () => ({ stop: vi.fn(), partitions: {} /* E4b */ }) })); // E4a: the in-app browser's main side
vi.mock('./artifacts', () => ({ startArtifacts: () => ({ stop: vi.fn() }) })); // P3-A: the artifact store's main side
vi.mock('./browser/import', () => ({ ImportedProfiles: { open: () => ({ list: () => [] }) }, sweepBrowserImports: vi.fn(), startBrowserImport: () => ({ stop: vi.fn() }) })); // E4b: the Chrome import's main side
vi.mock('./ipc/router', () => ({ installRouter: vi.fn(), registerMainHandler: vi.fn() /* C3 */, interceptCommand: vi.fn(), CommandFailure: Error /* C11 */ }));
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
vi.mock('./ipc/events', () => ({ emit: vi.fn(), onEmitted: vi.fn(() => () => {}) })); // onEmitted: git.lsFiles' root set (C7 block)
vi.mock('./index/replay', () => ({ registerReplayHandlers: () => ({ dispose: vi.fn() }) }));
vi.mock('./index/replay-fixtures', () => ({ appRoot: (path: string) => path, seedReplayFixtures: vi.fn() }));
const git = vi.hoisted(() => ({ dispose: vi.fn(), registered: 0 }));
vi.mock('./git/service', () => ({ GitService: class { dispose = git.dispose; } }));
vi.mock('./git/register', () => ({ registerGitHandlers: () => void (git.registered += 1) }));
// end C4
// C5 start: the layout store, the external-link command and the read side
vi.mock('./layout/store', () => ({ LayoutFileStore: class { flush() {} get() { return null; } set() {} }, registerLayoutHandlers: vi.fn(), dropPanelKeysOfRemovedSessions: vi.fn() }));
vi.mock('./sessions/panel-lifetime', () => ({ registerChatPanels: () => () => {} }));
vi.mock('./open-external', () => ({ registerOpenExternal: vi.fn() }));
// The read model starts C4's index source and stops it with the sessions, at will-quit.
vi.mock('./sessions', () => ({
  startSessions: ({ indexSource }: { indexSource: { start(writer: unknown): () => void } }) => ({ model: {}, stop: indexSource.start({}) }),
}));
vi.mock('./menu', () => ({ startMenu: vi.fn(), registerMenuHandlers: vi.fn() }));
vi.mock('./window-state', () => ({ restoreWindowState: vi.fn(() => null), trackWindowState: vi.fn() }));
vi.mock('./attention', () => ({ startAttention: vi.fn() }));
vi.mock('./lifecycle/quit-guard', () => ({ installQuitGuard: vi.fn(), askToQuit: vi.fn(), listProcesses: vi.fn(), trackUnsavedFiles: vi.fn(() => ({})) /* E5 */ }));
// C5 end
// C10 start: the session service (and the login-shell capture it reads the engine's environment from) is replaced; the
// lifecycle only has to construct, register and start it without a real shell or index
const c10 = vi.hoisted(() => ({ started: 0 }));
vi.mock('@shared/host/shell-env', () => ({ captureShellEnvironment: () => Promise.resolve({}) }));
vi.mock('./sessions/service', () => ({ SessionService: class { start = async () => void (c10.started += 1); } }));
vi.mock('./sessions/service-register', () => ({ registerSessionServiceHandlers: vi.fn(), engineHostSettled: vi.fn() }));
vi.mock('./sessions/yield', () => ({ startYield: () => () => {} })); // W7
vi.mock('./side/side-threads', () => ({ startSideThreads: () => () => {}, sideThreadEvents: () => [] })); // E3
// C10 end
// C11 start: the engine host's binary configuration follows the settings, which this test replaces
vi.mock('./settings/engine-configure', () => ({ startEngineConfigure: () => ({ stop: () => {} }) })); // C12: the coordinator
vi.mock('./settings/host-configure', () => ({ startHostConfigure: () => () => {} })); // E10: its sibling
vi.mock('./widgets/fixture-backend', () => ({ installWidgetBackend: () => null })); // the widget e2e's stand-in, off here
// C11 end

beforeAll(async () => {
  // E11 §2.7: electron.vite.config.ts defines main's build stamp for its bundle; vitest does not
  vi.stubGlobal('__MAWS_VERSION__', '0.0.0');
  vi.stubGlobal('__MAWS_BUILD__', { commit: 'test0000', builtAt: '2026-10-08T00:00:00.000Z' });
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

  // E11 F2b (plan 2.7b; the owner's actual case): opening the app after a rebuild activates this process; main's bundle
  // on disk written after it started is a newer build, said once per build on disk, and Keep running keeps it running
  it('on activate, a build of main on disk newer than this process offers to quit, once per build on disk', async () => {
    const before = fake.showMessageBox.mock.calls.length;
    fake.emit('activate');
    expect(fake.showMessageBox, 'the bundle it started from (none here) says nothing').toHaveBeenCalledTimes(before);
    const bundle = join(fake.appPath, 'out/main/index.js');
    mkdirSync(dirname(bundle), { recursive: true });
    writeFileSync(bundle, '// rebuilt\n');
    const later = new Date(Date.now() + 3_600_000);
    utimesSync(bundle, later, later);
    try {
      fake.emit('activate');
      expect(fake.showMessageBox).toHaveBeenCalledTimes(before + 1);
      const [, options] = fake.showMessageBox.mock.calls.at(-1) as unknown as [unknown, { message: string; buttons: string[] }];
      expect(options.message).toMatch(/^An older MAWS is running, built .+; the build on disk is newer; quit to use it$/);
      expect(options.buttons).toEqual(['Quit MAWS', 'Keep running']);
      await Promise.resolve();
      expect(fake.app.quit, 'Keep running').not.toHaveBeenCalled();
      fake.emit('activate');
      expect(fake.showMessageBox, 'the same build on disk is said once').toHaveBeenCalledTimes(before + 1);
    } finally {
      rmSync(fake.appPath, { recursive: true, force: true });
    }
  });

  it('stops the hosts on will-quit', () => {
    fake.emit('will-quit');
    expect(fake.hosts.stop).toHaveBeenCalledOnce();
    // C4: the session source was started at ready and stops, with the index closed, at will-quit.
    expect(c4.started).toBe(1);
    expect(c4.stopSource).toHaveBeenCalledOnce();
    expect(c4.close).toHaveBeenCalledOnce();
    // The source reads the index, so it stops (C5's sessions.stop) before the index closes.
    expect(c4.stopSource.mock.invocationCallOrder[0]).toBeLessThan(c4.close.mock.invocationCallOrder[0]);
    expect(c4.stopAttention).toHaveBeenCalledOnce();
    // M6: the git service's handlers were registered at ready, and its watches close at will-quit.
    expect(git.registered).toBe(1);
    expect(git.dispose).toHaveBeenCalledOnce();
    // end C4
    expect(c10.started).toBe(1); // C10: the session service started once, at ready
  });
});
