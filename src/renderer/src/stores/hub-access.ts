// The hub's access as main reports it (`org.status`'s `hubAccess`, followed by `org.changed`), for the sidebar's "Hub
// unreachable" (P5 O7 M2, A2; sidebar/HubNotice.tsx). Null while the app is in no org, or not yet read. Settings › Org
// reads the whole status itself (settings-tab/org/OrgSection.tsx); this is the one field the shell draws.
import { create } from 'zustand';
import type { MawsBridge } from '@shared/ipc/schema';
import type { OrgStatus } from '@shared/ipc/schema/org';
import { ipc } from '../ipc/client';

export type HubAccess = Extract<OrgStatus, { hubAccess: unknown }>['hubAccess'];

export const useHubAccess = create<{ access: HubAccess | null }>()(() => ({ access: null }));

const accessOf = (status: OrgStatus): HubAccess | null => ('hubAccess' in status ? status.hubAccess : null);

// The status read once, each change followed; a change heard before the read answers is newer than it.
export function connectHubAccess(client: MawsBridge = ipc): () => void {
  let heard = false;
  let live = true;
  const off = client.on('org.changed', (status) => {
    heard = true;
    useHubAccess.setState({ access: accessOf(status) });
  });
  void client.invoke('org.status', undefined).then((result) => {
    if (!live || heard) return;
    if (result.ok) useHubAccess.setState({ access: accessOf(result.value) });
    else console.warn('[shell] org.status unavailable; no hub notice', result.error);
  });
  return () => {
    live = false;
    off();
  };
}
