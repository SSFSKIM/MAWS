// UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, M3; §C, §D, decisions 4, 5, 18 and 23):
// the pass in the card and its host. Escape keeps the card and its text, an empty card goes when the keyboard leaves it,
// Close discards that comment; a host that unmounts, and a second comment, keep what was typed. On a `many` host a second
// comment joins the first: the card lists the others, Send reads "Send N comments" and one send carries them all. A pass
// with comments and no card is a chip. §D's table row by row, each with the awaited promise held open.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Anchor, AnchorScreenshot } from '@shared/anchor/anchor';
import { artifactUrl } from '@shared/artifacts/scheme';
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
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
import { dropSubject, passKey, resetPlaceNotes, useCommentCard } from './store';

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

