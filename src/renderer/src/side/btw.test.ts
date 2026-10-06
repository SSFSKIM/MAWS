// E3 (M4): `/btw` (E3 execution document, Design §7, M4's proofs): the widget's typed apply answers false without a
// ready process (so the widget opens and says why) and true at once with one, having opened the question view and
// asked the host; the pane's side-question store draws a question pending at once, takes the host's entry for it on
// the listing after its receipt, settles it from `session.operation` (answered, synthetic, failed, late), and Clear,
// Retry and "Continue as a side thread" ask the host what they say.
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OperationEvent } from '@shared/engine/operations';
import type { AppSessionId } from '@shared/graph/ids';
import type { SideExchange } from '@shared/side/question';
import { record, status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { useNotices } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { A, B, panelOf, resetPanelStores } from '../test-support/panel';
import { promoteSide, SIDE_TOOL_ID } from './actions';
import { applyBtw } from './btw';
import { registerSidePane } from './register';
import { askSide, clearSide, onSideOperation, refreshSide, resetSideQuestions, retrySide, showSideChild, sidePaneOf, useSidePane } from './store';

let fake: FakeClient;

const exchanges = (parent: AppSessionId = A) => sidePaneOf(useSidePane.getState(), parent).exchanges;
const entry = (over: Partial<SideExchange>): SideExchange => ({ id: 'op-1', question: 'Q?', state: 'pending', response: null, synthetic: false, error: null, askedAt: '2026-10-06T10:00:00.000Z', answeredAt: null, ...over });
const completion = (opId: string, outcome: OperationEvent['outcome'], late = false): OperationEvent => ({ appSessionId: A, opId, command: 'session.sideQuestion', late, outcome });
const answered = (response: string | null, synthetic = false): OperationEvent['outcome'] => ({ ok: true, value: { response, synthetic } });

function withProcess(id: AppSessionId, process: 'ready' | 'exited') {
  const s = useSessions.getState();
  useSessions.setState({ records: new Map(s.records).set(id, record(id)), engine: new Map(s.engine).set(id, status(id, { process } as never)) });
}

beforeEach(() => {
  resetPanelStores();
  resetSideQuestions();
  useSidePane.setState({ panes: new Map() });
  useNotices.setState({ notices: [] });
  registerSidePane();
  fake = fakeClient();
  window.maws = fake.client;
});
afterEach(() => {
  delete (window as { maws?: unknown }).maws;
});

describe('the btw widget’s typed apply', () => {
  it('answers false without a ready process, asking nothing and opening nothing', async () => {
    withProcess(A, 'exited');
    await expect(applyBtw(A, 'why?')).resolves.toBe(false);
    expect(fake.invoked('session.sideQuestion')).toEqual([]);
    expect(sidePaneOf(useSidePane.getState(), A).view).toBeNull();
  });

  it('answers true at once with one: the question view opens on the shown session and the question is asked', async () => {
    withProcess(A, 'ready');
    let answer: boolean | undefined;
    await act(async () => void applyBtw(A, '  What word did I ask you to remember?  ').then((a) => (answer = a)));
    expect(answer).toBe(true); // before any receipt: the host has not answered `session.sideQuestion`
    expect(fake.pending('session.sideQuestion')).toBe(1);
    expect(fake.invoked('session.sideQuestion')).toEqual([{ appSessionId: A, question: 'What word did I ask you to remember?' }]);
    expect(sidePaneOf(useSidePane.getState(), A).view).toEqual({ kind: 'btw' });
    const side = panelOf(A)!.tabs.find((t) => t.toolId === SIDE_TOOL_ID)!;
    expect(panelOf(A)!.activeTabId).toBe(side.id);
    expect(exchanges()).toEqual([expect.objectContaining({ id: 'local:1', question: 'What word did I ask you to remember?', state: 'pending' })]);
  });

  it('asked from a session that is not the shown one and no pane draws: its panel takes it inactive, a toast says where', async () => {
    withProcess(B, 'ready');
    await act(async () => void applyBtw(B, 'why?'));
    const side = panelOf(B)!.tabs.find((t) => t.toolId === SIDE_TOOL_ID)!;
    expect(panelOf(B)!.activeTabId).not.toBe(side.id);
    expect(useNotices.getState().notices.map((n) => n.text)).toEqual([expect.stringMatching(/^Side question asked in the panel of /)]);
  });
});

// The architect's ruling (b): a side thread's own composer, drawn in its parent's pane, asks under the thread
describe('a `/btw` typed in a side thread drawn in its parent’s pane', () => {
  it('answers under the thread in that pane: no panel of its own, no toast, the main view kept', async () => {
    withProcess(B, 'ready');
    showSideChild(A, B);
    await act(async () => void applyBtw(B, 'why?'));
    expect(fake.invoked('session.sideQuestion')).toEqual([{ appSessionId: B, question: 'why?' }]);
    expect(sidePaneOf(useSidePane.getState(), B).inlineQuestions).toBe(true);
    expect(sidePaneOf(useSidePane.getState(), B).view).toBeNull();
    expect(panelOf(B)?.tabs.some((t) => t.toolId === SIDE_TOOL_ID) ?? false).toBe(false);
    expect(useNotices.getState().notices).toEqual([]);
    expect(sidePaneOf(useSidePane.getState(), B).exchanges).toEqual([expect.objectContaining({ question: 'why?', state: 'pending' })]);
  });
});

describe('the side-question store', () => {
  it('a question is pending at once; the listing after its receipt holds the host’s entry in its place', async () => {
    const asked = askSide(A, 'Q?');
    expect(exchanges()).toEqual([expect.objectContaining({ id: 'local:1', state: 'pending' })]);
    await fake.reply('session.sideQuestion', { opId: 'op-1' });
    expect(fake.invoked('side.question.list')).toEqual([{ appSessionId: A }]);
    await fake.reply('side.question.list', { exchanges: [entry({})] });
    await asked;
    expect(exchanges()).toEqual([entry({})]);
  });

  it('a completion answers the entry; a synthetic one is flagged; a failure fails it with the engine’s message', async () => {
    useSidePane.setState({ panes: new Map([[A, { view: null, shownChild: null, inlineQuestions: false, exchanges: [entry({ id: 'op-1' }), entry({ id: 'op-2', question: 'Q2?' }), entry({ id: 'op-3', question: 'Q3?' })] }]]) });
    onSideOperation(completion('op-1', answered('ZEBRA')));
    onSideOperation(completion('op-2', answered('I can only answer from the conversation.', true)));
    onSideOperation(completion('op-3', { ok: false, error: { code: 'engine_error', message: 'Side question cancelled', engineCode: null } }));
    expect(exchanges()!.map((e) => [e.id, e.state, e.response, e.synthetic, e.error])).toEqual([
      ['op-1', 'answered', 'ZEBRA', false, null],
      ['op-2', 'answered', 'I can only answer from the conversation.', true, null],
      ['op-3', 'failed', null, false, 'Side question cancelled'],
    ]);
    // a late success answers a timed-out entry; a late failure does not overwrite an answer
    onSideOperation(completion('op-3', answered('Late.'), true));
    onSideOperation(completion('op-1', { ok: false, error: { code: 'timeout', message: 'timed out', engineCode: null } }));
    expect(exchanges()!.map((e) => [e.id, e.state, e.response])).toEqual([
      ['op-1', 'answered', 'ZEBRA'],
      ['op-2', 'answered', 'I can only answer from the conversation.'],
      ['op-3', 'answered', 'Late.'],
    ]);
  });

  it('a completion for an entry not listed yet lists again; one for a session never listed, or another command, is ignored', async () => {
    onSideOperation(completion('op-9', answered('x')));
    expect(fake.invoked('side.question.list')).toEqual([]);
    useSidePane.setState({ panes: new Map([[A, { view: null, shownChild: null, inlineQuestions: false, exchanges: [] }]]) });
    onSideOperation({ ...completion('op-9', answered('x')), command: 'session.generateTitle' });
    expect(fake.invoked('side.question.list')).toEqual([]);
    onSideOperation(completion('op-9', answered('x')));
    expect(fake.invoked('side.question.list')).toEqual([{ appSessionId: A }]);
    await fake.reply('side.question.list', { exchanges: [entry({ id: 'op-9', state: 'answered', response: 'x' })] });
    expect(exchanges()).toEqual([entry({ id: 'op-9', state: 'answered', response: 'x' })]);
  });

  it('a question the host refused stays failed with the reason; Retry removes it and asks again', async () => {
    void askSide(A, 'Q?');
    await fake.fail('session.sideQuestion', 'Session app-a is not ready (exited)');
    expect(exchanges()).toEqual([expect.objectContaining({ id: 'local:1', state: 'failed', error: 'Session app-a is not ready (exited)' })]);
    void retrySide(A, exchanges()![0]);
    expect(exchanges()).toEqual([expect.objectContaining({ id: 'local:2', state: 'pending', question: 'Q?' })]);
    expect(fake.invoked('session.sideQuestion')).toHaveLength(2);
  });

  it('Retry on a host entry that failed asks again and draws the new question in its place', async () => {
    useSidePane.setState({ panes: new Map([[A, { view: null, shownChild: null, inlineQuestions: false, exchanges: [entry({ state: 'failed', error: 'boom' })] }]]) });
    const retry = retrySide(A, exchanges()![0]);
    expect(exchanges()!.map((e) => e.id)).toEqual(['local:1']); // the new question stands in for the failed one at once
    await fake.reply('session.sideQuestion', { opId: 'op-2' });
    await fake.reply('side.question.list', { exchanges: [entry({ state: 'failed', error: 'boom' }), entry({ id: 'op-2', askedAt: '2026-10-06T10:01:00.000Z' })] });
    await retry;
    expect(exchanges()!.map((e) => e.id)).toEqual(['op-2']);
  });

  it('an older listing answering after a newer one is dropped', async () => {
    const first = refreshSide(A);
    const second = refreshSide(A);
    await fake.reply('side.question.list', { exchanges: [entry({ id: 'old' })] });
    await fake.reply('side.question.list', { exchanges: [entry({ id: 'new' })] });
    await Promise.all([first, second]);
    expect(exchanges()!.map((e) => e.id)).toEqual(['new']);
  });

  it('Clear asks the host to clear, then lists again', async () => {
    const cleared = clearSide(A);
    await fake.reply('side.question.clear', {});
    await fake.reply('side.question.list', { exchanges: [] });
    await cleared;
    expect(fake.invoked('side.question.clear')).toEqual([{ appSessionId: A }]);
    expect(exchanges()).toEqual([]);
  });

  it('"Continue as a side thread" opens a thread from the answered exchanges and the text typed beside them, and the pane turns to it', async () => {
    const CHILD = 'b2222222-2222-4222-8222-222222222222' as AppSessionId;
    useSidePane.setState({
      panes: new Map([[A, { view: { kind: 'btw' }, shownChild: null, inlineQuestions: false, exchanges: [entry({ state: 'answered', response: 'ZEBRA', question: 'Word?' }), entry({ id: 'op-2', state: 'failed', error: 'x' }), entry({ id: 'op-3', state: 'pending' }), entry({ id: 'op-4', state: 'answered', response: null })] }]]),
    });
    fake = fakeClient({ 'side.thread.open': { status: 'starting', appSessionId: CHILD }, 'session.intent.get': null });
    window.maws = fake.client;
    await expect(promoteSide(A, 'Now fix it.')).resolves.toEqual({ ok: true });
    expect(fake.invoked('side.thread.open')).toEqual([{ appSessionId: A, from: { kind: 'btw', exchanges: [{ question: 'Word?', response: 'ZEBRA' }], text: 'Now fix it.' } }]);
    expect(sidePaneOf(useSidePane.getState(), A).view).toEqual({ kind: 'thread', childAppSessionId: CHILD });
  });
});
