// Main's handlers for `git.worktree.*` (C10 execution document, Interfaces "Worktrees"), kept apart from the service so
// `WorktreeService` stays free of Electron for whoever constructs it (M3's session service, its tests). A git call
// killed at its 10 s timeout answers `timeout`, as C4's `git.*` do; a refusal decided before acting is `internal` with
// its named message (`worktree path exists`, `base not found: …`).
import { HostCommandError } from '@shared/host/runtime';
import { ipcError } from '@shared/ipc/errors';
import type { ServicesBus } from '@shared/spine/bus';
import { GitTimeoutError } from './runner';
import type { WorktreeService } from './worktrees';

export function registerWorktreeHandlers(service: WorktreeService, { register }: Pick<ServicesBus, 'register'>): void {
  register('git.worktree.list', ({ repoRoot }) => relay(() => service.list(repoRoot)));
  register('git.worktree.status', ({ repoRoot, path }) => relay(() => service.status(repoRoot, path)));
  register('git.worktree.branch', ({ repoRoot, branch }) => relay(() => service.branch(repoRoot, branch)));
  register('git.worktree.add', (input) => relay(() => service.add(input)));
  register('git.worktree.remove', (input) => relay(() => service.remove(input)));
  register('git.worktree.deleteBranch', (input) => relay(() => service.deleteBranch(input)));
}

async function relay<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    const timeout = error instanceof GitTimeoutError ? error : error instanceof Error && error.cause instanceof GitTimeoutError ? error.cause : null; // `add` wraps git's own failure
    if (timeout !== null) throw new HostCommandError(ipcError('timeout', timeout.message));
    throw error;
  }
}
