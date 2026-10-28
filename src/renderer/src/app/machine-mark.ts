// Which machine an addressed row stands for, as the page marks it (P5 O6 M5; P5 Decision Log 28's T1, T2 and T5): its
// name, whether it is this machine (whose rows look as they did before machines), and whether it is offline, with when
// it entered that state. Read by the sidebar's session rows and hover cards and by the main area's session tabs.
import { machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../ipc/client';
import { selectOffline, useMachines } from '../stores/machines';
import { machineName } from '../stores/org-projects';

export interface MachineMark {
  machine: MachineRef;
  local: boolean;
  name: string;
  offline: boolean;
  since: string | null; // when its link entered its state, as the roster says; null before the roster names it
}

export function useMachineMark(address: string): MachineMark {
  const machine = machineOf(address);
  const local = ipc.localMachine;
  const name = useMachines((s) => machineName(s.machines, machine, local));
  const offline = useMachines((s) => selectOffline(s, machine));
  const since = useMachines((s) => s.machines.get(machine)?.since ?? null);
  return { machine, local: machine === local, name, offline, since };
}

// T1 and T2: what a row says in its machine's place: "offline" for an offline machine's, `@<name>` for another
// machine's, nothing for this machine's while it is up.
export const machineChipText = (mark: MachineMark): string | null => (mark.offline ? 'offline' : mark.local ? null : `@${mark.name}`);
export const MACHINE_OFFLINE = 'machine offline'; // P5 §8's words for a greyed row
