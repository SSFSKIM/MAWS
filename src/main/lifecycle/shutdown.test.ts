// E11 (tracker row E10 "14 will-quit listeners"): main's will-quit steps are one ordered list behind one listener.
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
