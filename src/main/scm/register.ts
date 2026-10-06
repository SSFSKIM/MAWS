// Main's handlers for `scm.*` (E6 execution document, Interfaces "Main services"), kept apart from the service so
// `ScmService` stays free of Electron. Refusals are values the service answers; a git call killed at its deadline
// answers `timeout`, as C4's `git.*` do; anything else (an unknown session, a thrown allowlist violation) is `internal`.
// M1 binds the local commands; M2 adds the plans, runs, the latest run and PR state.
import type { AppSessionId } from '@shared/graph/ids';
import { ipcError } from '@shared/ipc/errors';
import { CommandFailure, registerMainHandler } from '../ipc/router';
import { GitTimeoutError } from '../git/runner';
import type { ScmService } from './service';

export function registerScmHandlers(service: ScmService): void {
  const session = (id: string) => id as AppSessionId;
  registerMainHandler('scm.status', ({ appSessionId }) => relay(() => service.status(session(appSessionId))));
  registerMainHandler('scm.stage', (input) => relay(() => service.stage({ ...input, appSessionId: session(input.appSessionId) })));
  registerMainHandler('scm.unstage', (input) => relay(() => service.unstage({ ...input, appSessionId: session(input.appSessionId) })));
  registerMainHandler('scm.discard', (input) => relay(() => service.discard({ ...input, appSessionId: session(input.appSessionId) })));
  registerMainHandler('scm.commit', (input) => relay(() => service.commit({ ...input, appSessionId: session(input.appSessionId) })));
}

async function relay<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof GitTimeoutError) throw new CommandFailure(ipcError('timeout', error.message));
    throw error;
  }
}
