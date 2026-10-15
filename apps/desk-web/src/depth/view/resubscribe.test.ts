// @vitest-environment happy-dom
// When the depth column takes a transcript up again after its subscription ended: only once the session became
// reachable again, never at once after each failure while it stays reachable (DX8: "subscribes again when
// `DeskSession` shows the session reachable").
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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

afterEach(cleanup);

describe('taking a transcript up again after its end', () => {
  it('a terminal error while the session stays reachable subscribes no more; becoming reachable again subscribes once', () => {
    const plane = new FakePlane('proj');
    const controller = new DeskTranscript({ plane, project: 'proj', target: { machine: 'mini', session: 'sess-1', agentId: 'a1' }, store: useTranscriptStore });
    const hook = renderHook(({ s }) => useDeskTranscript(controller, s), { initialProps: { s: session(true) } });
    expect(plane.subs).toHaveLength(1);
    act(() => plane.current.snapshot(script, 4));

    // The machine cannot serve this agent's transcript: the hub ends it with an error, again and again.
    for (let i = 0; i < 5; i++) {
      act(() => plane.current.listener.end({ reason: 'error', message: 'no subagent a1 in this session' }));
      hook.rerender({ s: session(true) });
    }
    expect(controller.state.getState().phase).toBe('ended');
    expect(plane.subs).toHaveLength(1);

    // The session goes away and comes back: one new subscription.
    hook.rerender({ s: session(false) });
    expect(plane.subs).toHaveLength(1);
    hook.rerender({ s: session(true) });
    expect(plane.subs).toHaveLength(2);
    hook.rerender({ s: session(true) });
    expect(plane.subs).toHaveLength(2);

    // It fails again while reachable: no more.
    act(() => plane.current.listener.end({ reason: 'error' }));
    hook.rerender({ s: session(true) });
    expect(plane.subs).toHaveLength(2);
  });

  it('an end while the session is unreachable is taken up when it is reachable again, once', () => {
    const plane = new FakePlane('proj');
    const controller = new DeskTranscript({ plane, project: 'proj', target: { machine: 'mini', session: 'sess-1', agentId: null }, store: useTranscriptStore });
    const hook = renderHook(({ s }) => useDeskTranscript(controller, s), { initialProps: { s: session(true) } });
    act(() => plane.current.snapshot(script, 4));
    hook.rerender({ s: session(false) });
    act(() => plane.current.listener.end({ reason: 'machine-offline' }));
    hook.rerender({ s: session(false) });
    expect(plane.subs).toHaveLength(1);
    hook.rerender({ s: session(true) });
    expect(plane.subs).toHaveLength(2);
    expect(controller.state.getState().phase).toBe('loading');
  });
});
