import { describe, expect, it } from 'vitest';
import {
  BranchStatusSchema,
  cleanupState,
  CleanupRefusalSchema,
  defaultBranchName,
  validateWorktreeName,
  worktreeDirName,
  WorktreeStatusSchema,
  type BranchStatus,
  type WorktreeStatus,
} from './worktree';

const occupancy = { self: 0, foreign: 0, unbound: 0, idle: 0, archived: 0, idleAppSessionIds: [], liveAppSessionIds: [] };
const worktree = (state: WorktreeStatus['state']): WorktreeStatus => ({
  repoRoot: '/r',
  path: '/r/.claude/worktrees/a',
  branch: 'worktree-a',
  head: 'a'.repeat(40),
  isMain: false,
  locked: false,
  prunable: false,
  managed: true,
  dirty: { tracked: state === 'dirty' ? 1 : 0, untracked: 0 },
  occupancy,
  state,
});
const branch: BranchStatus = { repoRoot: '/r', branch: 'worktree-a', head: 'a'.repeat(40), checkedOutAt: null, base: 'main', ahead: 0, merged: true };

describe('worktree names (the engine’s convention, SPEC §47 11.1)', () => {
  it('flattens every slash to a plus for the directory and prefixes the branch with worktree-', () => {
    expect(worktreeDirName('feat/login')).toBe('feat+login');
    expect(worktreeDirName('a/b/c')).toBe('a+b+c');
    expect(worktreeDirName('plain')).toBe('plain');
    expect(defaultBranchName('feat/login')).toBe('worktree-feat+login');
  });

  it('accepts ordinary names and refuses what could escape the directory or confuse git', () => {
    for (const ok of ['a', 'feat/login', '2026-09-29-abcd', 'x'.repeat(100), 'a..b', 'with space inside']) expect(validateWorktreeName(ok), ok).toBeNull();
    expect(validateWorktreeName('')).toBe('Worktree name is empty');
    expect(validateWorktreeName('x'.repeat(101))).toBe('Worktree name is longer than 100 characters');
    expect(validateWorktreeName('-rf')).toBe("Worktree name cannot start with '-'");
    expect(validateWorktreeName('..')).toBe("Worktree name cannot contain a '..' segment");
    expect(validateWorktreeName('a/../b')).toBe("Worktree name cannot contain a '..' segment");
    expect(validateWorktreeName(' a')).toBe('Worktree name cannot start or end with whitespace');
    expect(validateWorktreeName('a\n')).toBe('Worktree name cannot start or end with whitespace');
    expect(validateWorktreeName('a\0b')).toBe('Worktree name cannot contain a NUL character');
    expect(validateWorktreeName('a\\b')).toBe("Worktree name cannot contain '\\'");
  });
});

describe('cleanup state machine', () => {
  it('derives the five states from fresh worktree and branch reads', () => {
    expect(cleanupState({ worktree: worktree('busy'), branch })).toBe('busy');
    expect(cleanupState({ worktree: worktree('dirty'), branch })).toBe('dirty');
    expect(cleanupState({ worktree: worktree('clean'), branch })).toBe('clean');
    expect(cleanupState({ worktree: worktree('clean'), branch: null })).toBe('clean'); // a detached HEAD checkout has no branch step
    expect(cleanupState({ worktree: null, branch })).toBe('detached');
    expect(cleanupState({ worktree: null, branch: null })).toBe('gone');
  });

  it('keeps the shapes strict: a refusal names one of the seven reasons', () => {
    expect(CleanupRefusalSchema.safeParse({ refused: 'changed', detail: 'head moved' }).success).toBe(true);
    expect(CleanupRefusalSchema.safeParse({ refused: 'nope', detail: '' }).success).toBe(false);
    expect(WorktreeStatusSchema.safeParse({ ...worktree('clean'), extra: 1 }).success).toBe(false);
    expect(BranchStatusSchema.safeParse(branch).success).toBe(true);
  });
});
