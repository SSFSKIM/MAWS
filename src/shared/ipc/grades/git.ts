// OX9 grades of `git.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md).
import type { CommandGrades } from '../grades';

export const grades = {
  'git.status': 'view',
  'git.branches': 'view',
  'git.diff': 'view',
  'git.log': 'view',
  'git.watch': 'view',
  'git.unwatch': 'view',
  'git.lsFiles': 'view',
  'git.worktree.list': 'view',
  'git.worktree.status': 'view',
  'git.worktree.branch': 'view',
  'git.worktree.add': 'spawn', // a worktree for a new session
  'git.worktree.remove': 'manage',
  'git.worktree.deleteBranch': 'manage',
} as const satisfies CommandGrades<'git'>;
