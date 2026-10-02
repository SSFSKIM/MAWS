// Workflow runs on disk (C4 execution document, M3; pass-2 item 3; SPEC 40): a run is `<sessionId>/workflows/<runId>.json`,
// a whole-run snapshot the engine rewrites without an atomic rename (read with retry; a torn read keeps the last whole
// value), plus `subagents/workflows/<runId>/journal.jsonl`, the `launched` / `started` / `result` rows keyed by agent,
// parsed leniently (a torn or unknown line is skipped). Each snapshot's `workflowProgress` is a whole snapshot of the
// run, the same shape the wire's `workflow_progress` carries, so a followed session gets one `workflow.progress` per
// snapshot change. Read-only: files are read, never written.
import { createHash } from 'node:crypto';
import { open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionEvent } from '@shared/graph/events';
import type { EventId, SessionId, TaskId } from '@shared/graph/ids';
import type { WorkflowRun } from '@shared/ipc/schema/fs';
import { WorkflowJournalRowSchema, WorkflowSnapshotSchema, type WorkflowJournalRow, type WorkflowSnapshot } from '@shared/wire/store';
import { isMissing, noteReadable, noteUnreadable, readJsonWithRetry } from './sidecars';

const SNAPSHOT_FILE = /^(.+)\.json$/;

export class WorkflowReader {
  private readonly snapshots = new Map<string, WorkflowSnapshot>(); // last whole snapshot, by path
  private readonly journals = new Map<string, JournalCache>();
  private readonly journalWork = new Map<string, Promise<WorkflowJournalRow[]>>();

  private readJournal(path: string): Promise<WorkflowJournalRow[]> {
    const previous = this.journalWork.get(path) ?? Promise.resolve([]);
    const work = previous.catch(() => []).then(async () => {
      const cached = await readJournal(path, this.journals.get(path));
      if (cached === null) this.journals.delete(path);
      else this.journals.set(path, cached);
      return cached?.result ?? [];
    });
    this.journalWork.set(path, work);
    const release = () => { if (this.journalWork.get(path) === work) this.journalWork.delete(path); };
    void work.then(release, release);
    return work;
  }

  // Every run named by a snapshot or a journal directory, ordered by run id.
  async list(sessionDir: string): Promise<WorkflowRun[]> {
    const [snapshotFiles, journalDirs] = await Promise.all([
      entries(join(sessionDir, 'workflows')).then((list) => list.filter((e) => e.isFile()).flatMap((e) => SNAPSHOT_FILE.exec(e.name)?.[1] ?? [])),
      entries(join(sessionDir, 'subagents', 'workflows')).then((list) => list.filter((e) => e.isDirectory()).map((e) => e.name)),
    ]);
    const runIds = [...new Set([...snapshotFiles, ...journalDirs])].sort();
    return Promise.all(runIds.map((runId) => this.read(sessionDir, runId)));
  }

  async read(sessionDir: string, runId: string): Promise<WorkflowRun> {
    const [snapshot, journal] = await Promise.all([
      this.readSnapshot(join(sessionDir, 'workflows', `${runId}.json`)),
      this.readJournal(join(sessionDir, 'subagents', 'workflows', runId, 'journal.jsonl')),
    ]);
    return { runId, snapshot, journal };
  }

  private async readSnapshot(path: string): Promise<WorkflowSnapshot | null> {
    const read = await readJsonWithRetry(path, (raw) => WorkflowSnapshotSchema.parse(raw));
    if (read.status === 'unreadable') noteUnreadable(path, read.code);
    else noteReadable(path);
    if (read.status === 'ok') this.snapshots.set(path, read.value);
    else if (read.status === 'absent') this.snapshots.delete(path);
    return this.snapshots.get(path) ?? null;
  }
}

// The X1 event for one snapshot, `occurrence` counting deliveries of the same id within one follow.
export function workflowProgressEvent(sessionId: SessionId, snapshot: WorkflowSnapshot, occurrence: number): Extract<SessionEvent, { kind: 'workflow.progress' }> {
  const base = workflowProgressId(snapshot);
  return {
    id: (occurrence === 1 ? base : `${base}@${occurrence}`) as EventId,
    sessionId,
    at: snapshotTime(snapshot),
    seq: null,
    agentId: null,
    parentToolUseId: null,
    kind: 'workflow.progress',
    taskId: (snapshot.taskId ?? snapshot.runId) as TaskId,
    workflowName: snapshot.workflowName ?? null,
    progress: snapshot.workflowProgress ?? [],
  };
}

// A snapshot is rewritten in place, so its id names the progress it carries (`workflow:<runId>:<digest>`), unlike a
// record's: the same progress has the same id in any follow, and a newer one never reuses an older one's id, so a
// consumer deduplicating by id across an unfollow and a re-follow keeps no stale progress. A progress delivered again
// within one follow (A, B, A) takes the occurrence suffix of the disk-derived grammar (`@<g>`).
export function workflowProgressId(snapshot: WorkflowSnapshot): string {
  return `workflow:${snapshot.runId}:${createHash('sha256').update(progressKey(snapshot)).digest('hex').slice(0, 12)}`;
}

// What decides that a snapshot changed: its progress and status, not its whole body (a rewrite that only touches
// bookkeeping is not a new progress).
export function progressKey(snapshot: WorkflowSnapshot): string {
  return JSON.stringify([snapshot.status ?? null, snapshot.workflowProgress ?? null]);
}

function snapshotTime(snapshot: WorkflowSnapshot): string {
  if (typeof snapshot.timestamp === 'string') return snapshot.timestamp;
  if (typeof snapshot.startTime === 'number') return new Date(snapshot.startTime).toISOString();
  return new Date(0).toISOString();
}

interface JournalCache {
  ino: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  offset: number; // after the last newline; an unsealed tail is re-read when the file changes
  rows: WorkflowJournalRow[];
  result: WorkflowJournalRow[];
}

async function readJournal(path: string, cached?: JournalCache): Promise<JournalCache | null> {
  let file;
  try {
    file = await open(path, 'r');
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  try {
    const { ino, size, mtimeMs, ctimeMs } = await file.stat();
    if (cached?.ino === ino && cached.size === size && cached.mtimeMs === mtimeMs && cached.ctimeMs === ctimeMs) return cached;
    // The engine appends journals. Replacement, truncation and an in-place same-size rewrite restart the fold.
    const append = cached?.ino === ino && size > cached.size;
    const from = append ? cached.offset : 0;
    const bytes = Buffer.alloc(size - from);
    let filled = 0;
    while (filled < bytes.length) {
      const { bytesRead } = await file.read(bytes, filled, bytes.length - filled, from + filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    const end = bytes.subarray(0, filled).lastIndexOf(0x0a) + 1;
    const rows = [...(append ? cached.rows : []), ...parseJournal(bytes.subarray(0, end).toString('utf8'))];
    const tail = parseJournal(bytes.subarray(end, filled).toString('utf8'));
    return { ino, size: from + filled, mtimeMs, ctimeMs, offset: from + end, rows, result: tail.length === 0 ? rows : [...rows, ...tail] };
  } finally {
    await file.close();
  }
}

function parseJournal(text: string): WorkflowJournalRow[] {
  const rows: WorkflowJournalRow[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const row = WorkflowJournalRowSchema.safeParse(JSON.parse(line));
      if (row.success) rows.push(row.data);
    } catch {
      // a torn last line, or garbage: the engine appends, so the next read sees it whole
    }
  }
  return rows;
}

async function entries(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}
