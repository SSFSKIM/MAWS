// Which sessions offer Share (P5 O8 M6b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M6b's "At its end"
// and "Hub projects only"): a session you own, in a project on the hub, while this Mac is signed in to the org. sminos
// keeps a session's reach only for a session of a hub project joined from its machine, so a local-only project's session
// has none.
// - Another machine's session, listed or a record at a listed address: its listing names you an owner and its project
//   (the hub project's sminos id).
// - This Mac's: its project's checkout has a sminos id the org index knows, and this Mac's `record.policy` names the
//   session (it answers only for the sessions its owners own), or says this Mac's sminos can't keep a reach yet (the
//   sheet then says so, and offers nothing).
import type { AppSessionId } from '@shared/graph/ids';
import { machineOf } from '@shared/machine/address';
import { ipc } from '../../ipc/client';
import { useHubAccess } from '../../stores/hub-access';
import { orgKeyOf, selectOrgIndex } from '../../stores/org-projects';
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
    return project !== undefined && (selectOrgIndex(s, ipc.localMachine).orgs.get(orgKeyOf(project))?.smnsId ?? null) !== null;
  });
  const localRead = usePolicies((s) => {
    if (!local) return false;
    const read = s.reads.get(ipc.localMachine);
    return read !== undefined && read.ok && (!read.supported || policyAt(s.reads, appId) !== undefined);
  });
  if (!signedIn) return false;
  if (listing !== 'none') return listing === 'mine';
  return local && hubProject && localRead;
}

export const openShare = (address: AppSessionId): void => openDialog({ kind: 'share', address });
