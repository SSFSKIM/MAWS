// The repair window's controller (P5 O15 M2, docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, M2 "Retrying",
// Interfaces §B): one attempt at a time, each running §A's table again from the top; a retry from the button, from the
// window's focus after Open Login Items was used, and from a second launch; no timer; the first success ends it.
import { describe, expect, it, vi } from 'vitest';
import type { LaunchOutcome } from '../hosts/daemon';
import type { RepairState } from '@shared/repair';
import { createRepairController, type RepairControllerDeps } from './controller';

const NOT_LOADED = { kind: 'not-loaded', why: 'the LaunchAgent is installed but not loaded' } as const;
const LOG = { path: '/p/mawsd/mawsd.log', lines: ['starting'] };

function scene(over: Partial<RepairControllerDeps> = {}) {
  const pending: ((outcome: LaunchOutcome) => void)[] = [];
  const states: RepairState[] = [];
  const deps: RepairControllerDeps = {
    first: NOT_LOADED,
    packaged: true,
    attempt: vi.fn(() => new Promise<LaunchOutcome>((resolve) => pending.push(resolve))),
    readLog: vi.fn(() => LOG),
    changed: (state) => void states.push(state),
    openLoginItems: vi.fn(),
    revealLog: vi.fn(),
    quit: vi.fn(),
    succeeded: vi.fn(),
    ...over,
  };
  const controller = createRepairController(deps);
  const answer = async (outcome: LaunchOutcome) => {
    pending.shift()!(outcome);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { controller, deps, states, answer, pending };
}

describe('the repair controller', () => {
  it('starts from the first failure, its log read, nothing attempted', () => {
    const { controller, deps } = scene();
    expect(controller.state()).toEqual({ kind: 'not-loaded', why: NOT_LOADED.why, packaged: true, attempting: false, log: LOG });
    expect(deps.attempt).not.toHaveBeenCalled();
  });

  it('a retry runs one attempt, says so, and takes a failure as the new state with the log read again', async () => {
    const { controller, deps, states, answer } = scene();
    controller.act('retry');
    expect(controller.state().attempting).toBe(true);
    expect(states.at(-1)?.attempting).toBe(true);
    (deps.readLog as ReturnType<typeof vi.fn>).mockReturnValue({ path: LOG.path, lines: ['starting', 'refused'] });
    await answer({ ok: false, unavailable: { kind: 'not-started', why: 'no mawsd welcomed a hello' } });
    expect(controller.state()).toEqual({ kind: 'not-started', why: 'no mawsd welcomed a hello', packaged: true, attempting: false, log: { path: LOG.path, lines: ['starting', 'refused'] } });
    expect(states.at(-1)).toEqual(controller.state());
    expect(deps.readLog).toHaveBeenCalledTimes(3); // at the start, and at each change
  });

  it('runs one attempt at a time: a retry, a focus or a second launch while one runs starts none', async () => {
    const { controller, deps, answer } = scene();
    controller.act('open-login-items');
    controller.act('retry');
    controller.act('retry');
    controller.focused();
    controller.secondLaunch();
    expect(deps.attempt).toHaveBeenCalledTimes(1);
    await answer({ ok: false, unavailable: NOT_LOADED });
    controller.act('retry');
    expect(deps.attempt).toHaveBeenCalledTimes(2);
  });

  it('the first success ends it: the launch handed on once, and nothing after starts another attempt', async () => {
    const { controller, deps, answer } = scene();
    controller.act('retry');
    await answer({ ok: true, launch: { daemon: 'unit' } });
    expect(deps.succeeded).toHaveBeenCalledExactlyOnceWith({ daemon: 'unit' });
    controller.act('retry');
    controller.secondLaunch();
    controller.act('quit');
    expect(deps.attempt).toHaveBeenCalledTimes(1);
    expect(deps.quit).not.toHaveBeenCalled();
  });

  it('after Open Login Items, the window’s next focus starts exactly one attempt; a focus before it starts none', async () => {
    const { controller, deps, answer } = scene();
    controller.focused();
    expect(deps.attempt).not.toHaveBeenCalled();
    controller.act('open-login-items');
    expect(deps.openLoginItems).toHaveBeenCalledOnce();
    expect(deps.attempt).not.toHaveBeenCalled();
    controller.focused();
    controller.focused();
    expect(deps.attempt).toHaveBeenCalledTimes(1);
    await answer({ ok: false, unavailable: NOT_LOADED });
    controller.focused();
    expect(deps.attempt, 'the focus retry is spent until Open Login Items is used again').toHaveBeenCalledTimes(1);
  });

  it('a second launch of MAWS starts one attempt', () => {
    const { controller, deps } = scene();
    controller.secondLaunch();
    expect(deps.attempt).toHaveBeenCalledTimes(1);
  });

  it('retries on no timer', async () => {
    vi.useFakeTimers();
    try {
      const { deps } = scene();
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(deps.attempt).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the log in Finder when there is one, and quits when asked', () => {
    const { controller, deps } = scene();
    controller.act('reveal-log');
    expect(deps.revealLog).toHaveBeenCalledExactlyOnceWith(LOG.path);
    controller.act('quit');
    expect(deps.quit).toHaveBeenCalledOnce();
    const none = scene({ readLog: () => null });
    none.controller.act('reveal-log');
    expect(none.deps.revealLog).not.toHaveBeenCalled();
  });

  it('an attempt that throws leaves the window up, its kind kept and the error as its why', async () => {
    const { controller } = scene({ attempt: () => Promise.reject(new Error('boom')) });
    controller.act('retry');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(controller.state()).toMatchObject({ kind: 'not-loaded', why: 'boom', attempting: false });
  });

  // Fix wave 1: the window shows whatever the log read does
  it('starts and changes with no log when reading it throws', async () => {
    const { controller, states, answer } = scene({
      readLog: () => {
        throw new Error('EISDIR: illegal operation on a directory, read');
      },
    });
    expect(controller.state().log).toBeNull();
    controller.act('retry');
    await answer({ ok: false, unavailable: NOT_LOADED });
    expect(states.map((state) => [state.attempting, state.log])).toEqual([[true, null], [false, null]]);
  });

  it('takes a synchronous outcome as well', () => {
    const { controller, deps } = scene({ attempt: () => ({ ok: true, launch: { daemon: 'private' } }) });
    controller.act('retry');
    return vi.waitFor(() => expect(deps.succeeded).toHaveBeenCalledExactlyOnceWith({ daemon: 'private' }));
  });
});
