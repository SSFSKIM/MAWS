// X2 `git.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/git.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`: an entry
// added there adds its name here.
export const commands = [
  'git.status', 'git.branches', 'git.diff', 'git.log', 'git.watch', 'git.unwatch', 'git.lsFiles', 'git.worktree.list',
  'git.worktree.status', 'git.worktree.branch', 'git.worktree.add', 'git.worktree.remove', 'git.worktree.deleteBranch',
] as const;

export const events = [
  'git.changed',
] as const;
