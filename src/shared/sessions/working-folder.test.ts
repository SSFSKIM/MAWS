import { describe, expect, it } from 'vitest';
import { record } from '../../../test/support/builders';
import { workingFolder } from './working-folder';

// UX wave U8a (UC-4, first landing): the folder the record names, in all three fields, and never moved. The second
// landing changes these cases knowingly.
describe('workingFolder', () => {
  it("answers the record's directory for a session with no worktree", () => {
    expect(workingFolder(record('a', { directory: '/repo', worktree: null }))).toEqual({ path: '/repo', cwd: '/repo', launch: '/repo', moved: false });
  });

  it("answers the worktree's root for a session with a worktree", () => {
    const folder = workingFolder(record('w', { directory: '/repo', worktree: { path: '/repo/.claude/worktrees/w1', branch: 'worktree-w1' } }));
    expect(folder).toEqual({ path: '/repo/.claude/worktrees/w1', cwd: '/repo/.claude/worktrees/w1', launch: '/repo/.claude/worktrees/w1', moved: false });
  });

  it("answers the worktree's root in cwd too when the directory lies inside the worktree", () => {
    const folder = workingFolder(record('d', { directory: '/repo/.claude/worktrees/w1/pkg', worktree: { path: '/repo/.claude/worktrees/w1', branch: null } }));
    expect(folder).toEqual({ path: '/repo/.claude/worktrees/w1', cwd: '/repo/.claude/worktrees/w1', launch: '/repo/.claude/worktrees/w1', moved: false });
  });

  it('answers the empty string for a record whose directory is empty', () => {
    expect(workingFolder(record('e', { directory: '', worktree: null }))).toEqual({ path: '', cwd: '', launch: '', moved: false });
  });

  it('reads only the directory and the worktree', () => {
    expect(workingFolder({ directory: '/repo', worktree: null }).path).toBe('/repo');
  });
});
