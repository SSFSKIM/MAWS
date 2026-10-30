// The Diagnostics strip's machine daemon row (P5 O2 M7; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M7 "Status"):
// main's `host.status` read out for `mawsd` beside the supervisor row: its kind (at login, the default profile's unit;
// private, another profile's), pid, build, machine ref, role and the two hosts it owns; or why this launch runs without
// it (a setting asking for the daemon that the launch could not honour, or the embedded shape). Tokens only.
import type { HostStatus } from '@shared/ipc/schema/host';
import { useHosts } from '../stores/hosts';
import { DAEMON_ROW, SPINE_ROW } from './copy';

const ROW = DAEMON_ROW;

export function describeDaemon(status: HostStatus | null): string {
  if (!status) return ROW.unknown;
  if (status.transport !== 'daemon') return [ROW.label, status.daemonUnavailable === null ? ROW.embedded : ROW.unavailable(status.daemonUnavailable)].join(' · ');
  const d = status.daemon;
  if (d === null) return [ROW.label, ROW.connecting].join(' · ');
  const engine = d.hosts['engine-host'];
  const pty = d.hosts['pty-host'];
  return [ROW.label, ROW.kind[d.kind], ROW.pid(d.pid), ROW.build(d.build.commit, d.build.buildId), ROW.machine(d.machine), d.role, ROW.host('engine host', engine.state, engine.pid), ROW.host('pty host', pty.state, pty.pid)].join(' · ');
}

const dotOf = (status: HostStatus | null): string => (status?.transport !== 'daemon' ? 'bg-fg-faint' : status.daemon === null ? 'bg-warning' : 'bg-success');

// P5 O3-A (docs/doperpowers/plans/2026-10-28-p5-o3-spine.md §2): a run refused the spine (another live process holds the
// profile's spine.lock) says so beside the daemon row, naming the holder; nothing shows while this run holds the lock.
export function describeSpine(status: HostStatus | null): string | null {
  const refused = status?.spineRefused ?? null;
  return refused === null ? null : [SPINE_ROW.label, SPINE_ROW.refused(refused)].join(' · ');
}

export function SpineRow() {
  const text = describeSpine(useHosts((s) => s.supervisor));
  if (text === null) return null;
  return (
    <div className="flex basis-full flex-wrap items-center gap-x-3 gap-y-1">
      <output aria-label={SPINE_ROW.label} className="flex min-w-0 items-start gap-2">
        <span aria-hidden className="flex h-[1lh] shrink-0 items-center">
          <span className="size-2 rounded-full bg-warning" />
        </span>
        {text}
      </output>
    </div>
  );
}

export function DaemonRow() {
  const status = useHosts((s) => s.supervisor);
  return (
    <div className="flex basis-full flex-wrap items-center gap-x-3 gap-y-1">
      <output aria-label={ROW.label} className="flex min-w-0 items-start gap-2">
        <span aria-hidden className="flex h-[1lh] shrink-0 items-center">
          <span className={`size-2 rounded-full ${dotOf(status)}`} />
        </span>
        {describeDaemon(status)}
      </output>
    </div>
  );
}
