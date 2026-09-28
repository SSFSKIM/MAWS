// The pattern for state main pushes (charter §12 C1 *State wiring*): a Zustand store that subscribes to its X2 event
// first and only then asks for the snapshot. Events always apply; a reply (the snapshot, or `settings.set`'s answer)
// applies only if no event arrived since it was asked and its connection is still live (`freshness.ts`), so neither a
// StrictMode remount nor a slow reply can overwrite a newer theme.
import { create } from 'zustand';
import type { MawsBridge, SettingsState, ThemeSetting } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { createFreshness } from './freshness';

export interface SettingsStore {
  state: SettingsState | null; // null until main has answered
  connect(): () => void; // returns disconnect
  setTheme(theme: ThemeSetting): Promise<void>;
}

export function createSettingsStore(client: MawsBridge) {
  const freshness = createFreshness();
  return create<SettingsStore>()((set) => ({
    state: null,
    connect() {
      const off = client.on('settings.changed', (state) => {
        freshness.advance();
        set({ state });
      });
      const fresh = freshness.stamp();
      void client.invoke('settings.get', undefined).then((result) => {
        if (!result.ok) console.error('[settings] settings.get failed', result.error);
        else if (fresh()) set({ state: result.value });
      });
      return () => {
        off();
        freshness.advance();
      };
    },
    async setTheme(theme) {
      const fresh = freshness.stamp();
      const result = await client.invoke('settings.set', { theme });
      if (!result.ok) console.error('[settings] settings.set failed', result.error);
      else if (fresh()) set({ state: result.value });
    },
  }));
}

export const useSettings = createSettingsStore(ipc);
