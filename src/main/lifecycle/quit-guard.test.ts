import { EventEmitter } from 'node:events'; // E5: a window's webContents, as the unsaved-files tracker sees one
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import { humanTurn, record, status } from '../../../test/support/builders';
import { clientOf } from '../ipc/clients'; // E5: the page's ClientRef, as the router hands it

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

const { fakeSpineView } = await import('../../../test/support/fake-spine-view');
const { askToQuit, busyReport, installQuitGuard, quitQuestion, SAVE_ALL_BOUND_MS, trackUnsavedFiles } = await import('./quit-guard');

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const NONE = { midTurn: 0, backgroundWork: 0, busyTerminals: 0, terminalsUnknown: false, unsavedFiles: [] };
const FIRST = { round: 0, reasons: new Map() }; // E5: a flight's first question, no Save all before it
const TASK = { taskId: 'b1' as never, taskType: 'local_bash', description: 'sleep 900', ambient: false };

// The spine's view holding the given engine statuses (P5 O3-C reader R3; the read model's, from C4's index source and C3's
// statuses, in the product; `apply` changes one later).
function modelWith(statuses: EngineSessionStatus[]) {
  const view = fakeSpineView({ records: statuses.map((s) => record(s.appSessionId)), statuses });
  return Object.assign(view, { apply: (s: EngineSessionStatus) => view.setStatus(s) });
}
const midTurn = (n: number) => Array.from({ length: n }, (_, i) => status(`s${i}` as AppSessionId, { process: 'ready', engineState: 'running', turn: humanTurn }));
const noTerminals = { list: async () => [], foreground: async () => ({ busy: false }), hostGone: () => false };
const busyPty = { list: async () => [{ ptyId: 'p1', alive: true }] as never, foreground: async () => ({ busy: true }), hostGone: () => false };
// sessions mid-turn and with background work, and a terminal running a command: all of it `mawsd`'s
const working = () => modelWith([...midTurn(2), status('bg', { backgroundTasks: [TASK] })]);

function guard(model: ReturnType<typeof modelWith>, over: Partial<Parameters<typeof installQuitGuard>[1]> = {}) {
  const deps = {
    pty: noTerminals,
    ask: vi.fn(async (): Promise<'quit' | 'cancel' | 'save_all'> => 'cancel'),
    unsavedFiles: (): readonly string[] => [], // E5
    saveAll: vi.fn(async (): Promise<ReadonlyMap<string, string>> => new Map()), // E5
    ...over,
  };
  return { deps, control: installQuitGuard(model, deps) };
}

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
    expect(await busyReport(model, noTerminals)).toEqual({ midTurn: 2, backgroundWork: 2, busyTerminals: 0, terminalsUnknown: false, unsavedFiles: [] });
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
    expect(await busyReport(model, noTerminals)).toEqual({ midTurn: 4, backgroundWork: 1, busyTerminals: 0, terminalsUnknown: false, unsavedFiles: [] });
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
      expect(await report).toEqual({ midTurn: 0, backgroundWork: 0, busyTerminals: 2, terminalsUnknown: false, unsavedFiles: [] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts a failed probe busy', async () => {
    const failing = { list: async () => [{ ptyId: 'a', alive: true }], foreground: () => Promise.reject(new Error('pty-host is crashed')), hostGone: () => false };
    expect(await busyReport(modelWith([]), failing)).toMatchObject({ busyTerminals: 1, terminalsUnknown: false, unsavedFiles: [] });
  });

  // review fix: a slow live pty host is not a gone one
  it('a list that does not answer from a live pty host is terminals of unknown state', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const silent = { list: () => new Promise<never>(() => {}), foreground: async () => ({ busy: false }), hostGone: () => false };
      const report = busyReport(modelWith([]), silent);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await report).toEqual({ midTurn: 0, backgroundWork: 0, busyTerminals: 1, terminalsUnknown: true, unsavedFiles: [] });
      const failed = { list: () => Promise.reject(new Error('timeout')), foreground: async () => ({ busy: false }), hostGone: () => false };
      expect(await busyReport(modelWith([]), failed)).toMatchObject({ busyTerminals: 1, terminalsUnknown: true, unsavedFiles: [] });
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('counts no terminal only when the pty host is gone (its supervisor state), where its terminals went with it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gone = { list: () => Promise.reject(new Error('host_unavailable')), foreground: async () => ({ busy: true }), hostGone: () => true };
    expect(await busyReport(modelWith([]), gone)).toEqual({ midTurn: 0, backgroundWork: 0, busyTerminals: 0, terminalsUnknown: false, unsavedFiles: [] });
    warn.mockRestore();
  });
});

// C12 start: the guard always holds the quit while the report is computed (the review rulings (7)), then quits at once
// unless a file is unsaved, and otherwise asks; C5's pins, restated over the report.
describe('the quit guard', () => {
  it('holds even with nothing busy, then quits without asking once the report is read', async () => {
    const { deps } = guard(modelWith([status('idle')]));
    expect(electron.app.attempt()).toBe(false); // before-quit must prevent synchronously
    await settle();
    expect(deps.ask).not.toHaveBeenCalled();
    expect(electron.app.quits).toBe(1);
  });

  it('asks about the unsaved files; Cancel keeps the app, and the next quit asks again', async () => {
    const { deps } = guard(modelWith([]), { unsavedFiles: () => ['/r/a.ts'] });
    expect(electron.app.attempt()).toBe(false);
    await settle();
    expect(deps.ask).toHaveBeenCalledExactlyOnceWith(['/r/a.ts'], FIRST);
    expect(electron.app.quits).toBe(0);
    expect(electron.app.attempt()).toBe(false);
    await settle();
    expect(deps.ask).toHaveBeenCalledTimes(2);
  });

  it('a second quit while the report or the question is under way is held without a second question', async () => {
    let answer!: (a: 'quit' | 'cancel') => void;
    const ask = vi.fn(() => new Promise<'quit' | 'cancel'>((resolve) => (answer = resolve)));
    guard(modelWith([]), { ask, unsavedFiles: () => ['/r/a.ts'] });
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
      guard(modelWith([]), { ask, unsavedFiles: () => ['/r/a.ts'] });
      expect(electron.app.attempt()).toBe(false);
      await settle();
      await settle();
      expect(unhandled).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledOnce();
      expect(String(log.mock.calls[0]![0])).toContain('[quit-guard]');
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

// P5 O3-D (Q1, D12) and P5 O15 M2: the sessions and the terminals belong to `mawsd`, which outlives the app and frees
// them at its idle release. A quit asks only about unsaved files and stops nothing.
describe('what outlives the app', () => {
  it('asks nothing about sessions, background work or terminals, and logs what it did not ask', async () => {
    const lines: string[] = [];
    const { deps } = guard(working(), { pty: busyPty, log: (line: string) => void lines.push(line) });
    expect(electron.app.attempt()).toBe(false);
    await vi.waitFor(() => expect(electron.app.quits).toBe(1));
    expect(deps.ask).not.toHaveBeenCalled();
    expect(lines).toEqual([expect.stringMatching(/^quit-report: \d+ ms · 2 mid-turn, 1 background work, 1 busy terminal$/), 'quit-guard: 2 mid-turn, 1 background work, 1 busy terminal, not asked: they outlive the app']);
  });

  it('a busy terminal alone is named by the report and nothing else', async () => {
    const lines: string[] = [];
    const { deps } = guard(modelWith([]), { pty: busyPty, log: (line: string) => void lines.push(line) });
    electron.app.attempt();
    await vi.waitFor(() => expect(electron.app.quits).toBe(1));
    expect(deps.ask).not.toHaveBeenCalled();
    expect(lines).toEqual([expect.stringMatching(/^quit-report: \d+ ms · 1 busy terminal$/)]);
  });

  it('asks about unsaved files alone, naming no session nor terminal, and logs no line of what it did not ask', async () => {
    const lines: string[] = [];
    const { deps } = guard(working(), { pty: busyPty, ask: vi.fn(async () => 'quit' as const), unsavedFiles: () => ['/r/a.ts'], log: (line: string) => void lines.push(line) });
    electron.app.attempt();
    await vi.waitFor(() => expect(electron.app.quits).toBe(1));
    expect(deps.ask).toHaveBeenCalledExactlyOnceWith(['/r/a.ts'], FIRST);
    expect(lines).toEqual([expect.stringMatching(/^quit-report: \d+ ms · 1 unsaved file, 2 mid-turn, 1 background work, 1 busy terminal$/)]);
  });

  it('Save all that saves every file quits with no second question, the sessions still busy', async () => {
    let files = ['/r/a.ts'];
    const saveAll = vi.fn(async () => ((files = []), new Map<string, string>()));
    const { deps } = guard(working(), { pty: busyPty, ask: vi.fn(async () => 'save_all' as const), saveAll, unsavedFiles: () => files });
    electron.app.attempt();
    await vi.waitFor(() => expect(electron.app.quits).toBe(1));
    expect(saveAll).toHaveBeenCalledOnce();
    expect(deps.ask).toHaveBeenCalledOnce();
  });
});

// review fix: nothing is decided on counts older than the terminal read
describe('the report is fresh when it decides', () => {
  it('a file dirtied while the terminals are read is asked about, not quit over', async () => {
    let answer!: (ptys: { ptyId: string; alive: boolean }[]) => void;
    const pty = { list: () => new Promise<{ ptyId: string; alive: boolean }[]>((resolve) => (answer = resolve)), foreground: async () => ({ busy: false }), hostGone: () => false };
    let files: string[] = [];
    const { deps } = guard(modelWith([]), { pty, unsavedFiles: () => files });
    electron.app.attempt();
    await settle();
    files = ['/r/a.ts']; // dirtied during the read
    answer([{ ptyId: 't', alive: true }]);
    await settle();
    await settle();
    expect(electron.app.quits).toBe(0);
    expect(deps.ask).toHaveBeenCalledExactlyOnceWith(['/r/a.ts'], FIRST);
  });
});

// review fix: quitting is one flight; once the final app.quit() is under way nothing asks or quits again
describe('quitting happens once', () => {
  it('two Quit now answers make one quit', () => {
    const { control } = guard(modelWith([]));
    control.quitNow();
    control.quitNow();
    expect(electron.app.quits).toBe(1);
  });

  it('a question still open when Quit now runs is inert once answered', async () => {
    let answer!: (a: 'save_all') => void;
    const { deps, control } = guard(modelWith([]), { ask: vi.fn(() => new Promise<'save_all'>((resolve) => (answer = resolve))), unsavedFiles: () => ['/r/a.ts'] });
    electron.app.attempt();
    await settle(); // the question is open
    control.quitNow();
    answer('save_all');
    await settle();
    expect(deps.saveAll).not.toHaveBeenCalled();
    expect(electron.app.quits).toBe(1);
  });
});
// C12 end

// E5 start: the quit guard names unsaved files (E5 execution document, Interfaces "The quit guard and unsaved files
// (M5)"; the owner's ruling of 2026-10-06). The renderer pushes each window's dirty file tabs; the report carries their
// union, the question offers Save all, Quit anyway and Cancel, and Save all asks every window to save before re-reading.
describe('unsaved files in the quit question', () => {
  const unsaved = (...paths: string[]) => ({ ...NONE, unsavedFiles: paths });

  it('the report carries the unsaved files, read with the sessions', async () => {
    expect(await busyReport(modelWith([]), noTerminals, () => ['/r/a.ts'])).toEqual(unsaved('/r/a.ts'));
    expect(await busyReport(modelWith([]), noTerminals)).toEqual(NONE); // none named: none unsaved
  });

  it('asks Save all, Quit anyway or Cancel, naming how many files and their basenames in the detail', () => {
    expect(quitQuestion(['/r/src/a.ts', '/r/b.ts'], 'Quit')).toEqual({
      type: 'warning',
      buttons: ['Save all', 'Quit anyway', 'Cancel'],
      defaultId: 2,
      cancelId: 2,
      message: '2 unsaved files',
      detail: 'Unsaved: a.ts, b.ts',
    });
    expect(quitQuestion(['/r/app.ts'], 'Quit')).toMatchObject({ message: '1 unsaved file', detail: 'Unsaved: app.ts' });
    // at most five names, then how many more
    const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => `/r/${n}.ts`);
    expect(quitQuestion(seven, 'Quit').detail).toBe('Unsaved: a.ts, b.ts, c.ts, d.ts, e.ts and 2 more');
    expect(quitQuestion(seven.slice(0, 6), 'Quit').detail).toBe('Unsaved: a.ts, b.ts, c.ts, d.ts, e.ts and 1 more');
    expect(quitQuestion(['/r/a.ts'], 'Restart').buttons).toEqual(['Save all', 'Restart anyway', 'Cancel']); // P1's updater
  });

  it('maps the three buttons, and under MAWS_E2E answers from MAWS_E2E_QUIT_ANSWER (quit by default) and logs instead of showing the dialog', async () => {
    const show = vi.fn().mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 1 }).mockResolvedValueOnce({ response: 2 });
    const files = ['/r/a.ts'];
    expect(await askToQuit(files, { env: {}, show })).toBe('save_all');
    expect(await askToQuit(files, { env: {}, show })).toBe('quit'); // Quit anyway
    expect(await askToQuit(files, { env: {}, show })).toBe('cancel');
    expect(show).toHaveBeenCalledWith(quitQuestion(files, 'Quit'));

    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const e2e = (answer?: string) => ({ env: { MAWS_E2E: '1', MAWS_E2E_QUIT_ANSWER: answer }, show });
    expect(await askToQuit(files, e2e())).toBe('quit');
    expect(await askToQuit(files, e2e('save_all'))).toBe('save_all');
    expect(await askToQuit(['/r/a.ts', '/r/b.ts'], e2e('when_idle'))).toBe('quit'); // not offered: the default
    expect(await askToQuit(files, e2e('cancel'))).toBe('cancel');
    expect(log.mock.calls.map(([line]) => line)).toEqual([
      'quit-guard: 1 unsaved file, auto-answered quit',
      'quit-guard: 1 unsaved file, auto-answered save_all',
      'quit-guard: 2 unsaved files, auto-answered quit',
      'quit-guard: 1 unsaved file, auto-answered cancel',
    ]);
    log.mockRestore();
    expect(show).toHaveBeenCalledTimes(3);
  });

  it('Save all saves, re-reads the report and quits once nothing is unsaved', async () => {
    let files = ['/r/a.ts'];
    const saveAll = vi.fn(async () => ((files = []), new Map<string, string>()));
    const { deps } = guard(modelWith([]), { unsavedFiles: () => files, saveAll, ask: vi.fn(async () => 'save_all' as const) });
    electron.app.attempt();
    await settle();
    await settle();
    expect(saveAll).toHaveBeenCalledOnce();
    expect(deps.ask).toHaveBeenCalledOnce();
    expect(electron.app.quits).toBe(1);
  });

  it('Save all that leaves a file unsaved asks again naming it', async () => {
    const ask = vi.fn<(files: readonly string[]) => Promise<'save_all' | 'cancel'>>().mockResolvedValueOnce('save_all').mockResolvedValueOnce('cancel');
    guard(modelWith([]), { unsavedFiles: () => ['/r/a.ts', '/r/b.ts'], saveAll: async () => new Map(), ask }); // neither saved (a conflict, say)
    electron.app.attempt();
    await settle();
    await settle();
    expect(ask.mock.calls.map(([files]) => files)).toEqual([['/r/a.ts', '/r/b.ts'], ['/r/a.ts', '/r/b.ts']]);
    expect(electron.app.quits).toBe(0); // Cancel on the second question keeps the app
  });

  it('a quit while Save all runs is held without a second question; Quit anyway quits without saving', async () => {
    let finish!: () => void;
    const saveAll = vi.fn(() => new Promise<ReadonlyMap<string, string>>((resolve) => (finish = () => resolve(new Map()))));
    let files = ['/r/a.ts'];
    const { deps } = guard(modelWith([]), { unsavedFiles: () => files, saveAll, ask: vi.fn(async () => 'save_all' as const) });
    electron.app.attempt();
    await settle();
    expect(saveAll).toHaveBeenCalledOnce();
    expect(electron.app.attempt()).toBe(false);
    await settle();
    expect(deps.ask).toHaveBeenCalledOnce();
    files = [];
    finish();
    await settle();
    await settle();
    expect(electron.app.quits).toBe(1);

    electron.app.reset();
    const anyway = guard(modelWith([]), { unsavedFiles: () => ['/r/a.ts'], ask: vi.fn(async () => 'quit' as const) });
    electron.app.attempt();
    await settle();
    expect(anyway.deps.saveAll).not.toHaveBeenCalled();
    expect(anyway.deps.ask).toHaveBeenCalledOnce();
    expect(electron.app.quits).toBe(1);
  });

  // Fix wave 1 start: the reasons Save all's answers gave, the e2e seam's later questions, and a failing Save all
  it('the re-asked question names each file Save all left unsaved with its reason; the others keep the plain listing', () => {
    const reasons = new Map([['/r/app.ts', 'Changed on disk since you opened it']]);
    expect(quitQuestion(['/r/app.ts', '/r/b.ts'], 'Quit', reasons).detail).toBe('app.ts: Changed on disk since you opened it\nUnsaved: b.ts');
    expect(quitQuestion(['/r/app.ts'], 'Quit', reasons)).toMatchObject({ message: '1 unsaved file', detail: 'app.ts: Changed on disk since you opened it' });
    expect(quitQuestion(['/r/b.ts'], 'Quit', reasons).detail).toBe('Unsaved: b.ts'); // a saved file's reason names nothing
    // at most five files named, reasons included, then how many more
    const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => `/r/${n}.ts`);
    const two = new Map([['/r/a.ts', 'Could not save: disk full'], ['/r/g.ts', 'Saving…']]);
    expect(quitQuestion(seven, 'Quit', two).detail).toBe('a.ts: Could not save: disk full\nUnsaved: b.ts, c.ts, d.ts, e.ts and 2 more');
    const all = new Map(seven.map((path) => [path, 'Unsaved changes']));
    expect(quitQuestion(seven.slice(0, 6), 'Quit', all).detail).toBe(
      ['a', 'b', 'c', 'd', 'e'].map((n) => `${n}.ts: Unsaved changes`).join('\n') + '\nand 1 more',
    );
  });

  it('the guard asks each question with its round and the reasons of the Save all before it', async () => {
    const files = trackUnsavedFiles();
    const window = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false });
    files.update(clientOf(window as never), ['/r/app.ts', '/r/b.ts']);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const show = vi.fn().mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 2 }); // Save all, then Cancel
    const ask = vi.fn((unsavedFiles: Parameters<typeof askToQuit>[0], asked: Parameters<typeof askToQuit>[2]) => askToQuit(unsavedFiles, { env: {}, show }, asked));
    guard(modelWith([]), {
      unsavedFiles: () => files.paths(),
      // the window answers app.ts with the conflict its tab now shows, and b.ts not at all (typed into during the save, say)
      saveAll: () => files.saveAll((requestId) => setTimeout(() => files.done(clientOf(window as never), requestId, [{ path: '/r/app.ts', message: 'Changed on disk since you opened it' }]))),
      ask,
    });
    electron.app.attempt();
    await settle();
    await settle();
    await settle();
    warn.mockRestore();
    expect(ask.mock.calls.map(([, asked]) => asked)).toEqual([
      FIRST,
      { round: 1, reasons: new Map([['/r/app.ts', 'Changed on disk since you opened it']]) },
    ]);
    expect(show.mock.calls.map(([options]) => options.detail)).toEqual(['Unsaved: app.ts, b.ts', 'app.ts: Changed on disk since you opened it\nUnsaved: b.ts']);
    expect(electron.app.quits).toBe(0);
  });

  it('under MAWS_E2E a save that keeps failing ends the flight as Cancel after one Save all; the next quit asks afresh', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const show = vi.fn();
    const env = { MAWS_E2E: '1', MAWS_E2E_QUIT_ANSWER: 'save_all' };
    const saveAll = vi.fn(async () => new Map([['/r/a.ts', 'Changed on disk since you opened it']]));
    guard(modelWith([]), { unsavedFiles: () => ['/r/a.ts'], saveAll, ask: (unsavedFiles, asked) => askToQuit(unsavedFiles, { env, show }, asked) });
    electron.app.attempt();
    await settle();
    await settle();
    expect(saveAll).toHaveBeenCalledOnce();
    expect(electron.app.quits).toBe(0);
    electron.app.attempt();
    await settle();
    await settle();
    expect(saveAll).toHaveBeenCalledTimes(2);
    expect(log.mock.calls.map(([line]) => line)).toEqual([
      'quit-guard: 1 unsaved file, auto-answered save_all',
      'quit-guard: 1 unsaved file, auto-answered cancel',
      'quit-guard: 1 unsaved file, auto-answered save_all',
      'quit-guard: 1 unsaved file, auto-answered cancel',
    ]);
    log.mockRestore();
    expect(show).not.toHaveBeenCalled();
    expect(electron.app.quits).toBe(0);
  });

  it('a Save all that fails is logged and ends the flight as Cancel; the next quit asks again', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const saveAll = vi.fn(async (): Promise<ReadonlyMap<string, string>> => {
      throw new Error('no window answered');
    });
    const { deps } = guard(modelWith([]), { unsavedFiles: () => ['/r/a.ts'], saveAll, ask: vi.fn(async () => 'save_all' as const) });
    electron.app.attempt();
    await settle();
    await settle();
    expect(saveAll).toHaveBeenCalledOnce();
    expect(deps.ask).toHaveBeenCalledOnce();
    expect(electron.app.quits).toBe(0);
    expect(String(error.mock.calls[0]![0])).toContain('[quit-guard]');
    error.mockRestore();
    electron.app.attempt();
    await settle();
    expect(deps.ask).toHaveBeenCalledTimes(2);
  });
  // Fix wave 1 end
});

describe('the unsaved files each window pushes', () => {
  const windowOf = (id: number) => Object.assign(new EventEmitter(), { id, isDestroyed: () => false });

  it('keeps each window’s whole set, reports their union sorted, and forgets a window that navigates or closes', () => {
    const files = trackUnsavedFiles();
    const one = windowOf(1);
    const two = windowOf(2);
    files.update(clientOf(one as never), ['/r/b.ts', '/r/a.ts']);
    files.update(clientOf(two as never), ['/r/c.ts', '/r/a.ts']);
    expect(files.paths()).toEqual(['/r/a.ts', '/r/b.ts', '/r/c.ts']);
    files.update(clientOf(one as never), ['/r/b.ts']); // the window's last word replaces its earlier one
    expect(files.paths()).toEqual(['/r/a.ts', '/r/b.ts', '/r/c.ts']);
    files.update(clientOf(two as never), []);
    expect(files.paths()).toEqual(['/r/b.ts']);
    files.update(clientOf(two as never), ['/r/c.ts']);
    two.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false }); // a reload starts from an empty viewer
    expect(files.paths()).toEqual(['/r/b.ts']);
    one.emit('destroyed');
    expect(files.paths()).toEqual([]);
    files.update(clientOf(two as never), ['/r/a.ts']); // listeners are attached once per window
    expect(two.listenerCount('did-start-navigation')).toBe(1);
    expect(two.listenerCount('destroyed')).toBe(1);
  });

  it('forgets a window whose renderer crashed, so Save all does not wait on it (E11: its edits are already lost)', async () => {
    const files = trackUnsavedFiles();
    const one = windowOf(1);
    const two = windowOf(2);
    files.update(clientOf(one as never), ['/r/a.ts']);
    files.update(clientOf(two as never), ['/r/b.ts']);
    const send = vi.fn();
    const done = files.saveAll(send);
    one.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 133 });
    expect(files.paths()).toEqual(['/r/b.ts']);
    files.done(clientOf(two as never), send.mock.calls[0]![0] as string, []);
    await done; // settles without the crashed window's answer, well inside SAVE_ALL_BOUND_MS
    files.update(clientOf(one as never), ['/r/a.ts']); // a reloaded renderer pushes again; listeners stay attached once
    expect(files.paths()).toEqual(['/r/a.ts', '/r/b.ts']);
    expect(one.listenerCount('render-process-gone')).toBe(1);
  });

  it('Save all asks every window and settles once each window holding files has answered that request, with their failures', async () => {
    const files = trackUnsavedFiles();
    const one = windowOf(1);
    const two = windowOf(2);
    const idle = windowOf(3);
    files.update(clientOf(one as never), ['/r/a.ts']);
    files.update(clientOf(two as never), ['/r/b.ts']);
    files.update(clientOf(idle as never), []);
    const sent: string[] = [];
    let settled = false;
    const done = files.saveAll((requestId) => sent.push(requestId)).then((reasons) => ((settled = true), reasons));
    expect(sent).toHaveLength(1);
    const requestId = sent[0]!;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    files.update(clientOf(one as never), []);
    files.done(clientOf(one as never), requestId, []);
    files.done(clientOf(idle as never), requestId, []); // a window without files answers too; it was not waited on
    files.done(clientOf(two as never), 'an-earlier-request', [{ path: '/r/z.ts', message: 'Saving…' }]); // not this request's
    await settle();
    expect(settled).toBe(false);
    files.done(clientOf(two as never), requestId, [{ path: '/r/b.ts', message: 'Changed on disk since you opened it' }]);
    expect(await done).toEqual(new Map([['/r/b.ts', 'Changed on disk since you opened it']])); // main keeps them by path
    expect(warn).toHaveBeenCalledWith('[quit-guard] could not save /r/b.ts: Changed on disk since you opened it');
    warn.mockRestore();
    expect(files.paths()).toEqual(['/r/b.ts']); // the sets are the windows' pushes; an answer changes none
  });

  it('settles at once, sending nothing, when no window holds files; a window that closes or navigates is not waited on', async () => {
    const files = trackUnsavedFiles();
    const send = vi.fn();
    await files.saveAll(send);
    expect(send).not.toHaveBeenCalled();
    const one = windowOf(1);
    const two = windowOf(2);
    files.update(clientOf(one as never), ['/r/a.ts']);
    files.update(clientOf(two as never), ['/r/b.ts']);
    const done = files.saveAll(send);
    one.emit('destroyed');
    two.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    await done;
    expect(send).toHaveBeenCalledOnce();
  });

  it('a window that never answers is waited on for SAVE_ALL_BOUND_MS, and its files stay unsaved', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const files = trackUnsavedFiles();
      files.update(clientOf(windowOf(1) as never), ['/r/a.ts']);
      let settled = false;
      void files.saveAll(() => {}).then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(SAVE_ALL_BOUND_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
      expect(files.paths()).toEqual(['/r/a.ts']);
      expect(String(warn.mock.calls[0]![0])).toContain('[quit-guard]');
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });
});
// E5 end
