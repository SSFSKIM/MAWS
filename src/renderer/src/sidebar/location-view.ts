// The machines as a registry location's words read them (`locations.ts`'s `LocationView`), from the roster and main's
// `seen` (the project registry, Interfaces §I and §J.3).
import { useMemo } from 'react';
import type { MachineState } from '@shared/ipc/schema/machines';
import type { MachineRef } from '@shared/machine/ref';
import { phaseOf, usePhaseClock } from '../app/machine-mark'; // the UX wave, U9 (O-39)
import { ipc } from '../ipc/client';
import { useMachines } from '../stores/machines';
import { machineName } from '../stores/org-projects';
import type { OrgProjects } from '../stores/registry';
import { useSessions } from '../stores/sessions';
import type { LocationView } from './locations';

/**
 * A machine is up when it is this Mac or its link is; one the roster does not name is not reached, so not up. The UX wave,
 * U9 (O-39): its words say offline by its link's phase at `now`, so not while it connects or reconnects within the
 * minute; one the roster does not name is offline.
 */
export function locationView(machines: ReadonlyMap<MachineRef, MachineState>, seen: OrgProjects['seen'], local: MachineRef, now = Date.now()): LocationView {
  return {
    machine: (ref) => {
      const state = machines.get(ref);
      const phase = phaseOf(state, now);
      const offline = ref !== local && (state === undefined || phase === 'offline' || phase === 'removed');
      return { name: machineName(machines, ref, local), local: ref === local, up: ref === local || state?.state === 'up', since: state?.since ?? null, offline };
    },
    seen,
  };
}

export function useLocationView(): LocationView {
  const machines = useMachines((s) => s.machines);
  const seen = useSessions((s) => s.registry.seen);
  const now = usePhaseClock(); // the UX wave, U9: a reconnecting machine turns offline at the clock's turn
  return useMemo(() => locationView(machines, seen, ipc.localMachine, now), [machines, seen, now]);
}
