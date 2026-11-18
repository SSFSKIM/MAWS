// E1 M4: the Question sheet's per-session store and its connection (E1 execution document, M4's decisions). Pending asks
// come from `maws.asks.list` (the host's table, G6) and from live `maws.ask.*` events, an event winning over a snapshot
// still on its way; drafts live in the store; Submit goes through `maws.ask.answer` and follows its three outcomes; a
// host back at `ready` is read again; a live `maws.ask.*` batch feeds the store and opens no sheet (UX wave U1b, M6).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import type { PendingAsk } from '@shared/maws/ask';
import { ASK_SHEET_TOOL_ID } from '@shared/maws/panes';
import type { AskQuestion } from '@shared/maws/tools';
import { fakeClient } from '../../../../../../test/support/fake-client';
import { OTHER_MACHINE } from '../../../../../../test/support/machine';
import { addressOf } from '@shared/machine/address';
import { record } from '../../../../../../test/support/builders';
import { registerPanelTool } from '../../../panel/host';
import { A, B, mainShowing, panelOf, probeTool, resetPanelStores } from '../../../test-support/panel';
import { useLayout } from '../../../stores/layout';
import { activeTab, sessionOfTab } from '../../../stores/layout-model';
import { useSessions } from '../../../stores/sessions';
import type { AskRowData } from '../../../transcript';
import { mawsTranscriptActionsOver } from '../actions';
import { connectAsks } from './connect';
import { surfaceTabs } from '../../../panel/surface-model';
import { EMPTY_DRAFT, pickOption, setDesignSystem, setOther, setText } from './draft';
import { applyAskEvents, askSheet, dismissAsk, editDraft, ensureLoaded, resetAskSheets, selectAsk, shownAsk, submitAsk } from './store';

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
const cancelled = (askId: string, reason: 'exit' | 'withdrawn' = 'exit') => ev('maws.ask.cancelled', { askId, toolUseId: askId as ToolUseId, reason });

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

  // The branch review: `engine.hostState` crosses machine links, and a machine's asks are its own host's table, so a
  // machine's host back at ready re-reads that machine's sessions only.
  it('a machine’s host back at ready re-reads only that machine’s sessions', async () => {
    const fake = fakeClient();
    const off = connectAsks(fake.client);
    const onB = addressOf(OTHER_MACHINE, 'b-session' as AppSessionId);
    ensureLoaded(A, fake.client);
    ensureLoaded(onB, fake.client);
    await fake.reply('maws.asks.list', { asks: [] });
    await fake.reply('maws.asks.list', { asks: [] });
    fake.event('engine.hostState', { state: 'ready', pid: 2, restarts: 1, revision: 3 }, OTHER_MACHINE);
    expect(fake.invoked('maws.asks.list').slice(2), 'B’s host: B’s session only').toEqual([{ appSessionId: onB }]);
    await fake.reply('maws.asks.list', { asks: [] });
    fake.event('engine.hostState', { state: 'ready', pid: 2, restarts: 1, revision: 4 });
    expect(fake.invoked('maws.asks.list').slice(3), 'this machine’s host: this machine’s session only').toEqual([{ appSessionId: A }]);
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
    applyAskEvents(A, [cancelled('a1', 'withdrawn')]);
    await fake.reply('maws.asks.list', { asks: [pending('a1'), pending('a2')] });
    expect([...state().asks.values()].map((ask) => [ask.askId, ask.state, ask.cancelReason])).toEqual([['a1', 'cancelled', 'withdrawn'], ['a2', 'pending', null]]);
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
    expect(shown()).toMatchObject({ kind: 'live', ask: { askId: 'a2', state: 'cancelled', cancelReason: 'exit' } });
  });

  it('cancelled keeps why: a withdrawn ask is marked withdrawn, an opened one has no reason', () => {
    applyAskEvents(A, [opened('a1')]);
    expect(state().asks.get('a1')).toMatchObject({ state: 'pending', cancelReason: null });
    applyAskEvents(A, [cancelled('a1', 'withdrawn')]);
    expect(state().asks.get('a1')).toMatchObject({ state: 'cancelled', cancelReason: 'withdrawn' });
  });

  it('returns the asks a batch opened that are still pending at its end', () => {
    expect(applyAskEvents(A, [opened('a1'), opened('a2'), answered('a1')])).toEqual(['a2']);
    expect(applyAskEvents(A, [ev('turn.ended', {} as never)])).toEqual([]);
  });
});

describe('selection', () => {
  const HISTORICAL: AskRowData = {
    askId: 'old', toolUseId: 'old' as ToolUseId, title: 'Before', context: null, blocking: true, questions: QUESTIONS, state: 'answered',
    answers: [{ id: 'q1', question: 'Which colour?', status: 'answered', value: ['Red'] }, { id: 'q2', question: 'What title?', status: 'skipped' }], error: null, cancelReason: null,
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
    expect(state().failed).toEqual({ askId: 'a1', detail: null, dismiss: false }); // U1a: a Submit's, retried as a Submit
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
    expect(state().failed).toEqual({ askId: 'a1', detail: 'engine host unavailable', dismiss: false });
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

// F's L176 (D's M6, the ledger's X28 host row): a design system deleted between the owner's pick and Submit is not sent
// by its id for the chain to skip silently; Submit reads each picked system first, and a gone one is unpicked and named.
describe('Submit re-validates a design_system pick', () => {
  const ACME = '0d9e8f7a-6b5c-4d3e-8f2a-1b0c9d8e7f6a';
  const PICKS: AskQuestion[] = [{ id: 's1', question: 'Which design system?', modality: 'design_system' }];
  const picked = () => {
    applyAskEvents(A, [opened('d1', { questions: PICKS })]);
    editDraft(A, 'd1', 's1', (draft) => setDesignSystem(draft, { id: ACME, name: 'Acme web' }));
  };

  it('sends a pick still live, after reading it', async () => {
    picked();
    const fake = fakeClient({ 'artifacts.get': { artifact: { id: ACME, kind: 'design_system', title: 'Acme web' } } });
    const done = submitAsk(A, 'd1', fake.client, []);
    await vi.waitFor(() => expect(fake.pending('maws.ask.answer')).toBe(1));
    expect(fake.invoked('artifacts.get')).toEqual([{ artifactId: ACME, prepare: false }]);
    expect(fake.invoked('maws.ask.answer')).toEqual([{ appSessionId: A, askId: 'd1', answers: [{ id: 's1', question: 'Which design system?', status: 'answered', designSystemId: ACME, name: 'Acme web' }] }]);
    await fake.reply('maws.ask.answer', { outcome: 'delivered' });
    await done;
    expect(state().asks.has('d1')).toBe(false);
  });

  it('sends nothing for a system deleted since the pick: the pick is cleared and the notice names it', async () => {
    picked();
    const fake = fakeClient({ 'artifacts.get': { artifact: null } });
    await submitAsk(A, 'd1', fake.client, []);
    expect(fake.invoked('maws.ask.answer')).toEqual([]);
    expect(state()).toMatchObject({ submitting: null, failed: null, notice: 'Acme web was deleted. Choose another design system.' });
    expect(state().drafts.get('d1')?.get('s1')?.designSystem).toBeNull();
    expect(state().asks.get('d1')?.state).toBe('pending');
  });

  it('a check that cannot be read fails the Submit with its message, the pick kept for Retry', async () => {
    picked();
    const fake = fakeClient();
    const done = submitAsk(A, 'd1', fake.client, []);
    await fake.fail('artifacts.get', 'engine host unavailable');
    await done;
    expect(fake.invoked('maws.ask.answer')).toEqual([]);
    expect(state()).toMatchObject({ submitting: null, failed: { askId: 'd1', detail: 'engine host unavailable' } });
    expect(state().drafts.get('d1')?.get('s1')?.designSystem).toEqual({ id: ACME, name: 'Acme web' });
  });
});

// UX wave U1b (M6; O-17): the sheet opens only when the person opens it ("Open beside", "View answers", a card's
// button, the tool's icon). An ask that arrives feeds the store and opens, activates and closes nothing, in the session
// on screen or in one the person comes to later; the tab that was in view stays in view.
describe('connectAsks', () => {
  const review = { id: 'review:aaaa0001', toolId: 'review', pinned: false };
  const files = { id: 'files:aaaa0002', toolId: 'files', pinned: false };
  const inView = () => surfaceTabs(useLayout.getState(), A).map((tab) => tab.toolId);
  const tabsOf = () => panelOf(A)?.tabs.map((tab) => tab.toolId);
  const shownSession = () => sessionOfTab(activeTab(useLayout.getState().main));
  const show = async (id: typeof A) => {
    useLayout.setState({ main: mainShowing(id) });
    await Promise.resolve();
    await Promise.resolve();
  };
  // A's side column with the file tab in view, the sheet registered, the connection made.
  function connected() {
    const { tool, probe } = probeTool(ASK_SHEET_TOOL_ID, { multiInstance: false, pinnable: false });
    registerPanelTool(tool);
    useLayout.setState({
      panelBySession: new Map([[A, { tabs: [review, files], activeTabId: files.id }]]),
      panelSurfaces: { version: 2, stacks: { [A]: [files.id] }, pinnedTools: [], contexts: {} },
    });
    const fake = fakeClient();
    return { probe, fake, off: connectAsks(fake.client) };
  }
  const row = (askId: string, over: Partial<AskRowData> = {}): AskRowData => ({ askId, toolUseId: askId as ToolUseId, title: 'Setup', context: null, blocking: true, questions: QUESTIONS, state: 'pending', answers: null, error: null, cancelReason: null, ...over });

  it('an ask opened in the session on screen with a file tab in view leaves that tab in view and adds no sheet tab', async () => {
    const { probe, fake, off } = connected();
    const before = useLayout.getState();
    fake.event('session.eventBatch', { appSessionId: A, events: [opened('a1')] });
    fake.event('session.eventBatch', { appSessionId: A, events: [opened('a2')] });
    await Promise.resolve();
    expect([...state().asks.keys()]).toEqual(['a1', 'a2']); // the store follows them
    expect(probe.created).toEqual([]);
    expect(probe.opens).toEqual([]);
    expect(inView()).toEqual(['files']);
    expect(tabsOf()).toEqual(['review', 'files']);
    expect(panelOf(A)?.activeTabId).toBe(files.id);
    expect(useLayout.getState().regions).toEqual(before.regions);
    expect(useLayout.getState().main).toBe(before.main);
    off();
  });

  it('an ask opened in a session not shown opens nothing when the person arrives', async () => {
    await show(B);
    const { probe, fake, off } = connected();
    fake.event('session.eventBatch', { appSessionId: A, events: [opened('a1')] });
    expect(state().asks.get('a1')?.state).toBe('pending');
    await show(A); // the person goes to the session, the ask still pending
    expect(shownSession()).toBe(A);
    expect(probe.created).toEqual([]);
    expect(probe.opens).toEqual([]);
    expect(inView()).toEqual(['files']);
    expect(tabsOf()).toEqual(['review', 'files']);
    await show(B);
    await show(A);
    expect(probe.created).toEqual([]);
    off();
  });

  it('a submitted ask closes no tab', async () => {
    const { fake, off } = connected();
    mawsTranscriptActionsOver(fake.client).openAsk(A, row('history', { state: 'answered', answers: [] })); // View answers
    const sheet = panelOf(A)!.tabs.find((tab) => tab.toolId === ASK_SHEET_TOOL_ID)!;
    useLayout.getState().showSurfaceTab(A, files.id); // the person goes back to the file
    fake.event('session.eventBatch', { appSessionId: A, events: [opened('a1')] });
    expect(inView()).toEqual(['files']);
    useLayout.getState().showSurfaceTab(A, sheet.id); // and opens the sheet's tab themselves
    const done = submitAsk(A, 'a1', fake.client, []);
    await fake.reply('maws.ask.answer', { outcome: 'delivered' });
    await done;
    await Promise.resolve();
    expect(state().asks.size).toBe(0);
    expect(inView()).toEqual([ASK_SHEET_TOOL_ID]);
    expect(tabsOf()).toEqual(['review', 'files', ASK_SHEET_TOOL_ID]);
    // an ask submitted from its row, with the file in view, leaves it in view
    useLayout.getState().showSurfaceTab(A, files.id);
    fake.event('session.eventBatch', { appSessionId: A, events: [opened('a2')] });
    const second = submitAsk(A, 'a2', fake.client, []);
    await fake.reply('maws.ask.answer', { outcome: 'delivered' });
    await second;
    await Promise.resolve();
    expect(inView()).toEqual(['files']);
    expect(tabsOf()).toEqual(['review', 'files', ASK_SHEET_TOOL_ID]);
    off();
  });

  it('a new ask leaves a folded side column folded, and its answer leaves the sheet’s tab as it was', async () => {
    const { fake, off } = connected();
    mawsTranscriptActionsOver(fake.client).openAsk(A, row('history', { state: 'answered', answers: [] }));
    const retained = surfaceTabs(useLayout.getState(), A).map((tab) => tab.id);
    useLayout.getState().setPanel({ collapsed: true }); // narrow-sheet Escape keeps the saved stack
    fake.event('session.eventBatch', { appSessionId: A, events: [opened('a1')] });
    expect(useLayout.getState().regions.panel.collapsed).toBe(true);
    fake.event('session.eventBatch', { appSessionId: A, events: [answered('a1')] });
    await Promise.resolve();
    expect(useLayout.getState().regions.panel.collapsed).toBe(true);
    expect(surfaceTabs(useLayout.getState(), A).map((tab) => tab.id)).toEqual(retained);
    off();
  });

  it('feeds the store from every live batch, for a session this window knows or not', () => {
    const { probe, fake, off } = connected();
    useSessions.setState({ records: new Map() });
    fake.event('session.eventBatch', { appSessionId: A, events: [opened('a1')] }); // A unknown here
    useSessions.setState({ records: new Map([[A, record(A)]]) });
    fake.event('session.eventBatch', { appSessionId: A, events: [opened('a2'), answered('a2')] });
    expect([...state().asks.keys()]).toEqual(['a1']);
    expect(probe.created).toEqual([]);
    off();
    fake.event('session.eventBatch', { appSessionId: A, events: [opened('a3')] }); // disconnected: no longer followed
    expect([...state().asks.keys()]).toEqual(['a1']);
  });

  // The Overview card's or the hover card's button: the person's own way to the session, through `openAsk`, whose
  // addTool writes its tab and then opens the session. The sheet lands on that one tab with the clicked ask.
  it('an ask opened from a card goes to its session with one sheet tab, the clicked ask kept', async () => {
    await show(B);
    const { probe, fake, off } = connected();
    fake.event('session.eventBatch', { appSessionId: A, events: [opened('a1')] });
    fake.event('session.eventBatch', { appSessionId: A, events: [opened('a2')] });
    mawsTranscriptActionsOver(fake.client).openAsk(A, row('a1'));
    await Promise.resolve();
    await Promise.resolve();
    expect(shownSession()).toBe(A);
    expect(tabsOf()).toEqual(['review', 'files', ASK_SHEET_TOOL_ID]);
    expect(probe.created.map((init) => init.params)).toEqual([{ askId: 'a1', historical: row('a1') }]);
    await show(B);
    await show(A);
    expect(probe.opens).toEqual([]); // never re-targeted to a2
    off();
  });

  it('keeps a Questions sheet the person opened after its cancellation notice is dismissed', async () => {
    const { fake, off } = connected();
    fake.event('session.eventBatch', { appSessionId: A, events: [opened('a1')] });
    mawsTranscriptActionsOver(fake.client).openAsk(A, row('a1'));
    fake.event('session.eventBatch', { appSessionId: A, events: [cancelled('a1')] });
    dismissAsk(A, 'a1');
    await Promise.resolve();
    expect(state().asks.size).toBe(0);
    expect(inView()).toEqual([ASK_SHEET_TOOL_ID]);
    off();
  });
});

// The store is per session: another session's events never reach this one.
it('stores are per session', () => {
  applyAskEvents('app-b' as AppSessionId, [opened('b1')]);
  expect(state().asks.size).toBe(0);
  expect(askSheet('app-b' as AppSessionId).getState().asks.has('b1')).toBe(true);
});
