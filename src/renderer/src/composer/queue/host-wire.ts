// UX wave U4a (docs/doperpowers/plans/2026-11-12-ux-wave-U4a-composer.md, decision 30; Interfaces D): Send now on a
// next-step row is offered only while the engine host that serves this Mac's sessions has this build's wire, which the
// window reads from the latest `host.status` it holds. Read where the row is drawn and, again, where the command leaves
// the window (the lane B port's `sendNow`).
import { hostHasThisWire } from '@shared/sessions/host-wire';
import { useHosts } from '../../stores/hosts';

export const HOST_UPDATING = 'The engine host is finishing an update; this works once it has handed the session over';

/** Whether the serving engine host takes this build's commands, followed in a render. */
export function useHostHasThisWire(): boolean {
  return useHosts((s) => hostHasThisWire(s.supervisor));
}
