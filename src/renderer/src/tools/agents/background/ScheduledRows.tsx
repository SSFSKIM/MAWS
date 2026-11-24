// Background tasks' Scheduled section (E7 execution document, Design §7; G5; Decision Log 10, 11): the jobs the engine
// holds for the session, durable first (the project's `scheduled_tasks.json`, `scheduled-file.ts`) then session-only
// (the transcript's `CronCreate` pairs on its activity, so a disk-only session and one resumed list them alike). A row:
// the schedule, its kind and store, the prompt's first line, its next run (MAWS's cron match from now, the engine's
// jitter in the tooltip) or, for a session-only job of a session not running here, that it resumes with the session;
// its expiry; and `Open creating turn` when this transcript holds the call, which jumps the transcript to its cell. The
// section is omitted with nothing to list and nothing to say. Read-only: MAWS never writes the file or asks for a job.
// The word cut (T222, T224, T226): Open creating turn is an arrow drawn on the pointed or focused row, its words its name
// and tooltip; a next run reads `14:30 · in 3m`, and a schedule MAWS cannot read leaves the next run blank.
import { useId, useMemo } from 'react';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { TurnId } from '../../../transcript/model/rows';
import type { SessionRecord } from '@shared/graph/session';
import { formatClock, formatDayTime, formatShortDate, formatWeekdayClock } from '@shared/app/date-format';
import { useTranscriptStore } from '../../../transcript';
import { cellId } from '../../../transcript/model/keys';
import { BACKGROUND_COPY, SCHEDULED_COPY } from '../copy';
import { formatAgo, formatIn } from '../model/elapsed';
import { createdCrons, cronHistoryActivity, scheduledRows, sessionCrons, type ScheduledRow } from '../model/scheduled';
import { SLOW_TICK_MS, useTicker } from '../subagents/shared';
import { Icon } from '../../../app/IconButton';
import { NamedGlyph } from '../../../ui/glyph';
import { Tip } from '../../../ui/tip';
import { HOVER_SCOPE, ON_HOVER } from '../../../ui/hover-scope';
import { Group, type BackgroundSection } from './Group';
import { useScheduledFile } from './scheduled-file';

const DAY_MS = 24 * 60 * 60 * 1000;
const NO_TURNS: readonly TurnId[] = [];
const NO_EVENTS: readonly SessionEvent[] = [];

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

// A next run in local time: the time alone today, with the weekday within a week, else with the date.
function localTime(at: number, now: number): string {
  if (sameDay(at, now)) return formatClock(at);
  return at - now < 6 * DAY_MS ? formatWeekdayClock(at) : formatDayTime(at);
}

interface Props {
  appSessionId: AppSessionId;
  session: SessionRecord | null;
  live: boolean;
  visible: boolean;
  expanded: boolean;
  onToggle: (id: BackgroundSection) => void;
}

export function ScheduledSection({ appSessionId, session, live, visible, expanded, onToggle }: Props) {
  const loaded = useTranscriptStore((s) => s.activity(appSessionId));
  // The long-transcript window: a long session's older history's cron calls, as its newest window carried them, go
  // before the loaded turns' own, so the list is the whole history's whatever is loaded.
  // A rewind the transcript took since abandons a carried turn as it would a loaded one (the turns it hides, and the
  // rewinds it holds, whose targets the store may not hold).
  const cronHistory = useTranscriptStore((s) => s.entries[appSessionId]?.cronHistory);
  const hidden = useTranscriptStore((s) => s.entries[appSessionId]?.state.hidden?.turns ?? NO_TURNS);
  const loose = useTranscriptStore((s) => s.entries[appSessionId]?.state.loose ?? NO_EVENTS);
  const activity = useMemo(() => {
    if (!cronHistory?.length) return loaded;
    const rewinds = loose.flatMap((event) => (event.kind === 'boundary.rewind' ? [event.targetMessageUuid] : []));
    return [...cronHistoryActivity(cronHistory, { hidden, rewinds }), ...loaded];
  }, [cronHistory, hidden, loose, loaded]);
  const file = useScheduledFile(appSessionId, session);
  const created = useMemo(() => createdCrons(activity), [activity]);
  const durable = file?.status === 'ok' ? file.jobs : null;
  // next runs and expiries move with the clock: the slow tick, while there is a job to time and the tool is shown
  const now = useTicker(visible && (created.length > 0 || (durable?.length ?? 0) > 0), SLOW_TICK_MS);
  const engineSessionId = session?.engineSessionId ?? null;
  const rows = useMemo(
    () => scheduledRows({ created, session: sessionCrons(activity, now), durable, engineSessionId, live, now }),
    [created, activity, durable, engineSessionId, live, now],
  );
  const error = file?.status === 'error' ? file.message : null;
  if (rows.length === 0 && error === null) return null;
  const open = (row: ScheduledRow) => {
    if (!row.link) return;
    const cell = cellId.tool(row.link.toolUseId);
    // A creating turn older than what is loaded: its pages first (a jump into history, the bar saying so)
    if (row.link.messageUuid !== null) void useTranscriptStore.getState().reachMessage(appSessionId, { messageUuid: row.link.messageUuid, cell, turnId: row.link.turnId });
    else useTranscriptStore.getState().jumpTo(appSessionId, cell, { align: 'center', turnId: row.link.turnId });
  };
  return (
    <Group id="scheduled" heading={BACKGROUND_COPY.scheduled(rows.length)} expanded={expanded} onToggle={onToggle}>
      {error !== null && <p className="px-3.5 pb-1 text-ui-sm text-danger">{SCHEDULED_COPY.unavailable(error)}</p>}
      <ul className="flex flex-col">
        {keyed(rows).map(({ row, key }) => (
          <ScheduledItem key={key} row={row} now={now} onOpen={open} />
        ))}
      </ul>
    </Group>
  );
}

// Each row's key: its store and id, and which of the rows with both it is, since a hand-authored durable file may repeat
// an id (the engine loads any string, SPEC 22 §22.5). Not its place in the list: the older history's crons a long
// session's window fills in later (tail-first) go before the rows already drawn, which keep their items.
function keyed(rows: readonly ScheduledRow[]): { row: ScheduledRow; key: string }[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const name = `${row.store}:${row.id}`;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return { row, key: `${name}:${n}` };
  });
}

function ScheduledItem({ row, now, onOpen }: { row: ScheduledRow; now: number; onOpen: (row: ScheduledRow) => void }) {
  const kind = `${row.recurring ? SCHEDULED_COPY.recurring : SCHEDULED_COPY.oneShot} · ${SCHEDULED_COPY.store[row.store]}`;
  const after = [
    row.expiresAt !== null && (row.expiresAt > now ? SCHEDULED_COPY.expires(formatShortDate(row.expiresAt, now)) : SCHEDULED_COPY.expired(formatShortDate(row.expiresAt, now))),
    row.lastFiredAt !== null && SCHEDULED_COPY.lastRan(formatAgo(now - row.lastFiredAt)),
  ].filter((part): part is string => part !== false);
  // the engine's jitter is the next run's tip, so the keyboard reaches it (the desk draws no such row: no TouchFact); its
  // description is the row's, outside the when line, so the line's text (a copy of it, a read of it) is its words
  const jitterId = useId();
  const timed = !row.dormant && row.next !== null;
  const when = row.dormant ? (
    SCHEDULED_COPY.dormant
  ) : row.next === null ? null : (
    <Tip content={SCHEDULED_COPY.jitter}>
      <span tabIndex={0} aria-describedby={jitterId} className="rounded-sm outline-accent focus-visible:outline-2">
        {SCHEDULED_COPY.next(localTime(row.next, now), formatIn(row.next - now))}
      </span>
    </Tip>
  );
  return (
    <li {...HOVER_SCOPE} data-scheduled={row.id} data-store={row.store} className={`mx-3 flex flex-col gap-0.5 rounded-sm px-2 py-1.5 text-ui-sm ${row.dormant ? 'text-fg-faint' : 'text-fg'}`}>
      {/* the schedule keeps the first line with the link; its kind and store go under it with the prompt, so a narrow
          panel truncates the prompt, never the schedule to a letter */}
      <div className="flex min-h-6 items-center gap-2">
        <span data-part="schedule" title={row.schedule} className="min-w-0 flex-1 truncate">
          {row.schedule}
        </span>
        {row.link !== null && (
          <NamedGlyph {...ON_HOVER} label={SCHEDULED_COPY.openTurn} onClick={() => onOpen(row)} className={OPEN_TURN}>
            <Icon className="size-3.5">
              <path d="M5.5 10.5l5-5M6.5 5.5h4v4" />
            </Icon>
          </NamedGlyph>
        )}
      </div>
      <p className={`flex min-w-0 gap-1.5 ${row.dormant ? '' : 'text-fg-muted'}`}>
        <span data-part="kind" className="shrink-0">
          {kind}
        </span>
        <span aria-hidden>·</span>
        <span data-part="prompt" title={row.prompt} className="min-w-0 truncate">
          {row.prompt}
        </span>
      </p>
      <p data-part="when" className={`tabular-nums ${row.dormant ? '' : 'text-fg-muted'}`}>
        {when}
        {after.map((part, i) => (when === null && i === 0 ? part : ` · ${part}`)).join('')}
      </p>
      {timed && (
        <span id={jitterId} hidden>
          {SCHEDULED_COPY.jitter}
        </span>
      )}
    </li>
  );
}

// A small square glyph at the row's right, its look the shared glyph's at the row's size.
const OPEN_TURN =
  'inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2';
