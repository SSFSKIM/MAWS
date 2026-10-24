// P4-B2 (D16 of docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md; the P4 spec's §2 item 2; the prior art's V1 to
// V9 and V11 to V13) under happy-dom: a deck's pins and their popover. A pin per commented element of the shown slide in
// slide order; a press opens its popover placed by the card's placement against the frame, the newest thread's reply
// field focused, no rail; one at a time; the open pin, Escape and a press on the empty stage close it, the press
// consumed and the keyboard back on the pin; a press outside the frame closes it and goes on; the drafts the rail's
// too; a scroll re-places it in its handler and hides it with its pin off the stage; the last resolve, a deletion and
// another slide close it on their own; the rail's Show opens it; the compose card stands at the pin, hidden under a
// popover; ⌥⌘M and ⌥⌘⇧J. happy-dom lays nothing out: the stage's nodes get the boxes their own px style says (the
// comments suite's fake layout), and the frame, the stage and the pins the rects stubbed below.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import type { CommentOverlayProps, CommentedPassage, DocumentComments } from '../../../document/editor/comments/surface';
import { newDoc, transact, type Doc } from '../../../yjs';
import { deleteElementTree, importSlide, setStyle, setText, writeDeckKeys } from '../../model';
import { loadSlide } from '../../parse';
import { addThread, getThread, listThreads, reply, resolve } from '../../threads';
import { DeckEditor } from '../DeckEditor';
import { DeckSession } from '../session';

const S1 = `<section id="s1" style="background:#ffffff; padding:128px">
<h2 id="title" style="position:absolute; left:100px; top:100px; width:600px; height:100px">Plan</h2>
<p id="body" style="position:absolute; left:300px; top:400px; width:400px; height:100px">One path</p>
</section>`;
const S2 = `<section id="s2" style="background:#ffffff"><p id="lead" style="position:absolute; left:200px; top:300px; width:300px; height:60px">Second</p></section>`;

function deck(): Doc {
  const doc = newDoc();
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'Q3', order: ['s1', 's2'] });
    [S1, S2].forEach((html, i) => {
      const l = loadSlide(html);
      if (!l.ok) throw new Error(l.held.reasons.join('; '));
      importSlide(doc, l.slide, `a${i}`);
    });
  });
  return doc;
}

/** A surface as the renderer's with the draft rule: what it was handed, the overlay's latest reach, its draft. */
function surface() {
  const opened: CommentedPassage[] = [];
  const reach: { current: CommentOverlayProps | null } = { current: null };
  const kept: { current: string | null } = { current: null };
  const focusDraft = vi.fn();
  const value: DocumentComments = {
    opened: (passage) => opened.push(passage),
    overlay: (props) => {
      reach.current = props;
      // the compose card's field, focusable as the real card's is (its blur would discard an empty card)
      return (
        <div data-card-host>
          <textarea aria-label="Compose" />
        </div>
      );
    },
    draft: () => kept.current,
    focusDraft,
  };
  return { value, opened, reach, kept, focusDraft };
}

/** Every stage node a box from its own px style (the comments suite's way); read live, so a move moves it. */
function fakeLayout(container: HTMLElement): void {
  const root = container.querySelector<HTMLElement>('[data-stage-slide] .maws-slide')!;
  const px = (n: HTMLElement, k: string) => Number.parseFloat(n.style.getPropertyValue(k)) || 0;
  for (const n of root.querySelectorAll<HTMLElement>('[data-eid]')) {
    Object.defineProperty(n, 'offsetLeft', { configurable: true, get: () => px(n, 'left') });
    Object.defineProperty(n, 'offsetTop', { configurable: true, get: () => px(n, 'top') });
    Object.defineProperty(n, 'offsetWidth', { configurable: true, get: () => px(n, 'width') });
    Object.defineProperty(n, 'offsetHeight', { configurable: true, get: () => px(n, 'height') });
    Object.defineProperty(n, 'offsetParent', { configurable: true, get: () => root });
  }
  Object.defineProperty(root, 'offsetWidth', { configurable: true, get: () => 1920 });
  Object.defineProperty(root, 'offsetHeight', { configurable: true, get: () => 1080 });
}

// The frame and the stage at the window's top-left, 1000 × 800; a pin where its style puts it on the stage, less the
// stage's scroll, its 20 px box above its element's corner (comments.css's margin).
const scroll = { left: 0, top: 0 };
const drawnAt = { zoom: 0.5 }; // the stage's zoom, as the stubbed rects draw the elements
let rects: MockInstance | null = null;
const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
function fakeRects(container: HTMLElement): void {
  const frame = container.querySelector<HTMLElement>('.deck-comment-frame')!;
  const stage = container.querySelector<HTMLElement>('[data-stage-surface]')!;
  Object.defineProperty(frame, 'clientWidth', { configurable: true, get: () => 1000 });
  Object.defineProperty(frame, 'clientHeight', { configurable: true, get: () => 800 });
  rects = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this === frame || this === stage) return box(0, 0, 1000, 800);
    if (this instanceof HTMLElement && this.classList.contains('deck-comment-pin')) {
      return box(Number.parseFloat(this.style.left) + 2 - scroll.left, Number.parseFloat(this.style.top) - 20 - scroll.top, 20, 20);
    }
    // a stage element as drawn at the zoom (its layout box, the fake layout's), less the stage's scroll
    if (this instanceof HTMLElement && this.dataset.eid !== undefined) {
      const z = drawnAt.zoom;
      return box(this.offsetLeft * z - scroll.left, this.offsetTop * z - scroll.top, this.offsetWidth * z, this.offsetHeight * z);
    }
    return box(0, 0, 0, 0);
  });
}

beforeEach(() => {
  scroll.left = 0;
  scroll.top = 0;
  drawnAt.zoom = 0.5;
});
afterEach(() => {
  cleanup();
  rects?.mockRestore();
  rects = null;
});
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 80))); // the rail's quiet moment
const HUMAN = { kind: 'human' } as const;
const AGENT = { kind: 'session', appSessionId: 'a1111111-1111-4111-8111-111111111111' } as Actor;

async function mount({ readOnly = false } = {}) {
  const doc = deck();
  addThread(doc, { threadId: 'tb1', slideId: 's1', elementId: 'body', quote: 'One path', by: AGENT, at: 10, body: 'Too long?' });
  addThread(doc, { threadId: 'tb2', slideId: 's1', elementId: 'body', quote: 'One path', by: HUMAN, at: 20, body: 'Cut the second half.' });
  addThread(doc, { threadId: 'tt', slideId: 's1', elementId: 'title', quote: 'Plan', by: AGENT, at: 30, body: 'A verb?' });
  addThread(doc, { threadId: 'tl', slideId: 's2', elementId: 'lead', quote: 'Second', by: AGENT, at: 40, body: 'Numbers here.' });
  const session = new DeckSession(doc, 0);
  const s = surface();
  let clock = 1_000;
  const utils = render(<DeckEditor session={session} assetUrl={() => null} system={null} readOnly={readOnly} comments={s.value} commentAuthor={{ actor: HUMAN, now: () => clock++ }} />);
  fakeLayout(utils.container);
  fakeRects(utils.container);
  act(() => session.setZoom(0.5));
  await settle();
  const pin = (elementId: string) => utils.container.querySelector<HTMLElement>(`[data-comment-pin="${elementId}"]`);
  const stage = utils.container.querySelector<HTMLElement>('[data-stage-surface]')!;
  return { doc, session, surface: s, pin, stage, toolbar: screen.getByRole('toolbar'), ...utils };
}
const popover = () => document.querySelector<HTMLElement>('[data-pin-popover]');
const dialog = (quote: string) => screen.getByRole('dialog', { name: `Comments on “${quote}”` });
const card = (id: string) => popover()!.querySelector<HTMLElement>(`[data-thread="${id}"]`)!;
const field = (id: string) => within(card(id)).getByRole('textbox', { name: 'Reply' }) as HTMLTextAreaElement;
const press = (target: Element, init: PointerEventInit = {}) => fireEvent.pointerDown(target, { button: 0, pointerId: 1, ...init });

describe('the pins (V1, V13)', () => {
  it('pins each commented element of the shown slide at its top-right, counted past one, in slide order, none expanded', async () => {
    const { pin, container } = await mount();
    const pins = [...container.querySelectorAll<HTMLElement>('.deck-comment-pin')];
    expect(pins.map((p) => p.dataset.commentPin)).toEqual(['title', 'body']); // the slide's order, not the threads'
    expect(pins.map((p) => p.textContent)).toEqual(['', '2']);
    expect([pin('body')!.style.left, pin('body')!.style.top]).toEqual([`${(300 + 400) * 0.5}px`, `${400 * 0.5}px`]);
    expect(pins.map((p) => [p.getAttribute('aria-expanded'), p.getAttribute('aria-haspopup')])).toEqual([
      ['false', 'dialog'],
      ['false', 'dialog'],
    ]);
    expect(pin('lead')).toBeNull(); // slide 2's
  });

  // fix wave: a quote is derived from its element, so a republish of the element's text writes nothing to the threads
  it('a pin’s name and its open popover’s follow its element’s text, which changes with no write to the threads', async () => {
    const { doc, pin } = await mount();
    expect(pin('title')!.getAttribute('aria-label')).toBe('Comment on “Plan”');
    fireEvent.click(pin('title')!);
    act(() => setText(doc, 's1', 'title', [{ type: 'p', inline: [{ text: 'Plan B', marks: {} }] }]));
    await settle();
    expect(pin('title')!.getAttribute('aria-label')).toBe('Comment on “Plan B”');
    expect(dialog('Plan B')).toBeTruthy();
  });
});

describe('opening (V2, V3)', () => {
  it('a press on a pin opens its popover at the pin, the newest thread active with its reply field focused; no rail opens', async () => {
    const { pin, session } = await mount();
    fireEvent.click(pin('body')!);
    const open = dialog('One path');
    expect(open.dataset.placement).toBe('below');
    // the pin's rect (352, 180, 20 × 20) → placeCard in the 1000 × 800 frame: at its left, 4 px under its bottom
    expect([open.style.left, open.style.top, open.style.width]).toEqual(['352px', '204px', '300px']);
    expect(within(open).getAllByRole('group').map((g) => g.dataset.thread)).toEqual(['tb1', 'tb2']);
    expect(card('tb2').getAttribute('aria-current')).toBe('true');
    expect(document.activeElement).toBe(field('tb2'));
    expect(pin('body')!.getAttribute('aria-expanded')).toBe('true');
    expect(session.snapshot().rail).toBeNull();
    // the compose card's host stays mounted, hidden
    expect(document.querySelector('[data-card-slot="hidden"] [data-card-host]')).not.toBeNull();
  });

  it('one at a time: a press on another pin switches to it', async () => {
    const { pin } = await mount();
    fireEvent.click(pin('body')!);
    fireEvent.click(pin('title')!);
    expect(document.querySelectorAll('[data-pin-popover]')).toHaveLength(1);
    expect(dialog('Plan')).toBeTruthy();
    expect(document.activeElement).toBe(field('tt'));
    expect([pin('body')!.getAttribute('aria-expanded'), pin('title')!.getAttribute('aria-expanded')]).toEqual(['false', 'true']);
  });

  it('Enter on a focused pin opens it (a button)', async () => {
    const { pin } = await mount();
    act(() => pin('title')!.focus());
    fireEvent.click(pin('title')!); // Enter on a button is its click
    expect(dialog('Plan')).toBeTruthy();
  });
});

describe('closing (V4) and the drafts (V5)', () => {
  it('a press on the open pin closes it, the keyboard on the pin', async () => {
    const { pin } = await mount();
    fireEvent.click(pin('body')!);
    fireEvent.click(pin('body')!);
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(pin('body'));
  });

  it('Escape in the reply field closes it and keeps the draft; reopening restores it, and the rail’s field shows it too', async () => {
    const { pin, toolbar } = await mount();
    fireEvent.click(pin('body')!);
    fireEvent.change(field('tb2'), { target: { value: 'Shorter?' } });
    fireEvent.keyDown(field('tb2'), { key: 'Escape' });
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(pin('body'));
    fireEvent.click(pin('body')!);
    expect(field('tb2').value).toBe('Shorter?');
    fireEvent.click(within(toolbar).getByRole('button', { name: /^Comments/ }));
    await settle();
    const rail = screen.getByRole('complementary', { name: 'Comments' });
    const railField = within(rail.querySelector<HTMLElement>('article[data-thread="tb2"]')!).getByRole('textbox', { name: 'Reply' }) as HTMLTextAreaElement;
    expect(railField.value).toBe('Shorter?');
    press(railField); // outside the frame: the popover closes
    expect(popover()).toBeNull();
    fireEvent.change(railField, { target: { value: 'Shorter, please.' } });
    fireEvent.click(pin('body')!);
    expect(field('tb2').value).toBe('Shorter, please.');
  });

  it('a press on the empty stage closes it and is consumed: nothing selected, the keyboard on the pin', async () => {
    const { pin, stage, session } = await mount();
    act(() => session.select(['title']));
    fireEvent.click(pin('body')!);
    const seen = vi.fn();
    stage.addEventListener('pointerdown', seen);
    press(stage, { clientX: 900, clientY: 700 });
    fireEvent.pointerUp(stage, { button: 0, pointerId: 1, clientX: 900, clientY: 700 });
    expect(popover()).toBeNull();
    expect(seen).not.toHaveBeenCalled(); // the stage's overlay never saw it
    expect(session.snapshot().selection).toEqual(['title']);
    expect(document.activeElement).toBe(pin('body'));
    // with no popover open, the same press is the stage's again
    press(stage, { clientX: 900, clientY: 700 });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('Escape on the stage closes it before the stage’s own Escape; an input method’s Escape is the input method’s', async () => {
    const { pin, stage, session } = await mount();
    fireEvent.click(pin('body')!);
    fireEvent.keyDown(stage, { key: 'Escape', isComposing: true });
    expect(popover()).not.toBeNull();
    act(() => session.select(['title']));
    fireEvent.keyDown(stage, { key: 'Escape' });
    expect(popover()).toBeNull();
    expect(session.snapshot().selection).toEqual(['title']); // the stage's Escape would have stepped out
    expect(document.activeElement).toBe(pin('body'));
  });

  it('a press outside the frame closes it and goes on', async () => {
    const { pin, toolbar } = await mount();
    fireEvent.click(pin('body')!);
    const zoom = within(toolbar).getAllByRole('button')[0]!;
    const seen = vi.fn((e: Event) => e.defaultPrevented);
    zoom.addEventListener('pointerdown', seen);
    press(zoom);
    expect(popover()).toBeNull();
    expect(seen).toHaveReturnedWith(false);
  });
});

describe('following its pin (V6)', () => {
  it('a scroll of the stage re-places it inside the scroll’s own handler, and hides it while its pin is off the stage', async () => {
    const { pin, stage } = await mount();
    fireEvent.click(pin('body')!);
    scroll.top = 100;
    stage.dispatchEvent(new Event('scroll')); // no await: placed in the handler, not a frame later
    expect(dialog('One path').style.top).toBe('104px');
    scroll.top = 400; // the pin's centre above the stage's top
    stage.dispatchEvent(new Event('scroll'));
    expect(popover()!.style.visibility).toBe('hidden');
    scroll.top = 0;
    stage.dispatchEvent(new Event('scroll'));
    expect(popover()!.style.visibility).toBe('');
    expect(dialog('One path').style.top).toBe('204px');
  });

  it('a zoom re-places it with its pin', async () => {
    const { pin, session } = await mount();
    fireEvent.click(pin('body')!);
    act(() => session.setZoom(0.25));
    await settle();
    expect([pin('body')!.style.left, pin('body')!.style.top]).toEqual([`${700 * 0.25}px`, `${400 * 0.25}px`]);
    expect([dialog('One path').style.left, dialog('One path').style.top]).toEqual([`${175 + 2}px`, `${100 + 4}px`]);
  });
});

describe('its threads (V7)', () => {
  it('J and K move between them; an agent’s reply or new thread on the element moves nothing; E resolves', async () => {
    const { pin, doc } = await mount();
    fireEvent.click(pin('body')!);
    fireEvent.keyDown(card('tb2'), { key: 'k' });
    expect(card('tb1').getAttribute('aria-current')).toBe('true');
    act(() => reply(doc, 'tb2', { id: 'tb2:r', by: AGENT, at: 50, body: 'Done.' }, 'remote'));
    act(() => addThread(doc, { threadId: 'tb3', slideId: 's1', elementId: 'body', quote: 'One path', by: AGENT, at: 60, body: 'Also the colour.' }, 'remote'));
    expect(within(popover()!).getAllByRole('group').map((g) => g.dataset.thread)).toEqual(['tb1', 'tb2', 'tb3']);
    expect(card('tb1').getAttribute('aria-current')).toBe('true');
    expect(document.activeElement).toBe(card('tb1'));
    fireEvent.keyDown(card('tb1'), { key: 'e' });
    expect(getThread(doc, 'tb1')!.status).toBe('resolved');
    expect(within(popover()!).getAllByRole('group').map((g) => g.dataset.thread)).toEqual(['tb2', 'tb3']);
    // R and a reply typed: the thread's next message, from the human, outside undo
    fireEvent.change(field('tb3'), { target: { value: 'Agreed' } });
    fireEvent.keyDown(field('tb3'), { key: 'Enter' });
    expect(getThread(doc, 'tb3')!.messages.map((m) => [m.body, m.by.kind])).toEqual([
      ['Also the colour.', 'session'],
      ['Agreed', 'human'],
    ]);
  });
});

describe('closing on its own (V8, V9)', () => {
  it('resolving the last thread closes it and removes the pin; reopening from the rail brings the pin back', async () => {
    const { pin, toolbar } = await mount();
    fireEvent.click(pin('title')!);
    fireEvent.click(within(card('tt')).getByRole('button', { name: 'Resolve' }));
    expect(popover()).toBeNull();
    await settle();
    expect(pin('title')).toBeNull();
    fireEvent.click(within(toolbar).getByRole('button', { name: /^Comments/ }));
    await settle();
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Comments' }).querySelector<HTMLElement>('article[data-thread="tt"]')!).getByRole('button', { name: 'Reopen' }));
    await settle();
    expect(pin('title')).not.toBeNull();
  });

  it('deleting the element closes it and keeps its threads open as orphans, the draft kept; undo brings the pin back', async () => {
    const { pin, doc, session, toolbar } = await mount();
    fireEvent.click(pin('body')!);
    fireEvent.change(field('tb2'), { target: { value: 'Keep me' } });
    act(() => session.edit((origin) => deleteElementTree(doc, 's1', 'body', origin)));
    expect(popover()).toBeNull();
    await settle();
    expect(pin('body')).toBeNull();
    fireEvent.click(within(toolbar).getByRole('button', { name: /^Comments/ }));
    await settle();
    const rail = screen.getByRole('complementary', { name: 'Comments' });
    expect(rail.querySelector('article[data-thread="tb2"]')).toBeNull();
    fireEvent.click(within(rail).getByRole('button', { name: 'Show deleted-target comments' }));
    expect(rail.querySelector('article[data-thread="tb2"]')!.hasAttribute('data-orphan')).toBe(true);
    act(() => session.undoStep());
    fakeLayout(document.body);
    await settle();
    expect(pin('body')).not.toBeNull();
    fireEvent.click(pin('body')!);
    expect(field('tb2').value).toBe('Keep me');
  });

  it('another slide shown closes it', async () => {
    const { pin, session } = await mount();
    fireEvent.click(pin('body')!);
    act(() => session.show('s2'));
    expect(popover()).toBeNull();
  });
});

describe('the rail’s Show (V11)', () => {
  it('shows the thread’s slide and opens its pin’s popover on that thread; the rail stays open', async () => {
    const { session, toolbar, container } = await mount();
    fireEvent.click(within(toolbar).getByRole('button', { name: /^Comments/ }));
    await settle();
    const rail = screen.getByRole('complementary', { name: 'Comments' });
    fireEvent.click(within(rail).getByRole('button', { name: 'Show element: Second' }));
    expect(session.snapshot().currentSlide).toBe('s2');
    expect(card('tl').getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('complementary', { name: 'Comments' })).toBe(rail);
    // placed once slide 2's pin is drawn
    fakeLayout(container);
    await settle();
    act(() => session.setZoom(0.5)); // a layout pass of the new slide's canvas, as its first drawing gives
    await settle();
    expect(container.querySelector('[data-comment-pin="lead"]')).not.toBeNull();
    expect(dialog('Second').style.visibility).toBe('');
    // the earlier of a pin's two threads shown from the rail: the popover opens on it, not on the newest
    fireEvent.click(within(rail.querySelector<HTMLElement>('article[data-thread="tb1"]')!).getByRole('button', { name: 'Show element: One path' }));
    expect(session.snapshot().currentSlide).toBe('s1');
    expect(card('tb1').getAttribute('aria-current')).toBe('true');
    expect(rail.querySelector('article[data-thread="tb1"]')!.getAttribute('aria-current')).toBe('true');
  });
});

describe('the compose card and the keys (V12)', () => {
  it('Comment closes the popover; ⌥⌘M too; the card’s thread on a pin of its own is the card’s, revealed and focused', async () => {
    const { pin, session, toolbar, surface: s, stage, doc } = await mount();
    fireEvent.click(pin('title')!);
    act(() => session.select(['title']));
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Add comment' }));
    expect(popover()).toBeNull();
    const id = s.opened.at(-1)!.threadId;
    expect(document.querySelector('[data-card-slot="hidden"]')).toBeNull();
    // the card's host reports the thread it is on; its pin's only other thread is the agent's, so the popover lists that
    act(() => s.reach.current!.hosting!(id));
    fireEvent.click(pin('title')!);
    expect(within(popover()!).getAllByRole('group').map((g) => g.dataset.thread)).toEqual(['tt']);
    // ⌥⌘M with it open: closed, and (no draft kept, one element selected) a new comment
    fireEvent.keyDown(stage, { key: 'µ', code: 'KeyM', altKey: true, metaKey: true });
    expect(popover()).toBeNull();
    expect(listThreads(doc).filter((t) => t.elementId === 'title')).toHaveLength(3);
  });

  it('a pin whose only open thread is the compose card’s reveals and focuses the card', async () => {
    const { session, toolbar, surface: s, pin, container } = await mount();
    act(() => session.select(['body']));
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Add comment' }));
    const id = s.opened.at(-1)!.threadId;
    act(() => s.reach.current!.hosting!(id));
    // the body's two other threads resolved elsewhere: only the card's is open on it
    act(() => ['tb1', 'tb2'].forEach((t) => resolve(session.doc, t, AGENT, 1, 'remote')));
    await settle();
    fakeLayout(container);
    // the card's empty field has the keyboard: the pin's press must not take it (a blur would discard the card) before
    // the card is revealed and focused (the review's P2)
    const compose = screen.getByRole('textbox', { name: 'Compose' });
    act(() => compose.focus());
    const blurred = vi.fn();
    compose.addEventListener('blur', blurred);
    await userEvent.click(pin('body')!);
    expect(popover()).toBeNull();
    expect(s.focusDraft).toHaveBeenCalledTimes(1);
    expect(blurred).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(compose);
  });

  it('a pointer press on a pin moves no focus by itself: the popover’s field takes it on opening, the pin on closing', async () => {
    const { pin } = await mount();
    await userEvent.click(pin('body')!);
    expect(document.activeElement).toBe(field('tb2'));
    await userEvent.click(pin('body')!);
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(pin('body'));
  });

  it('Comment refocuses a kept draft instead of writing a second thread', async () => {
    const { session, toolbar, surface: s, doc } = await mount();
    s.kept.current = 'tb1';
    act(() => session.select(['title']));
    const before = listThreads(doc).length;
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Add comment' }));
    expect(listThreads(doc)).toHaveLength(before);
    expect(s.focusDraft).toHaveBeenCalledTimes(1);
  });

  it('the card stands at its thread’s pin, read from the element as drawn, so it is there with the element’s move and with the pins hidden', async () => {
    const { session, toolbar, surface: s, pin, doc, stage } = await mount();
    act(() => session.select(['body']));
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Add comment' }));
    const id = s.opened.at(-1)!.threadId;
    await settle();
    // the body's pin is drawn at (352, 180, 20 × 20): the card's locate answers the same rect
    const drawn = pin('body')!.getBoundingClientRect();
    expect(s.reach.current!.locate(id)).toEqual({ x: drawn.left, y: drawn.top, width: 20, height: 20 });
    expect(s.reach.current!.locate(id)).toEqual({ x: 352, y: 180, width: 20, height: 20 });
    // moved: where its pin goes, in the same pass
    act(() => setStyle(doc, 's1', 'body', { left: '900px', top: '200px' }));
    expect(s.reach.current!.locate(id)).toEqual({ x: (900 + 400) * 0.5 + 2, y: 200 * 0.5 - 20, width: 20, height: 20 });
    // the pins hidden: the card still stands where the pin would be
    fireEvent.keyDown(stage, { key: 'Ô', code: 'KeyJ', altKey: true, metaKey: true, shiftKey: true });
    expect(pin('body')).toBeNull();
    expect(s.reach.current!.locate(id)).toEqual({ x: 652, y: 80, width: 20, height: 20 });
  });

  it('⌥⌘⇧J hides every pin and the popover, resolving nothing; again shows them', async () => {
    const { pin, stage, container, doc } = await mount();
    fireEvent.click(pin('body')!);
    fireEvent.keyDown(stage, { key: 'Ô', code: 'KeyJ', altKey: true, metaKey: true, shiftKey: true });
    expect(popover()).toBeNull();
    expect(container.querySelectorAll('.deck-comment-pin')).toHaveLength(0);
    expect(listThreads(doc).filter((t) => t.status === 'open')).toHaveLength(4);
    fireEvent.keyDown(stage, { key: 'Ô', code: 'KeyJ', altKey: true, metaKey: true, shiftKey: true });
    await settle();
    expect(container.querySelectorAll('.deck-comment-pin')).toHaveLength(2);
  });
});

describe('read-only', () => {
  it('lists the threads with no reply field; the active card takes the keyboard', async () => {
    const { pin } = await mount({ readOnly: true });
    fireEvent.click(pin('body')!);
    expect(within(popover()!).queryByRole('textbox')).toBeNull();
    expect(document.activeElement).toBe(card('tb2'));
  });
});
