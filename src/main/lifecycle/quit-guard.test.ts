import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import { humanTurn, record, status } from '../../../test/support/builders';

// Electron's `app` as the guard sees it: `before-quit` listeners, and `quit()` firing `before-quit` again, as it does.
const electron = vi.hoisted(() => {
  const listeners: ((event: { preventDefault(): void; defaultPrevented: boolean }) => void)[] = [];
  const app = {
    quits: 0,
    on(name: string, listener: (typeof listeners)[number]) {
      if (name === 'before-quit') listeners.push(listener);
      return app;
    },
    // What a quit attempt does: `before-quit` goes to every listener; the quit proceeds unless one prevented it.
    attempt(): boolean {
      const event = { defaultPrevented: false, preventDefault: () => (event.defaultPrevented = true) };
      for (const listener of listeners) listener(event);
      return !event.defaultPrevented;
    },
    quit() {
      if (app.attempt()) app.quits += 1;
    },
    reset() {
      listeners.length = 0;
      app.quits = 0;
    },
  };
  return { app };
});
vi.mock('electron', () => ({ app: electron.app, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: vi.fn() } })); // C12: the sessions feed's imports

const { SessionReadModel } = await import('../sessions/read-model');
const { askToQuit, busyReport, installQuitGuard, KILL_PS_TIMEOUT_MS, quitQuestion, SHUTDOWN_BOUND_MS } = await import('./quit-guard');
const { hostEventSource } = await import('../sessions'); // C12

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const NONE = { midTurn: 0, backgroundWork: 0, busyTerminals: 0, terminalsUnknown: false };
const TASK = { taskId: 'b1' as never, taskType: 'local_bash', description: 'sleep 900', ambient: false };

// A read model holding the given engine statuses (C4's index source in the product; `apply` changes one later).
function modelWith(statuses: EngineSessionStatus[]) {
  const model = new SessionReadModel('index');
  let writer!: Parameters<Parameters<typeof model.register>[0]['start']>[0];
  model.register({
    start(w) {
      writer = w;
      for (const s of statuses) {
        w.observeRecord(record(s.appSessionId));
        w.applyEngineStatus(s);
      }
      return () => {};
    },
  });
  return Object.assign(model, { apply: (s: EngineSessionStatus) => writer.applyEngineStatus(s) });
}
const midTurn = (n: number) => Array.from({ length: n }, (_, i) => status(`s${i}` as AppSessionId, { process: 'ready', engineState: 'running', turn: humanTurn }));
const noEngines = { hostPid: () => null, ps: async () => '', kill: () => {} };
const noTerminals = { list: async () => [], foreground: async () => ({ busy: false }), hostGone: () => false };

beforeEach(() => electron.app.reset());

// C12 start: the busy report (C12 execution document, Interfaces "The quit question"; charter §3 P0 quit line, D8)
describe('the busy report', () => {
  it('counts sessions mid-turn or launching, sessions with background work that are not mid-turn, once each, and never ambient tasks', async () => {
    const model = modelWith([
      status('turn', { turn: humanTurn, backgroundTasks: [TASK] }), // mid-turn, counted there only
      status('launching', { process: 'initializing' }),
      status('bg', { backgroundTasks: [TASK] }),
      status('workflow', { backgroundTasks: [{ ...TASK, taskType: 'local_workflow' }] }),
      status('ambient', { backgroundTasks: [{ ...TASK, ambient: true }] }), // engine housekeeping (M1's rule)
      status('exited', { process: 'exited', backgroundTasks: [TASK] }),
      status('idle'),
    ]);
    expect(await busyReport(model, noTerminals)).toEqual({ midTurn: 2, backgroundWork: 2, busyTerminals: 0, terminalsUnknown: false });
  });

  // whole-branch review (P1): host work in flight with no turn, and an engine already running, are busy work
  it('counts a session with host work in flight or a running engine and no turn, once each, with its background work not twice', async () => {
    const model = modelWith([
      { ...status('bang'), busy: true }, // a `!` command still running after its turn closed
      status('engine', { engineState: 'running' }), // the engine began its own turn before `turn` opens
      status('asking', { engineState: 'requires_action' }),
      { ...status('both'), busy: true, backgroundTasks: [TASK] }, // counted once, as working
      status('bg', { backgroundTasks: [TASK] }),
      status('idle'),
    ]);
    expect(await busyReport(model, noTerminals)).toEqual({ midTurn: 4, backgroundWork: 1, busyTerminals: 0, terminalsUnknown: false });
  });

  it('asks every live terminal in parallel, and counts one that does not answer as busy', async () => {
    vi.useFakeTimers();
    try {
      const asked: string[] = [];
      const pty = {
        list: async () => [{ ptyId: 'a', alive: true }, { ptyId: 'b', alive: true }, { ptyId: 'c', alive: true }, { ptyId: 'dead', alive: false }],
        foreground: (id: string) => {
          asked.push(id);
          if (id === 'a') return Promise.resolve({ busy: true });
          if (id === 'b') return Promise.resolve({ busy: false });
          return new Promise<{ busy: boolean }>(() => {}); // c never answers
        },
        hostGone: () => false,
      };
      const report = busyReport(modelWith([]), pty);
      await vi.advanceTimersByTimeAsync(0);
      expect(asked).toEqual(['a', 'b', 'c']); // all at once, the exited one never
      await vi.advanceTimersByTimeAsync(2_000); // the probe bound
      expect(await report).toEqual({ midTurn: 0, backgroundWork: 0, busyTerminals: 2, terminalsUnknown: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts a failed probe busy', async () => {
    const failing = { list: async () => [{ ptyId: 'a', alive: true }], foreground: () => Promise.reject(new Error('pty-host is crashed')), hostGone: () => false };
    expect(await busyReport(modelWith([]), failing)).toMatchObject({ busyTerminals: 1, terminalsUnknown: false });
  });

  // review fix: a slow live pty host is not a gone one
  it('a list that does not answer from a live pty host is terminals of unknown state, asked about in those words', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const silent = { list: () => new Promise<never>(() => {}), foreground: async () => ({ busy: false }), hostGone: () => false };
      const report = busyReport(modelWith([]), silent);
      await vi.advanceTimersByTimeAsync(2_000);
      const r = await report;
      expect(r).toEqual({ midTurn: 0, backgroundWork: 0, busyTerminals: 1, terminalsUnknown: true });
      expect(quitQuestion(r, 'Quit').message).toBe('the terminals did not answer');
      const failed = { list: () => Promise.reject(new Error('timeout')), foreground: async () => ({ busy: false }), hostGone: () => false };
      expect(await busyReport(modelWith([]), failed)).toMatchObject({ busyTerminals: 1, terminalsUnknown: true });
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('counts no terminal only when the pty host is gone (its supervisor state), where its terminals went with it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gone = { list: () => Promise.reject(new Error('host_unavailable')), foreground: async () => ({ busy: true }), hostGone: () => true };
    expect(await busyReport(modelWith([]), gone)).toEqual({ midTurn: 0, backgroundWork: 0, busyTerminals: 0, terminalsUnknown: false });
    warn.mockRestore();
  });
});

describe('the question', () => {
  it('names only the non-zero parts, for one and for many', () => {
    expect(quitQuestion({ midTurn: 2, backgroundWork: 1, busyTerminals: 1, terminalsUnknown: false }, 'Quit')).toMatchObject({
      type: 'warning',
      message: '2 sessions mid-turn · 1 session running background work · 1 terminal running a command',
      detail: 'Quitting stops them. Transcripts stay on disk and can be resumed.',
      buttons: ['Quit', 'Quit when idle', 'Cancel'],
      defaultId: 2,
      cancelId: 2,
    });
    expect(quitQuestion({ midTurn: 1, backgroundWork: 0, busyTerminals: 3, terminalsUnknown: false }, 'Quit').message).toBe('1 session mid-turn · 3 terminals running a command');
    expect(quitQuestion({ midTurn: 0, backgroundWork: 2, busyTerminals: 0, terminalsUnknown: false }, 'Quit').message).toBe('2 sessions running background work');
  });

  it('is worded for the updater’s restart too (P1; not wired in P0)', () => {
    expect(quitQuestion({ midTurn: 1, backgroundWork: 0, busyTerminals: 0, terminalsUnknown: false }, 'Restart')).toMatchObject({
      buttons: ['Restart', 'Restart when idle', 'Cancel'],
      detail: 'Restarting stops them. Transcripts stay on disk and can be resumed.',
    });
  });

  it('under MAWS_E2E answers from MAWS_E2E_QUIT_ANSWER (quit by default) and logs the parts instead of showing the dialog', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const show = vi.fn();
    expect(await askToQuit({ ...NONE, midTurn: 4 }, { env: { MAWS_E2E: '1' }, show })).toBe('quit');
    expect(await askToQuit({ ...NONE, midTurn: 5 }, { env: { MAWS_E2E: '1', MAWS_E2E_QUIT_ANSWER: 'cancel' }, show })).toBe('cancel');
    expect(await askToQuit({ midTurn: 0, backgroundWork: 1, busyTerminals: 1, terminalsUnknown: false }, { env: { MAWS_E2E: '1', MAWS_E2E_QUIT_ANSWER: 'when_idle' }, show })).toBe('when_idle');
    expect(show).not.toHaveBeenCalled();
    expect(log.mock.calls.map(([line]) => line)).toEqual([
      'quit-guard: 4 mid-turn, auto-answered quit', // C5's line, unchanged when only turns are busy
      'quit-guard: 5 mid-turn, auto-answered cancel',
      'quit-guard: 1 background work, 1 busy terminal, auto-answered when_idle',
    ]);
    log.mockRestore();
  });

  it('otherwise shows the question and maps its three buttons', async () => {
    const show = vi.fn().mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 1 }).mockResolvedValueOnce({ response: 2 });
    const report = { ...NONE, midTurn: 2 };
    expect(await askToQuit(report, { env: {}, show })).toBe('quit');
    expect(await askToQuit(report, { env: {}, show })).toBe('when_idle');
    expect(await askToQuit(report, { env: {}, show })).toBe('cancel');
    expect(show).toHaveBeenCalledWith(quitQuestion(report, 'Quit'));
  });
});
// C12 end

// C12 start: the guard always holds the quit while the report is computed (the review rulings (7)), then quits at once
// when nothing is busy and otherwise asks; C5's pins, restated over the report.
describe('the quit guard', () => {
  function guard(model: ReturnType<typeof modelWith>, over: Partial<Parameters<typeof installQuitGuard>[1]> = {}) {
    const deps = {
      pty: noTerminals,
      ask: vi.fn(async (): Promise<'quit' | 'cancel' | 'when_idle'> => 'cancel'),
      shutdownEngine: vi.fn(async () => {}),
      publish: vi.fn(),
      engines: noEngines,
      ...over,
    };
    return { deps, control: installQuitGuard(model, deps) };
  }

  it('holds even with nothing busy, then stops the engine and quits without asking once the report is all zero', async () => {
    const { deps } = guard(modelWith([status('idle')]));
    expect(electron.app.attempt()).toBe(false); // before-quit must prevent synchronously
    await settle();
    expect(deps.ask).not.toHaveBeenCalled();
    expect(deps.shutdownEngine).toHaveBeenCalledOnce(); // an idle ready engine is ended before the app goes (no orphan)
    expect(electron.app.quits).toBe(1);
  });

  it('asks with the report; Cancel keeps the app, and the next quit asks again', async () => {
    const { deps } = guard(modelWith(midTurn(2)));
    expect(electron.app.attempt()).toBe(false);
    await settle();
    expect(deps.ask).toHaveBeenCalledExactlyOnceWith({ midTurn: 2, backgroundWork: 0, busyTerminals: 0, terminalsUnknown: false });
    expect(deps.shutdownEngine).not.toHaveBeenCalled();
    expect(electron.app.quits).toBe(0);
    expect(electron.app.attempt()).toBe(false);
    await settle();
    expect(deps.ask).toHaveBeenCalledTimes(2);
  });

  it('Quit stops the engine, then quits without asking again', async () => {
    const { deps } = guard(modelWith(midTurn(3)), { ask: vi.fn(async () => 'quit' as const) });
    electron.app.attempt();
    await settle();
    expect(deps.shutdownEngine).toHaveBeenCalledOnce();
    expect(electron.app.quits).toBe(1);
    expect(deps.ask).toHaveBeenCalledOnce();
  });

  it('quits even when stopping the engine fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    guard(modelWith(midTurn(1)), { ask: async () => 'quit', shutdownEngine: () => Promise.reject(new Error('host gone')) });
    electron.app.attempt();
    await settle();
    expect(electron.app.quits).toBe(1);
  });

  it('a second quit while the report or the question is under way is held without a second question', async () => {
    let answer!: (a: 'quit' | 'cancel') => void;
    const ask = vi.fn(() => new Promise<'quit' | 'cancel'>((resolve) => (answer = resolve)));
    guard(modelWith(midTurn(1)), { ask });
    expect(electron.app.attempt()).toBe(false);
    expect(electron.app.attempt()).toBe(false); // the report is still being computed
    await settle();
    expect(electron.app.attempt()).toBe(false); // the question is open
    expect(ask).toHaveBeenCalledOnce();
    answer('cancel');
    await settle();
    expect(electron.app.attempt()).toBe(false);
    await settle();
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('a question that fails is logged once and treated as Cancel, with no unhandled rejection', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const ask = vi.fn().mockRejectedValueOnce(new Error('no dialog')).mockResolvedValueOnce('cancel');
      const { deps } = guard(modelWith(midTurn(2)), { ask });
      expect(electron.app.attempt()).toBe(false);
      await settle();
      await settle();
      expect(unhandled).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledOnce();
      expect(String(log.mock.calls[0]![0])).toContain('[quit-guard]');
      expect(deps.shutdownEngine).not.toHaveBeenCalled();
      expect(electron.app.quits).toBe(0);
      expect(electron.app.attempt()).toBe(false); // not stuck asking: the next quit asks again
      await settle();
      expect(ask).toHaveBeenCalledTimes(2);
    } finally {
      process.off('unhandledRejection', unhandled);
      log.mockRestore();
    }
  });

  it('logs the report’s latency where the app wants it (the e2e reads it)', async () => {
    const log = vi.fn();
    guard(modelWith([]), { log });
    electron.app.attempt();
    await settle();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^quit-report: \d+ ms · nothing busy$/));
  });
});

describe('quit when idle', () => {
  const bg = (id: string, tasks = [TASK]) => status(id, { backgroundTasks: tasks });

  it('holds the quit, publishes the waiting report, re-reads it on every status change, and quits at zero', async () => {
    const model = modelWith([bg('a'), status('b', { turn: humanTurn })]);
    const publish = vi.fn();
    const shutdownEngine = vi.fn(async () => {});
    guardDeps(model, { publish, shutdownEngine, ask: async () => 'when_idle' });
    electron.app.attempt();
    await settle();
    expect(publish).toHaveBeenLastCalledWith({ midTurn: 1, backgroundWork: 1, busyTerminals: 0, terminalsUnknown: false });
    expect(electron.app.quits).toBe(0);
    model.apply(status('b')); // the turn ended
    await settle();
    expect(publish).toHaveBeenLastCalledWith({ midTurn: 0, backgroundWork: 1, busyTerminals: 0, terminalsUnknown: false });
    expect(electron.app.quits).toBe(0);
    model.apply(bg('a', [])); // the task settled
    await settle();
    expect(publish).toHaveBeenLastCalledWith(null);
    expect(electron.app.quits).toBe(1);
    expect(shutdownEngine).toHaveBeenCalledOnce(); // nothing busy any more, but the idle engines still end first
  });

  // whole-branch review (P1): the turn that ran a long `!` command ends, the command does not; the wait holds for it
  it('waits for a `!` command that outlives its turn, and quits once it ends', async () => {
    const model = modelWith([{ ...status('a', { turn: humanTurn }), busy: true }]);
    const publish = vi.fn();
    guardDeps(model, { publish, ask: async () => 'when_idle' });
    electron.app.attempt();
    await settle();
    model.apply({ ...status('a'), busy: true }); // the turn ended; the command still runs
    await settle();
    await settle();
    expect(electron.app.quits).toBe(0);
    expect(publish).toHaveBeenLastCalledWith({ midTurn: 1, backgroundWork: 0, busyTerminals: 0, terminalsUnknown: false });
    model.apply(status('a')); // the command ended
    await settle();
    await settle();
    expect(electron.app.quits).toBe(1);
  });

  it('re-reads every 2 s, since a terminal’s command ending is no status change', async () => {
    vi.useFakeTimers();
    try {
      let busy = true;
      const pty = { list: async () => [{ ptyId: 't', alive: true }], foreground: async () => ({ busy }), hostGone: () => false };
      const publish = vi.fn();
      guardDeps(modelWith([]), { pty, publish, ask: async () => 'when_idle' });
      electron.app.attempt();
      await vi.advanceTimersByTimeAsync(0);
      expect(publish).toHaveBeenLastCalledWith({ midTurn: 0, backgroundWork: 0, busyTerminals: 1, terminalsUnknown: false });
      busy = false;
      await vi.advanceTimersByTimeAsync(1_999);
      expect(electron.app.quits).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(electron.app.quits).toBe(1);
      expect(publish).toHaveBeenLastCalledWith(null);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Quit now stops the engine and quits; Cancel stops waiting and keeps the app', async () => {
    const model = modelWith([bg('a')]);
    const publish = vi.fn();
    const shutdownEngine = vi.fn(async () => {});
    const control = guardDeps(model, { publish, shutdownEngine, ask: async () => 'when_idle' });
    electron.app.attempt();
    await settle();
    control.cancelWait();
    expect(publish).toHaveBeenLastCalledWith(null);
    model.apply(bg('a', []));
    await settle();
    expect(electron.app.quits).toBe(0); // no longer waiting
    model.apply(bg('a'));
    electron.app.attempt();
    await settle();
    expect(control.waiting()).toEqual({ midTurn: 0, backgroundWork: 1, busyTerminals: 0, terminalsUnknown: false });
    control.quitNow();
    await settle();
    expect(shutdownEngine).toHaveBeenCalledOnce();
    expect(electron.app.quits).toBe(1);
  });

  it('a second ⌘Q while waiting asks again; its Cancel leaves the wait as it was, its Quit quits', async () => {
    const model = modelWith([bg('a')]);
    const answers: ('when_idle' | 'cancel' | 'quit')[] = ['when_idle', 'cancel', 'quit'];
    const ask = vi.fn(async () => answers.shift()!);
    const publish = vi.fn();
    const control = guardDeps(model, { ask, publish });
    electron.app.attempt();
    await settle();
    expect(control.waiting()).not.toBeNull();
    electron.app.attempt();
    await settle();
    expect(ask).toHaveBeenCalledTimes(2);
    expect(control.waiting()).not.toBeNull(); // Cancel on the second question is not Cancel on the banner
    electron.app.attempt();
    await settle();
    expect(electron.app.quits).toBe(1);
    expect(publish).toHaveBeenLastCalledWith(null);
  });
});

function guardDeps(model: ReturnType<typeof modelWith>, over: Partial<Parameters<typeof installQuitGuard>[1]>) {
  return installQuitGuard(model, { pty: noTerminals, ask: async () => 'cancel', shutdownEngine: vi.fn(async () => {}), publish: () => {}, engines: noEngines, ...over });
}

// A pty host whose every `pty.list` answers when the test says; one terminal, busy while `busy` is true.
function deferredPty() {
  const lists: ((ptys: { ptyId: string; alive: boolean }[]) => void)[] = [];
  const state = { busy: false };
  const pty = {
    list: () => new Promise<{ ptyId: string; alive: boolean }[]>((resolve) => lists.push(resolve)),
    foreground: async () => ({ busy: state.busy }),
    hostGone: () => false,
  };
  return { pty, state, lists, answer: async (index: number, ptys = [{ ptyId: 't', alive: true }]) => (lists[index]!(ptys), await settle(), await settle()) };
}

// review fix: quitting is one flight; the guard keeps holding outside quits until its one final app.quit()
describe('quitting happens once', () => {
  function deferredShutdown() {
    let finish!: () => void;
    const shutdownEngine = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    return { shutdownEngine, finish: async () => (finish(), await settle()) };
  }

  it('a second ⌘Q while the engine is being stopped is held, asks nothing and stops nothing twice', async () => {
    const s = deferredShutdown();
    const ask = vi.fn(async () => 'quit' as const);
    guardDeps(modelWith(midTurn(1)), { ask, shutdownEngine: s.shutdownEngine });
    electron.app.attempt();
    await settle();
    expect(s.shutdownEngine).toHaveBeenCalledOnce();
    expect(electron.app.attempt()).toBe(false); // still held during the shutdown
    await settle();
    expect(ask).toHaveBeenCalledOnce();
    expect(s.shutdownEngine).toHaveBeenCalledOnce();
    expect(electron.app.quits).toBe(0);
    await s.finish();
    expect(electron.app.quits).toBe(1);
  });

  it('two Quit now answers before the shutdown ends start one shutdown and one quit', async () => {
    const s = deferredShutdown();
    const control = guardDeps(modelWith([status('a', { backgroundTasks: [TASK] })]), { ask: async () => 'when_idle', shutdownEngine: s.shutdownEngine });
    electron.app.attempt();
    await settle();
    control.quitNow();
    control.quitNow();
    await settle();
    expect(s.shutdownEngine).toHaveBeenCalledOnce();
    await s.finish();
    expect(electron.app.quits).toBe(1);
  });

  it('a question still open when Quit now runs is inert once answered', async () => {
    const s = deferredShutdown();
    let answer!: (a: 'when_idle') => void;
    const publish = vi.fn();
    const control = guardDeps(modelWith([status('a', { backgroundTasks: [TASK] })]), { ask: () => new Promise((resolve) => (answer = resolve)), shutdownEngine: s.shutdownEngine, publish });
    electron.app.attempt();
    await settle(); // the question is open
    control.quitNow();
    answer('when_idle');
    await settle();
    expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ backgroundWork: 1 })); // no wait begins
    await s.finish();
    expect(electron.app.quits).toBe(1);
  });
});

// tracker row (C12): a quit with nothing busy used to go straight to will-quit, whose host stop left each idle engine
// alive, orphaned, until it read its stdin's end. Every quit now waits for the host's shutdown (the ladder's exit rung),
// bounded, before the one final app.quit().
describe('the quit waits for the engines to exit, bounded', () => {
  it('a quit with nothing busy does not proceed until the shutdown answers, and holds outside quits meanwhile', async () => {
    let finish!: () => void;
    const shutdownEngine = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    guardDeps(modelWith([status('idle')]), { shutdownEngine });
    electron.app.attempt();
    await settle();
    expect(shutdownEngine).toHaveBeenCalledOnce();
    expect(electron.app.quits).toBe(0);
    expect(electron.app.attempt()).toBe(false); // a second ⌘Q is held and starts nothing
    await settle();
    expect(shutdownEngine).toHaveBeenCalledOnce();
    finish();
    await settle();
    expect(electron.app.quits).toBe(1);
  });

  it('quits at the bound when the shutdown never answers, once, and a later answer changes nothing', async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      let finish!: () => void;
      const shutdownEngine = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
      guardDeps(modelWith(midTurn(1)), { ask: async () => 'quit', shutdownEngine });
      electron.app.attempt();
      await vi.advanceTimersByTimeAsync(0);
      expect(shutdownEngine).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(SHUTDOWN_BOUND_MS - 1);
      expect(electron.app.quits).toBe(0);
      expect(electron.app.attempt()).toBe(false); // still one flight
      await vi.advanceTimersByTimeAsync(1);
      expect(electron.app.quits).toBe(1);
      expect(String(error.mock.calls[0]![0])).toContain('[quit-guard]');
      finish();
      await vi.advanceTimersByTimeAsync(0);
      expect(electron.app.quits).toBe(1);
      expect(shutdownEngine).toHaveBeenCalledOnce();
    } finally {
      error.mockRestore();
      vi.useRealTimers();
    }
  });
});

// Debt wave 6: killing the engine host at will-quit drops the ladder's SIGKILL rung, so main sends it at the bound, to
// the engine pids its statuses name that are still the engine host's children.
describe('past the bound, main sends the ladder\'s SIGKILL rung', () => {
  const HOST = 500;
  const statuses = [
    { ...status('a', { process: 'ready' }), pid: 101 }, // ignores end_session, SIGTERM and its stdin
    { ...status('b', { process: 'exiting' }), pid: 102 }, // mid-ladder
    { ...status('c', { process: 'ready' }), pid: 103 }, // exited meanwhile; its pid now another process's
    { ...status('d', { process: 'exited' }), pid: 104 },
    { ...status('e', { process: 'starting' }), pid: null },
  ];
  const PS = [`${HOST} 1`, `101 ${HOST}`, `102 ${HOST}`, '103 1', `104 ${HOST}`, `105 ${HOST}`, `201 101`].join('\n');

  async function quitPastTheBound(engines: Partial<NonNullable<Parameters<typeof installQuitGuard>[1]['engines']>>) {
    vi.useFakeTimers();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const order: string[] = [];
    const kill = vi.fn((pid: number) => void order.push(`kill ${pid}`));
    const quit = electron.app.quit;
    electron.app.quit = () => (order.push('quit'), quit());
    try {
      const shutdownEngine = vi.fn(() => new Promise<void>(() => {})); // a host that never finishes its ladder
      guardDeps(modelWith(statuses), { ask: async () => 'quit', shutdownEngine, engines: { hostPid: () => HOST, ps: async () => PS, kill, ...engines } });
      electron.app.attempt();
      await vi.advanceTimersByTimeAsync(SHUTDOWN_BOUND_MS - 1);
      expect(kill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(KILL_PS_TIMEOUT_MS);
      return { kill, order, error };
    } finally {
      electron.app.quit = quit;
      error.mockRestore();
      vi.useRealTimers();
    }
  }

  it('SIGKILLs the live and exiting engines still the host\'s children, then quits once', async () => {
    const { order } = await quitPastTheBound({});
    expect(order).toEqual(['kill 101', 'kill 102', 'quit']);
    expect(electron.app.quits).toBe(1);
  });

  it('a process listing that fails or never answers kills nothing and still quits', async () => {
    expect((await quitPastTheBound({ ps: async () => Promise.reject(new Error('ps: fork failed')) })).order).toEqual(['quit']);
    electron.app.reset();
    expect((await quitPastTheBound({ ps: () => new Promise<string>(() => {}) })).order).toEqual(['quit']);
    expect(electron.app.quits).toBe(1);
  });

  it('a host with no pid kills nothing; a kill that throws (the engine exited meanwhile) does not stop the rest', async () => {
    expect((await quitPastTheBound({ hostPid: () => null })).order).toEqual(['quit']);
    electron.app.reset();
    const killed: number[] = [];
    await quitPastTheBound({
      kill: (pid) => {
        if (pid === 101) throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
        killed.push(pid);
      },
    });
    expect(killed).toEqual([102]);
    expect(electron.app.quits).toBe(1);
  });

  it('a shutdown that answers within the bound kills nothing', async () => {
    const kill = vi.fn();
    guardDeps(modelWith(statuses), { ask: async () => 'quit', engines: { hostPid: () => HOST, ps: async () => PS, kill } });
    electron.app.attempt();
    await settle();
    await settle();
    expect(electron.app.quits).toBe(1);
    expect(kill).not.toHaveBeenCalled();
  });
});

// whole-branch review (P2): a crashed engine host takes its sessions with it; main forgets their statuses at the
// generation change, so a wait holding on them re-reads and completes
describe('an engine-host crash during a wait', () => {
  it('forgets the crashed host’s statuses, and the wait completes once nothing else is busy', async () => {
    const events = new Map<string, (payload: unknown) => void>();
    const states = new Set<(state: { state: string }) => void>();
    const hosts = {
      onEvent: (name: string, listener: (payload: unknown) => void) => (events.set(name, listener), () => void events.delete(name)),
      onState: (_owner: string, listener: (state: { state: string }) => void) => (states.add(listener), () => void states.delete(listener)),
    };
    const model = new SessionReadModel('index');
    model.register({ start: (writer) => (writer.observeRecord(record('bg')), () => {}) });
    model.register(hostEventSource(hosts as never));
    events.get('session.status')!({ appSessionId: 'bg', status: status('bg', { backgroundTasks: [TASK] }) });
    const publish = vi.fn();
    guardDeps(model as never, { publish, ask: async () => 'when_idle' });
    electron.app.attempt();
    await settle();
    expect(publish).toHaveBeenLastCalledWith({ midTurn: 0, backgroundWork: 1, busyTerminals: 0, terminalsUnknown: false });
    states.forEach((listener) => listener({ state: 'crashed' })); // the host and its processes are gone
    await settle();
    await settle();
    expect(model.engineStatuses()).toEqual([]);
    expect(electron.app.quits).toBe(1);
    expect(publish).toHaveBeenLastCalledWith(null);
  });
});

// review fix: nothing is decided on session counts older than the terminal read
describe('the report is fresh when it decides', () => {
  it('a session that turns busy while the terminals are read is asked about, not quit over', async () => {
    const model = modelWith([status('a')]);
    const d = deferredPty();
    const ask = vi.fn(async () => 'cancel' as const);
    guardDeps(model, { pty: d.pty, ask });
    electron.app.attempt();
    await settle();
    model.apply(status('a', { turn: humanTurn })); // a turn starts during the read
    await d.answer(0);
    expect(electron.app.quits).toBe(0);
    expect(ask).toHaveBeenCalledExactlyOnceWith({ midTurn: 1, backgroundWork: 0, busyTerminals: 0, terminalsUnknown: false });
  });

  it('while waiting, a read that a status change overtook does not quit on its zero', async () => {
    const model = modelWith([status('a', { turn: humanTurn })]);
    const d = deferredPty();
    const publish = vi.fn();
    guardDeps(model, { pty: d.pty, ask: async () => 'when_idle', publish });
    electron.app.attempt();
    await settle();
    await d.answer(0); // the question's read: one mid-turn, so it waits
    expect(publish).toHaveBeenLastCalledWith({ midTurn: 1, backgroundWork: 0, busyTerminals: 0, terminalsUnknown: false });
    model.apply(status('a')); // the turn ends: a re-read starts
    await settle();
    model.apply(status('a', { turn: humanTurn })); // and another begins while it reads
    await d.answer(1);
    expect(electron.app.quits).toBe(0);
    await d.answer(2); // the re-read the change asked for
    expect(electron.app.quits).toBe(0);
    expect(publish).toHaveBeenLastCalledWith({ midTurn: 1, backgroundWork: 0, busyTerminals: 0, terminalsUnknown: false });
  });

  // re-review fix: the 2 s poll only starts a read when none is out; it never discards one
  it('slow but successful terminal reads (1.5 s list, 1 s probe) with no status change: the first zero report quits', async () => {
    vi.useFakeTimers();
    try {
      let busy = true;
      const later = <T>(ms: number, value: () => T) => new Promise<T>((resolve) => setTimeout(() => resolve(value()), ms));
      const pty = { list: () => later(1_500, () => [{ ptyId: 't', alive: true }]), foreground: () => later(1_000, () => ({ busy })), hostGone: () => false };
      const publish = vi.fn();
      guardDeps(modelWith([]), { pty, publish, ask: async () => 'when_idle' });
      electron.app.attempt();
      await vi.advanceTimersByTimeAsync(2_500); // the question's read: the terminal is busy
      expect(publish).toHaveBeenLastCalledWith({ midTurn: 0, backgroundWork: 0, busyTerminals: 1, terminalsUnknown: false });
      busy = false; // the command ends; nothing else changes
      await vi.advanceTimersByTimeAsync(10_000);
      expect(electron.app.quits).toBe(1);
      expect(publish).toHaveBeenLastCalledWith(null);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a read still out when its wait was cancelled is inert under the next wait', async () => {
    const model = modelWith([status('a')]);
    const d = deferredPty();
    d.state.busy = true;
    const publish = vi.fn();
    const control = guardDeps(model, { pty: d.pty, ask: async () => 'when_idle', publish });
    electron.app.attempt();
    await settle();
    await d.answer(0); // wait 1: the terminal is busy
    model.apply(status('a')); // a status change: wait 1 starts a re-read (list 1), left outstanding
    await settle();
    control.cancelWait();
    electron.app.attempt(); // the next quit: its question's read is list 2
    await settle();
    await d.answer(2); // still busy: wait 2
    const wait2 = { midTurn: 0, backgroundWork: 0, busyTerminals: 1, terminalsUnknown: false };
    expect(control.waiting()).toEqual(wait2);
    await d.answer(1, []); // wait 1's old re-read answers zero
    expect(electron.app.quits).toBe(0); // inert: wait 2 is still waiting
    expect(control.waiting()).toEqual(wait2);
    expect(publish).toHaveBeenLastCalledWith(wait2);
  });
});
// C12 end
