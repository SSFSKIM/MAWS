// The to-human mod's file of fold summaries as MAWS reads it (the UX wave, U2b: Interfaces §M, "The file: a contract,
// and its reader"): shape 2 alone, every entry three strings, bounded ids and one-line summaries, the newest 5,000 runs;
// and the one path a session's file can have. Every file here is invented.
import { describe, expect, it } from 'vitest';
import { FOLD_SUMMARIES_ENV, FOLDS_SHAPE, foldsFileOf, STORED_RUNS_MAX, storedRunsOf } from './folds';

const file = (runs: unknown, shape: unknown = 2) => JSON.stringify({ shape, runs });
const UUID = '0b7e2a5c-3f41-4d8e-9a60-1c2d3e4f5a6b';

describe('the contract', () => {
  it('is shape 2, and the one value MAWS writes is TO_HUMAN_FOLD_SUMMARIES=off', () => {
    expect([FOLDS_SHAPE, FOLD_SUMMARIES_ENV]).toEqual([2, 'TO_HUMAN_FOLD_SUMMARIES']);
  });
});

describe('storedRunsOf: the reader’s table', () => {
  it('reads shape 2: each entry its first row, its last and its summary, in the file’s order', () => {
    expect(storedRunsOf(file([['toolu_a1', 'toolu_a3', 'Ran the parser suite'], [UUID, 'toolu_b2', 'Fixed the date parser; 212 tests pass']]))).toEqual([
      { first: 'toolu_a1', last: 'toolu_a3', summary: 'Ran the parser suite' },
      { first: UUID, last: 'toolu_b2', summary: 'Fixed the date parser; 212 tests pass' },
    ]);
    expect(storedRunsOf(file([]))).toEqual([]);
  });

  it.each([
    ['shape 1, which every release before the mod’s pull request writes', file([['a', 'b', 'Ran it']], 1)],
    ['shape 3', file([['a', 'b', 'Ran it']], 3)],
    ['shape "2"', file([['a', 'b', 'Ran it']], '2')],
    ['no shape', JSON.stringify({ runs: [['a', 'b', 'Ran it']] })],
    ['runs not an array', file({ 0: ['a', 'b', 'Ran it'] })],
    ['a JSON array', JSON.stringify([2, [['a', 'b', 'Ran it']]])],
    ['JSON null', 'null'],
    ['a text that does not parse', '{"shape":2,"runs":[["a","b","Ran'],
    ['an empty text', ''],
  ])('reads none of %s', (_, text) => {
    expect(storedRunsOf(text)).toBeNull();
  });

  it('skips an entry that is not three strings', () => {
    const runs = [['a', 'b'], ['a', 'b', 'c', 'd'], ['a', 'b', 3], [null, 'b', 'c'], 'a,b,c', { first: 'a', last: 'b', summary: 'c' }, ['k1', 'k2', 'Kept']];
    expect(storedRunsOf(file(runs))).toEqual([{ first: 'k1', last: 'k2', summary: 'Kept' }]);
  });

  it('keeps an id of 1 to 256 characters and skips the entry otherwise', () => {
    const long = 'i'.repeat(256);
    expect(storedRunsOf(file([[long, long, 'Kept'], ['', 'b', 'No first'], ['a', '', 'No last'], [`${long}i`, 'b', 'Too long']]))).toEqual([{ first: long, last: long, summary: 'Kept' }]);
  });

  it('reads a summary of several lines to its first, trimmed', () => {
    expect(storedRunsOf(file([['a', 'b', '  Fixed the parser  \nthen ran the suite\r\nand more']]))).toEqual([{ first: 'a', last: 'b', summary: 'Fixed the parser' }]);
    expect(storedRunsOf(file([['a', 'b', '\n\n  Read the notes\n']]))).toEqual([{ first: 'a', last: 'b', summary: 'Read the notes' }]);
  });

  it('cuts a summary past 120 characters at 119 code points and an ellipsis, never inside a code point', () => {
    const exact = 'x'.repeat(120);
    expect(storedRunsOf(file([['a', 'b', exact]]))).toEqual([{ first: 'a', last: 'b', summary: exact }]);
    expect(storedRunsOf(file([['a', 'b', `${'x'.repeat(130)}`]]))![0]!.summary).toBe(`${'x'.repeat(119)}…`);
    const astral = '𝒜'.repeat(125); // one code point, two UTF-16 units each
    const cut = storedRunsOf(file([['a', 'b', astral]]))![0]!.summary;
    expect(Array.from(cut)).toHaveLength(120);
    expect(cut).toBe(`${'𝒜'.repeat(119)}…`);
  });

  it('skips a summary that is empty, or blank, or empty on its first line', () => {
    expect(storedRunsOf(file([['a', 'b', ''], ['c', 'd', '   '], ['e', 'f', ' \t '], ['g', 'h', 'Kept']]))).toEqual([{ first: 'g', last: 'h', summary: 'Kept' }]);
  });

  it('keeps the last 5,000 of more runs', () => {
    const runs = Array.from({ length: STORED_RUNS_MAX + 7 }, (_, n) => [`f${n}`, `l${n}`, `Run ${n}`]);
    const read = storedRunsOf(file(runs))!;
    expect(STORED_RUNS_MAX).toBe(5000);
    expect(read).toHaveLength(5000);
    expect(read[0]).toEqual({ first: 'f7', last: 'l7', summary: 'Run 7' });
    expect(read.at(-1)).toEqual({ first: `f${STORED_RUNS_MAX + 6}`, last: `l${STORED_RUNS_MAX + 6}`, summary: `Run ${STORED_RUNS_MAX + 6}` });
  });
});

describe('foldsFileOf: the one path a session’s file can have', () => {
  const HOME = '/home/someone/.claude';
  const DIR = `${HOME}/to-human/folds`;
  it('is <config home>/to-human/folds/<engine session id>.json', () => {
    expect(foldsFileOf(HOME, UUID)).toBe(`${DIR}/${UUID}.json`);
    expect(foldsFileOf(`${HOME}/`, UUID)).toBe(`${DIR}/${UUID}.json`);
    expect(foldsFileOf(HOME, 'a_B-9')).toBe(`${DIR}/a_B-9.json`);
    expect(foldsFileOf(HOME, 'i'.repeat(128))).toBe(`${DIR}/${'i'.repeat(128)}.json`);
  });
  it.each([
    ['empty', ''],
    ['a parent', '..'],
    ['a parent and a name', '../settings'],
    ['a deeper escape', '../../../etc/passwd'],
    ['a subfolder', 'a/b'],
    ['a backslash', 'a\\b'],
    ['an absolute path', '/etc/passwd'],
    ['a dot', 'a.json'],
    ['a NUL', 'a\u0000b'],
    ['a newline', 'a\nb'],
    ['a space', 'a b'],
    ['an encoded escape', '%2e%2e%2fsettings'],
    ['a letter outside ASCII', 'é'],
    ['a tilde', '~'],
    ['129 characters', 'i'.repeat(129)],
  ])('answers null for an id that is no plain file name: %s', (_, id) => {
    expect(foldsFileOf(HOME, id)).toBeNull();
  });
  it('never answers a path outside the folds folder, however an id is written', () => {
    const ids = ['..', '.', '../x', 'x/..', 'x/../../y', '∕etc', 'x․json', '..%2f', '.\u0000.', ...Array.from({ length: 64 }, (_, n) => String.fromCharCode(n * 2 + 1).repeat(3))];
    for (const id of ids) {
      const path = foldsFileOf(HOME, id);
      if (path === null) continue;
      expect(path.startsWith(`${DIR}/`), JSON.stringify(id)).toBe(true);
      expect(path.slice(DIR.length + 1), JSON.stringify(id)).toMatch(/^[A-Za-z0-9_-]+\.json$/);
    }
  });
});
