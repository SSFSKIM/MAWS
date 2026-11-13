// Which machine an addressed row stands for, as the page marks it (P5 O6 M5; P5 Decision Log 28's T1, T2 and T5): its
// name, whether it is this machine (whose rows look as they did before machines), and whether it is offline, with when
// it entered that state. Read by the sidebar's session rows and hover cards and by the main area's session tabs.
// P5 O7 M2 (A2, P5 Decision Log 108): how this app reaches it (`carrier`) and the verdict holding its link down
// (`refusal`): a row's hover says "direct (tailnet)" or "via the hub" for an RL2 link, nothing for a socket or this
// machine; a machine that removed this device greys its rows with "This Mac is no longer allowed on <name>" in place of
// "machine offline". The chip itself shows no carrier.
// The UX wave, U9 (O-39; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, Interfaces §7): the link's phase,
// derived here from the roster entry, keeps "is the link up" and "what do we say" apart. `offline` is the display answer
// (the offline or removed phase), so every reader that greys or words by it reads a machine that connects, or reconnects
// within the minute an act is held, as not offline; `selectOffline` (stores/machines.ts) keeps "not up", which decides
// whether a command can go now.
import { useSyncExternalStore } from 'react';
import type { LinkPhase } from '@shared/ipc/remote-unavailable';
import { machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { phaseOf, showsOffline } from '@shared/machine/link-phase';
import { REMOTE_ACT_PENDING_MS } from '@shared/machine/remote-pending';
import { ipc } from '../ipc/client';
import { useMachines, type MachinesStore } from '../stores/machines';
import { machineName } from '../stores/org-projects';

export interface MachineMark {
  machine: MachineRef;
  local: boolean;
  name: string;
  offline: boolean; // the UX wave, U9: its phase is offline or removed (greyed, "offline" in the chip's place)
  phase: LinkPhase; // the UX wave, U9: O-39's phase
  since: string | null; // when its link entered its state, as the roster says; null before the roster names it
  carrier: 'socket' | 'direct' | 'relay' | null; // P5 O7 M2: how main reaches it while up; null for this machine or none said
  refusal: string | null; // P5 O7 M2: the permanent verdict holding an RL2 link down (`removed`: the machine removed this device)
}

/** O-39's words for a phase; null for up. */
export function phaseWords(phase: LinkPhase, machine: string): string | null {
  switch (phase) {
    case 'up':
      return null;
    case 'connecting':
      return `Connecting to ${machine}…`;
    case 'reconnecting':
      return `Reconnecting to ${machine}…`;
    case 'offline':
      return `${machine} is offline · this session reconnects when it’s back`;
    case 'removed':
      return removedWords(machine);
  }
}

// O-39's table is one rule for main and the window (the Decision Log's ruling of 2026-11-13): it lives under src/shared/
export { phaseOf };

/** The display answer for one machine at `now`: greyed, "offline" in its chip's place. */
export const selectShownOffline = (state: Pick<MachinesStore, 'machines'>, machine: MachineRef, now: number): boolean => showsOffline(phaseOf(state.machines.get(machine), now));

/** The phase now, for an act's handler (a render follows `useLinkPhase`). */
export const linkPhaseNow = (machine: MachineRef): LinkPhase => phaseOf(useMachines.getState().machines.get(machine), Date.now());

// The phase clock: the time phases are read at. Only a reconnecting machine's phase changes with time alone, at its
// `since` plus the minute, so the clock moves only then, by one timer armed for the earliest such moment while anything
// reads it (no tick), and armed again at each roster change. A link that goes down after the clock last moved has its
// `since` after it, so it reads reconnecting until its own timer moves the clock.
let clock = Date.now();
const readers = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let offRoster: (() => void) | null = null;

function arm(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  let next: number | null = null;
  for (const entry of useMachines.getState().machines.values()) {
    if (phaseOf(entry, clock) !== 'reconnecting') continue;
    const at = Date.parse(entry.since) + REMOTE_ACT_PENDING_MS;
    next = next === null ? at : Math.min(next, at);
  }
  if (next === null) return;
  timer = setTimeout(() => {
    timer = null;
    clock = Date.now();
    arm();
    readers.forEach((reader) => reader());
  }, Math.max(0, next - Date.now()));
}

function subscribe(reader: () => void): () => void {
  readers.add(reader);
  if (readers.size === 1) {
    clock = Date.now();
    offRoster = useMachines.subscribe(arm);
    arm();
  }
  return () => {
    readers.delete(reader);
    if (readers.size > 0) return;
    offRoster?.();
    offRoster = null;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
}

/** The phase clock, for a render that reads phases from the roster itself (`selectShownOffline`). */
export const usePhaseClock = (): number => useSyncExternalStore(subscribe, () => clock);

/** The machine's phase, followed in a render. */
export function useLinkPhase(machine: MachineRef): LinkPhase {
  const now = usePhaseClock();
  return useMachines((s) => phaseOf(s.machines.get(machine), now));
}

/** `unknownName`: the name to give a machine the roster doesn't hold (P5 O8 M7b: the channel's own for it), else its ref. */
export function useMachineMark(address: string, unknownName?: string): MachineMark {
  const machine = machineOf(address);
  const local = ipc.localMachine;
  const name = useMachines((s) => (unknownName === undefined || s.machines.has(machine) ? machineName(s.machines, machine, local) : unknownName));
  const phase = useLinkPhase(machine);
  const since = useMachines((s) => s.machines.get(machine)?.since ?? null);
  const carrier = useMachines((s) => s.machines.get(machine)?.carrier ?? null);
  const refusal = useMachines((s) => s.machines.get(machine)?.refusal ?? null);
  return { machine, local: machine === local, name, offline: showsOffline(phase), phase, since, carrier, refusal };
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
