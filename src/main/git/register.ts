// Main's handlers for `git.*` (C4 execution document, M6). A git call killed at its 10 s timeout answers `timeout`;
// every other failure is `internal` with the service's message (`not a git repository`, `invalid base: …`, git's own
// first line).
import { ipcError } from '@shared/ipc/errors';
import { CommandFailure, registerMainHandler } from '../ipc/router';
import { GitTimeoutError } from './runner';
import type { GitService } from './service';

export function registerGitHandlers(git: GitService): void {
  registerMainHandler('git.status', ({ directory }) => relay(() => git.status(directory)));
  registerMainHandler('git.branches', ({ directory }) => relay(() => git.branches(directory)));
  registerMainHandler('git.diff', (input) => relay(() => git.diff(input)));
  registerMainHandler('git.log', (input) => relay(() => git.log(input)));
  registerMainHandler('git.watch', ({ directory }) => relay(() => git.watch(directory)));
  registerMainHandler('git.unwatch', ({ directory }) => git.unwatch(directory));
}

async function relay<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof GitTimeoutError) throw new CommandFailure(ipcError('timeout', error.message));
    throw error;
  }
}
