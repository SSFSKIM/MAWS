// E1 M4: the Question sheet's per-session store and its connection (E1 execution document, M4's decisions). Pending asks
// come from `maws.asks.list` (the host's table, G6) and from live `maws.ask.*` events, an event winning over a snapshot
// still on its way; drafts live in the store; Submit goes through `maws.ask.answer` and follows its three outcomes; a
// host back at `ready` is read again; a live `maws.ask.opened` opens the sheet for a session this window knows.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import type { PendingAsk } from '@shared/maws/ask';
import { ASK_SHEET_TOOL_ID } from '@shared/maws/panes';
import type { AskQuestion } from '@shared/maws/tools';
import { fakeClient } from '../../../../../../test/support/fake-client';
import { record } from '../../../../../../test/support/builders';
import { registerPanelTool } from '../../../panel/host';
import { A, panelOf, probeTool, resetPanelStores } from '../../../test-support/panel';
import { useSessions } from '../../../stores/sessions';
import type { AskRowData } from '../../../transcript';
import { connectAsks } from './connect';
import { EMPTY_DRAFT, pickOption, setText } from './draft';
import { applyAskEvents, askSheet, editDraft, ensureLoaded, resetAskSheets, selectAsk, shownAsk, submitAsk } from './store';

const QUESTIONS: AskQuestion[] = [
  { id: 'q1', question: 'Which colour?', modality: 'choice', options: [{ label: 'Red' }, { label: 'Blue' }] },
  { id: 'q2', question: 'What title?', modality: 'text' },
];
const pending = (askId: string, over: Partial<PendingAsk> = {}): PendingAsk => ({
  askId, toolUseId: askId as ToolUseId, requestId: `r-${askId}` as RequestId, blocking: true, title: 'Setup', context: null, questions: QUESTIONS, openedAt: '2026-10-06T00:00:00.000Z', ...over,
});

let seq = 0;
function ev<K extends SessionEvent['kind']>(kind: K, body: Omit<Extract<SessionEvent, { kind: K }>, 'kind' | 'id' | 'sessionId' | 'at' | 'seq' | 'agentId' | 'parentToolUseId'>): SessionEvent {
  seq += 1;
  return { id: `e${seq}`, sessionId: 'eng-a', at: '2026-10-06T00:00:01.000Z', seq, agentId: null, parentToolUseId: null, kind, ...body } as unknown as SessionEvent;
}
const opened = (askId: string, over: Partial<PendingAsk> = {}) => {
  const ask = pending(askId, over);
  return ev('maws.ask.opened', { askId, toolUseId: ask.toolUseId, requestId: ask.requestId, blocking: ask.blocking, title: ask.title, context: ask.context, questions: ask.questions });
};
const answered = (askId: string) => ev('maws.ask.answered', { askId, toolUseId: askId as ToolUseId, answers: [], delivery: 'result' });
const cancelled = (askId: string) => ev('maws.ask.cancelled', { askId, toolUseId: askId as ToolUseId, reason: 'exit' });

const state = () => askSheet(A).getState();
const shown = () => shownAsk(state());

beforeEach(() => {
  resetAskSheets();
  resetPanelStores();
});
afterEach(() => {
  resetAskSheets();
  resetPanelStores();
});

describe('loading the host’s table', () => {
  it('lists the pending asks once per session, the first one shown', async () => {
    const fake = fakeClient();
    ensureLoaded(A, fake.client);
    ensureLoaded(A, fake.client);
    expect(fake.invoked('maws.asks.list')).toEqual([{ appSessionId: A }]);
    await fake.reply('maws.asks.list', { asks: [pending('a1'), pending('a2')] });
    expect(state().loaded).toBe(true);
    expect([...state().asks.keys()]).toEqual(['a1', 'a2']);
    expect(shown()).toMatchObject({ kind: 'live', ask: { askId: 'a1', state: 'pending' } });
  });

  it('an event wins over a snapshot still on its way', async () => {
    const fake = fakeClient();
    ensureLoaded(A, fake.client);
    applyAskEvents(A, [answered('a1'), opened('a3')]);
    await fake.reply('maws.asks.list', { asks: [pending('a1'), pending('a2')] });
    // a1 was answered after the read left: it stays gone; a3 opened: it stays; a2 came from the snapshot
    expect([...state().asks.keys()].sort()).toEqual(['a2', 'a3']);
  });

  it('a snapshot drops the pending asks the host no longer holds, but keeps a cancelled one for its notice', async () => {
    const fake = fakeClient();
    applyAskEvents(A, [opened('a1'), opened('a2'), cancelled('a2')]);
    ensureLoaded(A, fake.client);
    await fake.reply('maws.asks.list', { asks: [] });
    expect([...state().asks.values()].map((ask) => [ask.askId, ask.state])).toEqual([['a2', 'cancelled']]);
  });

  it('a host back at ready is read again for every session read before', async () => {
    const fake = fakeClient();
    const off = connectAsks(fake.client);
    ensureLoaded(A, fake.client);
    await fake.reply('maws.asks.list', { asks: [pending('a1')] });
    fake.event('engine.hostState', { state: 'restarting', pid: null, restarts: 1, revision: 2 });
    expect(fake.pending('maws.asks.list')).toBe(0);
    fake.event('engine.hostState', { state: 'ready', pid: 2, restarts: 1, revision: 3 });
    expect(fake.invoked('maws.asks.list')).toEqual([{ appSessionId: A }, { appSessionId: A }]);
    await fake.reply('maws.asks.list', { asks: [] }); // the restarted host lost its table
    expect(state().asks.size).toBe(0);
    expect(shown()).toEqual({ kind: 'rest' });
    off();
  });

  it('a refused read leaves the store unloaded, to be read at the next ready', async () => {
    const fake = fakeClient();
    ensureLoaded(A, fake.client);
    await fake.fail('maws.asks.list', 'engine host unavailable');
    expect(state().loaded).toBe(false);
  });
});

describe('live events', () => {
  it('opened adds a pending ask, answered drops it with its drafts, cancelled marks it', () => {
    applyAskEvents(A, [opened('a1'), opened('a2')]);
    editDraft(A, 'a1', 'q2', (draft) => setText(draft, 'x'));
    selectAsk(A, 'a1');
    applyAskEvents(A, [answered('a1')]);
    expect(state().asks.has('a1')).toBe(false);
    expect(state().drafts.has('a1')).toBe(false);
    expect(shown()).toMatchObject({ kind: 'live', ask: { askId: 'a2' } }); // the next pending ask
    applyAskEvents(A, [cancelled('a2')]);
    expect(shown()).toMatchObject({ kind: 'live', ask: { askId: 'a2', state: 'cancelled' } });
  });

  it('returns the asks a batch opened that are still pending at its end', () => {
    expect(applyAskEvents(A, [opened('a1'), opened('a2'), answered('a1')])).toEqual(['a2']);
    expect(applyAskEvents(A, [ev('turn.ended', {} as never)])).toEqual([]);
  });
});

describe('selection', () => {
  const HISTORICAL: AskRowData = {
    askId: 'old', toolUseId: 'old' as ToolUseId, title: 'Before', context: null, blocking: true, questions: QUESTIONS, state: 'answered',
    answers: [{ id: 'q1', question: 'Which colour?', status: 'answered', value: ['Red'] }, { id: 'q2', question: 'What title?', status: 'skipped' }], error: null,
  };

  it('a capsule’s ask the store does not hold is shown from its own data, also before any read', () => {
    selectAsk(A, 'old', HISTORICAL);
    expect(shown()).toEqual({ kind: 'historical', ask: HISTORICAL });
  });

  it('a capsule’s ask the store holds is the live one', () => {
    applyAskEvents(A, [opened('a1')]);
    selectAsk(A, 'a1', { ...HISTORICAL, askId: 'a1', state: 'pending', answers: null });
    expect(shown()).toMatchObject({ kind: 'live', ask: { askId: 'a1' } });
  });

  it('nothing held and nothing handed over: the resting state', () => {
    expect(shown()).toEqual({ kind: 'rest' });
  });
});

describe('Submit', () => {
  const ready = () => {
    applyAskEvents(A, [opened('a1'), opened('a2')]);
    selectAsk(A, 'a1');
    editDraft(A, 'a1', 'q1', (draft) => pickOption(QUESTIONS[0]!, draft, 'Blue'));
  };

  it('sends one answer per question, the empty ones skipped; delivered drops the ask and shows the next', async () => {
    ready();
    const fake = fakeClient();
    const done = submitAsk(A, 'a1', fake.client, []);
    expect(state().submitting).toBe('a1');
    expect(fake.invoked('maws.ask.answer')).toEqual([{
      appSessionId: A, askId: 'a1', answers: [{ id: 'q1', question: 'Which colour?', status: 'answered', value: ['Blue'] }, { id: 'q2', question: 'What title?', status: 'skipped' }],
    }]);
    await fake.reply('maws.ask.answer', { outcome: 'delivered' });
    await done;
    expect(state().submitting).toBeNull();
    expect(state().asks.has('a1')).toBe(false);
    expect(shown()).toMatchObject({ kind: 'live', ask: { askId: 'a2' } });
  });

  it('write_failed keeps the drafts and offers a retry, which delivers', async () => {
    ready();
    const fake = fakeClient();
    const first = submitAsk(A, 'a1', fake.client, []);
    await fake.reply('maws.ask.answer', { outcome: 'write_failed' });
    await first;
    expect(state().failed).toEqual({ askId: 'a1', detail: null });
    expect(state().drafts.get('a1')?.get('q1')).toEqual({ ...EMPTY_DRAFT, selected: ['Blue'] });
    const retry = submitAsk(A, 'a1', fake.client, []);
    expect(state().failed).toBeNull();
    await fake.reply('maws.ask.answer', { outcome: 'delivered' });
    await retry;
    expect(state().asks.has('a1')).toBe(false);
  });

  it('a refused command fails the same way, with its message', async () => {
    ready();
    const fake = fakeClient();
    const done = submitAsk(A, 'a1', fake.client, []);
    await fake.fail('maws.ask.answer', 'engine host unavailable');
    await done;
    expect(state().failed).toEqual({ askId: 'a1', detail: 'engine host unavailable' });
  });

  it('not_pending drops the ask and says it was answered elsewhere', async () => {
    ready();
    const fake = fakeClient();
    const done = submitAsk(A, 'a1', fake.client, []);
    await fake.reply('maws.ask.answer', { outcome: 'not_pending' });
    await done;
    expect(state().asks.has('a1')).toBe(false);
    expect(state().notice).toBe('Already answered elsewhere');
  });
});

describe('connectAsks', () => {
  const known = () => useSessions.setState({ records: new Map([[A, record(A)]]) });

  it('opens the sheet for a live maws.ask.opened, activated, with the ask selected', () => {
    known();
    const { tool, probe } = probeTool(ASK_SHEET_TOOL_ID, { multiInstance: false, pinnable: false });
    registerPanelTool(tool);
    const fake = fakeClient();
    const off = connectAsks(fake.client);
    fake.event('session.eventBatch', { appSessionId: A, events: [opened('a1')] });
    expect(probe.created.map((init) => [init.appSessionId, init.params])).toEqual([[A, { askId: 'a1' }]]);
    expect(panelOf(A)?.activeTabId).toBe(panelOf(A)?.tabs[0]?.id);
    // a second ask re-targets the same tab
    fake.event('session.eventBatch', { appSessionId: A, events: [opened('a2')] });
    expect(probe.created).toHaveLength(1);
    expect(probe.opens.map((open) => open.params)).toEqual([{ askId: 'a2' }]);
    expect([...state().asks.keys()]).toEqual(['a1', 'a2']);
    off();
  });

  it('opens nothing for an ask already answered in its batch, nor for a session this window does not know', () => {
    const { tool, probe } = probeTool(ASK_SHEET_TOOL_ID, { multiInstance: false, pinnable: false });
    registerPanelTool(tool);
    const fake = fakeClient();
    const off = connectAsks(fake.client);
    useSessions.setState({ records: new Map() });
    fake.event('session.eventBatch', { appSessionId: A, events: [opened('a1')] }); // A unknown here
    known();
    fake.event('session.eventBatch', { appSessionId: A, events: [opened('a2'), answered('a2')] });
    expect(probe.created).toEqual([]);
    expect([...state().asks.keys()]).toEqual(['a1']); // the store still follows the session
    off();
  });
});

// The store is per session: another session's events never reach this one.
it('stores are per session', () => {
  applyAskEvents('app-b' as AppSessionId, [opened('b1')]);
  expect(state().asks.size).toBe(0);
  expect(askSheet('app-b' as AppSessionId).getState().asks.has('b1')).toBe(true);
});
