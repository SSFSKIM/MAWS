// UX wave U10b (M5; docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md §C.4, §C.5): the act behind Undo of an
// agent's delete. It goes to the artifact's machine: a session's row records it as the side column's open does, also for
// an artifact the window has never listed. What it resolves: null once the artifact is live again; this Mac's refusal
// after "Not restored:"; another machine's as main words it, a link that drops mid-act included. The notice reads the
// disabled sentences for the artifact's machine (`disabledWords`).
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { SESSION_ACTS_CAPABILITY } from '@shared/ipc/remote-unavailable';
import type { MachineState } from '@shared/ipc/schema/machines';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { artifactMachineOf, resetArtifactMachines } from '../artifacts/machines';
import { useMachines } from '../stores/machines';
import { deferred, installFakeMain, ok } from '../test-support/code';
import { undeleteArtifact, undeleteSessionArtifact } from './actions';
import { useMachineUndoUnavailable, useUndoAct } from './undo-delete';

const DRAFT = '6b0f6b2e-1d7a-4c35-9a59-2f1c0c4f7a11';
const MINI: MachineState = { ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-11-15T09:00:00.000Z', generation: 1, carrier: 'relay' };
let answer: () => unknown;
let sent: { input: unknown; machine: MachineRef | undefined }[];

beforeEach(() => {
  resetArtifactMachines();
  sent = [];
  answer = () => ok();
  installFakeMain((name, input, machine) => {
    if (name !== 'artifacts.undelete') return new Promise(() => {});
    sent.push({ input, machine });
    return answer() as never;
  });
});
afterEach(() => {
  cleanup();
  useMachines.getState().applyRoster([]);
  delete (window as { maws?: unknown }).maws;
});

describe('the undelete', () => {
  it('a session’s row sends it to the session’s machine, recorded for an artifact the window never listed', async () => {
    const remote = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
    expect(artifactMachineOf(DRAFT)).toBeNull();
    expect(await undeleteSessionArtifact(remote, DRAFT)).toBeNull();
    expect(sent).toEqual([{ input: { artifactId: DRAFT }, machine: OTHER_MACHINE }]);
    expect(artifactMachineOf(DRAFT)).toBe(OTHER_MACHINE);
    sent = [];
    resetArtifactMachines();
    expect(await undeleteSessionArtifact(at('app-l' as AppSessionId), DRAFT)).toBeNull();
    expect(sent.map((s) => s.machine)).toEqual([TEST_MACHINE]);
  });

  it('resolves this Mac’s refusal after "Not restored:", and another machine’s sentence as main words it', async () => {
    answer = () => ({ ok: false, error: { code: 'invalid_input', message: 'this artifact was deleted in the Library, not by an agent', issues: { reason: 'invalid', data: {} } } });
    expect(await undeleteArtifact(DRAFT, TEST_MACHINE)).toBe('Not restored: this artifact was deleted in the Library, not by an agent');
    answer = () => ({ ok: false, error: { code: 'host_unavailable', message: 'Not restored: mini is offline', issues: { refusal: 'offline' } } }); // the link dropped mid-act
    expect(await undeleteArtifact(DRAFT, OTHER_MACHINE)).toBe('Not restored: mini is offline');
  });
});

describe('Undo’s act', () => {
  it('is busy while the act runs, sends once however often it is pressed, and keeps the sentence an act ended with until the next press', async () => {
    const runs: ReturnType<typeof deferred<string | null>>[] = [];
    const { result } = renderHook(() =>
      useUndoAct(() => {
        const run = deferred<string | null>();
        runs.push(run);
        return run.promise;
      }),
    );
    act(() => {
      result.current.press();
      result.current.press();
    });
    expect(runs).toHaveLength(1);
    expect(result.current.busy).toBe(true);
    await act(async () => runs[0]!.resolve('Not restored: mini is offline'));
    expect(result.current).toMatchObject({ busy: false, failure: 'Not restored: mini is offline' });
    act(() => result.current.press());
    expect(result.current).toMatchObject({ busy: true, failure: null });
    await act(async () => runs[1]!.resolve(null));
    expect(result.current).toMatchObject({ busy: false, failure: null });
  });
});

describe('the notice’s disabled sentence for the artifact’s machine', () => {
  const sentence = (standing: Partial<MachineState>, machine: MachineRef = OTHER_MACHINE) => {
    useMachines.getState().applyRoster([{ ...MINI, ...standing }]);
    const { result, unmount } = renderHook(() => useMachineUndoUnavailable(machine));
    const said = result.current;
    unmount();
    return said;
  };
  it('words offline, a build without the capability and a member who does not own the machine; nothing on this Mac or when Undo can work', () => {
    expect(sentence({ state: 'down', generation: 0, since: new Date().toISOString() })).toBe('Restore is unavailable while mini is offline.');
    expect(sentence({ capabilities: [SESSION_ACTS_CAPABILITY], owner: true })).toBe('Can’t restore on mini yet. Update MAWS on mini and try again.');
    expect(sentence({ capabilities: ['rl2.artifact-undelete'], owner: false })).toBe('Only mini’s owners can restore an artifact there.');
    expect(sentence({ capabilities: ['rl2.artifact-undelete'], owner: true })).toBeNull();
    expect(sentence({ state: 'down', generation: 0, since: new Date().toISOString() }, TEST_MACHINE)).toBeNull();
  });
});
