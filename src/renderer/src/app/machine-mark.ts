// Which machine an addressed row stands for, as the page marks it (P5 O6 M5; P5 Decision Log 28's T1, T2 and T5): its
// name, whether it is this machine (whose rows look as they did before machines), and whether it is offline, with when
// it entered that state. Read by the sidebar's session rows and hover cards and by the main area's session tabs.
// P5 O7 M2 (A2, P5 Decision Log 108): how this app reaches it (`carrier`) and the verdict holding its link down
// (`refusal`): a row's hover says "direct (tailnet)" or "via the hub" for an RL2 link, nothing for a socket or this
// machine; a machine that removed this device greys its rows with "This Mac is no longer allowed on <name>" in place of
// "machine offline". The chip itself shows no carrier.
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
  carrier: 'socket' | 'direct' | 'relay' | null; // P5 O7 M2: how main reaches it while up; null for this machine or none said
  refusal: string | null; // P5 O7 M2: the permanent verdict holding an RL2 link down (`removed`: the machine removed this device)
}

export function useMachineMark(address: string): MachineMark {
  const machine = machineOf(address);
  const local = ipc.localMachine;
  const name = useMachines((s) => machineName(s.machines, machine, local));
  const offline = useMachines((s) => selectOffline(s, machine));
  const since = useMachines((s) => s.machines.get(machine)?.since ?? null);
  const carrier = useMachines((s) => s.machines.get(machine)?.carrier ?? null);
  const refusal = useMachines((s) => s.machines.get(machine)?.refusal ?? null);
  return { machine, local: machine === local, name, offline, since, carrier, refusal };
}

// T1 and T2: what a row says in its machine's place: "offline" for an offline machine's, `@<name>` for another
// machine's, nothing for this machine's while it is up.
export const machineChipText = (mark: MachineMark): string | null => (mark.offline ? 'offline' : mark.local ? null : `@${mark.name}`);
export const MACHINE_OFFLINE = 'machine offline'; // P5 §8's words for a greyed row

// P5 O7 M2: why a row is greyed, in its words: the machine removed this device, or it is offline.
export const removedWords = (name: string): string => `This Mac is no longer allowed on ${name}`;
export const greyWords = (mark: Pick<MachineMark, 'name' | 'refusal'>): string => (mark.refusal === 'removed' ? removedWords(mark.name) : MACHINE_OFFLINE);

// P5 O7 M2 (A2): the carrier an RL2 link is up over, as a row's hover says it; null for a socket, this machine, or a link
// not up.
export function carrierWords(mark: Pick<MachineMark, 'carrier' | 'offline'>): string | null {
  if (mark.offline) return null;
  return mark.carrier === 'direct' ? 'direct (tailnet)' : mark.carrier === 'relay' ? 'via the hub' : null;
}
