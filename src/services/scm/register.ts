// Main's handlers for `scm.*` (E6 execution document, Interfaces "Main services"), kept apart from the service so
// `ScmService` stays free of Electron. Refusals are values the service answers; a git call killed at its deadline
// answers `timeout`, as C4's `git.*` do; anything else (an unknown session, a thrown allowlist violation) is `internal`.
// The local commands, the plans and their runs, cancel, the latest run and PR state: the twelve commands of the namespace.
import type { AppSessionId } from '@shared/graph/ids';
import { HostCommandError } from '@shared/host/runtime';
import type { HandlerContext } from '@shared/ipc/client';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandName, CommandOutput } from '@shared/ipc/schema';
import { machineHomes } from '@shared/machine/machine-home';
import type { ServicesBus } from '@shared/spine/bus';
import { GitTimeoutError } from '../git/runner';
import type { FolderGuard, ScmService } from './service';

// 2026-11-06 (the home-root rule): a request from another machine (`HandlerContext.remote`) on a session whose checkout is
// a home of the machine or above one, by itself or by its repository (a home kept in git), runs nothing: that checkout is
// no root of the session for it. UX wave U8c-2 (M3 decision 8): the check is the request's guard, judged on the folder the
// service captured from its one read of the record, which the command then uses, so a working folder that changes at a
// `cd` cannot fall between the two. A same-user process swapping the checkout for a link between the check and the
// command is outside what the rule holds off.
export const SCM_HOME_REFUSAL = 'the session works in this machine’s home, which source control from another machine doesn’t reach';

export function registerScmHandlers(service: ScmService, { register }: Pick<ServicesBus, 'register'>, homes: () => readonly string[] = machineHomes): void {
  const session = <T extends { appSessionId: string }>(input: T) => ({ ...input, appSessionId: input.appSessionId as AppSessionId });
  const homeGuard: FolderGuard = async (folder) => {
    if (await service.coversHomeAt(folder, homes())) throw new HostCommandError(ipcError('internal', SCM_HOME_REFUSAL));
  };
  const scm = <N extends CommandName>(name: N, run: (input: CommandInput<N>, guard: FolderGuard | undefined) => Promise<CommandOutput<N>>) =>
    register(name, (input, context?: HandlerContext) => relay(() => run(input, context?.remote === true ? homeGuard : undefined)));
  scm('scm.status', ({ appSessionId }, guard) => service.status(appSessionId as AppSessionId, {}, guard));
  scm('scm.stage', (input, guard) => service.stage(session(input), guard));
  scm('scm.unstage', (input, guard) => service.unstage(session(input), guard));
  scm('scm.discard', (input, guard) => service.discard(session(input), guard));
  scm('scm.commit', (input, guard) => service.commit(session(input), guard));
  scm('scm.push.plan', (input, guard) => service.planPush(session(input), guard));
  scm('scm.push', (input, guard) => service.run(session(input), 'push', guard));
  scm('scm.pr.plan', (input, guard) => service.planPr(session(input), guard));
  scm('scm.pr.create', (input, guard) => service.run(session(input), 'pr', guard));
  scm('scm.remote.cancel', (input, guard) => service.cancel(session(input), guard));
  scm('scm.remote.last', ({ appSessionId }, guard) => service.last(appSessionId as AppSessionId, guard));
  scm('scm.pr.state', (input, guard) => service.prState(session(input), guard));
}

async function relay<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof GitTimeoutError) throw new HostCommandError(ipcError('timeout', error.message));
    throw error;
  }
}
