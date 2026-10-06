// The Source control tool's groups (E6 execution document, Design §5): the four lists derived from C4's status.
import { describe, expect, it } from 'vitest';
import type { GitFileStatus } from '@shared/ipc/schema/git';
import { findTarget, groupsOf, isListed, unmerged } from './groups';
import { statusOf } from '../../test-support/scm';

const file = (path: string, index: string, worktree: string, over: Partial<GitFileStatus> = {}): GitFileStatus => ({
  path,
  oldPath: null,
  index,
  worktree,
  untracked: false,
  ...over,
});
const untracked = (path: string): GitFileStatus => ({ path, oldPath: null, index: '?', worktree: '?', untracked: true });

describe('scm groups derive the four lists', () => {
  it('is empty without a status', () => {
    expect(groupsOf(null)).toEqual({ conflicts: [], staged: [], unstaged: [], untracked: [] });
  });

  it('lists an MM file in Staged and in Unstaged, as git shows it', () => {
    const groups = groupsOf(statusOf({ files: [file('src/app.ts', 'M', 'M')] }));
    expect(groups.staged).toEqual([{ path: 'src/app.ts', oldPath: null, change: 'modified' }]);
    expect(groups.unstaged).toEqual([{ path: 'src/app.ts', oldPath: null, change: 'modified' }]);
    expect(groups.conflicts).toEqual([]);
    expect(groups.untracked).toEqual([]);
  });

  it('reads each side by its own character', () => {
    const groups = groupsOf(
      statusOf({
        files: [file('a.ts', 'A', 'M'), file('d.ts', '.', 'D'), file('gone.ts', 'D', '.'), file('t.ts', 'T', '.'), file('w.ts', '.', 'M')],
      }),
    );
    expect(groups.staged.map((e) => [e.path, e.change])).toEqual([
      ['a.ts', 'added'],
      ['gone.ts', 'deleted'],
      ['t.ts', 'type-changed'],
    ]);
    expect(groups.unstaged.map((e) => [e.path, e.change])).toEqual([
      ['a.ts', 'modified'],
      ['d.ts', 'deleted'],
      ['w.ts', 'modified'],
    ]);
  });

  it('keeps a rename or copy with its source on the side that renamed it', () => {
    const groups = groupsOf(statusOf({ files: [file('b2.txt', 'R', 'M', { oldPath: 'b.txt' }), file('c2.txt', 'C', '.', { oldPath: 'c.txt' })] }));
    expect(groups.staged).toEqual([
      { path: 'b2.txt', oldPath: 'b.txt', change: 'renamed' },
      { path: 'c2.txt', oldPath: 'c.txt', change: 'copied' },
    ]);
    expect(groups.unstaged).toEqual([{ path: 'b2.txt', oldPath: null, change: 'modified' }]); // the working tree's edit of the new path
  });

  it('lists every unmerged code as a conflict and nowhere else', () => {
    const codes: [string, string, string][] = [
      ['UU', 'U', 'U'],
      ['AA', 'A', 'A'],
      ['DD', 'D', 'D'],
      ['AU', 'A', 'U'],
      ['UA', 'U', 'A'],
      ['DU', 'D', 'U'],
      ['UD', 'U', 'D'],
    ];
    const groups = groupsOf(statusOf({ files: codes.map(([code, index, worktree]) => file(`${code}.txt`, index, worktree)) }));
    expect(groups.conflicts.map((e) => [e.path, e.change])).toEqual([
      ['UU.txt', 'both-modified'],
      ['AA.txt', 'both-added'],
      ['DD.txt', 'both-deleted'],
      ['AU.txt', 'added-by-one-side'],
      ['UA.txt', 'added-by-one-side'],
      ['DU.txt', 'deleted-by-one-side'],
      ['UD.txt', 'deleted-by-one-side'],
    ]);
    expect(groups.staged).toEqual([]);
    expect(groups.unstaged).toEqual([]);
  });

  it('keeps an AM or AD file out of Conflicts (only porcelain u records carry AA and DD)', () => {
    const groups = groupsOf(statusOf({ files: [file('n.ts', 'A', 'D'), file('m.ts', 'A', 'M')] }));
    expect(groups.conflicts).toEqual([]);
    expect(unmerged(file('n.ts', 'A', 'D'))).toBe(false);
    expect(unmerged(file('x.ts', 'D', 'D'))).toBe(true);
    expect(groups.staged.map((e) => e.path)).toEqual(['n.ts', 'm.ts']);
  });

  it('lists untracked files and directory entries as git does', () => {
    const groups = groupsOf(statusOf({ files: [untracked('untracked.txt'), untracked('udir/')] }));
    expect(groups.untracked).toEqual([
      { path: 'untracked.txt', oldPath: null, change: 'untracked' },
      { path: 'udir/', oldPath: null, change: 'untracked' },
    ]);
    expect(groups.staged).toEqual([]);
    expect(groups.unstaged).toEqual([]);
  });

  it('finds a target in whichever group lists it, Staged first', () => {
    const groups = groupsOf(statusOf({ files: [file('both.ts', 'M', 'M'), file('w.ts', '.', 'M'), file('c.ts', 'U', 'U'), untracked('u.txt')] }));
    expect(findTarget(groups, 'both.ts')).toEqual({ group: 'staged', path: 'both.ts' });
    expect(findTarget(groups, 'w.ts')).toEqual({ group: 'unstaged', path: 'w.ts' });
    expect(findTarget(groups, 'c.ts')).toEqual({ group: 'conflicts', path: 'c.ts' });
    expect(findTarget(groups, 'u.txt')).toEqual({ group: 'untracked', path: 'u.txt' });
    expect(findTarget(groups, 'clean.ts')).toBeNull();
    expect(isListed(groups, { group: 'unstaged', path: 'both.ts' })).toBe(true);
    expect(isListed(groups, { group: 'untracked', path: 'both.ts' })).toBe(false);
  });
});
