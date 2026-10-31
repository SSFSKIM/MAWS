import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { toast } from '../stores/notices';
import { isRemoteLaneB } from '../lane-b/remote-session'; // P5 O7 M2
import { setRemoteUnread } from '../lane-b/read-marks'; // P5 O7 M2

// Read the rendered order, not a second implementation of the sidebar's filters,
// caps and expansion. Needs-you precedes the tree; its duplicate tree rows are skipped.
export function visibleSessionStep(current: string | null, delta: 1 | -1): AppSessionId | null {
  const rows = document.querySelectorAll('[data-testid="sidebar-tree"] [data-menu^="session:"]');
  const ids = [...new Set([...rows].map((row) => row.getAttribute('data-menu')!.slice('session:'.length)))];
  if (ids.length === 0) return null;
  const at = current === null ? -1 : ids.indexOf(current);
  return ids[at === -1 ? (delta === 1 ? 0 : ids.length - 1) : (at + delta + ids.length) % ids.length] as AppSessionId;
}

export async function setSessionUnread(appSessionId: AppSessionId, unread: boolean, client: MawsBridge = ipc): Promise<void> {
  if (isRemoteLaneB(appSessionId)) return setRemoteUnread(appSessionId, unread); // P5 O7 M2: in this app's memory, never the owner's record
  const result = await client.invoke('session.update', { appSessionId, patch: { unread } });
  if (!result.ok) toast({ level: 'danger', text: result.error.message, actions: [], dismissible: true });
}
