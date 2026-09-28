// The pattern for state main pushes (charter §12 C1 *State wiring*): a Zustand store that subscribes to its X2 event
// first and only then asks for the snapshot, so a change made while the snapshot is in flight is never lost. An event
// always wins; the snapshot fills in only if no event has arrived since connecting.
import { create } from 'zustand';
import type { MawsBridge, SettingsState, ThemeSetting } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';

export interface SettingsStore {
  state: SettingsState | null; // null until main has answered
  connect(): () => void; // returns disconnect
  setTheme(theme: ThemeSetting): Promise<void>;
}

export function createSettingsStore(client: MawsBridge) {
  return create<SettingsStore>()((set) => ({
    state: null,
    connect() {
      let heardEvent = false;
      const disconnect = client.on('settings.changed', (state) => {
        heardEvent = true;
        set({ state });
      });
      void client.invoke('settings.get', undefined).then((result) => {
        if (!result.ok) console.error('[settings] settings.get failed', result.error);
        else if (!heardEvent) set({ state: result.value });
      });
      return disconnect;
    },
    async setTheme(theme) {
      const result = await client.invoke('settings.set', { theme });
      if (!result.ok) console.error('[settings] settings.set failed', result.error);
      else set({ state: result.value });
    },
  }));
}

export const useSettings = createSettingsStore(ipc);
