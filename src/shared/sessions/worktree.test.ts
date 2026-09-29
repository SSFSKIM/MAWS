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

  // The engine's own rule (`iDe`, SPEC §47 11.2; cli.pretty.js 892268 and 892296-892306), so a name MAWS takes is one
  // the terminal's `--worktree` and `EnterWorktree` take too; MAWS adds only the refusal of a leading '-'.
  const PART = "Each '/'-separated part of a worktree name must be non-empty and use only letters, digits, '.', '_' and '-'";
  it('accepts the names the engine accepts', () => {
    for (const ok of ['a', 'feat/login', '2026-09-29-abcd', 'x'.repeat(64), 'a..b', '.hidden', 'v1.2_rc-3', 'a/b/c', '.gitignore', 'git']) expect(validateWorktreeName(ok), ok).toBeNull();
  });

  it('refuses an empty or over-long name and a leading dash', () => {
    expect(validateWorktreeName('')).toBe('Worktree name is empty');
    expect(validateWorktreeName('x'.repeat(65))).toBe('Worktree name is longer than 64 characters');
    expect(validateWorktreeName('-rf')).toBe("Worktree name cannot start with '-'");
  });

  it("refuses a '.' or '..' segment, which would resolve the checkout to the worktrees directory or above it", () => {
    for (const bad of ['.', '..', 'a/./b', 'a/../b', '../escape', 'a/..']) expect(validateWorktreeName(bad), bad).toBe("Worktree name cannot contain a '.' or '..' segment");
  });

  it('refuses .git in any case and with trailing dots, as the engine does', () => {
    expect(validateWorktreeName('.git')).toBe("Worktree name cannot contain '.git', a name git reserves");
    expect(validateWorktreeName('a/.GIT')).toBe("Worktree name cannot contain '.GIT', a name git reserves");
    expect(validateWorktreeName('.git.')).toBe("Worktree name cannot contain '.git.', a name git reserves");
    expect(validateWorktreeName('.Git...')).toBe("Worktree name cannot contain '.Git...', a name git reserves");
  });

  it('refuses an empty segment and anything outside letters, digits, dot, underscore and dash', () => {
    for (const bad of ['a//b', 'a/', '/a', 'with space', ' a', 'a\n', 'a\0b', 'a\\b', 'caf\u00e9', 'a:b', 'a~b', 'a+b']) expect(validateWorktreeName(bad), JSON.stringify(bad)).toBe(PART);
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
