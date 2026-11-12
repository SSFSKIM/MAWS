// The machines as a registry location's words read them (`locations.ts`'s `LocationView`), from the roster and main's
// `seen` (the project registry, Interfaces §I and §J.3).
import { useMemo } from 'react';
import type { MachineState } from '@shared/ipc/schema/machines';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../ipc/client';
import { useMachines } from '../stores/machines';
import { machineName } from '../stores/org-projects';
import type { OrgProjects } from '../stores/registry';
import { useSessions } from '../stores/sessions';
import type { LocationView } from './locations';

/** A machine is up when it is this Mac or its link is; one the roster does not name is not reached, so not up. */
export function locationView(machines: ReadonlyMap<MachineRef, MachineState>, seen: OrgProjects['seen'], local: MachineRef): LocationView {
  return {
    machine: (ref) => {
      const state = machines.get(ref);
      return { name: machineName(machines, ref, local), local: ref === local, up: ref === local || state?.state === 'up', since: state?.since ?? null };
    },
    seen,
  };
}

export function useLocationView(): LocationView {
  const machines = useMachines((s) => s.machines);
  const seen = useSessions((s) => s.registry.seen);
  return useMemo(() => locationView(machines, seen, ipc.localMachine), [machines, seen]);
}
