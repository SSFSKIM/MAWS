// Another machine's terminal sessions in this window (P5 O9 M9): a listed lane A row opens its tab through O8's opener
// registry, and the requests its bridge raised are cards in its pane, put in the attention store with their request views
// while the page watches it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { LaneAState } from '@shared/ipc/schema/lane-a';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { remoteRow } from '../../../../test/support/builders';
import { OTHER_MACHINE } from '../../../../test/support/machine';
import { remoteOpenerFor } from '../sessions/remote-openers';
import { useAttention } from '../stores/attention';
import { applyLaneAState, resetLaneAStore } from '../stores/lane-a';
import { useLayout } from '../stores/layout';
import { activeTab } from '../stores/layout-model';
import { laneAState } from './test-support/lane-a-state';
import { connectRemoteLaneA } from './remote-connect';

const REMOTE = addressOf(OTHER_MACHINE, 'eng-r' as AppSessionId);
const LINK: NonNullable<LaneAState['link']> = { state: 'up', refusal: null, carrier: 'direct', member: 'm', clientClass: 'native-mac', rights: [], reason: null };
const raised = { request: 'toolu_1', session: 'eng-r', tool: 'Bash', input: { command: 'npm test' }, t: Date.parse('2026-10-29T08:00:00Z') };

let off: () => void = () => {};
beforeEach(() => {
  resetLaneAStore();
  useAttention.setState({ bySession: new Map(), requests: new Map() });
  off = connectRemoteLaneA();
});
afterEach(() => off());

describe('connectRemoteLaneA', () => {
  it('registers lane A’s opener: a listed lane A row opens its session’s tab', () => {
    const open = remoteOpenerFor('A');
    expect(open).not.toBeNull();
    open!({ ...remoteRow(OTHER_MACHINE, 'eng-r', { lane: 'A', availability: 'foreign_held' }), appId: REMOTE });
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'session', appSessionId: REMOTE });
    off();
    expect(remoteOpenerFor('A')).toBeNull();
  });

  it('puts a remote session’s pending requests in its pane’s attention, each with its request view, until settled or unwatched', () => {
    applyLaneAState(REMOTE, laneAState(REMOTE, { engineSessionId: 'eng-r', link: LINK, acts: [], pending: [raised] }));
    const [item] = useAttention.getState().bySession.get(REMOTE)!;
    expect(item).toMatchObject({ id: addressOf(OTHER_MACHINE, 'lane-a:eng-r:toolu_1'), appSessionId: REMOTE, kind: 'permission', summary: 'Bash: npm test', createdAt: '2026-10-29T08:00:00.000Z', request: { requestId: 'toolu_1' } });
    expect(useAttention.getState().requests.get(item.id)).toMatchObject({ kind: 'permission.requested', toolName: 'Bash', input: { command: 'npm test' } });
    applyLaneAState(REMOTE, laneAState(REMOTE, { engineSessionId: 'eng-r', link: LINK, acts: [], pending: [] }));
    expect(useAttention.getState().bySession.get(REMOTE)).toEqual([]);
    applyLaneAState(REMOTE, laneAState(REMOTE, { engineSessionId: 'eng-r', link: LINK, acts: [], pending: [raised] }));
    expect(useAttention.getState().bySession.get(REMOTE)).toHaveLength(1);
    applyLaneAState(REMOTE, null); // the last watch ended
    expect(useAttention.getState().bySession.get(REMOTE)).toEqual([]);
  });

  // OX2: an attention id is machine-bound, so the mirror lifts it to the session's machine as main's ids are lifted at
  // the IPC boundary; the request view and a question's draft are keyed by it, and two machines' requests stay apart.
  it('addresses each item to its machine, so one engine session and request id on two machines are two cards', () => {
    const THIRD = 'ThirdMachineRef0000000' as MachineRef;
    const there = addressOf(THIRD, 'eng-r' as AppSessionId);
    const question = { ...raised, tool: 'AskUserQuestion', input: { questions: [{ question: 'Which file?', header: 'File', options: [], multiSelect: false }] } };
    applyLaneAState(REMOTE, laneAState(REMOTE, { engineSessionId: 'eng-r', link: LINK, acts: [], pending: [raised] }));
    applyLaneAState(there, laneAState(there, { engineSessionId: 'eng-r', link: LINK, acts: [], pending: [question] }));
    const here = useAttention.getState().bySession.get(REMOTE)![0];
    const third = useAttention.getState().bySession.get(there)![0];
    expect([here.id, third.id]).toEqual([addressOf(OTHER_MACHINE, 'lane-a:eng-r:toolu_1'), addressOf(THIRD, 'lane-a:eng-r:toolu_1')]);
    expect(useAttention.getState().requests.get(here.id)).toMatchObject({ kind: 'permission.requested', toolName: 'Bash' });
    expect(useAttention.getState().requests.get(third.id)).toMatchObject({ kind: 'question.requested' });
    useAttention.getState().setDraft(third.id, { answers: { 'Which file?': 'a.ts' } } as never);
    applyLaneAState(REMOTE, laneAState(REMOTE, { engineSessionId: 'eng-r', link: LINK, acts: [], pending: [] }));
    expect(useAttention.getState().bySession.get(there)).toHaveLength(1);
    expect(useAttention.getState().drafts.has(third.id)).toBe(true); // the other machine's settling leaves this one's draft
  });

  it('leaves a local state’s requests to main’s own list', () => {
    const local = 'TestMachineRef00000000/app-l' as AppSessionId;
    applyLaneAState(local, laneAState(local, { pending: [raised] }));
    expect(useAttention.getState().bySession.has(local)).toBe(false);
  });
});
