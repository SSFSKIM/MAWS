// Main's handlers for `scm.*` (E6 execution document, Interfaces "Main services"), kept apart from the service so
// `ScmService` stays free of Electron. Refusals are values the service answers; a git call killed at its deadline
// answers `timeout`, as C4's `git.*` do; anything else (an unknown session, a thrown allowlist violation) is `internal`.
// The local commands, the plans and their runs, cancel, the latest run and PR state: the twelve commands of the namespace.
import type { AppSessionId } from '@shared/graph/ids';
import { HostCommandError } from '@shared/host/runtime';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandName, CommandOutput } from '@shared/ipc/schema';
import { machineHome } from '@shared/machine/machine-home';
import type { ServicesBus } from '@shared/spine/bus';
import { GitTimeoutError } from '../git/runner';
import type { ScmService } from './service';

// 2026-11-06 (the home-root rule): a request from another machine (`HandlerContext.remote`) on a session whose checkout is
// the machine's home, or above it, runs nothing: that checkout is no root of the session for it.
export const SCM_HOME_REFUSAL = 'the session works in this machine’s home, which source control from another machine doesn’t reach';

export function registerScmHandlers(service: ScmService, { register }: Pick<ServicesBus, 'register'>, home: () => string = machineHome): void {
  const session = <T extends { appSessionId: string }>(input: T) => ({ ...input, appSessionId: input.appSessionId as AppSessionId });
  const scm = <N extends CommandName>(name: N, run: (input: CommandInput<N>) => Promise<CommandOutput<N>>) =>
    register(name, async (input, context) => {
      const { appSessionId } = input as unknown as { appSessionId: string };
      if (context.remote === true && (await service.coversHome(appSessionId as AppSessionId, home()))) throw new HostCommandError(ipcError('internal', SCM_HOME_REFUSAL));
      return relay(() => run(input));
    });
  scm('scm.status', ({ appSessionId }) => service.status(appSessionId as AppSessionId));
  scm('scm.stage', (input) => service.stage(session(input)));
  scm('scm.unstage', (input) => service.unstage(session(input)));
  scm('scm.discard', (input) => service.discard(session(input)));
  scm('scm.commit', (input) => service.commit(session(input)));
  scm('scm.push.plan', (input) => service.planPush(session(input)));
  scm('scm.push', (input) => service.run(session(input), 'push'));
  scm('scm.pr.plan', (input) => service.planPr(session(input)));
  scm('scm.pr.create', (input) => service.run(session(input), 'pr'));
  scm('scm.remote.cancel', (input) => service.cancel(session(input)));
  scm('scm.remote.last', ({ appSessionId }) => service.last(appSessionId as AppSessionId));
  scm('scm.pr.state', (input) => service.prState(session(input)));
}

async function relay<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof GitTimeoutError) throw new HostCommandError(ipcError('timeout', error.message));
    throw error;
  }
}
