// P5 O2 M2: the durable crons (P5 §2 "Idle release", Decision Log 46; the Stop-hook probe, question 4). A
// `CronCreate` with `durable: true` never appears in a Stop's `session_crons`: the engine persists it in the project's
// `.claude/scheduled_tasks.json` (SPEC 22 "Durable store": `{ tasks: ScheduledTask[] }`, written by an atomic rename) and
// fires it by itself, after a `--resume` too. So the work state (work-state.ts) also reads that file, at each Stop and at
// a resume's launch, and counts the jobs whose `createdBySessionId` is any engine session id the app session has had: a
// `/clear` moves a live process to a new id, and its jobs keep the old one. The lineage is kept in the session's state
// file, from the launch's own id and every id its frames carry.
//
// The read is the engine's loader, leniently: no file is no jobs; a file that exists but cannot be read or parsed, or
// holds no task list, is unreadable (work, conservatively); an entry the engine's loader would skip (no string id, cron
// or prompt, no numeric createdAt) is dropped with a log line. A job with no creator is no session's.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CronRead, SessionCron } from './work-state';

export const scheduledTasksPath = (dir: string): string => join(dir, '.claude', 'scheduled_tasks.json');

// The file's text, or null when it does not exist; throws when it exists and cannot be read.
export type ReadTextFile = (path: string) => string | null;

export const readTextFile: ReadTextFile = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
};

// `owns(id)`: whether a job's `createdBySessionId` is one of the session's.
export function durableCronsOf(read: ReadTextFile, dirs: readonly string[], owns: (createdBySessionId: string) => boolean, drop: (line: string) => void): CronRead {
  const crons = new Map<string, SessionCron>();
  for (const dir of new Set(dirs)) {
    let tasks: unknown;
    try {
      const text = read(scheduledTasksPath(dir));
      if (text === null) continue;
      tasks = (JSON.parse(text) as { tasks?: unknown } | null)?.tasks;
    } catch (error) {
      drop(`the scheduled-tasks file in ${dir} could not be read: ${error instanceof Error ? error.message : String(error)}`);
      return 'unreadable';
    }
    if (!Array.isArray(tasks)) {
      drop(`the scheduled-tasks file in ${dir} holds no task list`);
      return 'unreadable';
    }
    for (const task of tasks as unknown[]) {
      const t = (typeof task === 'object' && task !== null ? task : {}) as Record<string, unknown>;
      if (typeof t.id !== 'string' || typeof t.cron !== 'string' || typeof t.prompt !== 'string' || typeof t.createdAt !== 'number') {
        drop(`a scheduled task of the wrong shape was dropped: ${JSON.stringify(task)?.slice(0, 200)}`);
        continue;
      }
      if (typeof t.createdBySessionId === 'string' && owns(t.createdBySessionId) && !crons.has(t.id)) crons.set(t.id, { id: t.id, schedule: t.cron, recurring: t.recurring === true, prompt: t.prompt });
    }
  }
  return [...crons.values()];
}

export interface DurableCronSourceOptions {
  engineSessionId: string; // the launch's own: the resumed id, or the one it pinned
  dirs: () => string[]; // the project directories the engine may write the file in
  loadLineage: () => Promise<string[]>; // the ids the state file holds
  saveLineage: (ids: string[]) => void; // a tracked store write, which logs its own failure
  read?: ReadTextFile;
  log: (line: string) => void;
}

// One launch's reader: its lineage (loaded with the session's state, then grown by `note`) and the file read on it. A
// lineage that did not load is never saved, so a passing read failure cannot overwrite the ids the file holds, and it
// fails closed: while it is unavailable, a job some other id created may be the session's (an id before a `/clear`), so
// a file holding one reads as unreadable; a file with no such job still reads as it is.
export class DurableCronSource {
  private readonly lineage: Set<string>;
  private loaded = false;
  private unavailable = false; // the stored lineage could not be loaded
  private readonly readFile: ReadTextFile;

  constructor(private readonly opts: DurableCronSourceOptions) {
    this.lineage = new Set([opts.engineSessionId]);
    this.readFile = opts.read ?? readTextFile;
  }

  async load(): Promise<void> {
    let stored: string[];
    try {
      stored = await this.opts.loadLineage();
    } catch (error) {
      this.opts.log(`engine session ids not loaded: ${error instanceof Error ? error.message : String(error)}`);
      this.unavailable = true;
      return;
    }
    const unsaved = [...this.lineage].some((id) => !stored.includes(id));
    for (const id of stored) this.lineage.add(id);
    this.loaded = true;
    if (unsaved) this.opts.saveLineage([...this.lineage]);
  }

  // An engine session id one of the process's frames carried.
  note(engineSessionId: string | null): void {
    if (engineSessionId === null || this.lineage.has(engineSessionId)) return;
    this.lineage.add(engineSessionId);
    if (this.loaded) this.opts.saveLineage([...this.lineage]);
  }

  read(): CronRead {
    if (!this.unavailable) return durableCronsOf(this.readFile, this.opts.dirs(), (id) => this.lineage.has(id), this.opts.log);
    let unattributed = false;
    const crons = durableCronsOf(this.readFile, this.opts.dirs(), (id) => this.lineage.has(id) || ((unattributed = true), false), this.opts.log);
    if (!unattributed) return crons;
    this.opts.log('a scheduled task another engine session id created may be this session\'s: its lineage did not load');
    return 'unreadable';
  }
}
