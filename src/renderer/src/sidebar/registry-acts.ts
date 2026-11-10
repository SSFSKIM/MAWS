// The project registry's acts from the page (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §G and §I;
// design §6): each a command to the machine that holds the folder, named by the location's address (main routes it, and
// steps up `addFolder`, `link` and `relocate` sent to another machine), or main's own for a removal held while the
// machine is off. A refusal comes back in words a person can act on (`actWords`).
import type { IpcError } from '@shared/ipc/errors';
import type { MawsBridge } from '@shared/ipc/schema';
import { PROJECT_ACTS_CAPABILITY } from '@shared/ipc/schema/session';
import type { MachineState } from '@shared/ipc/schema/machines';
import type { ProjectId } from '@shared/graph/ids';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../ipc/client';
import { setupErrorWords } from '../sessions/remote-setup';
import { projectRefusal } from '../stores/registry';
import type { Resolved } from './locations';
import { REGISTRY } from './registry-copy';

export type ActAnswer = { ok: true } | { ok: false; words: string };

/** A project act's refusal in words (§J.3, §G), the machine named; anything else as the setup's words, or as main said it. */
export function actWords(error: Pick<IpcError, 'code' | 'message' | 'issues'>, machine: string): string {
  const refusal = projectRefusal(error);
  if (refusal?.code === 'not-offered') return REGISTRY.mawsTooOld(machine);
  if (refusal?.code === 'statements-unavailable' && refusal.reason === 'sminos-too-old') return REGISTRY.sminosTooOld(machine);
  const refused = (error.issues as { refusal?: unknown } | undefined)?.refusal;
  if (refused === 'owners-only' || refused === 'grade') return REGISTRY.notOwner(machine); // the endpoint's guard: not an owner, or a grant short of the act
  return setupErrorWords(error, machine);
}

/**
 * Whether the machine serves the project acts (§G, `rl2.project-acts` in its handshake): this Mac's own daemon does; another
 * machine does when its link listed the capability, and is not taken to while its link has listed none.
 */
export const servesProjectActs = (machine: Pick<MachineState, 'local' | 'capabilities'> | undefined): boolean =>
  machine?.local === true || (machine?.capabilities?.includes(PROJECT_ACTS_CAPABILITY) ?? false);

/** Design §8's rule for the folder there, changing nothing; null when the machine could not answer. */
export async function resolveFolder(machine: MachineRef, directory: string, client: MawsBridge = ipc): Promise<Resolved | null> {
  const result = await client.invoke('session.projects.resolve', { directory }, { machine }).catch(() => null);
  return result?.ok === true ? result.value : null;
}

/** Declares the folder on the machine: a new project, a location of `into`, or (`own`) a project of its own inside another's folder. */
export async function addFolder(machine: MachineRef, name: string, input: { directory: string; into?: string; own?: true }, client: MawsBridge = ipc): Promise<ActAnswer> {
  const result = await client.invoke('session.projects.addFolder', input, { machine });
  return result.ok ? { ok: true } : { ok: false, words: actWords(result.error, name) };
}

/** Sets a location's link (`into`), or with null clears it. */
export async function linkLocation(address: ProjectId, into: string | null, machine: string, client: MawsBridge = ipc): Promise<ActAnswer> {
  const result = await client.invoke('session.projects.link', { id: address, into });
  return result.ok ? { ok: true } : { ok: false, words: actWords(result.error, machine) };
}

/** Points a location at its folder's path now (its own path: "Use this folder"). */
export async function relocateLocation(address: ProjectId, directory: string, machine: string, client: MawsBridge = ipc): Promise<ActAnswer> {
  const result = await client.invoke('session.projects.relocate', { id: address, directory });
  return result.ok ? { ok: true } : { ok: false, words: actWords(result.error, machine) };
}

/**
 * Removes a location: hidden on its machine now while that machine is up, else held by main for when it is next up
 * (§I: bound to the location as it is now, listed meanwhile, cancellable).
 */
export async function removeLocation(target: { address: ProjectId; machine: MachineRef; pid: string; up: boolean }, machine: string, client: MawsBridge = ipc): Promise<ActAnswer> {
  const result = target.up ? await client.invoke('session.projects.remove', { id: target.address }) : await client.invoke('org.removals.hold', { machine: target.machine, pid: target.pid });
  return result.ok ? { ok: true } : { ok: false, words: actWords(result.error, machine) };
}

/** A held removal let go: nothing is sent. */
export async function cancelRemoval(id: string, client: MawsBridge = ipc): Promise<ActAnswer> {
  const result = await client.invoke('org.removals.cancel', { id });
  return result.ok ? { ok: true } : { ok: false, words: result.error.message };
}

/** Renames the project at one location's machine (§J.3: this Mac's when it has one, else the first that is up). */
export async function renameAt(address: ProjectId, name: string, machine: string, client: MawsBridge = ipc): Promise<ActAnswer> {
  const result = await client.invoke('session.projects.update', { id: address, patch: { name } });
  return result.ok ? { ok: true } : { ok: false, words: actWords(result.error, machine) };
}
