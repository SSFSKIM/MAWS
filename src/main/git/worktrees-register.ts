// Main's handlers for `git.worktree.*` (C10 execution document, Interfaces "Worktrees"), kept apart from the service so
// `WorktreeService` stays free of Electron for whoever constructs it (M3's session service, its tests). A git call
// killed at its 10 s timeout answers `timeout`, as C4's `git.*` do; a refusal decided before acting is `internal` with
// its named message (`worktree path exists`, `base not found: …`).
import { ipcError } from '@shared/ipc/errors';
import { CommandFailure, registerMainHandler } from '../ipc/router';
import { GitTimeoutError } from './runner';
import type { WorktreeService } from './worktrees';

export function registerWorktreeHandlers(service: WorktreeService): void {
  registerMainHandler('git.worktree.list', ({ repoRoot }) => relay(() => service.list(repoRoot)));
  registerMainHandler('git.worktree.status', ({ repoRoot, path }) => relay(() => service.status(repoRoot, path)));
  registerMainHandler('git.worktree.branch', ({ repoRoot, branch }) => relay(() => service.branch(repoRoot, branch)));
  registerMainHandler('git.worktree.add', (input) => relay(() => service.add(input)));
  registerMainHandler('git.worktree.remove', (input) => relay(() => service.remove(input)));
  registerMainHandler('git.worktree.deleteBranch', (input) => relay(() => service.deleteBranch(input)));
}

async function relay<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    const timeout = error instanceof GitTimeoutError ? error : error instanceof Error && error.cause instanceof GitTimeoutError ? error.cause : null; // `add` wraps git's own failure
    if (timeout !== null) throw new CommandFailure(ipcError('timeout', timeout.message));
    throw error;
  }
}
