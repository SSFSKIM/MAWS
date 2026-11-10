// Exercise main's actual startup callbacks on the daemon shape, without Electron or hosts. P5 O15 M1
// (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md): main composes no session service of its own any more, so
// what this file held of that service's wiring is the spine's to hold, where it is composed (src/services/spine-root.test.ts:
// the additional directories, the engine's captured environment for defaults, history and scm's trust) and the chat
// panels' (src/main/sessions/panel-lifetime.test.ts); what main itself hands on stays here.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import type { Settings } from '@shared/ipc/schema';

const state = vi.hoisted(() => ({
  root: '', ready: null as null | (() => unknown),
  handlers: new Map<string, (input?: unknown) => unknown>(),
  settings: null as unknown as Settings, // E4a: what the settings service answers now
  browserSettings: null as null | (() => unknown), // E4a: the accessor main hands the browser
}));
vi.mock('electron', () => ({
  app: { whenReady: () => ({ then: (fn: () => unknown) => { state.ready = fn; } }), on: vi.fn(), requestSingleInstanceLock: () => true, hasSingleInstanceLock: () => true, getPath: (name: string) => join(state.root, name), getAppPath: () => state.root, getVersion: () => '0.0.0-test' /* P4-AGG M2: the catalog's user agent */, isPackaged: false, commandLine: { appendSwitch: vi.fn(), getSwitchValue: vi.fn(() => '') /* P3-F1: Electron's answer for a switch not given */ }, setPath: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }, dialog: {}, screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ workArea: {} }) }, shell: {},
  powerMonitor: { on: vi.fn() }, // P5 O8 M1: the Registry feed's wake and unlock probes
  safeStorage: {}, // P5 O4 M2: the legacy grants' sealer, asked nothing with no format 1 file
  systemPreferences: { promptTouchID: vi.fn() }, // P5 O7 M2: the step-up sheet's Touch ID, behind the confirm every signer takes
}));
vi.mock('../ipc/router', () => ({ installRouter: vi.fn(), registerMainHandler: (name: string, fn: (input?: unknown) => unknown) => state.handlers.set(name, fn), registerMachineHandler: (name: string, fn: (input?: unknown) => unknown) => state.handlers.set(name, fn) /* P5 O6 M1 */, interceptCommand: vi.fn(), dispatchLocal: vi.fn() /* P5 O6 M3 */, beforeCommand: () => () => {} /* P5 O4 M2 */, CommandFailure: class extends Error {} }));
vi.mock('../machines', () => ({ startMachines: vi.fn(() => ({ dispatch: vi.fn(), serve: vi.fn(), stop: vi.fn(), onRemote: vi.fn(() => () => {}) /* P5 O8 M2: the rows read the roster */ })) })); // P5 O6 M3: no links, no stand-in
vi.mock('@shared/host/shell-env', () => ({ captureShellEnvironment: async () => ({ HOME: join(state.root, 'home') }) }));
const daemonWatch = { status: () => null, refresh: () => {}, onStatus: () => () => {} };
vi.mock('../hosts', () => ({ createHosts: () => ({ daemon: daemonWatch, hosts: { start: vi.fn(), stop: vi.fn(), dispatch: vi.fn(), onState: vi.fn(() => () => {}) /* E3: the dataset holds follow the host's state */, onEvent: vi.fn(() => () => {}) /* P4-AGG M2: the catalog hears plugins.changed */, onStreaming: vi.fn(() => () => {}), streaming: vi.fn(() => false) /* P5 O4 M2: the app's connectors follow the machine host */, snapshot: () => ({ state: 'down', pid: null }), servedFd: () => null /* P5 O5 M5: the cua relay reads the machine link */ } }), prepareLaunch: () => ({ ok: true, launch: { daemon: 'private' } }), refuseTestLaunchOnDefaultProfile: () => {} /* P5 O2 landing: a scratch-profile test launch */ /* P5 O2 M7: the launch's shape, settled at once */ }));
// P5 O3-D M5b: the spine's mirror and the machine half's, which main reads on the daemon shape
vi.mock('./daemon-spine', () => ({
  startDaemonSpine: () => ({ view: { on: () => () => {}, unavailable: () => 'the machine daemon is connecting', known: () => false, record: () => null, records: () => [], projects: () => [], projectRows: () => [], intents: () => [] }, forwarded: () => {}, watches: { owns: () => false, dispatch: async () => ({ ok: true, value: undefined }) }, stop: vi.fn() }),
}));
vi.mock('../client/machine-settings-mirror', () => ({ createMachineSettingsMirror: () => ({ state: () => ({}), update: vi.fn(), onChange: () => () => {}, stop: vi.fn() }) }));
vi.mock('../client/settings', () => ({ startSettings: () => ({ state: () => ({ settings: state.settings, resolvedTheme: 'light' }), onChange: vi.fn(() => vi.fn()) }) }));
vi.mock('../window', () => ({ installContentSecurityPolicy: vi.fn(), appUrl: '', createWindow: vi.fn() }));
vi.mock('../open-external', () => ({ registerOpenExternal: vi.fn() }));
vi.mock('../attention', () => ({ startAttention: vi.fn() }));
vi.mock('../menu', () => ({ startMenu: vi.fn(), registerMenuHandlers: vi.fn() }));
vi.mock('../window-state', () => ({ restoreWindowState: vi.fn(), trackWindowState: vi.fn() }));
vi.mock('../lifecycle/quit-guard', () => ({ installQuitGuard: () => ({}), askToQuit: vi.fn(), trackUnsavedFiles: () => ({}) /* E5 */ }));
vi.mock('../usage/claude-usage-reader', () => ({ claudeUsageDir: () => '', ClaudeUsageReader: class { start() {} } }));
vi.mock('../usage/claude-usage-control', () => ({ baseUrlFrom: () => null, ClaudeUsageControl: class {} }));
vi.mock('../gateway/claude-usage-app', () => ({ createClaudeUsageApp: () => ({}), execRunner: vi.fn() }));
vi.mock('./interest', () => ({ startInterest: () => () => {}, appInterest: () => ({ set: () => new Set(), onChange: () => () => {}, stop: () => {} }) })); // P5 O2 M2: its sibling; P5 O3-C: the app's interest
vi.mock('../widgets/fixture-backend', () => ({ installWidgetBackend: vi.fn() }));
vi.mock('../browser', () => ({ startBrowser: (deps: { settings(): unknown }) => { state.browserSettings = deps.settings; return { stop: vi.fn(), partitions: {} /* E4b */, cua: { relay: vi.fn() } /* P5 O5 M5: the daemon's relay pass */ }; } })); // E4a
vi.mock('../artifacts', () => ({ registerStoreSchemes: vi.fn() /* M7 */, installStorePolicies: vi.fn() /* P3-L M6b: E2's startDeliverables' policies */, startArtifacts: () => ({ stop: vi.fn(), exporters: { register: () => () => {} } /* P3-B: the document exporters register here */ }) })); // P3-A: the artifact store's main side
vi.mock('../presentations/present', () => ({ registerPresenter: vi.fn(() => ({ end: vi.fn() })) })); // P3-C M6: the presenter's windows
vi.mock('../browser/import', () => ({ ImportedProfiles: { open: () => ({ list: () => [] }) }, sweepBrowserImports: vi.fn(), startBrowserImport: () => ({ stop: vi.fn() }) })); // E4b

describe('main startup wiring', () => {
  beforeEach(async () => {
    vi.resetModules();
    state.handlers.clear();
    state.settings = SETTINGS_DEFAULTS_V21; // E4a
    state.root = mkdtempSync(join(tmpdir(), 'maws-main-wiring-'));
    for (const name of ['userData', 'home']) mkdirSync(join(state.root, name));
    vi.stubEnv('MAWS_HARNESS', '');
    // E11 §2.7: electron.vite.config.ts defines main's build stamp for its bundle; vitest does not
    vi.stubGlobal('__MAWS_VERSION__', '0.0.0');
    vi.stubGlobal('__MAWS_BUILD__', { commit: 'test0000', builtAt: '2026-10-08T00:00:00.000Z' });
    await import('../app');
    await state.ready!();
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); rmSync(state.root, { recursive: true, force: true }); });

  // E4a: the browser reads settings 11's browser section from the service at each use, so a change reaches the next tab
  // opened and the next new-window link without a restart
  it('hands the browser the live browser settings, read at each call', () => {
    expect(state.browserSettings!()).toEqual(SETTINGS_DEFAULTS_V21.browser);
    const browser = { profile: 'Profile 1', searchUrl: 'https://duckduckgo.com/?q=%s', linkTarget: 'external', bookmarksBar: 'hidden' } as const; // cua #90: bookmarksBar
    state.settings = { ...SETTINGS_DEFAULTS_V21, browser };
    expect(state.browserSettings!()).toEqual(browser);
  });
});
