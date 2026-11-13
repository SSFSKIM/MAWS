// P2-E1 (M1): the comment card's composer half (P2-E1 document, D2, D3, D4 and D5; acceptance 1 and 2). The seam opens
// a card for a card placement and the sheet otherwise; the card is the sheet's form at card size, sharing its phases and
// its sends (byte-identical payloads for the same anchor and text), drawn by its host at D4's placement; Close and
// Escape dismiss it and give focus back; one card per window.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Anchor } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { artifactUrl } from '@shared/artifacts/scheme';
import { digest, record, status } from '../../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { at } from '../../../../../test/support/machine';
import { useNotices } from '../../stores/notices';
import { useSessions } from '../../stores/sessions';
import { availabilityIn } from '../../sessions/availability';
import { submitState } from '../../composer/submit/submit-state';
import { resetShellStores } from '../../test-support/shell-stores';
import { openCommentComposer, registerCommentComposer, type CommentPlacement } from '../../tools/code/anchor/anchor';
import { CommentComposerHost, useCommentComposer } from '../CommentComposer';
import { openComment } from '../register';
import { CommentCardHost, type CardFrame } from './CardHost';
import { resetPlaceNotes, SENT_NOTE_MS, useCommentCard } from './store';
import { applyLaneAState, holdPendingSend, resetLaneAStore, useLaneA } from '../../stores/lane-a'; // UX wave U5a
import { laneAState } from '../../lane-a/test-support/lane-a-state';
import { PendingSends } from '../../composer/PendingSends';
import { shownSession } from '../../panel/host';
import { useLayout } from '../../stores/layout';
import { useMachines } from '../../stores/machines';
import { addressOf } from '@shared/machine/address';
import { remoteRow, T0 } from '../../../../../test/support/builders';
import { OTHER_MACHINE } from '../../../../../test/support/machine';

// P5 O6 M2: main is asked with the bare id; the page holds its address
const PARENT_ID = 'a1111111-1111-4111-8111-111111111111' as AppSessionId;
const PARENT = at(PARENT_ID);
const RECORD = '00000000-0000-4000-8000-000000000001';
const ANCHOR: Anchor = { kind: 'artifact-element', locator: '#hero', label: 'Dashboard v1 › h1#hero “Sales overview”', pageUrl: artifactUrl(RECORD, 1, 'index.html') };
const RECT = { x: 24, y: 0, width: 300, height: 90 };
const FRAME: CardFrame = { scale: 1, offset: { x: 0, y: 0 }, key: 'k1' };
const HOST_BOX = { width: 600, height: 800 };

let fake: FakeClient;
let offComposer: () => void;
const restoreFocus = vi.fn();

// jsdom lays nothing out: the host measures this box
const clientSize = { width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')!, height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')! };
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => HOST_BOX.width });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => HOST_BOX.height });
});
afterAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientSize.width);
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientSize.height);
});

function withParent(process: 'ready' | 'exited') {
  const s = useSessions.getState();
  useSessions.setState({ records: new Map([[PARENT, record(PARENT, { title: { text: 'Q3 plan', source: 'user' } })]]), engine: new Map([[PARENT, status(PARENT, { process } as never)]]), recordsVersion: s.recordsVersion + 1 });
}

// UX wave U5a: a ticked comment's content is main's, sent through the session's port as a typed message is
const BUILT = [{ type: 'text', text: 'the built message' }];
const MAIN_SENDS = { 'side.comment.content': { content: BUILT }, 'session.queue.list': { entries: [], paused: false }, 'session.send': { messageUuid: null, disposition: 'sent', queueId: 'q0' } } as const;

beforeEach(() => {
  resetShellStores();
  resetPlaceNotes();
  resetLaneAStore();
  useNotices.setState({ notices: [] });
  fake = fakeClient(MAIN_SENDS);
  window.maws = fake.client as unknown as PreloadBridge;
  offComposer = registerCommentComposer(openComment);
  restoreFocus.mockClear();
  withParent('ready');
});
afterEach(() => {
  cleanup();
  offComposer();
  useCommentComposer.setState({ open: null });
  useCommentCard.setState({ open: null });
});

const cardPlacement = (over: Partial<Extract<CommentPlacement, { kind: 'card' }>> = {}): CommentPlacement => ({ kind: 'card', host: 'artifact-page', hostId: 'h1', rect: RECT, ...over });

function mount(layout: 'anchored' | 'docked' = 'anchored', frame: CardFrame = FRAME /* P3-B */) {
  return render(
    <>
      <CommentComposerHost />
      <div className="relative">
        <CommentCardHost subject="subject-1" hostId="h1" host="artifact-page" mode="panel" layout={layout} accepts={() => true} frame={frame} visible restoreFocus={restoreFocus} />
      </div>
    </>,
  );
}

const pick = (anchor: Anchor = ANCHOR, placement: CommentPlacement = cardPlacement()) => act(() => openCommentComposer(anchor, { appSessionId: PARENT, placement }));
const card = () => document.querySelector<HTMLElement>('[data-comment-card]');
const field = () => screen.getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement;
const box = () => screen.getByRole('checkbox', { name: 'Send to main' }) as HTMLInputElement; // UX wave U5a
const titleOf = (input: HTMLInputElement) => input.closest('label')!.getAttribute('title');

describe('the seam’s dispatch by placement', () => {
  it('a card placement opens the card and no sheet; none, or the sheet’s, opens the sheet and no card', () => {
    mount();
    pick();
    expect(card()).not.toBeNull();
    expect(document.querySelector('[data-comment-composer]')).toBeNull();
    act(() => useCommentCard.setState({ open: null }));

    act(() => openCommentComposer(ANCHOR, { appSessionId: PARENT }));
    expect(document.querySelector('[data-comment-composer]')).not.toBeNull();
    expect(card()).toBeNull();
    act(() => useCommentComposer.setState({ open: null }));

    pick(ANCHOR, { kind: 'sheet' });
    expect(document.querySelector('[data-comment-composer]')).not.toBeNull();
    expect(card()).toBeNull();
  });

  it('a host draws only the card opened for it', () => {
    mount();
    pick(ANCHOR, cardPlacement({ hostId: 'another' }));
    expect(useCommentCard.getState().open).not.toBeNull();
    expect(card()).toBeNull();
  });
});

describe('the card’s placement', () => {
  it('opens beside the element per D4, with the anchor on its element', () => {
    mount();
    pick();
    const el = card()!;
    expect(el.dataset).toMatchObject({ anchorKind: 'artifact-element', anchorLocator: '#hero', cardPhase: 'composing', placement: 'below' });
    expect(el.style).toMatchObject({ left: '24px', top: '94px', width: '300px', maxHeight: '480px' });
  });

  it('opens above an element near the host’s bottom', () => {
    mount();
    pick(ANCHOR, cardPlacement({ rect: { x: 24, y: 600, width: 100, height: 100 } }));
    expect(card()!.dataset.placement).toBe('above');
    expect(card()!.style).toMatchObject({ left: '24px', bottom: '204px' });
  });

  // P2-E2: docked, the host is a strip in flow under a native view, the card in it and the pin a caret on its top edge
  it('a docked host draws it in flow in its strip, the column’s full width less 16 px, with a caret under the element', () => {
    mount('docked');
    pick();
    expect(card()!.dataset.placement).toBe('strip');
    expect(card()!.style).toMatchObject({ width: '584px', maxHeight: '320px', margin: '8px' });
    expect(card()!.className).toContain('relative');
    expect(document.querySelector('[data-card-host]')!.hasAttribute('data-card-dock')).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-card-caret]')!.dataset.cardCaret).toBe('24'); // the pick's x
  });

  // P2-F L148: the strip clips (its half-column cap) and gives the card 8 px of margin. The floating shadow's 24 and 64 px
  // blurs, and the composer's 80 px light layer, overflow it; the strip's own token reaches at most 8 px (e2e case 1
  // measures the computed shadow against the strip in both themes). Anchored and docked over a frame, the card floats.
  it('in the strip the card casts the strip’s shadow, which fits its margin; over a frame the floating one', () => {
    mount('docked');
    pick();
    expect(card()!.className).toContain('shadow-strip');
    expect(card()!.className).not.toMatch(/shadow-(float|composer)/);
    cleanup();
    mount();
    pick();
    expect(card()!.className).toContain('shadow-float');
  });

  it('a docked card with no rect has no caret', () => {
    mount('docked');
    pick(ANCHOR, cardPlacement({ rect: undefined }));
    expect(card()!.dataset.placement).toBe('strip');
    expect(document.querySelector('[data-card-caret]')).toBeNull();
  });
});

describe('the composer half', () => {
  it('names the anchor, takes focus, starts unchecked, and keeps the sheet’s accessible form', async () => {
    mount();
    pick();
    expect(screen.getByRole('dialog', { name: `Comment on ${ANCHOR.label}` })).toBe(card());
    expect(card()!.getAttribute('aria-modal')).toBeNull(); // non-modal: the page stays readable and clickable
    expect(screen.getByRole('heading', { name: ANCHOR.label }).getAttribute('title')).toBe(`${ANCHOR.label}\n${ANCHOR.locator}`);
    expect(document.activeElement).toBe(field());
    expect(box().checked).toBe(false);
    expect(card()!.querySelector('input[type="checkbox"][data-send-to-main]')).toBe(box());
    expect(screen.queryAllByRole('radio')).toEqual([]); // UX wave U5a: no two-segment control
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await userEvent.type(field(), 'Bigger');
    expect(send.disabled).toBe(false);
  });

  // P2-A (2026-10-09; its execution document §5.6, through the shared form): Send to main is offered for every parent
  // the Send can start; one a terminal holds says why
  it('Send to main stays enabled for an exited parent, saying it starts the session; off with the reason while a terminal holds it with no bridge', () => {
    withParent('exited');
    mount();
    pick();
    expect(box().disabled).toBe(false);
    expect(titleOf(box())).toBe('Starts this session');
    act(() => useSessions.setState((s) => ({ records: new Map([[PARENT, { ...record(PARENT), holder: { kind: 'terminal', pid: 42 } }]]), digests: new Map(s.digests).set(PARENT, digest(PARENT, { availability: 'foreign_held' })) })));
    expect(box().disabled).toBe(true);
    expect(box().checked).toBe(false);
    expect(titleOf(box())).toBe('Held by terminal · 42');
  });

  it('Side thread sends exactly the sheet’s side.thread.open for the same anchor and text; Enter sends, Shift+Enter breaks, a composition’s Enter does not', async () => {
    fake = fakeClient();
    window.maws = fake.client as unknown as PreloadBridge;
    mount();
    act(() => openCommentComposer(ANCHOR, { appSessionId: PARENT }));
    await userEvent.type(field(), 'Line one{Shift>}{Enter}{/Shift}line two{Enter}');
    act(() => useCommentComposer.setState({ open: null }));

    pick();
    await userEvent.type(field(), 'Line one{Shift>}{Enter}{/Shift}line two');
    fireEvent.keyDown(field(), { key: 'Enter', isComposing: true });
    expect(fake.invoked('side.thread.open')).toHaveLength(1);
    await userEvent.type(field(), '{Enter}');
    const [sheet, fromCard] = fake.invoked('side.thread.open');
    expect(fromCard).toEqual(sheet);
    expect(fromCard).toEqual({ appSessionId: PARENT_ID, from: { kind: 'comment', anchor: ANCHOR, text: 'Line one\nline two', screenshot: null } });
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeTruthy();
    expect(field().disabled).toBe(true);
  });

  it('a refused Side thread stays in the card with Retry and Send to main instead', async () => {
    fake = fakeClient();
    window.maws = fake.client as unknown as PreloadBridge;
    mount();
    pick();
    await userEvent.type(field(), 'Why?{Enter}');
    await act(() => fake.reply('side.thread.open', { status: 'refused', appSessionId: 'b2222222-2222-4222-8222-222222222222', reason: 'no_engine_session', message: 'This session has not started yet' }));
    expect(card()).not.toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('This session has not started yet');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send to main instead' })).toBeTruthy();
  });

  it('Send to main asks main for exactly the sheet’s content and sends it as a comment, never side.sendToMain, then closes the card and gives focus back', async () => {
    mount();
    act(() => openCommentComposer(ANCHOR, { appSessionId: PARENT }));
    await userEvent.click(box());
    await userEvent.type(field(), 'Look here{Enter}');
    expect(document.querySelector('[data-comment-composer]')).toBeNull();

    pick();
    await userEvent.click(box());
    await userEvent.type(field(), 'Look here');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    const [sheet, fromCard] = fake.invoked('side.comment.content');
    expect(fromCard).toEqual(sheet);
    expect(fromCard).toEqual({ comments: [{ anchor: ANCHOR, text: 'Look here', screenshot: null }] });
    expect(fake.invoked('session.send')).toEqual([{ appSessionId: PARENT_ID, content: BUILT }, { appSessionId: PARENT_ID, content: BUILT }]);
    expect(fake.invoked('side.sendToMain')).toEqual([]);
    expect(card()).toBeNull();
    expect(useCommentCard.getState().open).toBeNull();
    expect(restoreFocus).toHaveBeenCalledTimes(1);
  });

  it('shows a producer’s screenshot as the thumbnail, removable, and sends it as its own field', async () => {
    mount();
    const screenshot = { path: '/user-data/captures/one.png', width: 640, height: 480 };
    pick({ ...ANCHOR, screenshot });
    expect(screen.getByText('Screenshot · 640 × 480')).toBeTruthy();
    await userEvent.click(box());
    await userEvent.type(field(), 'Here{Enter}');
    expect(fake.invoked('side.comment.content')).toEqual([{ comments: [{ anchor: ANCHOR, text: 'Here', screenshot }] }]);

    pick({ ...ANCHOR, screenshot });
    await userEvent.click(screen.getByRole('button', { name: 'Remove screenshot' }));
    expect(screen.queryByText('Screenshot · 640 × 480')).toBeNull();
  });
});

describe('dismissal', () => {
  it('Close dismisses the card and gives focus back', async () => {
    mount();
    pick();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(card()).toBeNull();
    expect(restoreFocus).toHaveBeenCalledTimes(1);
  });

  it('Escape inside the card dismisses it, answered so the viewer’s picking listener leaves it; a composition’s Escape does not', () => {
    mount();
    pick();
    const seen: boolean[] = [];
    const listener = (event: KeyboardEvent) => void seen.push(event.defaultPrevented);
    window.addEventListener('keydown', listener);
    try {
      fireEvent.keyDown(field(), { key: 'Escape', isComposing: true });
      expect(card()).not.toBeNull();
      fireEvent.keyDown(field(), { key: 'Escape' });
      expect(card()).toBeNull();
      expect(seen).toEqual([false, true]);
      expect(restoreFocus).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', listener);
    }
  });

  // UX wave U5a (M3): the new pick's comment joins the first, which stays a line of the one card
  it('one card per window: a new pick opens the card on a new comment, the first one kept in the pass', async () => {
    mount();
    pick();
    await userEvent.type(field(), 'Draft');
    const first = useCommentCard.getState().open!.serial;
    pick({ ...ANCHOR, locator: 'p.lead', label: 'Dashboard v1 › p.lead' });
    expect(useCommentCard.getState().open!.serial).not.toBe(first);
    expect(document.querySelectorAll('[data-comment-card]')).toHaveLength(1);
    expect(card()!.dataset.anchorLocator).toBe('p.lead');
    expect(field().value).toBe('');
    expect(card()!.querySelector('[data-pass-comment]')!.textContent).toContain('Draft');
  });

  it('a refusal arriving after the card closed mid-send and its host went is a toast with its reason', async () => {
    fake = fakeClient();
    window.maws = fake.client as unknown as PreloadBridge;
    const view = mount();
    pick();
    await userEvent.type(field(), 'Why?{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    view.unmount();
    await act(() => fake.reply('side.thread.open', { status: 'refused', appSessionId: 'b2222222-2222-4222-8222-222222222222', reason: 'unknown_session', message: 'The session is gone' }));
    expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['The comment was not sent: The session is gone']);
  });

  // P4-B3 (M6's review; its Decision Log 37): a card host remounted with its card while a send is on its way (a document
  // moved to another pane or between the panel and a tab keeps its card) draws a new form; the send is the card's, so the
  // new form starts sending, sends nothing more, and takes the answer
  describe('a remount while a send is on its way', () => {
    const hostAs = (slot: string) => (
      <div key={slot} className="relative">
        <CommentCardHost subject="subject-1" hostId="h1" host="artifact-page" mode="panel" layout="anchored" accepts={() => true} frame={FRAME} visible restoreFocus={restoreFocus} />
      </div>
    );
    async function sentThenRemounted() {
      fake = fakeClient();
      window.maws = fake.client as unknown as PreloadBridge;
      const view = render(hostAs('a'));
      pick();
      await userEvent.type(field(), 'Why?{Enter}');
      expect(fake.invoked('side.thread.open')).toHaveLength(1);
      const before = field();
      view.rerender(hostAs('b')); // the body moved: another host element, the same card
      await act(async () => {});
      expect(field(), 'a new form').not.toBe(before);
      return view;
    }

    it('starts disabled, a second Enter opens nothing, and a refusal reaches it, enabled again', async () => {
      await sentThenRemounted();
      expect(field().disabled).toBe(true);
      fireEvent.keyDown(field(), { key: 'Enter' });
      await act(async () => {});
      expect(fake.invoked('side.thread.open')).toHaveLength(1);
      await act(() => fake.reply('side.thread.open', { status: 'refused', appSessionId: 'b2222222-2222-4222-8222-222222222222', reason: 'no_engine_session', message: 'This session has not started yet' }));
      expect(screen.getByRole('alert').textContent).toContain('This session has not started yet');
      expect(field().disabled).toBe(false);
      expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    });

    it('a send that went reaches the new form: Send to main closes the card, nothing sent twice', async () => {
      fake = fakeClient({ 'side.comment.content': { content: BUILT }, 'session.queue.list': { entries: [], paused: false } }); // session.send answers when told
      window.maws = fake.client as unknown as PreloadBridge;
      const view = render(hostAs('a'));
      pick();
      await userEvent.click(box());
      await userEvent.type(field(), 'Look here{Enter}');
      await vi.waitFor(() => expect(fake.invoked('session.send')).toHaveLength(1));
      view.rerender(hostAs('b'));
      await act(async () => {});
      expect(field().disabled).toBe(true);
      fireEvent.keyDown(field(), { key: 'Enter' });
      await act(() => fake.reply('session.send', { messageUuid: null, disposition: 'sent', queueId: 'q0' }));
      expect(fake.invoked('session.send')).toHaveLength(1);
      expect(fake.invoked('side.comment.content')).toHaveLength(1);
      expect(useCommentCard.getState().open).toBeNull();
    });
  });

  it('its host unmounting closes it, though StrictMode’s effect replay does not', async () => {
    pick(); // open before the host mounts, so the replay's cleanup meets it
    const { unmount } = render(
      <StrictMode>
        <CommentCardHost subject="subject-1" hostId="h1" host="artifact-page" mode="panel" layout="anchored" accepts={() => true} frame={FRAME} visible />
      </StrictMode>,
    );
    await act(async () => {});
    expect(card()).not.toBeNull();
    unmount();
    await act(async () => {});
    expect(useCommentCard.getState().open).toBeNull();
  });
});

// P3-B (docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D9): a host's frame may add actions to the card's header
// (the document's Resolve) and is told of each send as it sets out and then whether it went, before the card turns into
// its thread or closes and also after the card went (the document keeps the thread and records the comment in it)
describe('the frame’s card hooks (P3-B)', () => {
  it('draws the frame’s actions in the card’s header, for the card it shows', () => {
    mount('anchored', { ...FRAME, actions: (shown) => <button type="button">Resolve {shown.anchor.locator}</button> });
    pick();
    expect(card()!.querySelector('header')!.textContent).toContain('Resolve #hero');
  });

  it('tells the frame of each send as it sets out, then whether it went: Send to main, a refusal, a Side thread on Retry', async () => {
    const settled = vi.fn();
    const onSending = vi.fn<NonNullable<CardFrame['onSending']>>(() => settled);
    mount('anchored', { ...FRAME, onSending });
    pick();
    await userEvent.click(box());
    await userEvent.type(field(), ' Look here {Enter}');
    expect(onSending).toHaveBeenCalledTimes(1);
    expect(onSending.mock.calls[0]).toMatchObject([{ anchor: ANCHOR }, { text: 'Look here', destination: 'main' }]);
    expect(settled.mock.calls).toEqual([[true]]);

    fake = fakeClient({ 'session.intent.get': null });
    window.maws = fake.client as unknown as PreloadBridge;
    pick();
    await userEvent.type(field(), 'Why?{Enter}');
    expect(onSending).toHaveBeenCalledTimes(2);
    await act(() => fake.reply('side.thread.open', { status: 'refused', appSessionId: 'b2222222-2222-4222-8222-222222222222', reason: 'no_engine_session', message: 'Not yet' }));
    expect(settled.mock.calls).toEqual([[true], [false]]);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await act(() => fake.reply('side.thread.open', { status: 'starting', appSessionId: 'b2222222-2222-4222-8222-222222222222' }));
    expect(onSending.mock.calls[2]![1]).toEqual({ text: 'Why?', destination: 'thread' });
    expect(settled.mock.calls).toEqual([[true], [false], [true]]);
  });

  it('tells the frame how a send ended after its card was closed', async () => {
    const settled = vi.fn();
    mount('anchored', { ...FRAME, onSending: () => settled });
    fake = fakeClient({ 'session.intent.get': null });
    window.maws = fake.client as unknown as PreloadBridge;
    pick();
    await userEvent.type(field(), 'Why?{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(card()).toBeNull();
    expect(settled).not.toHaveBeenCalled();
    await act(() => fake.reply('side.thread.open', { status: 'starting', appSessionId: 'b2222222-2222-4222-8222-222222222222' }));
    expect(settled.mock.calls).toEqual([[true]]);
  });
});

// UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, M2; acceptance A1 and A2 for a card of one
// comment): one checkbox, "Send to main", whose state can send by the session's port; ticked, the comment goes through
// `sendToSession` on the three routes and the host's place says where it went, "Sent to" only for a confirmed delivery.
describe('the checkbox and the one send path', () => {
  const KEY = { writer: 'maws/m', seq: 7 };
  const note = () => document.querySelector<HTMLElement>('[data-sent-note]');
  const pendingNote = () => document.querySelector<HTMLElement>('[data-pending-note]');
  const typeAndSend = (text: string) => {
    fireEvent.change(field(), { target: { value: text } });
    fireEvent.keyDown(field(), { key: 'Enter' });
  };
  function withTerminal() {
    useSessions.setState({ records: new Map([[PARENT, record(PARENT, { title: { text: 'Q3 plan', source: 'user' }, holder: { kind: 'terminal', pid: 42 } })]]), engine: new Map() });
    applyLaneAState(PARENT, laneAState(PARENT));
  }
  const LINK = { state: 'up' as const, refusal: null, carrier: 'direct' as const, member: 'm', clientClass: 'native-mac', rights: [] as string[], reason: null };
  function onStudio(id: AppSessionId, lane: 'A' | 'B') {
    useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'up', since: T0, generation: 0 }]);
    useSessions.setState({ listed: new Map([[id, { ...remoteRow(OTHER_MACHINE, lane === 'A' ? 'eng-r' : 'app-r', { lane, ...(lane === 'A' && { availability: 'foreign_held' }) }), appId: id }]]), listedMachines: new Set([OTHER_MACHINE]) });
    if (lane === 'B') useSessions.setState({ records: new Map([[id, record(id)]]) });
    else applyLaneAState(id, laneAState(id, { link: LINK, acts: [] }));
  }
  afterEach(() => vi.useRealTimers());

  it('starts unchecked, and again after a send of either kind; ticked when the surface asks for main', async () => {
    mount();
    pick();
    expect(box().checked).toBe(false);
    await userEvent.click(box());
    await userEvent.type(field(), 'Look here{Enter}');
    expect(card()).toBeNull();
    pick();
    expect(box().checked, 'the next card starts unchecked').toBe(false);
    act(() => openCommentComposer(ANCHOR, { appSessionId: PARENT, placement: cardPlacement(), destination: 'main' }));
    expect(box().checked).toBe(true);
  });

  it('ticked, the host’s place reads where the comment went for about four seconds, worded by the disposition', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mount();
    pick();
    await userEvent.click(box());
    await userEvent.type(field(), 'Look here{Enter}');
    expect(note()!.textContent).toBe('Sent to Q3 plan');
    expect(note()!.closest('[data-card-host]')).not.toBeNull();
    act(() => vi.advanceTimersByTime(SENT_NOTE_MS));
    expect(note()).toBeNull();

    const s = useSessions.getState();
    useSessions.setState({ engine: new Map(s.engine).set(PARENT, status(PARENT, { process: 'ready', turn: { id: 'e1', origin: 'human', startedAt: 'x', acceptedAt: 'x', userMessageUuids: [] } } as never)) });
    fake = fakeClient({ ...MAIN_SENDS, 'session.steer': { messageUuid: '11111111-1111-4111-8111-111111111111' } });
    window.maws = fake.client as unknown as PreloadBridge;
    pick();
    expect(titleOf(box())).toBe('Sends at the next step');
    await userEvent.click(box());
    await userEvent.type(field(), 'Look here{Enter}');
    expect(note()!.textContent).toBe('Sent to Q3 plan; read at the next step');

    withParent('ready');
    fake = fakeClient({ ...MAIN_SENDS, 'session.send': { messageUuid: null, disposition: 'queued', queueId: 'q1' } });
    window.maws = fake.client as unknown as PreloadBridge;
    pick();
    expect(titleOf(box())).toBe('Sent now');
    await userEvent.click(box());
    await userEvent.type(field(), 'Look here{Enter}');
    expect(note()!.textContent).toBe('Queued for Q3 plan; it sends when the queue resumes');
    expect(useNotices.getState().notices).toEqual([]); // the host's line, not a toast
  });

  it('a session on another machine: ticked and locked, its title saying side threads are not there yet', () => {
    const remote = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
    onStudio(remote, 'B');
    mount();
    act(() => openCommentComposer(ANCHOR, { appSessionId: remote, placement: cardPlacement() }));
    expect(box().checked).toBe(true);
    expect(box().disabled).toBe(true);
    expect(titleOf(box())).toBe('A side thread is not available on Studio yet');
  });

  // decision 6, the composer's answer: an archived session refuses both states. A ready process answers before the digest
  // (availabilityIn: the status may arrive before the digest that follows it, as after an unarchive's relaunch), so an
  // archived digest beside a ready status reads usable, for the composer and the card alike
  it.each(['thread', 'main'] as const)('an archived session, opened to %s: both states are off, Send is off, and the reason is a line under the field', async (destination) => {
    withParent('exited');
    act(() => useSessions.setState({ digests: new Map([[PARENT, digest(PARENT, { availability: 'archived' })]]) }));
    mount();
    act(() => openCommentComposer(ANCHOR, { appSessionId: PARENT, placement: cardPlacement(), destination }));
    await userEvent.type(field(), 'Look here');
    expect(box().checked).toBe(destination === 'main');
    expect(box().disabled).toBe(true);
    expect(titleOf(box())).toBe('Archived · unarchive it to continue');
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    expect(card()!.querySelector('[data-comment-unsendable]')!.textContent).toBe('Archived · unarchive it to continue');
  });

  it('an archived digest beside a ready process reads as the composer reads it: usable', () => {
    withParent('ready');
    act(() => useSessions.setState({ digests: new Map([[PARENT, digest(PARENT, { availability: 'archived' })]]) }));
    expect(availabilityIn(useSessions.getState(), PARENT)).toBe('usable');
    mount();
    pick();
    expect(box().disabled).toBe(false);
    expect(card()!.querySelector('[data-comment-unsendable]')).toBeNull();
  });

  // decision 6 by construction: the composer's submit table decides a session another process drives (a live bridge)
  // before an archived digest, so a terminal session with its bridge up sends from the card as from the composer
  it('an archived digest on a terminal session whose bridge is live, no ready process: the composer sends, and so does the card', async () => {
    withTerminal();
    act(() => useSessions.setState({ digests: new Map([[PARENT, digest(PARENT, { availability: 'archived' })]]) }));
    expect(availabilityIn(useSessions.getState(), PARENT)).toBe('archived');
    const composer = submitState({ status: null, intent: null, queue: { entries: [], paused: false }, empty: false, mode: 'send', availability: 'archived', heldBy: 'terminal · 42', driven: { running: false, send: { available: true }, stop: { available: true } } });
    expect(composer.enabled).toBe(true);
    fake = fakeClient({ 'side.comment.content': { content: BUILT }, 'laneA.send': { key: KEY, state: 'entered' } });
    window.maws = fake.client as unknown as PreloadBridge;
    mount();
    pick();
    expect(box().disabled).toBe(false);
    act(() => box().click());
    expect(card()!.querySelector('[data-comment-unsendable]')).toBeNull();
    typeAndSend('Look here');
    await vi.waitFor(() => expect(fake.invoked('laneA.send')).toHaveLength(1));
  });

  it('names the receiving session only when it is not the one the main area shows', () => {
    mount();
    pick();
    expect(card()!.querySelector('[data-card-parent]')!.textContent).toBe('Session: Q3 plan');
    act(() => useLayout.getState().openSession(PARENT));
    expect(card()!.querySelector('[data-card-parent]')).toBeNull();
  });

  // UX wave U5a (M3, §D): a refusal with no card open and the host still mounted reopens the card on the comment
  it('while the content and then the send are on their way: the field is off, a second Send does nothing, Close closes, and the answer still lands; a refusal after Close reopens the card with its reason', async () => {
    fake = fakeClient({ 'session.queue.list': { entries: [], paused: false } });
    window.maws = fake.client as unknown as PreloadBridge;
    mount();
    pick();
    await userEvent.click(box());
    await userEvent.type(field(), 'Look here{Enter}');
    expect(fake.pending('side.comment.content')).toBe(1);
    expect(field().disabled).toBe(true);
    expect(box().disabled, 'M3 (§D): the checkbox may change during a flight; it keeps the destination it set out with').toBe(false);
    fireEvent.keyDown(field(), { key: 'Enter' });
    await act(async () => {});
    expect(fake.invoked('side.comment.content')).toHaveLength(1);
    await act(() => fake.reply('side.comment.content', { content: BUILT }));
    await vi.waitFor(() => expect(fake.pending('session.send')).toBe(1));
    expect(field().disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(card()).toBeNull();
    await act(() => fake.reply('session.send', { messageUuid: null, disposition: 'sent', queueId: 'q0' }));
    expect(note()!.textContent).toBe('Sent to Q3 plan');
    expect(fake.invoked('session.send')).toHaveLength(1);

    pick();
    await userEvent.click(box());
    await userEvent.type(field(), 'Again{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(card()).toBeNull();
    await act(() => fake.fail('side.comment.content', 'comments.0.screenshot: not found', 'invalid_input'));
    expect(screen.getByRole('alert').textContent).toContain('comments.0.screenshot: not found');
    expect(field().value).toBe('Again');
    expect(useNotices.getState().notices).toEqual([]);
  });

  it('a start: the button reads Starting… while the send starts the session itself, with no acquisition of its own', async () => {
    withParent('exited');
    fake = fakeClient({ 'side.comment.content': { content: BUILT } });
    window.maws = fake.client as unknown as PreloadBridge;
    mount();
    pick();
    await userEvent.click(box());
    await userEvent.type(field(), 'Look here{Enter}');
    await vi.waitFor(() => expect(fake.invoked('session.acquire')).toEqual([{ appSessionId: PARENT_ID, reason: 'send' }])); // the port's, not the form's 'side'
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeTruthy();
  });

  describe('a terminal session’s hand-off that is not confirmed (decision 8)', () => {
    const OLD = { writer: 'maws/m', seq: 6 };
    beforeEach(() => {
      withTerminal();
      fake = fakeClient({ 'side.comment.content': { content: BUILT }, 'laneA.send': { key: KEY, state: 'submitted' } });
      window.maws = fake.client as unknown as PreloadBridge;
    });
    const fate = (...deliveries: { key: typeof KEY; state: 'submitted' | 'entered' | 'refused' | 'unconfirmed'; reason?: string }[]) =>
      act(() => applyLaneAState(PARENT, laneAState(PARENT, { deliveries: deliveries.map((d) => ({ at: T0, ...d })) })));

    it('lost posts: the comment leaves, the place shows the pending send’s state and not "Sent to", nothing is sent again; its entry turns the line into "Sent to", which leaves', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      mount();
      pick();
      expect(box().disabled).toBe(false); // a live bridge takes the words
      act(() => box().click());
      typeAndSend('Look here');
      await vi.waitFor(() => expect(pendingNote()).not.toBeNull());
      expect(card()).toBeNull();
      expect(pendingNote()!.textContent).toContain('Not confirmed yet in Q3 plan');
      expect(note()).toBeNull();
      act(() => vi.advanceTimersByTime(120_000));
      expect(pendingNote()).not.toBeNull();
      expect(fake.invoked('laneA.send')).toHaveLength(1);
      fate({ key: KEY, state: 'entered' });
      expect(note()!.textContent).toBe('Sent to Q3 plan');
      expect(pendingNote()).toBeNull();
      act(() => vi.advanceTimersByTime(SENT_NOTE_MS));
      expect(note()).toBeNull();
    });

    it('a late refusal with the composer hidden: the line says it and stays; Show brings the session’s tab, whose strip holds the text; nothing was sent again', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      mount();
      pick();
      act(() => box().click());
      typeAndSend('Look here');
      await vi.waitFor(() => expect(pendingNote()).not.toBeNull());
      expect(shownSession()).not.toBe(PARENT);
      fate({ key: KEY, state: 'refused', reason: 'The terminal closed' });
      act(() => vi.advanceTimersByTime(120_000));
      expect(pendingNote()!.textContent).toContain('Not entered in Q3 plan: The terminal closed');
      act(() => screen.getByRole('button', { name: 'Show' }).click());
      expect(shownSession()).toBe(PARENT);
      render(<PendingSends appSessionId={PARENT} />);
      expect(screen.getByRole('list', { name: 'Messages not confirmed yet' }).textContent).toContain('the built message');
      expect(fake.invoked('laneA.send')).toHaveLength(1);
    });

    it('follows the pending send of its own key, not another of the same text', async () => {
      holdPendingSend(PARENT, OLD, 'the built message');
      mount();
      pick();
      act(() => box().click());
      typeAndSend('Look here');
      await vi.waitFor(() => expect(pendingNote()).not.toBeNull());
      expect(useLaneA.getState().pendingSends.get(PARENT)!.map((p) => p.key)).toEqual([OLD, KEY]);
      fate({ key: OLD, state: 'refused', reason: 'Too busy' }, { key: KEY, state: 'submitted' });
      expect(pendingNote()!.textContent).toContain('Not confirmed yet in Q3 plan');
      fate({ key: OLD, state: 'entered' }, { key: KEY, state: 'unconfirmed' });
      expect(pendingNote()!.textContent).toContain('May not have arrived in Q3 plan');
      expect(note()).toBeNull();
    });

    it('an unconfirmed answer with no key is a refused send, and the comment stays', async () => {
      fake = fakeClient({ 'side.comment.content': { content: BUILT }, 'laneA.send': { key: null, state: 'submitted' } });
      window.maws = fake.client as unknown as PreloadBridge;
      mount();
      pick();
      act(() => box().click());
      typeAndSend('Look here');
      await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toContain('The session did not confirm the message'));
      expect(card()).not.toBeNull();
      expect(field().value).toBe('Look here');
      expect(pendingNote()).toBeNull();
    });
  });

  it('a route with no room for screenshots: no thumbnail and no Remove, and the left-out line under the checkbox row', () => {
    const remote = addressOf(OTHER_MACHINE, 'eng-r' as AppSessionId);
    onStudio(remote, 'A');
    mount();
    const screenshot = { path: '/user-data/browser/crops/one.png', width: 640, height: 480 };
    act(() => openCommentComposer({ ...ANCHOR, screenshot }, { appSessionId: remote, placement: cardPlacement() }));
    expect(box().checked).toBe(true); // locked: no side thread on another machine yet
    expect(screen.queryByText('Screenshot · 640 × 480')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove screenshot' })).toBeNull();
    const line = card()!.querySelector<HTMLElement>('[data-left-out]')!;
    expect(line.textContent).toBe('1 screenshot is left out: Attachments to a session on another machine wait for uploads across machines');
    const row = box().closest('[data-send-row]')!;
    expect(row.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
