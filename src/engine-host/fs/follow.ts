// Following one transcript (C4 execution document, M3; residue *Tail strategy*): the `fs` `FileReader` the chain
// follower reads through, and `Follow`, which wires one `ChainFollower` to the host's events — its batches go out as
// `session.eventBatch` for the app session, its states as `fs.followState` — and keeps the delivery log the snapshot
// command answers from. A followed session is poked by the watcher and by the service's reconcile timer.
// The history is held, not broadcast (docs/doperpowers/plans/2026-10-30-long-transcript-window.md): what the backfill
// delivers stays in the log until the follow first reaches `following`, and then only its newest window goes out as
// batches; what is appended after goes out as it comes. Every answer is a window of the log (`page`), so no answer and
// no burst carries a long session's whole history over the host's one ordered socket. A quiet follow (a session a live
// process writes, read only for its older pages) emits nothing at all.
// Read-only: files are opened with flag 'r' only, one open per stat or read, and every size and inode comes from
// `fstat` on the opened handle; no descriptor is held between reads, so a rename-over or a relocation shows as an inode
// change at the next poke.
import { open, type FileHandle } from 'node:fs/promises';
import type { SessionEvent } from '@shared/graph/events';
import { eventBytes, HISTORY_WINDOW_BUDGET, historyWindowStart, soughtIn, type HistorySought, type WindowBudget } from '@shared/graph/history-window';
import type { AgentId, AppSessionId, EventId, MessageUuid, ParentToolUseId, SessionId } from '@shared/graph/ids';
import { HostCommandError, type HostEmit } from '@shared/host/runtime';
import type { SubagentLookup } from './backfill';
import { ChainFollower, type ChainFollowerOptions, type FileReader, type FollowState } from './chain-follower';
import { isMissing } from './sidecars';

// How long a read waits for a fresh follower's backfill before answering: long enough that a transcript of up to a few
// hundred MB answers its window at once (a 625 MB one reads through in 1.7 s on an M-series Mac), well inside the
// host protocol's 10 s deadline. A backfill still running answers an empty page; its window then arrives as
// `session.eventBatch`.
export const SNAPSHOT_WAIT_MS = 2_000;
const BATCH_EVENTS = 500; // session.eventBatch's bound (its schema's max)

export class FsFileReader implements FileReader {
  // The inode the follower last stat'ed: a read whose opened handle is another file answers no bytes, so the rename-over
  // race (stat of the old file, read of its replacement) becomes a reload at the next poke, never the new file's bytes
  // under the old file's cursor.
  private expectedIno: number | null = null;

  // `locate` answers the transcript's current path, or null while the service has not seen it (a session launched by
  // MAWS before its first record): the follower then waits in `following` with an empty chain.
  constructor(private readonly locate: () => string | null) {}

  get path(): string {
    return this.locate() ?? '';
  }

  async stat(): Promise<{ ino: number; size: number } | null> {
    const file = await this.open();
    if (file === null) return null;
    try {
      const info = await file.stat();
      this.expectedIno = info.ino;
      return { ino: info.ino, size: info.size };
    } finally {
      await file.close();
    }
  }

  async read(offset: number, length: number): Promise<Buffer> {
    const file = await this.open();
    if (file === null) return Buffer.alloc(0);
    try {
      const info = await file.stat();
      if (this.expectedIno !== null && info.ino !== this.expectedIno) return Buffer.alloc(0);
      const buffer = Buffer.alloc(length);
      let filled = 0;
      while (filled < length) {
        const { bytesRead } = await file.read(buffer, filled, length - filled, offset + filled);
        if (bytesRead === 0) break;
        filled += bytesRead;
      }
      return filled === length ? buffer : buffer.subarray(0, filled);
    } finally {
      await file.close();
    }
  }

  // The located file opened for reading, or null when there is none (not located, or not there).
  private async open(): Promise<FileHandle | null> {
    const path = this.locate();
    if (path === null) return null;
    try {
      return await open(path, 'r');
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }
}

export interface FollowOptions {
  appSessionId: AppSessionId;
  sessionId: SessionId;
  agent: { agentId: AgentId; parentToolUseId: ParentToolUseId | null } | null;
  reader: FileReader;
  isOwnRecord?: ChainFollowerOptions['isOwnRecord'];
  subagents?: SubagentLookup;
  holders?: () => number; // the session's live holders now, for the terminal-rewind rule
  pinned?: () => boolean; // W7: a foreign process holds the session now (MAWS's branch stays in view)
  emit: HostEmit;
  quiet?: boolean; // emits neither batches nor states: a live session's history, read for its older pages
  window?: WindowBudget; // tests' smaller pages; absent, HISTORY_WINDOW_BUDGET
}

// What a read asks of the log: the page before `before` (an event id an earlier page started at), the first `limit`
// events, or the slice that concerns one agent; none of them, the newest window. `seek` names a message a jump looks for:
// the page then says where it stands to it (`sought`), so a jump walks back only to a message that is there.
export interface HistoryRequest {
  before?: EventId | null;
  limit?: number | null;
  agentId?: AgentId | null;
  seek?: MessageUuid | null;
}

export interface HistoryPage {
  events: SessionEvent[];
  complete: boolean; // the follow has read its transcript through (its backfill is done)
  earlier?: EventId; // older history remains: the cursor that asks for the page before this one
  sought?: HistorySought; // where the page stands to the message `seek` named
}

// A cursor the log does not hold: the follow was started again since the page that named it (a rebind, a release).
export const UNKNOWN_CURSOR = 'unknown history cursor';

// The events of one agent and its parent's reports on it (its start, finish and notifications, by task id) with the
// parent's own exits: what a child's view reads of its parent, whatever the parent's history holds besides. The
// reports and the exits are the child's lifecycle, from which its view decides whether it runs, so they are never cut:
// a cap that dropped the start would make a running child read as disk-backed. Only the agent's own other events are
// capped, the newest within `hard` (null: none, for a live stream's page, which its ring and journal already bound).
export function agentSlice(events: readonly SessionEvent[], agentId: AgentId, hard: number | null = HISTORY_WINDOW_BUDGET.hard): SessionEvent[] {
  const slice: SessionEvent[] = [];
  let bytes = 0;
  let full = false;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    const lifecycle = ('taskId' in event && (event.taskId as string | null) === (agentId as string)) || (event.kind === 'process.exited' && event.agentId === null);
    if (!lifecycle) {
      if (full || event.agentId !== agentId) continue;
      bytes += eventBytes(event);
      full = hard !== null && bytes > hard;
      if (full) continue;
    }
    slice.push(event);
  }
  return slice.reverse();
}

export class Follow {
  readonly appSessionId: AppSessionId;
  readonly agentId: AgentId | null;
  readonly started: Promise<void>; // the backfill: resolves once the follower first reports following (or an error)
  private readonly follower: ChainFollower;
  private readonly delivered: SessionEvent[] = []; // every event delivered for this follow, in order: every page's source
  private readonly positions = new Map<EventId, number>(); // each delivered event's index (a cursor's place)
  private readonly sizes: number[] = []; // each delivered event's bytes, measured when a window first reads it
  private readonly budget: WindowBudget;
  private phase: FollowState = 'backfilling';
  private backfilled = false; // first reached `following`: the log is history, and the follow emits from now on
  private stopped = false;

  constructor(private readonly options: FollowOptions) {
    this.appSessionId = options.appSessionId;
    this.agentId = options.agent?.agentId ?? null;
    this.budget = options.window ?? HISTORY_WINDOW_BUDGET;
    this.follower = new ChainFollower(
      options.reader,
      options.sessionId,
      options.agent,
      (event) => {
        if (this.stopped) return;
        switch (event.t) {
          case 'events':
            this.send(event.events);
            return;
          case 'state':
            this.phase = event.state;
            // The backfill is done: its newest window goes out, once, before the state that says so.
            if (event.state === 'following' && !this.backfilled) {
              this.backfilled = true;
              if (!options.quiet) this.emitBatches(this.delivered.slice(this.windowStart(this.delivered.length)));
            }
            if (options.quiet) return;
            options.emit('fs.followState', {
              appSessionId: this.appSessionId,
              agentId: this.agentId,
              state: event.state,
              chainLength: event.chainLength,
              leafUuid: event.leafUuid,
              gap: event.gap,
              skippedLines: event.skippedLines,
              message: event.message,
            });
            return;
          case 'facts':
            return; // the watcher's re-summary carries head and tail facts to main
        }
      },
      { subagents: options.subagents, holders: options.holders, pinned: options.pinned, isOwnRecord: options.isOwnRecord },
    );
    this.started = this.follower.start();
  }

  poke(): Promise<void> {
    return this.follower.poke();
  }

  // W7: the contest ended; a branch held back while it lasted is folded in (ChainFollower.refold).
  refold(): Promise<void> {
    return this.follower.refold();
  }

  // Events the follow carries beside the transcript's own (a workflow run's progress snapshot), delivered and logged
  // like the follower's.
  deliver(events: SessionEvent[]): void {
    if (!this.stopped && events.length > 0) this.send(events);
  }

  // A read of the log. Until the backfill is done it holds no history yet: an empty page, never a partial one (the
  // oldest records, which a later window would land after), and a page asked before a cursor names the same cursor.
  snapshot(request: HistoryRequest = {}): HistoryPage {
    const complete = this.phase === 'following';
    const before = request.before ?? null;
    if (!this.backfilled) return { events: [], complete: false, ...(before !== null && { earlier: before }) };
    if (request.agentId) return { events: agentSlice(this.delivered, request.agentId, this.budget.hard), complete };
    if (before === null && request.limit != null) return { events: this.firstEvents(request.limit), complete };
    const end = before === null ? this.delivered.length : this.positions.get(before);
    if (end === undefined) throw new HostCommandError({ code: 'invalid_input', message: `${UNKNOWN_CURSOR}: ${before}` });
    const start = this.windowStart(end);
    const sought = request.seek ? soughtIn(this.delivered, request.seek, start, end) : null;
    return { events: this.delivered.slice(start, end), complete, ...(start > 0 && { earlier: this.delivered[start]!.id }), ...(sought && { sought }) };
  }

  get backfillDone(): boolean {
    return this.backfilled;
  }

  get state(): FollowState {
    return this.phase;
  }

  // `message` goes out with the `stopped` state (FOLLOW_RELEASED for a release).
  stop(message: string | null = null): void {
    if (this.stopped) return;
    this.follower.stop(message); // reports `stopped` through the sink before the gate closes
    this.stopped = true;
    this.delivered.length = 0;
    this.positions.clear();
    this.sizes.length = 0;
  }

  private send(events: SessionEvent[]): void {
    for (const event of events) {
      this.positions.set(event.id, this.delivered.length);
      this.delivered.push(event);
    }
    if (this.backfilled && !this.options.quiet) this.emitBatches(events);
  }

  private emitBatches(events: SessionEvent[]): void {
    for (let i = 0; i < events.length; i += BATCH_EVENTS) this.options.emit('session.eventBatch', { appSessionId: this.appSessionId, events: events.slice(i, i + BATCH_EVENTS) });
  }

  private sizeOf = (index: number): number => (this.sizes[index] ??= eventBytes(this.delivered[index]!));

  private windowStart(end: number): number {
    return historyWindowStart(this.delivered, end, this.sizeOf, this.budget);
  }

  // The first `limit` events, as a live stream's first page is, within the hard cap.
  private firstEvents(limit: number): SessionEvent[] {
    let bytes = 0;
    let end = 0;
    while (end < this.delivered.length && end < limit) {
      bytes += this.sizeOf(end);
      if (bytes > this.budget.hard) break;
      end += 1;
    }
    return this.delivered.slice(0, end);
  }
}
