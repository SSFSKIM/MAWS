// The loaded line (P2-B execution document §5.6; P2-A's G2, its `/plugins` half): one line under the library's head
// about this session, MAWS's own (Desktop's library shows no runtime state). How many plugins the engine loaded and how
// fresh that is, from A's observed facts (`useLoadedPlugins`: "Loaded now" from a ready process that reported them,
// "Loaded last time, 2 days ago" from the last report, "Not observed yet" when there is none), then what the session's
// availability allows: the reloads on a ready process; otherwise A's line every surface shows (`DormantGesture`):
// Refresh (acquire, then `reload_plugins`), "Starting…" while it or a launch runs, a refusal in words, the holder's
// actions for a session held elsewhere, an archive's words with no Refresh. "Starting…" stays until Refresh's outcome is
// in, so a process that turns ready mid-Refresh shows the reloads only then; a reload that fails after the start says so
// on the line. The count and the problems open Show › "Loaded in this session". Nothing here acquires on mount or on a
// timer, only on Refresh's click.
import { useState, type ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { Availability } from '@shared/ipc/schema/session';
import type { AcquireOutcome } from '@shared/sessions/setup';
import { useNow } from '../../app/use-now';
import { FRESHNESS, type LoadedPlugins, type PluginsReload } from '../../sessions/observed';
import { useSessions } from '../../stores/sessions';
import { LIBRARY as L } from '../copy';
import { DormantGesture } from '../DormantGesture';
import { ReloadControls, type Reloads } from './reload';

// What `/plugins` reads of the session's plugins: A's `useLoadedPlugins(appSessionId)`.
export type SessionPlugins = LoadedPlugins & { refresh(): Promise<AcquireOutcome>; reload: PluginsReload };

export interface LoadedLineProps {
  appSessionId: AppSessionId;
  availability: Availability | null;
  loaded: SessionPlugins;
  reloads: Reloads | null; // on a ready process
  onShowLoaded(): void;
  now?: number;
}

export interface RefreshClick {
  pending: boolean;
  run(): void;
}

// Refresh's click (A's `refresh`: acquire, then `reload_plugins`), pending while it runs. Its refusal is said by A's
// line (`DormantGesture` reads the session's last Load now or Refresh); a reload that failed after the start, by A's
// `reload`. The loaded line and the detail's "Not loaded in this session" offer it; nothing calls it but a click.
export function useRefresh(refresh: () => Promise<AcquireOutcome>): RefreshClick {
  const [pending, setPending] = useState(false);
  const run = () => {
    setPending(true);
    void refresh()
      .catch(() => undefined) // a thrown acquisition's words come through the session's state too (`loadForRead`)
      .finally(() => setPending(false));
  };
  return { pending, run };
}

// What a surface draws where Refresh goes: its own reloads on a ready process (`ready`), else A's line.
export function RefreshGesture({ appSessionId, availability, refresh, ready }: { appSessionId: AppSessionId; availability: Availability | null; refresh: RefreshClick; ready: ReactNode }) {
  const directory = useSessions((s) => s.records.get(appSessionId)?.directory ?? '');
  if (availability === 'usable' && !refresh.pending) return ready;
  // a missing directory is main's memory of the last attempt (A §5.2); the next may succeed, so Refresh stays offered
  const words = availability === 'missing_directory' ? L.missingDirectory(directory) : null;
  return <DormantGesture appSessionId={appSessionId} label={L.refresh} onGesture={refresh.run} busy={refresh.pending} starting={refresh.pending} words={words} />;
}

export function LoadedLine({ appSessionId, availability, loaded, reloads, onShowLoaded, now: fixed }: LoadedLineProps) {
  const clock = useNow();
  const now = fixed ?? clock;
  const refresh = useRefresh(loaded.refresh);
  const { freshness, reload } = loaded;
  const problems = loaded.errors.length + loaded.warnings.length;
  const reloadLine = reloads?.line ? null : reload.line; // Refresh's own reload, until a reload from the line says more

  return (
    <div data-plugins-loaded data-loaded-freshness={freshness.kind} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-2 pb-2 text-ui-sm text-fg-muted">
      {freshness.kind === 'unknown' ? (
        <span>{FRESHNESS.notObserved}</span>
      ) : (
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1">
          <button type="button" onClick={onShowLoaded} className="rounded-sm text-fg outline-accent hover:underline focus-visible:outline-2">
            {L.loadedCount(loaded.plugins.length)}
          </button>
          <span aria-hidden>·</span>
          <span>{freshness.kind === 'now' ? FRESHNESS.loadedNow : FRESHNESS.loadedLast(freshness.at, now)}</span>
          {problems > 0 && (
            <>
              <span aria-hidden>·</span>
              <button type="button" onClick={onShowLoaded} className="rounded-sm text-warning outline-accent hover:underline focus-visible:outline-2">
                {L.problems(problems)}
              </button>
            </>
          )}
        </span>
      )}
      <span className="ml-auto flex min-w-0 flex-wrap items-center gap-2 [&>[data-dormant-gesture]]:mb-0">
        <RefreshGesture appSessionId={appSessionId} availability={availability} refresh={refresh} ready={reloads && <ReloadControls reloads={reloads} />} />
      </span>
      {reloadLine !== null && (
        <span role={reload.failed ? 'alert' : 'status'} data-loaded-reload={reload.failed ? 'failed' : ''} className={`basis-full [overflow-wrap:anywhere] ${reload.failed ? 'text-danger' : ''}`}>
          {reloadLine}
        </span>
      )}
    </div>
  );
}
