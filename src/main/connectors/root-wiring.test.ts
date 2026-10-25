// P3-HD M4 (Decision Log 14): the application's composition root actually supplies route D to the connector service.
// Executes src/main/index.ts's real startup (the main-wiring harness, Electron and the other services doubled) and reads
// what it handed `startConnectors`: the real direct-route factory, not a flag or a test route. The service that composes
// [E, D] from it is exercised by ./index-direct.test.ts.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { SessionServiceDeps } from '../sessions/context';
import { SETTINGS_DEFAULTS_V18 } from '@shared/settings/defaults';
import type { Settings } from '@shared/ipc/schema';
import type { ConnectorsDeps } from '.';

const state = vi.hoisted(() => ({
  root: '', shellConfig: '', ready: null as null | (() => unknown),
  deps: null as SessionServiceDeps | null,
  handlers: new Map<string, (input?: unknown) => unknown>(),
  settings: null as unknown as Settings, // E4a: what the settings service answers now
  browserSettings: null as null | (() => unknown), // E4a: the accessor main hands the browser
  connectorDeps: null as ConnectorsDeps | null,
  model: null as unknown as { record: () => null; allRecords: () => []; on: (name: string, listener: (...args: unknown[]) => void) => () => void; emit: (name: string, ...args: unknown[]) => boolean },
}));
vi.mock('electron', () => ({
  app: { whenReady: () => ({ then: (fn: () => unknown) => { state.ready = fn; } }), on: vi.fn(), requestSingleInstanceLock: () => true, hasSingleInstanceLock: () => true, getPath: (name: string) => join(state.root, name), getAppPath: () => state.root, getVersion: () => '0.0.0-test' /* P4-AGG M2: the catalog's user agent */, isPackaged: false, commandLine: { appendSwitch: vi.fn(), getSwitchValue: vi.fn(() => '') /* P3-F1: Electron's answer for a switch not given */ }, setPath: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }, dialog: {}, screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ workArea: {} }) }, shell: {},
}));
vi.mock('../ipc/router', () => ({ installRouter: vi.fn(), registerMainHandler: (name: string, fn: (input?: unknown) => unknown) => state.handlers.set(name, fn), interceptCommand: vi.fn(), CommandFailure: class extends Error {} }));
vi.mock('@shared/host/shell-env', () => ({ captureShellEnvironment: async () => ({ HOME: join(state.root, 'home'), CLAUDE_CONFIG_DIR: state.shellConfig }) }));
vi.mock('../hosts', () => ({ createHosts: () => ({ start: vi.fn(), stop: vi.fn(), onState: vi.fn(() => () => {}) /* E3 (merge): the dataset holds follow the host's state */, onEvent: vi.fn(() => () => {}) /* P4-AGG M2: the catalog hears plugins.changed */ }) }));
vi.mock('../settings', () => ({ startSettings: () => ({ state: () => ({ settings: state.settings, resolvedTheme: 'light' }), onChange: vi.fn(() => vi.fn()) }) }));
vi.mock('../window', () => ({ installContentSecurityPolicy: vi.fn(), appUrl: '', createWindow: vi.fn() }));
vi.mock('../index/index', () => ({ Index: class { unavailable = 'test'; sessions = { get: () => null, list: () => [] }; projects = { list: () => [] }; } }));
vi.mock('../index/source', () => ({ IndexSessionSource: class { onScanned = () => () => {}; discoveryCurrent = () => false; } }));
vi.mock('../index/attention-service', () => ({ startIndexAttention: () => ({ stop: vi.fn() }) }));
vi.mock('../index/register', () => ({ registerIndexHandlers: vi.fn() }));
vi.mock('../index/replay', () => ({ registerReplayHandlers: () => ({ dispose: vi.fn() }) }));
vi.mock('../git/service', () => ({ GitService: class {} }));
vi.mock('../git/register', () => ({ registerGitHandlers: vi.fn() }));
vi.mock('../git/worktrees-register', () => ({ registerWorktreeHandlers: vi.fn() }));
vi.mock('../pty-links', () => ({ registerPtyOpenLink: vi.fn() }));
vi.mock('../open-external', () => ({ registerOpenExternal: vi.fn() }));
vi.mock('../attention', () => ({ startAttention: vi.fn() }));
vi.mock('../menu', () => ({ startMenu: vi.fn(), registerMenuHandlers: vi.fn() }));
vi.mock('../window-state', () => ({ restoreWindowState: vi.fn(), trackWindowState: vi.fn() }));
vi.mock('../lifecycle/quit-guard', () => ({ installQuitGuard: () => ({}), askToQuit: vi.fn(), listProcesses: vi.fn(), trackUnsavedFiles: () => ({}) /* E5 */ }));
vi.mock('../sessions', () => ({ startSessions: () => ({ model: state.model, stop: vi.fn() }) }));
vi.mock('../sessions/yield', () => ({ startYield: () => vi.fn() }));
vi.mock('../side/side-threads', () => ({ startSideThreads: () => vi.fn(), sideThreadEvents: () => [] })); // E3
vi.mock('../sessions/service', () => ({ SessionService: class { constructor(deps: SessionServiceDeps) { state.deps = deps; } async start() { await state.deps!.intents.load(); } } }));
vi.mock('../sessions/service-register', () => ({ registerSessionServiceHandlers: vi.fn(), engineHostSettled: vi.fn() }));
vi.mock('../files/register', () => ({ registerFilesHandlers: () => ({ dispose: vi.fn() }) }));
vi.mock('../usage/claude-usage-reader', () => ({ claudeUsageDir: () => '', ClaudeUsageReader: class { start() {} } }));
vi.mock('../usage/claude-usage-control', () => ({ baseUrlFrom: () => null, ClaudeUsageControl: class {} }));
vi.mock('../gateway/claude-usage-app', () => ({ createClaudeUsageApp: () => ({}), execRunner: vi.fn() }));
vi.mock('../settings/engine-configure', () => ({ startEngineConfigure: () => ({ stop: vi.fn() }) }));
vi.mock('../settings/host-configure', () => ({ startHostConfigure: () => vi.fn() })); // E10
vi.mock('../widgets/fixture-backend', () => ({ installWidgetBackend: vi.fn() }));
vi.mock('../browser', () => ({ startBrowser: (deps: { settings(): unknown }) => { state.browserSettings = deps.settings; return { stop: vi.fn(), partitions: {} /* E4b */ }; } })); // E4a
vi.mock('../artifacts', () => ({ registerStoreSchemes: vi.fn() /* M7 */, installStorePolicies: vi.fn() /* P3-L M6b: E2's startDeliverables' policies */, startArtifacts: () => ({ stop: vi.fn(), exporters: { register: () => () => {} } /* P3-B: the document exporters register here */ }) })); // P3-A: the artifact store's main side
vi.mock('.', () => ({ startConnectors: (deps: unknown) => { state.connectorDeps = deps as ConnectorsDeps; return { stop: vi.fn() }; } })); // P3-HD: what the application's root hands the connector service
vi.mock('../design-systems/export', () => ({ registerDesignSystemExporters: vi.fn() })); // P3-D: the design system's exporter, registered into the artifacts' registry
vi.mock('../artifacts/inspection', () => ({ registerInspectionExporters: vi.fn(() => () => {}) }));
vi.mock('../presentations/export', () => ({ registerPresentationExporters: vi.fn() })); // P3-C M9: the presentation's exporters, registered into the artifacts' registry
vi.mock('../design/export', () => ({ registerDesignExporters: vi.fn() })); // P3-E (E1's M5): the design's exporters, registered into the artifacts' registry
vi.mock('../presentations/present', () => ({ registerPresenter: vi.fn(() => ({ end: vi.fn() })) })); // P3-C M6: the presenter's windows
vi.mock('../browser/import', () => ({ ImportedProfiles: { open: () => ({ list: () => [] }) }, sweepBrowserImports: vi.fn(), startBrowserImport: () => ({ stop: vi.fn() }) })); // E4b


describe('the application root’s connector composition', () => {
  beforeEach(async () => {
    vi.resetModules();
    state.handlers.clear();
    state.connectorDeps = null;
    state.settings = SETTINGS_DEFAULTS_V18;
    state.root = mkdtempSync(join(tmpdir(), 'maws-root-wiring-'));
    state.shellConfig = join(state.root, 'shell-config');
    for (const name of ['userData', 'home', 'shell-config', 'dock-config', 'additional']) mkdirSync(join(state.root, name));
    vi.stubEnv('CLAUDE_CONFIG_DIR', join(state.root, 'dock-config'));
    vi.stubEnv('MAWS_HARNESS', '');
    vi.stubGlobal('__MAWS_VERSION__', '0.0.0');
    vi.stubGlobal('__MAWS_BUILD__', { commit: 'test0000', builtAt: '2026-10-08T00:00:00.000Z' });
    const events = new EventEmitter();
    state.model = {
      record: () => null, allRecords: () => [],
      on: (name, listener) => { events.on(name, listener); return () => { events.off(name, listener); }; },
      emit: (name, ...args) => events.emit(name, ...args),
    };
    await import('../index');
    await state.ready!();
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); rmSync(state.root, { recursive: true, force: true }); });

  it('supplies route D’s real factory to the connector service, beside the index and the window lookup', async () => {
    const { createDirectRoute } = await import('./direct-route'); // the instance the root imported (modules were reset)
    expect(state.connectorDeps).not.toBeNull();
    expect(state.connectorDeps!.direct).toBe(createDirectRoute);
    expect(typeof state.connectorDeps!.windowOf).toBe('function');
    expect(state.connectorDeps!.index).toBeDefined();
  });

  // P3-HD M3c2: the production OAuth provider's factory beside route D, the real one; no test toggle selects it
  it('supplies MAWS’s own OAuth provider’s production factory beside route D', async () => {
    const { productionConnectorOAuth } = await import('./oauth-root');
    expect(state.connectorDeps!.oauth).toBe(productionConnectorOAuth);
  });
});
