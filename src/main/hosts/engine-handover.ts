// Main's reading of `mawsd`'s engine host update under way, on the daemon shape (P5 O16 M3c fix wave 2;
// docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, D63; M3c's concern 1). While the engine host drains for a handover,
// `mawsd`'s relay holds main's hello on engine-host.sock; main learns why from machine.sock's `daemon.engineHandover`
// (src/mawsd/engine-handover-event.ts), never from `daemon.status`, whose read wakes a parked engine host. Two readers:
// - `drainingAt()`: now while a fresh report says the old host is draining and main's machine link is up; once that
//   ends (`none`, another state, stale, the link down), the moment it ended; null when no drain was heard. Main's
//   engine-host transport runs its start budget whole from it (no stop of the `mawsd` it spawned, no `held_lock`;
//   `handingOverAt`, daemon.ts), so the successor gets a whole budget from the drain's end (fix wave 3);
// - `reason()`: a fresh report's calls in flight, for `host.status`'s `handover` (status.ts), when there are any.
// A report is fresh for ENGINE_HANDOVER_FRESH_MS from its arrival, three of `mawsd`'s resends, so one or two lost to a
// reconnect do not end it; past that, with the machine link down, at `none`, or from an older `mawsd` that sends none,
// both read nothing and main falls back to today's bound.
import type { HostSupervisor } from '@shared/host/host-supervisor';
import type { EngineHandover } from '@shared/ipc/schema/daemon';
import type { HostStatus } from '@shared/ipc/schema/host';

export const ENGINE_HANDOVER_FRESH_MS = 15_000;

export interface EngineHandoverWatch {
  drainingAt(): number | null;
  reason(): NonNullable<HostStatus['handover']> | null;
  onChange(listener: () => void): () => void; // a report arrived, went stale or was dropped
  bind(hosts: Pick<HostSupervisor, 'onEvent' | 'onState'>): () => void;
}

export function watchEngineHandover(): EngineHandoverWatch {
  let last: { report: EngineHandover; heardAt: number } | null = null;
  let drainEnded: number | null = null; // fix wave 3: when the last draining report ended
  let stale: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of [...listeners]) listener();
  };
  // a draining report ends when another replaces it or it is dropped; past its freshness, it ended when it went stale
  const draining = (): number | null => (last?.report.state === 'draining' ? Math.min(Date.now(), last.heardAt + ENGINE_HANDOVER_FRESH_MS) : null);
  const ending = () => {
    drainEnded = draining() ?? drainEnded;
  };
  const drop = () => {
    if (stale !== null) clearTimeout(stale);
    stale = null;
    if (last === null) return;
    ending();
    last = null;
    changed();
  };
  const fresh = (): EngineHandover | null => (last !== null && Date.now() - last.heardAt < ENGINE_HANDOVER_FRESH_MS ? last.report : null);
  const heard = (report: EngineHandover) => {
    if (report.state === 'none') return drop();
    if (stale !== null) clearTimeout(stale);
    ending();
    last = { report, heardAt: Date.now() };
    stale = setTimeout(drop, ENGINE_HANDOVER_FRESH_MS);
    (stale as { unref?: () => void }).unref?.();
    changed();
  };
  return {
    drainingAt: () => draining() ?? drainEnded,
    reason() {
      const report = fresh();
      return report === null || report.inFlight === 0 ? null : { inFlight: report.inFlight, ...(report.tool !== undefined && { tool: report.tool }) };
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    bind(hosts) {
      const offs = [
        hosts.onEvent('daemon.engineHandover', heard),
        hosts.onState('machine', (state) => {
          if (state.state !== 'ready') drop(); // the machine link is down: nothing it said holds
        }),
      ];
      return () => {
        for (const off of offs) off();
        drop();
      };
    },
  };
}
