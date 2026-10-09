// E3 (the final fix wave): what the Side pane's actions hand C10 and the panel host. A thread whose setup waits on a
// card docks the first message main sends it, so the card's Cancel hands the comment (or the promotion) back to the
// editor; a summary row's Open obeys the panel rule; a promotion clips each exchange to the command's caps.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { anchoredMessage, promotionMessage } from '@shared/anchor/message';
import type { Anchor } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import { SIDE_ANSWER_CAP, SIDE_QUESTION_CAP } from '@shared/ipc/schema/side';
import type { SideExchange } from '@shared/side/question';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { registerMessageReturn } from '../sessions/message-return';
import { releaseMessage } from '../sessions/setup-actions';
import { useSetup } from '../sessions/store';
import { useNotices } from '../stores/notices';
import { A, B, panelOf, resetPanelStores } from '../test-support/panel';
import { resetSetupStore, trustState } from '../test-support/setup-intents';
import { openSideThread, promoteSide, sendComment, SIDE_TOOL_ID } from './actions';
import { registerSidePane } from './register';
import { promotable, resetSideQuestions, sidePaneOf, useSidePane } from './store';

const CHILD = 'c3333333-3333-4333-8333-333333333333' as AppSessionId;
const ANCHOR: Anchor = { kind: 'file-line', locator: '/r/src/x.ts#L42', label: 'x.ts:42', path: '/r/src/x.ts', line: 42 };
const SHOT = { path: '/u/s.png', width: 10, height: 10 };
const answered = (question: string, response: string, id = 'op-1'): SideExchange => ({ id, question, state: 'answered', response, synthetic: false, error: null, askedAt: '2026-10-06T10:00:00.000Z', answeredAt: '2026-10-06T10:00:01.000Z' });

let fake: FakeClient;
const needsTrust = () => fakeClient({ 'side.thread.open': { status: 'needs_trust', appSessionId: CHILD, trust: trustState() }, 'session.intent.get': null, 'session.intent.release': null });
const sideTab = (id: AppSessionId) => panelOf(id)?.tabs.find((t) => t.toolId === SIDE_TOOL_ID);

beforeEach(() => {
  resetPanelStores();
  resetSetupStore();
  resetSideQuestions();
  useSidePane.setState({ panes: new Map() });
  useNotices.setState({ notices: [] });
  registerSidePane();
});
afterEach(() => {
  delete (window as { maws?: unknown }).maws;
});

describe('a side thread whose setup waits on a card', () => {
  it('a comment’s card docks the anchored message main sends, and its Cancel hands it back to the editor', async () => {
    fake = needsTrust();
    window.maws = fake.client;
    const returned = vi.fn();
    const off = registerMessageReturn(returned);
    try {
      await expect(sendComment('thread', { parent: A, anchor: { ...ANCHOR, screenshot: SHOT }, text: ' Why twice? ', screenshot: SHOT })).resolves.toEqual({ ok: true, child: CHILD });
      // main's own display: the anchor without its screenshot field, the comment, the thread's preamble, the tag
      const display = anchoredMessage({ anchor: ANCHOR, text: ' Why twice? ', destination: 'thread', screenshot: true });
      const card = useSetup.getState().cards.get(CHILD)!;
      expect(card).toMatchObject({ kind: 'trust', message: { content: display, display } });
      await releaseMessage(CHILD, card.message);
      expect(returned).toHaveBeenCalledWith(CHILD, { content: display, display });
    } finally {
      off();
    }
  });

  it('a promotion’s card docks the promotion message', async () => {
    useSidePane.setState({ panes: new Map([[A, { view: { kind: 'btw' }, shownChild: null, inlineQuestions: false, exchanges: [answered('Word?', 'ZEBRA')] }]]) });
    fake = needsTrust();
    window.maws = fake.client;
    await expect(promoteSide(A, 'Now fix it.')).resolves.toEqual({ ok: true });
    const display = promotionMessage([{ question: 'Word?', response: 'ZEBRA' }], 'Now fix it.');
    expect(useSetup.getState().cards.get(CHILD)).toMatchObject({ kind: 'trust', message: { content: display, display } });
  });
});

describe('a promotion from a thread’s questions under its thread view', () => {
  it('opens the new thread in that thread’s own panel, inactive, and says where; the hosting pane keeps its thread', async () => {
    useSidePane.setState({ panes: new Map([[B, { view: null, shownChild: null, inlineQuestions: true, exchanges: [answered('Word?', 'ZEBRA')] }]]) });
    fake = fakeClient({ 'side.thread.open': { status: 'starting', appSessionId: CHILD }, 'session.intent.get': null });
    window.maws = fake.client;
    await expect(promoteSide(B, null)).resolves.toEqual({ ok: true });
    expect(sidePaneOf(useSidePane.getState(), B).view).toEqual({ kind: 'thread', childAppSessionId: CHILD });
    expect(panelOf(B)!.activeTabId).not.toBe(sideTab(B)!.id);
    expect(useNotices.getState().notices.map((n) => n.text)).toEqual([expect.stringMatching(/^Side thread opened in the panel of /)]);
  });
});

describe('a summary row’s Open', () => {
  it('on the shown session’s transcript, shows the thread in its pane, activated', () => {
    openSideThread(A, CHILD);
    expect(sidePaneOf(useSidePane.getState(), A).view).toEqual({ kind: 'thread', childAppSessionId: CHILD });
    expect(panelOf(A)!.activeTabId).toBe(sideTab(A)!.id);
    expect(useNotices.getState().notices).toEqual([]);
  });

  it('on a session that is not the shown one (a thread drawn in its parent’s pane), adds the pane inactive and says where', () => {
    openSideThread(B, CHILD);
    expect(sidePaneOf(useSidePane.getState(), B).view).toEqual({ kind: 'thread', childAppSessionId: CHILD });
    expect(panelOf(B)!.activeTabId).not.toBe(sideTab(B)!.id);
    expect(useNotices.getState().notices.map((n) => n.text)).toEqual([expect.stringMatching(/^Side thread is in the panel of /)]);
  });
});

describe('a promotion’s exchanges', () => {
  it('are clipped to the command’s caps with an ellipsis, so a long pasted question cannot refuse every promotion', () => {
    const question = 'q'.repeat(SIDE_QUESTION_CAP + 5);
    const response = 'r'.repeat(SIDE_ANSWER_CAP + 5);
    const [clipped] = promotable([answered(question, response)]);
    expect(clipped!.question).toHaveLength(SIDE_QUESTION_CAP);
    expect(clipped!.question.endsWith('q…')).toBe(true);
    expect(clipped!.response).toHaveLength(SIDE_ANSWER_CAP);
    expect(clipped!.response.endsWith('r…')).toBe(true);
    expect(promotable([answered('short', 'fine')])).toEqual([{ question: 'short', response: 'fine' }]);
  });

  it('never cut a surrogate pair in half', () => {
    const question = 'q'.repeat(SIDE_QUESTION_CAP - 2) + '😀' + 'tail';
    const [clipped] = promotable([answered(question, 'ok')]);
    expect(clipped!.question).toBe('q'.repeat(SIDE_QUESTION_CAP - 2) + '…');
  });
});

// P2-E1 (M1): the card's sends (P2-E1 document, D5): the same payloads as the sheet's; `reveal`, asked when the fork
// answers, says whether the new thread is revealed as E3 does (the default) or left to the card that sent it; the answer
// names the adopted thread, and Send to main's disposition.
describe('sendComment’s reveal and answer', () => {
  const starting = () => fakeClient({ 'side.thread.open': { status: 'starting', appSessionId: CHILD }, 'session.intent.get': null });

  it('by default reveals the new thread in the shown parent’s pane, as E3 does, and names it', async () => {
    fake = starting();
    window.maws = fake.client;
    await expect(sendComment('thread', { parent: A, anchor: ANCHOR, text: 'Why?', screenshot: null })).resolves.toEqual({ ok: true, child: CHILD });
    expect(sidePaneOf(useSidePane.getState(), A).view).toEqual({ kind: 'thread', childAppSessionId: CHILD });
    expect(panelOf(A)!.activeTabId).toBe(sideTab(A)!.id);
  });

  it('with reveal answering false, adds no Side tool and no toast, and asks only once the fork answered', async () => {
    fake = fakeClient({ 'session.intent.get': null });
    window.maws = fake.client;
    const reveal = vi.fn(() => false);
    const sent = sendComment('thread', { parent: B, anchor: ANCHOR, text: 'Why?', screenshot: null }, { reveal });
    expect(reveal).not.toHaveBeenCalled();
    await fake.reply('side.thread.open', { status: 'starting', appSessionId: CHILD });
    await expect(sent).resolves.toEqual({ ok: true, child: CHILD });
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(sideTab(A)).toBeUndefined();
    expect(sideTab(B)).toBeUndefined();
    expect(useNotices.getState().notices).toEqual([]);
  });

  it('Send to main answers its disposition', async () => {
    fake = fakeClient({ 'side.sendToMain': { messageUuid: null, disposition: 'steered' } });
    window.maws = fake.client;
    await expect(sendComment('main', { parent: A, anchor: ANCHOR, text: 'Now', screenshot: null })).resolves.toEqual({ ok: true, disposition: 'steered' });
  });
});
