// The stack's pure model (UX wave U5b, M2; the execution document's Interfaces §F): what each section weighs, the band
// of drawn bodies, the place kept through a change of heights, the fold rule and the hunk order across files. Heights
// are numbers the tests choose; nothing is measured.
import { describe, expect, it } from 'vitest';
import { REVIEW_FILE_LINES_CAP } from './review-model';
import {
  bandOf,
  bodyLines,
  ESTIMATED_ROW_PX,
  estimatedBody,
  everyFolded,
  hunkOrder,
  hunkPlace,
  isFolded,
  placeAt,
  stackLayout,
  topOfPlace,
  type SectionMeasure,
  type StackRow,
} from './stack-model';

const HEADER = 30;
const section = (path: string, over: Partial<SectionMeasure> = {}): SectionMeasure => ({ path, header: HEADER, body: 400, lines: 20, folded: false, ...over });
const noRows = () => null;

describe('what a section weighs', () => {
  it('a folded section adds its header’s height and nothing else to the stack, measured or not', () => {
    const layout = stackLayout([section('a.ts', { body: 300 }), section('b.ts', { folded: true, body: 500 }), section('c.ts', { folded: true, body: null, lines: 40 })]);
    expect(layout.tops).toEqual([0, 330, 360]);
    expect(layout.bodies).toEqual([300, null, null]);
    expect(layout.total).toBe(390);
    // Collapse all: the stack is the sum of its headers
    const folded = stackLayout(Array.from({ length: 12 }, (_, i) => section(`f${i}.ts`, { folded: true, body: i % 2 ? 900 : null })));
    expect(folded.total).toBe(12 * HEADER);
  });

  it('an unfolded body not measured yet is estimated from its line count alone', () => {
    expect(estimatedBody(10)).toBe(10 * ESTIMATED_ROW_PX);
    expect(estimatedBody(0)).toBe(ESTIMATED_ROW_PX); // a body is at least one row: "Binary file", a note, Loading
    const layout = stackLayout([section('a.ts', { body: null, lines: 10 }), section('b.ts', { body: 120 })]);
    expect(layout.bodies).toEqual([10 * ESTIMATED_ROW_PX, 120]);
    expect(layout.bodyTops).toEqual([HEADER, HEADER + 10 * ESTIMATED_ROW_PX + HEADER]);
  });

  it('counts a body’s lines from its hunks when they are loaded, else from its counts', () => {
    expect(bodyLines({ hunks: ['@@ -1,2 +1,2 @@\n-a\n+b\n c', '@@ -9 +9 @@\n-x\n+y'], added: 2, removed: 2 })).toBe(7);
    expect(bodyLines({ hunks: null, added: 12, removed: 3 })).toBe(15);
  });
});

describe('the band', () => {
  // 200 sections of 430 px (a 30 px header over a 400 px body) under a 600 px viewport: the band is the viewport and
  // two viewports above and below it.
  const layout = stackLayout(Array.from({ length: 200 }, (_, i) => section(`src/file-${i}.ts`)));
  const VIEWPORT = 600;
  const within = (i: number, scrollTop: number) => layout.bodyTops[i] <= scrollTop + 3 * VIEWPORT && layout.bodyTops[i] + layout.bodies[i]! >= scrollTop - 2 * VIEWPORT;

  it.each([
    ['at the top', 0, [0, 4]],
    ['in the middle', 100 * 430, [97, 104]],
    ['at the end', 200 * 430 - VIEWPORT, [195, 199]],
  ])('holds only the sections within two viewports, %s', (_where, scrollTop, [first, last]) => {
    const band = bandOf(layout.bodyTops, layout.bodies, scrollTop, VIEWPORT);
    expect([...band].sort((a, b) => a - b)).toEqual(Array.from({ length: last - first + 1 }, (_, i) => first + i));
    for (let i = 0; i < 200; i++) expect(band.has(i), `section ${i}`).toBe(within(i, scrollTop));
  });

  it('never answers a folded section, which has no body to draw', () => {
    const sections = Array.from({ length: 10 }, (_, i) => section(`f${i}.ts`, { folded: i % 3 === 0 }));
    const mixed = stackLayout(sections);
    const band = bandOf(mixed.bodyTops, mixed.bodies, 0, 10_000);
    expect([...band].sort((a, b) => a - b)).toEqual([1, 2, 4, 5, 7, 8]);
  });
});

describe('the place', () => {
  // The third file's rows, from its body's top: one row of 20 px a line, the new side's lines 40 to 59, in one block.
  const rowsOfThird = (rowPx = 20): StackRow[] => Array.from({ length: 20 }, (_, i) => ({ block: 0, side: 'new' as const, line: 40 + i, top: i * rowPx, height: rowPx }));
  const five = (bodies: (number | null)[]) => stackLayout(bodies.map((body, i) => section(`src/f${i}.ts`, { body })));

  it('is the section, the row and the pixels below the row at the scroller’s top edge', () => {
    const layout = five([400, 400, 400, 400, 400]);
    const scrollTop = layout.bodyTops[2] + 5 * 20 + 7; // seven pixels into the sixth row of the third file
    expect(placeAt(layout, scrollTop, (i) => (i === 2 ? rowsOfThird() : null))).toEqual({ path: 'src/f2.ts', row: { block: 0, side: 'new', line: 45 }, offset: 7 });
  });

  it('survives a change of the heights above it: the same file and row come back to the top', () => {
    const before = five([400, 400, 400, 400, 400]);
    const place = placeAt(before, before.bodyTops[2] + 5 * 20 + 7, (i) => (i === 2 ? rowsOfThird() : null))!;
    // late highlighting and a narrower column: the bodies above grow, and the third file's own rows reflow taller
    const after = five([1250, 980, 400, 400, 400]);
    const rows = (i: number) => (i === 2 ? rowsOfThird(26) : null);
    const restored = topOfPlace(after, place, rows);
    expect(restored).toEqual({ top: after.bodyTops[2] + 5 * 26 + 7, exact: true });
    expect(placeAt(after, restored!.top, rows)).toEqual(place);
  });

  it('falls back to the section’s top when its row is gone from the drawn body', () => {
    const layout = five([400, 400, 400, 400, 400]);
    const place = { path: 'src/f2.ts', row: { block: 0, side: 'new' as const, line: 45 }, offset: 7 };
    const without45 = (i: number) => (i === 2 ? rowsOfThird().filter((row) => row.line !== 45) : null);
    expect(topOfPlace(layout, place, without45)).toEqual({ top: layout.tops[2], exact: true });
  });

  it('is scrolled to by its section until the section draws, and then exactly', () => {
    const layout = five([400, 400, null, 400, 400]);
    const place = { path: 'src/f2.ts', row: { block: 0, side: 'new' as const, line: 45 }, offset: 7 };
    expect(topOfPlace(layout, place, noRows)).toEqual({ top: layout.tops[2], exact: false });
    expect(topOfPlace(layout, place, (i) => (i === 2 ? rowsOfThird() : null))).toEqual({ top: layout.bodyTops[2] + 5 * 20 + 7, exact: true });
  });

  it('is an offset from the section’s top where no row is drawn there: a folded or undrawn section, or its header', () => {
    const layout = stackLayout([section('a.ts'), section('b.ts', { folded: true }), section('c.ts')]);
    expect(placeAt(layout, layout.tops[1] + 12, noRows)).toEqual({ path: 'b.ts', row: null, offset: 12 });
    expect(placeAt(layout, layout.bodyTops[2] + 150, noRows)).toEqual({ path: 'c.ts', row: null, offset: HEADER + 150 });
    expect(placeAt(layout, layout.tops[2] + 10, () => rowsOfThird())).toEqual({ path: 'c.ts', row: null, offset: 10 }); // in the header
    expect(topOfPlace(layout, { path: 'b.ts', row: null, offset: 12 }, noRows)).toEqual({ top: layout.tops[1] + 12, exact: true });
    // a row place in a section folded since is reached at the section's top: its body will not draw
    expect(topOfPlace(layout, { path: 'b.ts', row: { block: 0, side: 'old', line: 3 }, offset: 4 }, noRows)).toEqual({ top: layout.tops[1], exact: true });
  });

  it('keeps the edit block a row is in: the same side and line in two blocks of Last turn come back in the later one', () => {
    // one file of two edits, each block holding the new side's lines 1 to 10; a 20 px gap between the blocks
    const rows: StackRow[] = [0, 1].flatMap((block) => Array.from({ length: 10 }, (_, i) => ({ block, side: 'new' as const, line: 1 + i, top: block * 220 + i * 20, height: 20 })));
    const layout = stackLayout([section('/p/a.ts', { body: 420 })]);
    const rowsOf = () => rows;
    const place = placeAt(layout, layout.bodyTops[0] + 220 + 4 * 20 + 6, rowsOf)!;
    expect(place).toEqual({ path: '/p/a.ts', row: { block: 1, side: 'new', line: 5 }, offset: 6 });
    expect(topOfPlace(layout, place, rowsOf)).toEqual({ top: layout.bodyTops[0] + 220 + 4 * 20 + 6, exact: true });
    // a hunk's reveal targets its own block's row
    expect(hunkPlace({ path: '/p/a.ts', index: 2, block: 1, anchor: { side: 'new', line: 5 } })).toEqual({ path: '/p/a.ts', row: { block: 1, side: 'new', line: 5 }, offset: 0 });
    expect(topOfPlace(layout, hunkPlace({ path: '/p/a.ts', index: 2, block: 1, anchor: { side: 'new', line: 5 } }), rowsOf)!.top).toBe(layout.bodyTops[0] + 220 + 4 * 20);
  });

  it('bounds the restored offset by the row’s current height, so a row that shrank keeps the place in it', () => {
    const layout = five([400, 400, 400, 400, 400]);
    // nineteen pixels into a 20 px row, then a zoom out to 10 px rows
    const place = placeAt(layout, layout.bodyTops[2] + 5 * 20 + 19, (i) => (i === 2 ? rowsOfThird() : null))!;
    expect(place.row).toEqual({ block: 0, side: 'new', line: 45 });
    const zoomed = five([200, 200, 200, 200, 200]);
    const smaller = (i: number) => (i === 2 ? rowsOfThird(10) : null);
    const restored = topOfPlace(zoomed, place, smaller)!;
    expect(restored.exact).toBe(true);
    expect(placeAt(zoomed, restored.top, smaller)?.row).toEqual({ block: 0, side: 'new', line: 45 });
    // a wrapped row three lines tall, read 50 px in, then the column widened and the row is one line again
    const wrapped = (tall: number) => (i: number) => (i === 2 ? rowsOfThird().map((row) => (row.line < 45 ? row : row.line === 45 ? { ...row, height: tall } : { ...row, top: row.top + tall - 20 })) : null);
    const deep = placeAt(layout, layout.bodyTops[2] + 5 * 20 + 50, wrapped(60))!;
    expect(deep).toEqual({ path: 'src/f2.ts', row: { block: 0, side: 'new', line: 45 }, offset: 50 });
    const back = topOfPlace(layout, deep, wrapped(20))!;
    expect(placeAt(layout, back.top, wrapped(20))?.row).toEqual({ block: 0, side: 'new', line: 45 });
  });

  it('has no top in a stack that no longer lists its file, and no place in an empty stack', () => {
    const layout = five([400, 400, 400, 400, 400]);
    expect(topOfPlace(layout, { path: 'gone.ts', row: null, offset: 0 }, noRows)).toBeNull();
    expect(placeAt(stackLayout([]), 0, noRows)).toBeNull();
  });
});

describe('folding', () => {
  it('folds by the person’s choice, else by Viewed, else past the scope’s cap, but not a file whose mark dropped', () => {
    // the person's own choice wins over every default
    expect(isFolded({ choice: 'open', viewed: true, dropped: false, pastCap: true })).toBe(false);
    expect(isFolded({ choice: 'closed', viewed: false, dropped: false, pastCap: false })).toBe(true);
    expect(isFolded({ choice: 'closed', viewed: false, dropped: true, pastCap: true })).toBe(true); // folded since the mark
    // Viewed folds
    expect(isFolded({ choice: undefined, viewed: true, dropped: false, pastCap: false })).toBe(true);
    // a scope past the cap opens folded
    expect(isFolded({ choice: undefined, viewed: false, dropped: false, pastCap: true })).toBe(true);
    // a mark that dropped (the file changed since) unfolds the file, past the cap too
    expect(isFolded({ choice: undefined, viewed: false, dropped: true, pastCap: false })).toBe(false);
    expect(isFolded({ choice: undefined, viewed: false, dropped: true, pastCap: true })).toBe(false);
  });

  it('reads "Expand all" while every file is folded, and "Collapse all" otherwise', () => {
    expect(everyFolded([true, true, true])).toBe(true);
    expect(everyFolded([true, false, true])).toBe(false);
    expect(everyFolded([])).toBe(false); // nothing to expand
  });
});

describe('the hunk order', () => {
  const hunk = (start: number, body = '-a\n+b') => `@@ -${start},1 +${start},1 @@\n${body}`;
  const huge = `@@ -1,0 +1,${REVIEW_FILE_LINES_CAP + 1} @@\n${'+x\n'.repeat(REVIEW_FILE_LINES_CAP + 1).slice(0, -1)}`;

  it('crosses files in stack order and skips Viewed, oversized and unloaded files', () => {
    const order = hunkOrder([
      { path: 'a.ts', hunks: [hunk(3), hunk(40)], blocks: [2], viewed: false },
      { path: 'viewed.ts', hunks: [hunk(1)], blocks: [1], viewed: true },
      { path: 'huge.ts', hunks: [huge], blocks: [1], viewed: false },
      { path: 'unloaded.ts', hunks: null, blocks: [], viewed: false },
      { path: 'b.ts', hunks: [hunk(7, '-gone')], blocks: [1], viewed: false },
    ]);
    expect(order).toEqual([
      { path: 'a.ts', index: 0, block: 0, anchor: { side: 'old', line: 3 } },
      { path: 'a.ts', index: 1, block: 0, anchor: { side: 'old', line: 40 } },
      { path: 'b.ts', index: 0, block: 0, anchor: { side: 'old', line: 7 } },
    ]);
  });

  it('names the block a hunk is drawn in: one block per edit in Last turn, one for a file read past the cap', () => {
    const order = hunkOrder([
      { path: '/p/a.ts', hunks: [hunk(1, '+n'), hunk(9, ' c\n+d'), hunk(2, '+e')], blocks: [2, 1], viewed: false },
      { path: 'fetched.ts', hunks: [hunk(5, '+f')], blocks: [], viewed: false },
    ]);
    expect(order.map(({ path, index, block }) => [path, index, block])).toEqual([
      ['/p/a.ts', 0, 0],
      ['/p/a.ts', 1, 0],
      ['/p/a.ts', 2, 1],
      ['fetched.ts', 0, 0],
    ]);
    expect(order[1].anchor).toEqual({ side: 'new', line: 9 });
  });
});
