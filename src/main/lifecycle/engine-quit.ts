// The engine host's half of the quit guard (E10 execution document, §Design 5; ruled by A-29): every quit that does not
// keep the sessions stops them through the supervisor's quit stop-all (`stopAllForQuit`, which sends `host.stopAll` to
// a detached supervisor, so it exits rather than idling out with its admission latched closed, and `engine.shutdown` to
// a utility host, as before); keep is offered only while the engine host runs detached, the default button by the
// setting `supervisor.keepRunningDefault`. P5 O2 M7: on the daemon shape the terminals outlive the app too (`terminalsOutlive`).
// P5 O3-D (Q1, D12): and so do the sessions, under `mawsd` (`sessionsOutlive`): keep is not offered there, nothing being
// stopped at quit.
import type { Settings } from '@shared/ipc/schema';
import { STOP_ALL_GRACE_MS, type HostSupervisor } from '../hosts/supervisor';
import type { QuitGuardDeps } from './quit-guard';

export function engineQuitDeps(
  hosts: Pick<HostSupervisor, 'stopAllForQuit'> & { facts(owner: 'engine-host'): { transport: 'utility' | 'detached' } },
  settings: () => Settings,
  daemonShape: () => boolean = () => false, // P5 O2 M7: the pty host (P5 O3-D: and the sessions) run under the machine daemon this launch
): Pick<QuitGuardDeps, 'shutdownEngine' | 'keepOffered' | 'keepDefault' | 'terminalsOutlive' | 'sessionsOutlive'> {
  return {
    terminalsOutlive: daemonShape,
    sessionsOutlive: daemonShape,
    shutdownEngine: () => hosts.stopAllForQuit(STOP_ALL_GRACE_MS) /* bounded as a whole by the guard's SHUTDOWN_BOUND_MS */,
    keepOffered: () => !daemonShape() && hosts.facts('engine-host').transport === 'detached',
    keepDefault: () => settings().supervisor.keepRunningDefault, // read at each question
  };
}
