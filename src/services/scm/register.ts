// Main's handlers for `scm.*` (E6 execution document, Interfaces "Main services"), kept apart from the service so
// `ScmService` stays free of Electron. Refusals are values the service answers; a git call killed at its deadline
// answers `timeout`, as C4's `git.*` do; anything else (an unknown session, a thrown allowlist violation) is `internal`.
// The local commands, the plans and their runs, cancel, the latest run and PR state: the twelve commands of the namespace.
import type { AppSessionId } from '@shared/graph/ids';
import { HostCommandError } from '@shared/host/runtime';
import { ipcError } from '@shared/ipc/errors';
import type { ServicesBus } from '@shared/spine/bus';
import { GitTimeoutError } from '../git/runner';
import type { ScmService } from './service';

export function registerScmHandlers(service: ScmService, { register }: Pick<ServicesBus, 'register'>): void {
  const session = <T extends { appSessionId: string }>(input: T) => ({ ...input, appSessionId: input.appSessionId as AppSessionId });
  register('scm.status', ({ appSessionId }) => relay(() => service.status(appSessionId as AppSessionId)));
  register('scm.stage', (input) => relay(() => service.stage(session(input))));
  register('scm.unstage', (input) => relay(() => service.unstage(session(input))));
  register('scm.discard', (input) => relay(() => service.discard(session(input))));
  register('scm.commit', (input) => relay(() => service.commit(session(input))));
  register('scm.push.plan', (input) => relay(() => service.planPush(session(input))));
  register('scm.push', (input) => relay(() => service.run(session(input), 'push')));
  register('scm.pr.plan', (input) => relay(() => service.planPr(session(input))));
  register('scm.pr.create', (input) => relay(() => service.run(session(input), 'pr')));
  register('scm.remote.cancel', (input) => relay(() => service.cancel(session(input))));
  register('scm.remote.last', ({ appSessionId }) => relay(() => service.last(appSessionId as AppSessionId)));
  register('scm.pr.state', (input) => relay(() => service.prState(session(input))));
}

async function relay<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof GitTimeoutError) throw new HostCommandError(ipcError('timeout', error.message));
    throw error;
  }
}
