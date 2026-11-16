// UX wave U5b (docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md, M1; §A, §B, decisions 3 to 5):
// the card takes Review. A comment opened on a host of kind `review` with a quote joins the pass keyed by the session,
// ticked when the surface asked for main. The host's `inline` layout is mounted once where its chip and place line
// belong and draws the card through a portal into the row the surface names, without the list of the pass (the rows
// under the lines are that list), and nothing of it while the row is null. The send quotes each line in the comment's
// words; an unticked send of a Review pass closes the card and opens the thread in the Side pane.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Anchor } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import { commands as SIDE_COMMANDS, SIDE_QUESTION_CAP } from '@shared/ipc/schema/side';
import { record, status } from '../../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { at } from '../../../../../test/support/machine';
import { resetLaneAStore } from '../../stores/lane-a';
import { useNotices } from '../../stores/notices';
import { useSessions } from '../../stores/sessions';
import { resetPanelStores } from '../../test-support/panel';
import { preloadOf } from '../../test-support/preload-of';
import { resetShellStores } from '../../test-support/shell-stores';
import { fileLineAnchor, openCommentComposer, registerCommentComposer } from '../../tools/code/anchor/anchor';
import { openComment, registerSidePane } from '../register';
import { sidePaneOf, useSidePane } from '../store';
import { CommentCardHost, type CardFrame } from './CardHost';
import { closeCard, notePlace, passKey, resetPlaceNotes, setCommentText, useCommentCard } from './store';

const PARENT_ID = 'a1111111-1111-4111-8111-111111111111' as AppSessionId; // main is asked with the bare id
const PARENT = at(PARENT_ID);
const CHILD_ID = 'c5555555-5555-4555-8555-000000000001' as AppSessionId;
const HOST_ID = 'review-tab-1';
const KEY = passKey('review', PARENT, PARENT);
const FRAME: CardFrame = { scale: 1, offset: { x: 0, y: 0 }, key: 'review' };
const BUILT = [{ type: 'text', text: 'the built message' }];
const ROW_BOX = { width: 600, height: 400 };

const ADDED = fileLineAnchor('/work/berth/src/berth-csv.ts', 32);
const REMOVED: Anchor = { ...fileLineAnchor('/work/berth/src/berth-load.ts', 7), side: 'old' };

const clientSize = { width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')!, height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')! };
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => ROW_BOX.width });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => ROW_BOX.height });
});
afterAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientSize.width);
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientSize.height);
});

let fake: FakeClient;
let offComposer: () => void;
beforeEach(() => {
  resetShellStores();
  resetPanelStores();
  resetPlaceNotes();
  resetLaneAStore();
  useSidePane.setState({ panes: new Map() });
  useNotices.setState({ notices: [] });
  registerSidePane();
  ROW_BOX.width = 600;
  // the content, the send and the fork are held open until a test answers them
  fake = fakeClient({ 'session.queue.list': { entries: [], paused: false }, 'session.intent.get': null });
  window.maws = preloadOf(fake);
  offComposer = registerCommentComposer(openComment);
  const s = useSessions.getState();
  useSessions.setState({ records: new Map([[PARENT, record(PARENT, { title: { text: 'Berth import', source: 'user' } })]]), engine: new Map([[PARENT, status(PARENT, { process: 'ready' } as never)]]), recordsVersion: s.recordsVersion + 1 });
});
afterEach(() => {
  cleanup();
  offComposer();
  useCommentCard.setState({ open: null });
  resetPlaceNotes();
});

// Review as M5 will mount it: the host in the toolbar, and a row under a line of the diff that the surface hands it
function Review({ rowShown = true }: { rowShown?: boolean }) {
  const [row, setRow] = useState<HTMLElement | null>(null);
  return (
    <>
      <div data-testid="toolbar">
        <CommentCardHost hostId={HOST_ID} host="review" mode="panel" layout="inline" row={rowShown ? row : null} accepts={() => false} frame={FRAME} visible subject={PARENT} />
      </div>
      <div data-testid="diff">
        <div data-testid="row" ref={setRow} />
      </div>
    </>
  );
}

const comment = (anchor: Anchor, quote: string) => act(() => openCommentComposer(anchor, { appSessionId: PARENT, placement: { kind: 'card', host: 'review', hostId: HOST_ID }, destination: 'main', quote }));
const card = () => document.querySelector<HTMLElement>('[data-comment-card]');
const row = () => screen.getByTestId('row');
const toolbar = () => screen.getByTestId('toolbar');
const field = () => screen.getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement;
const type = (text: string) => fireEvent.change(field(), { target: { value: text } });
const sendButton = () => within(card()!).getByRole('button', { name: /^(Send|Sending…|Starting…)/ }) as HTMLButtonElement;
const box = () => screen.getByRole('checkbox', { name: 'Send to main' }) as HTMLInputElement;
const pass = () => useCommentCard.getState().passes.get(KEY) ?? null;
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

// two comments, the second on a removed line, each typed in the card
function twoComments() {
  render(<Review />);
  comment(ADDED, 'const total = rows.length;');
  type('Count the header too.');
  comment(REMOVED, 'if (row.berth) skip();');
  type('Why was this dropped?');
}

describe('a comment on a line opens on the review host', () => {
  it('joins the pass keyed by the session, with its quote, the checkbox ticked as the surface asked', () => {
    render(<Review />);
    comment(ADDED, 'const total = rows.length;');
    expect(pass()).toMatchObject({ host: 'review', subject: PARENT, appSessionId: PARENT, toMain: true });
    expect(pass()!.comments).toMatchObject([{ anchor: ADDED, quote: 'const total = rows.length;', text: '' }]);
    expect(box().checked).toBe(true);
  });

  it('is keyed by the session even before a host of its surface is mounted', () => {
    comment(ADDED, 'const total = rows.length;');
    expect(pass()?.comments).toHaveLength(1);
  });
});

describe('the inline layout', () => {
  it('draws the card inside the row it is given, at the card’s usual width, without the list of the pass, and with “Send N comments”', () => {
    twoComments();
    expect(row().contains(card())).toBe(true);
    expect(toolbar().contains(card())).toBe(false);
    expect(card()!.dataset.placement).toBe('inline');
    expect(card()!.style.width).toBe('300px');
    expect(card()!.querySelector('[data-pass-comments]')).toBeNull();
    expect(sendButton().textContent).toBe('Send 2 comments');
  });

  it('takes the row’s width where the row is narrower than the card', () => {
    ROW_BOX.width = 260;
    render(<Review />);
    comment(ADDED, 'const total = rows.length;');
    expect(card()!.style.width).toBe('260px');
  });

  it('draws no card while the row is null and keeps the comment in its pass', () => {
    render(<Review rowShown={false} />);
    comment(ADDED, 'const total = rows.length;');
    act(() => setCommentText(KEY, pass()!.comments[0]!.id, 'Count the header too.'));
    expect(card()).toBeNull();
    expect(useCommentCard.getState().open?.hostId).toBe(HOST_ID);
    expect(pass()!.comments.map((c) => c.text)).toEqual(['Count the header too.']);
  });

  it('draws the chip and the place line in its own place, with no card open', () => {
    render(<Review />);
    comment(ADDED, 'const total = rows.length;');
    type('Count the header too.');
    act(() => closeCard());
    const chip = toolbar().querySelector<HTMLElement>('[data-unsent-chip]');
    expect(chip?.textContent).toBe('1 unsent comment');
    expect(row().childElementCount).toBe(0);
    fireEvent.click(chip!);
    expect(row().contains(card())).toBe(true);
    expect(field().value).toBe('Count the header too.');
    act(() => closeCard());
    act(() => notePlace(KEY, { kind: 'sent', text: 'Sent to Berth import', at: Date.now() }));
    expect(toolbar().querySelector('[data-sent-note]')?.textContent).toBe('Sent to Berth import');
  });
});

describe('a pass of Review comments sent', () => {
  it('ticked: one message whose comments quote their lines, the removed one under “Before the change:”', async () => {
    twoComments();
    fireEvent.click(sendButton());
    expect(fake.invoked('side.comment.content')).toEqual([
      {
        comments: [
          { anchor: ADDED, text: '`const total = rows.length;`\nCount the header too.', screenshot: null },
          { anchor: REMOVED, text: 'Before the change:\n`if (row.berth) skip();`\nWhy was this dropped?', screenshot: null },
        ],
      },
    ]);
    await fake.reply('side.comment.content', { content: BUILT });
    await fake.reply('session.send', { messageUuid: null, disposition: 'sent', queueId: 'q0' });
    await settle();
    expect(fake.invoked('session.send')).toHaveLength(1);
    expect(pass()).toBeNull();
    expect(card()).toBeNull();
    expect(toolbar().querySelector('[data-sent-note]')?.textContent).toBe('Sent to Berth import');
  });

  it('unticked: one side thread takes the quoted words, the card closes and the thread opens in the Side pane', async () => {
    twoComments();
    fireEvent.click(box());
    fireEvent.click(sendButton());
    expect(fake.invoked('side.thread.open')).toEqual([
      {
        appSessionId: PARENT_ID,
        from: { kind: 'comment', anchor: ADDED, text: '`const total = rows.length;`\nCount the header too.', screenshot: null, more: [{ anchor: REMOVED, text: 'Before the change:\n`if (row.berth) skip();`\nWhy was this dropped?', screenshot: null }] },
      },
    ]);
    await act(() => fake.reply('side.thread.open', { status: 'starting', appSessionId: CHILD_ID }));
    await settle();
    expect(useCommentCard.getState().open).toBeNull();
    expect(card()).toBeNull();
    expect(pass()).toBeNull();
    expect(sidePaneOf(useSidePane.getState(), PARENT).view).toEqual({ kind: 'thread', childAppSessionId: at(CHILD_ID) });
  });
});

// The quote and the caption lengthen the words a send carries, and a comment's text is capped by the commands' schema
// (SIDE_QUESTION_CAP). A comment whose words alone fit is never refused for its quote: what does not fit is left out,
// the span first, then the caption, and the words go as typed.
describe('a Review comment near the cap on a comment’s text', () => {
  const near = (room: number) => 'w'.repeat(SIDE_QUESTION_CAP - room);
  const sent = (name: 'side.comment.content' | 'side.thread.open') => fake.invoked(name);
  const BEFORE_ROOM = 'Before the change:\n'.length;

  it('ticked: the quote is left out where it does not fit, and the input holds to the schema', () => {
    render(<Review />);
    comment(ADDED, 'const total = rows.length;');
    type(near(10));
    fireEvent.click(sendButton());
    const [input] = sent('side.comment.content') as { comments: { text: string }[] }[];
    expect(input?.comments.map((c) => c.text)).toEqual([near(10)]);
    expect(SIDE_COMMANDS['side.comment.content'].input.safeParse(input).success).toBe(true);
  });

  it('unticked: the caption stays where it fits without the span, and the input holds to the schema', () => {
    render(<Review />);
    comment(REMOVED, 'if (row.berth) skip();');
    type(near(BEFORE_ROOM));
    fireEvent.click(box());
    fireEvent.click(sendButton());
    const [input] = sent('side.thread.open') as { from: { text: string } }[];
    expect(input?.from.text).toBe(`Before the change:\n${near(BEFORE_ROOM)}`);
    expect(SIDE_COMMANDS['side.thread.open'].input.safeParse(input).success).toBe(true);
  });

  it('keeps the quote while it fits, to the last unit of the cap', () => {
    render(<Review />);
    comment(ADDED, 'x');
    const room = '`x`\n'.length;
    type(near(room));
    fireEvent.click(sendButton());
    const [input] = sent('side.comment.content') as { comments: { text: string }[] }[];
    expect(input?.comments[0]?.text).toBe(`\`x\`\n${near(room)}`);
    expect(input?.comments[0]?.text).toHaveLength(SIDE_QUESTION_CAP);
    expect(SIDE_COMMANDS['side.comment.content'].input.safeParse(input).success).toBe(true);
  });
});
