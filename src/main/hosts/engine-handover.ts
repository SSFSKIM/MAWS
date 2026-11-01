// Main's reading of `mawsd`'s engine host update under way, on the daemon shape (P5 O16 M3c fix wave 2;
// docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, D63; M3c's concern 1). While the engine host drains for a handover,
// `mawsd`'s relay holds main's hello on engine-host.sock; main learns why from machine.sock's `daemon.engineHandover`
// (src/mawsd/engine-handover-event.ts), never from `daemon.status`, whose read wakes a parked engine host. Two readers:
// - `waiting()`: a fresh report says the old host is draining and main's machine link is up, so main's engine-host
//   transport holds its start budget (no stop of the `mawsd` it spawned, no `held_lock`; `waitingOn`, daemon.ts);
// - `reason()`: a fresh report's calls in flight, for `host.status`'s `handover` (status.ts), when there are any.
// A report is fresh for ENGINE_HANDOVER_FRESH_MS from its arrival, three of `mawsd`'s resends, so one or two lost to a
// reconnect do not end it; past that, with the machine link down, at `none`, or from an older `mawsd` that sends none,
// both read nothing and main falls back to today's bound.
import type { HostSupervisor } from '@shared/host/host-supervisor';
import type { EngineHandover } from '@shared/ipc/schema/daemon';
import type { HostStatus } from '@shared/ipc/schema/host';

export const ENGINE_HANDOVER_FRESH_MS = 15_000;

export interface EngineHandoverWatch {
  waiting(): boolean;
  reason(): NonNullable<HostStatus['handover']> | null;
  onChange(listener: () => void): () => void; // a report arrived, went stale or was dropped
  bind(hosts: Pick<HostSupervisor, 'onEvent' | 'onState'>): () => void;
}

export function watchEngineHandover(): EngineHandoverWatch {
  let last: { report: EngineHandover; heardAt: number } | null = null;
  let stale: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of [...listeners]) listener();
  };
  const drop = () => {
    if (stale !== null) clearTimeout(stale);
    stale = null;
    if (last === null) return;
    last = null;
    changed();
  };
  const fresh = (): EngineHandover | null => (last !== null && Date.now() - last.heardAt < ENGINE_HANDOVER_FRESH_MS ? last.report : null);
  const heard = (report: EngineHandover) => {
    if (report.state === 'none') return drop();
    if (stale !== null) clearTimeout(stale);
    last = { report, heardAt: Date.now() };
    stale = setTimeout(drop, ENGINE_HANDOVER_FRESH_MS);
    (stale as { unref?: () => void }).unref?.();
    changed();
  };
  return {
    waiting: () => fresh()?.state === 'draining',
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
