// The setup intent's rules (C10 execution document, Interfaces "Session service", `session.intent.patch` and the
// setup's `guarding` row): what a location or an additional directory must be before anything is created, the
// directory a location starts in and the one its trust key is read from, and retry validation, which replaces the
// exists-checks for a checkout a failed attempt created and kept.
import { join } from 'node:path';
import { CHOOSE_PROJECT_FIRST, type Location, type SetupIntent } from '@shared/sessions/intent';
import { validateWorktreeName, worktreeDirName } from '@shared/sessions/worktree';
import { GitCommandError, type GitRun } from '../git/runner';
import type { WorktreeService } from '../git/worktrees';
import { canonicalPath } from './holders';
import { isDirectory, pathExists } from './context';

export type RuleVerdict = { ok: true } | { ok: false; kind: 'invalid'; field: string; message: string } | { ok: false; kind: 'missing_directory'; directory: string };

const OK: RuleVerdict = { ok: true };
const invalid = (field: string, message: string): RuleVerdict => ({ ok: false, kind: 'invalid', field, message });

export interface RuleDeps {
  git: GitRun;
  worktrees: WorktreeService;
}

// Where a new worktree goes: under the main root, whichever worktree `repoRoot` names.
export async function newWorktreeTarget(deps: RuleDeps, location: Extract<Location, { kind: 'newWorktree' }>): Promise<{ root: string; path: string; branch: string }> {
  const { repoRoot } = await deps.worktrees.list(location.repoRoot);
  return { root: repoRoot, path: join(repoRoot, '.claude', 'worktrees', worktreeDirName(location.name)), branch: location.branch.name };
}

// The directory whose trust key a location answers to before anything exists: a new worktree's repository root (the
// key is the main worktree's root either way), else the location's own path.
export function trustDirectoryOf(location: Location): string {
  return location.kind === 'newWorktree' ? location.repoRoot : location.path;
}

// Whether the intent's retained checkout is the one its location names (retry validation applies instead of the
// exists-checks).
export async function retainedMatches(deps: RuleDeps, intent: SetupIntent): Promise<boolean> {
  const w = intent.progress.worktree;
  if (w === null || !w.createdHere || intent.location?.kind !== 'newWorktree') return false;
  const target = await newWorktreeTarget(deps, intent.location).catch(() => null);
  return target !== null && (await canonicalPath(target.path)) === (await canonicalPath(w.path)) && w.branch === target.branch;
}

// A location as `session.intent.patch` and a start's guards check it. `forStart` turns a missing session directory
// into `missing_directory` (the start's outcome); a patch names it as the location field's error. A New chat with no
// project chosen has no location yet, which no start passes.
export async function checkLocation(deps: RuleDeps, intent: SetupIntent, opts: { forStart: boolean }): Promise<RuleVerdict> {
  const location = intent.location;
  if (location === null) return invalid('location', CHOOSE_PROJECT_FIRST);
  const missing = (directory: string): RuleVerdict => (opts.forStart ? { ok: false, kind: 'missing_directory', directory } : invalid('location', `directory not found: ${directory}`));
  switch (location.kind) {
    case 'directory':
      return (await isDirectory(location.path)) ? OK : missing(location.path);
    case 'existingWorktree': {
      const listed = await deps.worktrees.list(location.repoRoot).catch(() => null);
      if (listed === null) return invalid('location', `not a git repository: ${location.repoRoot}`);
      const path = await canonicalPath(location.path);
      if (!listed.worktrees.some((w) => w.path === path)) return invalid('location', `not a worktree of ${listed.repoRoot}: ${location.path}`);
      return (await isDirectory(path)) ? OK : missing(location.path);
    }
    case 'newWorktree': {
      if (opts.forStart && (await retainedMatches(deps, intent))) return checkRetained(deps, intent);
      const listed = await deps.worktrees.list(location.repoRoot).catch(() => null);
      if (listed === null) return invalid('location', `not a git repository: ${location.repoRoot}`);
      const named = validateWorktreeName(location.name);
      if (named !== null) return invalid('location', named);
      const root = listed.repoRoot;
      const path = join(root, '.claude', 'worktrees', worktreeDirName(location.name));
      if ((await pathExists(path)) || listed.worktrees.some((w) => w.path === path)) return invalid('location', 'worktree path exists');
      const branch = location.branch;
      if (!(await validBranchName(deps.git, root, branch.name))) return invalid('location', `invalid branch name: ${branch.name}`);
      const status = await deps.worktrees.branch(root, branch.name);
      if (branch.kind === 'new') {
        if (status !== null) return invalid('location', 'branch exists');
        if (branch.base === '' || branch.base.startsWith('-') || !(await resolves(deps.git, root, `${branch.base}^{commit}`))) return invalid('location', `base not found: ${branch.base}`);
        return OK;
      }
      if (status === null) return invalid('location', 'branch missing');
      if (status.checkedOutAt !== null) return invalid('location', `branch checked out at ${status.checkedOutAt}`);
      return OK;
    }
  }
}

// The retained checkout's identity as git shows it now: listed, on the branch the intent names, managed.
async function checkRetained(deps: RuleDeps, intent: SetupIntent): Promise<RuleVerdict> {
  const w = intent.progress.worktree!;
  const location = intent.location as Extract<Location, { kind: 'newWorktree' }>;
  const status = await deps.worktrees.status(location.repoRoot, w.path); // a fail-closed holder read is the command's error
  if (status === null) return invalid('location', `retained worktree changed: ${w.path} is no longer a worktree`);
  if (status.branch !== w.branch) return invalid('location', `retained worktree changed: ${w.path} is on ${status.branch ?? 'a detached HEAD'}, not ${w.branch}`);
  if (!status.managed) return invalid('location', `retained worktree changed: ${w.path} is not under .claude/worktrees`);
  return OK;
}

// Each additional directory exists, is not the session's own directory, and is listed once.
export async function checkAdditionalDirectories(intent: SetupIntent, sessionDirectory: string | null): Promise<RuleVerdict> {
  const session = sessionDirectory === null ? null : await canonicalPath(sessionDirectory);
  const seen = new Set<string>();
  for (const dir of intent.additionalDirectories) {
    if (!(await isDirectory(dir))) return invalid('additionalDirectories', `directory not found: ${dir}`);
    const real = await canonicalPath(dir);
    if (real === session) return invalid('additionalDirectories', `${dir} is the session directory`);
    if (seen.has(real)) return invalid('additionalDirectories', `${dir} is listed twice`);
    seen.add(real);
  }
  return OK;
}

// The directory a location's session would run in, before a new worktree exists (its intended path).
export async function sessionDirectoryOf(deps: RuleDeps, location: Location): Promise<string | null> {
  if (location.kind !== 'newWorktree') return location.path;
  return (await newWorktreeTarget(deps, location).catch(() => null))?.path ?? null;
}

async function validBranchName(git: GitRun, root: string, name: string): Promise<boolean> {
  try {
    await git(root, ['check-ref-format', '--branch', name]);
    return true;
  } catch (error) {
    if (error instanceof GitCommandError) return false;
    throw error;
  }
}

async function resolves(git: GitRun, root: string, rev: string): Promise<boolean> {
  try {
    return (await git(root, ['rev-parse', '--verify', '--quiet', rev])).trim() !== '';
  } catch (error) {
    if (error instanceof GitCommandError) return false;
    throw error;
  }
}
