// A file outside a session's folders on another machine, in the window (UX wave U6f,
// docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, §E; decisions 11 to 13 and 18).
//
// - Which sessions take the remote route: a lane B session main runs on another machine over RL2. Its reads carry `named`
//   (main's adapter turns a read of a file outside the folders into the act there, for one of the machine's owners), and
//   Open File… draws MAWS's own chooser of that machine. A session of another profile of this Mac (a socket) and a
//   terminal session there (lane A's adapter takes only `laneA.*`) keep today's requests, to the byte.
// - The sentence an outside act there is unavailable with: the window's helper's (`disabledWords`), which holds the
//   ownership row this build's offer reads (`outsideOffer`); the machine decides every request again.
// - What the person opened on a machine this run (`openedThere`): the private folders confirmed in the chooser and the
//   files opened by a tab's Open it. A read, a save or a frame of a path under one of them carries `open: true`, so the
//   machine is not asked about a folder twice. In memory alone, stored nowhere: after a relaunch a restored tab asks once.
//   Containment is proven on the path as written, normalized: a path with a "." or ".." segment lends itself nothing
//   (fix wave, review finding 1), since the walk there could leave the folder the person confirmed.
// - The offer is the owners' (decision 13): `ownersOnly` is the ownership row's sentence alone, which every outside request
//   asks again before it is sent, the link's phase aside (an owner's save waits for the machine offline; decision 14).
import type { AppSessionId } from '@shared/graph/ids';
import { outsideOffer } from '@shared/files/outside';
import { disabledWords, type RemoteStanding } from '@shared/ipc/remote-unavailable';
import type { MachineRef } from '@shared/machine/ref';
import { isOverRl2, isRemoteLaneB, useIsOverRl2, useIsRemoteLaneB } from '../../../lane-b/remote-session';

/** Whether the session's file requests take the remote route: a lane B session main runs on another machine over RL2. */
export function takesRemoteRoute(appSessionId: AppSessionId): boolean {
  return isRemoteLaneB(appSessionId) && isOverRl2(appSessionId);
}

/** The same, followed in a render. */
export function useTakesRemoteRoute(appSessionId: AppSessionId): boolean {
  const laneB = useIsRemoteLaneB(appSessionId);
  const overRl2 = useIsOverRl2(appSessionId);
  return laneB && overRl2;
}

/** Why an outside act on the session's machine is not offered there, in decision 12's words; null with no standing. */
export function outsideUnavailable(standing: RemoteStanding | null, command: 'files.chooseOutside' | 'files.writeOutside' | 'files.readOutside'): string | null {
  return standing === null ? null : disabledWords(command, standing);
}

/** The ownership row alone (decision 13): its sentence while the person is not known to own the machine; null while they do. */
export function ownersOnly(standing: RemoteStanding | null, command: 'files.chooseOutside' | 'files.writeOutside' | 'files.readOutside'): string | null {
  return standing === null || outsideOffer(standing.owner) ? null : disabledWords(command, { ...standing, phase: 'up', capabilities: null });
}

const opened = new Map<MachineRef, Set<string>>();
// A path written with a "." or ".." segment is not taken to lie anywhere: what it names is the walk's to say
const normal = (path: string) => !path.split('/').some((segment) => segment === '.' || segment === '..');
const under = (path: string, place: string) => normal(path) && (path === place || path.startsWith(place.endsWith('/') ? place : `${place}/`));

/** What the person opened on `machine` this run; `has`: the path is one of them or lies under one. */
export function openedThere(machine: MachineRef): { has(path: string): boolean; add(path: string): void } {
  return {
    has: (path) => [...(opened.get(machine) ?? [])].some((place) => under(path, place)),
    add: (path) => void opened.set(machine, new Set([...(opened.get(machine) ?? []), path])),
  };
}

/** Tests: forget what was opened on every machine. */
export function forgetOpenedThere(): void {
  opened.clear();
}
