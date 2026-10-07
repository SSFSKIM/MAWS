// The two utility processes as the page sees them. Subscribes to `engine.hostState` and `pty.hostState` first, then
// asks for both snapshots, and per host keeps whichever state has the higher `revision` (main increments it on every
// transition), so a page that arrives after the hosts are ready, or after a reload, shows the truth without waiting
// for a transition that will not come. `revision` orders snapshot against event; `freshness` only retires the replies
// of a connection that has since disconnected (a StrictMode remount), so events here do not advance it.
// E10: also main's `host.status` (the supervisor's status with main's facts), event and snapshot. It carries no
// revision, so it has its own freshness, which its events advance: an event is always the newest word, and a snapshot
// applies only if no event arrived since it was asked.
import { create } from 'zustand';
import type { HostState, MawsBridge } from '@shared/ipc/schema';
import type { HostStatus } from '@shared/ipc/schema/host';
import { ipc } from '../ipc/client';
import { createFreshness } from './freshness';

export type HostKey = 'engine' | 'pty';
const CHANNELS = { engine: 'engine.hostState', pty: 'pty.hostState' } as const satisfies Record<HostKey, string>;

export interface HostsStore {
  hosts: Record<HostKey, HostState | null>; // null until main has answered
  supervisor: HostStatus | null; // E10: null until main has answered
  connect(): () => void; // returns disconnect
}

export function createHostsStore(client: MawsBridge) {
  const freshness = createFreshness();
  const statusFreshness = createFreshness(); // E10
  return create<HostsStore>()((set, get) => {
    const keep = (key: HostKey, state: HostState) => {
      const current = get().hosts[key];
      if (!current || state.revision > current.revision) set({ hosts: { ...get().hosts, [key]: state } });
    };
    return {
      hosts: { engine: null, pty: null },
      supervisor: null,
      connect() {
        const keys = Object.keys(CHANNELS) as HostKey[];
        const offs = keys.map((key) => client.on(CHANNELS[key], (state) => keep(key, state)));
        offs.push(
          client.on('host.status', (supervisor) => {
            statusFreshness.advance();
            set({ supervisor });
          }),
        );
        const live = freshness.stamp();
        for (const key of keys) {
          void client.invoke(CHANNELS[key], undefined).then((result) => {
            if (!result.ok) console.error(`[hosts] ${CHANNELS[key]} failed`, result.error);
            else if (live()) keep(key, result.value);
          });
        }
        const statusLive = statusFreshness.stamp();
        void client.invoke('host.status', undefined).then((result) => {
          if (!result.ok) console.error('[hosts] host.status failed', result.error);
          else if (statusLive()) set({ supervisor: result.value });
        });
        return () => {
          offs.forEach((off) => off());
          freshness.advance();
          statusFreshness.advance();
        };
      },
    };
  });
}

export const useHosts = createHostsStore(ipc);
