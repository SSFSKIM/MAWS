// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Stage and overlay", "Transform layer"; the final
// fix wave's B7 and B8): what the overlay and a flow drag read from layout. The overlay's handles and other replicas'
// outlines follow a layout pass that moved an element with no deck write (a face arriving, a design-system restyle, a
// fit); a flow child dropped in a grid, a row-reverse or a column-reverse lands in the slot under the pointer, its
// insertion bar there. happy-dom lays nothing out: the boxes are given to the nodes here.
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newDoc, transact, type Doc } from '../../../yjs';
import { SlideCanvas } from '../../canvas';
import { childLists, importSlide, readFlat, writeDeckKeys } from '../../model';
import { loadSlide } from '../../parse';
import { DeckSession } from '../session';
import { startFlowMove } from './gestures';
import { measureAll } from './measure';
import { Overlay } from './Overlay';

// the overlay's own measures counted (B7 follow-up): `measureAll` as it is, watched
vi.mock('./measure', async (original) => {
  const actual = await original<typeof import('./measure')>();
  return { ...actual, measureAll: vi.fn(actual.measureAll) };
});
/** The overlay's selection measures (a Set of ids; the gestures' and hit tests' measures pass arrays). */
const overlayMeasures = () => vi.mocked(measureAll).mock.calls.filter(([, ids]) => ids instanceof Set).length;

function deck(html: string): Doc {
  const doc = newDoc();
  const l = loadSlide(html);
  if (!l.ok) throw new Error(l.held.reasons.join('; '));
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'T', order: ['s'] });
    importSlide(doc, l.slide, 'a0');
  });
  return doc;
}

type Rect = [number, number, number, number];
/** Gives a node its layout box (offsets from its nearest positioned ancestor, else the slide). */
function place(canvas: SlideCanvas, id: string, [x, y, w, h]: Rect): void {
  const n = canvas.node(id)!;
  const hostOf = () => {
    for (let p = n.parentElement; p && p !== canvas.root; p = p.parentElement) if (p.style.position === 'absolute') return p;
    return canvas.root;
  };
  Object.defineProperty(n, 'offsetLeft', { configurable: true, get: () => x });
  Object.defineProperty(n, 'offsetTop', { configurable: true, get: () => y });
  Object.defineProperty(n, 'offsetWidth', { configurable: true, get: () => w });
  Object.defineProperty(n, 'offsetHeight', { configurable: true, get: () => h });
  Object.defineProperty(n, 'offsetParent', { configurable: true, get: hostOf });
}

const canvases: SlideCanvas[] = [];
function canvasOf(doc: Doc, boxes: Record<string, Rect>): SlideCanvas {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const canvas = new SlideCanvas(doc, 's', host);
  canvases.push(canvas);
  for (const [id, r] of Object.entries(boxes)) place(canvas, id, r);
  return canvas;
}
afterEach(() => {
  cleanup();
  canvases.splice(0).forEach((c) => c.dispose());
  document.body.replaceChildren();
});

describe('B7: the overlay follows a layout pass with no deck write', () => {
  it('the handles and another replica’s outline move with an element a layout pass moved', async () => {
    const { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } = await import('@y/protocols/awareness');
    const doc = deck(`<section id="s" style="background:#ffffff">
<div id="a" style="position:absolute; left:300px; top:300px; width:200px; height:100px; background:#ff0000"></div>
<div id="b" style="position:absolute; left:900px; top:300px; width:100px; height:100px; background:#0000ff"></div></section>`);
    const canvas = canvasOf(doc, { a: [300, 300, 200, 100], b: [900, 300, 100, 100] });
    const other = newDoc();
    const mine = new Awareness(doc);
    const theirs = new Awareness(other);
    const session = new DeckSession(doc, 0, { presence: { awareness: mine, name: 'You', color: '--author-1' } });
    function Harness() {
      const surface = useRef<HTMLDivElement>(null);
      const frame = useRef<HTMLDivElement>(null);
      return (
        <div ref={surface}>
          <div ref={frame}>
            <Overlay session={session} canvas={canvas} slideId="s" scale={0.5} readOnly={false} surface={surface} frame={frame} />
          </div>
        </div>
      );
    }
    const { container } = render(<Harness />);
    theirs.setLocalState({ name: 'Claude', color: '--author-3', deck: { slideId: 's', elementIds: ['b'] } });
    act(() => applyAwarenessUpdate(mine, encodeAwarenessUpdate(theirs, [other.clientID]), 'remote'));
    act(() => session.select(['a']));
    const se = () => container.querySelector<HTMLElement>('[data-handle="se"]')!;
    const outline = () => container.querySelector('[data-remote-selected="b"]')!.getAttribute('points');
    expect([se().style.left, se().style.top]).toEqual(['250px', '200px']);
    expect(outline()).toBe('450,150 500,150 500,200 450,200');
    // a restyle the deck never wrote (a token's new value): both elements laid out elsewhere, then the canvas's pass
    place(canvas, 'a', [600, 400, 200, 100]);
    place(canvas, 'b', [1000, 500, 100, 100]);
    act(() => canvas.layoutNow());
    expect([se().style.left, se().style.top]).toEqual(['400px', '250px']);
    expect(outline()).toBe('500,250 550,250 550,300 500,300');
    mine.destroy();
    theirs.destroy();
  });
});

describe('B7 follow-up: a drag measures the overlay once a frame', () => {
  const SLIDE = `<section id="s" style="background:#ffffff">
<div id="a" style="position:absolute; left:300px; top:300px; width:200px; height:100px; background:#ff0000"></div></section>`;
  function mountOverlay() {
    const doc = deck(SLIDE);
    const canvas = canvasOf(doc, { a: [300, 300, 200, 100] });
    const session = new DeckSession(doc, 0);
    function Harness() {
      const surface = useRef<HTMLDivElement>(null);
      const frame = useRef<HTMLDivElement>(null);
      return (
        <div ref={surface}>
          <div ref={frame}>
            <Overlay session={session} canvas={canvas} slideId="s" scale={0.5} readOnly={false} surface={surface} frame={frame} />
          </div>
        </div>
      );
    }
    const { container } = render(<Harness />);
    act(() => session.select(['a']));
    const se = () => container.querySelector<HTMLElement>('[data-handle="se"]')!;
    const pointer = (type: string, target: Element, x: number, y: number) => act(() => void target.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y })));
    // the moves and the release reach the surface (the pointer is captured there; the handles hide while dragging)
    const surface = container.firstElementChild!;
    return { doc, canvas, se, pointer, surface };
  }

  it('each move writes and its layout pass follows: one overlay measure a move, not two', () => {
    const { doc, canvas, se, pointer, surface } = mountOverlay();
    pointer('pointerdown', se(), 250, 200);
    const before = overlayMeasures();
    const MOVES = 5;
    for (let i = 1; i <= MOVES; i++) {
      pointer('pointermove', surface, 250 + 10 * i, 200 + 5 * i); // the resize writes the frame
      act(() => canvas.layoutNow()); // the canvas's layout pass after the write, as the next animation frame runs it
    }
    expect(readFlat(doc, 's').find((e) => e.id === 'a')!.style.width).toBe('300px'); // every move wrote
    expect(overlayMeasures() - before).toBe(MOVES);
    pointer('pointerup', surface, 300, 225);
  });

  it('a layout pass during a gesture is not lost: the overlay catches up when the gesture ends', () => {
    const { canvas, se, pointer, surface } = mountOverlay();
    pointer('pointerdown', se(), 250, 200);
    pointer('pointermove', surface, 260, 205);
    // geometry the deck never wrote moves during the drag (a face arriving), with the canvas's pass
    place(canvas, 'a', [600, 400, 200, 100]);
    act(() => canvas.layoutNow());
    pointer('pointerup', surface, 260, 205);
    expect([se().style.left, se().style.top]).toEqual(['400px', '250px']);
  });
});

describe('B8: a flow drop lands in the slot under the pointer, its bar there', () => {
  const kids = (ids: string[]) => ids.map((id) => `<div id="${id}" style="background:#ff0000"></div>`).join('');
  const SLIDE = `<section id="s" style="background:#ffffff">
<div id="grid" style="position:absolute; left:100px; top:100px; width:800px; height:400px; display:grid; grid-template-columns:1fr 1fr">${kids(['g0', 'g1', 'g2', 'g3'])}</div>
<div id="rr" style="position:absolute; left:1000px; top:100px; width:800px; height:100px; display:flex; flex-direction:row-reverse">${kids(['r0', 'r1', 'r2'])}</div>
<div id="cr" style="position:absolute; left:1000px; top:400px; width:200px; height:400px; display:flex; flex-direction:column-reverse">${kids(['c0', 'c1', 'c2'])}</div></section>`;
  const BOXES: Record<string, Rect> = {
    grid: [100, 100, 800, 400],
    g0: [0, 0, 400, 200],
    g1: [400, 0, 400, 200],
    g2: [0, 200, 400, 200],
    g3: [400, 200, 400, 200],
    rr: [1000, 100, 800, 100],
    r0: [600, 0, 200, 100],
    r1: [400, 0, 200, 100],
    r2: [200, 0, 200, 100],
    cr: [1000, 400, 200, 400],
    c0: [0, 300, 200, 100],
    c1: [0, 200, 200, 100],
    c2: [0, 100, 200, 100],
  };
  const NO = { shift: false, alt: false, meta: false };
  const order = (doc: Doc, parent: string) => childLists(readFlat(doc, 's', false)).get(parent)!.map((e) => e.id);
  const drag = (id: string, from: { x: number; y: number }, to: { x: number; y: number }) => {
    const doc = deck(SLIDE);
    const ctx = { session: new DeckSession(doc, 0), slideId: 's', canvas: canvasOf(doc, BOXES), scale: 0.5 };
    const g = startFlowMove(ctx, id, from);
    const f = g.frame(to, NO);
    g.end(true);
    return { doc, bar: f.insertion };
  };

  it('in a grid, the row under the pointer: g0 dropped on g2’s right half goes between g2 and g3', () => {
    const { doc, bar } = drag('g0', { x: 300, y: 200 }, { x: 400, y: 400 });
    expect(order(doc, 'grid')).toEqual(['g1', 'g2', 'g0', 'g3']);
    expect(bar).toEqual({ x: 498, y: 300, w: 4, h: 200 });
  });

  it('in a row-reverse, left of the leftmost child is after the last', () => {
    const { doc, bar } = drag('r0', { x: 1700, y: 150 }, { x: 1150, y: 150 });
    expect(order(doc, 'rr')).toEqual(['r1', 'r2', 'r0']);
    expect(bar).toEqual({ x: 1196, y: 100, w: 4, h: 100 });
  });

  it('in a column-reverse, below the bottom child is before the first', () => {
    const { doc, bar } = drag('c2', { x: 1100, y: 550 }, { x: 1100, y: 790 });
    expect(order(doc, 'cr')).toEqual(['c2', 'c0', 'c1']);
    expect(bar).toEqual({ x: 1000, y: 800, w: 200, h: 4 });
  });
});
