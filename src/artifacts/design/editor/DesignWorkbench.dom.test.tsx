// P3-E1 M3 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M3; parent Decision Log 20): the workbench over
// a replica, under happy-dom: every board mounted as its own canvas in one transformed world, pan and zoom moving only
// the world, board frames selected, moved, resized (snapped, the cap refused by name) and listed (add from presets,
// duplicate, delete, reorder, zoom to board), an inactive board's press activating it and selecting the hit element
// without moving or panning anything, one undo stack for board and element edits, read-only, held and missing boards
// written nothing, and Insert on a phone board at screen type. Layout, paint and real pointers are the e2e's.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyV1, diffV1, newDoc, onUpdate, stateVector, transact, type Doc } from '../../yjs';
import * as Y from '../../yjs/slides';
import { flushLayout } from '../../slides/canvas';
import { readSlide, setStyle } from '../../slides/model';
import { DeckSession } from '../../slides/editor/session';
import { design, heldPeer, type BoardSeed } from '../fixtures/support';
import { boardFrame, boardOrder, MISSING_SOURCE_KEY } from '../model';
import { deleteBoard, setBoardFrame } from '../writers';
import { DesignWorkbench } from './DesignWorkbench';
import { DESIGN_COPY } from './copy';
import { DesignView } from './viewport';

const BOARDS: BoardSeed[] = [
  { id: 'b1', at: { x: 0, y: 0, w: 390, h: 844 }, title: 'Phone' },
  { id: 'b2', at: { x: 500, y: 0, w: 1440, h: 1024 }, title: 'Desktop' },
  { id: 'b3', at: { x: 2100, y: 0, w: 1080, h: 8192 }, title: 'Poster' },
];

afterEach(cleanup);

const ASSET_URL = () => null;
function mount(options: { doc?: Doc; readOnly?: boolean; zoom?: number; holdRemote?: (on: boolean) => void } = {}) {
  const doc = options.doc ?? design(BOARDS);
  const session = new DeckSession(doc, 0, { holdRemote: options.holdRemote });
  const view = new DesignView();
  view.setRoom({ w: 1000, h: 800 });
  view.setViewport({ zoom: options.zoom ?? 1, x: 0, y: 0 });
  const utils = render(<DesignWorkbench session={session} view={view} assetUrl={ASSET_URL} system={null} readOnly={options.readOnly ?? false} />);
  const world = utils.container.querySelector<HTMLElement>('[data-design-world]')!;
  /** The same workbench, read-only now (the replica turned so). */
  const turnReadOnly = () => utils.rerender(<DesignWorkbench session={session} view={view} assetUrl={ASSET_URL} system={null} readOnly />);
  return { doc, session, view, world, turnReadOnly, ...utils };
}
/** Another replica of `doc`, and how its edits reach `doc` and back. */
function remoteOf(doc: Doc) {
  const remote = newDoc();
  applyV1(remote, diffV1(doc));
  return { remote, toLocal: () => act(() => applyV1(doc, diffV1(remote, stateVector(doc)), 'remote')), toRemote: () => applyV1(remote, diffV1(doc, stateVector(remote))) };
}
/** A paste event carrying `data` by type, as the pasteboard gives it. */
function paste(target: HTMLElement, data: Record<string, string>) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { types: Object.keys(data), getData: (type: string) => data[type] ?? '' } });
  act(() => void target.dispatchEvent(event));
}

const board = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[data-board-id="${id}"]`)!;
const title = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[data-board-title="${id}"]`)!;
const rows = () => within(screen.getByRole('navigation', { name: 'Boards' })).getAllByRole('button', { name: /×/ });
const press = (el: Element, x: number, y: number, extra: Record<string, unknown> = {}) => fireEvent.pointerDown(el, { button: 0, buttons: 1, clientX: x, clientY: y, pointerId: 1, ...extra });
const drag = (world: HTMLElement, x: number, y: number) => fireEvent.pointerMove(world, { buttons: 1, clientX: x, clientY: y, pointerId: 1 });
const release = (world: HTMLElement, x: number, y: number) => fireEvent.pointerUp(world, { button: 0, clientX: x, clientY: y, pointerId: 1 });
const openMenu = (trigger: HTMLElement) => fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });

describe('the world', () => {
  it('mounts every board as its own canvas at its place in one transformed layer, at its size, marked a board', () => {
    const { container } = mount();
    expect(container.querySelectorAll('[data-board-id] .maws-slide')).toHaveLength(3);
    for (const b of BOARDS) {
      const el = board(container, b.id);
      expect([el.style.left, el.style.top, el.style.width, el.style.height]).toEqual([`${b.at.x}px`, `${b.at.y}px`, `${b.at.w}px`, `${b.at.h}px`]);
      const slide = el.querySelector<HTMLElement>('.maws-slide')!;
      expect(slide.hasAttribute('data-board')).toBe(true);
      expect(slide.style.width).toBe(`${b.at.w}px`);
    }
    // the canvases draw at scale 1: the world's one transform zooms them
    expect(container.querySelector<HTMLElement>('[data-board-id="b2"] .deck-slide-scaler')!.style.transform).toBe('scale(1)');
    expect(container.querySelector<HTMLElement>('[data-design-layer]')!.style.transform).toBe('translate(0px, 0px) scale(1)');
  });

  it('(M6) tells its owner the live canvases by board, each drawing its board, and none once unmounted', () => {
    const told: ReadonlyMap<string, { slideId: string; root: HTMLElement }>[] = [];
    const doc = design(BOARDS);
    const view = new DesignView();
    view.setRoom({ w: 1000, h: 800 });
    const { container, unmount } = render(<DesignWorkbench session={new DeckSession(doc, 0)} view={view} assetUrl={ASSET_URL} system={null} readOnly={false} onCanvases={(c) => told.push(c)} />);
    const last = told.at(-1)!;
    expect([...last.keys()].sort()).toEqual(BOARDS.map((b) => b.id));
    for (const b of BOARDS) expect(last.get(b.id)!.root).toBe(board(container, b.id).querySelector('.maws-slide'));
    unmount();
    expect(told.at(-1)!.size).toBe(0);
  });

  it('pans and zooms by the world’s transform alone, every board staying mounted', () => {
    const { container, view } = mount();
    const canvases = [...container.querySelectorAll('[data-board-id] .maws-slide')];
    act(() => view.setViewport({ zoom: 0.25, x: -400, y: 30 }));
    expect(container.querySelector<HTMLElement>('[data-design-layer]')!.style.transform).toBe('translate(-400px, 30px) scale(0.25)');
    expect([...container.querySelectorAll('[data-board-id] .maws-slide')]).toEqual(canvases); // the same nodes: nothing remounted
  });

  it('a drag on the empty world pans it and clears the selection; the wheel pans, ⌃/pinch zooms about the pointer', () => {
    const { container, view, session, world } = mount();
    act(() => session.select(['title']));
    const ground = container.querySelector('[data-design-ground]')!;
    press(ground, 10, 10);
    drag(world, 60, 30);
    release(world, 60, 30);
    expect(view.snapshot().viewport).toEqual({ zoom: 1, x: 50, y: 20 });
    expect(session.snapshot().selection).toEqual([]);
    fireEvent.wheel(world, { deltaX: 0, deltaY: 100, clientX: 0, clientY: 0 });
    expect(view.snapshot().viewport).toEqual({ zoom: 1, x: 50, y: -80 });
    // happy-dom's WheelEvent takes no mouse fields from its init: a pinch's ⌃ and point set on the event itself
    const pinch = new WheelEvent('wheel', { deltaY: -50, bubbles: true, cancelable: true });
    for (const [k, v] of [['ctrlKey', true], ['clientX', 50], ['clientY', -80]] as const) Object.defineProperty(pinch, k, { value: v });
    act(() => void world.dispatchEvent(pinch));
    const v = view.snapshot().viewport!;
    expect(v.zoom).toBeGreaterThan(1);
    expect([v.x, v.y]).toEqual([50, -80]); // the world's origin under the pointer stays there
  });

  it('closing Boards removes its sheet without remounting the world, which still pans by the pointer’s exact delta', () => {
    const { container, view, world } = mount();
    const boards = screen.getByRole('button', { name: 'Boards' });
    expect(boards.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-design-rail="boards"]')).not.toBeNull();
    fireEvent.click(boards);
    expect(boards.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('navigation', { name: 'Boards' })).toBeNull();
    expect(container.querySelector('[data-design-rail="boards"]')).toBeNull();
    expect(container.querySelector('[data-design-world]')).toBe(world);
    const before = { zoom: 0.25, x: 200, y: 100 };
    act(() => view.setViewport(before));
    const ground = container.querySelector('[data-design-ground]')!;
    press(ground, 200, 200);
    drag(world, 120, 140);
    release(world, 120, 140);
    expect(view.snapshot().viewport).toEqual({ zoom: before.zoom, x: before.x - 80, y: before.y - 60 });
    fireEvent.click(boards);
    expect(screen.getByRole('navigation', { name: 'Boards' })).toBeDefined();
    expect(container.querySelector('[data-design-world]')).toBe(world);
  });

  it('the toolbar zooms by steps, fits all and fits the selected board, 2 %–400 %', () => {
    const { container, view } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(view.snapshot().viewport!.zoom).toBe(1.5);
    fireEvent.change(screen.getByRole('combobox', { name: 'Zoom' }), { target: { value: 'fit-all' } });
    const all = view.snapshot().viewport!;
    expect(all.zoom).toBeCloseTo((800 - 96) / 8192, 6); // the poster's height decides
    fireEvent.click(title(container, 'b1'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Zoom' }), { target: { value: 'fit-selection' } });
    expect(view.snapshot().viewport!.zoom).toBe(Math.min(1, (800 - 96) / 844));
    for (let i = 0; i < 20; i++) fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(view.snapshot().viewport!.zoom).toBe(0.02);
  });

  it('a board edited in another replica patches here', () => {
    const { container, doc } = mount();
    const remote = newDoc();
    applyV1(remote, diffV1(doc));
    setBoardFrame(remote, 'b2', { x: 640, w: 1280 }, 'remote');
    act(() => applyV1(doc, diffV1(remote, stateVector(doc)), 'remote'));
    expect([board(container, 'b2').style.left, board(container, 'b2').style.width]).toEqual(['640px', '1280px']);
    expect(board(container, 'b2').querySelector<HTMLElement>('.maws-slide')!.style.width).toBe('1280px');
  });
});

describe('board frames', () => {
  it('a title press selects the board’s geometry; a drag moves it, snapped to siblings, one undo step', () => {
    const { container, doc, session, view, world } = mount({ zoom: 0.5 });
    press(title(container, 'b2'), 300, 0);
    expect(view.snapshot().frame).toBe('b2');
    expect(session.snapshot().currentSlide).toBe('b2');
    expect(board(container, 'b2').hasAttribute('data-frame-selected')).toBe(true);
    drag(world, 350, 25); // 50 screen px at 50 %: 100 world px
    drag(world, 400, 50);
    release(world, 400, 50);
    expect(boardFrame(doc, 'b2')).toEqual({ x: 700, y: 100, w: 1440, h: 1024 });
    // dropped 3 world px short of meeting the poster's left edge: snapped to it
    press(title(container, 'b2'), 0, 0);
    drag(world, (2100 - 1440 - 700 - 3) / 2 + 0, 0);
    release(world, 0, 0);
    expect(boardFrame(doc, 'b2')!.x).toBe(2100 - 1440);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(boardFrame(doc, 'b2')).toEqual({ x: 700, y: 100, w: 1440, h: 1024 });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(boardFrame(doc, 'b2')).toEqual({ x: 500, y: 0, w: 1440, h: 1024 });
  });

  it('resizes by its handles; past the cap the refusal is shown and nothing written', () => {
    const { container, doc, world } = mount();
    fireEvent.click(title(container, 'b1'));
    press(container.querySelector('[data-board-handle="e"]')!, 390, 400);
    drag(world, 400, 400);
    release(world, 400, 400);
    expect(boardFrame(doc, 'b1')).toEqual({ x: 0, y: 0, w: 400, h: 844 });
    fireEvent.click(title(container, 'b3'));
    press(container.querySelector('[data-board-handle="s"]')!, 2500, 8192);
    drag(world, 2500, 8192 + 9000);
    release(world, 2500, 8192 + 9000);
    expect(boardFrame(doc, 'b3')).toEqual({ x: 2100, y: 0, w: 1080, h: 8192 });
    expect(container.querySelector('[data-deck-notice]')!.textContent).toBe('board b3: h is 17192 px (over 16384 px a side)');
  });

  it('the inspector edits the selected board’s frame and applies a preset; the cap is refused by name', () => {
    const { container, doc } = mount();
    fireEvent.click(title(container, 'b1'));
    const width = screen.getByRole('textbox', { name: 'Board width' });
    fireEvent.change(width, { target: { value: '834' } });
    fireEvent.keyDown(width, { key: 'Enter' });
    expect(boardFrame(doc, 'b1')!.w).toBe(834);
    fireEvent.change(width, { target: { value: '20000' } });
    fireEvent.keyDown(width, { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toContain('over 16384 px a side');
    expect(boardFrame(doc, 'b1')!.w).toBe(834);
    fireEvent.change(screen.getByRole('combobox', { name: 'Board size' }), { target: { value: 'tablet' } });
    expect(boardFrame(doc, 'b1')).toEqual({ x: 0, y: 0, w: 834, h: 1194 });
    const name = screen.getByRole('textbox', { name: 'Board name' });
    fireEvent.change(name, { target: { value: 'Phone, tall' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(Y.slideScalars(doc, 'b1').title).toBe('Phone, tall');
  });

  it('with a frame selected: arrows nudge it, ⌫ deletes the board, Escape from an element climbs to its board', () => {
    const { container, doc, session, view, world } = mount();
    fireEvent.click(title(container, 'b2'));
    world.focus();
    fireEvent.keyDown(world, { key: 'ArrowRight', shiftKey: true });
    expect(boardFrame(doc, 'b2')!.x).toBe(510);
    fireEvent.keyDown(world, { key: 'Backspace' });
    expect(boardOrder(doc)).toEqual(['b1', 'b3']);
    act(() => {
      session.show('b1');
      session.select(['title']);
    });
    expect(view.snapshot().frame).toBeNull();
    fireEvent.keyDown(world, { key: 'Escape' }); // the element's own Escape: the selection climbs out (C's)
    fireEvent.keyDown(world, { key: 'Escape' }); // nothing selected: the board's frame
    expect(view.snapshot().frame).toBe('b1');
  });
});

describe('pointer arbitration (Decision Log 20)', () => {
  it('a press on an inactive board’s content activates it and selects the hit element; the press neither pans nor moves', () => {
    const { container, doc, session, view, world } = mount();
    expect(session.snapshot().currentSlide).toBe('b1');
    const hit = container.querySelector('[data-board-id="b2"] [data-eid="title"]')!;
    press(hit, 600, 20);
    drag(world, 700, 120);
    release(world, 700, 120);
    expect(session.snapshot().currentSlide).toBe('b2');
    expect(session.snapshot().selection).toEqual(['title']);
    expect(view.snapshot().frame).toBeNull();
    expect(view.snapshot().viewport).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(boardFrame(doc, 'b2')).toEqual({ x: 500, y: 0, w: 1440, h: 1024 });
    expect(readSlide(doc, 'b2').children.find((c) => c.id === 'title')!.style.left).toBeUndefined(); // the element did not move
    // the active board alone carries C's overlay, at its screen origin and size at the zoom
    const active = container.querySelector<HTMLElement>('[data-active-board]')!;
    expect(active.dataset.activeBoard).toBe('b2');
    expect([active.style.left, active.style.top, active.style.width, active.style.height]).toEqual(['500px', '0px', '1440px', '1024px']);
    expect(container.querySelectorAll('[data-overlay]')).toHaveLength(1);
  });
});

describe('the board list', () => {
  it('lists the boards back to front with their sizes; a click selects one, its options zoom to it', () => {
    const { session, view } = mount();
    expect(rows().map((r) => r.getAttribute('aria-label'))).toEqual(['Phone, 390 × 844', 'Desktop, 1,440 × 1,024', 'Poster, 1,080 × 8,192']);
    fireEvent.click(rows()[2]!);
    expect(session.snapshot().currentSlide).toBe('b3');
    expect(view.snapshot().frame).toBe('b3');
    openMenu(screen.getByRole('button', { name: 'Board Poster options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Zoom to board' }));
    expect(view.snapshot().viewport!.zoom).toBeCloseTo((800 - 96) / 8192, 6);
  });

  it('adds from a preset, duplicates, reorders and deletes, each one undo step', () => {
    const { doc, session } = mount();
    openMenu(screen.getByRole('button', { name: 'Add board' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Tablet 834 × 1,194' }));
    const added = boardOrder(doc).at(-1)!;
    expect(boardFrame(doc, added)).toEqual({ x: 2100 + 1080 + 100, y: 0, w: 834, h: 1194 });
    expect(Y.slideScalars(doc, added).title).toBe('Tablet');
    expect(session.snapshot().currentSlide).toBe(added);

    openMenu(screen.getByRole('button', { name: 'Board Phone options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate board' }));
    const copy = boardOrder(doc)[1]!;
    expect(boardFrame(doc, copy)).toEqual({ x: 490, y: 0, w: 390, h: 844 });
    expect(readSlide(doc, copy).children.map((c) => c.id)).not.toContain('title'); // new element ids

    openMenu(screen.getAllByRole('button', { name: 'Board Phone options' })[0]!); // the copy keeps the title: the original is first
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));
    expect(boardOrder(doc).slice(0, 2)).toEqual([copy, 'b1']);

    openMenu(screen.getByRole('button', { name: 'Board Desktop options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete board' }));
    expect(boardOrder(doc)).not.toContain('b2');

    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(boardOrder(doc)).toEqual(['b1', 'b2', 'b3']);
  });

  it('renames a board in place', () => {
    const { doc } = mount();
    openMenu(screen.getByRole('button', { name: 'Board Desktop options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const field = screen.getByRole('textbox', { name: 'Rename board' });
    fireEvent.change(field, { target: { value: 'Landing' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(Y.slideScalars(doc, 'b2').title).toBe('Landing');
  });

  it('(M6 final review) a rename opened before the replica turned read-only, the board held or missing, or writes held, commits nothing by Enter or blur; Escape cancels', () => {
    for (const turn of ['readOnly', 'held', 'missing', 'holdWrites'] as const)
      for (const commit of ['Enter', 'blur'] as const) {
        const { doc, session, turnReadOnly } = mount();
        const { remote, toLocal } = remoteOf(doc);
        openMenu(screen.getByRole('button', { name: 'Board Desktop options' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
        const field = screen.getByRole('textbox', { name: 'Rename board' });
        fireEvent.change(field, { target: { value: 'Landing' } });
        if (turn === 'readOnly') turnReadOnly();
        else if (turn === 'holdWrites') act(() => session.holdWrites(true));
        else {
          transact(remote, () => {
            if (turn === 'held') Y.setSlideKey(remote, 'b2', 'held', { source: '<section id="b2"><blink>x</blink></section>', reasons: ['an unknown tag <blink>'] });
            else Y.setSlideKey(remote, 'b2', MISSING_SOURCE_KEY, true);
          });
          toLocal();
        }
        const now = screen.queryByRole('textbox', { name: 'Rename board' });
        if (now) {
          if (commit === 'Enter') fireEvent.keyDown(now, { key: 'Enter' });
          else fireEvent.blur(now);
        }
        expect(Y.slideScalars(doc, 'b2').title, `${turn}, ${commit}`).toBe('Desktop');
        expect(session.undo.canUndo(), `${turn}, ${commit}: nothing on the undo stack`).toBe(false);
        cleanup();
      }
    const { doc } = mount();
    openMenu(screen.getByRole('button', { name: 'Board Desktop options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const field = screen.getByRole('textbox', { name: 'Rename board' });
    fireEvent.change(field, { target: { value: 'Landing' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Rename board' })).toBeNull();
    expect(Y.slideScalars(doc, 'b2').title).toBe('Desktop');
  });

  // W1 (tech debt, 2026-10-19): dnd-kit's default announcements read the boards' ids; a keyboard reorder names the board
  // by position and name (an untitled one by position), each row given a box down the list (happy-dom lays nothing out)
  it('a keyboard reorder is heard by board position and name, never an id', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const row = this.closest<HTMLElement>('[data-board-row]');
      const i = row ? [...row.parentElement!.children].indexOf(row) : -1;
      const top = i < 0 ? 0 : i * 40;
      const [width, height] = i < 0 ? [0, 0] : [200, 32];
      return { x: 0, y: top, left: 0, top, width, height, right: width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
    });
    const { doc, container } = mount({ doc: design([...BOARDS, { id: 'b4', at: { x: 3300, y: 0, w: 390, h: 844 } }]) });
    const row = (n: number) => container.querySelectorAll<HTMLElement>('[data-board-row] .design-board-row')[n - 1]!;
    const heard = () => document.querySelector('[id^="DndLiveRegion"]')?.textContent ?? '';
    const key = async (code: string, target: Element | Document = document) => {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0))); // the keyboard sensor listens a tick after the pick-up
      act(() => void fireEvent.keyDown(target, { code, key: code === 'Space' ? ' ' : code }));
    };
    const said: string[] = [];
    for (const [code, target] of [['Space', row(2)], ['ArrowDown'], ['Space']] as [string, Element?][]) {
      await key(code, target);
      said.push(heard());
    }
    expect(said).toEqual(['Board 2, Desktop, picked up.', 'Board 2, Desktop, moved to position 3.', 'Board 2, Desktop, dropped at position 3.']);
    expect(boardOrder(doc)).toEqual(['b1', 'b3', 'b2', 'b4']);
    await key('Space', row(4));
    said.push(heard());
    await key('Escape');
    said.push(heard());
    expect(said.slice(3)).toEqual(['Board 4, picked up.', 'Board 4, move cancelled, back at position 4.']);
    for (const s of said) expect(s).not.toMatch(/\bb[1-4]\b/);
    vi.restoreAllMocks();
  });
});

describe('one undo stack, and what writes nothing', () => {
  it('an element restyle and a board move undo in turn from one stack', () => {
    const { container, doc, session, world } = mount();
    act(() => session.edit((origin) => setStyle(doc, 'b1', 'title', { color: '#ff0000' }, origin)));
    press(title(container, 'b1'), 0, 0);
    drag(world, 40, 0);
    release(world, 40, 0);
    expect(boardFrame(doc, 'b1')!.x).toBe(40);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(boardFrame(doc, 'b1')!.x).toBe(0);
    expect(Y.elementScalars(doc, 'b1', 'title')['style:color']).toBe('#ff0000');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(Y.elementScalars(doc, 'b1', 'title')['style:color']).toBeUndefined();
  });

  it('read-only: a title drag selects but moves nothing; no handles, no Add board', () => {
    const { container, doc, world, view } = mount({ readOnly: true });
    press(title(container, 'b2'), 500, 0);
    drag(world, 600, 0);
    release(world, 600, 0);
    expect(view.snapshot().frame).toBe('b2');
    expect(boardFrame(doc, 'b2')!.x).toBe(500);
    expect(container.querySelector('[data-board-handle]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add board' })).toBeNull();
  });

  it('a held board and a board whose file never arrived are drawn labelled and edit nothing', () => {
    const doc = design(BOARDS);
    transact(doc, () => {
      Y.setSlideKey(doc, 'b2', 'held', { source: '<section id="b2"><blink>x</blink></section>', reasons: ['an unknown tag <blink>'] });
      Y.setSlideKey(doc, 'b3', MISSING_SOURCE_KEY, true);
    });
    const { container, world } = mount({ doc });
    expect(board(container, 'b2').hasAttribute('data-held')).toBe(true);
    expect(board(container, 'b3').hasAttribute('data-missing')).toBe(true);
    // labelled where the board is drawn, in screen px whatever the zoom
    const label = container.querySelector<HTMLElement>('[data-missing-label="b3"]')!;
    expect(label.textContent).toBe('File not received');
    expect(screenBox(label.parentElement!)).toEqual({ left: 2100, top: 0, width: 1080, height: 8192 });
    press(title(container, 'b2'), 500, 0);
    drag(world, 700, 0);
    release(world, 700, 0);
    expect(boardFrame(doc, 'b2')!.x).toBe(500); // a held board's frame is not moved
    expect(container.querySelector('[data-held-banner]')!.textContent).toContain('an unknown tag <blink>');
    expect(container.querySelector('[data-board-handle]')).toBeNull();
  });
});

describe('Insert on a board', () => {
  it('puts a text box on a phone board at the board’s screen type, centred', () => {
    const { doc } = mount();
    openMenu(screen.getByRole('button', { name: 'Insert' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Text box' }));
    const added = readSlide(doc, 'b1').children.find((c) => c.tag === 'p' && c.id !== 'body')!;
    expect(added.style['font-size']).toBeUndefined();
    expect(added.style.width).toBe('312px');
    expect(added.style.left).toBe('39px');
  });

  it('reports the first showing drawn once every board has laid out', async () => {
    const doc = design(BOARDS);
    const drawn: number[] = [];
    const session = new DeckSession(doc, 0);
    render(<DesignWorkbench session={session} view={new DesignView()} assetUrl={() => null} system={null} readOnly={false} onDrawn={(n) => drawn.push(n)} />);
    act(() => flushLayout());
    await act(async () => {});
    expect(drawn).toEqual([3]);
  });
});

describe('a frame gesture beside other writers (task review fix wave)', () => {
  it('a move writes only the position: another replica’s size landing mid-drag stays, in both replicas', () => {
    const { container, doc, world } = mount();
    const { remote, toLocal, toRemote } = remoteOf(doc);
    press(title(container, 'b2'), 0, 0);
    drag(world, 40, 0);
    setBoardFrame(remote, 'b2', { w: 1280, h: 900 }, 'remote');
    toLocal();
    drag(world, 80, 0);
    release(world, 80, 0);
    expect(boardFrame(doc, 'b2')).toEqual({ x: 580, y: 0, w: 1280, h: 900 });
    toRemote();
    expect(boardFrame(remote, 'b2')).toEqual({ x: 580, y: 0, w: 1280, h: 900 });
  });

  it('an east resize writes only the width, measured from the board’s current place: a remote move mid-drag stays', () => {
    const { container, doc, world } = mount();
    const { remote, toLocal } = remoteOf(doc);
    fireEvent.click(title(container, 'b1'));
    press(container.querySelector('[data-board-handle="e"]')!, 390, 400);
    drag(world, 400, 400);
    setBoardFrame(remote, 'b1', { x: 50, y: 60 }, 'remote');
    toLocal();
    drag(world, 410, 400);
    release(world, 410, 400);
    expect(boardFrame(doc, 'b1')).toEqual({ x: 50, y: 60, w: 410, h: 844 });
  });

  it('a drag stops writing, and ends, once the replica turns read-only mid-drag', () => {
    const { container, doc, world, turnReadOnly } = mount();
    press(title(container, 'b2'), 0, 0);
    drag(world, 40, 0);
    expect(boardFrame(doc, 'b2')!.x).toBe(540);
    turnReadOnly();
    drag(world, 100, 0);
    release(world, 100, 0);
    expect(boardFrame(doc, 'b2')!.x).toBe(540);
  });

  it('a drag stops writing once its board turns held, goes missing or is deleted, or the session stops taking writes', () => {
    for (const turn of ['held', 'missing', 'deleted', 'holdWrites'] as const) {
      const { container, doc, world, session } = mount();
      const { remote, toLocal } = remoteOf(doc);
      press(title(container, 'b2'), 0, 0);
      drag(world, 40, 0);
      if (turn === 'holdWrites') session.holdWrites(true);
      else {
        transact(remote, () => {
          if (turn === 'held') Y.setSlideKey(remote, 'b2', 'held', { source: '<section id="b2"><blink>x</blink></section>', reasons: ['an unknown tag <blink>'] });
          else if (turn === 'missing') Y.setSlideKey(remote, 'b2', MISSING_SOURCE_KEY, true);
        });
        if (turn === 'deleted') deleteBoard(remote, 'b2', 'remote');
        toLocal();
      }
      drag(world, 100, 0);
      release(world, 100, 0);
      if (turn === 'deleted') expect(boardOrder(doc), turn).not.toContain('b2');
      else expect(boardFrame(doc, 'b2')!.x, turn).toBe(540);
      expect(container.querySelector('[data-deck-notice]')!.textContent, turn).toBe('');
      cleanup();
    }
  });
});

// P4-B2 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md D17): a board's frame drag holds the replica's remote
// frames from its first move to its drop, as the overlay's gestures do, and its drop writes again the frame keys it
// owns that a held write moved; nothing on a board the flush held, emptied of its file or deleted. The agent is the
// fixtures' `heldPeer` (its writes buffered while held, applied merged at the release).
describe('a frame drag under the gesture hold (P4-B2 D17)', () => {
  const OWNER = 0x100;
  const HIGHER = 0x7fff0000;
  const LOWER = 0x10;

  it('holds the agent’s writes from the first move to the drop; the owner’s position wins whatever the clientIDs, the agent’s size stands', () => {
    for (const clientId of [HIGHER, LOWER]) {
      const doc = design(BOARDS, OWNER);
      const peer = heldPeer(doc, clientId);
      const { container, world } = mount({ doc, holdRemote: peer.holdRemote });
      press(title(container, 'b2'), 0, 0);
      expect(peer.holds, 'a press is no drag yet').toEqual([]);
      drag(world, 40, 0);
      expect(peer.holds).toEqual([true]);
      peer.write((agent) => setBoardFrame(agent, 'b2', { x: 900, w: 1280 }));
      expect(peer.buffered()).toBe(1);
      drag(world, 80, 0);
      expect(boardFrame(doc, 'b2')).toEqual({ x: 580, y: 0, w: 1440, h: 1024 });
      release(world, 80, 0);
      expect(peer.holds, `agent ${clientId}`).toEqual([true, false]);
      expect(boardFrame(doc, 'b2'), `agent ${clientId}`).toEqual({ x: 580, y: 0, w: 1280, h: 1024 });
      applyV1(peer.agent, diffV1(doc, stateVector(peer.agent)));
      expect(boardFrame(peer.agent, 'b2'), `the agent’s replica, agent ${clientId}`).toEqual({ x: 580, y: 0, w: 1280, h: 1024 });
      cleanup();
    }
  });

  it('writes nothing on a board the flush held, emptied of its file or deleted', () => {
    for (const turn of ['held', 'missing', 'deleted'] as const) {
      const doc = design(BOARDS, OWNER);
      const peer = heldPeer(doc, HIGHER);
      const { container, world, session } = mount({ doc, holdRemote: peer.holdRemote });
      press(title(container, 'b2'), 0, 0);
      drag(world, 40, 0);
      peer.write((agent) => setBoardFrame(agent, 'b2', { x: 900 }));
      peer.write((agent) => {
        if (turn === 'held') Y.setSlideKey(agent, 'b2', 'held', { source: '<section id="b2"><blink>x</blink></section>', reasons: ['an unknown tag <blink>'] });
        else if (turn === 'missing') Y.setSlideKey(agent, 'b2', MISSING_SOURCE_KEY, true);
        else deleteBoard(agent, 'b2');
      });
      drag(world, 80, 0);
      let own = 0;
      const off = onUpdate(doc, (_update, origin) => {
        if (origin === session.origin) own += 1;
      });
      release(world, 80, 0);
      off();
      expect(own, turn).toBe(0);
      expect(peer.holds, turn).toEqual([true, false]);
      if (turn === 'deleted') expect(boardOrder(doc), turn).not.toContain('b2');
      else expect(boardFrame(doc, 'b2')!.x, turn).toBe(900);
      cleanup();
    }
  });

  it('a frame drag the world unmounts in ends: the hold released, the drag over', () => {
    const doc = design(BOARDS, OWNER);
    const peer = heldPeer(doc, HIGHER);
    const { container, world, session, unmount } = mount({ doc, holdRemote: peer.holdRemote });
    press(title(container, 'b2'), 0, 0);
    drag(world, 40, 0);
    expect(session.snapshot().dragging).toBe(true);
    unmount();
    expect(peer.holds).toEqual([true, false]);
    expect(session.snapshot().dragging).toBe(false);
  });
});

describe('plain text pasted on a board (task review fix wave)', () => {
  it('lands on a phone board readable: at the board’s screen type, fitted and centred, its text whole, selected', () => {
    const { doc, world, session } = mount();
    world.focus();
    paste(world, { 'text/plain': 'Launch week\nShip it' });
    const added = readSlide(doc, 'b1').children.find((c) => c.tag === 'p' && c.id !== 'body')!;
    expect(added.style['font-size']).toBeUndefined();
    expect([added.style.width, added.style.left]).toEqual(['312px', '39px']);
    expect(added.text).toEqual([{ type: 'p', inline: [{ text: 'Launch week', marks: {} }, { br: true }, { text: 'Ship it', marks: {} }] }]);
    expect(session.snapshot().selection).toEqual([added.id]);
  });

  it('leaves MAWS’s own and HTML slide markup to C’s paste, as authored', () => {
    const { doc, world } = mount();
    world.focus();
    paste(world, { 'text/html': '<section id="clip"><p id="note" style="position:absolute; left:10px; top:10px; width:100px; font-size:20px">Hi</p></section>', 'text/plain': 'Hi' });
    const note = readSlide(doc, 'b1').children.find((c) => c.tag === 'p' && c.id !== 'body')!;
    expect([note.style.width, note.style['font-size']]).toEqual(['100px', '20px']);
  });

  it('pastes nothing on a read-only replica', () => {
    const { doc, world } = mount({ readOnly: true });
    world.focus();
    paste(world, { 'text/plain': 'Nope' });
    expect(readSlide(doc, 'b1').children.map((c) => c.id)).toEqual(['title', 'body']);
  });
});

describe('a gesture outside the world (post-fix gate: a pan crossing into the board list)', () => {
  // The world takes pointer capture, but a drag must not depend on it holding: the mini's pan stopped once the pointer
  // crossed the world's edge into the board list. Moves and the release are followed wherever the pointer goes.
  it('a pan keeps following the pointer past the world’s edge, and its release there ends it', () => {
    const { container, view, world } = mount();
    const ground = container.querySelector('[data-design-ground]')!;
    const rail = screen.getByRole('navigation', { name: 'Boards' });
    press(ground, 60, 300);
    drag(world, 20, 270);
    fireEvent.pointerMove(rail, { buttons: 1, clientX: -20, clientY: 240, pointerId: 1 });
    expect(view.snapshot().viewport).toEqual({ zoom: 1, x: -80, y: -60 });
    fireEvent.pointerUp(rail, { button: 0, clientX: -20, clientY: 240, pointerId: 1 });
    fireEvent.pointerMove(document.body, { buttons: 0, clientX: 500, clientY: 500, pointerId: 1 });
    expect(view.snapshot().viewport).toEqual({ zoom: 1, x: -80, y: -60 }); // ended at the release: no more pan
    expect(world.hasAttribute('data-panning')).toBe(false);
  });

  it('a board move keeps following the pointer past the world’s edge', () => {
    const { container, doc } = mount();
    const rail = screen.getByRole('navigation', { name: 'Boards' });
    press(title(container, 'b2'), 500, 0);
    fireEvent.pointerMove(rail, { buttons: 1, clientX: 440, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(rail, { button: 0, clientX: 440, clientY: 0, pointerId: 1 });
    expect(boardFrame(doc, 'b2')!.x).toBe(440);
  });
});

describe('a fit after the layout moved (the regate: the inspector opened under the world, its resize not yet reported)', () => {
  it('Fit selection reads the world’s size as it is now', () => {
    const { container, view, world } = mount();
    fireEvent.click(title(container, 'b1'));
    // the world shrank (the inspector stacked under it) and no resize has been reported yet
    for (const [k, v] of [['clientWidth', 1000], ['clientHeight', 300]] as const) Object.defineProperty(world, k, { configurable: true, get: () => v });
    fireEvent.change(screen.getByRole('combobox', { name: 'Zoom' }), { target: { value: 'fit-selection' } });
    expect(view.snapshot().room).toEqual({ w: 1000, h: 300 });
    expect(view.snapshot().viewport!.zoom).toBeCloseTo((300 - 96) / 844, 6);
  });
});

/**
 * An element's box on the world's screen, from the inline geometry happy-dom keeps: its own left, top, width and height
 * plus every translation between it and the world (a scaled ancestor makes it unreadable: NaN).
 */
function screenBox(el: HTMLElement): { left: number; top: number; width: number; height: number } {
  let [x, y] = [Number.parseFloat(el.style.left) || 0, Number.parseFloat(el.style.top) || 0];
  for (let a = el.parentElement; a && !a.hasAttribute('data-design-world'); a = a.parentElement) {
    const t = a.style.transform;
    if (!t) continue;
    const m = /^translate\((-?[\d.]+)px, (-?[\d.]+)px\)$/.exec(t);
    if (!m) return { left: NaN, top: NaN, width: NaN, height: NaN };
    x += Number(m[1]);
    y += Number(m[2]);
  }
  return { left: x, top: y, width: Number.parseFloat(el.style.width), height: Number.parseFloat(el.style.height) };
}

describe('the screen chrome in register with the boards (M6: the pan a transform, titles out of the boards’ layer)', () => {
  it('through a pan and a zoom: the layer’s transform, and every title, the frame, its handles and the active overlay over their board', () => {
    const { container, view } = mount();
    fireEvent.click(title(container, 'b2'));
    for (const v of [
      { zoom: 0.5, x: -40, y: 30 },
      { zoom: 0.5, x: 120, y: -60 }, // a pan alone
      { zoom: 0.25, x: 120, y: -60 }, // a zoom alone
    ]) {
      act(() => view.setViewport(v));
      expect(container.querySelector<HTMLElement>('[data-design-layer]')!.style.transform).toBe(`translate(${v.x}px, ${v.y}px) scale(${v.zoom})`);
      const at = (b: (typeof BOARDS)[number]) => ({ left: v.x + b.at.x * v.zoom, top: v.y + b.at.y * v.zoom, width: b.at.w * v.zoom });
      for (const b of BOARDS) {
        const t = screenBox(title(container, b.id));
        expect({ left: t.left, top: t.top, width: t.width }, b.id).toEqual(at(b));
      }
      const desktop = { ...at(BOARDS[1]!), height: BOARDS[1]!.at.h * v.zoom };
      expect(screenBox(container.querySelector<HTMLElement>('[data-active-board="b2"]')!)).toEqual(desktop);
      expect(screenBox(container.querySelector<HTMLElement>('[data-frame-outline="b2"]')!)).toEqual(desktop);
      expect(screenBox(container.querySelector<HTMLElement>('[data-board-handle="e"]')!.parentElement!)).toEqual(desktop);
    }
  });

  it('a title shows its board’s size only with room for it; its name and size are always its tooltip and name', () => {
    const { container, view } = mount();
    const phone = title(container, 'b1');
    expect(phone.textContent).toBe('Phone390 × 844');
    act(() => view.setViewport({ zoom: 0.25, x: 0, y: 0 })); // 97.5 px of room
    expect(phone.textContent).toBe('Phone');
    expect([phone.getAttribute('title'), phone.getAttribute('aria-label')]).toEqual(['Phone, 390 × 844', 'Board Phone']);
  });

  it('the toolbar’s zoom follows the view’s zoom, and the inspector’s element box is read at the zoom of the moment', () => {
    const { view, session } = mount();
    act(() => view.setZoom(0.5));
    expect(screen.getByRole('combobox', { name: 'Zoom' }).querySelector('option[value="current"]')!.textContent).toBe('50%');
    act(() => session.select(['title']));
    act(() => view.setZoom(2));
    expect(screen.getByRole('combobox', { name: 'Zoom' }).querySelector('option[value="current"]')!.textContent).toBe('200%');
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toBeTruthy();
  });
});

describe('what a frame of a gesture costs (DL39’s bounded wave: work proportional to what changed)', () => {
  it('a zoom or a pan formats no board’s size again; a title crossing the 160 px room does, once', () => {
    const { container, view } = mount();
    const size = vi.spyOn(DESIGN_COPY, 'size');
    act(() => view.setViewport({ zoom: 0.9, x: 0, y: 0 }));
    act(() => view.setViewport({ zoom: 0.8, x: 30, y: -10 }));
    act(() => view.setViewport({ zoom: 0.8, x: 60, y: -20 })); // a pan alone
    expect(size).not.toHaveBeenCalled();
    act(() => view.setViewport({ zoom: 0.3, x: 0, y: 0 })); // the phone's title (117 px) loses its size; the others keep theirs
    expect(title(container, 'b1').textContent).toBe('Phone');
    expect(title(container, 'b2').textContent).toBe('Desktop1,440 × 1,024');
    expect(size.mock.calls.length).toBeLessThanOrEqual(1);
    size.mockRestore();
  });

  it('one board’s frame write renders that board’s list row and title alone; the list’s other rows and titles are untouched', () => {
    const { doc, session } = mount();
    const row = vi.spyOn(DESIGN_COPY, 'boardRow');
    const size = vi.spyOn(DESIGN_COPY, 'size');
    act(() => session.edit((origin) => setBoardFrame(doc, 'b2', { x: 640 }, origin)));
    expect(row.mock.calls.map((c) => c[0])).toEqual(['Desktop']);
    expect(new Set(size.mock.calls.map((c) => `${c[0]}×${c[1]}`))).toEqual(new Set(['1440×1024']));
    row.mockRestore();
    size.mockRestore();
  });
});

describe('the board inspector beside other writers (design-workbench fix wave)', () => {
  it('(scalpel-2#1) a frame or name draft pending when the replica turns read-only, the board held or missing, or writes held, commits nothing on blur', () => {
    for (const turn of ['readOnly', 'held', 'missing', 'holdWrites'] as const)
      for (const field of ['Board width', 'Board name'] as const) {
        const { container, doc, session, turnReadOnly } = mount();
        const { remote, toLocal } = remoteOf(doc);
        fireEvent.click(title(container, 'b1'));
        fireEvent.change(screen.getByRole('textbox', { name: field }), { target: { value: field === 'Board width' ? '834' : 'Phone, tall' } });
        if (turn === 'readOnly') turnReadOnly();
        else if (turn === 'holdWrites') act(() => session.holdWrites(true));
        else {
          transact(remote, () => {
            if (turn === 'held') Y.setSlideKey(remote, 'b1', 'held', { source: '<section id="b1"><blink>x</blink></section>', reasons: ['an unknown tag <blink>'] });
            else Y.setSlideKey(remote, 'b1', MISSING_SOURCE_KEY, true);
          });
          toLocal();
        }
        fireEvent.blur(screen.getByRole('textbox', { name: field })); // as disabling the focused field fires it
        expect(boardFrame(doc, 'b1')!.w, `${turn}, ${field}`).toBe(390);
        expect(Y.slideScalars(doc, 'b1').title, `${turn}, ${field}`).toBe('Phone');
        expect(session.undo.canUndo(), `${turn}, ${field}: nothing on the undo stack`).toBe(false);
        // the refused draft is dropped, not kept for a later blur to commit: the field shows the board's value again
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: field }).value, `${turn}, ${field}: the field`).toBe(field === 'Board width' ? '390' : 'Phone');
        cleanup();
      }
  });
});

// P4-B4 (the link grammar; "Opening at a place"): a link's `#slide=` names a design's board: it is selected and brought
// into view, as a shown thread's board is; a board the design does not have changes nothing; each reveal is taken once
describe('a board a link names', () => {
  it('is selected and brought into view; one the design does not have changes nothing', () => {
    const { session, view, rerender } = mount();
    const revealed = vi.fn();
    const at = (slide: string, serial: number) => rerender(<DesignWorkbench session={session} view={view} assetUrl={ASSET_URL} system={null} readOnly={false} reveal={{ serial, location: { slide } }} onRevealed={revealed} />);
    act(() => at('b3', 1)); // the poster, out of the 1000 × 800 room at zoom 1
    expect(session.snapshot().currentSlide).toBe('b3');
    expect(view.snapshot().frame).toBe('b3');
    const { zoom, x } = view.snapshot().viewport!;
    expect(x + 2100 * zoom).toBeLessThan(1000); // its left edge now inside the room
    act(() => at('gone', 2));
    expect(session.snapshot().currentSlide).toBe('b3');
    expect(view.snapshot().frame).toBe('b3');
    expect(revealed.mock.calls).toEqual([[1], [2]]);
  });
});
