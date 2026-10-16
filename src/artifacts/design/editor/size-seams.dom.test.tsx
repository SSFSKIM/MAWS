// P3-E1 M3: C's additive size seams (X27, E0's touch list), proved on a design board while a deck's slide keeps its
// 1920×1080 defaults: SlideCanvas reads the board's size live from its node's `w`/`h` (a resize and its undo patch the
// section in place, `data-board` marks it for the screen type defaults), SlideView and the deck view carry the size, the
// overlay's guide layer spans the board, and C's element snapping on a board meets its edges and centre with no 128 px
// margin, its guides spanning the board. happy-dom lays nothing out: the boxes are given to the nodes, as C's tests do.
import { cleanup, render } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { newDoc, transact, type Doc } from '../../yjs';
import * as Y from '../../yjs/slides';
import { createDeckUndo } from '../../yjs/slides-undo';
import { SlideCanvas } from '../../slides/canvas';
import { importSlide, writeDeckKeys } from '../../slides/model';
import { loadSlide } from '../../slides/parse';
import { readDeckView } from '../../slides/editor/deck-view';
import { DeckSession } from '../../slides/editor/session';
import { SlideView } from '../../slides/editor/SlideView';
import { Stage } from '../../slides/editor/Stage';
import { startMove, type GestureContext } from '../../slides/editor/transform/gestures';
import { snapMove } from '../../slides/geometry';
import { design } from '../fixtures/support';
import { setBoardFrame } from '../writers';

const canvases: SlideCanvas[] = [];
afterEach(() => {
  cleanup();
  canvases.splice(0).forEach((c) => c.dispose());
  document.body.innerHTML = '';
});

function canvasOf(doc: Doc, id: string): SlideCanvas {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const canvas = new SlideCanvas(doc, id, host);
  canvases.push(canvas);
  return canvas;
}

function deck(): Doc {
  const doc = newDoc();
  const l = loadSlide('<section id="s" style="background:#ffffff"><p id="p">Body</p></section>');
  if (!l.ok) throw new Error('fixture');
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'T', order: ['s'] });
    importSlide(doc, l.slide, 'a0');
  });
  return doc;
}

describe('SlideCanvas on a board', () => {
  it('draws the board at its node’s size, marked for the screen defaults, and follows a resize and its undo', () => {
    const doc = design();
    const undo = createDeckUndo(doc, { editor: 'deck' });
    const canvas = canvasOf(doc, 'b1');
    expect(canvas.isBoard).toBe(true);
    expect(canvas.size).toEqual({ w: 390, h: 844 });
    expect([canvas.root.style.width, canvas.root.style.height]).toEqual(['390px', '844px']);
    expect(canvas.root.hasAttribute('data-board')).toBe(true);
    undo.cut();
    setBoardFrame(doc, 'b1', { w: 834, h: 1194 }, undo.origin);
    expect(canvas.size).toEqual({ w: 834, h: 1194 });
    expect([canvas.root.style.width, canvas.root.style.height]).toEqual(['834px', '1194px']);
    undo.undo();
    expect(canvas.size).toEqual({ w: 390, h: 844 });
    expect(canvas.root.style.width).toBe('390px');
    undo.destroy();
  });

  it('a deck’s slide keeps CANVAS_CSS’s 1920×1080 and no board mark', () => {
    const canvas = canvasOf(deck(), 's');
    expect(canvas.isBoard).toBe(false);
    expect(canvas.size).toEqual({ w: 1920, h: 1080 });
    expect(canvas.root.style.width).toBe('');
    expect(canvas.root.hasAttribute('data-board')).toBe(false);
  });

  it('a board’s node size wins over a section width or height style, at first and through its patches and removal; the authored style kept', () => {
    const doc = design();
    transact(doc, () => {
      Y.setSlideKey(doc, 'b1', 'style:width', '1920px');
      Y.setSlideKey(doc, 'b1', 'style:height', '1080px');
    });
    const canvas = canvasOf(doc, 'b1');
    const shown = () => [canvas.root.style.width, canvas.root.style.height];
    expect(shown()).toEqual(['390px', '844px']);
    transact(doc, () => Y.setSlideKey(doc, 'b1', 'style:width', '500px'));
    expect(shown()).toEqual(['390px', '844px']);
    transact(doc, () => Y.deleteSlideKey(doc, 'b1', 'style:width'));
    expect(shown()).toEqual(['390px', '844px']);
    setBoardFrame(doc, 'b1', { w: 834, h: 1194 });
    expect(shown()).toEqual(['834px', '1194px']);
    expect(Y.slideScalars(doc, 'b1')['style:height']).toBe('1080px'); // the model's authored style is not touched
    // no size on the node: the section's own style draws again, as a deck's would
    transact(doc, () => Y.deleteSlideKey(doc, 'b1', 'w'));
    expect(shown()).toEqual(['', '1080px']);
  });

  it('a size key removed returns the canvas to the deck default', () => {
    const doc = design();
    const canvas = canvasOf(doc, 'b2');
    transact(doc, () => Y.deleteSlideKey(doc, 'b2', 'w'));
    expect(canvas.isBoard).toBe(false);
    expect(canvas.root.style.width).toBe('');
    expect(canvas.root.hasAttribute('data-board')).toBe(false);
  });
});

describe('the views carry a board’s size', () => {
  it('SlideView frames the board at its size and scale; the deck’s slide at 1920×1080', () => {
    const doc = design();
    const { container } = render(
      <>
        <SlideView doc={doc} slideId="b1" token={doc} assetUrl={() => null} scale={0.5} size={{ w: 390, h: 844 }} className="board" />
        <SlideView doc={deck()} slideId="s" token={{}} assetUrl={() => null} scale={0.5} className="slide" />
      </>,
    );
    const board = container.querySelector<HTMLElement>('.board')!;
    expect([board.style.width, board.style.height]).toEqual(['195px', '422px']);
    expect((board.firstElementChild as HTMLElement).style.width).toBe('390px');
    const slide = container.querySelector<HTMLElement>('.slide')!;
    expect([slide.style.width, slide.style.height]).toEqual(['960px', '540px']);
  });

  it('the deck view reads each board’s size, none for a deck’s slide', () => {
    expect(readDeckView(design()).slides.map((s) => s.size)).toEqual([
      { w: 390, h: 844 },
      { w: 1440, h: 1024 },
      { w: 1080, h: 8192 },
    ]);
    expect(readDeckView(deck()).slides[0]!.size).toBeNull();
  });

  it('Stage forwards the size, and the overlay’s guide layer spans the board', () => {
    const doc = design();
    const session = new DeckSession(doc, 0);
    session.show('b1');
    const slide = readDeckView(doc).slides[0]!;
    const viewport = { current: null };
    const onFrame = () => {};
    const assetUrl = () => null;
    const scope = (c: ReactNode) => c;
    function Harness() {
      const [canvas, setCanvas] = useState<SlideCanvas | null>(null);
      return <Stage session={session} slide={slide} scale={0.5} assetUrl={assetUrl} viewport={viewport} frame={onFrame} onCanvas={setCanvas} canvas={canvas} readOnly={false} scope={scope} />;
    }
    const { container } = render(<Harness />);
    const frame = container.querySelector<HTMLElement>('[data-stage-slide="b1"] .deck-slide-frame')!;
    expect([frame.style.width, frame.style.height]).toEqual(['195px', '422px']);
    const lines = container.querySelector('.deck-overlay-lines')!;
    expect([lines.getAttribute('width'), lines.getAttribute('height')]).toEqual(['195', '422']);
    session.dispose();
  });
});

describe('element snapping on a board', () => {
  it('a guide spans the extent it is given (the deck’s 1920×1080 without one)', () => {
    const box = { x: 100, y: 100, w: 50, h: 50 };
    const lines = { x: [{ at: 0, kind: 'slide' as const }], y: [] };
    expect(snapMove({ ...box, x: 2 }, { lines, siblings: [] }, 6).guides[0]).toMatchObject({ axis: 'x', at: 0, from: 0, to: 1080 });
    expect(snapMove({ ...box, x: 2 }, { lines, siblings: [], extent: { w: 390, h: 844 } }, 6).guides[0]).toMatchObject({ axis: 'x', at: 0, from: 0, to: 844 });
  });

  it('meets the board’s centre and edges, not a slide’s 128 px margin, its guides spanning the board', () => {
    const doc = design([{ id: 'p', at: { x: 0, y: 0, w: 390, h: 844 }, body: '<div id="a" style="position:absolute; left:20px; top:300px; width:100px; height:100px; background:#ff0000"></div>' }]);
    const canvas = canvasOf(doc, 'p');
    const a = canvas.node('a')!;
    for (const [k, v] of [['offsetLeft', 20], ['offsetTop', 300], ['offsetWidth', 100], ['offsetHeight', 100], ['offsetParent', canvas.root]] as const)
      Object.defineProperty(a, k, { configurable: true, get: () => v });
    for (const [k, v] of [['offsetWidth', 390], ['offsetHeight', 844]] as const) Object.defineProperty(canvas.root, k, { configurable: true, get: () => v });
    const session = new DeckSession(doc, 0);
    const ctx: GestureContext = { session, slideId: 'p', canvas, scale: 1 };
    // dragged so its left edge lands at 126: a slide would snap it to its 128 px margin; a board has none
    let g = startMove(ctx, ['a'], { x: 0, y: 0 });
    g.frame({ x: 106, y: 0 }, { shift: false, alt: false, meta: false });
    g.end(true);
    expect(Y.elementScalars(doc, 'p', 'a')['style:left']).toBe('126px');
    // dragged so its centre is 3 px off the board's (195): snapped there, the guide from the board's top to its bottom
    Object.defineProperty(a, 'offsetLeft', { configurable: true, get: () => 126 });
    g = startMove(ctx, ['a'], { x: 0, y: 0 });
    const frame = g.frame({ x: 195 - 50 - 126 + 3, y: 0 }, { shift: false, alt: false, meta: false });
    g.end(true);
    expect(Y.elementScalars(doc, 'p', 'a')['style:left']).toBe('145px');
    expect(frame.guides).toContainEqual(expect.objectContaining({ axis: 'x', at: 195, from: 0, to: 844, kind: 'centre' }));
    session.dispose();
  });
});
