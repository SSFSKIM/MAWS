import { describe, expect, it } from 'vitest';
import type { GitFileStatus, GitStatus } from '@shared/ipc/schema/git';
import { commitRefusal, discardTargets, isUnmerged, pathProblem, stageTargets, unstageTargets } from './validate';

const file = (path: string, xy: string, oldPath: string | null = null): GitFileStatus =>
  xy === '??' ? { path, oldPath: null, index: '?', worktree: '?', untracked: true } : { path, oldPath, index: xy[0], worktree: xy[1], untracked: false };

const status = (files: GitFileStatus[], head = 'abc123'): GitStatus => ({
  repoRoot: '/r', gitDir: '/r/.git', commonDir: '/r/.git', isWorktree: false, branch: 'main', head, upstream: null, remoteUrl: null,
  ahead: 0, behind: 0, dirty: files.length > 0, files, stashCount: 0, checkedAt: '2026-10-06T00:00:00.000Z',
});

// One of each shape the four groups hold: staged only, unstaged only, both, a worktree deletion, a staged rename, an
// untracked file and directory, a conflict.
const mixed = status([
  file('src/staged.ts', 'A.'),
  file('src/app.ts', '.M'),
  file('both.ts', 'MM'),
  file('gone.ts', '.D'),
  file('new.ts', 'R.', 'old.ts'),
  file('untracked.txt', '??'),
  file('udir/', '??'),
  file('c.ts', 'UU'),
]);

describe('scm validation refuses unlisted and unsafe paths', () => {
  it('refuses empty, absolute, NUL, newline and parent-segment paths before any lookup', () => {
    for (const path of ['', '/etc/passwd', 'a\0b', 'a\nb', '..', '../x', 'a/../b', 'a/..', 'a/../../x']) expect(pathProblem(path), JSON.stringify(path)).not.toBeNull();
    for (const path of ['a', 'a..b', '..a', '.hidden', 'udir/', 'src/app.ts', 'name with spaces', '-n']) expect(pathProblem(path), path).toBeNull();
  });

  it('knows a conflict by the codes porcelain v2 writes only for unmerged records', () => {
    for (const xy of ['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD']) expect(isUnmerged(file('c', xy)), xy).toBe(true);
    for (const xy of ['MM', 'A.', '.D', 'R.', 'AM', 'D.', '??']) expect(isUnmerged(file('c', xy)), xy).toBe(false);
  });

  describe('stage', () => {
    it('takes any listed entry with something to stage, a conflict included, and an untracked directory without its slash', () => {
      expect(stageTargets(mixed, ['src/app.ts', 'both.ts', 'gone.ts', 'untracked.txt', 'udir/', 'c.ts'])).toEqual({
        paths: ['src/app.ts', 'both.ts', 'gone.ts', 'untracked.txt', 'udir', 'c.ts'],
      });
      expect(stageTargets(mixed, ['src/app.ts', 'src/app.ts'])).toEqual({ paths: ['src/app.ts'] });
    });

    it('refuses as changed what the fresh status does not list with something to stage', () => {
      for (const path of ['src/staged.ts', 'new.ts', 'old.ts', 'nope.ts', 'udir', 'udir/x.txt', '../x', '/r/src/app.ts', 'SRC/APP.TS']) {
        expect(stageTargets(mixed, ['src/app.ts', path]), path).toMatchObject({ refused: 'changed', output: '' });
      }
    });
  });

  describe('unstage', () => {
    it('takes a staged entry; a rename by either name passes both', () => {
      expect(unstageTargets(mixed, ['src/staged.ts', 'both.ts'])).toEqual({ paths: ['src/staged.ts', 'both.ts'] });
      expect(unstageTargets(mixed, ['new.ts'])).toEqual({ paths: ['new.ts', 'old.ts'] });
      expect(unstageTargets(mixed, ['old.ts'])).toEqual({ paths: ['new.ts', 'old.ts'] });
    });

    it('refuses a conflict as unmerged and anything without a staged change as changed', () => {
      expect(unstageTargets(mixed, ['c.ts'])).toMatchObject({ refused: 'unmerged' });
      for (const path of ['src/app.ts', 'gone.ts', 'untracked.txt', 'udir/', 'nope', 'a/../src/staged.ts']) {
        expect(unstageTargets(mixed, [path]), path).toMatchObject({ refused: 'changed' });
      }
    });
  });

  describe('discard', () => {
    it('restores unstaged entries and cleans untracked ones, a directory entry keeping its slash', () => {
      expect(discardTargets(mixed, [
        { path: 'src/app.ts', group: 'unstaged' }, { path: 'gone.ts', group: 'unstaged' }, { path: 'both.ts', group: 'unstaged' },
        { path: 'untracked.txt', group: 'untracked' }, { path: 'udir/', group: 'untracked' },
      ])).toEqual({ restore: ['src/app.ts', 'gone.ts', 'both.ts'], clean: ['untracked.txt', 'udir/'] });
      expect(discardTargets(mixed, [{ path: 'untracked.txt', group: 'untracked' }])).toEqual({ restore: [], clean: ['untracked.txt'] });
    });

    it('refuses a conflict as unmerged and an entry outside its group as changed', () => {
      expect(discardTargets(mixed, [{ path: 'src/app.ts', group: 'unstaged' }, { path: 'c.ts', group: 'unstaged' }])).toMatchObject({ refused: 'unmerged' });
      expect(discardTargets(mixed, [{ path: 'c.ts', group: 'untracked' }])).toMatchObject({ refused: 'changed' });
      for (const entry of [
        { path: 'src/staged.ts', group: 'unstaged' }, { path: 'untracked.txt', group: 'unstaged' }, { path: 'src/app.ts', group: 'untracked' },
        { path: 'udir', group: 'untracked' }, { path: 'udir/x.txt', group: 'untracked' }, { path: '../outside', group: 'untracked' },
      ] as const) {
        expect(discardTargets(mixed, [entry]), `${entry.group} ${entry.path}`).toMatchObject({ refused: 'changed' });
      }
    });
  });

  describe('commit', () => {
    it('refuses a conflict, then an empty index, then an empty message', () => {
      expect(commitRefusal(mixed, 'x')).toMatchObject({ refused: 'unmerged' });
      expect(commitRefusal(status([file('a', '.M'), file('u', '??')]), 'x')).toMatchObject({ refused: 'nothing_staged' });
      expect(commitRefusal(status([]), 'x')).toMatchObject({ refused: 'nothing_staged' });
      expect(commitRefusal(status([file('a', 'M.')]), ' \n\t ')).toMatchObject({ refused: 'empty_message' });
      expect(commitRefusal(status([file('a', 'M.')]), 'From the panel')).toBeNull();
      expect(commitRefusal(status([file('a', 'D.')], ''), '-starts with a dash\n\nbody')).toBeNull();
    });
  });
});
