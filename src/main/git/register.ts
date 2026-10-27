// Main's handlers for `git.*` (C4 execution document, M6). A git call killed at its 10 s timeout answers `timeout`;
// every other failure is `internal` with the service's message (`not a git repository`, `invalid base: …`, git's own
// first line). Watches are counted per requesting client, and a client that ends (its page closes, crashes or reloads)
// releases whatever it still holds: its page can no longer unwatch, and a reloaded page watches afresh.
import type { ClientId, ClientRef } from '@shared/ipc/client';
import { ipcError } from '@shared/ipc/errors';
import { CommandFailure, registerMainHandler } from '../ipc/router';
import { GitTimeoutError } from './runner';
import type { GitService } from './service';

export function registerGitHandlers(git: GitService): void {
  const followed = new Set<ClientId>();
  const follow = (client: ClientRef) => {
    if (followed.has(client.id)) return;
    followed.add(client.id);
    client.onGone(() => {
      followed.delete(client.id);
      git.release(client.id);
    });
  };
  registerMainHandler('git.status', ({ directory }) => relay(() => git.status(directory)));
  registerMainHandler('git.branches', ({ directory }) => relay(() => git.branches(directory)));
  registerMainHandler('git.diff', (input) => relay(() => git.diff(input)));
  registerMainHandler('git.log', (input) => relay(() => git.log(input)));
  registerMainHandler('git.watch', ({ directory }, { client }) => relay(() => {
    const watching = git.watch(directory, client.id); // takes the owner's release fence at once, so a release from here on drops it
    follow(client);
    return watching;
  }));
  registerMainHandler('git.unwatch', ({ directory }, { client }) => git.unwatch(directory, client.id));
}

async function relay<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof GitTimeoutError) throw new CommandFailure(ipcError('timeout', error.message));
    throw error;
  }
}
