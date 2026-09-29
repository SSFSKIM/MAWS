// The Store section of the diagnostics strip (C4 execution document, Architecture "Renderer"): the engine's store as
// MAWS knows it, so C4's acceptance can be read by eye before C5's sidebar exists. It shows the config home and whether
// it is watched, the counts (projects from the index's project list, sessions and scan time from the store scan), and
// one row per session record from the index (`session.list`, M4) with its title and its source, its directory, a pin,
// and its holder badge. A row can be followed (M3): the detail then reads the chain (`chain N · leaf <uuid8>`) and the
// last twenty events. Replay controls (M5) start a fixture and drive its run. A row's Git button (M6) shows its
// directory's branch, ahead/behind and changed files. C5 replaces it as the user-facing surface.
import { useEffect, useMemo } from 'react';
import type { FsState } from '@shared/ipc/schema/fs';
import { GitDiagnostics } from './GitDiagnostics';
import { ReplayDiagnostics } from './ReplayDiagnostics';
import { useGitDiagnostics } from '../stores/git-diagnostics';
import {
  describeEvent,
  describeFollow,
  describeHolder,
  rowsOf,
  titleOf,
  useStoreDiagnostics,
  type FollowView,
  type ScanStatus,
} from '../stores/store-diagnostics';

export function StoreDiagnostics() {
  const fs = useStoreDiagnostics((s) => s.fs);
  const scan = useStoreDiagnostics((s) => s.scan);
  const records = useStoreDiagnostics((s) => s.records);
  const projects = useStoreDiagnostics((s) => s.projects);
  const followed = useStoreDiagnostics((s) => s.followed);
  const gitDirectory = useGitDiagnostics((s) => s.directory);
  const rows = useMemo(() => rowsOf(records), [records]);

  useEffect(() => useStoreDiagnostics.getState().connect(), []);

  const followedRecord = followed ? records[followed.appSessionId] : undefined;
  return (
    <section aria-label="Store" className="flex w-full min-w-0 flex-col rounded-sm border border-border">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-border px-3 py-2">
        <output aria-label="store" className="font-mono">
          {describeStore(fs)}
        </output>
        <output aria-label="store scan" className="font-mono">
          {describeScan(scan, projects?.length ?? null)}
        </output>
      </div>
      <ReplayDiagnostics />
      {followed && <FollowDetail followed={followed} title={followedRecord ? titleOf(followedRecord) : followed.appSessionId} />}
      <GitDiagnostics />
      <ul aria-label="Discovered sessions" className="max-h-96 overflow-auto">
        {rows.map((record) => {
          const badge = describeHolder(record.holder);
          const isFollowed = followed?.appSessionId === record.appId;
          const directory = record.worktree?.path ?? record.directory;
          const isGitShown = directory !== '' && gitDirectory === directory;
          return (
            <li key={record.appId} className="flex h-(--row-h) items-center gap-3 border-b border-border px-3 last:border-b-0">
              {record.pinned && (
                <span aria-label="pinned" className="shrink-0 font-mono text-fg">
                  pin
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-fg">{titleOf(record)}</span>
              <span className="shrink-0 font-mono text-fg-faint">{record.title.source}</span>
              <span className="min-w-0 max-w-[45%] truncate font-mono text-fg-faint">{record.directory || '—'}</span>
              {badge && <span className="shrink-0 rounded-sm bg-accent-soft px-1.5 font-mono text-fg">{badge}</span>}
              <button
                type="button"
                aria-pressed={isFollowed}
                disabled={record.engineSessionId === null}
                onClick={() => void (isFollowed ? useStoreDiagnostics.getState().unfollow() : useStoreDiagnostics.getState().follow(record.appId))}
                className="shrink-0 rounded-sm border border-border px-2 text-fg hover:bg-bg-hover aria-pressed:bg-bg-active disabled:text-fg-faint"
              >
                {isFollowed ? 'Unfollow' : 'Follow'}
              </button>
              <button
                type="button"
                aria-pressed={isGitShown}
                disabled={directory === ''}
                onClick={() => void useGitDiagnostics.getState().select(isGitShown ? null : directory)}
                className="shrink-0 rounded-sm border border-border px-2 text-fg hover:bg-bg-hover aria-pressed:bg-bg-active disabled:text-fg-faint"
              >
                Git
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function FollowDetail({ followed, title }: { followed: FollowView; title: string }) {
  return (
    <div aria-label="Followed session" className="flex flex-col gap-1 border-b border-border px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-fg">{title}</span>
        <output aria-label="chain" className="shrink-0 font-mono">
          {describeFollow(followed.state)}
        </output>
      </div>
      <ol aria-label="Last events" className="max-h-60 overflow-auto font-mono text-fg-faint">
        {followed.events.map((event) => (
          <li key={event.id} className="truncate">
            {describeEvent(event)}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function describeStore(fs: FsState | null): string {
  if (!fs) return 'store · …';
  return `store · ${fs.configHome} · ${fs.watching ? 'watching' : 'not watching'}`;
}

export function describeScan(scan: ScanStatus, projects: number | null): string {
  switch (scan.status) {
    case 'idle':
      return '';
    case 'running':
      return scan.progress ? `scanning ${scan.progress.scanned} / ${scan.progress.total}` : 'scanning…';
    case 'done':
      // N is the index's project list (existing directories with a session that has messages), not the host's slugs.
      return `projects ${projects ?? '…'} · sessions ${scan.result.sessions} · scan ${(scan.result.durationMs / 1000).toFixed(1)} s`;
    case 'failed':
      return `scan failed: ${scan.error}`;
  }
}
