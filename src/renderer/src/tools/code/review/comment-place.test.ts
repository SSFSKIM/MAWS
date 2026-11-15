// A comment's line in Review (UX wave U5b, M5; §G, decision 11): the line a comment quotes, the anchor Review makes for
// it (card 4 at its default), the place an unsent comment is drawn at after a refresh, and where the card stands (D3).
import { describe, expect, it } from 'vitest';
import { REVIEW_COPY } from '../copy';
import { absolutePathOf, cardOffset, diffLines, lineText, placementOf, placeOf, reviewLineAnchor, UNPLACED_WORDS, type ScopeLines } from './comment-place';

// Line 12 was `return value;` and is `return quoted(value);`.
const HUNK = ['@@ -10,5 +10,5 @@', ' function cell(value) {', " if (value === '') return value;", '-return value;', '+return quoted(value);', ' }', ' const end = 1;'].join('\n');
// The same after the agent wrote two lines above it: its new line is 14, its old one still 12.
const MOVED = ['@@ -10,5 +10,7 @@', '+// one', '+// two', ' function cell(value) {', " if (value === '') return value;", '-return value;', '+return quoted(value);', ' }', ' const end = 1;'].join('\n');

describe('a comment’s line', () => {
  it('reads every line of a block on its side with its text: a removed line old, an added one new, a context line both', () => {
    expect(diffLines([HUNK]).filter((line) => line.line === 12)).toEqual([
      { side: 'old', line: 12, text: 'return value;' },
      { side: 'new', line: 12, text: 'return quoted(value);' },
    ]);
    expect(diffLines([HUNK]).filter((line) => line.line === 10)).toEqual([
      { side: 'old', line: 10, text: 'function cell(value) {' },
      { side: 'new', line: 10, text: 'function cell(value) {' },
    ]);
    expect(diffLines(['@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b'])).toEqual([
      { side: 'old', line: 1, text: 'a' },
      { side: 'new', line: 1, text: 'b' },
    ]);
  });

  it('quotes a line without its prefix, and has no quote for a line the block does not show', () => {
    expect(lineText([HUNK], 'new', 12)).toBe('return quoted(value);');
    expect(lineText([HUNK], 'old', 12)).toBe('return value;');
    expect(lineText([HUNK], 'new', 40)).toBeNull();
  });

  it('makes the anchor of the absolute path and the line, side old for a removed line, its label the file and the line on either side (card 4: no “· before”)', () => {
    expect(reviewLineAnchor('/repo/src/report.ts', 12, 'new')).toEqual({ kind: 'file-line', locator: '/repo/src/report.ts#L12', label: 'report.ts:12', path: '/repo/src/report.ts', line: 12 });
    expect(reviewLineAnchor('/repo/src/report.ts', 12, 'old')).toEqual({ kind: 'file-line', locator: '/repo/src/report.ts#L12', label: 'report.ts:12', path: '/repo/src/report.ts', line: 12, side: 'old' });
  });

  it('names a git scope’s file by the repository’s root and its path, and Last turn’s by its own absolute path', () => {
    expect(absolutePathOf({ path: 'src/report.ts' }, '/repo/')).toBe('/repo/src/report.ts');
    expect(absolutePathOf({ path: '/elsewhere/notes.md' }, '/repo')).toBe('/elsewhere/notes.md');
  });
});

describe('an unsent comment placed again at a refresh', () => {
  const added = { anchor: reviewLineAnchor('/repo/src/report.ts', 12, 'new'), quote: 'return quoted(value);' };
  const removed = { anchor: reviewLineAnchor('/repo/src/report.ts', 12, 'old'), quote: 'return value;' };

  it('finds the line whose text is the quote on the comment’s side, after lines above it moved it', () => {
    expect(placeOf(added, [[HUNK]])).toEqual({ block: 0, side: 'new', line: 12 });
    expect(placeOf(added, [[MOVED]])).toEqual({ block: 0, side: 'new', line: 14 });
    expect(placeOf(removed, [[MOVED]])).toEqual({ block: 0, side: 'old', line: 12 });
  });

  it('takes the nearest of two lines with the quote’s text to the line the anchor names', () => {
    const twice = ['@@ -1,0 +1,30 @@', ...Array.from({ length: 30 }, (_, i) => (i === 2 || i === 25 ? '+return quoted(value);' : `+line ${i}`))].join('\n');
    expect(placeOf(added, [[twice]])).toEqual({ block: 0, side: 'new', line: 3 });
    expect(placeOf({ ...added, anchor: reviewLineAnchor('/repo/src/report.ts', 20, 'new') }, [[twice]])).toEqual({ block: 0, side: 'new', line: 26 });
  });

  it('prefers the block it was made in, where two blocks hold the same text (Last turn’s edits)', () => {
    expect(placeOf(added, [[HUNK], [HUNK]])).toEqual({ block: 0, side: 'new', line: 12 });
    expect(placeOf(added, [[HUNK], [HUNK]], 1)).toEqual({ block: 1, side: 'new', line: 12 });
  });

  it('places a comment with no quote by its line alone', () => {
    expect(placeOf({ anchor: reviewLineAnchor('/repo/src/report.ts', 11, 'new'), quote: null }, [[HUNK]])).toEqual({ block: 0, side: 'new', line: 11 });
  });

  it('places nothing when the line left the diff: the comment is drawn under no line', () => {
    expect(placeOf(added, [[HUNK.replace('+return quoted(value);', '+return escaped(value);')]])).toBeNull();
    expect(placeOf(added, [])).toBeNull();
  });
});

describe('whether a comment can be placed (Decision Log 21): the table, row by row', () => {
  const added = { anchor: reviewLineAnchor('/repo/src/report.ts', 12, 'new'), quote: 'return quoted(value);' };
  const file = (blocks: string[][], read = true, binary = false) => ({ path: 'src/report.ts', absolute: '/repo/src/report.ts', blocks, read, binary });
  const ready = (...files: ScopeLines['files']): ScopeLines => ({ state: 'ready', files });

  it('placeable: the scope holds the file, read, with a line whose text is the quote', () => {
    expect(placementOf(added, ready(file([[MOVED]])))).toEqual({ kind: 'placed', path: 'src/report.ts', place: { block: 0, side: 'new', line: 14 } });
  });
  it('its line left the diff: the file is in the scope and read, and no line has the quote', () => {
    expect(placementOf(added, ready(file([[HUNK.replace('+return quoted(value);', '+return escaped(value);')]])))).toEqual({ kind: 'line-left', path: 'src/report.ts' });
  });
  it('its file is binary now: a completed read with no line, so its line left the diff', () => {
    expect(placementOf(added, ready(file([], false, true)))).toEqual({ kind: 'line-left', path: 'src/report.ts' });
    expect(placementOf(added, ready(file([], true, true)))).toEqual({ kind: 'line-left', path: 'src/report.ts' });
  });
  it('its file is not in the scope', () => {
    expect(placementOf(added, ready({ path: 'src/other.ts', absolute: '/repo/src/other.ts', blocks: [[HUNK]], read: true, binary: false }))).toEqual({ kind: 'not-in-scope' });
  });
  it('the scope is empty or cannot be read', () => {
    expect(placementOf(added, { state: 'none', files: [] })).toEqual({ kind: 'no-files' });
    expect(placementOf(added, ready())).toEqual({ kind: 'no-files' });
  });
  it('not read yet, which is not unplaceable: the scope is still being read, or the file’s own read has not answered', () => {
    expect(placementOf(added, { state: 'reading', files: [] })).toEqual({ kind: 'pending', path: null });
    expect(placementOf(added, ready(file([], false)))).toEqual({ kind: 'pending', path: 'src/report.ts' });
  });
  it('names the sentence over each unplaceable kind, and none for the others', () => {
    expect(UNPLACED_WORDS).toEqual({ 'line-left': REVIEW_COPY.lineLeftDiff, 'not-in-scope': REVIEW_COPY.fileNotInScope, 'no-files': REVIEW_COPY.fileNotInScope });
    expect(REVIEW_COPY.lineLeftDiff).toBe('The line this comment was on is no longer in this diff.');
    expect(REVIEW_COPY.fileNotInScope).toBe('The file this comment is on is not in this diff.');
  });
});

describe('where the card stands in its row (D3)', () => {
  it('from the code’s left edge where the gutter and the card fit, else from the row’s left edge', () => {
    expect(cardOffset(720, 80, 300)).toBe(80);
    expect(cardOffset(380, 80, 300)).toBe(80);
    expect(cardOffset(379, 80, 300)).toBe(0);
    expect(cardOffset(720, 0, 300)).toBe(0); // not laid out: the row's edge
  });
});
