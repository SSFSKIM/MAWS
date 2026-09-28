// Following one transcript (C4 execution document, M3; residue *Tail strategy*): the `fs` `FileReader` the chain
// follower reads through, and `Follow`, which wires one `ChainFollower` to the host's events — its batches go out as
// `session.eventBatch` for the app session, its states as `fs.followState` — and keeps the delivery log the snapshot
// command answers from. A followed session is poked by the watcher and by the service's reconcile timer.
// Read-only: files are opened with flag 'r' only, one open per stat or read, and every size and inode comes from
// `fstat` on the opened handle; no descriptor is held between reads, so a rename-over or a relocation shows as an inode
// change at the next poke.
import { open, type FileHandle } from 'node:fs/promises';
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, AppSessionId, ParentToolUseId, SessionId } from '@shared/graph/ids';
import type { HostEmit } from '@shared/host/runtime';
import type { SubagentLookup } from './backfill';
import { ChainFollower, type FileReader, type FollowState } from './chain-follower';
import { isMissing } from './sidecars';

// How long a snapshot request waits for a fresh follower's backfill before answering with what it has: long enough
// that a typical transcript (median 92 KB) answers complete, well inside the host protocol's 10 s deadline for the
// largest (an 84 MB backfill takes seconds; the rest arrives as `session.eventBatch`).
export const SNAPSHOT_WAIT_MS = 2_000;

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
  subagents?: SubagentLookup;
  emit: HostEmit;
}

export class Follow {
  readonly appSessionId: AppSessionId;
  readonly agentId: AgentId | null;
  readonly started: Promise<void>; // the backfill: resolves once the follower first reports following (or an error)
  private readonly follower: ChainFollower;
  private readonly delivered: SessionEvent[] = []; // every event sent for this follow, in order: the snapshot's source
  private phase: FollowState = 'backfilling';
  private stopped = false;

  constructor(private readonly options: FollowOptions) {
    this.appSessionId = options.appSessionId;
    this.agentId = options.agent?.agentId ?? null;
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
      { subagents: options.subagents },
    );
    this.started = this.follower.start();
  }

  poke(): Promise<void> {
    return this.follower.poke();
  }

  // Events the follow carries beside the transcript's own (a workflow run's progress snapshot), delivered and logged
  // like the follower's.
  deliver(events: SessionEvent[]): void {
    if (!this.stopped && events.length > 0) this.send(events);
  }

  snapshot(): { events: SessionEvent[]; complete: boolean } {
    return { events: [...this.delivered], complete: this.phase === 'following' };
  }

  get state(): FollowState {
    return this.phase;
  }

  stop(): void {
    if (this.stopped) return;
    this.follower.stop(); // reports `stopped` through the sink before the gate closes
    this.stopped = true;
    this.delivered.length = 0;
  }

  private send(events: SessionEvent[]): void {
    this.delivered.push(...events);
    this.options.emit('session.eventBatch', { appSessionId: this.appSessionId, events });
  }
}
