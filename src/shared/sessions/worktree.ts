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

const WORKTREE_NAME_MAX = 64;
const WORKTREE_NAME_PART = /^[a-zA-Z0-9._-]+$/;

// null when valid, else the message the chip and the fork sheet show. The engine's own rule (`iDe`, SPEC §47 11.2;
// cli.pretty.js 892268 and 892296-892306), so MAWS's worktrees and the terminal's `--worktree`/`EnterWorktree` ones
// share one naming space: at most 64 characters; per '/'-separated segment no '.' or '..' (either would resolve the
// checkout to `.claude/worktrees` itself or above it), no '.git' in any case or with trailing dots, and only letters,
// digits, '.', '_' and '-'. MAWS adds one refusal the engine lacks, a leading '-', so a name never reads as an option.
export function validateWorktreeName(name: string): string | null {
  if (name.length === 0) return 'Worktree name is empty';
  if (name.length > WORKTREE_NAME_MAX) return `Worktree name is longer than ${WORKTREE_NAME_MAX} characters`;
  if (name.startsWith('-')) return "Worktree name cannot start with '-'";
  for (const part of name.split('/')) {
    if (part === '.' || part === '..') return "Worktree name cannot contain a '.' or '..' segment";
    if (part.toLowerCase().replace(/\.+$/, '') === '.git') return `Worktree name cannot contain '${part}', a name git reserves`;
    if (!WORKTREE_NAME_PART.test(part)) return "Each '/'-separated part of a worktree name must be non-empty and use only letters, digits, '.', '_' and '-'";
  }
  return null;
}

// The cleanup dialog's state, derived from `git.worktree.status` and `git.worktree.branch` read immediately before each
// step: a listed checkout answers its own state; without one, a branch that still exists is `detached` (only the
// branch step remains) and nothing at all is `gone`.
export function cleanupState(s: { worktree: WorktreeStatus | null; branch: BranchStatus | null }): CleanupState {
  if (s.worktree !== null) return s.worktree.state;
  return s.branch !== null ? 'detached' : 'gone';
}
