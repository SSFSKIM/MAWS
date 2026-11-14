// E3 (the final fix wave): what the Side pane's actions hand C10 and the panel host. A thread whose setup waits on a
// card docks the first message main sends it, so the card's Cancel hands the comment (or the promotion) back to the
// editor; a summary row's Open obeys the panel rule; a promotion clips each exchange to the command's caps.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { anchoredMessage, commentsMessage, promotionMessage } from '@shared/anchor/message';
import type { Anchor } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { SIDE_ANSWER_CAP, SIDE_QUESTION_CAP } from '@shared/ipc/schema/side';
import type { SideExchange } from '@shared/side/question';
import { addressOf } from '@shared/machine/address';
import { record, remoteRow, status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { at, OTHER_MACHINE } from '../../../../test/support/machine';
import { laneAState } from '../lane-a/test-support/lane-a-state';
import { applyLaneAState, resetLaneAStore, useLaneA } from '../stores/lane-a';
import { resetQueueStore } from '../stores/queue';
import { useSessions } from '../stores/sessions';
import { registerMessageReturn } from '../sessions/message-return';
import { releaseMessage } from '../sessions/setup-actions';
import { useSetup } from '../sessions/store';
import { useNotices } from '../stores/notices';
import { A, B, panelOf, resetPanelStores } from '../test-support/panel';
import { resetSetupStore, trustState } from '../test-support/setup-intents';
import { openSideThread, promoteSide, REMOTE_TERMINAL_TEXT_MAX, sendComments, SIDE_TOOL_ID, type CommentInput } from './actions';
import { registerSidePane } from './register';
import { promotable, resetSideQuestions, sidePaneOf, useSidePane } from './store';

// P5 O6 M2: main answers the bare id; the page holds its address
const CHILD_ID = 'c3333333-3333-4333-8333-333333333333' as AppSessionId;
const CHILD = at(CHILD_ID);
const ANCHOR: Anchor = { kind: 'file-line', locator: '/r/src/x.ts#L42', label: 'x.ts:42', path: '/r/src/x.ts', line: 42 };
const SHOT = { path: '/u/s.png', width: 10, height: 10 };
const answered = (question: string, response: string, id = 'op-1'): SideExchange => ({ id, question, state: 'answered', response, synthetic: false, error: null, askedAt: '2026-10-06T10:00:00.000Z', answeredAt: '2026-10-06T10:00:01.000Z' });

let fake: FakeClient;
const needsTrust = () => fakeClient({ 'side.thread.open': { status: 'needs_trust', appSessionId: CHILD_ID, trust: trustState() }, 'session.intent.get': null, 'session.intent.release': null });
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
    window.maws = fake.client as unknown as PreloadBridge;
    const returned = vi.fn();
    const off = registerMessageReturn(returned);
    try {
      await expect(sendComments(A, [{ anchor: { ...ANCHOR, screenshot: SHOT }, text: ' Why twice? ', screenshot: SHOT }], false)).resolves.toEqual({ ok: true, to: 'thread', child: CHILD });
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
    window.maws = fake.client as unknown as PreloadBridge;
    await expect(promoteSide(A, 'Now fix it.')).resolves.toEqual({ ok: true });
    const display = promotionMessage([{ question: 'Word?', response: 'ZEBRA' }], 'Now fix it.');
    expect(useSetup.getState().cards.get(CHILD)).toMatchObject({ kind: 'trust', message: { content: display, display } });
  });
});

describe('a promotion from a thread’s questions under its thread view', () => {
  it('opens the new thread in that thread’s own panel, inactive, and says where; the hosting pane keeps its thread', async () => {
    useSidePane.setState({ panes: new Map([[B, { view: null, shownChild: null, inlineQuestions: true, exchanges: [answered('Word?', 'ZEBRA')] }]]) });
    fake = fakeClient({ 'side.thread.open': { status: 'starting', appSessionId: CHILD_ID }, 'session.intent.get': null });
    window.maws = fake.client as unknown as PreloadBridge;
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
// answers, says whether the new thread is revealed as E3 does (the default) or left to the card that sent it. UX wave
// U5a: `sendComments` is the one send of a comment, of one or several; unchecked it is the side thread as before.
describe('sendComments, unchecked: the side thread', () => {
  const starting = () => fakeClient({ 'side.thread.open': { status: 'starting', appSessionId: CHILD_ID }, 'session.intent.get': null });

  it('by default reveals the new thread in the shown parent’s pane, as E3 does, and names it', async () => {
    fake = starting();
    window.maws = fake.client as unknown as PreloadBridge;
    await expect(sendComments(A, [{ anchor: ANCHOR, text: 'Why?', screenshot: null }], false)).resolves.toEqual({ ok: true, to: 'thread', child: CHILD });
    expect(fake.invoked('side.thread.open')).toEqual([{ appSessionId: 'app-a', from: { kind: 'comment', anchor: ANCHOR, text: 'Why?', screenshot: null } }]); // one comment: today's input, no `more`
    expect(sidePaneOf(useSidePane.getState(), A).view).toEqual({ kind: 'thread', childAppSessionId: CHILD });
    expect(panelOf(A)!.activeTabId).toBe(sideTab(A)!.id);
  });

  it('with reveal answering false, adds no Side tool and no toast, and asks only once the fork answered', async () => {
    fake = fakeClient({ 'session.intent.get': null });
    window.maws = fake.client as unknown as PreloadBridge;
    const reveal = vi.fn(() => false);
    const sent = sendComments(B, [{ anchor: ANCHOR, text: 'Why?', screenshot: null }], false, { reveal });
    expect(reveal).not.toHaveBeenCalled();
    await fake.reply('side.thread.open', { status: 'starting', appSessionId: CHILD_ID });
    await expect(sent).resolves.toEqual({ ok: true, to: 'thread', child: CHILD });
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(sideTab(A)).toBeUndefined();
    expect(sideTab(B)).toBeUndefined();
    expect(useNotices.getState().notices).toEqual([]);
  });

  it('carries the later comments in `more` and docks the message of all of them; a refusal is the command’s words', async () => {
    fake = needsTrust();
    window.maws = fake.client as unknown as PreloadBridge;
    const second: Anchor = { ...ANCHOR, locator: '/r/src/x.ts#L50', label: 'x.ts:50', line: 50 };
    await expect(sendComments(A, [{ anchor: ANCHOR, text: 'Why?', screenshot: SHOT }, { anchor: second, text: 'And here', screenshot: null }], false)).resolves.toEqual({ ok: true, to: 'thread', child: CHILD });
    expect(fake.invoked('side.thread.open')).toEqual([{ appSessionId: 'app-a', from: { kind: 'comment', anchor: ANCHOR, text: 'Why?', screenshot: SHOT, more: [{ anchor: second, text: 'And here', screenshot: null }] } }]);
    const display = commentsMessage([{ anchor: ANCHOR, text: 'Why?', screenshot: true }, { anchor: second, text: 'And here', screenshot: false }], 'thread');
    expect(useSetup.getState().cards.get(CHILD)).toMatchObject({ message: { content: display, display } });

    fake = fakeClient();
    const refused = sendComments(A, [{ anchor: ANCHOR, text: 'Why?', screenshot: null }], false, {}, fake.client);
    await fake.fail('side.thread.open', 'The session is gone');
    await expect(refused).resolves.toEqual({ ok: false, error: 'The session is gone' });
  });
});

// UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, §D; decisions 2, 8, 9, 10): ticked, the
// comments' content is main's (`side.comment.content`) and goes through the session's port as a typed message does, on
// each of the three routes; `side.sendToMain` is never asked.
describe('sendComments, ticked: the session’s own conversation', () => {
  const MAIN = at('a1111111-1111-4111-8111-111111111111' as AppSessionId);
  const TEXT = { type: 'text', text: 'the message' } as const;
  const IMAGE = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } } as const;
  const shot = (n: number) => ({ path: `/user-data/browser/crops/${n}.png`, width: 10, height: 10 });
  const comment = (n: number, screenshot: ReturnType<typeof shot> | null = shot(n)): CommentInput => ({ anchor: { ...ANCHOR, locator: `#c${n}`, label: `c${n}`, screenshot: screenshot ?? undefined }, text: `Comment ${n}`, screenshot });
  // what main is asked for: the anchor without its screenshot field, the screenshot as its own
  const asked = (n: number, screenshot: ReturnType<typeof shot> | null) => ({ anchor: { ...ANCHOR, locator: `#c${n}`, label: `c${n}` }, text: `Comment ${n}`, screenshot });

  beforeEach(() => {
    resetQueueStore();
    resetLaneAStore();
    useSessions.setState({ records: new Map(), engine: new Map(), digests: new Map(), listed: new Map() });
  });

  function laneB(turn = false, given: Parameters<typeof fakeClient>[0] = {}) {
    const engine = status(MAIN, { process: 'ready', ...(turn && { turn: { id: 'e1', origin: 'human', startedAt: 'x', acceptedAt: 'x', userMessageUuids: [] } }) } as never);
    useSessions.setState({ records: new Map([[MAIN, record(MAIN)]]), engine: new Map([[MAIN, engine]]) });
    return fakeClient({ 'side.comment.content': { content: [IMAGE, TEXT] }, 'session.queue.list': { entries: [], paused: false }, 'session.send': { messageUuid: null, disposition: 'sent', queueId: 'q0' }, 'session.steer': { messageUuid: '11111111-1111-4111-8111-111111111111' }, ...given });
  }
  const terminal = (given: Parameters<typeof fakeClient>[0] = {}) => {
    useSessions.setState({ records: new Map([[MAIN, record(MAIN, { holder: { kind: 'terminal', pid: 42 } })]]) });
    applyLaneAState(MAIN, laneAState(MAIN));
    return fakeClient({ 'side.comment.content': { content: [TEXT] }, ...given });
  };

  it('a session MAWS runs: main builds the content, the port sends it as a comment; never side.sendToMain', async () => {
    const fake = laneB();
    await expect(sendComments(MAIN, [comment(1)], true, {}, fake.client)).resolves.toEqual({ ok: true, to: 'main', disposition: 'sent' });
    expect(fake.invoked('side.comment.content')).toEqual([{ comments: [asked(1, shot(1))] }]);
    expect(fake.invoked('session.send')).toEqual([{ appSessionId: MAIN, content: [IMAGE, TEXT] }]); // the client given, not the page's: the address
    expect(fake.invoked('side.sendToMain')).toEqual([]);
    expect(fake.calls.indexOf('invoke side.comment.content')).toBeLessThan(fake.calls.indexOf('invoke session.send'));
  });

  it('during a turn is a steer, and an app queue that holds it is queued', async () => {
    await expect(sendComments(MAIN, [comment(1)], true, {}, laneB(true).client)).resolves.toEqual({ ok: true, to: 'main', disposition: 'steered' });
    const queued = laneB(false, { 'session.send': { messageUuid: null, disposition: 'queued', queueId: 'q1' } });
    await expect(sendComments(MAIN, [comment(1)], true, {}, queued.client)).resolves.toEqual({ ok: true, to: 'main', disposition: 'queued' });
  });

  it('a refusal is the port’s words, a thrown host error its message, a refused content main’s', async () => {
    useSessions.setState({ records: new Map([[MAIN, record(MAIN, { holder: { kind: 'terminal', pid: 42 } })]]) }); // no bridge: no port
    const none = fakeClient({ 'side.comment.content': { content: [TEXT] } });
    await expect(sendComments(MAIN, [comment(1)], true, {}, none.client)).resolves.toEqual({ ok: false, error: 'Held by terminal · 42' });

    laneB();
    const failing = fakeClient({ 'side.comment.content': { content: [TEXT] }, 'session.queue.list': { entries: [], paused: false } }); // session.send answers when told
    const sent = sendComments(MAIN, [comment(1)], true, {}, failing.client);
    await vi.waitFor(() => expect(failing.pending('session.send')).toBe(1));
    await failing.fail('session.send', 'The engine host is not answering');
    await expect(sent).resolves.toEqual({ ok: false, error: 'The engine host is not answering' });

    const shotRefused = fakeClient();
    const read = sendComments(MAIN, [comment(1)], true, {}, shotRefused.client);
    await shotRefused.fail('side.comment.content', 'comments.0.screenshot: not found', 'invalid_input');
    await expect(read).resolves.toEqual({ ok: false, error: 'comments.0.screenshot: not found' });
  });

  it('a terminal session on this Mac takes the first four screenshots, the later comments going without theirs', async () => {
    const fake = terminal({ 'laneA.send': { key: { writer: 'maws/m', seq: 1 }, state: 'entered', uuid: 'row-1' } });
    await expect(sendComments(MAIN, [1, 2, 3, 4, 5].map((n) => comment(n)), true, {}, fake.client)).resolves.toEqual({ ok: true, to: 'main', disposition: 'sent' });
    expect(fake.invoked('side.comment.content')).toEqual([{ comments: [asked(1, shot(1)), asked(2, shot(2)), asked(3, shot(3)), asked(4, shot(4)), asked(5, null)] }]);
  });

  it('an unconfirmed hand-off names its pending send; one with no key is a refusal', async () => {
    const key = { writer: 'maws/m', seq: 7 };
    const later = terminal({ 'laneA.send': { key, state: 'submitted' } });
    await expect(sendComments(MAIN, [comment(1, null)], true, {}, later.client)).resolves.toEqual({ ok: true, to: 'main', disposition: 'unconfirmed', pending: key });
    expect(useLaneA.getState().pendingSends.get(MAIN)).toEqual([{ key, text: 'the message', state: 'sending', reason: null }]);
    const lost = terminal({ 'laneA.send': { key: null, state: 'submitted' } });
    await expect(sendComments(MAIN, [comment(1, null)], true, {}, lost.client)).resolves.toEqual({ ok: false, error: 'The session did not confirm the message' });
  });

  describe('a terminal session on another machine', () => {
    const REMOTE = addressOf(OTHER_MACHINE, 'eng-r' as AppSessionId);
    const LINK = { state: 'up' as const, refusal: null, carrier: 'direct' as const, member: 'm', clientClass: 'native-mac', rights: [] as string[], reason: null };
    function remote(text: string) {
      useSessions.setState({ listed: new Map([[REMOTE, { ...remoteRow(OTHER_MACHINE, 'eng-r', { lane: 'A', availability: 'foreign_held' }), appId: REMOTE }]]) });
      applyLaneAState(REMOTE, laneAState(REMOTE, { link: LINK, acts: [] }));
      return fakeClient({ 'side.comment.content': { content: [{ type: 'text', text }] }, 'laneA.send': { key: { writer: 'remote/m', seq: 1 }, state: 'entered' } });
    }

    it('takes no screenshot, and its words go', async () => {
      const fake = remote('x'.repeat(REMOTE_TERMINAL_TEXT_MAX));
      await expect(sendComments(REMOTE, [comment(1), comment(2)], true, {}, fake.client)).resolves.toMatchObject({ ok: true, to: 'main' });
      expect(fake.invoked('side.comment.content')).toEqual([{ comments: [asked(1, null), asked(2, null)] }]);
      expect(fake.invoked('laneA.send')).toHaveLength(1);
    });

    it('refuses a text past 65,536 UTF-16 units in its own words before anything is sent', async () => {
      const fake = remote('x'.repeat(REMOTE_TERMINAL_TEXT_MAX + 1));
      await expect(sendComments(REMOTE, [comment(1)], true, {}, fake.client)).resolves.toEqual({ ok: false, error: 'Too long for a terminal session on another machine: send fewer comments at a time' });
      expect(fake.invoked('laneA.send')).toEqual([]);
    });

    it('the window’s bound is the endpoint’s `SEND_TEXT_MAX`', () => {
      const link = readFileSync(resolve(process.cwd(), 'src/endpoint/rl10/link.ts'), 'utf8'); // the suite runs from the repository's root
      const bound = /^const SEND_TEXT_MAX = ([\d_]+);$/m.exec(link)?.[1];
      expect(bound, 'src/endpoint/rl10/link.ts declares SEND_TEXT_MAX').toBeDefined();
      expect(REMOTE_TERMINAL_TEXT_MAX).toBe(Number(bound!.replaceAll('_', '')));
    });
  });
});
