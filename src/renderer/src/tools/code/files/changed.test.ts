// UX wave U6b-3a (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3a-what-changed.md, decisions 4, 5, 8 to 10 and 14,
// Interfaces §C): the Changed group's rows from a status, the tree's marks, and the set of a status's entries. Pure.
import { describe, expect, it } from 'vitest';
import type { GitFileStatus, GitStatus } from '@shared/ipc/schema/git';
import { changedRows, labelOf, LETTER_TONE, marksOf, statusSet, type ChangeLetter } from './changed';

type Entry = Pick<GitFileStatus, 'path'> & Partial<GitFileStatus>;

// One status entry from its XY pair as porcelain v2 gives it ('??' is an untracked entry).
const entry = (path: string, xy: string, more: Partial<GitFileStatus> = {}): Entry =>
  xy === '??' ? { path, index: '?', worktree: '?', untracked: true, ...more } : { path, index: xy[0], worktree: xy[1], untracked: false, ...more };

function statusOf(files: readonly Entry[], repoRoot = '/repo', more: Partial<GitStatus> = {}): GitStatus {
  return {
    repoRoot,
    gitDir: `${repoRoot}/.git`,
    commonDir: `${repoRoot}/.git`,
    isWorktree: false,
    branch: 'main',
    head: 'c0ffee',
    upstream: null,
    remoteUrl: null,
    ahead: 0,
    behind: 0,
    dirty: files.length > 0,
    files: files.map((file) => ({ oldPath: null, index: '.', worktree: '.', untracked: false, ...file })),
    stashCount: 0,
    checkedAt: '2026-11-17T10:00:00.000Z',
    ...more,
  };
}

const only = (xy: string) => changedRows(statusOf([entry('src/cart.ts', xy)]))[0];

describe('a row per path, a letter per row (decision 4)', () => {
  const cases: [string, ChangeLetter, boolean][] = [
    // unmerged, Review's predicate: a conflict; on disk unless both sides deleted
    ['UU', '!', true],
    ['AA', '!', true],
    ['AU', '!', true],
    ['UA', '!', true],
    ['DU', '!', true],
    ['UD', '!', true],
    ['DD', '!', false],
    ['??', 'U', true],
    // the working tree has lost it
    ['.D', 'D', false],
    ['MD', 'D', false],
    ['AD', 'D', false],
    ['RD', 'D', false],
    ['D.', 'D', false],
    // renamed, either side
    ['R.', 'R', true],
    ['RM', 'R', true],
    ['.R', 'R', true],
    // added or copied in the index
    ['A.', 'A', true],
    ['AM', 'A', true],
    ['C.', 'A', true],
    // everything else
    ['M.', 'M', true],
    ['.M', 'M', true],
    ['MM', 'M', true],
    ['.T', 'M', true],
    ['.A', 'M', true],
  ];
  it.each(cases)('%s is %s, on disk %s', (xy, letter, onDisk) => {
    expect(only(xy)).toMatchObject({ letter, onDisk, folder: false });
  });

  it('keeps the path, the absolute path and a rename’s source', () => {
    const [row] = changedRows(statusOf([entry('src/port.ts', 'R.', { oldPath: 'src/harbor-port.ts' })], '/coast'));
    expect(row).toEqual({ path: '/coast/src/port.ts', rel: 'src/port.ts', oldRel: 'src/harbor-port.ts', letter: 'R', folder: false, onDisk: true });
  });

  it('makes a folder’s row of a wholly untracked folder and of a submodule, without the trailing slash', () => {
    const rows = changedRows(statusOf([entry('notes/', '??'), entry('vendor/gauge-kit', '.M', { submodule: true }), entry('src/cart.ts', '.M')]));
    expect(rows.map((row) => [row.rel, row.path, row.letter, row.folder])).toEqual([
      ['notes', '/repo/notes', 'U', true],
      ['src/cart.ts', '/repo/src/cart.ts', 'M', false],
      ['vendor/gauge-kit', '/repo/vendor/gauge-kit', 'M', true],
    ]);
  });

  it('keeps the entry on disk when two entries name one path, whichever comes first', () => {
    for (const files of [
      [entry('src/tide.ts', 'D.'), entry('src/tide.ts', '??')],
      [entry('src/tide.ts', '??'), entry('src/tide.ts', 'D.')],
    ]) {
      expect(changedRows(statusOf(files)).map((row) => [row.rel, row.letter, row.onDisk])).toEqual([['src/tide.ts', 'U', true]]);
    }
  });

  it('puts conflicts first, then every row by its path (decision 5), not git’s tracked-then-untracked order', () => {
    const rows = changedRows(statusOf([entry('src/rates.ts', '.M'), entry('zeta/merge.ts', 'UU'), entry('docs/tides.md', '.M'), entry('src/cart.ts', '??'), entry('alpha/merge.ts', 'AA')]));
    expect(rows.map((row) => row.rel)).toEqual(['alpha/merge.ts', 'zeta/merge.ts', 'docs/tides.md', 'src/cart.ts', 'src/rates.ts']);
  });

  it('answers no row for a clean status', () => {
    expect(changedRows(statusOf([]))).toEqual([]);
  });
});

describe('the marks in the tree (decisions 9 and 10)', () => {
  it('answers a row’s letter for its path, across the /private spelling and across case', () => {
    const marks = marksOf(changedRows(statusOf([entry('src/cart.ts', '.M'), entry('src/rates.ts', 'A.')], '/private/tmp/coast')));
    expect(marks.letter('/private/tmp/coast/src/cart.ts')).toBe('M');
    expect(marks.letter('/tmp/coast/src/cart.ts')).toBe('M');
    expect(marks.letter('/tmp/Coast/SRC/Rates.ts')).toBe('A');
    expect(marks.letter('/tmp/coast/src/tides.ts')).toBeNull(); // the control: a path no row names
  });

  it('marks a row beneath an untracked folder U, and nothing beneath a submodule', () => {
    const marks = marksOf(changedRows(statusOf([entry('notes/', '??'), entry('vendor/gauge-kit', '.M', { submodule: true })])));
    expect(marks.letter('/repo/notes')).toBe('U');
    expect(marks.letter('/repo/notes/survey.md')).toBe('U');
    expect(marks.letter('/repo/notes/deep/er/survey.md')).toBe('U');
    expect(marks.letter('/repo/notes-old/survey.md')).toBeNull(); // a sibling whose name begins the same
    expect(marks.letter('/repo/vendor/gauge-kit')).toBe('M');
    expect(marks.letter('/repo/vendor/gauge-kit/readme.md')).toBeNull();
  });

  it('dots a folder with the weightiest change beneath: a conflict, then a modification, then a deletion, then the rest', () => {
    const marks = marksOf(
      changedRows(
        statusOf([
          entry('src/gauges/reading.ts', 'UU'),
          entry('src/tides/predict.ts', '.M'),
          entry('src/tides/old.ts', '.D'),
          entry('src/legacy/float.ts', '.D'),
          entry('src/legacy/new.ts', 'A.'),
          entry('docs/fresh.md', '??'),
        ]),
      ),
    );
    expect(marks.dot('/repo')).toBe('!');
    expect(marks.dot('/repo/src')).toBe('!');
    expect(marks.dot('/repo/src/gauges')).toBe('!');
    expect(marks.dot('/repo/src/tides')).toBe('M');
    expect(marks.dot('/repo/src/legacy')).toBe('D');
    expect(marks.dot('/repo/docs')).toBe('U');
    expect(marks.dot('/')).toBe('!'); // every folder above too
    expect(marks.dot('/repo/src/tides/predict.ts')).toBeNull(); // nothing beneath a file
    expect(marks.dot('/repo/test')).toBeNull();
    expect(marks.dot('/Repo/SRC/tides')).toBe('M'); // matched as letters are
  });

  it('gives each letter its tone (R1): a conflict and a deletion danger, a modification warning, the rest success', () => {
    expect(LETTER_TONE).toEqual({ '!': 'text-danger', D: 'text-danger', M: 'text-warning', A: 'text-success', U: 'text-success', R: 'text-success' });
  });
});

describe('the path a Changed row shows (decision 8)', () => {
  const rowsIn = (files: Entry[], repoRoot = '/coast') => changedRows(statusOf(files, repoRoot));

  it('names a row under the working folder from the working folder, and one outside it from the repository’s root', () => {
    const [inside, outside] = rowsIn([entry('harbor/src/tides/predict.ts', '.M'), entry('lighthouse/beacon.ts', 'A.')]);
    expect(labelOf(inside, '/coast/harbor')).toEqual({ name: 'predict.ts', folder: 'src/tides/', shown: 'src/tides/predict.ts' });
    expect(labelOf(outside, '/coast/harbor')).toEqual({ name: 'beacon.ts', folder: 'lighthouse/', shown: 'lighthouse/beacon.ts' });
    expect(labelOf(inside, '/coast')).toEqual({ name: 'predict.ts', folder: 'harbor/src/tides/', shown: 'harbor/src/tides/predict.ts' });
    expect(labelOf(inside, null)).toEqual({ name: 'predict.ts', folder: 'harbor/src/tides/', shown: 'harbor/src/tides/predict.ts' });
  });

  it('shows a folder’s row as its name with its slash, then its parent folder as a file’s row shows its folder', () => {
    const [deep, top] = rowsIn([entry('harbor/src/charts/', '??'), entry('harbor/notes/', '??')]);
    expect(labelOf(deep, '/coast/harbor')).toEqual({ name: 'charts/', folder: 'src/', shown: 'src/charts/' });
    expect(labelOf(top, '/coast/harbor')).toEqual({ name: 'notes/', folder: '', shown: 'notes/' }); // at the top of the working folder: no parent folder
  });

  it('matches the working folder across the /private spelling and case, and never a folder that merely begins like it', () => {
    const [row, sibling] = rowsIn([entry('harbor/a.ts', '.M'), entry('harbor-old/b.ts', '.M')], '/private/tmp/coast');
    expect(labelOf(row, '/tmp/coast/Harbor')).toMatchObject({ folder: '', shown: 'a.ts' });
    expect(labelOf(sibling, '/tmp/coast/harbor')).toMatchObject({ folder: 'harbor-old/', shown: 'harbor-old/b.ts' });
  });
});

describe('the set of a status’s entries (decision 14 (b))', () => {
  const files = [entry('src/cart.ts', '.M'), entry('notes/', '??')];

  it('is equal for two statuses listing the same entries in the same states, whatever else differs', () => {
    const later = statusOf(files, '/repo', { checkedAt: '2026-11-17T10:05:00.000Z', ahead: 3, head: 'beef', stashCount: 2 });
    expect(statusSet(later)).toBe(statusSet(statusOf(files)));
  });

  it('differs when a path appears or goes, or changes its letters or whether it is untracked', () => {
    const base = statusSet(statusOf(files));
    expect(statusSet(statusOf([...files, entry('src/rates.ts', 'A.')]))).not.toBe(base);
    expect(statusSet(statusOf(files.slice(0, 1)))).not.toBe(base);
    expect(statusSet(statusOf([entry('src/cart.ts', 'M.'), entry('notes/', '??')]))).not.toBe(base);
    expect(statusSet(statusOf([entry('src/cart.ts', '.M'), { path: 'notes/', index: '?', worktree: '?', untracked: false }]))).not.toBe(base);
  });
});
