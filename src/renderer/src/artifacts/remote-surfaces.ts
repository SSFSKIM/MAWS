// What O4's surfaces of another machine's artifact need, and why one is greyed (P5 O7 M5c, docs/doperpowers/plans/
// 2026-10-28-p5-o7-remote-lane-b.md, acceptance 6 "Capabilities light up", M5's "The capability lists" and "O4's surfaces:
// the grade"). The Connectors sheet's parts and Send to are drawn from RL7's two lists, never from the lane or the machine:
//
// - the device's rights there (`link.rights`, the latest `remote.session` of any of the machine's sessions,
//   ../lane-b/remote-session.ts): a grant and a server row's actions are `machine-admin`. Rights read before the first
//   `caps` (no member yet), or of a machine no session of which was heard, are not known, and grey nothing: the machine
//   decides at the request, and its refusal is said in words (`remoteRefusalWords`).
// - the machine's offer: a command it refused `not-offered` (the client's refusal hook, ../ipc/client.ts) is not offered
//   there, until its artifacts feed opens again (`artifacts.resync`, said at each opening, a new channel's included).
//
// This Mac's artifacts are never greyed here. The words the spec names are its own: "Connectors on <machine> need its app"
// for a connector surface the machine doesn't offer, and "Connect Drive on <machine>" (`delivery.connect` is not offered
// on another machine: its sign-in is that machine's).
import { create } from 'zustand';
import type { CommandName, IpcError, MawsBridge } from '@shared/ipc/schema';
import type { MACHINE_RIGHTS } from '@shared/ipc/schema/remote';
import type { MachineRef } from '@shared/machine/ref';
import { ipc, onCommandRefused } from '../ipc/client';
import { useRemoteLaneB } from '../lane-b/remote-session';
import { useMachines } from '../stores/machines';
import { machineName } from '../stores/org-projects';
import { artifactMachineOf } from './machines';
import { useArtifactMachine } from './use-artifact-machine';

type MachineRight = (typeof MACHINE_RIGHTS)[number];

export const REMOTE_SURFACE_WORDS = {
  connectorsNeedApp: (machine: string) => `Connectors on ${machine} need its app`,
  notOffered: (machine: string) => `${machine} doesn’t offer this`,
  needsAdmin: (machine: string) => `Only an admin of ${machine} can change its connectors`,
  noRight: (machine: string) => `You don’t have the right to do this on ${machine}`,
  connectOn: (service: 'Notion' | 'Drive', machine: string) => `Connect ${service} on ${machine}`,
  busyOn: (machine: string) => `Already in progress on ${machine}`,
  cancelled: 'Not done: the confirmation was cancelled',
  offline: (machine: string) => `${machine} is offline`,
} as const;

// ---- the machine's offer ----------------------------------------------------------------------------------------------

const offerKey = (machine: MachineRef, name: CommandName) => `${machine}\u0000${name}`;
const useNotOffered = create<{ refused: ReadonlySet<string> }>()(() => ({ refused: new Set() }));

const refusalOf = (error: Pick<IpcError, 'issues'>): unknown => (error.issues as { refusal?: unknown } | undefined)?.refusal;

/** A refusal `machine` gave `name`: one saying the machine serves no such command marks it not offered there. */
export function heardRefusal(name: CommandName, error: Pick<IpcError, 'issues'>, machine: MachineRef, local: MachineRef): void {
  if (machine === local || refusalOf(error) !== 'not-offered') return;
  const key = offerKey(machine, name);
  useNotOffered.setState((s) => (s.refused.has(key) ? s : { refused: new Set(s.refused).add(key) }));
}

/** The machine's feed opened again: what it offers is asked afresh. */
export function forgetOffers(machine: MachineRef): void {
  const prefix = `${machine}\u0000`;
  useNotOffered.setState((s) => {
    const kept = [...s.refused].filter((key) => !key.startsWith(prefix));
    return kept.length === s.refused.size ? s : { refused: new Set(kept) };
  });
}

/** App-wide: every machine's `not-offered` heard, forgotten at each opening of its feed. */
export function connectRemoteSurfaces(client: Pick<MawsBridge, 'on' | 'localMachine'> = ipc, refusals = onCommandRefused): () => void {
  const offRefused = refusals((name, error, machine) => heardRefusal(name, error, machine, client.localMachine));
  const offResync = client.on('artifacts.resync', (_resync, from) => forgetOffers(from.machine));
  return () => {
    offRefused();
    offResync();
  };
}

// Tests.
export function resetRemoteSurfaces(): void {
  useNotOffered.setState({ refused: new Set() });
}

// ---- the gates --------------------------------------------------------------------------------------------------------

/** What a surface needs on the artifact's machine: its commands offered, and a right of the device's when it acts on the
 * machine's credentials; the words for each lack. */
export interface RemoteNeeds {
  commands: readonly CommandName[];
  notOffered: (machine: string) => string;
  right?: { right: MachineRight; lacking: (machine: string) => string };
}

export const LEASE_NEEDS: RemoteNeeds = { commands: ['connectors.open'], notOffered: REMOTE_SURFACE_WORDS.connectorsNeedApp };
export const GRANT_NEEDS: RemoteNeeds = {
  commands: ['artifacts.grantConnectorTool', 'artifacts.revokeConnectorTool'],
  notOffered: REMOTE_SURFACE_WORDS.connectorsNeedApp,
  right: { right: 'machine-admin', lacking: REMOTE_SURFACE_WORDS.needsAdmin },
};
export const SERVER_NEEDS: RemoteNeeds = {
  commands: ['connectors.servers', 'connectors.connect', 'connectors.reconnect', 'connectors.disconnect'],
  notOffered: REMOTE_SURFACE_WORDS.connectorsNeedApp,
  right: { right: 'machine-admin', lacking: REMOTE_SURFACE_WORDS.needsAdmin },
};
export const SEND_NEEDS: RemoteNeeds = { commands: ['delivery.status', 'delivery.send'], notOffered: REMOTE_SURFACE_WORDS.notOffered };

export interface RemoteFacts {
  machine: MachineRef | null; // null: this Mac's artifact
  name: string; // the machine's, for the words
  rights: readonly string[] | null; // null: not known
  notOffered: ReadonlySet<string>;
}

/** Why the surface is greyed on the artifact's machine; null when it isn't (this Mac's, or both lists hold what it needs). */
export function remoteGreyed(needs: RemoteNeeds, { machine, name, rights, notOffered }: RemoteFacts): string | null {
  if (machine === null) return null;
  if (needs.commands.some((command) => notOffered.has(offerKey(machine, command)))) return needs.notOffered(name);
  if (needs.right && rights !== null && !rights.includes(needs.right.right)) return needs.right.lacking(name);
  return null;
}

// The device's rights there, known once its member is (the first `caps`)
const rightsOf = (links: ReadonlyMap<MachineRef, { member: string | null; rights: readonly string[] }>, machine: MachineRef | null): readonly string[] | null => {
  const link = machine === null ? undefined : links.get(machine);
  return link === undefined || link.member === null ? null : link.rights;
};
const nameOf = (machine: MachineRef | null, machines = useMachines.getState().machines): string => (machine === null ? '' : machineName(machines, machine, ipc.localMachine));
/** A machine's name, read now. */
export const machineNameOf = (machine: MachineRef): string => nameOf(machine);

/** The same, read now (outside a render). */
export function remoteGreyedOf(artifactId: string, needs: RemoteNeeds): string | null {
  const machine = artifactMachineOf(artifactId);
  return remoteGreyed(needs, { machine, name: nameOf(machine), rights: rightsOf(useRemoteLaneB.getState().links, machine), notOffered: useNotOffered.getState().refused });
}

/** The same, followed in a render. */
export function useRemoteGreyed(artifactId: string | null, needs: RemoteNeeds): string | null {
  const machine = useArtifactMachine(artifactId);
  const rights = useRemoteLaneB((s) => rightsOf(s.links, machine));
  const notOffered = useNotOffered((s) => s.refused);
  const name = useMachines((s) => nameOf(machine, s.machines));
  return remoteGreyed(needs, { machine, name, rights, notOffered });
}

/** The artifact's machine's name when it is another machine's; null for this Mac's. */
export function useRemoteMachineName(artifactId: string | null): string | null {
  const machine = useArtifactMachine(artifactId);
  return useMachines((s) => (machine === null ? null : nameOf(machine, s.machines)));
}

/** A machine's refusal of a command made from here, in words: its own word named, else the error's message. */
export function remoteRefusalWords(error: Pick<IpcError, 'code' | 'message' | 'issues'>, machine: string): string {
  switch (refusalOf(error)) {
    case 'grade':
      return REMOTE_SURFACE_WORDS.noRight(machine);
    case 'step-up-cancelled':
      return REMOTE_SURFACE_WORDS.cancelled;
    case 'not-offered':
      return REMOTE_SURFACE_WORDS.notOffered(machine);
  }
  return error.code === 'host_unavailable' ? REMOTE_SURFACE_WORDS.offline(machine) : error.message;
}
