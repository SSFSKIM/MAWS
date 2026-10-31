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
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { RemoteSession } from '@shared/ipc/schema/remote';
import { isAddress, machineOf } from '@shared/machine/address';
import { ipc } from '../ipc/client';
import { useSessions, type SessionsState } from '../stores/sessions';

export interface RemoteLaneBStore {
  states: ReadonlyMap<AppSessionId, RemoteSession>;
  sending: ReadonlyMap<AppSessionId, number>; // the sends on their way, per session
}

const empty = (): RemoteLaneBStore => ({ states: new Map(), sending: new Map() });

export const useRemoteLaneB = create<RemoteLaneBStore>()(empty);

export function resetRemoteLaneBStore(): void {
  useRemoteLaneB.setState(empty());
}

export function applyRemoteSession(state: RemoteSession): void {
  useRemoteLaneB.setState((s) => ({ states: new Map(s.states).set(state.address, state) }));
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

export const isRemoteLaneB = (appSessionId: AppSessionId): boolean =>
  remoteLaneBIn(useSessions.getState(), useRemoteLaneB.getState().states, appSessionId, ipc.localMachine);

export function useIsRemoteLaneB(appSessionId: AppSessionId): boolean {
  const states = useRemoteLaneB((s) => s.states);
  return useSessions((s) => remoteLaneBIn(s, states, appSessionId, ipc.localMachine));
}
