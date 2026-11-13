// Another machine's lane B session in this window (P5 O7 M2, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "The
// record", "The capability list"; Interfaces §K). A lane B session runs under its own machine's daemon; this app reaches it
// over that machine's RL2 link, through main's remote lane B adapter (src/main/lane-b/), which turns the session's stream
// into the events a local session's pane already reads (its record, statuses, queue, catalogue, attention and event
// batches) and says the rest as `remote.session`: the link as this device sees it, the stream's state, every control with
// the remote overlay, and why none acts when one reason closes them all. This store keeps the latest `remote.session` per
// address (fed by `connectShell`, `ipc/events.ts`), and the sends on their way to each session (the composer's "Sending to
// <machine>…").
//
// A session is lane B on another machine when main says a `remote.session` for it, or when its machine is one the org
// rows cover (the RL2 roster: a socket-linked profile's sessions take the manager's path, as local ones do) and the rows
// don't list it as lane A (O9's). A session this app resumed or spawned there may be listed later, so not being listed
// doesn't make it lane A.
//
// The UX wave, U9 (M5, "The settled word"; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, Interfaces
// §9): main's `remote.settled` per machine, the generation it last settled. A history read of a session there goes once
// the roster's current generation has settled, or SETTLE_BACKSTOP_MS after the roster said up, whichever is first, so
// it no longer runs beside the live sessions' resumes; a read made after either, or while the roster does not say the
// machine is up, goes at once (`historyReadsNow`, `whenHistoryReads`).
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { EventPayload } from '@shared/ipc/schema';
import type { RemoteLinkState, RemoteSession } from '@shared/ipc/schema/remote';
import { isAddress, machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../ipc/client';
import { useMachines } from '../stores/machines';
import { machineName } from '../stores/org-projects';
import { useSessions, type SessionsState } from '../stores/sessions';

export interface RemoteLaneBStore {
  states: ReadonlyMap<AppSessionId, RemoteSession>;
  sending: ReadonlyMap<AppSessionId, number>; // the sends on their way, per session
  // P5 O7 M5c: each machine's link as the latest `remote.session` of any of its sessions said it (one link per machine, so
  // its member's rights are the machine's, whichever session carried them); absent: none heard yet
  links: ReadonlyMap<MachineRef, RemoteLinkState>;
  // the UX wave, U9 (M5): each machine's generation main last said settled; said again by its replay to a page
  settled: ReadonlyMap<MachineRef, number>;
}

const empty = (): RemoteLaneBStore => ({ states: new Map(), sending: new Map(), links: new Map(), settled: new Map() });

export const useRemoteLaneB = create<RemoteLaneBStore>()(empty);

export function resetRemoteLaneBStore(): void {
  useRemoteLaneB.setState(empty());
}

export function applyRemoteSession(state: RemoteSession): void {
  useRemoteLaneB.setState((s) => ({ states: new Map(s.states).set(state.address, state), ...(isAddress(state.address) && { links: new Map(s.links).set(machineOf(state.address), state.link) }) }));
}

/** The UX wave, U9 (M5): main's settled word for a machine's generation. */
export function applyRemoteSettled({ machine, generation }: EventPayload<'remote.settled'>): void {
  if (useRemoteLaneB.getState().settled.get(machine) === generation) return;
  useRemoteLaneB.setState((s) => ({ settled: new Map(s.settled).set(machine, generation) }));
}

/** How long after the roster said a machine is up a history read there goes without main's settled word. */
export const SETTLE_BACKSTOP_MS = 2000;

/** The moment a history read of the machine's session may go: null for now, else the backstop's (epoch ms). */
function historyReadsAt(machine: MachineRef): number | null {
  if (machine === ipc.localMachine) return null;
  const entry = useMachines.getState().machines.get(machine);
  if (entry?.state !== 'up') return null; // nothing settles while it is not up: the read goes as before
  if (useRemoteLaneB.getState().settled.get(machine) === entry.generation) return null;
  const backstop = Date.parse(entry.since) + SETTLE_BACKSTOP_MS;
  return Date.now() >= backstop ? null : backstop;
}

/** Whether a history read of a session on `machine` goes now: settled, past the backstop, or not up. */
export const historyReadsNow = (machine: MachineRef): boolean => historyReadsAt(machine) === null;

/** Settles once a history read of a session on `machine` may go: at the settled word, the backstop or a roster change. */
export function whenHistoryReads(machine: MachineRef): Promise<void> {
  if (historyReadsNow(machine)) return Promise.resolve();
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const offs: Array<() => void> = [];
    const check = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      const at = historyReadsAt(machine);
      if (at === null) {
        offs.forEach((off) => off());
        return resolve();
      }
      timer = setTimeout(check, at - Date.now());
    };
    offs.push(useRemoteLaneB.subscribe(check), useMachines.subscribe(check));
    check();
  });
}

export const remoteLaneBStateOf = (appSessionId: AppSessionId): RemoteSession | null => useRemoteLaneB.getState().states.get(appSessionId) ?? null;
export const useRemoteLaneBState = (appSessionId: AppSessionId): RemoteSession | null => useRemoteLaneB((s) => s.states.get(appSessionId) ?? null);

// The overlay rule (M2): a link down closes nothing, its acts held for a minute (A4), so the status this page last heard
// for a session main still holds stays through the link's drop, for Stop and Esc to reach its turn; main says when it
// forgot the status itself: the stream idle (released) or ended.
export const holdsRemoteStatus = (state: RemoteSession): boolean => state.stream !== 'idle' && state.stream !== 'ended';
export const keepsRemoteStatus = (appSessionId: AppSessionId): boolean => {
  const state = remoteLaneBStateOf(appSessionId);
  return state !== null && holdsRemoteStatus(state);
};

/** A send on its way to the session; the returned function ends it (once). */
export function beginRemoteSend(appSessionId: AppSessionId): () => void {
  const change = (by: number) =>
    useRemoteLaneB.setState((s) => {
      const sending = new Map(s.sending);
      const count = (sending.get(appSessionId) ?? 0) + by;
      if (count > 0) sending.set(appSessionId, count);
      else sending.delete(appSessionId);
      return { sending };
    });
  change(1);
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    change(-1);
  };
}

export const useRemoteSending = (appSessionId: AppSessionId): boolean => useRemoteLaneB((s) => s.sending.has(appSessionId));

type Rows = Pick<SessionsState, 'listed' | 'listedMachines'>;

function remoteLaneBIn(rows: Rows, states: RemoteLaneBStore['states'], appSessionId: AppSessionId, local: string): boolean {
  if (!isAddress(appSessionId)) return false; // an id no machine is named in (a fixture's, a harness's) is no other machine's
  const machine = machineOf(appSessionId);
  if (machine === local) return false;
  if (states.has(appSessionId)) return true;
  return rows.listedMachines.has(machine) && rows.listed.get(appSessionId)?.lane !== 'A';
}

// A session on another machine this app reaches over RL2, whichever lane (P5 O7 M8): lane B's, or a lane A session of a
// machine the org rows cover, whose adapter takes only `laneA.*` (main/lane-a/remote.ts `routeLaneA`), so every other
// command reaches the machine as a lane B session's does. A socket-linked machine's sessions take the manager's path.
function overRl2In(rows: Rows, states: RemoteLaneBStore['states'], appSessionId: AppSessionId, local: string): boolean {
  if (!isAddress(appSessionId) || machineOf(appSessionId) === local) return false;
  return states.has(appSessionId) || rows.listedMachines.has(machineOf(appSessionId));
}

export const isOverRl2 = (appSessionId: AppSessionId): boolean => overRl2In(useSessions.getState(), useRemoteLaneB.getState().states, appSessionId, ipc.localMachine);

export function useIsOverRl2(appSessionId: AppSessionId): boolean {
  const states = useRemoteLaneB((s) => s.states);
  return useSessions((s) => overRl2In(s, states, appSessionId, ipc.localMachine));
}

export const isRemoteLaneB = (appSessionId: AppSessionId): boolean =>
  remoteLaneBIn(useSessions.getState(), useRemoteLaneB.getState().states, appSessionId, ipc.localMachine);

export function useIsRemoteLaneB(appSessionId: AppSessionId): boolean {
  const states = useRemoteLaneB((s) => s.states);
  return useSessions((s) => remoteLaneBIn(s, states, appSessionId, ipc.localMachine));
}

// P5 O7 M4 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M4's At its end): what acts on this Mac's own
// desktop for a session's file (Reveal in Finder, Open externally) is not offered for a lane B session on another
// machine, where it would act on that machine's desktop (M5 routes it if a reader appears). The control stays, greyed,
// saying where the file is: the machine's name, or null where the control acts.
export const ELSEWHERE_WORDS = {
  on: (machine: string) => `on ${machine}`,
  title: (machine: string) => `This file is on ${machine}, not on this Mac`,
} as const;

export function useElsewhereMachine(appSessionId: AppSessionId | null): string | null {
  const states = useRemoteLaneB((s) => s.states);
  const remote = useSessions((s) => appSessionId !== null && remoteLaneBIn(s, states, appSessionId, ipc.localMachine));
  const name = useMachines((s) => (appSessionId === null || !isAddress(appSessionId) ? null : machineName(s.machines, machineOf(appSessionId), ipc.localMachine)));
  return remote ? name : null;
}
