// @vitest-environment happy-dom
// When the depth column takes a transcript up again after its subscription ended (other than by a discontinuity, which
// the hub client recovers from): at once when the session becomes reachable again; while it stays reachable, after a
// backoff of 1 s doubling to 60 s, reset by a snapshot; never while it is unreachable.
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import { FakePlane } from '../../../test/double/fake-plane';
import { readRecording, scriptOf } from '../../../test/double/session-stream';
import type { DeskSession } from '../../shell/sessions';
import { DeskTranscript } from '../source/desk-transcript';
import { useDeskTranscript } from './TranscriptPane';

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

  it('a machine replaced while its lease was fresh (old subscriptions ended machine-offline, no offline between) is taken up', () => {
    const { plane, controller, hook, end, wait } = mount();
    act(() => plane.current.snapshot(script, 4));
    end('machine-offline');
    hook.rerender({ s: session(true) }); // the replacement publishes as online: the session never reads unreachable
    expect(controller.state.getState().phase).toBe('ended');
    wait(1000);
    expect(plane.subs).toHaveLength(2);
    act(() => plane.current.snapshot(script, 6));
    expect(controller.state.getState().phase).toBe('live');
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
    expect(controller.state.getState().phase).toBe('loading');
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
