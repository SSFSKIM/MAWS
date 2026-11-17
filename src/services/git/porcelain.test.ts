import { describe, expect, it } from 'vitest';
import { parseBranches, parseLog, parseNumstat, parseRevParse, parseStatus, upstreamRemote } from './porcelain';

const z = (...entries: string[]) => entries.map((entry) => `${entry}\0`).join('');

describe('porcelain v2 parsing', () => {
  it('reads the branch headers and every record type, a rename taking the next NUL-separated path as its source', () => {
    const out = z(
      '# branch.oid 1111111111111111111111111111111111111111',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 aaaaaaa aaaaaaa src/a file.ts',
      '1 A. N... 000000 100644 100644 0000000 bbbbbbb added.ts',
      '2 R. N... 100644 100644 100644 ccccccc ccccccc R100 new name.ts',
      'old name.ts',
      'u UU N... 100644 100644 100644 100644 ddddddd eeeeeee fffffff conflict.ts',
      '? untracked dir/',
      '! ignored.log',
    );
    expect(parseStatus(out)).toEqual({
      branch: 'main',
      head: '1111111111111111111111111111111111111111',
      upstream: 'origin/main',
      ahead: 2,
      behind: 1,
      files: [
        { path: 'src/a file.ts', oldPath: null, index: '.', worktree: 'M', untracked: false },
        { path: 'added.ts', oldPath: null, index: 'A', worktree: '.', untracked: false },
        { path: 'new name.ts', oldPath: 'old name.ts', index: 'R', worktree: '.', untracked: false },
        { path: 'conflict.ts', oldPath: null, index: 'U', worktree: 'U', untracked: false },
        { path: 'untracked dir/', oldPath: null, index: '?', worktree: '?', untracked: true },
      ],
    });
  });

  it('reads a detached head, a repository with no commit and a branch without an upstream', () => {
    expect(parseStatus(z('# branch.oid 2222222222222222222222222222222222222222', '# branch.head (detached)'))).toMatchObject({
      branch: null,
      head: '2222222222222222222222222222222222222222',
      upstream: null,
      ahead: 0,
      behind: 0,
      files: [],
    });
    expect(parseStatus(z('# branch.oid (initial)', '# branch.head main'))).toMatchObject({ branch: 'main', head: '' });
  });

  // UX wave U6b-3a (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3a-what-changed.md, R2, M1 decision 8): a record whose
  // `sub` field begins with S is a submodule
  it('marks a submodule’s record of each of the three types, and no ordinary record in the same output', () => {
    const out = z(
      '# branch.oid 1111111111111111111111111111111111111111',
      '# branch.head main',
      '1 .M SC.. 160000 160000 160000 aaaaaaa aaaaaaa lib/gauges',
      '2 R. S..U 160000 160000 160000 bbbbbbb bbbbbbb R100 lib/tides',
      'lib/old-tides',
      'u UU S... 160000 160000 160000 160000 ccccccc ddddddd eeeeeee lib/harbor',
      '1 .M N... 100644 100644 100644 fffffff fffffff src/cart.ts',
      '2 R. N... 100644 100644 100644 ggggggg ggggggg R100 src/rates.ts',
      'src/old-rates.ts',
      'u UU N... 100644 100644 100644 100644 hhhhhhh iiiiiii jjjjjjj src/merge.ts',
      '? notes/',
    );
    const files = parseStatus(out).files;
    expect(files.filter((file) => file.submodule === true).map((file) => file.path)).toEqual(['lib/gauges', 'lib/tides', 'lib/harbor']);
    expect(files.filter((file) => !('submodule' in file)).map((file) => file.path)).toEqual(['src/cart.ts', 'src/rates.ts', 'src/merge.ts', 'notes/']);
    expect(files.find((file) => file.path === 'lib/tides')).toEqual({ path: 'lib/tides', oldPath: 'lib/old-tides', index: 'R', worktree: '.', untracked: false, submodule: true });
  });

  // The panel's scalpel 3, third finding: `sub` says what the index or HEAD held at the path; the work tree's own mode
  // (seen on the build VM's git: `1 .T S... 160000 160000 100644`) says whether a submodule's folder stands there now
  it('marks no submodule whose work tree holds something else in its place, a file, a link or nothing, beside one that holds its folder', () => {
    const out = z(
      '# branch.oid 1111111111111111111111111111111111111111',
      '1 .T S... 160000 160000 100644 aaaaaaa aaaaaaa lib/gauges',
      '1 .T S... 160000 160000 120000 bbbbbbb bbbbbbb lib/tides',
      '1 .D S... 160000 160000 000000 ccccccc ccccccc lib/harbor',
      '2 R. S... 160000 160000 100644 ddddddd ddddddd R100 lib/berth',
      'lib/old-berth',
      'u UU S... 160000 160000 160000 100644 eeeeeee fffffff 0000000 lib/quay',
      '1 .M SC.. 160000 160000 160000 ggggggg ggggggg lib/kept',
    );
    const files = parseStatus(out).files;
    expect(files.filter((file) => file.submodule === true).map((file) => file.path)).toEqual(['lib/kept']);
    expect(files.map((file) => [file.path, file.index, file.worktree])).toEqual([
      ['lib/gauges', '.', 'T'],
      ['lib/tides', '.', 'T'],
      ['lib/harbor', '.', 'D'],
      ['lib/berth', 'R', '.'],
      ['lib/quay', 'U', 'U'],
      ['lib/kept', '.', 'M'],
    ]);
  });

  it('refuses a record type it does not know rather than guessing its fields', () => {
    expect(() => parseStatus(z('# branch.oid (initial)', '9 what is this'))).toThrow(/unknown porcelain record/);
  });

  it('takes the three rev-parse paths in order', () => {
    expect(parseRevParse('/r\n/r/.git\n/r/.git\n')).toEqual({ repoRoot: '/r', gitDir: '/r/.git', commonDir: '/r/.git' });
  });

  it('names the upstream remote as the part before the first slash, or none', () => {
    expect(upstreamRemote('origin/main')).toBe('origin');
    expect(upstreamRemote('fork/feature/x')).toBe('fork');
    expect(upstreamRemote('main')).toBeNull(); // a local upstream (remote ".")
    expect(upstreamRemote(null)).toBeNull();
  });
});

describe('for-each-ref, numstat and log parsing', () => {
  it('lists branches with their upstreams and marks the current one', () => {
    const out = 'main\0origin/main\0*\nfeature\0\0 \n';
    expect(parseBranches(out)).toEqual({
      current: 'main',
      branches: [
        { name: 'main', upstream: 'origin/main', isCurrent: true },
        { name: 'feature', upstream: null, isCurrent: false },
      ],
    });
    expect(parseBranches('main\0\0 \n').current).toBeNull(); // detached: no branch is HEAD
  });

  it('reads -z numstat: counts, a rename as two paths, a binary as dashes', () => {
    const out = z('1\t0\tREADME.md', '3\t2\t', 'old.ts', 'new.ts', '-\t-\timage.png');
    expect(parseNumstat(out)).toEqual([
      { path: 'README.md', oldPath: null, insertions: 1, deletions: 0, binary: false },
      { path: 'new.ts', oldPath: 'old.ts', insertions: 3, deletions: 2, binary: false },
      { path: 'image.png', oldPath: null, insertions: 0, deletions: 0, binary: true },
    ]);
    expect(parseNumstat('')).toEqual([]);
  });

  it('reads -z log records of six fields, a root commit having no parents, with or without a trailing NUL', () => {
    const second = ['b'.repeat(40), 'bbbbbbb', 'Ada', '2026-09-28T10:00:00+09:00', 'second', 'a'.repeat(40)];
    const first = ['a'.repeat(40), 'aaaaaaa', 'Ada', '2026-09-28T09:00:00+09:00', 'initial', ''];
    const expected = [
      { sha: 'b'.repeat(40), shortSha: 'bbbbbbb', author: 'Ada', authoredAt: '2026-09-28T10:00:00+09:00', subject: 'second', parents: ['a'.repeat(40)] },
      { sha: 'a'.repeat(40), shortSha: 'aaaaaaa', author: 'Ada', authoredAt: '2026-09-28T09:00:00+09:00', subject: 'initial', parents: [] },
    ];
    expect(parseLog([...second, ...first].join('\0'))).toEqual(expected);
    expect(parseLog(`${[...second, ...first].join('\0')}\0`)).toEqual(expected);
    expect(parseLog('')).toEqual([]);
  });
});
