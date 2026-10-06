// E1 M4: the Question sheet's per-session store and its connection (E1 execution document, M4's decisions). Pending asks
// come from `maws.asks.list` (the host's table, G6) and from live `maws.ask.*` events, an event winning over a snapshot
// still on its way; drafts live in the store; Submit goes through `maws.ask.answer` and follows its three outcomes; a
// host back at `ready` is read again; a live `maws.ask.opened` opens the sheet for a session this window knows.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import type { PendingAsk } from '@shared/maws/ask';
import { ASK_SHEET_TOOL_ID } from '@shared/maws/panes';
import type { AskQuestion } from '@shared/maws/tools';
import { fakeClient } from '../../../../../../test/support/fake-client';
import { record } from '../../../../../../test/support/builders';
import { registerPanelTool } from '../../../panel/host';
import { A, B, mainShowing, panelOf, probeTool, resetPanelStores } from '../../../test-support/panel';
import { useLayout } from '../../../stores/layout';
import { activeTab, sessionOfTab } from '../../../stores/layout-model';
import { useSessions } from '../../../stores/sessions';
import type { AskRowData } from '../../../transcript';
import { mawsTranscriptActionsOver } from '../actions';
import { connectAsks } from './connect';
import { EMPTY_DRAFT, pickOption, setOther, setText } from './draft';
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
  vi.restoreAllMocks();
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

  it('a refused read leaves the store unloaded with the refusal, and the next mount reads again', async () => {
    const fake = fakeClient();
    ensureLoaded(A, fake.client);
    expect(state().reading).toBe(true);
    ensureLoaded(A, fake.client); // a read in flight: no second one
    expect(fake.invoked('maws.asks.list')).toHaveLength(1);
    await fake.fail('maws.asks.list', 'engine host unavailable');
    expect(state()).toMatchObject({ loaded: false, reading: false, readError: 'engine host unavailable' });
    ensureLoaded(A, fake.client); // the sheet mounted again
    expect(fake.invoked('maws.asks.list')).toHaveLength(2);
    await fake.reply('maws.asks.list', { asks: [pending('a1')] });
    expect(state()).toMatchObject({ loaded: true, reading: false, readError: null });
    ensureLoaded(A, fake.client); // loaded: the events keep it current
    expect(fake.invoked('maws.asks.list')).toHaveLength(2);
  });

  it('a refused read is still re-read at the next ready', async () => {
    const fake = fakeClient();
    const off = connectAsks(fake.client);
    ensureLoaded(A, fake.client);
    await fake.fail('maws.asks.list');
    fake.event('engine.hostState', { state: 'ready', pid: 2, restarts: 1, revision: 3 });
    expect(fake.invoked('maws.asks.list')).toHaveLength(2);
    off();
  });

  it('a cancellation that lands while the first read is out keeps the ask, cancelled, with the snapshot’s questions', async () => {
    const fake = fakeClient();
    ensureLoaded(A, fake.client); // an empty store: a restored sheet after a reload
    applyAskEvents(A, [cancelled('a1')]);
    await fake.reply('maws.asks.list', { asks: [pending('a1'), pending('a2')] });
    expect([...state().asks.values()].map((ask) => [ask.askId, ask.state])).toEqual([['a1', 'cancelled'], ['a2', 'pending']]);
    expect(state().asks.get('a1')?.questions).toEqual(QUESTIONS);
    applyAskEvents(A, [answered('a2')]);
    expect(shown()).toMatchObject({ kind: 'live', ask: { askId: 'a1', state: 'cancelled' } });
  });

  it('an answer that lands while the first read is out keeps the ask out', async () => {
    const fake = fakeClient();
    ensureLoaded(A, fake.client);
    applyAskEvents(A, [answered('a1')]);
    await fake.reply('maws.asks.list', { asks: [pending('a1')] });
    expect(state().asks.size).toBe(0);
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

  it('Retry after a refusal holds to the same rule as Submit: a half-answered question refuses it', async () => {
    ready();
    const fake = fakeClient();
    const first = submitAsk(A, 'a1', fake.client, []);
    await fake.reply('maws.ask.answer', { outcome: 'write_failed' });
    await first;
    editDraft(A, 'a1', 'q1', (draft) => setOther(QUESTIONS[0]!, draft, '')); // Other chosen, nothing typed
    await submitAsk(A, 'a1', fake.client, []);
    expect(fake.invoked('maws.ask.answer')).toHaveLength(1);
    expect(state()).toMatchObject({ submitting: null, failed: { askId: 'a1', detail: null } });
  });

  it('one answer in flight at a time across the session’s asks', async () => {
    ready();
    const fake = fakeClient();
    const first = submitAsk(A, 'a1', fake.client, []);
    await submitAsk(A, 'a2', fake.client, []);
    expect(fake.invoked('maws.ask.answer')).toHaveLength(1);
    await fake.reply('maws.ask.answer', { outcome: 'delivered' });
    await first;
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

  // M4b (the architect's ruling 2): the sheet never switches the main view to the asking session
  describe('the shown-session rule', () => {
    const shownSession = () => sessionOfTab(activeTab(useLayout.getState().main));
    const show = async (id: typeof A) => {
      useLayout.setState({ main: mainShowing(id) });
      await Promise.resolve(); // the sheet opens once the layout write that showed the session is done
    };
    function connected() {
      const { tool, probe } = probeTool(ASK_SHEET_TOOL_ID, { multiInstance: false, pinnable: false });
      registerPanelTool(tool);
      const fake = fakeClient();
      const openSession = vi.spyOn(useLayout.getState(), 'openSession');
      return { probe, fake, openSession, off: connectAsks(fake.client) };
    }

    it('an ask from a session not shown opens nothing, and opens the sheet when that session is shown while it is pending', async () => {
      await show(B);
      const { probe, fake, openSession, off } = connected();
      fake.event('session.eventBatch', { appSessionId: A, events: [opened('a1')] });
      expect(probe.created).toEqual([]);
      expect(shownSession()).toBe(B);
      expect(panelOf(A)).toBeUndefined();
      expect(state().asks.get('a1')?.state).toBe('pending'); // the store follows it meanwhile
      await show(A); // the person goes to the session
      expect(probe.created.map((init) => [init.appSessionId, init.params])).toEqual([[A, { askId: 'a1' }]]);
      expect(panelOf(A)?.activeTabId).toBe(panelOf(A)?.tabs[0]?.id);
      await show(B);
      await show(A); // once opened, it is the sheet's: going back opens nothing more
      expect(probe.created).toHaveLength(1);
      expect(probe.opens).toEqual([]);
      expect(openSession).not.toHaveBeenCalled();
      off();
    });

    it('opens the last ask still pending among those that waited, and none once all were answered or cancelled', async () => {
      await show(B);
      const { probe, fake, openSession, off } = connected();
      fake.event('session.eventBatch', { appSessionId: A, events: [opened('a1')] });
      fake.event('session.eventBatch', { appSessionId: A, events: [opened('a2')] });
      fake.event('session.eventBatch', { appSessionId: A, events: [answered('a2')] }); // answered from another window
      await show(A);
      expect(probe.created.map((init) => init.params)).toEqual([{ askId: 'a1' }]);
      await show(B);
      fake.event('session.eventBatch', { appSessionId: A, events: [opened('a3'), opened('a4')] });
      fake.event('session.eventBatch', { appSessionId: A, events: [cancelled('a3'), answered('a4')] });
      await show(A);
      expect(probe.created).toHaveLength(1);
      expect(probe.opens).toEqual([]);
      expect(openSession).not.toHaveBeenCalled();
      off();
    });

    it('every ask a background batch opened waits: with the last resolved, the earlier one opens', async () => {
      await show(B);
      const { probe, fake, off } = connected();
      fake.event('session.eventBatch', { appSessionId: A, events: [opened('a1'), opened('a2')] });
      fake.event('session.eventBatch', { appSessionId: A, events: [cancelled('a2')] });
      await show(A);
      expect(probe.created.map((init) => init.params)).toEqual([{ askId: 'a1' }]);
      off();
    });

    // The Overview card's or the hover card's button: the person's own way to the session, through `openAsk`, whose
    // addTool opens the session before it writes its tab. The sheet lands on that one tab with the clicked ask, and the
    // asks that waited are the person's now: nothing re-targets the sheet afterwards.
    it('a waiting ask opened from a card goes to its session with one sheet tab, the clicked ask kept', async () => {
      await show(B);
      const { probe, fake, off } = connected();
      fake.event('session.eventBatch', { appSessionId: A, events: [opened('a1')] });
      fake.event('session.eventBatch', { appSessionId: A, events: [opened('a2')] });
      const row: AskRowData = { askId: 'a1', toolUseId: 'a1' as ToolUseId, title: 'Setup', context: null, blocking: true, questions: QUESTIONS, state: 'pending', answers: null, error: null };
      mawsTranscriptActionsOver(fake.client).openAsk(A, row);
      await Promise.resolve();
      await Promise.resolve();
      expect(shownSession()).toBe(A);
      expect(panelOf(A)?.tabs.map((t) => t.toolId)).toEqual([ASK_SHEET_TOOL_ID]);
      expect(probe.created.map((init) => init.params)).toEqual([{ askId: 'a1', historical: row }]);
      expect(probe.opens).toEqual([]); // never re-targeted to a2
      await show(B);
      await show(A);
      expect(probe.opens).toEqual([]);
      off();
    });

    it('a session shown just before the connection is disposed opens nothing', async () => {
      await show(B);
      const { probe, fake, off } = connected();
      fake.event('session.eventBatch', { appSessionId: A, events: [opened('a1')] });
      useLayout.setState({ main: mainShowing(A) }); // the deferred open is queued...
      off(); // ...and the connection goes before it runs
      await Promise.resolve();
      expect(probe.created).toEqual([]);
    });

    it('stops following the shown session once disconnected', async () => {
      await show(B);
      const { probe, fake, off } = connected();
      fake.event('session.eventBatch', { appSessionId: A, events: [opened('a1')] });
      off();
      await show(A);
      expect(probe.created).toEqual([]);
    });
  });
});

// The store is per session: another session's events never reach this one.
it('stores are per session', () => {
  applyAskEvents('app-b' as AppSessionId, [opened('b1')]);
  expect(state().asks.size).toBe(0);
  expect(askSheet('app-b' as AppSessionId).getState().asks.has('b1')).toBe(true);
});
