// The two utility processes as the page sees them. Subscribes to `engine.hostState` and `pty.hostState` first, then
// asks for both snapshots, and per host keeps whichever state has the higher `revision` (main increments it on every
// transition), so a page that arrives after the hosts are ready, or after a reload, shows the truth without waiting
// for a transition that will not come. `revision` orders snapshot against event; `freshness` only retires the replies
// of a connection that has since disconnected (a StrictMode remount), so events here do not advance it.
import { create } from 'zustand';
import type { HostState, MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { createFreshness } from './freshness';

export type HostKey = 'engine' | 'pty';
const CHANNELS = { engine: 'engine.hostState', pty: 'pty.hostState' } as const satisfies Record<HostKey, string>;

export interface HostsStore {
  hosts: Record<HostKey, HostState | null>; // null until main has answered
  connect(): () => void; // returns disconnect
}

export function createHostsStore(client: MawsBridge) {
  const freshness = createFreshness();
  return create<HostsStore>()((set, get) => {
    const keep = (key: HostKey, state: HostState) => {
      const current = get().hosts[key];
      if (!current || state.revision > current.revision) set({ hosts: { ...get().hosts, [key]: state } });
    };
    return {
      hosts: { engine: null, pty: null },
      connect() {
        const keys = Object.keys(CHANNELS) as HostKey[];
        const offs = keys.map((key) => client.on(CHANNELS[key], (state) => keep(key, state)));
        const live = freshness.stamp();
        for (const key of keys) {
          void client.invoke(CHANNELS[key], undefined).then((result) => {
            if (!result.ok) console.error(`[hosts] ${CHANNELS[key]} failed`, result.error);
            else if (live()) keep(key, result.value);
          });
        }
        return () => {
          offs.forEach((off) => off());
          freshness.advance();
        };
      },
    };
  });
}

export const useHosts = createHostsStore(ipc);
