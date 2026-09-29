// The replay runner (C4 execution document, Interfaces "Replay engine"; X8): plays one recorded source into the event
// graph under a run's fresh ids, paced by the clock. A journal's `in` and `out` rows go through the row normaliser (C3's
// `Normalizer`, which needs the `out` control requests to close its request table), each frame's `session_id` rewritten
// to the run's id first; a transcript's chain goes through C4's backfill mapping. Events leave through `emit` in
// batches of at most REPLAY_BATCH events, one batch per turn of the event loop: at a speed one row's events (a row with
// more spreads over turns, due with that row), in `'instant'` as many rows as fill a batch (a row crossing the boundary
// leaves its remainder for the next turn); only a row whose mapping throws flushes what was gathered at once, in as
// many batches as it takes, before the run ends in `error`. Every event sent is kept as the run's materialised list
// for the snapshot command. Progress is reported every PROGRESS_EVERY rows and on every state or speed change; the
// first report follows the start by a turn of the event loop, so it never precedes the launch's answer.
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { ReplayProgress, Speed } from '@shared/ipc/schema/session';
import type { JournalRow } from '@shared/wire/journal';
import { currentChain, type TranscriptRecord } from '@shared/wire/transcript';
import { createBackfillContext, recordToEvents, type SubagentLookup } from '../backfill';
import type { ReplayClock } from './clock';

// Satisfied by C3's `Normalizer` (src/engine-host/normalizer.ts: pure JournalRow → SessionEvent[]).
export interface RowNormalizer {
  normalize(row: JournalRow): SessionEvent[];
}

export const REPLAY_BATCH = 500; // events per session.eventBatch (C3's cap)
export const PROGRESS_EVERY = 25; // rows

export type ReplayState = ReplayProgress['state'];

export interface ReplayRunnerDeps {
  appSessionId: AppSessionId;
  sessionId: SessionId;
  clock: ReplayClock;
  emit: (events: SessionEvent[]) => void;
  progress: (progress: ReplayProgress) => void;
}

// One row (journal) or chain record (transcript): its recorded time, and the events it stands for, mapped when played.
interface Unit {
  at: number;
  iso: string | null;
  events: () => SessionEvent[];
}

export class ReplayRunner {
  private phase: ReplayState | 'pending' = 'pending';
  private units: Unit[] = [];
  private index = 0;
  private lastIso: string | null = null;
  private message: string | null = null;
  private readonly events: SessionEvent[] = [];
  private carry: SessionEvent[] = []; // a boundary-crossing row's events beyond the last batch, for the next turn
  private finish: () => void = () => {};

  constructor(private readonly deps: ReplayRunnerDeps) {}

  get state(): ReplayState | 'pending' {
    return this.phase;
  }

  // Every event delivered so far, in order: what the snapshot command answers for the run.
  materialized(): SessionEvent[] {
    return [...this.events];
  }

  runJournal(rows: JournalRow[], normalizer: RowNormalizer): Promise<void> {
    const units = rows
      .filter((row) => row.direction === 'in' || row.direction === 'out')
      .map((row): Unit => ({ at: Date.parse(row.at), iso: row.at, events: () => normalizer.normalize({ ...row, frame: withSessionId(row.frame, this.deps.sessionId) }) }));
    return this.play(units);
  }

  // `subagents` is the source's sibling sidecar listing (`<dir>/<sessionId>/subagents/`), so `Agent` tool uses map to
  // subagent.started/finished exactly as the transcript's backfill maps them; null for a transcript without one.
  runTranscript(records: TranscriptRecord[], subagents: SubagentLookup | null): Promise<void> {
    const ctx = createBackfillContext({ sessionId: this.deps.sessionId, agent: null, subagents: subagents ?? undefined });
    let iso: string | null = null;
    const units = currentChain(records).chain.map((record): Unit => {
      if (typeof record.timestamp === 'string' && !Number.isNaN(Date.parse(record.timestamp))) iso = record.timestamp;
      const rewritten = withSessionId(record, this.deps.sessionId);
      return { at: iso === null ? 0 : Date.parse(iso), iso, events: () => recordToEvents(rewritten, ctx) };
    });
    return this.play(units);
  }

  control(action?: 'pause' | 'resume' | 'stop', speed?: Speed): void {
    const { clock } = this.deps;
    if (action === 'stop') {
      if (this.phase === 'stopped') return;
      clock.stop();
      this.end('stopped');
      return;
    }
    if (this.phase !== 'running' && this.phase !== 'paused') return;
    let changed = false;
    if (action === 'pause' && this.phase === 'running') {
      clock.pause();
      this.phase = 'paused';
      changed = true;
    } else if (action === 'resume' && this.phase === 'paused') {
      clock.resume();
      this.phase = 'running';
      changed = true;
    }
    if (changed) this.report();
    if (speed !== undefined && speed !== clock.speed) {
      clock.setSpeed(speed);
      this.report();
    }
  }

  private play(units: Unit[]): Promise<void> {
    this.units = units;
    return new Promise<void>((resolve) => {
      this.finish = resolve;
      if (this.phase === 'stopped') return resolve();
      setImmediate(() => {
        if (this.phase !== 'pending') return;
        this.phase = 'running';
        this.report();
        this.next();
      });
    });
  }

  private next(): void {
    if (this.phase !== 'running' && this.phase !== 'paused') return;
    if (this.index >= this.units.length && this.carry.length === 0) {
      this.end('done');
      return;
    }
    // A carried remainder goes out on the next turn, due with the row it came from.
    const at = this.carry.length > 0 ? this.units[this.index - 1].at : this.units[this.index].at;
    this.deps.clock.schedule(at, () => this.step());
  }

  // One batch per turn: at a speed, one row's events; at 'instant', rows until REPLAY_BATCH events have gathered. A
  // row whose events cross the boundary leaves the rest in `carry`, which the next turn sends first.
  private step(): void {
    const instant = this.deps.clock.speed === 'instant';
    const batch = this.carry;
    this.carry = [];
    const carried = batch.length > 0;
    let played = false;
    while (this.index < this.units.length && (instant ? batch.length < REPLAY_BATCH : !carried && !played)) {
      const unit = this.units[this.index];
      try {
        batch.push(...unit.events());
      } catch (error) {
        this.send(batch);
        this.message = error instanceof Error ? error.message : String(error);
        this.deps.clock.stop();
        this.end('error');
        return;
      }
      played = true;
      this.index += 1;
      this.lastIso = unit.iso;
      if (this.index % PROGRESS_EVERY === 0 && this.index < this.units.length) this.report();
    }
    this.carry = batch.slice(REPLAY_BATCH);
    this.send(batch.slice(0, REPLAY_BATCH));
    this.next();
  }

  // At most one batch on the normal path; the error path flushes what it holds in batches.
  private send(events: SessionEvent[]): void {
    for (let i = 0; i < events.length; i += REPLAY_BATCH) {
      const batch = events.slice(i, i + REPLAY_BATCH);
      this.events.push(...batch);
      this.deps.emit(batch);
    }
  }

  private end(state: 'done' | 'stopped' | 'error'): void {
    this.phase = state;
    this.report();
    this.finish();
  }

  private report(): void {
    const state = this.phase === 'pending' ? 'running' : this.phase;
    this.deps.progress({
      appSessionId: this.deps.appSessionId,
      state,
      index: this.index,
      total: this.units.length,
      at: this.lastIso,
      speed: this.deps.clock.speed,
      message: state === 'error' ? this.message : null,
    });
  }
}

// A frame's or record's session id, rewritten to the run's before it leaves the source, so two replays of one fixture
// never share an id (top-level `session_id` and `sessionId`, where present).
export function withSessionId<T>(value: T, sessionId: SessionId): T {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const copy = { ...value } as Record<string, unknown>;
  if ('session_id' in copy) copy.session_id = sessionId;
  if ('sessionId' in copy) copy.sessionId = sessionId;
  return copy as T;
}
