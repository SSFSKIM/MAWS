// Background work's Scheduled section (E7 execution document, Design §7; G5; Decision Log 10, 11): the jobs the engine
// holds for the session, durable first (the project's `scheduled_tasks.json`, `scheduled-file.ts`) then session-only
// (the transcript's `CronCreate` pairs on its activity, so a disk-only session and one resumed list them alike). A row:
// the schedule, its kind and store, the prompt's first line, its next run (MAWS's cron match from now, the engine's
// jitter in the tooltip) or, for a session-only job of a session not running here, that it resumes with the session;
// its expiry; and `Open creating turn` when this transcript holds the call, which jumps the transcript to its cell. The
// section is omitted with nothing to list and nothing to say. Read-only: MAWS never writes the file or asks for a job.
import { useMemo } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { useTranscriptStore } from '../../../transcript';
import { cellId } from '../../../transcript/model/keys';
import { SCHEDULED_COPY } from '../copy';
import { formatAgo, formatIn } from '../model/elapsed';
import { createdCrons, scheduledRows, sessionCrons, type ScheduledRow } from '../model/scheduled';
import { SLOW_TICK_MS, useTicker } from '../subagents/shared';
import { Group, type BackgroundSection } from './Group';
import { useScheduledFile } from './scheduled-file';
import { ACTION } from './TaskRows';

const DAY_MS = 24 * 60 * 60 * 1000;
const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const WEEKDAY_TIME = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const DATE_TIME = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const DATE = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

// A next run in local time: the time alone today, with the weekday within a week, else with the date.
function localTime(at: number, now: number): string {
  if (sameDay(at, now)) return TIME.format(at);
  return at - now < 6 * DAY_MS ? WEEKDAY_TIME.format(at) : DATE_TIME.format(at);
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
  const activity = useTranscriptStore((s) => s.activity(appSessionId));
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
    if (row.link) useTranscriptStore.getState().jumpTo(appSessionId, cellId.tool(row.link.toolUseId), { align: 'center', turnId: row.link.turnId });
  };
  return (
    <Group id="scheduled" heading={SCHEDULED_COPY.heading(rows.length)} expanded={expanded} onToggle={onToggle}>
      {error !== null && <p className="px-3.5 pb-1 text-ui-sm text-danger">{SCHEDULED_COPY.unavailable(error)}</p>}
      <ul className="flex flex-col">
        {rows.map((row, i) => (
          // the index too: a hand-authored durable file may repeat an id (the engine loads any string, SPEC 22 §22.5)
          <ScheduledItem key={`${i}:${row.store}:${row.id}`} row={row} now={now} onOpen={open} />
        ))}
      </ul>
    </Group>
  );
}

function ScheduledItem({ row, now, onOpen }: { row: ScheduledRow; now: number; onOpen: (row: ScheduledRow) => void }) {
  const kind = `${row.recurring ? SCHEDULED_COPY.recurring : SCHEDULED_COPY.oneShot} · ${SCHEDULED_COPY.store[row.store]}`;
  const after = [
    row.expiresAt !== null && (row.expiresAt > now ? SCHEDULED_COPY.expires(DATE.format(row.expiresAt)) : SCHEDULED_COPY.expired(DATE.format(row.expiresAt))),
    row.lastFiredAt !== null && SCHEDULED_COPY.lastRan(formatAgo(now - row.lastFiredAt)),
  ].filter((part): part is string => part !== false);
  return (
    <li data-scheduled={row.id} data-store={row.store} className={`mx-3 flex flex-col gap-0.5 rounded-sm px-2 py-1.5 text-ui-sm ${row.dormant ? 'text-fg-faint' : 'text-fg'}`}>
      {/* the schedule keeps the first line with the link; its kind and store go under it with the prompt, so a narrow
          panel truncates the prompt, never the schedule to a letter */}
      <div className="flex min-h-6 items-center gap-2">
        <span data-part="schedule" title={row.schedule} className="min-w-0 flex-1 truncate">
          {row.schedule}
        </span>
        {row.link !== null && (
          <button type="button" onClick={() => onOpen(row)} className={`shrink-0 ${ACTION}`}>
            {SCHEDULED_COPY.openTurn}
          </button>
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
        {row.dormant ? (
          SCHEDULED_COPY.dormant
        ) : row.next === null ? (
          SCHEDULED_COPY.nextUnknown
        ) : (
          <span title={SCHEDULED_COPY.jitter}>{SCHEDULED_COPY.next(localTime(row.next, now), formatIn(row.next - now))}</span>
        )}
        {after.map((part) => ` · ${part}`).join('')}
      </p>
    </li>
  );
}
