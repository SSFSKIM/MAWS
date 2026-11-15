import { afterEach, describe, expect, it, vi } from 'vitest';
import { PANEL_CHILD_TAIL } from '../../../../../test/support/panel-child-fixture';
import { selectWaitingRequests, useAttention } from '../../stores/attention';
import { useTranscriptStore } from '../../stores/transcript';
import { childTranscriptTool } from './childTranscriptTool';
import { fakeId } from './fakeSessions';
import { loadedSession, summaryProbes } from './summaryProbes';

const playerKeys = () => Object.keys(useTranscriptStore.getState().entries).filter((key) => /^[^/]+\/harness:\d+$/.test(key)); // P5 O6 M2: a player key is an address of the local machine

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
    expect(state.snapshot().ref).toMatchObject({ toolUseId: 'toolu_01CYiK6ncgQLFUQ2iqC1b4oB', taskId: 'ad286defbc77bc090' });
    const { source } = state.snapshot();
    const key = source!.key!;
    // The view attaches the child's source as the Transcript does (child variant: the agent's id).
    await useTranscriptStore.getState().attach(key, source!, { agentId: source!.agentId });
    const rows = () => useTranscriptStore.getState().rows(key);
    // The player releases one event per step, the store applies each as its own batch; the generator applied each
    // batch at once. The counts agree.
    PANEL_CHILD_TAIL.batches.forEach((count, i) => {
      for (let n = 0; n < count; n += 1) session.player.step();
      expect(rows(), `after batch ${i + 1}`).toHaveLength(PANEL_CHILD_TAIL.rows[i]);
    });
    expect(session.player.done).toBe(true);
    expect(rows().filter((row) => row.kind === 'request_slot')).toHaveLength(0); // UX wave U1b: a request makes no row

    childTranscriptTool.dispose(state);
    expect(useTranscriptStore.getState().entries[key], 'dispose forgets the child’s entry').toBeUndefined();
  });

  // UX wave U1b: the child's key names its session, as ipcSource's does, so the child's transcript lists that session's
  // waiting requests; the fixture's pending request reaches the list as the broker lists it, and goes with the tab.
  it('keys the child under its session and lists its pending request in that session’s attention list until the tab closes', async () => {
    await summaryProbes.loadTranscript('A', 'events/panel-child', { releaseTo: PANEL_CHILD_TAIL.first });
    const session = loadedSession(A)!;
    const state = childTranscriptTool.createState(init);
    const source = state.snapshot().source!;
    expect(source.key).toBe(`${A}:ad286defbc77bc090`);
    await useTranscriptStore.getState().attach(source.key!, source, { agentId: source.agentId });
    expect(state.raisePending(), 'nothing pending before the request is released').toBe(0);
    while (!session.player.done) session.player.step();
    expect(state.raisePending()).toBe(1);
    expect(selectWaitingRequests(useAttention.getState(), A).map((item) => [item.kind, item.request.toolUseId, item.request.agentId, item.summary])).toEqual([
      ['permission', 'toolu_panel_child_bash', 'ad286defbc77bc090', 'Bash: pnpm test'],
    ]);
    childTranscriptTool.dispose(state);
    expect(selectWaitingRequests(useAttention.getState(), A), 'closing the tab takes it back').toEqual([]);
  });

  it('shows a line instead of a transcript when the session has no loaded transcript', () => {
    const state = childTranscriptTool.createState({ ...init, appSessionId: fakeId('B') });
    expect(state.snapshot().source).toBeNull();
  });

  it('a tab created before the load finds its child once the load lands, through open() or the load itself (review)', async () => {
    const B = fakeId('B');
    const early = childTranscriptTool.createState({ ...init, appSessionId: B, instanceId: 'child:early' });
    const heard = vi.fn();
    const off = early.subscribe(heard);
    expect(early.snapshot().source).toBeNull();
    await summaryProbes.loadTranscript('B', 'events/panel-child', { releaseTo: PANEL_CHILD_TAIL.first });
    expect(early.snapshot().ref, 'the load notifies the tab').toMatchObject({ toolUseId: 'toolu_01CYiK6ncgQLFUQ2iqC1b4oB' });
    expect(heard).toHaveBeenCalled();
    off();

    const restored = childTranscriptTool.createState({ ...init, appSessionId: B, instanceId: 'child:restored' });
    expect(restored.snapshot().source, 'created after the load: resolved at once').not.toBeNull();
    const reopened = childTranscriptTool.createState({ ...init, appSessionId: fakeId('A'), instanceId: 'child:reopen' });
    await summaryProbes.loadTranscript('A', 'events/panel-child', { releaseTo: PANEL_CHILD_TAIL.first });
    childTranscriptTool.open!(reopened, undefined);
    expect(reopened.snapshot().session, 'open() re-resolves to the latest load').toBe(loadedSession(fakeId('A')));
    [early, restored, reopened].forEach((state) => childTranscriptTool.dispose(state));
  });

  it('a new load retires the previous player: its key and its children’s keys leave the store (review)', async () => {
    const live = () => [fakeId('A'), fakeId('B')].flatMap((id) => loadedSession(id)?.key ?? []).sort();
    await summaryProbes.loadTranscript('A', 'events/panel-child', { releaseTo: PANEL_CHILD_TAIL.first });
    const first = loadedSession(fakeId('A'))!;
    await summaryProbes.loadTranscript('A', 'events/panel-child', { releaseTo: PANEL_CHILD_TAIL.first });
    expect(useTranscriptStore.getState().entries[first.key], 'the old player key is dropped').toBeUndefined();
    expect(playerKeys().sort(), 'one player key per loaded session').toEqual(live());
    // Two loads racing for one session leave only the one that landed last.
    await Promise.all([summaryProbes.loadTranscript('A', 'events/panel-child'), summaryProbes.loadTranscript('A', 'events/panel-child')]);
    expect(playerKeys().sort()).toEqual(live());
  });
});
