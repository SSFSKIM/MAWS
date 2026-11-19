// UX wave U6b-4b (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4b-links.md, M3): what the notice's classifier is handed
// about a session (`notice.ts` asks no store itself): its machine's display name as the roster gives it, null for a
// session of this Mac (and for no session), and whether the session's listing says it is the person's own (`listed.mine`),
// null with no listing. Followed, so a roster or a listing that arrives draws the notice again.
import type { AppSessionId } from '@shared/graph/ids';
import { isAddress, machineOf } from '@shared/machine/address';
import { ipc } from '../../../ipc/client';
import { useMachines } from '../../../stores/machines';
import { machineName } from '../../../stores/org-projects';
import { useSessions } from '../../../stores/sessions';

export interface NoticePlace {
  machine: string | null;
  mine: boolean | null;
}

const elsewhere = (appSessionId: AppSessionId | null): appSessionId is AppSessionId =>
  appSessionId !== null && isAddress(appSessionId) && machineOf(appSessionId) !== ipc.localMachine;

export function useNoticePlace(appSessionId: AppSessionId | null): NoticePlace {
  const machine = useMachines((s) => (elsewhere(appSessionId) ? machineName(s.machines, machineOf(appSessionId), ipc.localMachine) : null));
  const mine = useSessions((s) => (appSessionId === null ? null : (s.listed.get(appSessionId)?.mine ?? null)));
  return { machine, mine };
}
