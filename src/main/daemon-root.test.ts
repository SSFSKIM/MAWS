import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';

// P5 O3-D M5b (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, acceptance 3; Interfaces §F, §G): the daemon shape's
// root. Loads the real `src/main/index.ts` as src/main/lifecycle.test.ts does (the same fakes), with the launch settled
// on the daemon shape: main opens none of the spine's data (no spine.lock, no split), composes no spine, binds `machine`
// as `host`, reads the spine through its mirror and the machine half through its settings mirror, and stops the mirror
// at will-quit.
const fake = vi.hoisted(() => {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const windows: object[] = [];
  const hosts = { start: vi.fn(async () => {}), stop: vi.fn(), dispatch: vi.fn(), onState: vi.fn(() => () => {}) /* E3: the dataset holds follow the host's state */, onEvent: vi.fn(() => () => {}) /* P4-AGG M2: the catalog hears plugins.changed */ };
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
  };
});
const daemonWatch = { status: () => null, refresh: () => {}, onStatus: () => () => {} };
vi.mock('./hosts', () => ({ createHosts: () => ({ hosts: fake.hosts, daemon: daemonWatch }), prepareLaunch: () => ({ mode: 'daemon', daemon: 'private', unavailable: null }), refuseTestLaunchOnDefaultProfile: () => {} }));
const mirrors = vi.hoisted(() => ({ spine: [] as unknown[], settings: [] as unknown[], stop: vi.fn() })); // stop is called in its own case
vi.mock('./sessions/daemon-spine', () => ({
  startDaemonSpine: (options: unknown) => {
    mirrors.spine.push(options);
    return { view: { on: () => () => {}, unavailable: () => 'the machine daemon is connecting', record: () => null, records: () => [], projects: () => [], projectRows: () => [], intents: () => [] }, stop: mirrors.stop };
  },
}));
vi.mock('./client/machine-settings-mirror', () => ({ createMachineSettingsMirror: (options: unknown) => (mirrors.settings.push(options), { state: () => ({}), update: vi.fn(), onChange: () => () => {}, stop: vi.fn() }) }));
vi.mock('./windows', () => ({ appWindows: () => fake.windows })); // E2: the app-window registry `activate` reads
vi.mock('./browser', () => ({ startBrowser: () => ({ stop: vi.fn(), partitions: {} /* E4b */ }) })); // E4a: the in-app browser's main side
vi.mock('./artifacts', () => ({ registerStoreSchemes: vi.fn() /* M7 */, installStorePolicies: vi.fn() /* P3-L M6b: E2's startDeliverables' policies */, startArtifacts: () => ({ stop: vi.fn(), exporters: { register: () => () => {} } /* P3-B: the document exporters register here */ }) })); // P3-A: the artifact store's main side
vi.mock('./connectors', () => ({ startConnectors: () => ({ stop: vi.fn() }) })); // P3-H H3b: the connector broker's main side
vi.mock('./design-systems/export', () => ({ registerDesignSystemExporters: vi.fn() })); // P3-D: the design system's exporter, registered into the artifacts' registry
vi.mock('./artifacts/inspection', () => ({ registerInspectionExporters: vi.fn(() => () => {}) }));
vi.mock('./presentations/export', () => ({ registerPresentationExporters: vi.fn() })); // P3-C M9: the presentation's exporters, registered into the artifacts' registry
vi.mock('./design/export', () => ({ registerDesignExporters: vi.fn() })); // P3-E (E1's M5): the design's exporters, registered into the artifacts' registry
vi.mock('./dashboard/export', () => ({ registerDashboardExporters: vi.fn(() => () => {}) })); // P3-E (E2 M5): the dashboard's exporters, registered into the artifacts' registry
vi.mock('./presentations/present', () => ({ registerPresenter: vi.fn(() => ({ end: vi.fn() })) })); // P3-C M6: the presenter's windows
vi.mock('./browser/import', () => ({ ImportedProfiles: { open: () => ({ list: () => [] }) }, sweepBrowserImports: vi.fn(), startBrowserImport: () => ({ stop: vi.fn() }) })); // E4b: the Chrome import's main side
const router = vi.hoisted(() => ({ installs: [] as unknown[] })); // plain records: the suite clears mocks between cases
vi.mock('./ipc/router', () => ({ installRouter: (options: unknown) => void router.installs.push(options), registerMainHandler: vi.fn() /* C3 */, registerMachineHandler: vi.fn() /* P5 O6 M1 */, interceptCommand: vi.fn(), dispatchLocal: vi.fn() /* P5 O6 M3 */, CommandFailure: Error /* C11 */ }));
vi.mock('./machines', () => ({ startMachines: vi.fn(() => ({ dispatch: vi.fn(), serve: vi.fn(), stop: vi.fn(), onRemote: vi.fn(() => () => {}) /* P5 O8 M2: the rows read the roster */ })) })); // P5 O6 M3: no links, no stand-in
vi.mock('./client/settings', () => ({ startSettings: () => ({ state: () => ({ settings: SETTINGS_DEFAULTS_V21, resolvedTheme: 'light' }), onChange: vi.fn(() => vi.fn()) }) })); // P5 O3-A: the client half
// P5 O3-C (M4): the services entry's roots, stubbed as main sees them: the machine's identity (no machine.json under the
// fixed getPath; main binds its ref), the spine's data (spine.lock held, the split done, the machine half), the spine
// with an empty view, and the checkouts; each root's start and stop recorded
const roots = vi.hoisted(() => ({ release: vi.fn(), opened: 0, spineStarted: 0, checkoutsStarted: 0, stopSpine: vi.fn(), stopCheckouts: vi.fn() }));
vi.mock('../services/entry', () => ({
  startMachineIdentity: vi.fn(() => ({ ref: 'TestMachineRef00000000' })),
  openSpineData: async (profile: string) => ((roots.opened += 1), { lock: { refused: null, holder: null, release: roots.release }, refused: null, machineSettings: {}, paths: { client: `${profile}/settings.json`, machine: `${profile}/machine-settings.json` } }),
  startSpine: () => {
    roots.spineStarted += 1;
    return { view: { on: () => () => {}, unavailable: () => null, record: () => null, records: () => [], projects: () => [], projectRows: () => [], intents: () => [] }, stop: roots.stopSpine };
  },
  startCheckouts: () => {
    roots.checkoutsStarted += 1;
    return { files: { readResolved: vi.fn() }, stop: roots.stopCheckouts };
  },
}));
vi.mock('./window', () => ({ appUrl: 'file:///index.html', createWindow: fake.createWindow, installContentSecurityPolicy: vi.fn() }));
vi.mock('./ipc/events', () => ({ emit: vi.fn(), onEmitted: vi.fn(() => () => {}) })); // onEmitted: the services bus's taps (P5 O3-C)
// C5 start: the layout store and the external-link command
vi.mock('./layout/store', () => ({ LayoutFileStore: class { flush() {} get() { return null; } set() {} }, registerLayoutHandlers: vi.fn() }));
vi.mock('./sessions/panel-lifetime', () => ({ registerChatPanels: () => () => {} }));
vi.mock('./open-external', () => ({ registerOpenExternal: vi.fn() }));
vi.mock('./menu', () => ({ startMenu: vi.fn(), registerMenuHandlers: vi.fn() }));
vi.mock('./window-state', () => ({ restoreWindowState: vi.fn(() => null), trackWindowState: vi.fn() }));
vi.mock('./attention', () => ({ startAttention: vi.fn() }));
vi.mock('./lifecycle/quit-guard', () => ({ installQuitGuard: vi.fn(), askToQuit: vi.fn(), listProcesses: vi.fn(), trackUnsavedFiles: vi.fn(() => ({})) /* E5 */ }));
// C5 end
// the login-shell capture main shares with the roots, without a real shell
vi.mock('@shared/host/shell-env', () => ({ captureShellEnvironment: () => Promise.resolve({}) }));
// C11 start
vi.mock('./sessions/interest', () => ({ startInterest: () => () => {}, appInterest: () => ({ set: () => new Set(), onChange: () => () => {}, stop: () => {} }) })); // P5 O2 M2: its sibling; P5 O3-C: the app's interest
vi.mock('./widgets/fixture-backend', () => ({ installWidgetBackend: () => null })); // the widget e2e's stand-in, off here
// C11 end
// P5 O8 M1: the org session main makes, its deps kept; backup exclusion stubbed, so no test runs osascript
const org = vi.hoisted(() => ({ deps: [] as Array<{ excludeFromBackup?(path: string): Promise<boolean> }>, exclude: vi.fn<(path: string) => Promise<boolean>>(async () => true) }));
vi.mock('./device/backup-exclusion', () => ({ excludeFromBackup: org.exclude }));
vi.mock('./org/org-session', async (original) => {
  const real = await original<typeof import('./org/org-session')>();
  return { ...real, createOrgSession: (deps: Parameters<typeof real.createOrgSession>[0]) => (org.deps.push(deps), real.createOrgSession(deps)) };
});

beforeAll(async () => {
  vi.stubGlobal('__MAWS_VERSION__', '0.0.0');
  vi.stubGlobal('__MAWS_BUILD__', { commit: 'test0000', builtAt: '2026-10-08T00:00:00.000Z' });
  await import('./index');
  await new Promise((resolve) => setImmediate(resolve)); // let `whenReady().then(...)` run, and the start it waits for
});

describe('the daemon shape’s root in main', () => {
  it('opens none of the spine’s data and composes no spine: mawsd holds spine.lock and the machine’s files', () => {
    expect(roots.opened).toBe(0);
    expect(roots.spineStarted).toBe(0);
    expect(roots.checkoutsStarted).toBe(1); // the checkouts stay main's until O3-E, over the mirror's view
  });

  it('binds `machine` as `host` and reads the spine and the machine half through their mirrors', () => {
    expect(router.installs).toEqual([expect.objectContaining({ machine: { kind: 'host' } })]);
    expect(mirrors.spine).toEqual([expect.objectContaining({ hosts: fake.hosts, daemon: daemonWatch })]);
    expect(mirrors.settings).toEqual([expect.objectContaining({ file: '/tmp/maws-lifecycle-test/machine-settings.json', hosts: fake.hosts })]);
  });

  it('stops the mirror at will-quit and releases no lock it never took', () => {
    fake.emit('will-quit');
    expect(mirrors.stop).toHaveBeenCalledOnce();
    expect(roots.stopSpine).not.toHaveBeenCalled();
    expect(roots.release).not.toHaveBeenCalled();
  });
});
