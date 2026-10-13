// P3-G (§D4.2, M4's decisions): the drawing model is plain data in surface CSS px, and one function turns it into the
// draw operations both the live SVG and the composited PNG paint.
import { describe, expect, it } from 'vitest';
import { addMark, canClear, canUndo, clearMarks, drawOps, EMPTY_DRAWING, haloOf, isDrawn, undoMark, type Mark } from './drawing';

const pen: Mark = { tool: 'pen', ink: 'red', points: [{ x: 1, y: 2 }, { x: 5, y: 6 }, { x: 9, y: 4 }] };
const box: Mark = { tool: 'box', ink: 'blue', from: { x: 10, y: 20 }, to: { x: 40, y: 5 } };
const arrow: Mark = { tool: 'arrow', ink: 'green', from: { x: 0, y: 0 }, to: { x: 100, y: 0 } };
const text: Mark = { tool: 'text', ink: 'white', at: { x: 30, y: 40 }, text: 'Too tight' };

describe('the drawing: marks, undo and clear', () => {
  it('starts empty, with nothing to undo or clear', () => {
    expect(EMPTY_DRAWING.marks).toEqual([]);
    expect(canUndo(EMPTY_DRAWING)).toBe(false);
    expect(canClear(EMPTY_DRAWING)).toBe(false);
  });

  it('adds marks in order, and Undo takes back the last one at a time', () => {
    const two = addMark(addMark(EMPTY_DRAWING, pen), box);
    expect(two.marks).toEqual([pen, box]);
    expect(canUndo(two) && canClear(two)).toBe(true);
    expect(undoMark(two).marks).toEqual([pen]);
    expect(undoMark(undoMark(two))).toMatchObject({ marks: [] });
    expect(canUndo(undoMark(undoMark(two)))).toBe(false);
    expect(undoMark(EMPTY_DRAWING)).toBe(EMPTY_DRAWING);
  });

  it('Clear empties the drawing and is itself undoable; clearing nothing changes nothing', () => {
    const two = addMark(addMark(EMPTY_DRAWING, pen), box);
    const cleared = clearMarks(two);
    expect(cleared.marks).toEqual([]);
    expect(canClear(cleared)).toBe(false);
    expect(canUndo(cleared)).toBe(true);
    expect(undoMark(cleared).marks).toEqual([pen, box]);
    expect(clearMarks(EMPTY_DRAWING)).toBe(EMPTY_DRAWING);
  });

  it('keeps a pen dot, and drops a box or an arrow with no extent and empty text', () => {
    expect(isDrawn({ tool: 'pen', ink: 'red', points: [{ x: 3, y: 3 }] })).toBe(true);
    expect(isDrawn({ ...box, to: { x: 10.4, y: 20.4 } })).toBe(false);
    expect(isDrawn({ ...arrow, to: { x: 0.5, y: 0 } })).toBe(false);
    expect(isDrawn({ ...text, text: '   ' })).toBe(false);
    expect(isDrawn(box) && isDrawn(arrow) && isDrawn(text)).toBe(true);
  });
});

describe('drawOps: one rendering for the screen and the PNG', () => {
  it('draws a pen as a polyline, a box as a closed outline from its two corners, in the mark’s ink', () => {
    expect(drawOps([pen, box])).toEqual([
      { kind: 'path', ink: 'red', d: 'M1 2L5 6L9 4' },
      { kind: 'path', ink: 'blue', d: 'M10 5H40V20H10Z' },
    ]);
    expect(drawOps([{ tool: 'pen', ink: 'black', points: [{ x: 3, y: 3 }] }])).toEqual([{ kind: 'path', ink: 'black', d: 'M3 3L3 3' }]);
  });

  it('draws an arrow as its shaft and a two-sided head at the far end', () => {
    const [op] = drawOps([arrow]);
    expect(op).toMatchObject({ kind: 'path', ink: 'green' });
    const d = (op as { d: string }).d;
    expect(d.startsWith('M0 0L100 0M')).toBe(true);
    // the head: two strokes back from the tip at ± the head angle, mirrored about the shaft
    const [, head] = d.split('L100 0M');
    const nums = head.split(/[ML ]/).filter(Boolean).map(Number);
    expect(nums).toHaveLength(6);
    const [x1, y1, tx, ty, x2, y2] = nums;
    expect([tx, ty]).toEqual([100, 0]);
    expect(x1).toBeCloseTo(x2);
    expect(y1).toBeCloseTo(-y2);
    expect(x1).toBeLessThan(100);
  });

  it('draws text at its baseline with a halo in the opposite ink', () => {
    expect(drawOps([text])).toEqual([{ kind: 'text', ink: 'white', halo: 'black', x: 30, y: 40 + 16, text: 'Too tight' }]);
    expect(haloOf('red')).toBe('white');
    expect(haloOf('black')).toBe('white');
    expect(haloOf('white')).toBe('black');
  });
});
