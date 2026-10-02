import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'; // C12: afterEach, beforeEach
import type { CommandResult, HostState, Settings } from '@shared/ipc/schema';
import { SETTINGS_DEFAULTS_V7 } from '@shared/settings/defaults';
import { CONFIGURE_WAIT_MS, startEngineConfigure, type EngineConfigureDeps } from './engine-configure'; // C12: CONFIGURE_WAIT_MS
import { REQUEST_TIMEOUT_MS, RESTART_BACKOFF_MS } from '../hosts/supervisor'; // C12
import type { Custody } from '../engine/custody'; // C12

const INFO = { path: '/Users/new/.local/share/claude/versions/2.1.283', testedVersion: '2.1.283', version: '2.1.283', ok: true, error: null };
const host = (state: HostState['state']): HostState => ({ state, pid: state === 'ready' ? 1 : null, restarts: 0, revision: 0 });

// C12: the owner's Mac, 32 GiB: 25% is 8 GiB
const TOTAL_MEM = 32 * 1024 ** 3;
const DEFAULT_LIMIT_KIB = 8 * 1024 * 1024;

function harness(initial: HostState['state'] = 'starting', dispatch?: EngineConfigureDeps['dispatch'], custody?: EngineConfigureDeps['custody'] /* C12 */) {
  let settings: Settings = SETTINGS_DEFAULTS_V7;
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
    dispatchPolicy: vi.fn(async (policy): Promise<CommandResult<'engine.policy.set'>> => ({ ok: true, value: { enabled: true, limitKiB: policy.limitKiB, totalKiB: 0, sampledAt: null, over: false, overWithoutCandidate: false, candidates: 0, settling: 0, releasing: null, blocked: [], lastRelease: null } })),
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
    expect(h.dispatch).toHaveBeenCalledExactlyOnceWith({ binaryPath: null });
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
    h.change({ ...SETTINGS_DEFAULTS_V7, theme: 'dark', gateway: { ...SETTINGS_DEFAULTS_V7.gateway, relayUnreachable: 'wait' } });
    h.change({ ...SETTINGS_DEFAULTS_V7, engine: { ...SETTINGS_DEFAULTS_V7.engine, subagentModel: 'haiku' } }); // C10's launch reads it, not the host
    expect(h.dispatch).toHaveBeenCalledOnce();
    h.change({ ...SETTINGS_DEFAULTS_V7, engine: { ...SETTINGS_DEFAULTS_V7.engine /* C12 */, binaryPath: '/opt/claude', pinnedVersion: '2.1.283', subagentModel: null } });
    await h.configure.applied(); // C12
    h.change({ ...SETTINGS_DEFAULTS_V7, engine: { ...SETTINGS_DEFAULTS_V7.engine /* C12 */, binaryPath: '/opt/claude', pinnedVersion: '2.1.290', subagentModel: null } });
    await h.configure.applied(); // C12
    expect(h.dispatch.mock.calls).toEqual([
      [{ binaryPath: null }],
      [{ binaryPath: '/opt/claude' }],
      [{ binaryPath: '/opt/claude' }],
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
  const engine = (over: Partial<Settings['engine']>): Settings => ({ ...SETTINGS_DEFAULTS_V7, engine: { ...SETTINGS_DEFAULTS_V7.engine, ...over } });

  it('pushes the default (25% of physical memory, no stateful servers) once the host is ready, and again after a restart', () => {
    const h = harness('starting');
    expect(h.policy).not.toHaveBeenCalled();
    h.moveHost('ready');
    expect(h.policy).toHaveBeenCalledExactlyOnceWith({ enabled: true, limitKiB: DEFAULT_LIMIT_KIB, statefulMcpServers: [] });
    h.moveHost('crashed');
    h.moveHost('ready');
    expect(h.policy).toHaveBeenCalledTimes(2);
  });

  it('pushes at once when the host is already ready', () => {
    expect(harness('ready').policy).toHaveBeenCalledOnce();
  });

  it('pushes on a change of the budget or the stateful list, in KiB, and on nothing else', () => {
    const h = harness('ready');
    h.change({ ...SETTINGS_DEFAULTS_V7, theme: 'dark' });
    h.change(engine({ subagentModel: 'haiku' }));
    h.change(engine({ binaryPath: '/opt/claude' })); // the binary's own push, not the policy's
    expect(h.policy).toHaveBeenCalledOnce();
    h.change(engine({ binaryPath: '/opt/claude', memoryBudgetMiB: 6144 }));
    h.change(engine({ binaryPath: '/opt/claude', memoryBudgetMiB: 6144, statefulMcpServers: ['c12-kernel'] }));
    h.change(engine({ binaryPath: '/opt/claude', memoryBudgetMiB: 6144, statefulMcpServers: ['c12-kernel'] })); // the same again
    h.change(engine({ binaryPath: '/opt/claude', memoryBudgetMiB: null, statefulMcpServers: ['c12-kernel'] }));
    expect(h.policy.mock.calls).toEqual([
      [{ enabled: true, limitKiB: DEFAULT_LIMIT_KIB, statefulMcpServers: [] }],
      [{ enabled: true, limitKiB: 6144 * 1024, statefulMcpServers: [] }],
      [{ enabled: true, limitKiB: 6144 * 1024, statefulMcpServers: ['c12-kernel'] }],
      [{ enabled: true, limitKiB: DEFAULT_LIMIT_KIB, statefulMcpServers: ['c12-kernel'] }],
    ]);
  });

  // W7: settings version 7's switch travels as the policy's `enabled`, with the limit either way; a toggle is a change
  it('pushes the switch as enabled with the limit kept, on every toggle and on nothing else', () => {
    const h = harness('ready');
    const off = (over: Partial<Settings['engine']> = {}) => engine({ memoryBudget: { enabled: false }, ...over });
    h.change(off());
    h.change(off()); // the same again
    h.change(off({ memoryBudgetMiB: 6144 })); // the limit still travels while off
    h.change(engine({ memoryBudgetMiB: 6144 }));
    expect(h.policy.mock.calls.slice(1)).toEqual([
      [{ enabled: false, limitKiB: DEFAULT_LIMIT_KIB, statefulMcpServers: [] }],
      [{ enabled: false, limitKiB: 6144 * 1024, statefulMcpServers: [] }],
      [{ enabled: true, limitKiB: 6144 * 1024, statefulMcpServers: [] }],
    ]);
  });

  it('tells a restarted host the switch as the settings hold it', () => {
    const h = harness('ready');
    h.change(engine({ memoryBudget: { enabled: false } }));
    h.moveHost('crashed');
    h.moveHost('ready');
    expect(h.policy.mock.calls.at(-1)).toEqual([{ enabled: false, limitKiB: DEFAULT_LIMIT_KIB, statefulMcpServers: [] }]);
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
  const engine = (over: Partial<Settings['engine']>): Settings => ({ ...SETTINGS_DEFAULTS_V7, engine: { ...SETTINGS_DEFAULTS_V7.engine, ...over } });
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
    await vi.waitFor(() => expect(h.dispatch).toHaveBeenCalledExactlyOnceWith({ binaryPath: PATH('2.1.283') }));
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
    expect(h.dispatch).toHaveBeenLastCalledWith({ binaryPath: PATH('2.1.290') });
  });

  it('pushes one at a time, the latest settings winning', async () => {
    let answer!: () => void;
    const dispatch = vi.fn((config: { binaryPath: string | null }) => new Promise<CommandResult<'engine.configure'>>((resolve) => (answer = () => resolve({ ok: true, value: { ...INFO, path: config.binaryPath ?? INFO.path } }))));
    const h = harness('ready', dispatch, async (version) => ok(version));
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
    h.change(engine({ binaryPath: '/opt/a' }));
    h.change(engine({ binaryPath: '/opt/b' }));
    await flush();
    expect(dispatch).toHaveBeenCalledOnce(); // the first is still in flight
    answer();
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2));
    expect(dispatch).toHaveBeenLastCalledWith({ binaryPath: '/opt/b' });
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
    expect(dispatch).toHaveBeenLastCalledWith({ binaryPath: PATH('2.1.290') }); // the host still follows the pin
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

  // review fix: the gate fails closed; a crashed host holds no configuration, so nothing launches, at once and in words
  it('a crashed host refuses at once, naming its state; applied rejects the same way, even for a change made while it is down', async () => {
    const h = harness('crashed', undefined, async (version) => ok(version));
    await expect(h.configure.launchGate()).resolves.toEqual({ status: 'refused', reason: 'host_unavailable', message: 'The engine host is crashed and holds no engine configuration. Restart MAWS.' });
    h.change(engine({ binaryPath: '/opt/claude' }));
    await expect(h.configure.applied()).rejects.toThrow('The engine host is crashed and holds no engine configuration. Restart MAWS.');
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  // review fix: answered is not applied; a host whose configure push failed still holds its installer default
  it('a failed push refuses the gate with the push’s words, though custody is ok; a later push that lands lets it pass', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dispatch = vi.fn(async (): Promise<CommandResult<'engine.configure'>> => ({ ok: false, error: { code: 'timeout', message: 'engine-host did not answer engine.configure within 10 s' } }));
    const h = harness('ready', dispatch, async (version) => ok(version));
    await expect(h.configure.launchGate()).resolves.toEqual({ status: 'refused', reason: 'host_unavailable', message: 'The engine host did not take the engine configuration: engine-host did not answer engine.configure within 10 s' });
    await expect(h.configure.applied()).rejects.toThrow('engine-host did not answer engine.configure within 10 s');
    dispatch.mockResolvedValue({ ok: true, value: INFO });
    h.moveHost('restarting');
    h.moveHost('ready');
    await expect(h.configure.launchGate()).resolves.toBeNull();
    warn.mockRestore();
  });

  // review fix: an unexpected custody failure is the coordinator's bounded error, never an unhandled rejection
  it('a custody that rejects pushes nothing without a chosen path, refuses the gate with its words, and rejects applied and custody', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const h = harness('ready', undefined, () => Promise.reject(new Error('EIO: i/o error')));
      const refusal = { status: 'refused', reason: 'binary_missing', message: "MAWS could not check its copy of Claude Code 2.1.283 (EIO: i/o error). Restart MAWS, or choose a binary path in Settings › Engine." };
      await expect(h.configure.launchGate()).resolves.toEqual(refusal);
      await expect(h.configure.applied()).rejects.toThrow(refusal.message);
      await expect(h.configure.custody()).rejects.toThrow(refusal.message);
      expect(h.dispatch).not.toHaveBeenCalled(); // never binaryPath null: the host would fall back to the installer's file
      h.change(engine({ binaryPath: '/opt/claude' }));
      await h.configure.applied(); // a chosen path goes as chosen
      expect(h.dispatch).toHaveBeenCalledExactlyOnceWith({ binaryPath: '/opt/claude' });
      await expect(h.configure.launchGate()).resolves.toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
      warn.mockRestore();
    }
  });

  it('without custody (MAWS_E2E, replay) the gate passes at once, custody answers null and the host keeps ENGINE_BIN (binaryPath null)', async () => {
    const h = harness('starting');
    await expect(h.configure.launchGate()).resolves.toBeNull();
    await expect(h.configure.custody()).resolves.toBeNull();
    h.moveHost('ready');
    expect(h.dispatch).toHaveBeenCalledExactlyOnceWith({ binaryPath: null });
    await h.configure.applied();
  });
});

// The waits are bounded (M4 review fix): a host that never becomes ready, or a copy still being made, refuses the launch
// and fails `applied` after CONFIGURE_WAIT_MS with words naming what was waited on, instead of leaving a setup at
// "Starting" or the Settings tab waiting for good.
describe('the gate and applied give up after CONFIGURE_WAIT_MS', () => {
  const ok = (version: string): Custody => ({ state: 'ok', path: `/u/engine/${version}/claude`, manifest: { version, sha256: 'x', size: 1, source: '/s', copiedAt: 't' } });
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is 30 s, well past the supervisor’s longest restart backoff and its 10 s request timeout', () => {
    expect(CONFIGURE_WAIT_MS).toBe(30_000);
    expect(CONFIGURE_WAIT_MS).toBeGreaterThan(Math.max(...RESTART_BACKOFF_MS) + REQUEST_TIMEOUT_MS);
  });

  it('a host still starting: the gate refuses naming its state, and applied rejects the same way', async () => {
    const h = harness('starting', undefined, async (version) => ok(version));
    const gate = h.configure.launchGate();
    const applied = h.configure.applied();
    applied.catch(() => {}); // asserted below, after the clock moves
    await vi.advanceTimersByTimeAsync(CONFIGURE_WAIT_MS - 1);
    let answered = false;
    void gate.then(() => (answered = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(answered).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(gate).resolves.toEqual({ status: 'refused', reason: 'host_unavailable', message: 'The engine host is starting and did not take the engine configuration within 30 s. Try again once it is ready, or restart MAWS.' });
    await expect(applied).rejects.toThrow('The engine host is starting and did not take the engine configuration within 30 s.');
  });

  it('a host restarting when the first push never went out is named as restarting', async () => {
    const h = harness('restarting', undefined, async (version) => ok(version));
    const gate = h.configure.launchGate();
    await vi.advanceTimersByTimeAsync(CONFIGURE_WAIT_MS);
    await expect(gate).resolves.toMatchObject({ reason: 'host_unavailable', message: expect.stringContaining('The engine host is restarting') });
  });

  it('a copy still being made is named as such, whatever the host', async () => {
    const h = harness('ready', undefined, () => new Promise<Custody>(() => {}));
    const gate = h.configure.launchGate();
    const applied = h.configure.applied();
    applied.catch(() => {});
    await vi.advanceTimersByTimeAsync(CONFIGURE_WAIT_MS);
    await expect(gate).resolves.toEqual({ status: 'refused', reason: 'binary_missing', message: "MAWS's copy of Claude Code 2.1.283 was not ready within 30 s. Try again in a moment, or restart MAWS." });
    await expect(applied).rejects.toThrow("MAWS's copy of Claude Code 2.1.283 was not ready within 30 s.");
  });

  it('a host that becomes ready within the bound answers as before, with no refusal', async () => {
    const h = harness('starting', undefined, async (version) => ok(version));
    const gate = h.configure.launchGate();
    await vi.advanceTimersByTimeAsync(CONFIGURE_WAIT_MS - 1_000);
    h.moveHost('ready');
    await vi.advanceTimersByTimeAsync(0);
    await expect(gate).resolves.toBeNull();
    await expect(h.configure.applied()).resolves.toBeUndefined();
  });
});
// C12 end
