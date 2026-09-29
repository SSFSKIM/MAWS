// Worktree shapes and the cleanup ladder's pure rules (C10 execution document, Interfaces "Shared shapes", worktree.ts,
// and "Worktrees"): what `git.worktree.*` answers, the engine's naming convention for a managed worktree
// (`<repoRoot>/.claude/worktrees/<name with '/' → '+'>` on `worktree-<same>`, SPEC §47 11.1), and the state the cleanup
// dialog derives from fresh reads before each step. Strict: app shapes. The git work itself is main's
// (src/main/git/worktrees.ts); who occupies a directory is holder authority's (src/main/sessions/holders.ts).
import * as z from 'zod';
import { AppSessionIdSchema } from '../graph/ids';

// branch null on a detached HEAD; managed: under <repoRoot>/.claude/worktrees/; isMain: the repository's main worktree
export const WorktreeInfoSchema = z.strictObject({
  repoRoot: z.string(),
  path: z.string(),
  branch: z.string().nullable(),
  head: z.string(),
  isMain: z.boolean(),
  locked: z.boolean(),
  prunable: z.boolean(),
  managed: z.boolean(),
});
export type WorktreeInfo = z.infer<typeof WorktreeInfoSchema>;

// Who is in a directory now (holder authority, never the index's projection). self: MAWS reservations there (a
// record-less trust bootstrap included); foreign: live registry holders of sessions the index knows; unbound: live
// registry holders there whose session the index has not seen (only counted, no id); idle/archived: index records here
// without a process. idleAppSessionIds and liveAppSessionIds partition the non-archived records here.
export const WorktreeOccupancySchema = z.strictObject({
  self: z.number().int(),
  foreign: z.number().int(),
  unbound: z.number().int(),
  idle: z.number().int(),
  archived: z.number().int(),
  idleAppSessionIds: z.array(AppSessionIdSchema),
  liveAppSessionIds: z.array(AppSessionIdSchema),
});
export type WorktreeOccupancy = z.infer<typeof WorktreeOccupancySchema>;

export const WorktreeStatusSchema = WorktreeInfoSchema.extend({
  dirty: z.strictObject({ tracked: z.number().int(), untracked: z.number().int() }),
  occupancy: WorktreeOccupancySchema,
  state: z.enum(['busy', 'dirty', 'clean']), // busy: any process there, or locked; else dirty: any change; else clean
});
export type WorktreeStatus = z.infer<typeof WorktreeStatusSchema>;

// base: the main worktree's branch (else 'HEAD'); ahead: commits on the branch not on base; merged: ahead === 0
export const BranchStatusSchema = z.strictObject({
  repoRoot: z.string(),
  branch: z.string(),
  head: z.string(),
  checkedOutAt: z.string().nullable(),
  base: z.string(),
  ahead: z.number().int(),
  merged: z.boolean(),
});
export type BranchStatus = z.infer<typeof BranchStatusSchema>;

// `changed`: the identity the caller expected is not what git shows now
export const CleanupRefusalSchema = z.strictObject({
  refused: z.enum(['busy', 'dirty', 'locked', 'changed', 'missing', 'checked_out', 'unmerged']),
  detail: z.string(),
});
export type CleanupRefusal = z.infer<typeof CleanupRefusalSchema>;

export type CleanupState = 'busy' | 'dirty' | 'clean' | 'detached' | 'gone';

export function worktreeDirName(name: string): string {
  return name.replaceAll('/', '+');
}

export function defaultBranchName(name: string): string {
  return `worktree-${worktreeDirName(name)}`;
}

// null when valid, else the message the chip and the fork sheet show. The directory name keeps no '/', so only a whole
// '..' could leave `.claude/worktrees/`; the rest keeps a name git and a shell read as one plain argument.
export function validateWorktreeName(name: string): string | null {
  if (name.length === 0) return 'Worktree name is empty';
  if (name.length > 100) return 'Worktree name is longer than 100 characters';
  if (name.startsWith('-')) return "Worktree name cannot start with '-'";
  if (name.split('/').includes('..')) return "Worktree name cannot contain a '..' segment";
  if (name.trim() !== name) return 'Worktree name cannot start or end with whitespace';
  if (name.includes('\0')) return 'Worktree name cannot contain a NUL character';
  if (name.includes('\\')) return "Worktree name cannot contain '\\'";
  return null;
}

// The cleanup dialog's state, derived from `git.worktree.status` and `git.worktree.branch` read immediately before each
// step: a listed checkout answers its own state; without one, a branch that still exists is `detached` (only the
// branch step remains) and nothing at all is `gone`.
export function cleanupState(s: { worktree: WorktreeStatus | null; branch: BranchStatus | null }): CleanupState {
  if (s.worktree !== null) return s.worktree.state;
  return s.branch !== null ? 'detached' : 'gone';
}
