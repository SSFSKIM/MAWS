// Each machine's sessions' reach, as its `record.policy` reads it (P5 O8 M6b, docs/doperpowers/plans/2026-10-28-p5-o8-
// org-interface.md, M6b's "Policies"): the last whole read of each machine (`org.policy.get {machine}`, the sessions the
// signed-in member owns there), for the rows' marks and the hover card. A machine is read when its link comes up (each new
// generation of it, this Mac's at the sign-in), and every whole read main makes is told as `org.policies.changed` (a
// sheet's save reads its machine again), which replaces it; an answer asked for before an event of its machine applies
// nothing, since the event is newer. Signing out, or another member signing in, forgets every read. A down machine keeps
// its last read, as its rows keep their last state.
//
// A row's mark: a session the reads name, whose access isn't Listed or that has shares (a lock for Private, a people mark
// otherwise); another member's private session shared with you, by its listing's `audience` (a channel listing's: a
// private session's alone), the lock. A session the reads don't name, and isn't another's private one, has none.
import { create } from 'zustand';
import type { MawsBridge } from '@shared/ipc/schema';
import type { RecordPolicyEntry } from '@shared/ipc/schema/endpoint';
import type { OrgPolicy } from '@shared/ipc/schema/org';
import { bareOf, isAddress, machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../ipc/client';
import type { ShareAccess } from '../sessions/share/copy';
import { useHubAccess } from './hub-access';
import { useMachines } from './machines';
import { useSessions, type ListedSession } from './sessions';

export interface PoliciesState {
  reads: ReadonlyMap<MachineRef, OrgPolicy>;
}

export const usePolicies = create<PoliciesState>()(() => ({ reads: new Map() }));

const apply = (policy: OrgPolicy) => usePolicies.setState((s) => ({ reads: new Map(s.reads).set(policy.machine, policy) }));

/** The session's entry in its machine's last read, if the read names it (an `unavailable` one included). */
export function policyAt(reads: ReadonlyMap<MachineRef, OrgPolicy>, address: string): RecordPolicyEntry | undefined {
  if (!isAddress(address)) return undefined;
  const read = reads.get(machineOf(address));
  if (read === undefined || !read.ok || !read.supported) return undefined;
  const session = bareOf(address);
  return read.policies.find((entry) => entry.session === session);
}

/** A row's reach as its mark and hover card say it; null when it has no mark. */
export type Reach = { mark: 'private' | 'shared'; access: ShareAccess; shares: number } | { mark: 'private'; sharedWithYou: true };

export function reachOf(entry: RecordPolicyEntry | undefined, listing: ListedSession | undefined): Reach | null {
  if (entry !== undefined && !('unavailable' in entry)) {
    if (entry.access === 'listed' && entry.shares.length === 0) return null;
    return { mark: entry.access === 'private' ? 'private' : 'shared', access: entry.access, shares: entry.shares.length };
  }
  if (listing !== undefined && !listing.mine && listing.audience !== undefined) return { mark: 'private', sharedWithYou: true };
  return null;
}

/** The reach of the session at `address`, from its machine's read or its listing. */
export function useReach(address: string): Reach | null {
  const entry = usePolicies((s) => policyAt(s.reads, address));
  const listing = useSessions((s) => s.listed.get(address as ListedSession['appId']));
  return reachOf(entry, listing);
}

export interface PolicyStores {
  machines: typeof useMachines;
  hub: typeof useHubAccess;
}

/** Reads each machine whose link is up while someone is signed in, and follows `org.policies.changed`. */
export function connectPolicies(client: MawsBridge = ipc, stores: PolicyStores = { machines: useMachines, hub: useHubAccess }): () => void {
  let live = true;
  let member = stores.hub.getState().member;
  const heard = new Map<MachineRef, number>(); // the events heard of each machine, so an older answer applies nothing
  const readAt = new Map<MachineRef, number>(); // the link generation each machine was last read at
  const offEvent = client.on('org.policies.changed', (policy) => {
    heard.set(policy.machine, (heard.get(policy.machine) ?? 0) + 1);
    apply(policy);
  });
  const read = (machine: MachineRef) => {
    const at = heard.get(machine) ?? 0;
    const asker = member;
    void client.invoke('org.policy.get', { machine }).then((result) => {
      if (!live || asker !== member || (heard.get(machine) ?? 0) !== at) return;
      if (result.ok) apply(result.value);
      else console.warn(`[policies] org.policy.get for ${machine} failed`, result.error);
    });
  };
  const sync = () => {
    if (!live || member === null) return;
    for (const machine of stores.machines.getState().machines.values()) {
      if (machine.state !== 'up' || readAt.get(machine.ref) === machine.generation) continue;
      readAt.set(machine.ref, machine.generation);
      read(machine.ref);
    }
  };
  const offMachines = stores.machines.subscribe(sync);
  const offHub = stores.hub.subscribe((state) => {
    if (state.member === member) return;
    member = state.member;
    readAt.clear();
    usePolicies.setState({ reads: new Map() });
    sync();
  });
  sync();
  return () => {
    live = false;
    offEvent();
    offMachines();
    offHub();
  };
}
