// Where a closed command output is cut (UX wave U3b, M1; the architect's ruling R19 on the drawn example): at the bottom
// of its second drawn line, read from the line boxes the drawing measures, never a fixed height. One table of drawings,
// each given as the boxes a layout would measure (12 px type at 1.5, 18 px lines; R1's 4 px between blocks).
import { describe, expect, it } from 'vitest';
import { closedBound, lineBoxes } from './command-bound';

const line = (top: number, height = 18) => ({ top, bottom: top + height });

describe('closedBound', () => {
  const table: [name: string, lines: { top: number; bottom: number }[], bound: number | null][] = [
    ['one paragraph of seven lines', [0, 18, 36, 54, 72, 90, 108].map((top) => line(top)), 36],
    ['a heading and a line under it, then more', [line(0), line(22), line(40), line(58)], 40],
    ['two one-line blocks, then a third', [line(0), line(22), line(44)], 40],
    ['two one-line blocks and nothing more: shown whole', [line(0), line(22)], null],
    ['one line only: no bound', [line(0)], null],
    ['nothing drawn', [], null],
  ];
  for (const [name, lines, bound] of table) it(name, () => expect(closedBound(lines)).toBe(bound));
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
