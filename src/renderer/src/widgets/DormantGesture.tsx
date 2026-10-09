// P2-A (2026-10-09; the execution document §5.6, §10 Q7, acceptance 6): the one line every surface shows where the owner's
// gesture would start a session with no ready process: the widget frame's Load now or Refresh, Session info's and the
// context popover's Refresh, and `/plugins`' loaded list. What it says comes from the session: "Starting…" while an
// acquisition or a launch runs; the words when it cannot start (a terminal or a job holding it, an archive, no record) or
// the last attempt was refused; and in place of the button, for a terminal or a job holding it, the existing holder
// actions (Attach, Fork, Take over: `HolderActions`), so its facts stay read-only with the way to take it. Rendering it
// starts nothing; only its button does.
import type { ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { HolderActions } from '../sessions/HolderActions';
import { availabilityIn, availabilityRefusal } from '../sessions/availability';
import { useSessions } from '../stores/sessions';
import { FRAME } from './copy';
import { TextButton } from './parts';
import { loadForRead, useDormant } from './read';

type ForeignHolder = Extract<SessionRecord['holder'], { kind: 'terminal' | 'background_job' }>;

// The terminal or job holding the session, while its availability says so.
function useForeignHolder(appSessionId: AppSessionId): ForeignHolder | null {
  return useSessions((s) => {
    const holder = s.records.get(appSessionId)?.holder;
    return holder && (holder.kind === 'terminal' || holder.kind === 'background_job') && availabilityIn(s, appSessionId) === 'foreign_held' ? holder : null;
  });
}

// Whether the owner's gesture may start the session (a refused attempt may be tried again; a holder, an archive or no
// record may not).
const useStartable = (appSessionId: AppSessionId): boolean => useSessions((s) => availabilityRefusal(availabilityIn(s, appSessionId), s.records.get(appSessionId)?.holder ?? null) === null);

export interface DormantGestureProps {
  appSessionId: AppSessionId;
  label: string; // the button: Load now or Refresh
  lead?: ReactNode; // what the surface knows, before the state ("Not read yet.", "Read 5 minutes ago", "Loaded last time, …")
  words?: string | null; // the surface's own words for why it cannot start, when it has them; else the session's
  onGesture?: () => void; // the gesture; by default an acquisition for a read (`loadForRead`)
  busy?: boolean; // the surface's own gesture is running
  starting?: boolean; // the surface knows a start is running (its read's state), beside the session's own
}

export function DormantGesture({ appSessionId, label, lead, words, onGesture, busy = false, starting: startingHere = false }: DormantGestureProps) {
  const dormant = useDormant(appSessionId);
  const holder = useForeignHolder(appSessionId);
  const startable = useStartable(appSessionId);
  const starting = startingHere || dormant?.state === 'starting';
  const said = starting ? null : (words ?? dormant?.words ?? null);
  const act = onGesture ?? (() => void loadForRead(appSessionId).catch(() => undefined)); // the words come through the session's state
  return (
    <div data-dormant-gesture className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-sm text-fg-muted">
      {lead !== undefined && lead !== null && <span className="min-w-0">{lead}</span>}
      {starting && <span role="status">{FRAME.starting}</span>}
      {said !== null && (
        <span role="status" className="min-w-0">
          {said}
        </span>
      )}
      {holder !== null ? (
        <HolderActions appSessionId={appSessionId} holder={holder} />
      ) : (
        startable &&
        !starting && (
          <TextButton onClick={act} disabled={busy}>
            {label}
          </TextButton>
        )
      )}
    </div>
  );
}
