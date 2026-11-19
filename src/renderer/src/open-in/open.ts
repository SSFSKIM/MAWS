// The hand-off (UX wave U6b-4a, docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4a-open-in.md, Interfaces §A): the window
// names the app, the session and, from a file's bar, the path it shows and the line; main asks the daemon to admit the
// path and launches with the real path it answers. An open that did not happen is a notice with main's sentence.
import { useMachines } from '../stores/machines';
import type { AppSessionId } from '@shared/graph/ids';
import type { OpenInAppId } from '@shared/ipc/schema/layout';
import { isAddress, machineOf } from '@shared/machine/address';
import { ipc } from '../ipc/client';
import { machineName } from '../stores/org-projects';
import { toast } from '../stores/notices';
import { OPEN_IN_COPY } from './copy';

export interface OpenInFile {
  path: string;
  line: number | null;
}

export async function openIn(appSessionId: AppSessionId, app: OpenInAppId, file: OpenInFile | null = null): Promise<void> {
  const input = file === null ? { appSessionId, app } : { appSessionId, app, path: file.path, ...(file.line === null ? {} : { line: file.line }) };
  const answer = await ipc.invoke('layout.openIn', input).catch(() => null);
  const message = answer === null || !answer.ok ? OPEN_IN_COPY.failed : answer.value.opened ? null : answer.value.message;
  if (message !== null) toast({ level: 'warning', text: message, actions: [], dismissible: true });
}

// The name of the machine a session runs on when that is not this Mac, else null: its folder is not here, and "Open in"
// is drawn disabled saying where it is.
export function useOtherMachine(appSessionId: AppSessionId): string | null {
  return useMachines((s) => (isAddress(appSessionId) && machineOf(appSessionId) !== ipc.localMachine ? machineName(s.machines, machineOf(appSessionId), ipc.localMachine) : null));
}
