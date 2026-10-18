// E3 M3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R4; the M3 entry): the source sheet's live query block,
// beside a query dataset's captured snapshot. It names the live query (server · tool), its permission in words (never by
// colour alone), its schedule and why it pauses, and the owner's gestures: Allow (a read grant; H checks the tool is
// read-only), Revoke, Refresh (while the dashboard is on screen) and, paused for want of a session, Start, with Open
// session for the session a card or refusal names (H's connector sheet's rules and words). It acts on the live query
// only while it is the one the sheet captured; a newer fetch or a replaced query asks for an explicit reopening, so the
// captured rows and time are never changed underneath. E3 M3 fix: a concrete refusal is said as itself, and a tool
// refused as one that may change data is not offered Allow or Refresh again in this opening (reopening tries once more;
// a change of the query's source clears the refusal in the tab). E3 panel wave (Decision Log 16): a newer fetch time with
// the same ref (identical rows refetched) is a newer fetch too, and the block says the live descriptor's committed error
// in its source label's words beside the controls, while the captured rows and time stay as captured.
import { useState, useSyncExternalStore } from 'react';
import type { QuerySource } from '../datasets';
import { utcTime } from '../states';
import { queryIdentity } from '../query'; // E3 M3 fix: the shared identity
import { LIVE_COPY as C, scheduleWords, type LiveDatasets, type LivePause, type LiveStart } from './live';

export interface LiveQueryProps {
  id: string;
  title: string;
  captured: QuerySource;
  live: LiveDatasets;
  onReopen?(id: string): void;
}

const startWords = (start: LiveStart): string => (start.phase === 'asking' ? C.asking : start.phase === 'starting' ? C.starting : start.phase === 'ready' ? C.ready : start.phase === 'card' || start.phase === 'refused' ? start.words : '');

export function LiveQuery({ id, title, captured, live, onReopen }: LiveQueryProps) {
  const snapshot = useSyncExternalStore(live.subscribe, live.snapshot);
  const status = snapshot.queries.get(id);
  // E3 M3 fix: a not-read-only refusal standing when this opening began is tried once more; one met in it stands
  const [refusedBefore] = useState(() => status?.pause === 'mayWrite');
  const [tried, setTried] = useState(false);
  const reopen = onReopen && (() => onReopen(id));
  if (!status || status.identity !== queryIdentity(captured)) {
    return (
      <section className="dash-sheet-live" role="group" aria-label={C.heading}>
        <p className="dash-sheet-note">{C.replaced}</p>
        {reopen && (
          <div className="dash-sheet-live-actions">
            <button type="button" className="doc-tool" onClick={reopen}>
              {C.showCurrent}
            </button>
          </div>
        )}
      </section>
    );
  }
  const name = `${status.server} · ${status.tool}`;
  const changed = status.pause === 'allowChanged';
  const permission = changed ? C.changed : status.permission === 'read' ? C.allowedRead : status.permission === 'none' ? C.notAllowed : C.checking;
  // why it pauses: no session first (a grant refused for want of one too), then a concrete refusal, then how to allow it;
  // the permission line says a changed or lost grant itself
  const concrete = status.pause === 'noRoute' || status.pause === 'mayWrite' || status.pause === 'failed' || status.pause === 'watchLimit';
  const detail: LivePause | null = concrete ? status.pause : status.permission === 'none' ? 'notAllowed' : null;
  const mayWrite = status.pause === 'mayWrite' && (!refusedBefore || tried); // refused in this opening
  const busy = status.busy !== null;
  const { start } = snapshot;
  const starting = start.phase === 'asking' || start.phase === 'starting';
  const opens = (start.phase === 'card' || start.phase === 'refused') && start.appSessionId !== null ? start.appSessionId : null;
  // E3 panel: a newer fetch time is new provenance even when identical rows kept the ref
  const newer = status.snapshot !== null && (captured.snapshot === null || status.snapshot.ref !== captured.snapshot.ref || status.snapshot.at > captured.snapshot.at) ? status.snapshot : null;
  return (
    <section className="dash-sheet-live" role="group" aria-label={C.heading}>
      <h3 className="dash-sheet-live-heading">{C.heading}</h3>
      <p className="dash-sheet-live-tool" title={name}>
        {name}
      </p>
      <p className="dash-sheet-live-state">
        <span>{permission}</span>
        <span>{scheduleWords(status.schedule)}</span>
      </p>
      {status.error !== null && <p className="dash-sheet-note">{status.error}</p> /* E3 panel: the live descriptor's committed error */}
      {detail && <p className="dash-sheet-note">{C.detail[detail]}</p>}
      {!snapshot.shown && <p className="dash-sheet-note">{C.hidden}</p>}
      {newer && (
        <p className="dash-sheet-note">
          {C.newer(utcTime(newer.at))}{' '}
          {reopen && (
            <button type="button" className="doc-tool" onClick={reopen}>
              {C.showLatest}
            </button>
          )}
        </p>
      )}
      <div className="dash-sheet-live-actions">
        {(status.permission !== 'read' || changed) && !mayWrite && (
          <button
            type="button"
            className="doc-tool"
            disabled={busy || status.permission === 'unknown'}
            aria-label={changed ? C.allowAgainLabel(name) : C.allowLabel(name)}
            onClick={() => {
              setTried(true);
              void live.grant(id);
            }}
          >
            {changed ? C.allowAgain : C.allow}
          </button>
        )}
        {status.permission === 'read' && (
          <button type="button" className="doc-tool" disabled={busy} aria-label={C.revokeLabel(name)} onClick={() => void live.revoke(id)}>
            {C.revoke}
          </button>
        )}
        <button type="button" className="doc-tool" disabled={busy || !snapshot.shown || status.permission === 'none' || changed || mayWrite} aria-label={C.refreshLabel(title)} onClick={() => void live.refresh(id)}>
          {C.refresh}
        </button>
        {status.pause === 'noRoute' && (
          <button type="button" className="doc-tool" disabled={starting} onClick={() => void live.start()}>
            {C.start}
          </button>
        )}
        {status.pause === 'noRoute' && opens !== null && (
          <button type="button" className="doc-tool" onClick={() => live.openSession(opens)}>
            {C.openSession}
          </button>
        )}
      </div>
      <p className="dash-sheet-status" role="status">
        {status.busy === 'refresh' ? C.refreshing : status.pause === 'noRoute' ? startWords(start) : ''}
      </p>
    </section>
  );
}
