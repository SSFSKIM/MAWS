// The main checkout of a repository whose git dir is apart from it (`git init --separate-git-dir`), which git records
// nowhere: the checkout's `.git` is a pointer file, nothing points back, and `git worktree list` names the git dir itself
// as the main worktree. One repair for both readers of that list, so they agree on which folder is the main work tree:
// the worktree service (./worktrees.ts, which the endpoint asks through `git.worktree.list`) and the files admission
// (../files/allowlist.ts, which reads git's own files; UX wave U8c-2's branch review).
import { dirname, join, resolve } from 'node:path';

/** How one reader resolves a path and reads a `.git` file, in its own form (the service's NFC realpaths; the admission's realpaths, where a failed read refuses). */
export interface CheckoutReads {
  /** The path resolved as the reader names paths, or null where it leads nowhere. */
  canonical(path: string): Promise<string | null>;
  /** The text of the `.git` file at `path`, or null where there is none to read as one (a `.git` directory, nothing). */
  pointer(path: string): Promise<string | null>;
}

/**
 * The main checkout of the repository whose common dir is `commonDir`, asked at the work tree `toplevel` whose git dir is
 * `gitDir` (all three as `reads` names paths): `toplevel` itself when its git dir is the common dir (the main checkout,
 * asked from itself); else the nearest folder above it whose `.git` pointer names the common dir (the engine's layout and
 * MAWS's put worktrees under the checkout's `.claude/worktrees/`); null when none does: a linked worktree outside its
 * main checkout leaves no trace of it (git's limit).
 */
export async function mainCheckout(at: { toplevel: string; gitDir: string; commonDir: string }, reads: CheckoutReads): Promise<string | null> {
  if (at.gitDir === at.commonDir) return at.toplevel;
  for (let dir = dirname(at.toplevel); ; dir = dirname(dir)) {
    const target = (await reads.pointer(join(dir, '.git')))?.match(/^gitdir:\s*(.+?)\s*$/m)?.[1];
    if (target !== undefined && (await reads.canonical(resolve(dir, target))) === at.commonDir) return dir;
    if (dirname(dir) === dir) return null;
  }
}
