// UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, M3; §C, §D, decisions 4, 5, 18 and 23):
// the pass in the card and its host. Escape keeps the card and its text, an empty card goes when the keyboard leaves it,
// Close discards that comment; a host that unmounts, and a second comment, keep what was typed. On a `many` host a second
// comment joins the first: the card lists the others, Send reads "Send N comments" and one send carries them all. A pass
// with comments and no card is a chip. §D's table row by row, each with the awaited promise held open.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Anchor, AnchorScreenshot } from '@shared/anchor/anchor';
import { artifactUrl } from '@shared/artifacts/scheme';
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { MESSAGE_COMMENTS_MAX } from '@shared/anchor/message'; // Decision Log 52
import { THREAD_FROM_ONE_COMMENT } from '@shared/side/copy'; // Decision Log 52
import { record, status } from '../../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { at } from '../../../../../test/support/machine';
import { useNotices } from '../../stores/notices';
import { useSessions } from '../../stores/sessions';
import { resetLaneAStore } from '../../stores/lane-a';
import { resetShellStores } from '../../test-support/shell-stores';
import { openCommentComposer, registerCommentComposer, type CommentPlacement } from '../../tools/code/anchor/anchor';
import { openComment } from '../register';
import { CommentCardHost, type CardFrame } from './CardHost';
import { dropSubject, handCardTo, passKey, resetPlaceNotes, useCommentCard } from './store';

const PARENT_ID = 'a1111111-1111-4111-8111-111111111111' as AppSessionId; // main is asked with the bare id
const PARENT = at(PARENT_ID);
const RECORD = '00000000-0000-4000-8000-000000000001';
const page = (n: number): Anchor => ({ kind: 'artifact-element', locator: `#e${n}`, label: `Dashboard v1 › h${n}`, pageUrl: artifactUrl(RECORD, 1, 'index.html') });
const SHOT: AnchorScreenshot = { path: '/tmp/crop-1.png', width: 40, height: 20 };
const FRAME: CardFrame = { scale: 1, offset: { x: 0, y: 0 }, key: 'k1' };
const KEY = passKey('artifact-page', RECORD, PARENT);
const BUILT = [{ type: 'text', text: 'the built message' }];
const HOST_BOX = { width: 600, height: 800 };

const clientSize = { width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')!, height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')! };
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => HOST_BOX.width });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => HOST_BOX.height });
});
afterAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientSize.width);
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientSize.height);
});

let fake: FakeClient;
let offComposer: () => void;
let focusedBack = 0;
beforeEach(() => {
  resetShellStores();
  resetPlaceNotes();
  resetLaneAStore();
  useNotices.setState({ notices: [] });
  // the content and the send are held open until a test answers them
  fake = fakeClient({ 'session.queue.list': { entries: [], paused: false } });
  window.maws = fake.client as unknown as PreloadBridge;
  offComposer = registerCommentComposer(openComment);
  focusedBack = 0;
  const s = useSessions.getState();
  useSessions.setState({ records: new Map([[PARENT, record(PARENT, { title: { text: 'Q3 plan', source: 'user' } })]]), engine: new Map([[PARENT, status(PARENT, { process: 'ready' } as never)]]), recordsVersion: s.recordsVersion + 1 });
});
afterEach(() => {
  cleanup();
  offComposer();
  useCommentCard.setState({ open: null });
  resetPlaceNotes();
});

function Host({ id = 'h1', frame = FRAME }: { id?: string; frame?: CardFrame }) {
  return (
    <div className="relative">
      <CommentCardHost hostId={id} host="artifact-page" mode="panel" layout="anchored" accepts={() => true} frame={frame} visible restoreFocus={() => (focusedBack += 1)} subject={RECORD} />
    </div>
  );
}
const placement = (hostId = 'h1'): CommentPlacement => ({ kind: 'card', host: 'artifact-page', hostId, rect: { x: 24, y: 0, width: 300, height: 90 } });
const pick = (n: number, screenshot?: AnchorScreenshot) => act(() => openCommentComposer({ ...page(n), ...(screenshot && { screenshot }) }, { appSessionId: PARENT, placement: placement() }));
const card = () => document.querySelector<HTMLElement>('[data-comment-card]');
const field = () => screen.getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement;
const sendButton = () => within(card()!).getByRole('button', { name: /^(Send|Sending…|Starting…)/ }) as HTMLButtonElement;
const box = () => screen.getByRole('checkbox', { name: 'Send to main' }) as HTMLInputElement;
const pass = () => useCommentCard.getState().passes.get(KEY) ?? null;
const chip = () => document.querySelector<HTMLElement>('[data-unsent-chip]');
const type = (text: string) => fireEvent.change(field(), { target: { value: text } });
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

describe('the draft model on every host', () => {
  it('Escape keeps the card and its text, the keyboard going back to the host; Close then discards that comment', () => {
    render(<Host />);
    pick(1);
    type('Make it bolder');
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(card()).not.toBeNull();
    expect(field().value).toBe('Make it bolder');
    expect(focusedBack).toBe(1);
    fireEvent.click(within(card()!).getByRole('button', { name: 'Close' }));
    expect(card()).toBeNull();
    expect(pass()).toBeNull();
    expect(chip()).toBeNull();
  });

  it('Escape with nothing typed discards the comment; so does the keyboard leaving an empty card', async () => {
    render(
      <>
        <Host />
        <button type="button">elsewhere</button>
      </>,
    );
    pick(1);
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(card()).toBeNull();
    expect(pass()).toBeNull();
    pick(2);
    act(() => screen.getByRole('button', { name: 'elsewhere' }).focus());
    expect(card()).toBeNull();
    expect(pass()).toBeNull();
  });

  it('a host that unmounts keeps the typed comment, drawn as the chip when it mounts again, whose click gives the text back', async () => {
    const view = render(<Host />);
    pick(1);
    type('Make it bolder');
    view.unmount();
    await settle();
    expect(useCommentCard.getState().open).toBeNull();
    expect(pass()?.comments.map((c) => c.text)).toEqual(['Make it bolder']);
    render(<Host />);
    expect(chip()?.textContent).toBe('1 unsent comment');
    fireEvent.click(chip()!);
    expect(field().value).toBe('Make it bolder');
    expect(chip()).toBeNull();
  });

  it('a host that unmounts with nothing typed leaves nothing behind', async () => {
    const view = render(<Host />);
    pick(1);
    view.unmount();
    await settle();
    expect(pass()).toBeNull();
  });
});

describe('several comments in one pass', () => {
  it('a second comment joins the first, which is a line of the card; a click on it edits it, Remove drops it', () => {
    render(<Host />);
    pick(1);
    type('Make it bolder');
    pick(2);
    type('Align it left');
    const line = card()!.querySelector<HTMLElement>('[data-pass-comment]')!;
    expect(line.textContent).toContain('Dashboard v1 › h1');
    expect(line.textContent).toContain('Make it bolder');
    expect(sendButton().textContent).toBe('Send 2 comments');
    fireEvent.click(within(line).getByRole('button', { name: /Dashboard v1 › h1/ }));
    expect(field().value).toBe('Make it bolder');
    expect(card()!.querySelector('[data-pass-comment]')!.textContent).toContain('Align it left');
    fireEvent.click(within(card()!).getByRole('button', { name: 'Remove comment' }));
    expect(pass()?.comments.map((c) => c.text)).toEqual(['Make it bolder']);
    expect(sendButton().textContent).toBe('Send');
  });

  it('the chip counts the pass and opens the card on the newest', async () => {
    render(<Host />);
    pick(1);
    type('Make it bolder');
    pick(2);
    type('Align it left');
    fireEvent.keyDown(field(), { key: 'Escape' });
    act(() => useCommentCard.setState({ open: null }));
    expect(chip()?.textContent).toBe('2 unsent comments');
    fireEvent.click(chip()!);
    expect(field().value).toBe('Align it left');
  });

  it('ticked, one send carries every comment with text, oldest first; the pass ends and the next starts unchecked', async () => {
    render(<Host />);
    pick(1, SHOT);
    type('Make it bolder');
    pick(2);
    type('Align it left');
    pick(3); // nothing typed: discarded as the send sets out
    fireEvent.click(box());
    fireEvent.click(sendButton());
    expect(fake.invoked('side.comment.content')).toEqual([
      {
        comments: [
          { anchor: page(1), text: 'Make it bolder', screenshot: SHOT },
          { anchor: page(2), text: 'Align it left', screenshot: null },
        ],
      },
    ]);
    await fake.reply('side.comment.content', { content: BUILT });
    await fake.reply('session.send', { messageUuid: null, disposition: 'sent', queueId: 'q0' });
    await settle();
    expect(fake.invoked('session.send')).toHaveLength(1);
    expect(pass()).toBeNull();
    expect(document.querySelector('[data-sent-note]')?.textContent).toBe('Sent to Q3 plan');
    pick(4);
    expect(box().checked).toBe(false);
  });

  it('unchecked, one side thread is opened with the first comment and the others as `more`', async () => {
    render(<Host />);
    pick(1);
    type('Make it bolder');
    pick(2);
    type('Align it left');
    fireEvent.click(sendButton());
    expect(fake.invoked('side.thread.open')).toEqual([{ appSessionId: PARENT_ID, from: { kind: 'comment', anchor: page(1), text: 'Make it bolder', screenshot: null, more: [{ anchor: page(2), text: 'Align it left', screenshot: null }] } }]);
  });
});

// Decision Log 52 (2): a message carries at most MESSAGE_COMMENTS_MAX comments, and both destinations refuse more, so a
// pass never holds more: a pick at the bound adds nothing, the card opening on the newest comment with one line that says
// so; every comment counts, with text or without, so a discard makes room
describe('a pass at the most a message carries', () => {
  const LIMIT_LINE = 'A message carries at most 20 comments: send these first';
  const limitLine = () => card()?.querySelector<HTMLElement>('[data-pass-limit]') ?? null;
  const fill = () => {
    render(<Host />);
    for (let n = 1; n <= MESSAGE_COMMENTS_MAX; n++) {
      pick(n);
      type(`Comment ${n}`);
    }
  };

  it('the 21st pick adds nothing: the card opens on the newest comment and says the limit in one line', () => {
    fill();
    expect(limitLine()).toBeNull();
    pick(21);
    expect(pass()?.comments).toHaveLength(MESSAGE_COMMENTS_MAX);
    expect(pass()?.comments.at(-1)?.text).toBe('Comment 20');
    expect(field().value).toBe('Comment 20');
    expect(limitLine()?.textContent).toBe(LIMIT_LINE);
  });

  it('after a discard a pick adds again', () => {
    fill();
    pick(21);
    expect(limitLine()?.textContent).toBe(LIMIT_LINE);
    fireEvent.click(within(card()!).getAllByRole('button', { name: 'Remove comment' })[0]!);
    expect(pass()?.comments.map((c) => c.text)).not.toContain('Comment 1');
    expect(pass()?.comments).toHaveLength(MESSAGE_COMMENTS_MAX - 1);
    expect(limitLine()).toBeNull();
    pick(22);
    expect(pass()?.comments).toHaveLength(MESSAGE_COMMENTS_MAX);
    expect(pass()?.comments.at(-1)?.anchor).toEqual(page(22));
    expect(field().value).toBe('');
    expect(limitLine()).toBeNull();
  });

  it('a pass of exactly 20 opens one side thread: the first comment and 19 as `more`', () => {
    fill();
    expect(sendButton().textContent).toBe('Send 20 comments');
    expect(sendButton().disabled).toBe(false);
    fireEvent.click(sendButton());
    const [sent] = fake.invoked('side.thread.open') as { from: { text: string; more: { text: string }[] } }[];
    expect([sent!.from.text, ...sent!.from.more.map((c) => c.text)]).toEqual(Array.from({ length: MESSAGE_COMMENTS_MAX }, (_, i) => `Comment ${i + 1}`));
  });

  it('a pass of exactly 20 goes to the main conversation as one message', async () => {
    fill();
    fireEvent.click(box());
    fireEvent.click(sendButton());
    const [built] = fake.invoked('side.comment.content') as { comments: { text: string }[] }[];
    expect(built!.comments.map((c) => c.text)).toEqual(Array.from({ length: MESSAGE_COMMENTS_MAX }, (_, i) => `Comment ${i + 1}`));
    await fake.reply('side.comment.content', { content: BUILT });
    await fake.reply('session.send', { messageUuid: null, disposition: 'sent', queueId: 'q0' });
    await settle();
    expect(pass()).toBeNull();
  });

  it('a pass holding more than a message carries, with text, cannot be sent', () => {
    fill();
    const held = pass()!;
    const extra = { ...held.comments.at(-1)!, id: 'extra', text: 'One too many' };
    act(() => useCommentCard.setState((s) => ({ passes: new Map(s.passes).set(KEY, { ...held, comments: [...held.comments, extra] }) })));
    expect(sendButton().disabled).toBe(true);
    fireEvent.click(sendButton());
    expect(fake.invoked('side.thread.open')).toEqual([]);
  });
});

// Decision Log 52 (1): this Mac's older MAWS service refuses a side thread of several comments before it goes (main's
// hook); the card shows the refusal as it shows any, and the pass stays whole
describe('a side thread of several comments refused by an older service', () => {
  it('every comment stays in the pass, the card on the newest showing the words with Retry', async () => {
    render(<Host />);
    pick(1);
    type('Make it bolder');
    pick(2);
    type('Align it left');
    fireEvent.click(sendButton());
    await fake.fail('side.thread.open', THREAD_FROM_ONE_COMMENT, 'internal', { refusal: 'not-offered' });
    await settle();
    expect(pass()?.comments.map((c) => [c.text, c.flight, c.refused?.error])).toEqual([
      ['Make it bolder', null, THREAD_FROM_ONE_COMMENT],
      ['Align it left', null, THREAD_FROM_ONE_COMMENT],
    ]);
    expect(within(card()!).getByRole('alert').textContent).toContain(THREAD_FROM_ONE_COMMENT);
    expect(within(card()!).getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});

describe('a pass’s send (§D), each awaited promise held open', () => {
  async function twoInFlight() {
    render(<Host />);
    pick(1);
    type('Make it bolder');
    pick(2);
    type('Align it left');
    fireEvent.click(box());
    fireEvent.click(sendButton());
  }

  it('in flight: the field and Remove are off, a second Send does nothing, Close only leaves the card', async () => {
    await twoInFlight();
    expect(field().disabled).toBe(true);
    expect((within(card()!).getByRole('button', { name: 'Remove comment' }) as HTMLButtonElement).disabled).toBe(true);
    expect(sendButton().disabled).toBe(true);
    expect(sendButton().textContent).toBe('Sending…');
    fireEvent.click(sendButton());
    expect(fake.invoked('side.comment.content')).toHaveLength(1);
    fireEvent.click(within(card()!).getByRole('button', { name: 'Close' }));
    expect(card()).toBeNull();
    expect(pass()?.comments).toHaveLength(2);
  });

  // M3's review, finding 2 (§D: the checkbox may change during a flight, which changes nothing of the flight)
  it('the checkbox changes during a flight: the flight keeps its destination, the next send takes the new one', async () => {
    await twoInFlight(); // ticked: to main, the content held
    pick(3);
    type('And the footer');
    expect(box().disabled).toBe(false);
    fireEvent.click(box());
    expect(box().checked).toBe(false);
    await fake.reply('side.comment.content', { content: BUILT });
    await fake.reply('session.send', { messageUuid: null, disposition: 'sent', queueId: 'q0' });
    await settle();
    expect(fake.invoked('session.send')).toHaveLength(1);
    expect(fake.invoked('side.thread.open')).toHaveLength(0);
    expect(box().checked).toBe(false);
    fireEvent.click(sendButton());
    expect(fake.invoked('side.thread.open')).toHaveLength(1);
    expect(fake.invoked('side.comment.content')).toHaveLength(1);
  });

  it('a comment added during a flight stays editable and survives its success', async () => {
    await twoInFlight();
    pick(3);
    expect(field().disabled).toBe(false);
    type('And the footer');
    expect(sendButton().disabled).toBe(true);
    await fake.reply('side.comment.content', { content: BUILT });
    await fake.reply('session.send', { messageUuid: null, disposition: 'sent', queueId: 'q0' });
    await settle();
    expect(pass()?.comments.map((c) => c.text)).toEqual(['And the footer']);
    expect(field().value).toBe('And the footer');
    expect(sendButton().disabled).toBe(false);
  });

  it('a refusal leaves every comment, the card on one showing the reason with Retry; a comment added meanwhile is kept too', async () => {
    await twoInFlight();
    await fake.fail('side.comment.content', 'The screenshot is gone');
    await settle();
    expect(pass()?.comments.map((c) => [c.text, c.flight, c.refused?.error])).toEqual([
      ['Make it bolder', null, 'The screenshot is gone'],
      ['Align it left', null, 'The screenshot is gone'],
    ]);
    expect(within(card()!).getByRole('alert').textContent).toContain('The screenshot is gone');
    fireEvent.click(within(card()!).getByRole('button', { name: 'Retry' }));
    expect(fake.invoked('side.comment.content')).toHaveLength(2);
  });

  it('a refusal with no card open: the mounted host opens the card on the newest refused comment', async () => {
    await twoInFlight();
    fireEvent.click(within(card()!).getByRole('button', { name: 'Close' }));
    await fake.fail('side.comment.content', 'The screenshot is gone');
    await settle();
    expect(field().value).toBe('Align it left');
    expect(within(card()!).getByRole('alert').textContent).toContain('The screenshot is gone');
  });

  it('a refusal with no host mounted is a toast; a host mounted after it draws the chip', async () => {
    await twoInFlight();
    cleanup();
    await settle();
    await fake.fail('side.comment.content', 'The screenshot is gone');
    await settle();
    expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['The comment was not sent: The screenshot is gone']);
    render(<Host />);
    expect(chip()?.textContent).toBe('2 unsent comments');
  });

  it('a host that unmounts during a flight: the flight settles and a host mounted after its success draws the sent line', async () => {
    await twoInFlight();
    cleanup();
    await settle();
    await fake.reply('side.comment.content', { content: BUILT });
    await fake.reply('session.send', { messageUuid: null, disposition: 'sent', queueId: 'q0' });
    await settle();
    expect(pass()).toBeNull();
    render(<Host />);
    expect(document.querySelector('[data-sent-note]')?.textContent).toBe('Sent to Q3 plan');
  });

  it('a subject that closes during a flight: its other comments go at once; the flight settles silently on success and as a toast on refusal', async () => {
    await twoInFlight();
    pick(3);
    type('And the footer');
    act(() => dropSubject('artifact-page', RECORD));
    expect(pass()).toBeNull();
    expect(card()).toBeNull();
    await fake.reply('side.comment.content', { content: BUILT });
    await fake.reply('session.send', { messageUuid: null, disposition: 'sent', queueId: 'q0' });
    await settle();
    expect(document.querySelector('[data-sent-note]')).toBeNull();
    expect(useNotices.getState().notices).toEqual([]);
    expect(pass()).toBeNull();
  });
});

describe('the host’s frame (§C)', () => {
  it('onClosed hears each card of the host that went, once, whatever took it: another comment, Close', async () => {
    const closed: string[] = [];
    render(<Host frame={{ ...FRAME, onClosed: (gone) => closed.push(gone.anchor.locator) }} />);
    pick(1);
    type('Make it bolder');
    pick(2); // the card moves to the new comment
    await settle();
    expect(closed).toEqual(['#e1']);
    fireEvent.click(within(card()!).getByRole('button', { name: 'Close' }));
    await settle();
    expect(closed).toEqual(['#e1', '#e2']);
  });

  // M3's review, finding 1: M4 tells the page its card closed from this; a card the host keeps is never reported
  it('onClosed: StrictMode’s replay and a remount under the same id keep the card and report nothing; its real close is reported once', async () => {
    const closed: string[] = [];
    const frame: CardFrame = { ...FRAME, onClosed: (gone) => closed.push(gone.anchor.locator) };
    pick(1); // open before the host mounts, so the replay's cleanup meets it
    const view = render(
      <StrictMode>
        <Host key="a" frame={frame} />
      </StrictMode>,
    );
    type('Make it bolder');
    await settle();
    expect(card()).not.toBeNull();
    expect(closed).toEqual([]);
    view.rerender(
      <StrictMode>
        <Host key="b" frame={frame} />
      </StrictMode>,
    );
    await settle();
    expect(card()).not.toBeNull();
    expect(closed).toEqual([]);
    fireEvent.click(within(card()!).getByRole('button', { name: 'Close' }));
    await settle();
    expect(closed).toEqual(['#e1']);
  });
});

describe('onClosed, the checks of several mounts (M3’s re-review)', () => {
  // no await between the mounts and the close: every mount's deferred check is still queued when the card goes
  it('a card closed at once after StrictMode’s render is told once', async () => {
    const closed: string[] = [];
    const frame: CardFrame = { ...FRAME, onClosed: (gone) => closed.push(gone.anchor.locator) };
    pick(1);
    render(
      <StrictMode>
        <Host frame={frame} />
      </StrictMode>,
    );
    fireEvent.click(within(card()!).getByRole('button', { name: 'Close' }));
    await settle();
    expect(closed).toEqual(['#e1']);
  });

  it('a card closed at once after a remount under the same id is told once', async () => {
    const closed: string[] = [];
    const frame: CardFrame = { ...FRAME, onClosed: (gone) => closed.push(gone.anchor.locator) };
    pick(1);
    const view = render(
      <StrictMode>
        <Host key="a" frame={frame} />
      </StrictMode>,
    );
    view.rerender(
      <StrictMode>
        <Host key="b" frame={frame} />
      </StrictMode>,
    );
    fireEvent.click(within(card()!).getByRole('button', { name: 'Close' }));
    await settle();
    expect(closed).toEqual(['#e1']);
  });
});

describe('onClosed across hosts (M3’s second re-review)', () => {
  it('a card handed to another host is told lost by the first and, once it closes, by the second', async () => {
    const lost: string[] = [];
    const a: CardFrame = { ...FRAME, onClosed: () => lost.push('h1') };
    const b: CardFrame = { ...FRAME, onClosed: () => lost.push('h2') };
    render(
      <>
        <Host id="h1" frame={a} />
        <Host id="h2" frame={b} />
      </>,
    );
    pick(1);
    type('Make it bolder');
    act(() => handCardTo(useCommentCard.getState().open!.serial, 'h2'));
    await settle();
    expect(lost).toEqual(['h1']);
    expect(card()).not.toBeNull();
    fireEvent.click(within(card()!).getByRole('button', { name: 'Close' }));
    await settle();
    expect(lost).toEqual(['h1', 'h2']);
  });

  it('a card handed back to its first host is told lost by that host again when it closes', async () => {
    const lost: string[] = [];
    const a: CardFrame = { ...FRAME, onClosed: () => lost.push('h1') };
    const b: CardFrame = { ...FRAME, onClosed: () => lost.push('h2') };
    render(
      <>
        <Host id="h1" frame={a} />
        <Host id="h2" frame={b} />
      </>,
    );
    pick(1);
    type('Make it bolder');
    const serial = useCommentCard.getState().open!.serial;
    act(() => handCardTo(serial, 'h2'));
    await settle();
    act(() => handCardTo(serial, 'h1'));
    await settle();
    expect(lost).toEqual(['h1', 'h2']);
    fireEvent.click(within(card()!).getByRole('button', { name: 'Close' }));
    await settle();
    expect(lost).toEqual(['h1', 'h2', 'h1']);
  });
});

describe('the card’s structure (decision 23)', () => {
  it('the header and the row with the checkbox and Send are outside the scrolling region, which holds the list, capped at three lines', () => {
    render(<Host />);
    pick(1, SHOT);
    type('Make it bolder');
    pick(2);
    const scroll = card()!.querySelector<HTMLElement>('[data-card-scroll]')!;
    expect(scroll.contains(field())).toBe(true);
    expect(scroll.querySelector('[data-pass-comment]')).not.toBeNull();
    expect(scroll.contains(card()!.querySelector('header'))).toBe(false);
    expect(scroll.contains(card()!.querySelector('[data-send-row]'))).toBe(false);
    expect(scroll.className).toContain('overflow-y-auto');
    expect(card()!.querySelector('[data-pass-comments]')!.className).toContain('max-h-[72px]');
    expect(card()!.className).toContain('overflow-hidden');
  });
});

