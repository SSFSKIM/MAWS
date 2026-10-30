// The two utility processes as the page sees them. Subscribes to `engine.hostState` and `pty.hostState` first, then
// asks for both snapshots, and per host keeps whichever state has the higher `revision` (main increments it on every
// transition), so a page that arrives after the hosts are ready, or after a reload, shows the truth without waiting
// for a transition that will not come. `revision` orders snapshot against event; `freshness` only retires the replies
// of a connection that has since disconnected (a StrictMode remount), so events here do not advance it.
// E10: also main's `host.status` (the supervisor's status with main's facts), event and snapshot. It carries no
// revision, so it has its own freshness, which its events advance: an event is always the newest word, and a snapshot
// applies only if no event arrived since it was asked.
// P5 O6 M4 (docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "One store per kind"): the hosts are kept per
// machine, each event by the machine it came from. Another machine's are known from its events only, and forgotten when
// its link goes down or comes up as a new generation, whose revisions start afresh. `hosts` is the local machine's, and
// so is `supervisor`.
import { create } from 'zustand';
import type { HostState, MawsBridge } from '@shared/ipc/schema';
import type { HostStatus } from '@shared/ipc/schema/host';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../ipc/client';
import { createFreshness } from './freshness';

export type HostKey = 'engine' | 'pty';
const CHANNELS = { engine: 'engine.hostState', pty: 'pty.hostState' } as const satisfies Record<HostKey, string>;
type Hosts = Record<HostKey, HostState | null>;
const NO_HOSTS: Hosts = { engine: null, pty: null };

export interface HostsStore {
  hosts: Hosts; // the local machine's; null until main has answered
  byMachine: Map<MachineRef, Hosts>; // every machine's heard so far, the local one's included
  supervisor: HostStatus | null; // E10: null until main has answered
  connect(): () => void; // returns disconnect
}

export function createHostsStore(client: MawsBridge) {
  const freshness = createFreshness();
  const statusFreshness = createFreshness(); // E10
  return create<HostsStore>()((set, get) => {
    const keep = (machine: MachineRef, key: HostKey, state: HostState) => {
      const current = get().byMachine.get(machine) ?? NO_HOSTS;
      if (current[key] && state.revision <= current[key].revision) return;
      const next = { ...current, [key]: state };
      set({ byMachine: new Map(get().byMachine).set(machine, next), ...(machine === client.localMachine ? { hosts: next } : {}) });
    };
    const generations = new Map<MachineRef, number>(); // each other machine's link generation, as last heard
    const forget = (machine: MachineRef) => {
      if (!get().byMachine.has(machine)) return;
      const byMachine = new Map(get().byMachine);
      byMachine.delete(machine);
      set({ byMachine });
    };
    return {
      hosts: NO_HOSTS,
      byMachine: new Map(),
      supervisor: null,
      connect() {
        const keys = Object.keys(CHANNELS) as HostKey[];
        const offs = keys.map((key) => client.on(CHANNELS[key], (state, from) => keep(from.machine, key, state)));
        offs.push(
          client.on('host.status', (supervisor) => {
            statusFreshness.advance();
            set({ supervisor });
          }),
          client.on('machines.changed', ({ machines }) => {
            // The first list heard names the generation the hosts already kept came from (the page may have connected
            // after the link's welcome), so only a later change of generation forgets them.
            for (const m of machines) {
              if (m.local) continue;
              const last = generations.get(m.ref);
              if (m.state !== 'up' || (last !== undefined && m.generation !== last)) forget(m.ref);
              generations.set(m.ref, m.generation);
            }
          }),
        );
        const live = freshness.stamp();
        for (const key of keys) {
          void client.invoke(CHANNELS[key], undefined).then((result) => {
            if (!result.ok) console.error(`[hosts] ${CHANNELS[key]} failed`, result.error);
            else if (live()) keep(client.localMachine, key, result.value);
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
