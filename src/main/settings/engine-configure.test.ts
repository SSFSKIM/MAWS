import { describe, expect, it, vi } from 'vitest';
import type { CommandResult, HostState, Settings } from '@shared/ipc/schema';
import { SETTINGS_DEFAULTS_V4 } from '@shared/settings/defaults';
import { startEngineConfigure, type EngineConfigureDeps } from './engine-configure';
import type { Custody } from '../engine/custody'; // C12

const INFO = { path: '/Users/new/.local/share/claude/versions/2.1.283', expectedVersion: '2.1.283', version: '2.1.283', ok: true, error: null };
const host = (state: HostState['state']): HostState => ({ state, pid: state === 'ready' ? 1 : null, restarts: 0, revision: 0 });

// C12: the owner's Mac, 32 GiB: 25% is 8 GiB
const TOTAL_MEM = 32 * 1024 ** 3;
const DEFAULT_LIMIT_KIB = 8 * 1024 * 1024;

function harness(initial: HostState['state'] = 'starting', dispatch?: EngineConfigureDeps['dispatch'], custody?: EngineConfigureDeps['custody'] /* C12 */) {
  let settings: Settings = SETTINGS_DEFAULTS_V4;
  const settingsListeners = new Set<(s: Settings) => void>();
  const stateListeners = new Set<(s: HostState) => void>();
  let current = host(initial);
  const deps: EngineConfigureDeps = {
    settings: () => settings,
    onSettingsChanged: (l) => (settingsListeners.add(l), () => void settingsListeners.delete(l)),
    hostState: () => current,
    onHostState: (l) => (stateListeners.add(l), () => void stateListeners.delete(l)),
    dispatch: dispatch ?? vi.fn(async (): Promise<CommandResult<'engine.configure'>> => ({ ok: true, value: INFO })),
    // C12 start
    dispatchPolicy: vi.fn(async (policy): Promise<CommandResult<'engine.policy.set'>> => ({ ok: true, value: { limitKiB: policy.limitKiB, totalKiB: 0, sampledAt: null, over: false, overWithoutCandidate: false, candidates: 0, settling: 0, releasing: null, blocked: [], lastRelease: null } })),
    totalMemBytes: TOTAL_MEM,
    custody,
    // C12 end
  };
  const configure = startEngineConfigure(deps); // C12: the coordinator, not only its stop
  return {
    dispatch: deps.dispatch as ReturnType<typeof vi.fn>,
    policy: deps.dispatchPolicy as ReturnType<typeof vi.fn>, // C12
    configure, // C12
    stop: configure.stop, // C12
    change(next: Settings) {
      settings = next;
      settingsListeners.forEach((l) => l(next));
    },
    moveHost(state: HostState['state']) {
      current = host(state);
      stateListeners.forEach((l) => l(current));
    },
    listeners: () => settingsListeners.size + stateListeners.size,
  };
}

describe('engine.configure is sent after the settings load and on every change of settings.engine', () => {
  it('sends the configuration once the engine host is ready, and again each time it is ready after a restart', async () => { // C12: async
    const h = harness('starting');
    expect(h.dispatch).not.toHaveBeenCalled();
    h.moveHost('ready');
    expect(h.dispatch).toHaveBeenCalledExactlyOnceWith({ binaryPath: null, expectedVersion: '2.1.283' });
    h.moveHost('crashed');
    h.moveHost('restarting');
    h.moveHost('ready');
    await vi.waitFor(() => expect(h.dispatch).toHaveBeenCalledTimes(2)); // a restarted host starts unconfigured (C12: once the push in flight is answered)
  });

  it('sends at once when the host is already ready', () => {
    expect(harness('ready').dispatch).toHaveBeenCalledOnce();
  });

  it('sends on a change of the binary path or the pin, and not on any other change', async () => { // C12: async, one push at a time
    const h = harness('ready');
    h.change({ ...SETTINGS_DEFAULTS_V4, theme: 'dark', gateway: { ...SETTINGS_DEFAULTS_V4.gateway, relayUnreachable: 'wait' } });
    h.change({ ...SETTINGS_DEFAULTS_V4, engine: { ...SETTINGS_DEFAULTS_V4.engine, subagentModel: 'haiku' } }); // C10's launch reads it, not the host
    expect(h.dispatch).toHaveBeenCalledOnce();
    h.change({ ...SETTINGS_DEFAULTS_V4, engine: { ...SETTINGS_DEFAULTS_V4.engine /* C12 */, binaryPath: '/opt/claude', pinnedVersion: '2.1.283', subagentModel: null } });
    await h.configure.applied(); // C12
    h.change({ ...SETTINGS_DEFAULTS_V4, engine: { ...SETTINGS_DEFAULTS_V4.engine /* C12 */, binaryPath: '/opt/claude', pinnedVersion: '2.1.290', subagentModel: null } });
    await h.configure.applied(); // C12
    expect(h.dispatch.mock.calls).toEqual([
      [{ binaryPath: null, expectedVersion: '2.1.283' }],
      [{ binaryPath: '/opt/claude', expectedVersion: '2.1.283' }],
      [{ binaryPath: '/opt/claude', expectedVersion: '2.1.290' }],
    ]);
  });

  it('logs a refused or failed send and keeps going; stop unsubscribes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dispatch = vi.fn(async (): Promise<CommandResult<'engine.configure'>> => ({ ok: false, error: { code: 'host_unavailable', message: 'engine-host is crashed' } }));
    const h = harness('ready', dispatch);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[settings] engine.configure failed', expect.objectContaining({ code: 'host_unavailable' })));
    dispatch.mockRejectedValueOnce(new Error('port closed'));
    h.moveHost('ready');
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[settings] engine.configure failed', expect.any(Error)));
    h.stop();
    expect(h.listeners()).toBe(0);
    warn.mockRestore();
  });
});

// C12 start: the memory budget's policy (C12 execution document, Interfaces "Settings, version 4"): pushed whenever the
// host is ready and whenever the budget or the stateful list changes; the default is 25% of physical memory.
describe('engine.policy.set follows settings.engine’s budget and stateful servers', () => {
  const engine = (over: Partial<Settings['engine']>): Settings => ({ ...SETTINGS_DEFAULTS_V4, engine: { ...SETTINGS_DEFAULTS_V4.engine, ...over } });

  it('pushes the default (25% of physical memory, no stateful servers) once the host is ready, and again after a restart', () => {
    const h = harness('starting');
    expect(h.policy).not.toHaveBeenCalled();
    h.moveHost('ready');
    expect(h.policy).toHaveBeenCalledExactlyOnceWith({ limitKiB: DEFAULT_LIMIT_KIB, statefulMcpServers: [] });
    h.moveHost('crashed');
    h.moveHost('ready');
    expect(h.policy).toHaveBeenCalledTimes(2);
  });

  it('pushes at once when the host is already ready', () => {
    expect(harness('ready').policy).toHaveBeenCalledOnce();
  });

  it('pushes on a change of the budget or the stateful list, in KiB, and on nothing else', () => {
    const h = harness('ready');
    h.change({ ...SETTINGS_DEFAULTS_V4, theme: 'dark' });
    h.change(engine({ subagentModel: 'haiku' }));
    h.change(engine({ binaryPath: '/opt/claude' })); // the binary's own push, not the policy's
    expect(h.policy).toHaveBeenCalledOnce();
    h.change(engine({ binaryPath: '/opt/claude', memoryBudgetMiB: 6144 }));
    h.change(engine({ binaryPath: '/opt/claude', memoryBudgetMiB: 6144, statefulMcpServers: ['c12-kernel'] }));
    h.change(engine({ binaryPath: '/opt/claude', memoryBudgetMiB: 6144, statefulMcpServers: ['c12-kernel'] })); // the same again
    h.change(engine({ binaryPath: '/opt/claude', memoryBudgetMiB: null, statefulMcpServers: ['c12-kernel'] }));
    expect(h.policy.mock.calls).toEqual([
      [{ limitKiB: DEFAULT_LIMIT_KIB, statefulMcpServers: [] }],
      [{ limitKiB: 6144 * 1024, statefulMcpServers: [] }],
      [{ limitKiB: 6144 * 1024, statefulMcpServers: ['c12-kernel'] }],
      [{ limitKiB: DEFAULT_LIMIT_KIB, statefulMcpServers: ['c12-kernel'] }],
    ]);
  });

  it('logs a refused push and keeps going', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness('starting');
    h.policy.mockResolvedValueOnce({ ok: false, error: { code: 'host_unavailable', message: 'engine-host is crashed' } });
    h.moveHost('ready');
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[settings] engine.policy.set failed', expect.objectContaining({ code: 'host_unavailable' })));
    h.moveHost('ready');
    expect(h.policy).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
// C12 end

// C12 start: MAWS's custody of the pinned engine (C12 execution document, Interfaces "Engine custody", Configure). Main
// is the only sender of `engine.configure`: every push waits for custody's answer for the pin and carries
// `settings.engine.binaryPath ?? custody.path`, never null; a pin change runs custody for the new version before its
// push; pushes are serialized, the latest settings winning; `applied` answers `settings.engineApplied`, and the launch
// gate waits for custody and the first push's answer before it reads the verdict.
describe('custody: main configures the host with the copy MAWS keeps', () => {
  const PATH = (version: string) => `/u/engine/${version}/claude`;
  const ok = (version: string): Custody => ({ state: 'ok', path: PATH(version), manifest: { version, sha256: 'd8cb1e5c', size: 1, source: `/src/${version}`, copiedAt: 't' } });
  const missing = (version: string): Custody => ({ state: 'missing', path: PATH(version), message: `Claude Code ${version} is missing from MAWS's copy` });
  const engine = (over: Partial<Settings['engine']>): Settings => ({ ...SETTINGS_DEFAULTS_V4, engine: { ...SETTINGS_DEFAULTS_V4.engine, ...over } });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  // custody answers when the test says, per version
  function custodyGate() {
    const pending = new Map<string, (c: Custody) => void>();
    const custody = vi.fn((version: string) => new Promise<Custody>((resolve) => pending.set(version, resolve)));
    return { custody, answer: (version: string, c: Custody = ok(version)) => pending.get(version)!(c) };
  }

  it('sends nothing before custody answers, then the copy’s path, never null', async () => {
    const c = custodyGate();
    const h = harness('ready', undefined, c.custody);
    expect(c.custody).toHaveBeenCalledExactlyOnceWith('2.1.283');
    await flush();
    expect(h.dispatch).not.toHaveBeenCalled();
    c.answer('2.1.283');
    await vi.waitFor(() => expect(h.dispatch).toHaveBeenCalledExactlyOnceWith({ binaryPath: PATH('2.1.283'), expectedVersion: '2.1.283' }));
    await expect(h.configure.custody()).resolves.toEqual(ok('2.1.283'));
  });

  it('a chosen binary path goes as chosen; "Use default" puts the copy back, not null', async () => {
    const c = custodyGate();
    const h = harness('ready', undefined, c.custody);
    c.answer('2.1.283');
    await vi.waitFor(() => expect(h.dispatch).toHaveBeenCalledOnce());
    h.change(engine({ binaryPath: '/opt/claude' }));
    await h.configure.applied();
    h.change(engine({ binaryPath: null }));
    await h.configure.applied();
    expect(h.dispatch.mock.calls.map(([config]) => config.binaryPath)).toEqual([PATH('2.1.283'), '/opt/claude', PATH('2.1.283')]);
  });

  it('a pin change runs custody for the new version before its push', async () => {
    const c = custodyGate();
    const h = harness('ready', undefined, c.custody);
    c.answer('2.1.283');
    await vi.waitFor(() => expect(h.dispatch).toHaveBeenCalledOnce());
    h.change(engine({ pinnedVersion: '2.1.290' }));
    expect(c.custody).toHaveBeenLastCalledWith('2.1.290');
    await flush();
    expect(h.dispatch).toHaveBeenCalledOnce(); // held for custody
    const applied = h.configure.applied();
    c.answer('2.1.290');
    await applied;
    expect(h.dispatch).toHaveBeenLastCalledWith({ binaryPath: PATH('2.1.290'), expectedVersion: '2.1.290' });
  });

  it('pushes one at a time, the latest settings winning', async () => {
    let answer!: () => void;
    const dispatch = vi.fn((config: { binaryPath: string | null; expectedVersion: string }) => new Promise<CommandResult<'engine.configure'>>((resolve) => (answer = () => resolve({ ok: true, value: { ...INFO, path: config.binaryPath ?? INFO.path } }))));
    const h = harness('ready', dispatch, async (version) => ok(version));
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
    h.change(engine({ binaryPath: '/opt/a' }));
    h.change(engine({ binaryPath: '/opt/b' }));
    await flush();
    expect(dispatch).toHaveBeenCalledOnce(); // the first is still in flight
    answer();
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2));
    expect(dispatch).toHaveBeenLastCalledWith({ binaryPath: '/opt/b', expectedVersion: '2.1.283' });
    answer();
    await h.configure.applied();
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('pushes again at every host generation, still with the copy', async () => {
    const h = harness('starting', undefined, async (version) => ok(version));
    h.moveHost('ready');
    await vi.waitFor(() => expect(h.dispatch).toHaveBeenCalledOnce());
    h.moveHost('crashed');
    h.moveHost('restarting');
    h.moveHost('ready');
    await vi.waitFor(() => expect(h.dispatch).toHaveBeenCalledTimes(2));
    expect(h.dispatch.mock.calls.every(([config]) => config.binaryPath === PATH('2.1.283'))).toBe(true);
  });

  it('applied answers once the push for the settings as they stand is answered; its error carries custody’s or the push’s message', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = custodyGate();
    const dispatch = vi.fn(async (config: { binaryPath: string | null }): Promise<CommandResult<'engine.configure'>> =>
      config.binaryPath === '/opt/refused' ? { ok: false, error: { code: 'invalid_input', message: 'the host refused it' } } : { ok: true, value: INFO });
    const h = harness('ready', dispatch, c.custody);
    let done = false;
    const applied = h.configure.applied().then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    c.answer('2.1.283');
    await applied;
    h.change(engine({ pinnedVersion: '2.1.290' }));
    const refused = h.configure.applied();
    c.answer('2.1.290', missing('2.1.290'));
    await expect(refused).rejects.toThrow("Claude Code 2.1.290 is missing from MAWS's copy");
    expect(dispatch).toHaveBeenLastCalledWith({ binaryPath: PATH('2.1.290'), expectedVersion: '2.1.290' }); // the host still follows the pin
    h.change(engine({ pinnedVersion: '2.1.290', binaryPath: '/opt/refused' }));
    await expect(h.configure.applied()).rejects.toThrow('the host refused it');
    warn.mockRestore();
  });

  it('the launch gate waits for custody and the first push’s answer, then answers custody’s refusal', async () => {
    const c = custodyGate();
    let answerPush!: () => void;
    const dispatch = vi.fn(() => new Promise<CommandResult<'engine.configure'>>((resolve) => (answerPush = () => resolve({ ok: true, value: INFO }))));
    const h = harness('ready', dispatch, c.custody);
    let verdict: unknown = 'waiting';
    void h.configure.launchGate().then((v) => (verdict = v));
    c.answer('2.1.283', missing('2.1.283'));
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
    await flush();
    expect(verdict).toBe('waiting'); // custody answered, the push has not
    answerPush();
    await vi.waitFor(() => expect(verdict).toEqual({ status: 'refused', reason: 'binary_missing', message: "Claude Code 2.1.283 is missing from MAWS's copy" }));
  });

  it('the gate passes for an ok copy and for a binary path the owner chose, which is used without custody', async () => {
    const h = harness('ready', undefined, async (version) => (version === '2.1.283' ? ok(version) : missing(version)));
    await expect(h.configure.launchGate()).resolves.toBeNull();
    h.change(engine({ pinnedVersion: '2.1.290' }));
    await expect(h.configure.launchGate()).resolves.toMatchObject({ reason: 'binary_missing' });
    h.change(engine({ pinnedVersion: '2.1.290', binaryPath: '/opt/claude' }));
    await expect(h.configure.launchGate()).resolves.toBeNull();
  });

  it('a crashed host does not hold the gate: it answers custody’s verdict', async () => {
    const h = harness('crashed', undefined, async (version) => missing(version));
    await expect(h.configure.launchGate()).resolves.toMatchObject({ reason: 'binary_missing' });
  });

  it('without custody (MAWS_E2E, replay) the gate passes at once, custody answers null and the host keeps ENGINE_BIN (binaryPath null)', async () => {
    const h = harness('starting');
    await expect(h.configure.launchGate()).resolves.toBeNull();
    await expect(h.configure.custody()).resolves.toBeNull();
    h.moveHost('ready');
    expect(h.dispatch).toHaveBeenCalledExactlyOnceWith({ binaryPath: null, expectedVersion: '2.1.283' });
    await h.configure.applied();
  });
});
// C12 end
