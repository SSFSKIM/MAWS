// The engine host's half of the quit guard (E10 execution document, §Design 5; ruled by A-29): every quit that does not
// keep the sessions stops them through the supervisor's quit stop-all (`stopAllForQuit`, which sends `host.stopAll` to
// a detached supervisor, so it exits rather than idling out with its admission latched closed, and `engine.shutdown` to
// a utility host, as before); keep is offered only while the engine host runs detached, the default button by the
// setting `supervisor.keepRunningDefault`.
import type { Settings } from '@shared/ipc/schema';
import type { HostSupervisor } from '../hosts/supervisor';
import type { QuitGuardDeps } from './quit-guard';

// The grace each session's ladder gets at quit; the guard bounds the whole stop-all at SHUTDOWN_BOUND_MS.
export const QUIT_STOP_GRACE_MS = 5_000;

// Settings version 10 adds the `supervisor` section (Task 3.2); until then it is read where present, keep the default.
export function keepRunningDefaultOf(settings: Settings): boolean {
  return (settings as { supervisor?: { keepRunningDefault?: boolean } }).supervisor?.keepRunningDefault ?? true;
}

export function engineQuitDeps(
  hosts: Pick<HostSupervisor, 'stopAllForQuit'> & { facts(owner: 'engine-host'): { transport: 'utility' | 'detached' } },
  settings: () => Settings,
): Pick<QuitGuardDeps, 'shutdownEngine' | 'keepOffered' | 'keepDefault'> {
  return {
    shutdownEngine: () => hosts.stopAllForQuit(QUIT_STOP_GRACE_MS),
    keepOffered: () => hosts.facts('engine-host').transport === 'detached',
    keepDefault: () => keepRunningDefaultOf(settings()),
  };
}
