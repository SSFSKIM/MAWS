// X2 `git.*` (C4 execution document, Interfaces "X2 additions" and "Git service"; charter §4.5): main's read-only git
// service. Status, branches, diff and log for any directory inside a repository or linked worktree, and a ref-counted
// repository watcher that emits `git.changed` with the fresh status. Owner `main` for every command. Nothing here
// stages, commits, stashes, checks out, fetches or touches a worktree's existence (C10 and P1 own mutation).
import * as z from 'zod';
// C10 start
import { BranchChoiceSchema } from '../../sessions/intent';
import { BranchStatusSchema, CleanupRefusalSchema, WorktreeInfoSchema, WorktreeStatusSchema } from '../../sessions/worktree';
// C10 end
import type { CommandSpec } from './common';

// One entry of `git status --porcelain=v2`: `index` and `worktree` are the X and Y characters of the record's XY field
// (`.` for unchanged); an untracked file is `?` in both.
export const GitFileStatusSchema = z.strictObject({
  path: z.string(), // relative to repoRoot
  oldPath: z.string().nullable(), // the rename or copy source of a `2` record
  index: z.string(),
  worktree: z.string(),
  untracked: z.boolean(),
});
export type GitFileStatus = z.infer<typeof GitFileStatusSchema>;

export const GitStatusSchema = z.strictObject({
  repoRoot: z.string(), // the worktree's top level (a linked worktree's own root, not the main repository's)
  gitDir: z.string(),
  commonDir: z.string(),
  isWorktree: z.boolean(), // a linked worktree: gitDir !== commonDir
  branch: z.string().nullable(), // null when HEAD is detached
  head: z.string(), // the commit HEAD names; '' in a repository with no commit yet
  upstream: z.string().nullable(),
  remoteUrl: z.string().nullable(), // the upstream remote's URL (`git remote get-url`), else `origin`'s (or the sole remote's) when no upstream is set; null for a local upstream or without a URL (C8's ask)
  ahead: z.number().int(),
  behind: z.number().int(),
  dirty: z.boolean(),
  files: z.array(GitFileStatusSchema),
  stashCount: z.number().int(),
  checkedAt: z.string(), // ISO time the status was read
});
export type GitStatus = z.infer<typeof GitStatusSchema>;

export const GitBranchesSchema = z.strictObject({
  current: z.string().nullable(),
  branches: z.array(z.strictObject({ name: z.string(), upstream: z.string().nullable(), isCurrent: z.boolean() })),
});
export type GitBranches = z.infer<typeof GitBranchesSchema>;

export const GitDiffScopeSchema = z.enum(['worktree', 'staged', 'all']);
export type GitDiffScope = z.infer<typeof GitDiffScopeSchema>;
export const GitDiffInputSchema = z.strictObject({
  directory: z.string(),
  scope: GitDiffScopeSchema,
  base: z.string().optional(),
  path: z.string().optional(),
  context: z.number().int().min(0).max(20).optional(),
});
export type GitDiffInput = z.infer<typeof GitDiffInputSchema>;
export const GitDiffFileSchema = z.strictObject({
  path: z.string(),
  oldPath: z.string().nullable(),
  insertions: z.number().int(),
  deletions: z.number().int(),
  binary: z.boolean(),
});
export type GitDiffFile = z.infer<typeof GitDiffFileSchema>;
export const GitDiffSchema = z.strictObject({ patch: z.string(), files: z.array(GitDiffFileSchema) });
export type GitDiff = z.infer<typeof GitDiffSchema>;

export const GitLogInputSchema = z.strictObject({ directory: z.string(), limit: z.number().int().min(1).max(500), path: z.string().optional() });
export type GitLogInput = z.infer<typeof GitLogInputSchema>;
export const GitCommitSchema = z.strictObject({
  sha: z.string(),
  shortSha: z.string(),
  author: z.string(),
  authoredAt: z.string(),
  subject: z.string(),
  parents: z.array(z.string()),
});
export type GitCommit = z.infer<typeof GitCommitSchema>;
export const GitLogSchema = z.strictObject({ commits: z.array(GitCommitSchema) });
export type GitLog = z.infer<typeof GitLogSchema>;

export const GitChangeReasonSchema = z.enum(['worktree', 'index', 'head', 'refs', 'initial']);
export type GitChangeReason = z.infer<typeof GitChangeReasonSchema>;
export const GitChangedSchema = z.strictObject({ repoRoot: z.string(), status: GitStatusSchema, reason: GitChangeReasonSchema });
export type GitChanged = z.infer<typeof GitChangedSchema>;

const DirectorySchema = z.strictObject({ directory: z.string() });

// C7 start: the composer's `@` file source (C7 execution document, Interfaces "X2 additions"): the files under
// `directory` (`git ls-files --cached --others --exclude-standard`, or a bounded walk outside a repository), fuzzy-
// filtered by `query` and ranked, relative to `directory`; refused for a directory no session or project names.
export const LsFilesInputSchema = z.strictObject({ directory: z.string(), query: z.string().max(256), limit: z.number().int().positive().max(200) });
export type LsFilesInput = z.infer<typeof LsFilesInputSchema>;
export const LsFilesSchema = z.strictObject({ paths: z.array(z.string()), truncated: z.boolean(), source: z.enum(['git', 'walk']) });
export type LsFiles = z.infer<typeof LsFilesSchema>;
const c7Commands = {
  'git.lsFiles': { input: LsFilesInputSchema, output: LsFilesSchema, owner: 'main' },
} as const satisfies Record<`git.${string}`, CommandSpec<z.ZodType, z.ZodType>>;
// C7 end
// C10 start: the worktree service (C10 execution document, Interfaces "Worktrees"; charter §4.5). Every git mutation MAWS
// makes is one of these, in C10's own module (src/main/git/worktrees.ts), beside C4's read-only service. Owner main. The
// cleanup ladder's four operations are separate: archive is `session.archive` per id, then `remove` (the checkout, with
// the identity the dialog captured as `expect`) and `deleteBranch` (with its head as `expect`), each answering a
// refusal rather than acting when the fresh read disagrees.
const RepoRootSchema = z.strictObject({ repoRoot: z.string() });
export const GitWorktreeListSchema = z.strictObject({ repoRoot: z.string(), commonDir: z.string(), worktrees: z.array(WorktreeInfoSchema) });
export type GitWorktreeList = z.infer<typeof GitWorktreeListSchema>;
export const GitWorktreeAddInputSchema = z.strictObject({ repoRoot: z.string(), name: z.string(), branch: BranchChoiceSchema });
export type GitWorktreeAddInput = z.infer<typeof GitWorktreeAddInputSchema>;
export const GitWorktreeRemoveInputSchema = z.strictObject({
  repoRoot: z.string(),
  path: z.string(),
  expect: z.strictObject({ branch: z.string().nullable(), head: z.string() }),
  discard: z.boolean(), // `worktree remove --force`: the dialog's acknowledged discard of uncommitted changes
});
export type GitWorktreeRemoveInput = z.infer<typeof GitWorktreeRemoveInputSchema>;
export const GitWorktreeRemovedSchema = z.union([z.strictObject({ removed: z.literal(true), prunedOnly: z.boolean() }), CleanupRefusalSchema]);
export type GitWorktreeRemoved = z.infer<typeof GitWorktreeRemovedSchema>;
export const GitWorktreeDeleteBranchInputSchema = z.strictObject({
  repoRoot: z.string(),
  branch: z.string(),
  expect: z.strictObject({ head: z.string() }),
  acknowledgeUnmerged: z.boolean(),
});
export type GitWorktreeDeleteBranchInput = z.infer<typeof GitWorktreeDeleteBranchInputSchema>;
export const GitBranchDeletedSchema = z.union([z.strictObject({ deleted: z.literal(true), wasMerged: z.boolean() }), CleanupRefusalSchema]);
export type GitBranchDeleted = z.infer<typeof GitBranchDeletedSchema>;

const c10Commands = {
  'git.worktree.list': { input: RepoRootSchema, output: GitWorktreeListSchema, owner: 'main' },
  'git.worktree.status': { input: z.strictObject({ repoRoot: z.string(), path: z.string() }), output: WorktreeStatusSchema.nullable(), owner: 'main' }, // null: not listed
  'git.worktree.branch': { input: z.strictObject({ repoRoot: z.string(), branch: z.string() }), output: BranchStatusSchema.nullable(), owner: 'main' }, // null: no such local branch
  'git.worktree.add': { input: GitWorktreeAddInputSchema, output: WorktreeInfoSchema, owner: 'main' },
  'git.worktree.remove': { input: GitWorktreeRemoveInputSchema, output: GitWorktreeRemovedSchema, owner: 'main' },
  'git.worktree.deleteBranch': { input: GitWorktreeDeleteBranchInputSchema, output: GitBranchDeletedSchema, owner: 'main' },
} as const satisfies Record<`git.worktree.${string}`, CommandSpec<z.ZodType, z.ZodType>>;
// C10 end

export const commands = {
  'git.status': { input: DirectorySchema, output: GitStatusSchema, owner: 'main' },
  'git.branches': { input: DirectorySchema, output: GitBranchesSchema, owner: 'main' },
  'git.diff': { input: GitDiffInputSchema, output: GitDiffSchema, owner: 'main' },
  'git.log': { input: GitLogInputSchema, output: GitLogSchema, owner: 'main' },
  'git.watch': { input: DirectorySchema, output: GitStatusSchema, owner: 'main' }, // idempotent; ref-counted per repoRoot
  'git.unwatch': { input: DirectorySchema, output: z.void(), owner: 'main' },
  ...c7Commands, // C7
  ...c10Commands, // C10
} as const satisfies Record<`git.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'git.changed': GitChangedSchema,
} as const satisfies Record<`git.${string}`, z.ZodType>;
