// Where a closed command output is cut (UX wave U3b, M1; the architect's ruling R19 on the drawn example, and the branch
// panel's finding 3): closed, an output is never drawn taller than its bound, whatever it holds. Where its first two
// drawn lines are text lines, the bound is the bottom of the second; where what it draws is taller than that without
// being text lines (an image, a rule, a table's frame before its text), the bound is two lines of its own type. One table
// of drawings, each given as the line boxes a layout would measure and the drawing's whole height (12 px type at 1.5,
// 18 px lines; R1's 4 px between blocks).
import { describe, expect, it } from 'vitest';
import { closedBound, lineBoxes } from './command-bound';

const line = (top: number, height = 18) => ({ top, bottom: top + height });
const LINE = 18;

describe('closedBound', () => {
  const table: [name: string, lines: { top: number; bottom: number }[], height: number, bound: number | null][] = [
    ['one paragraph of seven lines', [0, 18, 36, 54, 72, 90, 108].map((top) => line(top)), 126, 36],
    ['a heading and a line under it, then more', [line(0), line(22), line(40), line(58)], 76, 40],
    ['two one-line blocks, then a third', [line(0), line(22), line(44)], 62, 40],
    ['two one-line blocks and nothing more: shown whole', [line(0), line(22)], 40, null],
    ['one line only: no bound', [line(0)], 18, null],
    ['nothing drawn', [], 0, null],
    // the branch panel's finding 3: what is not a text line is bounded too
    ['an image and no text line: two lines of its type', [], 240, 36],
    ['one line, then an image under it: two lines of its type', [line(0)], 262, 36],
    ['two lines, then an image under them: the bottom of the second line', [line(0), line(22)], 264, 40],
    ['a line, an image, then more lines: two lines of its type, never the image whole', [line(0), line(222), line(240)], 258, 36],
    ['an image, then lines: two lines of its type', [line(204), line(222), line(240)], 258, 36],
    // a frame's padding and border are not content: a two-row table and a one-line code block are shown whole
    ['a table of two rows in its frame: shown whole', [line(5), line(31)], 54, null],
    ['a code block of one line in its frame: shown whole', [line(12)], 42, null],
  ];
  for (const [name, lines, height, bound] of table) it(name, () => expect(closedBound(lines, height, LINE)).toBe(bound));
});

describe('lineBoxes', () => {
  it('makes one line of the fragments that share it, in order from the top', () => {
    // a table row's cells and a paragraph's inline runs are fragments of one line; a heading, a gap, then a line
    const fragments = [
      { top: 22, bottom: 40 }, { top: 0, bottom: 18 }, { top: 1, bottom: 17 }, { top: 22.5, bottom: 39.5 }, { top: 44, bottom: 62 },
    ];
    expect(lineBoxes(fragments)).toEqual([{ top: 0, bottom: 18 }, { top: 22, bottom: 40 }, { top: 44, bottom: 62 }]);
  });

  it('ignores a fragment with no height', () => {
    expect(lineBoxes([{ top: 0, bottom: 18 }, { top: 18, bottom: 18 }, { top: 18, bottom: 36 }])).toEqual([{ top: 0, bottom: 18 }, { top: 18, bottom: 36 }]);
  });
});
