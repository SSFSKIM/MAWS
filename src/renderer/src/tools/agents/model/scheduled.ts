// A session's scheduled jobs (E7 execution document, Design §7; G5; Decision Log 9 as refined by 23, 10, 11, 15, 26,
// 27): the session-only jobs its transcript created (`CronCreate` pairs on the activity, which sees backfill and live
// across launches, so a job made before a resume is listed as the engine resurrects it), and the durable jobs of its
// project's `.claude/scheduled_tasks.json`, which the file alone decides. Each job's next run is MAWS's own cron match
// (`src/shared/engine/cron.ts`, the engine's code restated); the engine's fire jitter is the view's tooltip, never
// modelled. The fire rule as M0 found it: a live fire puts no frame naming the job on the wire and the disk's fire
// record names no job, so a session-only job carries no last-fire fact; a one-shot whose first match after its
// creation is before now has fired or was missed, and the engine deletes it either way; a durable job's `lastFiredAt`
// is the file's. Pure.
import type { ToolUseId } from '@shared/graph/ids';
import { cronExpiry, nextCronMatch, parseCron } from '@shared/engine/cron';
import type { TurnActivity } from '../../../transcript/model/activity';
import type { TurnId } from '../../../transcript/model/rows';

// One job a successful `CronCreate` of this transcript made.
export interface CronJob {
  id: string;
  cron: string;
  prompt: string;
  recurring: boolean;
  durable: boolean;
  humanSchedule: string;
  createdAt: number; // the call's time (the engine stamps `Date.now()` as it runs the call)
  toolUseId: ToolUseId;
  turnId: TurnId;
  lastFiredAt: null; // no observable fire names a session-only job (Decision Log 23)
}

// One job of the durable file, read as the engine loads it (SPEC 22 §22.5).
export interface DurableJob {
  id: string;
  cron: string;
  prompt: string;
  createdAt: number;
  lastFiredAt: number | null;
  recurring: boolean;
  permanent: boolean;
  createdBySessionId: string | null;
}

type CronActivity = Pick<TurnActivity, 'turnId' | 'crons'>;

// Every job the transcript's creates made and no later successful delete removed, in creation order, durable ones
// included (their row comes from the file; this names the call that created them). A delete still waiting for its
// result has removed nothing yet.
export function createdCrons(activity: readonly CronActivity[]): CronJob[] {
  const jobs = new Map<string, CronJob>();
  for (const turn of activity) {
    for (const { toolUseId, at, call, result } of turn.crons) {
      if (result === null || !result.ok) continue;
      if (call.kind === 'delete') {
        jobs.delete(call.id);
        continue;
      }
      if (!('id' in result)) continue;
      jobs.delete(result.id); // a re-used id lists where it was last created
      jobs.set(result.id, {
        id: result.id, cron: call.cron, prompt: call.prompt, recurring: call.recurring, durable: result.durable, humanSchedule: result.humanSchedule,
        createdAt: Date.parse(at), toolUseId, turnId: turn.turnId, lastFiredAt: null,
      });
    }
  }
  return [...jobs.values()];
}

// A one-shot's one fire: the first match after its creation (the engine's anchor); null when the cron never matches.
function oneShotFire(cron: string, createdAt: number): number | null {
  const parsed = parseCron(cron);
  return parsed === null ? null : nextCronMatch(parsed, createdAt);
}

// Whether a one-shot is spent: its fire time is before now (fired, or missed and deleted on the next load, §22.8).
function spent(job: { recurring: boolean; cron: string; createdAt: number }, now: number): boolean {
  if (job.recurring) return false;
  const fire = oneShotFire(job.cron, job.createdAt);
  return fire !== null && fire < now;
}

// The session-only jobs the engine holds (or resurrects on resume, §22.5): created, not deleted, not expired (a
// recurring job past seven days), not spent (a one-shot past its fire).
export function sessionCrons(activity: readonly CronActivity[], now: number): CronJob[] {
  return createdCrons(activity).filter((job) => !job.durable && !(job.recurring && cronExpiry(job.createdAt) < now) && !spent(job, now));
}

// The durable file's text as the engine loads it: anything but an object with a `tasks` array is no jobs; an entry
// without a string `id`, `cron`, `prompt` and a numeric `createdAt` is skipped; optional fields are kept only when
// they have their type. Text that is not JSON is an error with the parser's message.
export function parseScheduledFile(text: string): { ok: true; jobs: DurableJob[] } | { ok: false; message: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  const tasks = typeof value === 'object' && value !== null && Array.isArray((value as { tasks?: unknown }).tasks) ? (value as { tasks: unknown[] }).tasks : [];
  const jobs: DurableJob[] = [];
  for (const entry of tasks) {
    if (typeof entry !== 'object' || entry === null) continue;
    const t = entry as Record<string, unknown>;
    if (typeof t.id !== 'string' || typeof t.cron !== 'string' || typeof t.prompt !== 'string' || typeof t.createdAt !== 'number') continue;
    jobs.push({
      id: t.id, cron: t.cron, prompt: t.prompt, createdAt: t.createdAt,
      lastFiredAt: typeof t.lastFiredAt === 'number' ? t.lastFiredAt : null,
      recurring: t.recurring === true,
      permanent: t.permanent === true,
      createdBySessionId: typeof t.createdBySessionId === 'string' ? t.createdBySessionId : null,
    });
  }
  return { ok: true, jobs };
}

// Where the engine keeps a project's durable jobs: `<projectRoot>/.claude/scheduled_tasks.json`, the project root the
// session runs in (its worktree when it has one).
export function projectRootOf(record: { directory: string; worktree: { path: string } | null }): string {
  return record.worktree?.path ?? record.directory;
}
export const SCHEDULED_DIR = '.claude';
export const SCHEDULED_FILE = 'scheduled_tasks.json';

export type ScheduledStore = 'durable-this' | 'durable-other' | 'session';

export interface ScheduledRow {
  id: string;
  schedule: string; // the create result's words when this transcript made the job, else the cron itself
  recurring: boolean;
  store: ScheduledStore;
  prompt: string; // its first line, cut to PROMPT_COLUMNS
  next: number | null; // the next match; null when the cron does not parse or never matches
  expiresAt: number | null; // a recurring job that is not permanent
  lastFiredAt: number | null;
  link: { toolUseId: ToolUseId; turnId: TurnId } | null; // the creating call, when this transcript holds it
  dormant: boolean; // a session-only job of a session not running here: it resumes with the session
}

export const PROMPT_COLUMNS = 80; // the TUI's cut

export function promptLine(prompt: string): string {
  const first = prompt.split('\n', 1)[0]!.trimEnd();
  const chars = Array.from(first);
  return chars.length > PROMPT_COLUMNS ? `${chars.slice(0, PROMPT_COLUMNS - 1).join('')}…` : first;
}

function nextRun(cron: string, recurring: boolean, createdAt: number, now: number): number | null {
  if (!recurring) return oneShotFire(cron, createdAt);
  const parsed = parseCron(cron);
  return parsed === null ? null : nextCronMatch(parsed, now);
}

export interface ScheduledInput {
  created: readonly CronJob[]; // createdCrons(activity)
  session: readonly CronJob[]; // sessionCrons(activity, now)
  durable: readonly DurableJob[] | null; // null while the file is unread or unreadable: no durable rows
  engineSessionId: string | null; // the record's: whose durable jobs are this session's own
  live: boolean;
  now: number;
}

// The rows, durable first then session-only, each in creation order. A spent durable one-shot is left out as a
// session-only one is (the engine fires and deletes it, or surfaces it as missed and deletes it on its next load).
export function scheduledRows({ created, session, durable, engineSessionId, live, now }: ScheduledInput): ScheduledRow[] {
  const byId = new Map(created.map((job) => [job.id, job]));
  const durableRows = (durable ?? [])
    .filter((job) => !spent(job, now))
    .map((job): ScheduledRow => {
      const made = byId.get(job.id);
      const own = made?.durable === true ? made : undefined;
      return {
        id: job.id, schedule: own?.humanSchedule ?? job.cron, recurring: job.recurring,
        store: engineSessionId !== null && job.createdBySessionId === engineSessionId ? 'durable-this' : 'durable-other',
        prompt: promptLine(job.prompt), next: nextRun(job.cron, job.recurring, job.createdAt, now),
        expiresAt: job.recurring && !job.permanent ? cronExpiry(job.createdAt) : null, lastFiredAt: job.lastFiredAt,
        link: own ? { toolUseId: own.toolUseId, turnId: own.turnId } : null, dormant: false,
      };
    });
  const sessionRows = session.map(
    (job): ScheduledRow => ({
      id: job.id, schedule: job.humanSchedule, recurring: job.recurring, store: 'session', prompt: promptLine(job.prompt),
      next: nextRun(job.cron, job.recurring, job.createdAt, now), expiresAt: job.recurring ? cronExpiry(job.createdAt) : null, lastFiredAt: null,
      link: { toolUseId: job.toolUseId, turnId: job.turnId }, dormant: !live,
    }),
  );
  return [...durableRows, ...sessionRows];
}
