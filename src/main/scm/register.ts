// Main's handlers for `scm.*` (E6 execution document, Interfaces "Main services"), kept apart from the service so
// `ScmService` stays free of Electron. Refusals are values the service answers; a git call killed at its deadline
// answers `timeout`, as C4's `git.*` do; anything else (an unknown session, a thrown allowlist violation) is `internal`.
// The local commands, the plans and their runs, cancel, the latest run and PR state: the twelve commands of the namespace.
import type { AppSessionId } from '@shared/graph/ids';
import { ipcError } from '@shared/ipc/errors';
import { CommandFailure, registerMainHandler } from '../ipc/router';
import { GitTimeoutError } from '../git/runner';
import type { ScmService } from './service';

export function registerScmHandlers(service: ScmService): void {
  const session = <T extends { appSessionId: string }>(input: T) => ({ ...input, appSessionId: input.appSessionId as AppSessionId });
  registerMainHandler('scm.status', ({ appSessionId }) => relay(() => service.status(appSessionId as AppSessionId)));
  registerMainHandler('scm.stage', (input) => relay(() => service.stage(session(input))));
  registerMainHandler('scm.unstage', (input) => relay(() => service.unstage(session(input))));
  registerMainHandler('scm.discard', (input) => relay(() => service.discard(session(input))));
  registerMainHandler('scm.commit', (input) => relay(() => service.commit(session(input))));
  registerMainHandler('scm.push.plan', (input) => relay(() => service.planPush(session(input))));
  registerMainHandler('scm.push', (input) => relay(() => service.run(session(input), 'push')));
  registerMainHandler('scm.pr.plan', (input) => relay(() => service.planPr(session(input))));
  registerMainHandler('scm.pr.create', (input) => relay(() => service.run(session(input), 'pr')));
  registerMainHandler('scm.remote.cancel', (input) => relay(() => service.cancel(session(input))));
  registerMainHandler('scm.remote.last', ({ appSessionId }) => relay(() => service.last(appSessionId as AppSessionId)));
  registerMainHandler('scm.pr.state', (input) => relay(() => service.prState(session(input))));
}

async function relay<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof GitTimeoutError) throw new CommandFailure(ipcError('timeout', error.message));
    throw error;
  }
}
