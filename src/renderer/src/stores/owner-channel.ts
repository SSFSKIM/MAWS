// Each session's owner channel as main reports it (X18; the P2-C document, Design §5 to §8): the lane (on or off, the
// override, what the last launch applied, a pending change, a style mismatch) and the stored marks with their states,
// per session while something draws it. `ownerChannel.changed` carries the whole state and no revision, so the rule is
// the queue store's: the subscription goes on first, and a read that answers after an event for its session is older
// than that event and is dropped. Main announces a move of the app's switch only for sessions with stored marks, so a
// change of `mods.toHuman.enabled` reads every attached session again. A session main cannot answer for holds nothing,
// and draws as it did before the lane (P1).
import { useEffect } from 'react';
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { OwnerChannelState } from '@shared/owner/state';
import { ipc } from '../ipc/client';

interface OwnerChannelStore {
  bySession: ReadonlyMap<AppSessionId, OwnerChannelState>;
}

export const useOwnerChannelStore = create<OwnerChannelStore>()(() => ({ bySession: new Map() }));

const put = (appSessionId: AppSessionId, state: OwnerChannelState) =>
  useOwnerChannelStore.setState((s) => ({ bySession: new Map(s.bySession).set(appSessionId, state) }));

const attachments = new Map<AppSessionId, { count: number; off: () => void }>();

// Hydrates a session's owner channel and keeps it current while anything is attached; the disposer releases one.
export function attachOwnerChannel(appSessionId: AppSessionId, client: MawsBridge = ipc): () => void {
  const held = attachments.get(appSessionId);
  if (held) held.count += 1;
  else {
    let live = true;
    let reads = 0; // a read answers only if no event or later read came since it was asked
    let switchOn: boolean | null = null;
    const read = () => {
      const asked = ++reads;
      void client.invoke('ownerChannel.state', { appSessionId }).then((result) => {
        if (live && asked === reads && result.ok) put(appSessionId, result.value);
      });
    };
    const offChanged = client.on('ownerChannel.changed', (e) => {
      if (!live || e.appSessionId !== appSessionId) return;
      reads += 1;
      put(appSessionId, e.state);
    });
    const offSettings = client.on('settings.changed', (e) => {
      const on = e.settings.mods.toHuman.enabled;
      const moved = on !== switchOn; // unknown until the first event: read again then too
      switchOn = on;
      if (live && moved) read();
    });
    read();
    attachments.set(appSessionId, {
      count: 1,
      off: () => {
        live = false;
        offChanged();
        offSettings();
      },
    });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const entry = attachments.get(appSessionId);
    if (!entry) return;
    entry.count -= 1;
    if (entry.count > 0) return;
    entry.off();
    attachments.delete(appSessionId);
  };
}

// A session's owner channel while the calling component is mounted; null for no session, or until main has answered.
export function useOwnerChannel(appSessionId: AppSessionId | null): OwnerChannelState | null {
  useEffect(() => (appSessionId === null ? undefined : attachOwnerChannel(appSessionId)), [appSessionId]);
  return useOwnerChannelStore((s) => (appSessionId === null ? null : (s.bySession.get(appSessionId) ?? null)));
}

// Tests: forget every session and every attachment.
export function resetOwnerChannelStore(): void {
  for (const entry of attachments.values()) entry.off();
  attachments.clear();
  useOwnerChannelStore.setState({ bySession: new Map() });
}
