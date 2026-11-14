// UX wave U4a (docs/doperpowers/plans/2026-11-12-ux-wave-U4a-composer.md, decision 30; Interfaces D): after an app update the
// earlier build's engine host serves its live sessions until they are idle or handed over, and it does not know
// `session.steer.sendNow`. The window already holds what says which host serves: the latest `host.status`, with the engine
// host's wire fingerprint (`supervisor.wire`, taken over every command it owns) beside this build's (`appWire`).
import type { HostStatus } from '../ipc/schema/host';
import { hostAppliesPlanMode } from './plan-next-mode';

/** Whether the engine host that serves this Mac's sessions has this build's wire, and so every host command this build sends. */
export function hostHasThisWire(status: Pick<HostStatus, 'state' | 'supervisor' | 'appWire'> | null): boolean {
  return hostAppliesPlanMode(status); // U1a's predicate is this one fact under its own name (the Decision Log, 2026-11-13)
}
