// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Stage and overlay", "Transform layer"; the final
// fix wave's B7 and B8): what the overlay and a flow drag read from layout. The overlay's handles and other replicas'
// outlines follow a layout pass that moved an element with no deck write (a face arriving, a design-system restyle, a
// fit); a board's flow child dropped in a grid, a row-reverse or a column-reverse lands in the slot under the pointer,
// its insertion bar there. WR #35: slides instead freeze the whole measured layout on first movement, preserving the
// nested geometry and stationary siblings. happy-dom lays nothing out: the boxes are given to the nodes here.
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adoptClientId, applyV1, diffV1, newDoc, stateVector, transact, type Doc } from '../../../yjs';
import { observeSlide } from '../../../yjs/slides';
import { heldPeer } from '../../../design/fixtures/support';
import { writeBoardEntry, writeCanvasKeys } from '../../../design/model';
import { SlideCanvas } from '../../canvas';
import { childLists, importSlide, readFlat, setStyle, slideFile, writeDeckKeys } from '../../model';
import { loadSlide } from '../../parse';
import { DeckSession } from '../session';
import { selectionCommands } from './commands';
import { nudge, startFlowMove, startMove } from './gestures';
import { measure, measureAll } from './measure';
import { Overlay } from './Overlay';

// the overlay's own measures counted (B7 follow-up): `measureAll` as it is, watched
vi.mock('./measure', async (original) => {
  const actual = await original<typeof import('./measure')>();
  return { ...actual, measureAll: vi.fn(actual.measureAll) };
});
/** The overlay's selection measures (a Set of ids; the gestures' and hit tests' measures pass arrays). */
const overlayMeasures = () => vi.mocked(measureAll).mock.calls.filter(([, ids]) => ids instanceof Set).length;

function deck(html: string, board = false): Doc {
  const doc = newDoc();
  const l = loadSlide(html);
  if (!l.ok) throw new Error(l.held.reasons.join('; '));
  transact(doc, () => {
    if (board) writeCanvasKeys(doc, { v: 1, title: 'T', order: ['s'], boards: {} });
    else writeDeckKeys(doc, { v: 4, title: 'T', order: ['s'] });
    importSlide(doc, l.slide, 'a0');
    if (board) writeBoardEntry(doc, 's', { x: 0, y: 0, w: 1920, h: 1080 });
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

  // P3-F (L218): a capture lost with no release (the surface hidden, the system taking the pointer) ends the gesture as a
  // release does: its step closed, the handles back with the layout pass it saw caught up, a later move writing nothing
  it('a lost pointer capture ends the gesture as a release does', () => {
    const { doc, canvas, se, pointer, surface } = mountOverlay();
    const width = () => readFlat(doc, 's').find((e) => e.id === 'a')!.style.width;
    pointer('pointerdown', se(), 250, 200);
    pointer('pointermove', surface, 260, 205);
    const dragged = width();
    place(canvas, 'a', [600, 400, 200, 100]);
    act(() => canvas.layoutNow());
    pointer('lostpointercapture', surface, 260, 205);
    expect([se()?.style.left, se()?.style.top]).toEqual(['400px', '250px']);
    pointer('pointermove', surface, 300, 240);
    expect(width()).toBe(dragged);
  });
});

describe('B8 on boards / WR #35 on slides: nested flow geometry survives a drag', () => {
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
  const drag = (id: string, from: { x: number; y: number }, to: { x: number; y: number }, board = true) => {
    const doc = deck(SLIDE, board);
    const ctx = { session: new DeckSession(doc, 0), slideId: 's', canvas: canvasOf(doc, BOXES), scale: 0.5 };
    expect(ctx.canvas.isBoard).toBe(board);
    const before = slideFile(doc, 's');
    const g = startFlowMove(ctx, id, from);
    expect(g.refused).toBeUndefined();
    expect(slideFile(doc, 's'), 'pressing alone never freezes the layout').toBe(before);
    const f = g.frame(to, board ? NO : { ...NO, meta: true });
    g.end(true);
    return { doc, session: ctx.session, before, bar: f.insertion };
  };

  it('on a board grid, the row under the pointer: g0 dropped on g2’s right half goes between g2 and g3', () => {
    const { doc, bar } = drag('g0', { x: 300, y: 200 }, { x: 400, y: 400 });
    expect(order(doc, 'grid')).toEqual(['g1', 'g2', 'g0', 'g3']);
    expect(bar).toEqual({ x: 498, y: 300, w: 4, h: 200 });
  });

  it('on a board row-reverse, left of the leftmost child is after the last', () => {
    const { doc, bar } = drag('r0', { x: 1700, y: 150 }, { x: 1150, y: 150 });
    expect(order(doc, 'rr')).toEqual(['r1', 'r2', 'r0']);
    expect(bar).toEqual({ x: 1196, y: 100, w: 4, h: 100 });
  });

  it('on a board column-reverse, below the bottom child is before the first', () => {
    const { doc, bar } = drag('c2', { x: 1100, y: 550 }, { x: 1100, y: 790 });
    expect(order(doc, 'cr')).toEqual(['c2', 'c0', 'c1']);
    expect(bar).toEqual({ x: 1000, y: 800, w: 200, h: 4 });
  });

  it.each([
    { layout: 'grid', id: 'g0', from: { x: 300, y: 200 }, to: { x: 400, y: 400 }, moved: [100, 200] },
    { layout: 'row-reverse', id: 'r0', from: { x: 1700, y: 150 }, to: { x: 1150, y: 150 }, moved: [50, 0] },
    { layout: 'column-reverse', id: 'c2', from: { x: 1100, y: 550 }, to: { x: 1100, y: 790 }, moved: [0, 340] },
  ])('on a slide $layout, first movement pins every measured element without displacing any sibling', ({ id, from, to, moved }) => {
    const { doc, session, before, bar } = drag(id, from, to, false);
    expect(bar, 'slides move freely, with no flow insertion bar').toBeUndefined();
    expect(order(doc, 'grid')).toEqual(['g0', 'g1', 'g2', 'g3']);
    expect(order(doc, 'rr')).toEqual(['r0', 'r1', 'r2']);
    expect(order(doc, 'cr')).toEqual(['c0', 'c1', 'c2']);
    for (const [eid, [x, y, w, h]] of Object.entries(BOXES)) {
      expect(readFlat(doc, 's').find((e) => e.id === eid)!.style, eid).toMatchObject({
        position: 'absolute', left: `${eid === id ? moved[0] : x}px`, top: `${eid === id ? moved[1] : y}px`, width: `${w}px`, height: `${h}px`,
      });
    }
    expect(loadSlide(slideFile(doc, 's')).ok, 'the nested pinned layout remains in the slide dialect').toBe(true);
    session.undoStep();
    expect(slideFile(doc, 's'), 'the freeze and the move form one undo step').toBe(before);
  });
});

const styleOf = (doc: Doc, id: string) => readFlat(doc, 's', false).find((e) => e.id === id)!.style;
const UNSNAPPED = { shift: false, alt: false, meta: true };

describe('WR #35: freezing layout is not a drag of the unselected elements', () => {
  it.each([0x10, 0x7fff0000])('keeps an agent’s unselected sibling edits on drop, with agent clientID %i', (clientId) => {
    const doc = deck(`<section id="s"><h2 id="heading" style="font-size:64px">Title</h2>
<div id="box" style="position:absolute;left:300px;top:400px;width:400px;height:100px;background:#ff0000"></div></section>`);
    adoptClientId(doc, 0x100);
    const channel = heldPeer(doc, clientId);
    const canvas = canvasOf(doc, { heading: [128, 128, 1664, 80], box: [300, 400, 400, 100] });
    const session = new DeckSession(doc, 0, { holdRemote: channel.holdRemote });
    const ctx = { session, canvas, slideId: 's', scale: 0.5 };
    const claimed: string[] = [];
    const off = observeSlide(doc, 's', (changes, origin) => {
      if (origin === session.origin) for (const c of changes) if (c.kind === 'element' && c.id === 'box') claimed.push(...c.keys);
    });
    const g = startFlowMove(ctx, 'heading', { x: 300, y: 150 });
    g.frame({ x: 350, y: 200 }, UNSNAPPED);
    expect(claimed, 'a pinned sibling already at its measured frame is not written again').toEqual([]);
    channel.write((agent) => {
      setStyle(agent, 's', 'box', { width: '600px', background: '#0000ff' });
      setStyle(agent, 's', 'heading', { left: '900px', top: '900px' });
    });
    expect(channel.buffered()).toBe(1);
    g.frame({ x: 450, y: 250 }, UNSNAPPED);
    g.end();
    off();
    expect(styleOf(doc, 'box')).toMatchObject({ width: '600px', background: '#0000ff' });
    expect(styleOf(doc, 'heading')).toMatchObject({ left: '278px', top: '228px' }); // only the dragged element wins on drop
    applyV1(channel.agent, diffV1(doc, stateVector(channel.agent)));
    expect(slideFile(channel.agent, 's')).toBe(slideFile(doc, 's'));
  });

  it('removes flow-only constraints when pinning, while retaining measured sizes and container layout', () => {
    const doc = deck(`<section id="s">
<div id="flex" style="display:flex;flex-direction:row;width:800px;height:200px">
<p id="flow" style="flex:1;flex-grow:2;flex-shrink:0;flex-basis:200px;align-self:center;min-width:120px;min-height:40px;max-width:500px;max-height:160px;aspect-ratio:2">Text</p></div>
<div id="grid" style="display:grid;grid-template-columns:1fr 1fr;width:800px;height:300px">
<div id="cell" style="grid-column:span 2;grid-row:span 2;justify-self:center;align-self:end;min-width:100px;background:#ff0000"></div></div>
<div id="target" style="position:absolute;left:1300px;top:600px;width:200px;height:100px;background:#0000ff"></div></section>`);
    const flowOnly = ['flex', 'flex-grow', 'flex-shrink', 'flex-basis', 'align-self', 'min-width', 'min-height', 'max-width', 'max-height', 'aspect-ratio'];
    expect(flowOnly.filter((key) => styleOf(doc, 'flow')[key] === undefined), 'the source really contains every constraint').toEqual([]);
    const canvas = canvasOf(doc, { flex: [100, 100, 800, 200], flow: [100, 140, 400, 100], grid: [100, 400, 800, 300], cell: [200, 420, 600, 200], target: [1300, 600, 200, 100] });
    const ctx = { session: new DeckSession(doc, 0), canvas, slideId: 's', scale: 0.5 };
    const g = startMove(ctx, ['target'], { x: 1400, y: 650 });
    expect(g.refused).toBeUndefined();
    g.frame({ x: 1460, y: 690 }, UNSNAPPED);
    g.end();
    expect(styleOf(doc, 'target')).toMatchObject({ left: '1360px', top: '640px' });
    expect(styleOf(doc, 'flow')).toMatchObject({ position: 'absolute', left: '0px', top: '40px', width: '400px', height: '100px' });
    expect(flowOnly.filter((key) => styleOf(doc, 'flow')[key] !== undefined)).toEqual([]);
    expect(['grid-column', 'grid-row', 'justify-self', 'align-self', 'min-width'].filter((key) => styleOf(doc, 'cell')[key] !== undefined)).toEqual([]);
    expect(styleOf(doc, 'cell')).toMatchObject({ left: '100px', top: '20px', width: '600px', height: '200px' });
    expect(styleOf(doc, 'flex')).toMatchObject({ display: 'flex', 'flex-direction': 'row' });
    expect(styleOf(doc, 'grid')).toMatchObject({ display: 'grid', 'grid-template-columns': '1fr 1fr' });
    const loaded = loadSlide(slideFile(doc, 's'));
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.diagnostics.filter((d) => d.severity === 'warning')).toEqual([]);
  });
});

describe('WR #35: a real SVG node has no HTML offsets', () => {
  it.each(['move', 'nudge', 'detach'] as const)('%s preserves an SVG’s parent-local frame under a translated and rotated flow container', (operation) => {
    const doc = deck(`<section id="s"><div id="group" style="width:600px;height:400px;transform:translate(40px, 30px) rotate(90deg)">
<svg id="drawing" viewBox="0 0 100 50" style="width:200px;height:100px;transform:translate(10px, 20px)"><rect width="100" height="50" fill="#ff0000"/></svg>
<h2 id="caption" style="font-size:32px">Caption</h2></div>
<div id="target" style="position:absolute;left:1300px;top:600px;width:200px;height:100px;background:#0000ff"></div></section>`);
    const canvas = canvasOf(doc, { group: [100, 200, 600, 400], caption: [150, 360, 300, 60], target: [1300, 600, 200, 100] });
    const svg = canvas.node('drawing')!;
    expect(svg).toBeInstanceOf(SVGSVGElement);
    expect(svg.offsetWidth).toBeUndefined(); // no invented HTMLElement offsets on the SVG fixture
    const rect = (x: number, y: number, w: number, h: number) => ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON() {} });
    vi.spyOn(canvas.root, 'getBoundingClientRect').mockReturnValue(rect(20, 30, 960, 540));
    vi.spyOn(svg, 'getBoundingClientRect').mockImplementation(() => {
      const x = svg.style.position === 'absolute' ? Number.parseFloat(svg.style.left) : 50;
      const y = svg.style.position === 'absolute' ? Number.parseFloat(svg.style.top) : 40;
      // The parent maps (x,y) to (640-y,130+x); the SVG itself translates (10,20), at stage zoom 0.5.
      return rect(20 + (640 - y - 20 - 100) / 2, 30 + (130 + x + 10) / 2, 50, 100);
    });
    const ctx = { session: new DeckSession(doc, 0), canvas, slideId: 's', scale: 0.5 };
    const before = measure(canvas, 'drawing', ctx.scale);
    expect(before?.corners).toEqual([{ x: 580, y: 190 }, { x: 580, y: 390 }, { x: 480, y: 390 }, { x: 480, y: 190 }]);
    if (operation === 'move') {
      const g = startMove(ctx, ['target'], { x: 1400, y: 650 });
      expect(g.refused).toBeUndefined();
      g.frame({ x: 1460, y: 690 }, UNSNAPPED);
      g.end();
    } else if (operation === 'nudge') expect(nudge(ctx, ['target'], { x: 60, y: 40 })).toBeNull();
    else expect(selectionCommands(ctx, ['caption'], false).detach()).toBeNull();
    expect(styleOf(doc, 'drawing')).toMatchObject({ position: 'absolute', left: '50px', top: '40px', width: '200px', height: '100px', transform: 'translate(10px, 20px)' });
    expect(styleOf(doc, 'group')).toMatchObject({ left: '100px', top: '200px', width: '600px', height: '400px', transform: 'translate(40px, 30px) rotate(90deg)' });
    expect(styleOf(doc, 'caption')).toMatchObject({ left: '50px', top: '160px', width: '300px', height: '60px' });
    expect(measure(canvas, 'drawing', ctx.scale)?.corners).toEqual(before?.corners);
    expect(loadSlide(slideFile(doc, 's')).ok).toBe(true);
  });
});
