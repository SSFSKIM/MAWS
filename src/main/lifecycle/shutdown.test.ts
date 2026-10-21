// E11 (tracker row E10 "14 will-quit listeners"): main's will-quit steps are one ordered list behind one listener.
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { EventId, SessionId } from '@shared/graph/ids';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { sessionIdFor, summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from '../index/index';
import { sideThreadEvents, startSideThreads } from '../side/side-threads';
import { shutdownSteps } from './shutdown';

const BOUND_MS = 1_000;

// Electron's `app` as the list sees it: `will-quit` with a preventable event, and `exit()`.
function fakeApp() {
  const app = Object.assign(new EventEmitter(), { exit: vi.fn() });
  const quit = () => {
    const event = { defaultPrevented: false, preventDefault: () => (event.defaultPrevented = true) };
    app.emit('will-quit', event);
    return event.defaultPrevented;
  };
  return { app, quit };
}

afterEach(() => vi.useRealTimers());

describe('the shutdown list', () => {
  it('registers one will-quit listener, however many steps, and runs the steps in the order they were added', () => {
    const { app, quit } = fakeApp();
    const ran: string[] = [];
    const steps = shutdownSteps(app, BOUND_MS);
    for (const name of ['deliverables', 'git', 'chat panels', 'layout and sessions', 'index', 'usage', 'files', 'scm', 'yield', 'side threads', 'engine configure', 'host configure', 'widgets', 'browser', 'import', 'hosts', 'voice']) {
      steps.add(name, () => void ran.push(name));
    }
    expect(app.listenerCount('will-quit')).toBe(1);
    expect(quit()).toBe(false); // every step synchronous: the quit goes on as Electron runs it
    expect(ran).toEqual(['deliverables', 'git', 'chat panels', 'layout and sessions', 'index', 'usage', 'files', 'scm', 'yield', 'side threads', 'engine configure', 'host configure', 'widgets', 'browser', 'import', 'hosts', 'voice']);
    expect(app.exit).not.toHaveBeenCalled();
  });

  it('a step that throws is logged by name and the steps after it still run', () => {
    const { app, quit } = fakeApp();
    const ran: string[] = [];
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const steps = shutdownSteps(app, BOUND_MS);
      steps.add('index', () => {
        throw new Error('database is locked');
      });
      steps.add('hosts', () => void ran.push('hosts'));
      quit();
      expect(ran).toEqual(['hosts']);
      expect(error).toHaveBeenCalledWith('[shutdown] index failed; going on', expect.objectContaining({ message: 'database is locked' }));
    } finally {
      error.mockRestore();
    }
  });

  // E11 (E10 keep-quit drain, W-A row 128 follow-up): the detached host's draining close is waited for, bounded
  it('holds the quit for a step that answers a promise, the later steps still run at once, and exits when it settles', async () => {
    vi.useFakeTimers();
    const { app, quit } = fakeApp();
    const ran: string[] = [];
    let drained!: () => void;
    const steps = shutdownSteps(app, BOUND_MS);
    steps.add('hosts', () => new Promise<void>((resolve) => (drained = resolve)));
    steps.add('voice', () => void ran.push('voice'));
    expect(quit()).toBe(true);
    expect(ran).toEqual(['voice']);
    await vi.advanceTimersByTimeAsync(BOUND_MS / 2);
    expect(app.exit).not.toHaveBeenCalled();
    drained();
    await vi.advanceTimersByTimeAsync(0);
    expect(app.exit).toHaveBeenCalledOnce();
    expect(app.exit).toHaveBeenCalledWith(0);
  });

  it('exits at the bound when the step never settles, and a will-quit meanwhile runs nothing twice', async () => {
    vi.useFakeTimers();
    const { app, quit } = fakeApp();
    const step = vi.fn(() => new Promise<void>(() => {}));
    shutdownSteps(app, BOUND_MS).add('hosts', step);
    quit();
    expect(quit()).toBe(true); // held again, the steps not run again
    expect(step).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(BOUND_MS - 1);
    expect(app.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(app.exit).toHaveBeenCalledOnce();
  });

  // W-B review M7: a step written as an expression body answers whatever its call does (a Map's delete, a count)
  it('a step answering a truthy value that is not a thenable neither holds the quit nor is logged as failed', () => {
    const { app, quit } = fakeApp();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const steps = shutdownSteps(app, BOUND_MS);
      const answers: unknown[] = [true, 1, 'closed', { closed: true }];
      for (const [i, answer] of answers.entries()) steps.add(`step ${i}`, () => answer as void);
      expect(quit()).toBe(false);
      expect(app.exit).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it('holds the quit for a thenable that is not a native promise', async () => {
    vi.useFakeTimers();
    const { app, quit } = fakeApp();
    let settle!: () => void;
    const native = new Promise<void>((resolve) => (settle = resolve));
    const thenable = { then: (resolve: () => void, reject: (e: unknown) => void) => native.then(resolve, reject) };
    shutdownSteps(app, BOUND_MS).add('hosts', () => thenable as unknown as Promise<void>);
    expect(quit()).toBe(true);
    settle();
    await vi.advanceTimersByTimeAsync(0);
    expect(app.exit).toHaveBeenCalledOnce();
  });

  // W-B review M6: the dock's activate during the keep-quit hold must not open a window over stopped services
  it('reads quitting from the moment the steps begin, through the hold', async () => {
    vi.useFakeTimers();
    const { app, quit } = fakeApp();
    const steps = shutdownSteps(app, BOUND_MS);
    const seen: boolean[] = [];
    steps.add('index', () => void seen.push(steps.quitting()));
    steps.add('hosts', () => new Promise<void>(() => {}));
    expect(steps.quitting()).toBe(false);
    quit();
    expect(seen).toEqual([true]);
    await vi.advanceTimersByTimeAsync(BOUND_MS / 2);
    expect(steps.quitting()).toBe(true);
  });

  it('a step whose promise rejects is logged by name, and the quit still exits', async () => {
    const { app, quit } = fakeApp();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      shutdownSteps(app, BOUND_MS).add('hosts', () => Promise.reject(new Error('socket gone')));
      quit();
      await vi.waitFor(() => expect(app.exit).toHaveBeenCalledOnce());
      expect(error).toHaveBeenCalledWith('[shutdown] hosts failed; going on', expect.objectContaining({ message: 'socket gone' }));
    } finally {
      error.mockRestore();
    }
  });
});

// P4 W2-B (tracker 2026-10-07 "The keep-quit drain…"): the hosts' draining close delivers the supervisor's last lines,
// so it runs before the services that fold them stop, and they stop once it has settled or at the bound
describe('the drain-first phase', () => {
  it('runs a drain before every step and the steps once it settles, so the last line it delivers reaches its consumer', async () => {
    vi.useFakeTimers();
    const { app, quit } = fakeApp();
    const ran: string[] = [];
    const folded: string[] = [];
    let consumer: ((line: string) => void) | null = (line) => void folded.push(line);
    let deliverLast!: () => void;
    const steps = shutdownSteps(app, BOUND_MS);
    steps.add('index', () => void ran.push('index'));
    steps.add('side threads', () => {
      ran.push('side threads');
      consumer = null; // the consumer stops: a line after this is folded nowhere
    });
    steps.drain('hosts', () => {
      ran.push('hosts');
      return new Promise<void>((resolve) => (deliverLast = () => (consumer?.('turn.ended'), resolve())));
    });
    steps.add('voice', () => void ran.push('voice'));
    expect(quit()).toBe(true);
    expect(ran).toEqual(['hosts']); // the consumers still run while the hosts drain
    await vi.advanceTimersByTimeAsync(BOUND_MS / 2);
    expect([ran, steps.quitting(), app.exit.mock.calls.length]).toEqual([['hosts'], true, 0]);
    deliverLast();
    await vi.advanceTimersByTimeAsync(0);
    expect(folded).toEqual(['turn.ended']);
    expect(ran).toEqual(['hosts', 'index', 'side threads', 'voice']);
    expect(app.exit).toHaveBeenCalledOnce();
    expect(app.exit).toHaveBeenCalledWith(0);
  });

  it('a drain with nothing to drain holds nothing: every step runs at once and the quit goes on as Electron runs it', () => {
    const { app, quit } = fakeApp();
    const ran: string[] = [];
    const steps = shutdownSteps(app, BOUND_MS);
    steps.add('index', () => void ran.push('index'));
    steps.drain('hosts', () => void ran.push('hosts')); // a utility host, or a detached one never served
    steps.add('voice', () => void ran.push('voice'));
    expect(quit()).toBe(false);
    expect(ran).toEqual(['hosts', 'index', 'voice']);
    expect(app.exit).not.toHaveBeenCalled();
  });

  it('a drain that never settles: the steps run at the bound and the quit exits then; a will-quit meanwhile runs nothing twice', async () => {
    vi.useFakeTimers();
    const { app, quit } = fakeApp();
    const ran: string[] = [];
    const drain = vi.fn(() => new Promise<void>(() => {}));
    const steps = shutdownSteps(app, BOUND_MS);
    steps.add('index', () => void ran.push('index'));
    steps.drain('hosts', drain);
    quit();
    expect(quit()).toBe(true);
    await vi.advanceTimersByTimeAsync(BOUND_MS - 1);
    expect([ran, app.exit.mock.calls.length]).toEqual([[], 0]);
    await vi.advanceTimersByTimeAsync(1);
    expect(ran).toEqual(['index']);
    expect(app.exit).toHaveBeenCalledOnce();
    expect(drain).toHaveBeenCalledOnce();
  });

  it('a step that answers a promise after the drain is waited for within the same bound, counted from the quit', async () => {
    vi.useFakeTimers();
    const { app, quit } = fakeApp();
    let drained!: () => void;
    const steps = shutdownSteps(app, BOUND_MS);
    steps.add('flush', () => new Promise<void>(() => {}));
    steps.drain('hosts', () => new Promise<void>((resolve) => (drained = resolve)));
    quit();
    await vi.advanceTimersByTimeAsync(BOUND_MS / 2);
    drained();
    await vi.advanceTimersByTimeAsync(BOUND_MS / 2 - 1);
    expect(app.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(app.exit).toHaveBeenCalledOnce();
  });

  it('a drain whose promise rejects and a step that throws after it are logged by name; the rest still run and the quit exits', async () => {
    const { app, quit } = fakeApp();
    const ran: string[] = [];
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const steps = shutdownSteps(app, BOUND_MS);
      steps.add('index', () => {
        throw new Error('database is locked');
      });
      steps.add('voice', () => void ran.push('voice'));
      steps.drain('hosts', () => Promise.reject(new Error('socket gone')));
      quit();
      await vi.waitFor(() => expect(app.exit).toHaveBeenCalledOnce());
      expect(ran).toEqual(['voice']);
      expect(error).toHaveBeenCalledWith('[shutdown] hosts failed; going on', expect.objectContaining({ message: 'socket gone' }));
      expect(error).toHaveBeenCalledWith('[shutdown] index failed; going on', expect.objectContaining({ message: 'database is locked' }));
    } finally {
      error.mockRestore();
    }
  });
});

// P4 W2-B: the row's harm at main's wiring (src/main/index.ts adds 'index' and 'side threads' before 'hosts'): a side
// thread's turn end that the detached host's draining close delivers at a keep-quit is summarised into its parent, in the
// index, before the index closes
describe('a keep-quit drain over the services that fold it', () => {
  it('a side thread’s last turn end, read during the hosts’ draining close, reaches the index before it closes', async () => {
    const dir = tempDir();
    const path = join(dir.path, 'index.sqlite');
    try {
      const index = new Index(path);
      const parent = index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(1) })).record;
      const launched = index.sessions.createForLaunch({
        directory: '/r', additionalDirectories: [], worktree: null, model: { requested: null, resolved: null }, effort: null,
        permissionMode: { requested: 'auto', effective: 'auto', refusal: null },
        lineage: { kind: 'side-thread', parentAppSessionId: parent.appId, parentEngineSessionId: parent.engineSessionId, openedBy: 'btw' },
      }).record;
      const child = index.sessions.bindEngineId(launched.appId, sessionIdFor(2));
      const turnEnded = {
        id: `${child.appId}:1:0` as EventId, sessionId: child.engineSessionId as SessionId, at: '2026-10-21T09:00:01.000Z', seq: 1, agentId: null, parentToolUseId: null,
        kind: 'turn.ended', result: 'success', isError: false, terminalReason: 'completed', resultText: 'Done before the quit.', durationMs: 1, numTurns: 1, costUsd: 0,
        usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, thinkingTokens: null }, permissionDenials: [], errors: [], userMessageUuids: [], origin: 'human', resultIndex: null, isEchoReceipt: false,
      } as SessionEvent;
      // the hosts as the folding services see them: their events, and a stop whose draining close reads the supervisor's
      // last batch after the close began (src/main/hosts/supervisor.ts stop(), detached-transport.ts stop())
      const listeners = new Set<(payload: EventPayload<'session.eventBatch'>) => void>();
      const hosts = {
        onEvent: <N extends EventName>(_name: N, listener: (payload: EventPayload<N>) => void) => {
          listeners.add(listener as never);
          return () => void listeners.delete(listener as never);
        },
        stop: () =>
          new Promise<void>((resolve) =>
            setTimeout(() => {
              for (const listener of [...listeners]) listener({ appSessionId: child.appId, events: [turnEnded] });
              resolve();
            }, 10),
          ),
      };
      const { app, quit } = fakeApp();
      const shutdown = shutdownSteps(app, BOUND_MS);
      shutdown.add('index', () => index.close());
      shutdown.add('side threads', startSideThreads({ onEvent: hosts.onEvent, emit: () => true, sessions: index.sessions, sideThreads: index.sideThreads }));
      shutdown.drain('hosts', () => hosts.stop()); // as index.ts registers it
      expect(quit()).toBe(true);
      await vi.waitFor(() => expect(app.exit).toHaveBeenCalledOnce());
      const reopened = new Index(path); // the next launch
      try {
        expect(sideThreadEvents({ sessions: reopened.sessions, sideThreads: reopened.sideThreads }, parent.appId)).toContainEqual(
          expect.objectContaining({ kind: 'side.thread.summarised', text: 'Done before the quit.', turns: 1 }),
        );
      } finally {
        reopened.close();
      }
    } finally {
      dir.dispose();
    }
  });
});
