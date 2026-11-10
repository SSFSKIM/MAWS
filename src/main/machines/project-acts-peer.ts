// Which peers serve the project registry's acts, and which commands need them (docs/doperpowers/plans/2026-11-10-project-registry.md,
// Interfaces §G "Older peers", §L). Another machine serves them when its RL2 handshake lists `rl2.project-acts` (remote
// lane B checks it, src/main/lane-b/remote.ts). This Mac's own daemon may be of another build (`watchDaemon` leaves
// another bundle's daemon running), and one that predates the acts reads `addFolder`'s `into` and `own` past as fields
// it does not know and adds a plain folder (panel scalpel-3#2). Its welcome lists no capability for them; its wire minor
// says it, since the acts' fields came at minor 34 (src/shared/ipc/wire.ts). So the local machine's state carries the
// same capability while it serves them (`localProjectActs`, which the page reads as it reads another machine's), and an
// act it would take for a plain one is refused `not-offered` before it goes (`refuseUnservedProjectActs`, on the host
// shape's route), in the words an older peer's missing offer reads in.
import type { BeforeHook } from '../ipc/router';
import { ipcError } from '@shared/ipc/errors';
import type { CommandName } from '@shared/ipc/schema';
import { PROJECT_ACTS_CAPABILITY } from '@shared/ipc/schema/session';
import type { WirePeer } from '@shared/ipc/wire';
import { refusalError } from './remote/dispatch';

/** The wire minor whose commands carry the acts' fields (the project registry's M8: `into`, `own`, `link`, `expect`…). */
export const PROJECT_ACTS_MINOR = 34;

/**
 * What goes only to a machine that serves the acts: a peer that does not could pass by a field it does not know
 * (`addFolder`'s `into`, `own`; `remove`'s `expect`) and do the plain act unsaid, or know no such command.
 */
export const needsProjectActs = (name: CommandName, fields: Record<string, unknown>): boolean =>
  name === 'session.projects.link' ||
  name === 'session.projects.relocate' ||
  name === 'session.projects.resolve' ||
  (name === 'session.projects.addFolder' && (fields.into !== undefined || fields.own !== undefined)) ||
  (name === 'session.projects.remove' && fields.expect !== undefined);

/** The commands `needsProjectActs` may name, for the route's hook. */
export const PROJECT_ACT_COMMANDS: readonly CommandName[] = ['session.projects.addFolder', 'session.projects.link', 'session.projects.relocate', 'session.projects.resolve', 'session.projects.remove'];

/**
 * This Mac's machine's capabilities as far as the acts go: served embedded (main's own services, this build) or by a
 * daemon whose welcome is of the acts' minor or later; none by an older one; null while no daemon has welcomed.
 */
export function localProjectActs(peer: Pick<WirePeer, 'minor'> | null, { embedded }: { embedded: boolean }): readonly string[] | null {
  if (embedded) return [PROJECT_ACTS_CAPABILITY];
  if (peer === null) return null;
  return peer.minor >= PROJECT_ACTS_MINOR ? [PROJECT_ACTS_CAPABILITY] : [];
}

/**
 * The host route's hook: an act the attached daemon would not serve is refused `not-offered`; while no daemon is
 * welcomed it is `host_unavailable`, as remote lane B answers a link with no handshake, since the supervisor would hold
 * it for whichever daemon welcomes next. Any other command goes on.
 */
export function refuseUnservedProjectActs(peer: () => Pick<WirePeer, 'minor'> | null, machineName: string): BeforeHook {
  return async (name, input) => {
    if (!needsProjectActs(name, (input ?? {}) as Record<string, unknown>)) return undefined;
    const daemon = peer();
    if (daemon === null) return { ok: false, error: ipcError('host_unavailable', `${name}: ${machineName}'s daemon is not connected now`) };
    return daemon.minor >= PROJECT_ACTS_MINOR ? undefined : refusalError(name, machineName, { code: 'not-offered' });
  };
}

/**
 * The local state's capabilities as the connection manager reads them (`localCapabilities`). On the daemon shape, from
 * the attached daemon's welcome, heard again at each of its state's changes. On the embedded shape no machine host runs
 * in this process (the supervisor throws at a read of one: CI's e2e:cross-build), and the acts are this build's own
 * services', so the supervisor is never asked and nothing is subscribed.
 */
export function localProjectActsSource(
  hosts: { peer(owner: 'machine'): Pick<WirePeer, 'minor'> | null; onState(owner: 'machine', listener: () => void): () => void },
  { embedded }: { embedded: boolean },
): { read(): readonly string[] | null; onChange(listener: () => void): () => void } {
  if (embedded) return { read: () => localProjectActs(null, { embedded: true }), onChange: () => () => {} };
  return { read: () => localProjectActs(hosts.peer('machine'), { embedded: false }), onChange: (listener) => hosts.onState('machine', () => listener()) };
}
