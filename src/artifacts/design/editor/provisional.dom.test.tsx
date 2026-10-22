// P4-A2 G2.4 (docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md, G-R6 with G-R3 and G-R4 per board; §4.2's
// four rules): a publish drawn as it streams in the design's world, under happy-dom, through the workbench's own wiring
// (the layers' store given to `DesignWorkbench`, the replica standing in for the port, the host's real canvas publish
// making the write): each board a file names takes the deck's layer on its own canvas, whichever board is active, its
// marks screen-sized at the world's zoom; the human's elements protected on the active board alone; the withdrawal and
// the write in one call, under a frame drag's hold at the drop; a new board drawn whole at its frame once canvas.json's
// entry for it parses whole, the board list showing nothing new; a refusal leaving no trace. happy-dom lays nothing out,
// so the boxes the layer compares are given by element.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyV2, diffV1, newDoc, stateV2, stateVector, transact } from '../../yjs';
import { flushLayout } from '../../slides/canvas';
import { setStyle } from '../../slides/model';
import { publishFrame, replica } from '../../slides/editor/provisional/testing';
import { DeckSession } from '../../slides/editor/session';
import { boardPath, CANVAS_PATH } from '../canvas';
import { design, type BoardSeed } from '../fixtures/support';
import { boardFrame, boardOrder, designFiles } from '../model';
import { publishCanvas } from '../publish';
import { setBoardFrame } from '../writers';
import { DesignWorkbench } from './DesignWorkbench';
import { DesignView } from './viewport';
import layerSheet from '../../slides/editor/provisional/provisional.css?raw';
import worldSheet from './workbench.css?raw';

const BOARDS: BoardSeed[] = [
  { id: 'b1', at: { x: 0, y: 0, w: 390, h: 844 }, title: 'Phone' },
  { id: 'b2', at: { x: 500, y: 0, w: 1440, h: 1024 }, title: 'Desktop' },
];
const NEW = '<section id="b3" style="background:#ffffff"><h1 id="t3" style="font-size:72px">Pricing</h1></section>';
const NEW_ENTRY = { x: 2100, y: 40, w: 800, h: 600, title: 'Pricing' };

type Rect = [left: number, top: number, width: number, height: number];
const boxes = { live: new Map<string, Rect>(), ghost: new Map<string, Rect>() };

const LABEL: Rect = [8, 8, 160, 20]; // the label's box in its own px, at its board's top left

/** Whether a node paints under the sheets: no transparent ancestor (opacity multiplies down), not itself hidden. */
const paints = (node: Element) => {
  for (let n: Element | null = node; n; n = n.parentElement) if (getComputedStyle(n).opacity === '0') return false;
  return getComputedStyle(node).visibility !== 'hidden';
};
let styles: HTMLStyleElement | null = null;

beforeEach(() => {
  styles = document.head.appendChild(Object.assign(document.createElement('style'), { textContent: `${layerSheet}\n${worldSheet}` })); // the sheets, applied
  // the layer reads boxes on screen: an element's box is given here in its board's px by its canvas and key (zero else),
  // placed at its board's (or new board's) place in the world and drawn at the world's zoom as the layer's transform says
  // it now; the label's own box at its counter-scale too
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const transform = this.closest<HTMLElement>('[data-design-layer]')?.style.transform ?? '';
    const zoom = Number(/scale\(([^)]+)\)/.exec(transform)?.[1] ?? 1);
    const frame = this.closest<HTMLElement>('.design-board');
    const [x, y] = [Number.parseFloat(frame?.style.left ?? '') || 0, Number.parseFloat(frame?.style.top ?? '') || 0];
    let rect: Rect;
    if (this === frame) rect = [0, 0, Number.parseFloat(frame.style.width) || 0, Number.parseFloat(frame.style.height) || 0];
    else if (this.hasAttribute('data-provisional-label')) {
      const own = Number(this.parentElement!.style.getPropertyValue('--provisional-label-scale') || 1);
      rect = [LABEL[0] * own, LABEL[1] * own, LABEL[2] * own, LABEL[3] * own];
    } else {
      const root = this.closest('section.maws-slide');
      const table = root?.hasAttribute('data-provisional-ghost') ? boxes.ghost : boxes.live;
      const board = this.closest<HTMLElement>('[data-board-id]')?.dataset.boardId;
      rect = (this.dataset.eid && table.get(`${board}/${this.dataset.eid}`)) || [0, 0, 0, 0];
    }
    const [left, top, width, height] = [rect[0] + x, rect[1] + y, rect[2], rect[3]].map((v) => v * zoom) as Rect;
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
  });
});
afterEach(() => {
  styles?.remove();
  cleanup();
  vi.restoreAllMocks();
  boxes.live.clear();
  boxes.ghost.clear();
});

/** A design as the agent's read returns it, and a copy as the host holds it, whose canvas publish makes the write. */
function designWorld() {
  const doc = design(BOARDS);
  const host = newDoc();
  applyV2(host, stateV2(doc));
  return {
    doc,
    file: (id: string) => designFiles(doc)[boardPath(id)]!,
    /** canvas.json as read, with new boards' entries added (named last in the order); `b3`'s by default. */
    manifest(entries: Record<string, unknown> = { b3: NEW_ENTRY }): string {
      const read = JSON.parse(designFiles(doc)[CANVAS_PATH]!) as { boards: Record<string, unknown>; order: string[] };
      for (const [id, entry] of Object.entries(entries)) {
        read.boards[id] = entry;
        read.order.push(id);
      }
      return JSON.stringify(read);
    },
    /** The agent's files written on the host; the update the replica will be sent. */
    publish(sent: Readonly<Record<string, string>>): Uint8Array {
      const before = stateVector(doc);
      const out = publishCanvas(host, designFiles(host), sent, false);
      if (out.conflicts.length) throw new Error(`refused: ${JSON.stringify(out.conflicts)}`);
      return diffV1(host, before);
    },
  };
}

function mount(zoom = 1) {
  const world = designWorld();
  const live = replica(world.doc);
  const stopLayers = live.layers.attach(); // the tab's state attaches its store
  const session = new DeckSession(world.doc, 0, { holdRemote: live.holdRemote });
  const view = new DesignView();
  view.setRoom({ w: 1000, h: 800 });
  view.setViewport({ zoom, x: 0, y: 0 });
  const utils = render(<DesignWorkbench session={session} view={view} assetUrl={() => null} system={null} readOnly={false} provisional={live.layers} />);
  const q = (selector: string) => utils.container.querySelector<HTMLElement>(selector);
  const all = (selector: string) => [...utils.container.querySelectorAll<HTMLElement>(selector)];
  const on = (id: string) => {
    const at = `[data-board-id="${id}"]`;
    const board = {
      layer: () => q(`${at} [data-provisional-layer="${id}"]`),
      label: () => q(`${at} [data-provisional-label]`)?.textContent ?? null,
      ghost: () => q(`${at} section[data-provisional-ghost]`),
      shown: () => Object.fromEntries(all(`${at} [data-provisional-ghost] [data-provisional-shown]`).map((n) => [n.dataset.provisionalKey, n.dataset.provisionalShown])),
      veiled: () => all(`${at} .design-board-canvas .maws-slide [data-provisional-veiled]`).map((n) => n.dataset.provisionalVeiled).sort(),
      held: () => board.layer()?.dataset.provisionalHeld ?? '',
      text: (eid: string) => q(`${at} .design-board-canvas .maws-slide [data-eid="${eid}"]`)?.textContent ?? null,
      ghostText: (eid: string) => q(`${at} [data-provisional-ghost] [data-provisional-key="${eid}"]`)?.textContent ?? null,
    };
    return board;
  };
  const stream = (files: Record<string, string>, id = 'call1') => act(() => live.frame(publishFrame(id, 'streaming', files)));
  return { ...world, live, session, view, ...utils, q, all, on, stream, stop: stopLayers };
}

const edit = (file: string, ...pairs: [string, string][]) => pairs.reduce((text, [from, to]) => (expect(text).toContain(from), text.replace(from, to)), file);

describe('the design’s provisional layer on its boards', () => {
  it('draws a board’s layer on that board whichever board is active, its ghost at the board’s size as it changes, beneath the world’s overlay', () => {
    const w = mount();
    const before = stateVector(w.doc);
    expect(w.session.snapshot().currentSlide, 'the human is on the phone board').toBe('b1');
    expect(w.on('b2').layer(), 'no layer on a board nothing writes').toBeNull();

    const next = edit(w.file('b2'), ['Title b2', 'Pricing']);
    w.stream({ [boardPath('b2')]: next.slice(0, next.indexOf('Pricing') + 3) });
    const b2 = w.on('b2');
    expect(b2.label()).toBe('Fix the dates is writing…');
    expect(b2.layer()!.dataset.provisionalWriting).toBe('call1');
    expect(b2.shown()).toEqual({ title: 'changed' });
    expect(b2.ghostText('title')).toBe('Pri');
    expect(b2.veiled()).toEqual(['title']);
    expect(b2.text('title'), 'the live board is the live board').toBe('Title b2');
    expect(w.on('b1').layer(), 'the active board untouched').toBeNull();
    expect(w.session.snapshot().currentSlide, 'the view never follows the agent').toBe('b1');

    expect(stateVector(w.doc), 'nothing is written into the live doc').toEqual(before);

    // the ghost draws at the board's size, and follows a resize made meanwhile
    expect([b2.ghost()!.style.width, b2.ghost()!.style.height]).toEqual(['1440px', '1024px']);
    act(() => transact(w.doc, () => setBoardFrame(w.doc, 'b2', { w: 1280 }), 'remote'));
    expect(b2.ghost()!.style.width).toBe('1280px');
    expect(b2.layer()!.style.width).toBe('1280px');

    // nothing focusable or named, in the boards' layer beneath the world's screen chrome and the overlay
    const layer = b2.layer()!;
    expect(layer.hasAttribute('inert')).toBe(true);
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    expect(layer.querySelectorAll('[tabindex], [role], [aria-label], button, input, [contenteditable]')).toHaveLength(0);
    expect(layer.closest('[data-design-layer]')).not.toBeNull();
    expect(w.q('[data-design-layer]')!.compareDocumentPosition(w.q('[data-active-board]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps its label and outlines screen-sized at the world’s zoom, followed without a render', () => {
    const w = mount(0.5);
    w.stream({ [boardPath('b2')]: edit(w.file('b2'), ['Title b2', 'Pricing']) });
    const layer = w.on('b2').layer()!;
    expect(layer.style.getPropertyValue('--provisional-label-scale')).toBe('2');
    expect(layer.style.getPropertyValue('--provisional-outline')).toBe('4px');
    act(() => w.view.setViewport({ zoom: 2, x: 10, y: 10 }));
    expect(layer.style.getPropertyValue('--provisional-label-scale')).toBe('0.5');
    expect(layer.style.getPropertyValue('--provisional-outline')).toBe('1px');
  });

  it('holds the label once a zoom brings it over the human’s text box, judged after the world’s transform and the label’s counter-scale both change', async () => {
    const w = mount();
    boxes.live.set('b1/title', [0, 64, 390, 60]); // clear of the label at zoom 1; under it at 0.25 (screen y 16)
    act(() => w.session.editText('title'));
    w.stream({ [boardPath('b1')]: edit(w.file('b1'), ['Body of b1', 'Monthly']) });
    const label = () => w.q('[data-board-id="b1"] [data-provisional-label]')!;
    expect(label().hasAttribute('data-provisional-held'), 'clear of the text box').toBe(false);
    await act(async () => w.view.setViewport({ zoom: 0.25, x: 0, y: 0 }));
    expect(label().hasAttribute('data-provisional-held'), 'over it after zooming out, with no other change').toBe(true);
    await act(async () => w.view.setViewport({ zoom: 1, x: 40, y: 0 }));
    expect(label().hasAttribute('data-provisional-held'), 'clear again').toBe(false);
  });

  it('protects the human’s elements on the active board alone, and follows the active board', () => {
    const w = mount();
    boxes.live.set('b1/title', [0, 0, 390, 80]);
    boxes.ghost.set('b1/title', [0, 0, 390, 80]);
    boxes.live.set('b2/title', [0, 0, 1440, 80]);
    boxes.ghost.set('b2/title', [0, 0, 1440, 80]);
    act(() => w.session.editText('title'));
    w.stream({
      [boardPath('b1')]: edit(w.file('b1'), ['Title b1', 'Plans'], ['Body of b1', 'Monthly']),
      [boardPath('b2')]: edit(w.file('b2'), ['Title b2', 'Pricing']),
    });
    const [b1, b2] = [w.on('b1'), w.on('b2')];
    expect(b1.shown(), 'EDIT on the active board: its element waits').toEqual({ body: 'changed' });
    expect(b1.held()).toBe('title');
    expect(b1.text('title'), 'the human’s text box untouched').toBe('Title b1');
    expect(b2.shown(), 'the same id on another board is not the human’s').toEqual({ title: 'changed' });
    expect(b2.held()).toBe('');

    act(() => {
      w.session.editText(null);
      w.session.select([]);
    });
    expect(b1.shown(), 'drawn at the change that ends the protection').toEqual({ title: 'changed', body: 'changed' });

    // the human moves to the desktop board and arms its title: the protection goes with the active board
    act(() => {
      w.session.show('b2');
      w.session.setKeyboard('stage');
      w.session.select(['title']);
    });
    expect(b2.shown()).toEqual({});
    expect(b2.held()).toBe('title');
    expect(b1.shown()).toEqual({ title: 'changed', body: 'changed' });
    expect(b1.held()).toBe('');
  });

  it('withdraws a board’s layer in the call that applies the write, and under a frame drag’s hold at the drop', () => {
    const w = mount();
    const next = edit(w.file('b2'), ['Title b2', 'Pricing']);
    w.stream({ [boardPath('b2')]: next });
    const b2 = w.on('b2');
    const update = w.publish({ [boardPath('b2')]: next });
    act(() => {
      w.live.frame(publishFrame('call1', 'committed', {}, 5));
      expect(b2.shown(), 'committed: kept until the replica holds the row').toEqual({ title: 'changed' });
      w.live.update(update, 5);
      expect(b2.text('title')).toBe('Pricing');
      expect(b2.ghost()).toBeNull();
      expect(b2.veiled()).toEqual([]);
      expect(b2.label()).toBeNull();
    });

    const later = edit(w.file('b2'), ['Body of b2', 'Per seat']);
    act(() => w.session.beginDrag()); // a board's frame dragged: the session's gesture hold
    w.stream({ [boardPath('b2')]: later }, 'call2');
    act(() => {
      w.live.frame(publishFrame('call2', 'committed', {}, 6));
      w.live.update(w.publish({ [boardPath('b2')]: later }), 6);
    });
    expect(b2.text('body'), 'held with the drag').toBe('Body of b2');
    expect(b2.shown()).toEqual({ body: 'changed' });
    act(() => {
      w.session.endDrag();
      expect(b2.text('body'), 'the drop applies the write').toBe('Per seat');
      expect(b2.ghost()).toBeNull();
      expect(b2.veiled()).toEqual([]);
      expect(b2.label()).toBeNull();
    });
  });
});

describe('a board new to the design', () => {
  const ghost = (w: ReturnType<typeof mount>) => w.q('[data-design-layer] [data-provisional-new-board="b3"]');
  const listed = () => within(screen.getByRole('navigation', { name: 'Boards' })).getAllByRole('button', { name: /×/ }).length;

  it('is drawn whole at its frame once canvas.json’s entry for it parses whole, the board list showing nothing new, then swapped for the real board', () => {
    const w = mount();
    const rows = listed();
    const manifest = w.manifest();
    w.stream({ [boardPath('b3')]: NEW.slice(0, NEW.indexOf('Pricing') + 3) });
    expect(ghost(w), 'no place before canvas.json names it').toBeNull();
    const entryEnds = manifest.indexOf('"title":"Pricing"}') + '"title":"Pricing"}'.length;
    w.stream({ [CANVAS_PATH]: manifest.slice(0, entryEnds - 1) });
    expect(ghost(w), 'nor while its entry is open').toBeNull();

    w.stream({ [CANVAS_PATH]: manifest.slice(0, entryEnds) });
    const board = ghost(w)!;
    expect(board.dataset.provisionalFrame).toBe('2100 40 800 600');
    expect([board.style.left, board.style.top, board.style.width, board.style.height]).toEqual(['2100px', '40px', '800px', '600px']);
    expect(board.dataset.provisionalWriting).toBe('call1');
    expect(board.querySelector('[data-provisional-label]')!.textContent).toBe('Fix the dates is writing…');
    const slide = board.querySelector<HTMLElement>('[data-provisional-thumb="b3"] section.maws-slide')!;
    expect([slide.style.width, slide.style.height], 'drawn at its own size').toEqual(['800px', '600px']);
    expect(slide.querySelector('[data-eid="t3"]')!.textContent).toBe('Pri');
    expect(board.hasAttribute('inert')).toBe(true);
    expect(board.getAttribute('aria-hidden')).toBe('true');
    expect(board.querySelectorAll('button, [tabindex], [role], [aria-label]')).toHaveLength(0);
    expect(w.q('[data-board-id="b3"]'), 'no board of the world').toBeNull();
    expect(listed(), 'the board list shows nothing new').toBe(rows);

    w.stream({ [boardPath('b3')]: NEW, [CANVAS_PATH]: manifest });
    expect(ghost(w)!.querySelector('[data-eid="t3"]')!.textContent).toBe('Pricing');
    act(() => {
      w.live.frame(publishFrame('call1', 'committed', {}, 7));
      w.live.update(w.publish({ [boardPath('b3')]: NEW, [CANVAS_PATH]: manifest }), 7);
      // withdrawn in this call, swapped for the real board in React's next render: until then the ghost still paints
      expect(ghost(w)?.querySelector('[data-provisional-thumb="b3"] section.maws-slide [data-eid="t3"]')?.textContent, 'the new board keeps its drawing until React unmounts it').toBe('Pricing');
    });
    expect(boardOrder(w.doc)).toEqual(['b1', 'b2', 'b3']);
    expect(boardFrame(w.doc, 'b3'), 'where the ghost stood').toEqual({ x: 2100, y: 40, w: 800, h: 600 });
    expect(ghost(w)).toBeNull();
    expect(w.all('[data-board-id="b3"]'), 'one board, the real one').toHaveLength(1);
    expect(w.q('[data-board-id="b3"] .design-board-canvas [data-eid="t3"]')!.textContent).toBe('Pricing');
    expect(w.q('[data-board-id="b3"] [data-provisional-layer]')).toBeNull();
  });

  it('places each call’s new board by its own canvas.json while two publishes stream at once', () => {
    const w = mount();
    const b4 = NEW.replaceAll('b3', 'b4').replace('t3', 't4').replace('Pricing', 'Team');
    w.stream({ [boardPath('b3')]: NEW, [CANVAS_PATH]: w.manifest() }, 'callA');
    expect(ghost(w)!.dataset.provisionalFrame).toBe('2100 40 800 600');
    w.stream({ [boardPath('b4')]: b4, [CANVAS_PATH]: w.manifest({ b4: { x: 3000, y: 40, w: 400, h: 300 } }) }, 'callB');
    const b4Ghost = () => w.q('[data-provisional-new-board="b4"]');
    expect(ghost(w)?.dataset.provisionalFrame, 'call A’s board kept at its own place').toBe('2100 40 800 600');
    expect(ghost(w)!.dataset.provisionalWriting).toBe('callA');
    expect(b4Ghost()?.dataset.provisionalFrame).toBe('3000 40 400 300');
    expect(b4Ghost()!.dataset.provisionalWriting).toBe('callB');
    act(() => w.live.frame(publishFrame('callB', 'dropped')));
    expect(ghost(w)?.dataset.provisionalFrame).toBe('2100 40 800 600');
    expect(b4Ghost()).toBeNull();
  });

  it('is held whole while its frame meets the human’s text box on the active board, rechecked as the box grows, the protection changes and the frame moves', () => {
    const w = mount();
    boxes.live.set('b1/title', [0, 300, 50, 20]); // the phone's title, clear of the new board's frame
    act(() => w.session.editText('title'));
    // the new board's file carries a raw svg whose rect asks to be visible
    const art = '<svg id="art" width="120" height="120" viewBox="0 0 120 120"><rect style="visibility:visible" width="120" height="120" fill="#2b7a78"/></svg>';
    w.stream({ [boardPath('b3')]: NEW.replace('</section>', `${art}</section>`), [CANVAS_PATH]: w.manifest({ b3: { x: 100, y: 50, w: 200, h: 200 } }) }); // over the phone
    const held = () => ghost(w)!.hasAttribute('data-provisional-held');
    const painted = () => Array.from(ghost(w)!.querySelectorAll('*')).filter((node) => paints(node));
    expect(held(), 'clear of the text box: drawn').toBe(false);
    expect(paints(ghost(w)!.querySelector('rect')!)).toBe(true);
    // the text box grows under the frame (the human typing): held from the active board's next layout pass
    boxes.live.set('b1/title', [0, 64, 390, 60]);
    act(() => {
      setStyle(w.doc, 'b1', 'title', { 'font-size': '80px' }, 'remote');
      flushLayout();
    });
    expect(held(), 'over the text the human edits').toBe(true);
    expect(painted(), 'nothing of it paints, its label and the svg’s visible rect included').toEqual([]);
    act(() => {
      w.session.editText(null);
      w.session.select([]);
    });
    expect(held(), 'drawn once the protection ends').toBe(false);
    expect(paints(ghost(w)!.querySelector('[data-eid="t3"]')!)).toBe(true);
    act(() => {
      w.session.setKeyboard('stage');
      w.session.select(['title']);
    });
    expect(held(), 'ARMED: the same').toBe(true);
    w.stream({ [CANVAS_PATH]: w.manifest({ b3: { x: 100, y: 400, w: 200, h: 200 } }) });
    expect(ghost(w)!.dataset.provisionalFrame).toBe('100 400 200 200');
    expect(held(), 'its frame streamed clear of the box').toBe(false);
  });

  it('is held while its screen-sized label meets the human’s text box after a zoom, though its frame does not', async () => {
    const w = mount();
    boxes.live.set('b1/title', [0, 64, 390, 60]);
    act(() => w.session.editText('title'));
    w.stream({ [boardPath('b3')]: NEW, [CANVAS_PATH]: w.manifest({ b3: { x: 0, y: 0, w: 390, h: 60 } }) }); // ends above the title
    const held = () => ghost(w)!.hasAttribute('data-provisional-held');
    expect(held()).toBe(false);
    await act(async () => w.view.setViewport({ zoom: 0.25, x: 0, y: 0 })); // the label four times the frame's px
    expect(held(), 'the label over the text box').toBe(true);
    await act(async () => w.view.setViewport({ zoom: 1, x: 0, y: 0 }));
    expect(held()).toBe(false);
  });

  it('leaves no trace at a refusal, on the boards or in the world', () => {
    const w = mount();
    w.stream({ [boardPath('b2')]: edit(w.file('b2'), ['Title b2', 'Pricing']), [boardPath('b3')]: NEW, [CANVAS_PATH]: w.manifest() });
    expect(w.on('b2').veiled()).toEqual(['title']);
    expect(ghost(w)).not.toBeNull();
    act(() => w.live.frame(publishFrame('call1', 'dropped')));
    expect(w.on('b2').layer()).toBeNull();
    expect(w.on('b2').veiled()).toEqual([]);
    expect(ghost(w)).toBeNull();
    expect(w.all('[data-provisional-ghost], [data-provisional-label], [data-provisional-writing], [data-provisional-new-board]')).toEqual([]);
    expect(w.on('b2').text('title')).toBe('Title b2');
  });

  it('keeps its label and ring screen-sized at the world’s zoom', () => {
    const w = mount(0.25);
    w.stream({ [boardPath('b3')]: NEW, [CANVAS_PATH]: w.manifest() });
    const board = ghost(w)!;
    expect(board.style.getPropertyValue('--provisional-label-scale')).toBe('4');
    expect(board.style.getPropertyValue('--provisional-outline')).toBe('8px');
  });
});
