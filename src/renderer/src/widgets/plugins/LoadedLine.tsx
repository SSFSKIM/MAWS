// The loaded line (P2-B execution document §5.6; P2-A's G2, its `/plugins` half): one line under the library's head
// about this session, MAWS's own (Desktop's library shows no runtime state). How many plugins the engine loaded and how
// fresh that is ("Loaded now", "Loaded last time, 2 days ago", none when a list comes with no time to say, "Not observed
// yet" when there is nothing), then what the session's availability allows: "Starting…" while Refresh (acquire, then
// `reload_plugins`) or a launch runs, before all else, so a process that turns ready mid-Refresh shows the reloads only
// once Refresh's outcome is in; the reloads on a ready process; Refresh, and its refusal in words; the holder's actions
// for a session held elsewhere; the words for an archived session or a missing directory. The count and the problems open Show › "Loaded in this session". Nothing
// here acquires on mount or on a timer, only on Refresh's click.
import { useState, type ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { useNow } from '../../app/use-now';
import { HolderActions } from '../../sessions/HolderActions';
import { useSessions } from '../../stores/sessions';
import { LIBRARY as L } from '../copy';
import { TextButton } from '../parts';
import { acquisitionWords, ARCHIVED, cardWords, FRESHNESS, type AcquireOutcome, type Availability, type LoadedPlugins } from './loaded';
import { ReloadControls, type Reloads } from './reload';

export interface LoadedLineProps {
  appSessionId: AppSessionId;
  availability: Availability | null;
  loaded: LoadedPlugins;
  refresh: (() => Promise<AcquireOutcome>) | null; // A's `useLoadedPlugins().refresh`; null until A's M3
  reloads: Reloads | null; // on a ready process
  onShowLoaded(): void;
  now?: number;
}

const refusalOf = (outcome: AcquireOutcome): string | null =>
  outcome.status === 'needs_trust' || outcome.status === 'relay_unreachable' ? cardWords(outcome) : acquisitionWords(outcome);

export function LoadedLine({ appSessionId, availability, loaded, refresh, reloads, onShowLoaded, now: fixed }: LoadedLineProps) {
  const clock = useNow();
  const now = fixed ?? clock;
  const record = useSessions((s) => s.records.get(appSessionId) ?? null);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const { freshness } = loaded;
  const problems = loaded.errors.length + loaded.warnings.length;
  // a list with unknown freshness is a status's last report (A's stand-in); with nothing in it, nothing was observed
  const observed = freshness.kind !== 'unknown' || loaded.plugins.length > 0 || problems > 0;

  const run = async () => {
    if (!refresh) return;
    setPending(true);
    setRefusal(null);
    try {
      const outcome = await refresh();
      setRefusal(outcome.status === 'ready' ? null : refusalOf(outcome));
    } catch (error) {
      setRefusal(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };

  let action: ReactNode = null;
  const holder = record?.holder;
  if (pending || availability === 'starting') action = <span role="status">{L.starting}</span>;
  else if (availability === 'usable') action = reloads && <ReloadControls reloads={reloads} />;
  else if (availability === 'foreign_held' && holder && (holder.kind === 'terminal' || holder.kind === 'background_job')) action = <HolderActions appSessionId={appSessionId} holder={holder} />;
  else if (availability === 'archived') action = <span>{ARCHIVED}</span>;
  else if (availability === 'missing_directory') action = <span>{L.missingDirectory(record?.directory ?? '')}</span>;
  else if (refresh) action = <TextButton onClick={() => void run()}>{L.refresh}</TextButton>;

  return (
    <div data-plugins-loaded className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-2 pb-2 text-ui-sm text-fg-muted">
      {!observed ? (
        <span>{FRESHNESS.notObserved}</span>
      ) : (
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1">
          <button type="button" onClick={onShowLoaded} className="rounded-sm text-fg outline-accent hover:underline focus-visible:outline-2">
            {L.loadedCount(loaded.plugins.length)}
          </button>
          {freshness.kind !== 'unknown' && (
            <>
              <span aria-hidden>·</span>
              <span>{freshness.kind === 'now' ? FRESHNESS.loadedNow : FRESHNESS.loadedLast(freshness.at, now)}</span>
            </>
          )}
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
      {action && <span className="ml-auto flex min-w-0 flex-wrap items-center gap-2">{action}</span>}
      {refusal !== null && (
        <span role="alert" className="basis-full text-danger [overflow-wrap:anywhere]">
          {refusal}
        </span>
      )}
    </div>
  );
}
