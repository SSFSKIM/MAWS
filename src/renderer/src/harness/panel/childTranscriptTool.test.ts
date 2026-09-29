import { afterEach, describe, expect, it, vi } from 'vitest';
import { PANEL_CHILD_TAIL } from '../../../../../test/support/panel-child-fixture';
import { useTranscriptStore } from '../../stores/transcript';
import { childTranscriptTool } from './childTranscriptTool';
import { fakeId } from './fakeSessions';
import { loadedSession, summaryProbes } from './summaryProbes';

const A = fakeId('A');
const init = { appSessionId: A, session: null, instanceId: 'child:test', params: undefined };

describe('panel harness child transcript', () => {
  afterEach(() => vi.restoreAllMocks());

  it('loadTranscript attaches the player’s key once and the session’s key once, both hydrated before the seek', async () => {
    const attach = vi.spyOn(useTranscriptStore.getState(), 'attach');
    await summaryProbes.loadTranscript('A', 'events/panel-child', { releaseTo: PANEL_CHILD_TAIL.first });
    const session = loadedSession(A)!;
    const keys = attach.mock.calls.map(([key]) => key);
    expect(keys.filter((key) => key === session.key)).toHaveLength(1);
    expect(keys.filter((key) => key === A)).toHaveLength(1);
    const { entries } = useTranscriptStore.getState();
    expect([entries[session.key].phase, entries[A].phase]).toEqual(['live', 'live']);
    expect(entries[A].rows).toEqual(entries[session.key].rows); // both heard the history released by the seek
  });

  it('mounts the loaded session’s first child, whose rows grow to the counts the fixture’s generator recorded', async () => {
    await summaryProbes.loadTranscript('A', 'events/panel-child', { releaseTo: PANEL_CHILD_TAIL.first });
    const session = loadedSession(A)!;
    const state = childTranscriptTool.createState(init);
    expect(state.ref).toMatchObject({ toolUseId: 'toolu_01CYiK6ncgQLFUQ2iqC1b4oB', taskId: 'ad286defbc77bc090' });
    const key = state.source!.key!;
    // The view attaches the child's source as the Transcript does (child variant: the agent's id).
    await useTranscriptStore.getState().attach(key, state.source!, { agentId: state.source!.agentId });
    const rows = () => useTranscriptStore.getState().rows(key);
    // The player releases one event per step, the store applies each as its own batch; the generator applied each
    // batch at once. The counts agree.
    PANEL_CHILD_TAIL.batches.forEach((count, i) => {
      for (let n = 0; n < count; n += 1) session.player.step();
      expect(rows(), `after batch ${i + 1}`).toHaveLength(PANEL_CHILD_TAIL.rows[i]);
    });
    expect(session.player.done).toBe(true);
    expect(rows().filter((row) => row.kind === 'request_slot')).toHaveLength(1);

    childTranscriptTool.dispose(state);
    expect(useTranscriptStore.getState().entries[key], 'dispose forgets the child’s entry').toBeUndefined();
  });

  it('shows a line instead of a transcript when the session has no loaded transcript', () => {
    const state = childTranscriptTool.createState({ ...init, appSessionId: fakeId('B') });
    expect(state.source).toBeNull();
  });
});
