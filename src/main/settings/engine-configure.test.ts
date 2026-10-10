import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'; // C12: afterEach, beforeEach
import type { CommandResult, HostState, Settings } from '@shared/ipc/schema';
import { SETTINGS_DEFAULTS_V13 } from '@shared/settings/defaults';
import { CONFIGURE_WAIT_MS, startEngineConfigure, type EngineConfigureDeps } from './engine-configure'; // C12: CONFIGURE_WAIT_MS
import { REQUEST_TIMEOUT_MS, RESTART_BACKOFF_MS } from '../hosts/supervisor'; // C12

const INFO = { path: '/Users/u/.local/share/claude/versions/2.1.287', testedVersion: '2.1.283', version: '2.1.287', ok: true, error: null };
const host = (state: HostState['state']): HostState => ({ state, pid: state === 'ready' ? 1 : null, restarts: 0, revision: 0 });

// C12: the owner's Mac, 32 GiB: 25% is 8 GiB
const TOTAL_MEM = 32 * 1024 ** 3;
const DEFAULT_LIMIT_KIB = 8 * 1024 * 1024;

function harness(initial: HostState['state'] = 'starting', dispatch?: EngineConfigureDeps['dispatch']) {
  let settings: Settings = SETTINGS_DEFAULTS_V13;
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

  it('sends on a change of the binary path, and not on any other change', async () => { // C12: async, one push at a time
    const h = harness('ready');
    h.change({ ...SETTINGS_DEFAULTS_V13, theme: 'dark', gateway: { ...SETTINGS_DEFAULTS_V13.gateway, relayUnreachable: 'wait' } });
    h.change({ ...SETTINGS_DEFAULTS_V13, engine: { ...SETTINGS_DEFAULTS_V13.engine, subagentModel: 'haiku' } }); // C10's launch reads it, not the host
    expect(h.dispatch).toHaveBeenCalledOnce();
    h.change({ ...SETTINGS_DEFAULTS_V13, engine: { ...SETTINGS_DEFAULTS_V13.engine /* C12 */, binaryPath: '/opt/claude', subagentModel: null } });
    await h.configure.applied(); // C12
    h.change({ ...SETTINGS_DEFAULTS_V13, engine: { ...SETTINGS_DEFAULTS_V13.engine /* C12 */, binaryPath: '/opt/claude', subagentModel: 'sonnet' } });
    await h.configure.applied(); // C12
    expect(h.dispatch.mock.calls).toEqual([
      [{ binaryPath: null }],
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
  const engine = (over: Partial<Settings['engine']>): Settings => ({ ...SETTINGS_DEFAULTS_V13, engine: { ...SETTINGS_DEFAULTS_V13.engine, ...over } });

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
    h.change({ ...SETTINGS_DEFAULTS_V13, theme: 'dark' });
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

// C12 start: main is the only sender of `engine.configure` (C12 execution document, Interfaces "X2 additions"). W13:
// custody is retired, so every push carries `settings.engine.binaryPath` as it stands (null, the installed Claude Code,
// which the host resolves per launch); pushes are serialized, the latest settings winning; `applied` answers
// `settings.engineApplied`, and the launch gate waits for the push for the settings as they stand.
describe('main configures the host with the chosen binary or the installed one', () => {
  const engine = (over: Partial<Settings['engine']>): Settings => ({ ...SETTINGS_DEFAULTS_V13, engine: { ...SETTINGS_DEFAULTS_V13.engine, ...over } });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('a chosen binary path goes as chosen; "Use installed" sends null again', async () => {
    const h = harness('ready');
    await h.configure.applied();
    h.change(engine({ binaryPath: '/opt/claude' }));
    await h.configure.applied();
    h.change(engine({ binaryPath: null }));
    await h.configure.applied();
    expect(h.dispatch.mock.calls.map(([config]) => config)).toEqual([{ binaryPath: null }, { binaryPath: '/opt/claude' }, { binaryPath: null }]);
  });

  it('pushes one at a time, the latest settings winning', async () => {
    let answer!: () => void;
    const dispatch = vi.fn((config: { binaryPath: string | null }) => new Promise<CommandResult<'engine.configure'>>((resolve) => (answer = () => resolve({ ok: true, value: { ...INFO, path: config.binaryPath ?? INFO.path } }))));
    const h = harness('ready', dispatch);
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

  it('pushes again at every host generation', async () => {
    const h = harness('starting');
    h.change(engine({ binaryPath: '/opt/claude' }));
    h.moveHost('ready');
    await vi.waitFor(() => expect(h.dispatch).toHaveBeenCalledOnce());
    h.moveHost('crashed');
    h.moveHost('restarting');
    h.moveHost('ready');
    await vi.waitFor(() => expect(h.dispatch).toHaveBeenCalledTimes(2));
    expect(h.dispatch.mock.calls.every(([config]) => config.binaryPath === '/opt/claude')).toBe(true);
  });

  it('applied answers once the push for the settings as they stand is answered; its error carries the push’s message', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let answerFirst!: () => void;
    const dispatch = vi.fn((config: { binaryPath: string | null }): Promise<CommandResult<'engine.configure'>> => {
      if (config.binaryPath === '/opt/refused') return Promise.resolve({ ok: false, error: { code: 'invalid_input', message: 'the host refused it' } });
      return new Promise((resolve) => (answerFirst = () => resolve({ ok: true, value: INFO })));
    });
    const h = harness('ready', dispatch);
    let done = false;
    const applied = h.configure.applied().then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    answerFirst();
    await applied;
    h.change(engine({ binaryPath: '/opt/refused' }));
    await expect(h.configure.applied()).rejects.toThrow('the host refused it');
    warn.mockRestore();
  });

  it('the launch gate waits for the push for the settings as they stand, so a launch right after a change runs the new binary', async () => {
    let answerPush!: () => void;
    const dispatch = vi.fn(() => new Promise<CommandResult<'engine.configure'>>((resolve) => (answerPush = () => resolve({ ok: true, value: INFO }))));
    const h = harness('ready', dispatch);
    answerPush();
    await expect(h.configure.launchGate()).resolves.toBeNull();
    h.change(engine({ binaryPath: '/opt/claude' }));
    let verdict: unknown = 'waiting';
    void h.configure.launchGate().then((v) => (verdict = v));
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2));
    await flush();
    expect(verdict).toBe('waiting'); // the host does not hold the chosen path yet
    answerPush();
    await vi.waitFor(() => expect(verdict).toBeNull());
  });

  // review fix: the gate fails closed; a crashed host holds no configuration, so nothing launches, at once and in words
  it('a crashed host refuses at once, naming its state; applied rejects the same way, even for a change made while it is down', async () => {
    const h = harness('crashed');
    await expect(h.configure.launchGate()).resolves.toEqual({ status: 'refused', reason: 'host_unavailable', message: 'The engine host is crashed and holds no engine configuration. Restart MAWS.' });
    h.change(engine({ binaryPath: '/opt/claude' }));
    await expect(h.configure.applied()).rejects.toThrow('The engine host is crashed and holds no engine configuration. Restart MAWS.');
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  // review fix: answered is not applied; a host whose configure push failed may hold another binary
  it('a failed push refuses the gate with the push’s words; a later push that lands lets it pass', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dispatch = vi.fn(async (): Promise<CommandResult<'engine.configure'>> => ({ ok: false, error: { code: 'timeout', message: 'engine-host did not answer engine.configure within 10 s' } }));
    const h = harness('ready', dispatch);
    await expect(h.configure.launchGate()).resolves.toEqual({ status: 'refused', reason: 'host_unavailable', message: 'The engine host did not take the engine configuration: engine-host did not answer engine.configure within 10 s' });
    await expect(h.configure.applied()).rejects.toThrow('engine-host did not answer engine.configure within 10 s');
    dispatch.mockResolvedValue({ ok: true, value: INFO });
    h.moveHost('restarting');
    h.moveHost('ready');
    await expect(h.configure.launchGate()).resolves.toBeNull();
    warn.mockRestore();
  });
});

// The waits are bounded (M4 review fix): a host that never becomes ready refuses the launch and fails `applied` after
// CONFIGURE_WAIT_MS with words naming what was waited on, instead of leaving a setup at "Starting" or the Settings tab
// waiting for good.
describe('the gate and applied give up after CONFIGURE_WAIT_MS', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is 30 s, well past the supervisor’s longest restart backoff and its 10 s request timeout', () => {
    expect(CONFIGURE_WAIT_MS).toBe(30_000);
    expect(CONFIGURE_WAIT_MS).toBeGreaterThan(Math.max(...RESTART_BACKOFF_MS) + REQUEST_TIMEOUT_MS);
  });

  it('a host still starting: the gate refuses naming its state, and applied rejects the same way', async () => {
    const h = harness('starting');
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
    const h = harness('restarting');
    const gate = h.configure.launchGate();
    await vi.advanceTimersByTimeAsync(CONFIGURE_WAIT_MS);
    await expect(gate).resolves.toMatchObject({ reason: 'host_unavailable', message: expect.stringContaining('The engine host is restarting') });
  });

  it('a host that becomes ready within the bound answers as before, with no refusal', async () => {
    const h = harness('starting');
    const gate = h.configure.launchGate();
    await vi.advanceTimersByTimeAsync(CONFIGURE_WAIT_MS - 1_000);
    h.moveHost('ready');
    await vi.advanceTimersByTimeAsync(0);
    await expect(gate).resolves.toBeNull();
    await expect(h.configure.applied()).resolves.toBeUndefined();
  });
});
// C12 end
