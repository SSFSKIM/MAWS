// P5 O2 M2: what background work a process holds beyond its task list, as far as the engine host can read it
// (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M2 and Interfaces "The work state"; P5 §2's strict release and
// Decision Log 46). Pure: the status tracker (session-status.ts) feeds it and reads it into the status's `work`;
// budget.ts counts it as work.
//
// Three parts. The tasks are known from every `background_tasks_changed`, a level signal, except on an adopted process
// until one arrives. The session-only crons have no stream signal: they are read from the Stop hook callback's
// `session_crons` (SPEC 27-hooks §3.2 item 10: always present, `[]` when there are none), which the engine host
// registers on every launch (host-hooks.ts). Between two Stops a cron tool (CronCreate, CronDelete, ScheduleWakeup)
// makes the last list stale, so a turn that ran one and ended without a Stop (an interrupt, an API error) leaves the
// crons unknown until the next Stop. A fresh launch, or a resume after a release (the process table's released set),
// starts known and empty; any other resume starts unknown until the first Stop, since `--resume` resurrects a
// session-only cron and it can fire before that Stop (the Stop-hook probe, question 4); an adopted process (O16's)
// starts unknown in both parts. The durable crons, which no Stop lists, are read from the project's scheduled-tasks
// file (durable-crons.ts) at each Stop and at a resume's launch; a file that exists but cannot be read is unknown.
// Unknown is work, conservatively. P5 Decision Log 49 bounds the resume's unknown: the engine host keeps each session's
// cron record in its state file (`cronRecord`, written at each Stop and each cron tool), and a resume that does not
// follow a release starts known and empty when the record shows no listed session cron and no cron tool since its Stop;
// a record that is missing or unreadable keeps the unknown.
// O16 M5 (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, Interfaces §F): three more reasons the reap reads, each
// work until it clears: `observer_unhealthy`, while an observer seen on the process is silent or gone (holder design
// §3.2 step 1); `reap_term_ignored`, after an idle reap's end_session and SIGTERM were both ignored, until the next Stop;
// `descendants_unreadable`, while the process tree under the engine cannot be read.
import type { CronRecord } from '@shared/engine/session-state-store';

export type LaunchKind = 'fresh' | 'resumed_after_release' | 'resumed' | 'adopted';
export interface SessionCron { id: string; schedule: string; recurring: boolean; prompt: string }
export type CronRead = SessionCron[] | 'unreadable';
export const CRON_TOOLS: ReadonlySet<string> = new Set(['CronCreate', 'CronDelete', 'ScheduleWakeup']);
export interface Work { crons: SessionCron[]; unknown: string | null } // unknown null: known

type Crons = { state: 'known' | 'dirty'; list: SessionCron[] } | { state: 'unknown'; why: string; list: SessionCron[] };
const copy = (crons: readonly SessionCron[]): SessionCron[] => crons.map((c) => ({ ...c }));

export class WorkState {
  private crons: Crons; // the session-only crons, from the Stops
  private durable: CronRead = []; // the durable crons, from the scheduled-tasks file
  private tasksUnknown: string | null;
  private stopSeen = false; // the turn under way had its Stop
  // O16 M5: the reap's three
  private observerUnhealthy = false;
  private reapTermIgnored = false;
  private descendantsUnreadable = false;

  constructor(kind: LaunchKind) {
    this.crons = kind === 'fresh' || kind === 'resumed_after_release' ? { state: 'known', list: [] } : { state: 'unknown', why: kind, list: [] };
    this.tasksUnknown = kind === 'adopted' ? 'adopted' : null;
  }

  tasksChanged(): void {
    this.tasksUnknown = null;
  }

  cronTool(): void {
    if (this.crons.state !== 'unknown') this.crons = { state: 'dirty', list: this.crons.list };
  }

  // A `resumed` launch's state-file record (P5 Decision Log 49), before its first Stop: clean, it starts known and empty.
  resumedWith(record: CronRecord | null): void {
    const clean = record !== null && !record.toolSinceStop && record.sessionCrons.length === 0;
    if (clean && this.crons.state === 'unknown' && this.crons.why === 'resumed') this.crons = { state: 'known', list: [] };
  }

  // P5 O16 (D32, D38): an adopted process's seed, before the journal's fold applies what came after it: the state file's
  // cron record (no cron tool since its Stop: the listed crons are known, empty or not; a tool since, or no record:
  // unknown until the next Stop) and the task list the journal last held (`unknown` after a gap, until a snapshot).
  adoptedWith(record: CronRecord | null, tasks: readonly unknown[] | 'unknown'): void {
    if (this.crons.state !== 'unknown' || this.crons.why !== 'adopted') return;
    if (record !== null && !record.toolSinceStop) this.crons = { state: 'known', list: copy(record.sessionCrons) };
    if (tasks !== 'unknown') this.tasksUnknown = null;
  }

  // What the state file keeps, written at each Stop and each cron tool.
  cronRecord(): CronRecord {
    return { sessionCrons: copy(this.crons.list), toolSinceStop: this.crons.state !== 'known' };
  }

  turnStarted(): void {
    this.stopSeen = false;
  }

  // A Stop: its `session_crons`, and the scheduled-tasks file read at it.
  stopped(session: CronRead, durable: CronRead): void {
    this.stopSeen = true;
    this.reapTermIgnored = false; // O16 M5: the engine took a turn to its end after the ignored reap
    this.crons = session === 'unreadable' ? { state: 'unknown', why: 'stop_unreadable', list: [] } : { state: 'known', list: copy(session) };
    this.durableRead(durable);
  }

  // The scheduled-tasks file read on its own: at a resume's launch.
  durableRead(durable: CronRead): void {
    this.durable = durable === 'unreadable' ? durable : copy(durable);
  }

  turnEnded(): void {
    if (this.crons.state === 'dirty' && !this.stopSeen) this.crons = { state: 'unknown', why: 'turn_ended_without_stop', list: this.crons.list };
  }

  // O16 M5 start: the gate's observer, the reap's ignored signal and the process tree's read
  observer(unhealthy: boolean): void {
    this.observerUnhealthy = unhealthy;
  }

  termIgnored(): void {
    this.reapTermIgnored = true;
  }

  descendantsRead(readable: boolean): void {
    this.descendantsUnreadable = !readable;
  }
  // O16 M5 end

  snapshot(): Work {
    const crons = [...copy(this.crons.list), ...(this.durable === 'unreadable' ? [] : copy(this.durable))];
    const unknown = this.crons.state === 'unknown' ? this.crons.why
      : this.crons.state === 'dirty' ? 'dirty'
      : this.durable === 'unreadable' ? 'durable_unreadable'
      : this.tasksUnknown
        ?? (this.observerUnhealthy ? 'observer_unhealthy' : this.reapTermIgnored ? 'reap_term_ignored' : this.descendantsUnreadable ? 'descendants_unreadable' : null); // O16 M5
    return { crons, unknown };
  }
}

// The Stop input's `session_crons`, read leniently: an entry of the wrong shape is dropped (and `drop` told why), an
// entry's fields beyond the four are left out, and an input whose `session_crons` is not an array is unreadable.
export function sessionCronsOf(input: Record<string, unknown>, drop: (line: string) => void): CronRead {
  const entries = input.session_crons;
  if (!Array.isArray(entries)) return 'unreadable';
  const crons: SessionCron[] = [];
  for (const entry of entries as unknown[]) {
    const e = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    if (typeof e.id === 'string' && typeof e.schedule === 'string' && typeof e.recurring === 'boolean' && typeof e.prompt === 'string') crons.push({ id: e.id, schedule: e.schedule, recurring: e.recurring, prompt: e.prompt });
    else drop(`a Stop's session_crons entry of the wrong shape was dropped: ${JSON.stringify(entry)?.slice(0, 200)}`);
  }
  return crons;
}
