// Which sessions offer Share and Add owner (P5 O8 M6b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M6b's
// "At its end" and "Hub projects only"; M5b, the Decision Log's "M5b Task 1, the renderer"): a session you own, in a
// project on the hub, while this Mac is signed in to the org. sminos keeps a session's reach only for a session of a hub
// project joined from its machine, so a local-only project's session has none. Both act through the same record path and
// door, so one gate offers both.
// - Another machine's session, listed or a record at a listed address: its listing names you an owner and its project
//   (the hub project's sminos id).
// - This Mac's: its project's checkout has a sminos id the org index knows, this Mac's `record.policy` names the session
//   or says this Mac's sminos can't keep a reach yet (the sheet then says so, and offers nothing), and you are this Mac's
//   one owner (stores/local-owner.ts). The read answers as this Mac's owners' member, naming every session any of them
//   owns, while the door authorizes an act as your device's member, and every record act is `manage`, the session's
//   owners' alone (src/endpoint/grades.ts); with you its one owner, the sessions it names are yours.
//
// The gate is a hint: the endpoint decides every act. It reads the app's head and listings, which can lag the machine's:
// a head the app holds that names you this Mac's one owner while mawsd still holds the one before it, or a listing that
// predates an owner change, can offer an item the door then refuses (`grade`, in the sheet's words). The exact check
// needs a local `record.policy` that answers as the calling device's member, an endpoint contract change left as a
// residue row (the Decision Log's "M5b Task 1, the renderer", item 6). Until then a Mac with more than one owner offers
// neither on its own sessions.
import type { AppSessionId } from '@shared/graph/ids';
import { machineOf } from '@shared/machine/address';
import { ipc } from '../../ipc/client';
import { useHubAccess } from '../../stores/hub-access';
import { useLocalOwner } from '../../stores/local-owner';
import { selectOrgIndex } from '../../stores/org-projects';
import { policyAt, usePolicies } from '../../stores/policies';
import { useSessions } from '../../stores/sessions';
import { openDialog } from '../dialogs';

export function useCanShare(appId: AppSessionId): boolean {
  const signedIn = useHubAccess((s) => s.member !== null);
  const local = machineOf(appId) === ipc.localMachine;
  const listing = useSessions((s) => {
    const listed = s.listed.get(appId);
    return listed === undefined ? 'none' : listed.mine && listed.project !== null ? 'mine' : 'not-mine';
  });
  const hubProject = useSessions((s) => {
    const record = s.records.get(appId);
    const project = record?.projectId == null ? undefined : s.projects.get(record.projectId);
    const index = selectOrgIndex(s, ipc.localMachine);
    return project !== undefined && (index.orgs.get(index.keyOf(project))?.smnsId ?? null) !== null;
  });
  const localRead = usePolicies((s) => {
    if (!local) return false;
    const read = s.reads.get(ipc.localMachine);
    return read !== undefined && read.ok && (!read.supported || policyAt(s.reads, appId) !== undefined);
  });
  const oneOwner = useOneOwnerHere();
  if (!signedIn) return false;
  if (listing !== 'none') return listing === 'mine';
  return local && hubProject && localRead && oneOwner;
}

/** Whether the signed-in member is this Mac's one owner, as the app's head says (a hint; see the header). */
function useOneOwnerHere(): boolean {
  const me = useHubAccess((s) => s.member);
  const owner = useLocalOwner((s) => s.owner);
  return me !== null && owner === me;
}

export const openShare = (address: AppSessionId): void => openDialog({ kind: 'share', address });

/** Add owner's gate: Share's, since both act through the same record path and door. */
export const useCanAddOwner = useCanShare;

export const openAddOwner = (address: AppSessionId): void => openDialog({ kind: 'addOwner', address });
