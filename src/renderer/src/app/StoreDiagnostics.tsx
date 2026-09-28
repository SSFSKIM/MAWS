// The Store section of the diagnostics strip (C4 execution document, Architecture "Renderer"): the engine's store as
// the filesystem state service sees it, so C4's acceptance can be read by eye before C5's sidebar exists. It shows the
// config home and whether it is watched, the scan counts, and one row per discovered session with its title, its
// directory from the first record and its holder badge. C5 replaces it as the user-facing surface.
import { useEffect, useMemo } from 'react';
import type { FsState } from '@shared/ipc/schema/fs';
import { describeHolder, rowsOf, titleOf, useStoreDiagnostics, type ScanStatus } from '../stores/store-diagnostics';

export function StoreDiagnostics() {
  const fs = useStoreDiagnostics((s) => s.fs);
  const scan = useStoreDiagnostics((s) => s.scan);
  const sessions = useStoreDiagnostics((s) => s.sessions);
  const holders = useStoreDiagnostics((s) => s.holders);
  const rows = useMemo(() => rowsOf(sessions, holders), [sessions, holders]);

  useEffect(() => useStoreDiagnostics.getState().connect(), []);

  return (
    <section aria-label="Store" className="flex w-full min-w-0 flex-col rounded-sm border border-border">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-border px-3 py-2">
        <output aria-label="store" className="font-mono">
          {describeStore(fs)}
        </output>
        <output aria-label="store scan" className="font-mono">
          {describeScan(scan)}
        </output>
      </div>
      <ul aria-label="Discovered sessions" className="max-h-96 overflow-auto">
        {rows.map(({ summary, holder }) => {
          const badge = describeHolder(holder);
          return (
            <li key={summary.sessionId} className="flex h-(--row-h) items-center gap-3 border-b border-border px-3 last:border-b-0">
              <span className="min-w-0 flex-1 truncate text-fg">{titleOf(summary)}</span>
              <span className="min-w-0 max-w-[45%] truncate font-mono text-fg-faint">{summary.directory ?? '—'}</span>
              {badge && <span className="shrink-0 rounded-sm bg-accent-soft px-1.5 font-mono text-fg">{badge}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function describeStore(fs: FsState | null): string {
  if (!fs) return 'store · …';
  return `store · ${fs.configHome} · ${fs.watching ? 'watching' : 'not watching'}`;
}

export function describeScan(scan: ScanStatus): string {
  switch (scan.status) {
    case 'idle':
      return '';
    case 'running':
      return scan.progress ? `scanning ${scan.progress.scanned} / ${scan.progress.total}` : 'scanning…';
    case 'done':
      return `projects ${scan.result.projects} · sessions ${scan.result.sessions} · scan ${(scan.result.durationMs / 1000).toFixed(1)} s`;
    case 'failed':
      return `scan failed: ${scan.error}`;
  }
}
