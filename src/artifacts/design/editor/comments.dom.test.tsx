// P3-E1 M4 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M4; the parent's Decision Logs 12, 13 (2) and 20):
// the workbench's comments under happy-dom. Comment with no element selected anchors the selected (else the active)
// board at its ROOT, quoting its title; with one element selected, C's controller comments it; both open B's surface
// naming the board and the target. A board's open thread pins its frame's top-right corner; the card's frame locates
// a board's thread by its frame and an element's on its own board; showing a board's thread selects its frame, an
// element's selects it on its board. "Move to board…" moves the selection's roots across boards in one undo step,
// their threads with them, and refuses a move the destination cannot take, writing nothing. Real layout is the e2e's.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommentOverlayProps, CommentedPassage, DocumentComments } from '../../document/editor/comments/surface';
import { readFlat, ROOT } from '../../slides/model';
import { addThread, threadStates } from '../../slides/threads';
import { DeckSession } from '../../slides/editor/session';
import { applyV2, newDoc, stateV2, transact } from '../../yjs';
import * as Y from '../../yjs/slides';
import { design, type BoardSeed } from '../fixtures/support';
import { moveElementToBoard, moveOriginOf } from '../move';
import { DesignWorkbench } from './DesignWorkbench';
import { DesignView } from './viewport';

const PINS = Array.from({ length: 23 }, (_, i) => `<div id="p${i}" style="position:absolute; left:${i}px; top:0px; width:10px; height:10px"></div>`).join('');
const BOARDS: BoardSeed[] = [
  { id: 'b1', at: { x: 0, y: 0, w: 390, h: 844 }, title: 'Phone', body: '<h1 id="title" style="font-size:72px">Launch</h1><p id="lede">Ship the first week.</p><div id="cta" style="position:absolute; left:24px; top:740px; width:342px; height:56px"></div><div id="cta2" style="position:absolute; left:24px; top:640px; width:342px; height:56px"></div>' },
  { id: 'b2', at: { x: 500, y: 0, w: 1440, h: 1024 }, title: 'Desktop' },
  { id: 'full', at: { x: 2000, y: 0, w: 800, h: 600 }, title: 'Full', body: PINS },
];

afterEach(cleanup);

function mount() {
  const doc = design(BOARDS);
  const session = new DeckSession(doc, 0);
  const view = new DesignView();
  view.setRoom({ w: 1000, h: 800 });
  view.setViewport({ zoom: 0.5, x: 10, y: 20 });
  let overlay: CommentOverlayProps | null = null;
  const opened = vi.fn<(p: CommentedPassage) => void>();
  const surface: DocumentComments = {
    opened,
    overlay: (props) => {
      overlay = props;
      return null;
    },
  };
  const utils = render(<DesignWorkbench session={session} view={view} assetUrl={() => null} system={null} readOnly={false} comments={surface} />);
  /** The same workbench, read-only now (the replica turned so). */
  const turnReadOnly = () => utils.rerender(<DesignWorkbench session={session} view={view} assetUrl={() => null} system={null} readOnly comments={surface} />);
  return { doc, session, view, opened, overlay: () => overlay!, turnReadOnly, ...utils };
}
const toolbar = () => screen.getByRole('toolbar', { name: 'Design' });
const openMenu = (trigger: HTMLElement) => fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
const thread = (doc: ReturnType<typeof design>, id: string) => threadStates(doc).find((t) => t.id === id)!;

describe('comments on a design', () => {
  it('Comment with no element selected anchors the selected board at its ROOT, quoting its title, outside undo', async () => {
    const { doc, session, view, opened, container } = mount();
    act(() => {
      session.show('b2');
      view.selectFrame('b1');
    });
    const comment = within(toolbar()).getByRole('button', { name: 'Comment' });
    expect(comment.getAttribute('title')).toBe('Comment on board Phone (⌥⌘M)');
    fireEvent.click(comment);
    expect(opened).toHaveBeenCalledTimes(1);
    const passage = opened.mock.calls[0]![0];
    expect(passage).toEqual({ threadId: expect.any(String), tabId: 'b1', tabTitle: 'Phone', quote: 'Phone', artifactTarget: 'board' });
    expect(thread(doc, passage.threadId)).toMatchObject({ slideId: 'b1', elementId: ROOT, quote: 'Phone', live: true, status: 'open' });
    expect(session.snapshot().canUndo).toBe(false); // the comments' origin is outside the design's undo
    // its pin at the board's top-right corner, in screen px: viewport (10, 20) + (0 + 390, 0) × 0.5, once the list settles
    await act(async () => new Promise((r) => setTimeout(r, 80)));
    const pin = container.querySelector<HTMLElement>('[data-board-pin="b1"]')!;
    expect([pin.style.left, pin.style.top]).toEqual(['205px', '20px']);
    fireEvent.click(pin);
    expect(screen.getByRole('complementary', { name: 'Comments' })).toBeTruthy(); // the pin opens the rail on its thread
  });

  it('with nothing selected the active board is the target; ⌥⌘M comments it too', () => {
    const { session, opened, container } = mount();
    act(() => session.show('b2'));
    fireEvent.keyDown(container.querySelector('[data-design-comment-frame]')!, { code: 'KeyM', altKey: true, metaKey: true });
    expect(opened.mock.calls[0]![0]).toMatchObject({ tabId: 'b2', tabTitle: 'Desktop', quote: 'Desktop', artifactTarget: 'board' });
  });

  it('one element selected: C’s controller comments it, the passage naming the board and the element target', () => {
    const { doc, session, opened } = mount();
    act(() => {
      session.show('b1');
      session.select(['lede']);
    });
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Comment' }));
    const passage = opened.mock.calls[0]![0];
    expect(passage).toEqual({ threadId: expect.any(String), tabId: 'b1', tabTitle: 'Phone', quote: 'Ship the first week.', artifactTarget: 'element' });
    expect(thread(doc, passage.threadId)).toMatchObject({ slideId: 'b1', elementId: 'lede' });
    act(() => session.select(['lede', 'title']));
    expect(within(toolbar()).getByRole('button', { name: 'Comment' }).hasAttribute('disabled')).toBe(true); // two: neither target
  });

  it('the card’s frame locates a board’s thread by its frame and an element’s on its own board; unknown threads nowhere', () => {
    const { doc, overlay } = mount();
    addThread(doc, { threadId: 'tb', slideId: 'b2', elementId: ROOT, quote: 'Desktop', by: { kind: 'human' }, at: 1 }, 'deck-comments');
    addThread(doc, { threadId: 'te', slideId: 'b1', elementId: 'lede', quote: 'x', by: { kind: 'human' }, at: 1 }, 'deck-comments');
    expect(overlay().locate('tb')).not.toBeNull();
    expect(overlay().locate('te')).not.toBeNull(); // b1 is not the active board: located on its own canvas
    expect(overlay().locate('nope')).toBeNull();
  });

  it('showing a board’s thread selects its frame; an element’s activates its board and selects it', async () => {
    const { doc, session, view } = mount();
    addThread(doc, { threadId: 'tb', slideId: 'b2', elementId: ROOT, quote: 'Desktop', by: { kind: 'human' }, at: 1 }, 'deck-comments');
    addThread(doc, { threadId: 'te', slideId: 'b1', elementId: 'lede', quote: 'Ship the first week.', by: { kind: 'human' }, at: 1 }, 'deck-comments');
    fireEvent.click(within(toolbar()).getByRole('button', { name: /^Comments/ }));
    const rail = await screen.findByRole('complementary', { name: 'Comments' });
    await act(async () => new Promise((r) => setTimeout(r, 80)));
    fireEvent.click(within(rail).getByRole('button', { name: 'Show board: Desktop' }));
    expect([session.snapshot().currentSlide, session.snapshot().selection, view.snapshot().frame]).toEqual(['b2', [], 'b2']);
    fireEvent.click(within(rail).getByRole('button', { name: 'Show element: Ship the first week.' }));
    expect([session.snapshot().currentSlide, session.snapshot().selection, view.snapshot().frame]).toEqual(['b1', ['lede'], null]);
  });
});

/** happy-dom lays nothing out: a board's elements report their style's box (C's comments test's way). */
function fakeLayout(container: HTMLElement, boardId: string): void {
  const root = container.querySelector<HTMLElement>(`[data-board-id="${boardId}"] .maws-slide`)!;
  const px = (n: HTMLElement, k: string) => Number.parseFloat(n.style.getPropertyValue(k)) || 0;
  for (const n of root.querySelectorAll<HTMLElement>('[data-eid]')) {
    Object.defineProperty(n, 'offsetLeft', { configurable: true, get: () => px(n, 'left') });
    Object.defineProperty(n, 'offsetTop', { configurable: true, get: () => px(n, 'top') });
    Object.defineProperty(n, 'offsetWidth', { configurable: true, get: () => px(n, 'width') });
    Object.defineProperty(n, 'offsetHeight', { configurable: true, get: () => px(n, 'height') });
    Object.defineProperty(n, 'offsetParent', { configurable: true, get: () => root });
  }
}

describe('element pins on every board', () => {
  it('pins an element on an inactive board (a move another replica made lands there unseen by this one), once, at its corner; the active board’s stay its overlay’s', async () => {
    const { doc, session, container } = mount();
    act(() => session.show('b2')); // the desktop active: its overlay alone takes gestures
    addThread(doc, { threadId: 't1', slideId: 'b1', elementId: 'cta', quote: '', by: { kind: 'human' }, at: 1 }, 'deck-comments');
    fakeLayout(container, 'b1');
    await act(async () => new Promise((r) => setTimeout(r, 80)));
    const pins = () => [...container.querySelectorAll<HTMLElement>('[data-comment-pin="cta"]')];
    expect(pins()).toHaveLength(1);
    const pin = pins()[0]!;
    expect(pin.closest('[data-active-board]')).toBeNull(); // not the overlay's
    // at the element's top-right on screen: the board at (0, 0) of the world, the view at (10, 20) × 0.5
    const host = pin.closest<HTMLElement>('[data-board-pins-of="b1"]')!;
    expect([host.style.left, host.style.top]).toEqual(['10px', '20px']);
    expect([Number.parseFloat(pin.style.left), Number.parseFloat(pin.style.top)]).toEqual([(24 + 342) * 0.5, 740 * 0.5]);
    fireEvent.click(pin);
    expect(session.snapshot().rail).toBe('comments');

    // the board activated: its pin is its overlay's, and only one
    act(() => session.show('b1'));
    fakeLayout(container, 'b1');
    await act(async () => new Promise((r) => setTimeout(r, 80)));
    expect(pins()).toHaveLength(1);
    expect(pins()[0]!.closest('[data-active-board="b1"]')).not.toBeNull();
  });

  it('another replica’s cross-board move: the source stays active here, the pin and the card follow to the destination, once', async () => {
    const { doc, session, container, overlay } = mount();
    addThread(doc, { threadId: 't1', slideId: 'b1', elementId: 'cta', quote: '', by: { kind: 'human' }, at: 1 }, 'deck-comments');
    act(() => session.show('b1'));
    const remote = newDoc();
    applyV2(remote, stateV2(doc));
    const moved = moveElementToBoard(remote, 'b1', 'b2', 'cta').ids.get('cta')!;
    act(() => applyV2(doc, stateV2(remote), 'remote'));
    expect(session.snapshot().currentSlide).toBe('b1');
    fakeLayout(container, 'b2');
    await act(async () => new Promise((r) => setTimeout(r, 80)));
    expect(container.querySelectorAll('[data-comment-pin="cta"]')).toHaveLength(0);
    const pins = container.querySelectorAll<HTMLElement>(`[data-comment-pin="${moved}"]`);
    expect(pins).toHaveLength(1);
    expect(pins[0]!.closest('[data-board-pins-of="b2"]')).not.toBeNull();
    expect([Number.parseFloat(pins[0]!.style.left), Number.parseFloat(pins[0]!.style.top)]).toEqual([(24 + 342) * 0.5, 740 * 0.5]);
    expect(overlay().locate('t1')).not.toBeNull(); // the card finds it on the destination's canvas
    expect(Y.threadScalars(doc, 't1')).toMatchObject({ slideId: 'b2', elementId: moved });
  });
});

describe('the rail’s words for a design (Decision Log 29)', () => {
  it('names each thread’s board, shows a board or an element, and says which was deleted', async () => {
    const { doc, session, container } = mount();
    addThread(doc, { threadId: 'tb', slideId: 'b2', elementId: ROOT, quote: 'Desktop', by: { kind: 'human' }, at: 1 }, 'deck-comments');
    addThread(doc, { threadId: 'te', slideId: 'b1', elementId: 'lede', quote: 'Ship the first week.', by: { kind: 'human' }, at: 1 }, 'deck-comments');
    fireEvent.click(within(toolbar()).getByRole('button', { name: /^Comments/ }));
    const rail = await screen.findByRole('complementary', { name: 'Comments' });
    await act(async () => new Promise((r) => setTimeout(r, 80)));
    const board = rail.querySelector<HTMLElement>('article[data-thread="tb"]')!;
    const element = rail.querySelector<HTMLElement>('article[data-thread="te"]')!;
    expect(board.querySelector('.deck-thread-slide')!.textContent).toBe('Board Desktop');
    expect(element.querySelector('.deck-thread-slide')!.textContent).toBe('Phone');
    expect(within(board).getByRole('button', { name: 'Show board: Desktop' })).toBeTruthy();
    expect(within(element).getByRole('button', { name: 'Show element: Ship the first week.' })).toBeTruthy();
    // the board deleted: its thread orphaned, saying the board went, where it was named
    act(() => session.edit((origin) => Y.deleteSlide(doc, 'b2') ?? origin));
    await act(async () => new Promise((r) => setTimeout(r, 80)));
    const orphan = container.querySelector<HTMLElement>('article[data-thread="tb"]')!;
    expect(orphan.querySelector('.deck-thread-slide')!.textContent).toBe('A deleted board');
    expect(orphan.querySelector('.deck-thread-note')!.textContent).toBe('The commented board was deleted.');
  });

  it('says what to select when nothing is open', async () => {
    mount();
    fireEvent.click(within(toolbar()).getByRole('button', { name: /^Comments/ }));
    const rail = await screen.findByRole('complementary', { name: 'Comments' });
    expect(rail.querySelector('.deck-comments-empty')!.textContent).toBe('No open comments. Select a board or an element and choose Comment.');
  });
});

describe('Move to board…', () => {
  it('moves the selected elements’ roots across boards in one undo step, their threads with them, the moved ones selected there', () => {
    const { doc, session } = mount();
    addThread(doc, { threadId: 't1', slideId: 'b1', elementId: 'cta', quote: '', by: { kind: 'human' }, at: 1 }, 'deck-comments');
    act(() => {
      session.show('b1');
      session.select(['cta', 'lede']);
    });
    openMenu(screen.getByRole('button', { name: 'Move to board…' }));
    const menu = screen.getByRole('menu', { name: 'Move to board…' });
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Desktop', 'Full']); // not the board it is on
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Desktop' }));
    const { currentSlide, selection } = session.snapshot();
    expect(currentSlide).toBe('b2');
    expect(selection).toHaveLength(2);
    for (const id of selection) expect(Y.hasElement(doc, 'b2', id)).toBe(true);
    expect(selection.map((id) => moveOriginOf(doc, 'b2', id)!.element).sort()).toEqual(['cta', 'lede']);
    expect(Y.hasElement(doc, 'b1', 'cta') || Y.hasElement(doc, 'b1', 'lede')).toBe(false);
    const moved = selection.find((id) => moveOriginOf(doc, 'b2', id)!.element === 'cta')!;
    expect(Y.threadScalars(doc, 't1')).toMatchObject({ slideId: 'b2', elementId: moved });
    // a pinned element keeps its place on the destination
    expect(readFlat(doc, 'b2').find((e) => e.id === moved)!.style).toMatchObject({ left: '24px', top: '740px' });
    act(() => session.undoStep());
    expect(Y.hasElement(doc, 'b1', 'cta') && Y.hasElement(doc, 'b1', 'lede')).toBe(true);
    expect(Y.threadScalars(doc, 't1')).toMatchObject({ slideId: 'b1', elementId: 'cta' });
  });

  it('an open menu writes nothing once its choice no longer holds: read-only, writes held, the selection or a board gone', () => {
    const cases: [string, (m: ReturnType<typeof mount>) => void][] = [
      ['the replica turned read-only', (m) => m.turnReadOnly()],
      ['writes held (a version shown)', (m) => m.session.holdWrites(true)],
      ['the selection cleared', (m) => m.session.select([])],
      ['the selected element deleted elsewhere', (m) => transact(m.doc, () => Y.deleteElement(m.doc, 'b1', 'cta'), 'remote')],
      ['the destination deleted elsewhere', (m) => transact(m.doc, () => Y.deleteSlide(m.doc, 'b2'), 'remote')],
      ['the destination held elsewhere', (m) => transact(m.doc, () => Y.setSlideKey(m.doc, 'b2', 'held', { source: '<section id="b2"></section>', reasons: ['broken'] }), 'remote')],
    ];
    for (const [what, turn] of cases) {
      const m = mount();
      addThread(m.doc, { threadId: 't1', slideId: 'b1', elementId: 'cta', quote: '', by: { kind: 'human' }, at: 1 }, 'deck-comments');
      act(() => {
        m.session.show('b1');
        m.session.select(['cta']);
      });
      openMenu(screen.getByRole('button', { name: 'Move to board…' }));
      const item = screen.getByRole('menuitem', { name: 'Desktop' });
      const state = () => ({ b1: Y.elementIds(m.doc, 'b1').sort(), b2: Y.hasSlide(m.doc, 'b2') ? Y.elementIds(m.doc, 'b2').sort() : null, thread: { ...Y.threadScalars(m.doc, 't1') } });
      act(() => turn(m));
      const before = state(); // as the change left it
      if (item.isConnected) fireEvent.click(item);
      expect(state(), what).toEqual(before);
      expect(m.session.snapshot().canUndo, what).toBe(false);
      cleanup();
    }
  });

  it('refuses a move the destination cannot take whole, writing nothing, and says why', () => {
    const { doc, session, container } = mount();
    act(() => {
      session.show('b1');
      session.select(['cta', 'cta2']); // the full board holds 23 pinned children: the second would pass its 24
    });
    const before = Y.elementIds(doc, 'full').length;
    openMenu(screen.getByRole('button', { name: 'Move to board…' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Full' }));
    expect(Y.elementIds(doc, 'full')).toHaveLength(before);
    expect(Y.hasElement(doc, 'b1', 'cta') && Y.hasElement(doc, 'b1', 'cta2')).toBe(true);
    expect(container.querySelector('[data-deck-notice]')!.textContent).toMatch(/board full/);
    expect(session.snapshot().canUndo).toBe(false);
  });
});

describe('the comment frame’s cost while the world pans (DL39’s bounded wave)', () => {
  it('with no pin and no card on screen a pan or a zoom asks nothing of the card host; a pin follows every pan; a card on screen is located again on every pan', async () => {
    const { doc, view, overlay, container } = mount();
    // each render of the frame hands the card host a new set of props: the same object means no render asked it
    const asked = overlay();
    act(() => view.setViewport({ zoom: 0.5, x: 40, y: 20 }));
    act(() => view.setViewport({ zoom: 0.25, x: 40, y: 20 }));
    expect(overlay()).toBe(asked);
    // a board's open thread pins it: its pin follows the pan
    act(() => void addThread(doc, { threadId: 't1', slideId: 'b1', elementId: ROOT, quote: 'Phone', by: { kind: 'human' }, at: 1 }, 'deck-comments'));
    await act(async () => new Promise((r) => setTimeout(r, 80)));
    act(() => view.setViewport({ zoom: 0.5, x: 70, y: 20 }));
    const pin = container.querySelector<HTMLElement>('[data-board-pin="b1"]')!;
    expect([pin.style.left, pin.style.top]).toEqual([`${70 + 390 * 0.5}px`, '20px']);
    // a card on screen (its thread active): every pan moves its layout key, so the host locates it again
    act(() => overlay().setActive('t1'));
    const key = overlay().layoutKey;
    act(() => view.setViewport({ zoom: 0.5, x: 90, y: 25 }));
    expect(overlay().layoutKey).not.toBe(key);
  });
});
