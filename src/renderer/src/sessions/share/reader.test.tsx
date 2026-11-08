// Board #525: what the page learns of the member's reach on another member's session, from its machine's refusals, and
// when that is asked afresh; whom the words name; who wrote a prompt there.
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { OrgMember, RemoteRow } from '@shared/ipc/schema/org';
import { addressOf } from '@shared/machine/address';
import { READ_REFUSED } from '@shared/org/reader';
import { remoteRow } from '../../../../../test/support/builders';
import { OTHER_MACHINE } from '../../../../../test/support/machine';
import { applyRemoteSession, resetRemoteLaneBStore } from '../../lane-b/remote-session';
import { remoteSessionState } from '../../lane-b/test-support/remote-session';
import { applyLaneAState, resetLaneAStore } from '../../stores/lane-a';
import { laneAState } from '../../lane-a/test-support/lane-a-state';
import { useSessions } from '../../stores/sessions';
import { rowId } from '../../transcript/model/keys';
import { EMPTY_QUEUE, resetQueueStore, useQueueStore } from '../../stores/queue';
import type { QueueEntry } from '@shared/engine/session-state-store';
import type { MessageUuid } from '@shared/graph/ids';
import { READER } from './copy';
import { closedWords, learnReaderGrade, noteOwnPrompt, noteOwnQueued, useReader, readerGradeOf, resetReader, usePromptAuthor, whomToAsk } from './reader';
import { connectReaderGrades, resetReaderPanes, useReaderPane } from './reader-connect';

const ME = 'member-me';
const ANA: OrgMember = { id: 'member-ana', email: 'ana@example.test', name: 'Ana' };
const BEN: OrgMember = { id: 'member-ben', email: 'ben@example.test', name: 'Ben' };
const S = addressOf(OTHER_MACHINE, 'eng-s' as AppSessionId);
const MINE = addressOf(OTHER_MACHINE, 'eng-mine' as AppSessionId);

function rows(over: Partial<RemoteRow> = {}, member: string | null = ME) {
  const others = { ...remoteRow(OTHER_MACHINE, 'eng-s', { lane: 'A', owners: [ANA.id], mine: false, revision: 4, ...over }), appId: S };
  const mine = { ...remoteRow(OTHER_MACHINE, 'eng-mine', { lane: 'A', owners: [ME], mine: true }), appId: MINE };
  useSessions.setState({ listed: new Map([[S, others], [MINE, mine]]), members: new Map([ANA, BEN].map((m) => [m.id, m] as const)), member });
}

beforeEach(() => rows());
afterEach(() => {
  cleanup();
  resetReader();
  resetReaderPanes();
  resetRemoteLaneBStore();
  resetLaneAStore();
  useSessions.setState({ listed: new Map(), members: new Map(), member: null });
});

describe('what a refusal teaches', () => {
  it('learns a grade only on another member’s listed session: an owner’s `grade` is the machine not holding the record yet', () => {
    expect(learnReaderGrade(MINE, 'list')).toBe(false);
    expect(learnReaderGrade(addressOf(OTHER_MACHINE, 'eng-unlisted' as AppSessionId), 'list')).toBe(false);
    expect(readerGradeOf(MINE)).toBeNull();
    expect(learnReaderGrade(S, 'view')).toBe(true);
    expect(readerGradeOf(S)).toBe('view');
  });

  it('names whom to ask: the owners other than the member, by name, the last after “or”; one the head doesn’t list is not named', () => {
    expect(whomToAsk(S)).toBe('Ana');
    rows({ owners: [ANA.id, ME, BEN.id] });
    expect(whomToAsk(S)).toBe('Ana or Ben');
    rows({ owners: ['member-gone'] });
    useSessions.setState({ members: new Map([['member-gone', { id: 'member-gone', email: null, name: 'former member' }]]) });
    expect(whomToAsk(S)).toBe('its owner');
    expect(closedWords('view', 'Ana')).toBe("You can read this session but not talk to its agent. Ask Ana for Converse.");
    expect(closedWords('list', 'Ana')).toBe("Your agents can message this session. You can't read it. Ask Ana for View to read it.");
  });
});

describe('asked afresh', () => {
  it('forgets what was learnt when the session’s listing revision or policy revision moves, or another member signs in; nothing else forgets it', () => {
    const off = connectReaderGrades(() => {});
    learnReaderGrade(S, 'list');
    act(() => useSessions.setState({ listed: new Map(useSessions.getState().listed) })); // a new map, the row unchanged
    expect(readerGradeOf(S)).toBe('list');
    rows({ revision: 5 });
    expect(readerGradeOf(S)).toBeNull();
    learnReaderGrade(S, 'view');
    rows({ revision: 5, policyRev: 2 }); // a private session's share moved
    expect(readerGradeOf(S)).toBeNull();
    rows({ revision: 5, policyRev: 2 });
    learnReaderGrade(S, 'view');
    rows({ revision: 5, policyRev: 2 }, 'member-other');
    expect(readerGradeOf(S)).toBeNull();
    off();
  });

  it('opens a lane B session main ended as READ_REFUSED again when its listing moves, and none main still reads', () => {
    const retry = vi.fn();
    const off = connectReaderGrades(retry);
    applyRemoteSession(remoteSessionState(S, { stream: 'opening', reason: READ_REFUSED }));
    rows({ revision: 5 });
    expect(retry).not.toHaveBeenCalled(); // its ladder is still asking
    applyRemoteSession(remoteSessionState(S, { stream: 'ended', reason: READ_REFUSED }));
    rows({ revision: 5 });
    expect(retry).not.toHaveBeenCalled(); // nothing moved
    rows({ revision: 6 });
    expect(retry).toHaveBeenCalledTimes(1);
    off();
  });

  it('forgets at a pane’s first opening of the session, not at a second pane of it; a pane opening a refused lane B read asks main again', () => {
    const retry = vi.fn();
    function Pane() {
      useReaderPane(S, retry);
      return null;
    }
    learnReaderGrade(S, 'view');
    render(<Pane />);
    expect(readerGradeOf(S)).toBeNull();
    learnReaderGrade(S, 'view');
    render(<Pane />);
    expect(readerGradeOf(S)).toBe('view');
    cleanup(); // both panes close: the next opening is a reopen
    applyRemoteSession(remoteSessionState(S, { stream: 'ended', reason: READ_REFUSED }));
    render(<Pane />);
    expect(readerGradeOf(S)).toBeNull();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

const prompt = (messageUuid: string | null, id = `row-${messageUuid}`) => ({ id, messageUuid });
const entry = (queueId: string, messageUuid: string | null): QueueEntry => ({ queueId, appSessionId: S, content: 'hi', createdAt: '2026-11-07T00:00:00.000Z', state: messageUuid === null ? 'queued' : 'submitting', messageUuid: messageUuid as MessageUuid | null, submittedAt: null, uncertain: false, steer: false });
const queue = (...entries: QueueEntry[]) => useQueueStore.setState({ bySession: new Map([[S, { ...EMPTY_QUEUE, entries, loaded: true }]]) });

describe('who wrote a prompt', () => {
  it('names another member’s session’s prompts by its owners, but the ones this app sent; the member’s own sessions name none', () => {
    const { result, rerender } = renderHook(({ id }: { id: AppSessionId }) => usePromptAuthor(id), { initialProps: { id: S } });
    expect(result.current?.(prompt('uuid-1'))).toBe('Ana');
    expect(result.current?.(prompt(null))).toBe('Ana');
    act(() => noteOwnPrompt(S, 'uuid-1'));
    expect(result.current?.(prompt('uuid-1'))).toBeNull();
    expect(result.current?.(prompt('uuid-2'))).toBe('Ana');
    rerender({ id: MINE });
    expect(result.current).toBeUndefined();
    noteOwnPrompt(MINE, 'uuid-3'); // nothing kept for the member's own session
    act(() => rows({ owners: ['member-gone'] }));
    rerender({ id: S });
    expect(result.current?.(prompt('uuid-2'))).toBe(READER.author([]));
  });

  it('keeps a prompt lane A says entered from this app’s send as the member’s own', () => {
    const off = connectReaderGrades(() => {});
    const { result } = renderHook(() => usePromptAuthor(S));
    act(() => applyLaneAState(S, laneAState(S, { deliveries: [{ key: { writer: 'w', seq: 1 }, at: '2026-11-07T00:00:00.000Z', state: 'entered', uuid: 'uuid-9' }] })));
    expect(result.current?.(prompt('uuid-9'))).toBeNull();
    off();
  });

  it('names a held row the member sent by its queue id, and takes the entry’s message uuid when it is submitted', () => {
    const off = connectReaderGrades(() => {});
    const { result } = renderHook(() => usePromptAuthor(S));
    act(() => noteOwnQueued(S, 'q-1'));
    expect(result.current?.(prompt(null, rowId.held('q-1')))).toBeNull();
    expect(result.current?.(prompt(null, rowId.held('q-2')))).toBe('Ana'); // another's held row
    act(() => queue(entry('q-1', null), entry('q-2', null)));
    expect(useReader.getState().sent.size).toBe(0);
    act(() => queue(entry('q-1', 'uuid-q1'), entry('q-2', 'uuid-q2')));
    expect(result.current?.(prompt('uuid-q1'))).toBeNull();
    expect(result.current?.(prompt('uuid-q2'))).toBe('Ana'); // not remembered: not this app's send
    off();
    resetQueueStore();
  });

  it('forgets what this app sent when another member signs in, the uuids and the queue ids both', () => {
    const off = connectReaderGrades(() => {});
    const { result } = renderHook(() => usePromptAuthor(S));
    act(() => {
      noteOwnPrompt(S, 'uuid-1');
      noteOwnQueued(S, 'q-1');
    });
    expect(result.current?.(prompt('uuid-1'))).toBeNull();
    act(() => rows({ revision: 4 }, 'member-other'));
    expect(useReader.getState().sent.size + useReader.getState().queued.size).toBe(0);
    expect(result.current?.(prompt('uuid-1'))).toBe('Ana');
    expect(result.current?.(prompt(null, rowId.held('q-1')))).toBe('Ana');
    act(() => queue(entry('q-1', 'uuid-q1')));
    expect(result.current?.(prompt('uuid-q1'))).toBe('Ana'); // the old member's queue id is no longer followed
    off();
    resetQueueStore();
  });
});
