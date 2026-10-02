// Exercise the actual startup callbacks with disk-backed intents/layout/history, without Electron or engine hosts.
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionServiceDeps } from './context';
import { intentFor } from '../../../test/support/session-host';
import { SETTINGS_DEFAULTS_V8 } from '@shared/settings/defaults';

const state = vi.hoisted(() => ({
  root: '', shellConfig: '', ready: null as null | (() => unknown),
  deps: null as SessionServiceDeps | null,
  handlers: new Map<string, (input?: unknown) => unknown>(),
  model: null as unknown as { record: () => null; allRecords: () => []; on: (name: string, listener: (...args: unknown[]) => void) => () => void; emit: (name: string, ...args: unknown[]) => boolean },
}));
vi.mock('electron', () => ({
  app: { whenReady: () => ({ then: (fn: () => unknown) => { state.ready = fn; } }), on: vi.fn(), getPath: (name: string) => join(state.root, name), getAppPath: () => state.root, isPackaged: false, commandLine: { appendSwitch: vi.fn() }, setPath: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }, dialog: {}, screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ workArea: {} }) }, shell: {},
}));
vi.mock('../ipc/router', () => ({ installRouter: vi.fn(), registerMainHandler: (name: string, fn: (input?: unknown) => unknown) => state.handlers.set(name, fn), interceptCommand: vi.fn(), CommandFailure: class extends Error {} }));
vi.mock('@shared/host/shell-env', () => ({ captureShellEnvironment: async () => ({ HOME: join(state.root, 'home'), CLAUDE_CONFIG_DIR: state.shellConfig }) }));
vi.mock('../hosts', () => ({ createHosts: () => ({ start: vi.fn(), stop: vi.fn() }) }));
vi.mock('../settings', () => ({ startSettings: () => ({ state: () => ({ settings: SETTINGS_DEFAULTS_V8, resolvedTheme: 'light' }) }) }));
vi.mock('../window', () => ({ installContentSecurityPolicy: vi.fn(), appUrl: '', createWindow: vi.fn() }));
vi.mock('../index/index', () => ({ Index: class { unavailable = 'test'; sessions = { get: () => null, list: () => [] }; projects = { list: () => [] }; } }));
vi.mock('../index/source', () => ({ IndexSessionSource: class {} }));
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
vi.mock('../lifecycle/quit-guard', () => ({ installQuitGuard: () => ({}), askToQuit: vi.fn(), listProcesses: vi.fn() }));
vi.mock('../sessions', () => ({ startSessions: () => ({ model: state.model, stop: vi.fn() }) }));
vi.mock('./yield', () => ({ startYield: () => vi.fn() }));
vi.mock('./service', () => ({ SessionService: class { constructor(deps: SessionServiceDeps) { state.deps = deps; } async start() { await state.deps!.intents.load(); } } }));
vi.mock('./service-register', () => ({ registerSessionServiceHandlers: vi.fn(), engineHostSettled: vi.fn() }));
vi.mock('../files/register', () => ({ registerFilesHandlers: () => ({ dispose: vi.fn() }) }));
vi.mock('../usage/claude-usage-reader', () => ({ claudeUsageDir: () => '', ClaudeUsageReader: class { start() {} } }));
vi.mock('../usage/claude-usage-control', () => ({ baseUrlFrom: () => null, ClaudeUsageControl: class {} }));
vi.mock('../gateway/claude-usage-app', () => ({ createClaudeUsageApp: () => ({}), execRunner: vi.fn() }));
vi.mock('../settings/engine-configure', () => ({ startEngineConfigure: () => ({ stop: vi.fn() }) }));
vi.mock('../widgets/fixture-backend', () => ({ installWidgetBackend: vi.fn() }));

const ID = '11111111-1111-4111-8111-111111111111' as AppSessionId;
const invoke = async (name: string, input?: unknown) => state.handlers.get(name)!(input);

describe('main setup-intent and shell-environment wiring', () => {
  beforeEach(async () => {
    vi.resetModules();
    state.handlers.clear();
    state.root = mkdtempSync(join(tmpdir(), 'maws-main-wiring-'));
    state.shellConfig = join(state.root, 'shell-config');
    for (const name of ['userData', 'home', 'shell-config', 'dock-config', 'additional']) mkdirSync(join(state.root, name));
    vi.stubEnv('CLAUDE_CONFIG_DIR', join(state.root, 'dock-config'));
    vi.stubEnv('MAWS_HARNESS', '');
    const events = new EventEmitter();
    state.model = {
      record: () => null, allRecords: () => [],
      on: (name, listener) => { events.on(name, listener); return () => { events.off(name, listener); }; },
      emit: (name, ...args) => events.emit(name, ...args),
    };
    await import('../index');
    await state.ready!();
    await state.deps!.intents.load();
  });
  afterEach(() => { vi.unstubAllEnvs(); rmSync(state.root, { recursive: true, force: true }); });

  it('lists accepted additional directories before first send and revokes them when the intent changes', async () => {
    const directory = join(state.root, 'additional');
    writeFileSync(join(directory, 'mention-me.txt'), 'hello');
    const intent = intentFor(ID, { additionalDirectories: [directory] });
    await state.deps!.intents.put(intent);
    const { emit } = await import('../ipc/events');
    emit('session.intent.changed', { appSessionId: ID, intent });
    await expect(invoke('git.lsFiles', { directory, query: '', limit: 50 })).resolves.toMatchObject({ paths: ['mention-me.txt'] });
    const patched = { ...intent, additionalDirectories: [] };
    await state.deps!.intents.put(patched);
    emit('session.intent.changed', { appSessionId: ID, intent: patched });
    await expect(invoke('git.lsFiles', { directory, query: '', limit: 50 })).rejects.toThrow('not a directory');
  });

  it('persists an unstarted chat panel, retains it on provisional record removal, and drops it when the intent goes', async () => {
    const intent = intentFor(ID);
    await state.deps!.intents.put(intent);
    const panel = { tabs: [{ id: 'notes', kind: 'notes' }] };
    await invoke('layout.set', { key: `panel.${ID}`, value: panel });
    expect(JSON.parse(readFileSync(join(state.root, 'userData', 'layout.json'), 'utf8'))[`panel.${ID}`]).toEqual(panel);
    state.model.emit('record', ID, null);
    await new Promise((resolve) => setTimeout(resolve, 130));
    await expect(invoke('layout.get', { key: `panel.${ID}` })).resolves.toEqual({ value: panel });
    await state.deps!.intents.remove(ID);
    const { emit } = await import('../ipc/events');
    emit('session.intent.changed', { appSessionId: ID, intent: null });
    await new Promise((resolve) => setTimeout(resolve, 130));
    await expect(invoke('layout.get', { key: `panel.${ID}` })).resolves.toEqual({ value: null });
    await expect(invoke('layout.set', { key: `panel.${ID}`, value: panel })).rejects.toThrow('no such session');
  });

  it('reads setup defaults, Settings defaults and prompt history from the same captured environment as the engine', async () => {
    writeFileSync(join(state.shellConfig, 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'plan' } }));
    writeFileSync(join(state.shellConfig, 'history.jsonl'), JSON.stringify({ display: 'from login shell', timestamp: 1 }) + '\n');
    writeFileSync(join(state.root, 'dock-config', 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'auto' } }));
    await expect(state.deps!.userDefaults!()).resolves.toMatchObject({ defaultMode: 'plan' });
    await expect(invoke('settings.userEngineDefaults')).resolves.toMatchObject({ defaultMode: 'plan' });
    await expect(invoke('session.history.list', { appSessionId: ID, limit: 10 })).resolves.toMatchObject({ entries: [{ display: 'from login shell', source: 'terminal' }] });
    expect((await state.deps!.env).CLAUDE_CONFIG_DIR).toBe(state.shellConfig);
  });
});
