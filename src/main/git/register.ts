// Main's handlers for `git.*` (C4 execution document, M6). A git call killed at its 10 s timeout answers `timeout`;
// every other failure is `internal` with the service's message (`not a git repository`, `invalid base: …`, git's own
// first line). Watches are counted per requesting window, and a window that closes or navigates (a reload included)
// releases whatever it still holds: its page can no longer unwatch, and a reloaded page watches afresh.
import type { WebContents } from 'electron';
import { ipcError } from '@shared/ipc/errors';
import { CommandFailure, registerMainHandler } from '../ipc/router';
import { GitTimeoutError } from './runner';
import type { GitService } from './service';

export function registerGitHandlers(git: GitService): void {
  const followed = new WeakSet<WebContents>();
  const owner = (sender: WebContents) => {
    if (!followed.has(sender)) {
      followed.add(sender);
      const release = () => git.release(sender.id);
      sender.once('destroyed', release);
      sender.on('did-navigate', release);
    }
    return sender.id;
  };
  registerMainHandler('git.status', ({ directory }) => relay(() => git.status(directory)));
  registerMainHandler('git.branches', ({ directory }) => relay(() => git.branches(directory)));
  registerMainHandler('git.diff', (input) => relay(() => git.diff(input)));
  registerMainHandler('git.log', (input) => relay(() => git.log(input)));
  registerMainHandler('git.watch', ({ directory }, { sender }) => relay(() => git.watch(directory, owner(sender))));
  registerMainHandler('git.unwatch', ({ directory }, { sender }) => git.unwatch(directory, sender.id));
}

async function relay<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof GitTimeoutError) throw new CommandFailure(ipcError('timeout', error.message));
    throw error;
  }
}
