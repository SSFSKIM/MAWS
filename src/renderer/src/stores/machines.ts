// The machines this app reaches, as main's connection manager reports them (P5 O6 M4,
// docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "`useMachines`"; OX2). Fed by `connectShell`
// (`ipc/events.ts`) from `machines.list` and `machines.changed`, each the whole list, the local machine first.
//
// - A machine whose state is not `up` is offline. Its records, digests and attention stay as last known; its statuses
//   are forgotten, since a down link took its host along (E10's rule).
// - A machine is loaded once its first snapshot of this run is in. A new generation of its link keeps it loaded, since
//   its records are still shown.
// - The roster is the list itself: not yet read, answered (a `machines.list` answer or any `machines.changed`), or
//   failed. Only an answered roster says a machine is no longer configured; the layout keeps every other machine's tabs
//   until one has (`stores/layout.ts`'s hydration).
import { create } from 'zustand';
import type { MachineState } from '@shared/ipc/schema/machines';
import type { MachineRef } from '@shared/machine/ref';

export type Roster = 'unread' | 'answered' | 'failed';

export interface MachinesStore {
  roster: Roster;
  machines: Map<MachineRef, MachineState>;
  loaded: ReadonlySet<MachineRef>; // the machines whose first snapshot of this run is in
  applyRoster(machines: MachineState[]): void;
  rosterFailed(): void; // a failed `machines.list`; an answer already had stands
  setLoaded(machine: MachineRef): void;
}

export function createMachinesStore() {
  return create<MachinesStore>()((set, get) => ({
    roster: 'unread',
    machines: new Map(),
    loaded: new Set(),
    applyRoster(machines) {
      set({ roster: 'answered', machines: new Map(machines.map((m) => [m.ref, m])) });
    },
    rosterFailed() {
      if (get().roster === 'unread') set({ roster: 'failed' });
    },
    setLoaded(machine) {
      if (!get().loaded.has(machine)) set({ loaded: new Set([...get().loaded, machine]) });
    },
  }));
}

export const useMachines = createMachinesStore();

// Offline: a machine the roster lists whose link is not up. A machine the roster does not name is not said to be.
export function selectOffline(state: Pick<MachinesStore, 'machines'>, machine: MachineRef): boolean {
  const entry = state.machines.get(machine);
  return entry !== undefined && entry.state !== 'up';
}
