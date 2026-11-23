// P2-A (2026-10-09; the execution document §5.6, §10 Q7, acceptance 6): the one line every surface shows where the owner's
// gesture would start a session with no ready process: the widget frame's Load now or Refresh, Session info's and the
// context popover's Refresh, and `/plugins`' loaded list. What it says comes from the session: the quiet spinner named
// "Starting…" in the button's place while an acquisition or a launch runs (the word cut, P523); the words when it cannot start (a terminal or a job holding it, an archive, no record) or
// the last attempt was refused; and in place of the button, for a terminal or a job holding it, the existing holder
// actions (Attach, Fork, Take over: `HolderActions`), so its facts stay read-only with the way to take it. Rendering it
// starts nothing; only its button does.
import type { ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { Icon } from '../app/IconButton';
import { HolderActions } from '../sessions/HolderActions';
import { NamedGlyph } from '../ui/glyph';
import { QuietSpinner } from '../ui/spinner';
import { availabilityIn, availabilityRefusal } from '../sessions/availability';
import { useSessions } from '../stores/sessions';
import { FRAME } from './copy';
import { TextButton } from './parts';
import { loadForRead, useDormant } from './read';

// The square glyph button at the line's text size (GLYPH_BUTTON's look, a step smaller).
const REFRESH_GLYPH = 'inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2';

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
  glyph?: boolean; // the button as the circular arrow, the label its name and tooltip (the word cut, P522: a dialog's Refresh)
  lead?: ReactNode; // what the surface knows, before the state ("5 minutes ago", "as of …")
  words?: string | null; // the surface's own words for why it cannot start, when it has them; else the session's
  onGesture?: () => void; // the gesture; by default an acquisition for a read (`loadForRead`)
  busy?: boolean; // the surface's own gesture is running
  starting?: boolean; // the surface knows a start is running (its read's state), beside the session's own
}

export function DormantGesture({ appSessionId, label, glyph = false, lead, words, onGesture, busy = false, starting: startingHere = false }: DormantGestureProps) {
  const dormant = useDormant(appSessionId);
  const holder = useForeignHolder(appSessionId);
  const startable = useStartable(appSessionId);
  const starting = startingHere || dormant?.state === 'starting';
  const said = starting ? null : (words ?? dormant?.words ?? null);
  const act = onGesture ?? (() => void loadForRead(appSessionId).catch(() => undefined)); // the words come through the session's state
  return (
    <div data-dormant-gesture className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-sm text-fg-muted">
      {lead !== undefined && lead !== null && <span className="min-w-0">{lead}</span>}
      {starting && <QuietSpinner label={FRAME.starting} />}
      {said !== null && (
        <span role="status" className="min-w-0">
          {said}
        </span>
      )}
      {holder !== null ? (
        <HolderActions appSessionId={appSessionId} holder={holder} />
      ) : (
        startable &&
        !starting &&
        (glyph ? (
          // a named glyph is never `disabled`; a press while the surface's own gesture runs does nothing
          <NamedGlyph label={label} aria-busy={busy || undefined} onClick={() => !busy && act()} className={REFRESH_GLYPH}>
            <Icon className="size-3.5">
              <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" />
            </Icon>
          </NamedGlyph>
        ) : (
          <TextButton onClick={act} disabled={busy}>
            {label}
          </TextButton>
        ))
      )}
    </div>
  );
}
