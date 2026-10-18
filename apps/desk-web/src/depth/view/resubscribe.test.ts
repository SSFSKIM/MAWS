// @vitest-environment happy-dom
// When the depth column takes a transcript up again after its subscription ended (other than by a discontinuity, which
// the hub client recovers from): at once when the session becomes reachable again, and at once after the machine's
// stream ended under it while the session stays reachable; otherwise, while it stays reachable, after a backoff of 1 s
// doubling to 60 s, reset by a snapshot; never while it is unreachable. And what the views say of a disruption: nothing
// for its first 15 s while the transcript holds rows, what is true after that, and at once when it holds none, when the
// session goes unreachable, or when the subscription ends for another reason.
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import { FakePlane } from '../../../test/double/fake-plane';
import { readRecording, scriptOf } from '../../../test/double/session-stream';
import type { DeskSession } from '../../shell/sessions';
import { DeskTranscript } from '../source/desk-transcript';
import { QUIET_MS } from '../source/keeper';
import { transcriptStatus, useDeskTranscript } from './TranscriptPane';

const script = scriptOf(readRecording().session, null);
const session = (reachable: boolean): DeskSession =>
  ({
    project: 'proj',
    session: 'sess-1',
    alias: 'maws-45',
    machine: 'mini',
    cwd: null,
    worktree: null,
    seat: '',
    member: true,
    ended: null,
    charge: null,
    status: null,
    state: null,
    joinedAt: 0,
    group: 'working',
    presence: reachable ? { record: { status: 'busy' }, bridge: true } : null,
    machineOnline: reachable,
  }) as DeskSession;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function mount(agentId: string | null = null) {
  const plane = new FakePlane('proj');
  const controller = new DeskTranscript({ plane, project: 'proj', target: { machine: 'mini', session: 'sess-1', agentId }, store: useTranscriptStore });
  const hook = renderHook(({ s }) => useDeskTranscript(controller, s), { initialProps: { s: session(true) } });
  const end = (reason: 'error' | 'machine-offline') => act(() => plane.current.listener.end({ reason }));
  const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
  return { plane, controller, hook, end, wait };
}

describe('taking a transcript up again after its end', () => {
  it('repeated terminal errors while the session stays reachable are retried at the backoff spacing, never back to back', () => {
    const { plane, hook, end, wait } = mount('a1');
    expect(plane.subs).toHaveLength(1);
    for (const [i, spacing] of [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000].entries()) {
      end('error'); // the machine cannot serve this agent's transcript
      hook.rerender({ s: session(true) });
      expect(plane.subs).toHaveLength(i + 1); // not at once
      expect(hook.result.current.retryIn).toBe(spacing);
      wait(spacing - 1);
      expect(plane.subs).toHaveLength(i + 1);
      wait(1);
      expect(plane.subs).toHaveLength(i + 2);
      expect(hook.result.current.retryIn).toBeNull();
    }
  });

  it('a machine stream replaced while its lease was fresh (old subscriptions ended machine-offline, no offline between) is taken up at once, then at the backoff', () => {
    const { plane, controller, hook, end, wait } = mount();
    act(() => plane.current.snapshot(script, 4));
    end('machine-offline');
    hook.rerender({ s: session(true) }); // the replacement publishes as online: the session never reads unreachable
    expect(plane.subs).toHaveLength(2); // no wait: the hub serves it at the machine's next hello
    expect(controller.state.getState().phase).toBe('reconnecting');
    expect(hook.result.current.retryIn).toBeNull();
    end('machine-offline'); // again before a snapshot: the backoff from here
    expect(plane.subs).toHaveLength(2);
    expect(hook.result.current.retryIn).toBe(1000);
    wait(1000);
    expect(plane.subs).toHaveLength(3);
    act(() => plane.current.snapshot(script, 6));
    expect(controller.state.getState().phase).toBe('live');
    end('machine-offline'); // a snapshot gives the next one its immediate retry again
    expect(plane.subs).toHaveLength(4);
  });

  it('a snapshot resets the spacing', () => {
    const { plane, hook, end, wait } = mount();
    end('error');
    wait(1000);
    end('error');
    hook.rerender({ s: session(true) });
    expect(hook.result.current.retryIn).toBe(2000);
    wait(2000);
    expect(plane.subs).toHaveLength(3);
    act(() => plane.current.snapshot(script, 4)); // served again
    end('error');
    expect(hook.result.current.retryIn).toBe(1000);
    wait(1000);
    expect(plane.subs).toHaveLength(4);
  });

  it('nothing is retried while the session is unreachable; becoming reachable again subscribes at once', () => {
    const { plane, controller, hook, end, wait } = mount();
    act(() => plane.current.snapshot(script, 4));
    hook.rerender({ s: session(false) });
    end('machine-offline');
    wait(5 * 60_000);
    expect(plane.subs).toHaveLength(1);
    expect(hook.result.current.retryIn).toBeNull();
    hook.rerender({ s: session(true) });
    expect(plane.subs).toHaveLength(2); // no wait
    expect(controller.state.getState().phase).toBe('reconnecting'); // what it drew stays while the fresh snapshot comes
    wait(60_000);
    expect(plane.subs).toHaveLength(2);
  });

  it('a retry scheduled while reachable is dropped when the session goes unreachable, and the return is immediate', () => {
    const { plane, hook, end, wait } = mount();
    end('error');
    expect(hook.result.current.retryIn).toBe(1000);
    hook.rerender({ s: session(false) });
    wait(10_000);
    expect(plane.subs).toHaveLength(1);
    hook.rerender({ s: session(true) });
    expect(plane.subs).toHaveLength(2);
  });
});

describe('what the views say of a disruption', () => {
  /** A cut at which the snapshot holds rows. */
  const held = script.findLastIndex((item) => item.kind === 'row') + 1;
  const said = (hook: ReturnType<typeof mount>['hook']) => ({ quiet: hook.result.current.quiet, status: transcriptStatus(hook.result.current) });
  const interrupt = (plane: FakePlane) => act(() => plane.current.listener.interrupted());

  it('says nothing of an interruption for 15 s while the transcript holds rows, then that it is reconnecting', () => {
    const { plane, controller, hook, wait } = mount();
    act(() => plane.current.snapshot(script, held));
    interrupt(plane);
    expect(controller.state.getState().phase).toBe('reconnecting');
    expect(said(hook)).toEqual({ quiet: true, status: '' });
    wait(QUIET_MS - 1);
    expect(said(hook)).toEqual({ quiet: true, status: '' });
    wait(1);
    expect(said(hook)).toEqual({ quiet: false, status: 'Reconnecting…' });
    act(() => plane.current.snapshot(script, held));
    expect(said(hook)).toEqual({ quiet: false, status: '' });
  });

  it('a fresh snapshot inside the window ends it: the next disruption has a window of its own', () => {
    const { plane, hook, wait } = mount();
    act(() => plane.current.snapshot(script, held));
    interrupt(plane);
    wait(QUIET_MS - 1000);
    act(() => plane.current.snapshot(script, held));
    expect(said(hook)).toEqual({ quiet: false, status: '' });
    interrupt(plane);
    wait(QUIET_MS - 1);
    expect(said(hook).quiet).toBe(true);
  });

  it('says nothing of the machine stream ending while the session stays reachable; past 15 s, the end and the reconnect', () => {
    const { plane, controller, hook, end, wait } = mount();
    act(() => plane.current.snapshot(script, held));
    end('machine-offline');
    expect(plane.subs).toHaveLength(2);
    expect(said(hook)).toEqual({ quiet: true, status: '' });
    wait(QUIET_MS);
    expect(said(hook)).toEqual({ quiet: false, status: 'Reconnecting…' });
    expect(controller.state.getState().ended).toEqual({ reason: 'machine-offline' }); // the pane's line says why
  });

  it('says it at once when the transcript holds no rows: a first open the hub ended before its snapshot', () => {
    const { plane, hook } = mount();
    interrupt(plane);
    expect(said(hook)).toEqual({ quiet: false, status: 'Reconnecting…' });
  });

  it('stays quiet while the session’s presence is not known: a socket’s reconnect clears it until the hub sends it again', () => {
    const { plane, hook } = mount();
    act(() => plane.current.snapshot(script, held));
    interrupt(plane);
    hook.rerender({ s: { ...session(true), presence: null } }); // the welcome cleared presence
    expect(said(hook)).toEqual({ quiet: true, status: '' });
    hook.rerender({ s: session(true) });
    expect(said(hook)).toEqual({ quiet: true, status: '' });
  });

  it('says it at once, and until the next snapshot, once the session goes unreachable', () => {
    const { plane, hook } = mount();
    act(() => plane.current.snapshot(script, held));
    interrupt(plane);
    expect(said(hook).quiet).toBe(true);
    hook.rerender({ s: session(false) });
    expect(said(hook)).toEqual({ quiet: false, status: 'Reconnecting…' });
    hook.rerender({ s: session(true) });
    expect(said(hook).quiet).toBe(false);
  });

  it('says an end of another kind at once, and does not fall quiet again before the next snapshot', () => {
    const { plane, hook, end, wait } = mount();
    act(() => plane.current.snapshot(script, held));
    interrupt(plane);
    expect(said(hook).quiet).toBe(true);
    end('error');
    expect(said(hook)).toEqual({ quiet: false, status: 'Unavailable' });
    expect(hook.result.current.retryIn).toBe(1000);
    wait(1000);
    expect(plane.subs).toHaveLength(2);
    expect(said(hook)).toEqual({ quiet: false, status: 'Reconnecting…' });
  });
});
