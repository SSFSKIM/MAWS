import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';

// Loads the real `src/main/index.ts` against a fake Electron `app` that records its listeners, with the modules it
// wires (hosts, router, settings, window) replaced, so what is under test is the app lifecycle alone. P5 O15 M1
// (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md): the launch settles on `mawsd`, as
// src/main/daemon-root.test.ts's does (the same fakes), as every launch does (M2); what main composes there is that
// file's to hold, the lifecycle this one's.
const fake = vi.hoisted(() => {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const windows: object[] = [];
  const hosts = { start: vi.fn(async () => {}), stop: vi.fn(), dispatch: vi.fn(), onState: vi.fn(() => () => {}) /* E3: the dataset holds follow the host's state */, onEvent: vi.fn(() => () => {}) /* P4-AGG M2: the catalog hears plugins.changed */, snapshot: () => ({ state: 'down', pid: null }), servedFd: () => null /* P5 O5 M5: the cua relay reads the machine link */, streaming: () => false, onStreaming: () => () => {} /* P5 O4 M2: the app's connectors follow the machine host */ };
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
    getVersion: () => '0.0.0-test', // P4-AGG M2: the catalog's user agent
    getAppPath: () => appPath, // E11 F2b: where the development build of main is read from (`out/main/index.js`)
    isPackaged: false,
    setPath: vi.fn(),
    commandLine: { appendSwitch: vi.fn(), getSwitchValue: vi.fn(() => '') }, // P3-F1: Electron's answer for a switch not given
    quit: vi.fn(),
    exit: vi.fn(),
  };
  // an event as Electron passes one (will-quit's is held by a step's promise: P5 O8 M2's rows cache)
  const emit = (event: string) => (listeners.get(event) ?? []).forEach((listener) => listener({ preventDefault: () => {} }));
  return { listeners, windows, hosts, app, appPath, emit, createWindow: vi.fn(() => void windows.push({})), showMessageBox: vi.fn(async () => ({ response: 1 })) };
});

vi.mock('electron', () => {
  const display = { workArea: { x: 0, y: 0, width: 1440, height: 900 } };
  return {
    app: fake.app,
    BrowserWindow: { getAllWindows: () => fake.windows },
    dialog: { showMessageBox: fake.showMessageBox }, // E11 F2b
    screen: { getAllDisplays: () => [display], getPrimaryDisplay: () => display },
    powerMonitor: { on: vi.fn() }, // P5 O8 M1: the Registry feed's wake and unlock probes
    safeStorage: {}, // P5 O4 M2: the legacy grants' sealer, asked nothing with no format 1 file
    systemPreferences: { promptTouchID: vi.fn() }, // P5 O7 M2: the step-up sheet's Touch ID, behind the confirm every signer takes
  };
});
const daemonWatch = { status: () => null, refresh: () => {}, onStatus: () => () => {} };
vi.mock('./hosts', () => ({ createHosts: () => ({ hosts: fake.hosts, daemon: daemonWatch }), prepareLaunch: () => ({ ok: true, launch: { daemon: 'private' } }), refuseTestLaunchOnDefaultProfile: () => {} /* P5 O2 landing: a scratch-profile test launch */ })); // P5 O2 M7: the launch's shape, settled at once
// P5 O3-D M5b: the spine's mirror and the machine half's, which main reads on the daemon shape; the mirror's stop recorded
const mirrors = vi.hoisted(() => ({ stop: vi.fn() }));
vi.mock('./sessions/daemon-spine', () => ({
  startDaemonSpine: () => ({ view: { on: () => () => {}, unavailable: () => 'the machine daemon is connecting', record: () => null, records: () => [], projects: () => [], projectRows: () => [], intents: () => [] }, forwarded: () => {}, watches: { owns: () => false, dispatch: async () => ({ ok: true, value: undefined }) }, stop: mirrors.stop }),
}));
vi.mock('./client/machine-settings-mirror', () => ({ createMachineSettingsMirror: () => ({ state: () => ({}), update: vi.fn(), onChange: () => () => {}, stop: vi.fn() }) }));
vi.mock('./windows', () => ({ appWindows: () => fake.windows })); // E2: the app-window registry `activate` reads
vi.mock('./browser', () => ({ startBrowser: () => ({ stop: vi.fn(), partitions: {} /* E4b */, cua: { relay: vi.fn() } /* P5 O5 M5: the daemon's relay pass */ }) })); // E4a: the in-app browser's main side
vi.mock('./artifacts', () => ({ registerStoreSchemes: vi.fn() /* M7 */, installStorePolicies: vi.fn() /* P3-L M6b: E2's startDeliverables' policies */, startArtifacts: () => ({ stop: vi.fn(), exporters: { register: () => () => {} } /* P3-B: the document exporters register here */ }) })); // P3-A: the artifact store's main side
vi.mock('./presentations/present', () => ({ registerPresenter: vi.fn(() => ({ end: vi.fn() })) })); // P3-C M6: the presenter's windows
vi.mock('./browser/import', () => ({ ImportedProfiles: { open: () => ({ list: () => [] }) }, sweepBrowserImports: vi.fn(), startBrowserImport: () => ({ stop: vi.fn() }) })); // E4b: the Chrome import's main side
vi.mock('./ipc/router', () => ({ installRouter: vi.fn(), registerMainHandler: vi.fn() /* C3 */, registerMachineHandler: vi.fn() /* P5 O6 M1 */, interceptCommand: vi.fn(), dispatchLocal: vi.fn() /* P5 O6 M3 */, invokeOwn: vi.fn() /* P5 O3-E */, beforeCommand: vi.fn(() => () => {}) /* P5 O4 M2 */, CommandFailure: Error /* C11 */ }));
vi.mock('./machines', () => ({ startMachines: vi.fn(() => ({ dispatch: vi.fn(), serve: vi.fn(), stop: vi.fn(), onRemote: vi.fn(() => () => {}) /* P5 O8 M2: the rows read the roster */ })) })); // P5 O6 M3: no links, no stand-in
vi.mock('./client/settings', () => ({ startSettings: () => ({ state: () => ({ settings: SETTINGS_DEFAULTS_V21, resolvedTheme: 'light' }), onChange: vi.fn(() => vi.fn()) }) })); // P5 O3-A: the client half
// P5 O15 M2: of the library main takes only the command budgets (none here, every name at the host's 10 s); the
// machine's identity is read with no machine.json under the fixed getPath (main binds its ref)
vi.mock('../services/command-budgets', () => ({ COMMAND_BUDGETS_MS: {} }));
vi.mock('./machine/identity', () => ({ readMachineIdentity: vi.fn(() => ({ ref: 'TestMachineRef00000000', name: 'test' })) }));
vi.mock('./window', () => ({ appUrl: 'file:///index.html', createWindow: fake.createWindow, installContentSecurityPolicy: vi.fn() }));
vi.mock('./ipc/events', () => ({ emit: vi.fn(), onEmitted: vi.fn(() => () => {}) })); // onEmitted: the services bus's taps (P5 O3-C)
// C5 start: the layout store and the external-link command
vi.mock('./layout/store', () => ({ LayoutFileStore: class { flush() {} get() { return null; } set() {} onChange() { return () => {}; } /* P5 O7 M2: remote lane B follows main.tabs */ }, registerLayoutHandlers: vi.fn() }));
vi.mock('./sessions/panel-lifetime', () => ({ registerChatPanels: () => () => {} }));
vi.mock('./open-external', () => ({ registerOpenExternal: vi.fn() }));
vi.mock('./menu', () => ({ startMenu: vi.fn(), registerMenuHandlers: vi.fn() }));
vi.mock('./window-state', () => ({ restoreWindowState: vi.fn(() => null), trackWindowState: vi.fn() }));
vi.mock('./attention', () => ({ startAttention: vi.fn() }));
vi.mock('./lifecycle/quit-guard', () => ({ installQuitGuard: vi.fn(), askToQuit: vi.fn(), trackUnsavedFiles: vi.fn(() => ({})) /* E5 */ }));
// C5 end
// the login-shell capture main shares with the roots, without a real shell
vi.mock('@shared/host/shell-env', () => ({ captureShellEnvironment: () => Promise.resolve({}) }));
// C11 start
vi.mock('./sessions/interest', () => ({ startInterest: () => () => {}, appInterest: () => ({ set: () => new Set(), onChange: () => () => {}, stop: () => {} }) })); // P5 O2 M2: its sibling; P5 O3-C: the app's interest
vi.mock('./widgets/fixture-backend', () => ({ installWidgetBackend: () => null })); // the widget e2e's stand-in, off here
// C11 end
// P5 O8 M1: the org session main makes, its deps kept; backup exclusion stubbed, so no test runs osascript
const org = vi.hoisted(() => ({ deps: [] as Array<{ excludeFromBackup?(path: string): Promise<boolean> }>, exclude: vi.fn<(path: string) => Promise<boolean>>(async () => true) }));
vi.mock('@shared/fs/backup-exclusion', () => ({ excludeFromBackup: org.exclude }));
vi.mock('./org/org-session', async (original) => {
  const real = await original<typeof import('./org/org-session')>();
  return { ...real, createOrgSession: (deps: Parameters<typeof real.createOrgSession>[0]) => (org.deps.push(deps), real.createOrgSession(deps)) };
});

beforeAll(async () => {
  // E11 §2.7: electron.vite.config.ts defines main's build stamp for its bundle; vitest does not
  vi.stubGlobal('__MAWS_VERSION__', '0.0.0');
  vi.stubGlobal('__MAWS_BUILD__', { commit: 'test0000', builtAt: '2026-10-08T00:00:00.000Z' });
  await import('./app');
  await new Promise((resolve) => setImmediate(resolve)); // let `whenReady().then(...)` run, and the start it waits for (P5 O15 M2: the launch's outcome first)
});

describe('app lifecycle (macOS, D-11)', () => {
  it('makes the org session with the backup exclusion, so `<userData>/org/` stays out of Time Machine', async () => {
    expect(org.deps).toHaveLength(1);
    expect(await org.deps[0].excludeFromBackup?.('/tmp/maws-lifecycle-test/org')).toBe(true);
    expect(org.exclude).toHaveBeenCalledWith('/tmp/maws-lifecycle-test/org');
  });

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

  it('stops the hosts on will-quit, and the spine’s mirror in one step', () => {
    fake.emit('will-quit');
    expect(fake.hosts.stop).toHaveBeenCalledOnce();
    // P5 O3-D M5b: main composes no spine; its mirror of mawsd's stops in the spine's one step
    expect(mirrors.stop).toHaveBeenCalledOnce();
  });
});
