// The writer's word diff (S4's `inline-diff.ts`, D1): hunks in old coordinates over cells of one UTF-16 unit each,
// tokens of words, whitespace runs and single symbols, embeds compared by their key, and S5's whitespace merge (A5).
import { describe, expect, it } from 'vitest';
import { diffCells, EMBED, equalMap, type DiffCell, type Hunk } from './inline-diff';

const cells = (text: string, keys: Record<number, string> = {}): DiffCell[] => [...Array(text.length).keys()].map((i) => (keys[i] ? { ch: EMBED, key: keys[i] } : { ch: text[i] }));
const show = (a: string, b: string, hunks: Hunk[]) => hunks.map((h) => `${a.slice(h.from, h.to)}→${b.slice(h.nFrom, h.nTo)}`);

describe('diffCells', () => {
  it('finds nothing between equal texts', () => {
    expect(diffCells(cells('The quick brown fox'), cells('The quick brown fox'))).toEqual([]);
  });

  it('replaces a word as one hunk in old and new coordinates', () => {
    const a = 'The quick brown fox';
    const b = 'The quick red fox';
    const hunks = diffCells(cells(a), cells(b));
    expect(hunks).toEqual([{ from: 10, to: 15, nFrom: 10, nTo: 13 }]);
  });

  it('merges hunks separated only by whitespace (A5), and keeps them apart when asked', () => {
    const a = 'with design review notes.';
    const b = 'with a short summary.';
    expect(show(a, b, diffCells(cells(a), cells(b)))).toEqual(['design review notes→a short summary']);
    expect(show(a, b, diffCells(cells(a), cells(b), { mergeWhitespace: false }))).toEqual(['design→a', 'review→short', 'notes→summary']);
  });

  it('works in UTF-16 units, so text outside the BMP diffs instead of throwing', () => {
    const a = 'I like 🍕 a lot';
    const b = 'I like 🍔 a lot';
    const hunks = diffCells(cells(a), cells(b));
    expect(show(a, b, hunks)).toEqual(['🍕→🍔']);
    expect(hunks[0].to - hunks[0].from).toBe(2);
  });

  it('compares embeds by their key, each one token', () => {
    const a = cells('a X b', { 2: 'date:2026-10-12' });
    expect(diffCells(a, cells('a X b', { 2: 'date:2026-10-12' }))).toEqual([]);
    expect(diffCells(a, cells('a X b', { 2: 'date:2026-10-13' }))).toEqual([{ from: 2, to: 3, nFrom: 2, nTo: 3 }]);
  });

  it('handles Korean words as words', () => {
    const a = '회의는 금요일에 열린다.';
    const b = '회의는 월요일에 열린다.';
    expect(show(a, b, diffCells(cells(a), cells(b)))).toEqual(['금요일에→월요일에']);
  });
});

describe('equalMap', () => {
  it('maps every unchanged old cell to its new index and changed ones to nothing', () => {
    const a = 'The quick brown fox';
    const b = 'The quick red fox';
    const map = equalMap(a.length, diffCells(cells(a), cells(b)));
    expect(map[4]).toBe(4); // q
    expect(map[12]).toBeUndefined(); // o of brown
    expect(map[16]).toBe(14); // f
    expect(b[map[18]!]).toBe('x');
  });
});
