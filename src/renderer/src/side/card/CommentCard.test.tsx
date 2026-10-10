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
import { deliverableUrl } from '@shared/maws/deliverable';
import { digest, record, status } from '../../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { useNotices } from '../../stores/notices';
import { useSessions } from '../../stores/sessions';
import { resetShellStores } from '../../test-support/shell-stores';
import { openCommentComposer, registerCommentComposer, type CommentPlacement } from '../../tools/code/anchor/anchor';
import { CommentComposerHost, useCommentComposer } from '../CommentComposer';
import { openComment } from '../register';
import { CommentCardHost, type CardFrame } from './CardHost';
import { useCommentCard } from './store';

const PARENT = 'a1111111-1111-4111-8111-111111111111' as AppSessionId;
const RECORD = '00000000-0000-4000-8000-000000000001';
const ANCHOR: Anchor = { kind: 'artifact-element', locator: '#hero', label: 'Dashboard v1 › h1#hero “Sales overview”', pageUrl: deliverableUrl(PARENT, RECORD, 1) };
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
  useSessions.setState({ records: new Map([[PARENT, record(PARENT)]]), engine: new Map([[PARENT, status(PARENT, { process } as never)]]), recordsVersion: s.recordsVersion + 1 });
}

beforeEach(() => {
  resetShellStores();
  useNotices.setState({ notices: [] });
  fake = fakeClient({ 'side.sendToMain': { messageUuid: null, disposition: 'sent' } });
  window.maws = fake.client;
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

const cardPlacement = (over: Partial<Extract<CommentPlacement, { kind: 'card' }>> = {}): CommentPlacement => ({ kind: 'card', host: 'deliverable', hostId: 'h1', rect: RECT, ...over });

function mount(layout: 'anchored' | 'docked' = 'anchored') {
  return render(
    <>
      <CommentComposerHost />
      <div className="relative">
        <CommentCardHost hostId="h1" host="deliverable" mode="panel" layout={layout} accepts={() => true} frame={FRAME} visible restoreFocus={restoreFocus} />
      </div>
    </>,
  );
}

const pick = (anchor: Anchor = ANCHOR, placement: CommentPlacement = cardPlacement()) => act(() => openCommentComposer(anchor, { appSessionId: PARENT, placement }));
const card = () => document.querySelector<HTMLElement>('[data-comment-card]');
const field = () => screen.getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement;

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

  // P2-F L148: the strip clips (its half-column cap) and gives the card 8 px of margin, where the floating shadow's 24 and
  // 64 px blurs were trimmed at the sides and bottom; in the strip the card is in flow, so it takes the in-flow card's
  // shadow (the composer's), whose visible layer lies within the margin. Anchored and docked over a frame, it floats.
  it('in the strip the card casts the in-flow shadow, which fits its margin; over a frame the floating one', () => {
    mount('docked');
    pick();
    expect(card()!.className).toContain('shadow-composer');
    expect(card()!.className).not.toContain('shadow-float');
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
  it('names the anchor, takes focus, defaults to Side thread, and keeps the sheet’s accessible form', async () => {
    mount();
    pick();
    expect(screen.getByRole('dialog', { name: `Comment on ${ANCHOR.label}` })).toBe(card());
    expect(card()!.getAttribute('aria-modal')).toBeNull(); // non-modal: the page stays readable and clickable
    expect(screen.getByRole('heading', { name: ANCHOR.label }).getAttribute('title')).toBe(`${ANCHOR.label}\n${ANCHOR.locator}`);
    expect(document.activeElement).toBe(field());
    expect((screen.getByRole('radio', { name: 'Side thread' }) as HTMLInputElement).checked).toBe(true);
    expect(card()!.querySelector('[data-destination="thread"]')).not.toBeNull();
    expect(card()!.querySelector('[data-destination="main"]')).not.toBeNull();
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await userEvent.type(field(), 'Bigger');
    expect(send.disabled).toBe(false);
  });

  // P2-A (2026-10-09; its execution document §5.6, through the shared form): Send to main is offered for every parent
  // the Send can start; one a terminal holds says why
  it('Send to main stays enabled for an exited parent, saying it starts the session; disabled with the reason while a terminal holds it', () => {
    withParent('exited');
    mount();
    pick();
    const main = () => screen.getByRole('radio', { name: 'Send to main' }) as HTMLInputElement;
    const caption = () => card()!.querySelector('[data-destination="main"]')!.getAttribute('title');
    expect(main().disabled).toBe(false);
    expect(caption()).toBe('Starts this session');
    act(() => useSessions.setState((s) => ({ records: new Map([[PARENT, { ...record(PARENT), holder: { kind: 'terminal', pid: 42 } }]]), digests: new Map(s.digests).set(PARENT, digest(PARENT, { availability: 'foreign_held' })) })));
    expect(main().disabled).toBe(true);
    expect(caption()).toBe('Held by terminal · 42');
  });

  it('Side thread sends exactly the sheet’s side.thread.open for the same anchor and text; Enter sends, Shift+Enter breaks, a composition’s Enter does not', async () => {
    fake = fakeClient();
    window.maws = fake.client;
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
    expect(fromCard).toEqual({ appSessionId: PARENT, from: { kind: 'comment', anchor: ANCHOR, text: 'Line one\nline two', screenshot: null } });
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeTruthy();
    expect(field().disabled).toBe(true);
  });

  it('a refused Side thread stays in the card with Retry and Send to main instead', async () => {
    fake = fakeClient();
    window.maws = fake.client;
    mount();
    pick();
    await userEvent.type(field(), 'Why?{Enter}');
    await act(() => fake.reply('side.thread.open', { status: 'refused', appSessionId: 'b2222222-2222-4222-8222-222222222222', reason: 'no_engine_session', message: 'This session has not started yet' }));
    expect(card()).not.toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('This session has not started yet');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send to main instead' })).toBeTruthy();
  });

  it('Send to main sends exactly the sheet’s side.sendToMain, then closes the card and gives focus back', async () => {
    mount();
    act(() => openCommentComposer(ANCHOR, { appSessionId: PARENT }));
    await userEvent.click(screen.getByRole('radio', { name: /Send to main/ }));
    await userEvent.type(field(), 'Look here{Enter}');
    expect(document.querySelector('[data-comment-composer]')).toBeNull();

    pick();
    await userEvent.click(screen.getByRole('radio', { name: 'Send to main' }));
    await userEvent.type(field(), 'Look here');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    const [sheet, fromCard] = fake.invoked('side.sendToMain');
    expect(fromCard).toEqual(sheet);
    expect(fromCard).toEqual({ appSessionId: PARENT, anchor: ANCHOR, text: 'Look here', screenshot: null });
    expect(card()).toBeNull();
    expect(useCommentCard.getState().open).toBeNull();
    expect(restoreFocus).toHaveBeenCalledTimes(1);
  });

  it('shows a producer’s screenshot as the thumbnail, removable, and sends it as its own field', async () => {
    mount();
    const screenshot = { path: '/user-data/captures/one.png', width: 640, height: 480 };
    pick({ ...ANCHOR, screenshot });
    expect(screen.getByText('Screenshot · 640 × 480')).toBeTruthy();
    await userEvent.click(screen.getByRole('radio', { name: 'Send to main' }));
    await userEvent.type(field(), 'Here{Enter}');
    expect(fake.invoked('side.sendToMain')).toEqual([{ appSessionId: PARENT, anchor: ANCHOR, text: 'Here', screenshot }]);

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

  it('one card per window: a new pick replaces the open card and its draft', async () => {
    mount();
    pick();
    await userEvent.type(field(), 'Draft');
    const first = useCommentCard.getState().open!.serial;
    pick({ ...ANCHOR, locator: 'p.lead', label: 'Dashboard v1 › p.lead' });
    expect(useCommentCard.getState().open!.serial).not.toBe(first);
    expect(document.querySelectorAll('[data-comment-card]')).toHaveLength(1);
    expect(card()!.dataset.anchorLocator).toBe('p.lead');
    expect(field().value).toBe('');
  });

  it('a refusal arriving after the card closed mid-send is a toast with its reason', async () => {
    fake = fakeClient();
    window.maws = fake.client;
    mount();
    pick();
    await userEvent.type(field(), 'Why?{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await act(() => fake.reply('side.thread.open', { status: 'refused', appSessionId: 'b2222222-2222-4222-8222-222222222222', reason: 'unknown_session', message: 'The session is gone' }));
    expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['The comment was not sent: The session is gone']);
  });

  it('its host unmounting closes it, though StrictMode’s effect replay does not', async () => {
    pick(); // open before the host mounts, so the replay's cleanup meets it
    const { unmount } = render(
      <StrictMode>
        <CommentCardHost hostId="h1" host="deliverable" mode="panel" layout="anchored" accepts={() => true} frame={FRAME} visible />
      </StrictMode>,
    );
    await act(async () => {});
    expect(card()).not.toBeNull();
    unmount();
    await act(async () => {});
    expect(useCommentCard.getState().open).toBeNull();
  });
});
