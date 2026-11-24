// Tail-first (2026-11-24; docs/doperpowers/plans/2026-10-30-long-transcript-window.md, Residue 5 and its Decision Log): a
// session opened from its transcript answers its newest window from the end of the file while the read from the start
// runs behind it. A long transcript's newest window needs about the last 1% of the file (79 turns in the last 5.5 MiB of
// a 636 MiB one), and the read from the start took 3 s before it could answer. The tail is read as the follow reads the
// whole file (a quiet `Follow` from the first line in it, its offsets and ids the file's own), on a ladder of rungs (8,
// then 32, then 128 MiB) until the tail holds what its answer needs (`accept`: the window's own test, Follow.tailWindow,
// or a live launch's seam); a tail that never does answers nothing, and the read from the start answers as before.
// Before the window is taken, the `Agent` tool uses the tail maps read their children's metas from the agents written
// since the earliest of them (`recent`), not from a listing of every agent the session ever started.
import type { SubagentEntry } from '@shared/ipc/schema/fs';
import type { SubagentLookup } from './backfill';
import type { FileReader } from './chain-follower';
import type { Follow } from './follow';

const MIB = 1024 * 1024;
export const TAIL_RUNGS: readonly number[] = [8 * MIB, 32 * MIB, 128 * MIB];
// An agent's transcript is written from its start on, after the tool use that started it, whose time is the parent
// record's: this much before the earliest tool use the tail asked about is read too, for a clock that moved.
export const AGENT_SLACK_MS = 5 * 60_000;
const SEEK_BYTES = 64 * 1024; // the reads that look for the tail's first line

export interface TailAgents {
  listed(): readonly SubagentEntry[]; // the session's listing as held now (none while it is first read)
  recent(sinceMs: number): Promise<SubagentEntry[]>; // the agents written since (SubagentReader.recent)
  lookup(agents: readonly SubagentEntry[]): SubagentLookup;
}

export interface TailRead<T> {
  reader: FileReader; // the transcript, through a reader of its own
  follow(reader: FileReader, startAt: number, subagents: SubagentLookup): Follow; // a quiet follow from `startAt`
  agents: TailAgents | null;
  // What the tail answers once read: a value, or null when this rung cannot tell (the next one is read)
  accept(follow: Follow): { value: T } | null | Promise<{ value: T } | null>;
  live(): boolean; // false: nothing more is read (the service stopped)
  rungs?: readonly number[];
}

// The first answer a rung of the ladder accepts; null when none does, or the file is no longer than a rung (the read
// from the start is then as quick), or it changed under the read.
export async function readTail<T>(read: TailRead<T>): Promise<{ value: T } | null> {
  const stat = await read.reader.stat();
  if (stat === null) return null;
  const reader = new FrozenReader(read.reader, stat);
  for (const rung of read.rungs ?? TAIL_RUNGS) {
    if (!read.live() || stat.size <= rung) return null;
    const startAt = await lineStart(reader, stat.size - rung, stat.size);
    if (startAt === null) continue; // one line longer than the rung
    const follow = await mapTail(read, reader, startAt);
    try {
      if (reader.changed || !read.live()) return null;
      const accepted = await read.accept(follow);
      if (accepted !== null) return accepted;
    } finally {
      follow.stop();
    }
  }
  return null;
}

// The tail from `startAt`, mapped once with the listing held now; and again when an `Agent` tool use in it found no
// meta there and the agents written since that tool use hold one.
async function mapTail<T>(read: TailRead<T>, reader: FileReader, startAt: number): Promise<Follow> {
  const asked = new Set<string>();
  const counting = (agents: readonly SubagentEntry[]): SubagentLookup => {
    const inner = read.agents?.lookup(agents) ?? null;
    return {
      byToolUseId(toolUseId) {
        const child = inner?.byToolUseId(toolUseId) ?? null;
        if (child === null) asked.add(toolUseId);
        return child;
      },
    };
  };
  const listed = read.agents?.listed() ?? [];
  const follow = read.follow(reader, startAt, counting(listed));
  await follow.started;
  if (read.agents === null || asked.size === 0 || !read.live()) return follow;
  let since = Infinity;
  for (const event of follow.log) if (event.kind === 'tool.use' && asked.has(event.toolUseId)) since = Math.min(since, Date.parse(event.at));
  if (!Number.isFinite(since)) return follow;
  const recent = await read.agents.recent(since - AGENT_SLACK_MS);
  const found = read.agents.lookup(recent);
  if (![...asked].some((toolUseId) => found.byToolUseId(toolUseId) !== null)) return follow;
  follow.stop();
  const again = read.follow(reader, startAt, read.agents.lookup([...recent, ...listed]));
  await again.started;
  return again;
}

// The transcript as it stood when the tail was taken: its size held there, so the tail reads what the read from the
// start reads first and never what was appended after. A file replaced or cut short meanwhile is no tail of it
// (`changed`: the tail answers nothing).
class FrozenReader implements FileReader {
  changed = false;

  constructor(
    private readonly inner: FileReader,
    private readonly at: { ino: number; size: number },
  ) {}

  get path(): string | undefined {
    return this.inner.path;
  }

  async stat(): Promise<{ ino: number; size: number } | null> {
    const now = await this.inner.stat();
    if (now === null || now.ino !== this.at.ino || now.size < this.at.size) this.changed = true;
    return this.at;
  }

  read(offset: number, length: number): Promise<Buffer> {
    return this.inner.read(offset, length);
  }
}

// The first line's start after `from`: the byte after the first newline at or past it; null when none is before `size`.
async function lineStart(reader: FileReader, from: number, size: number): Promise<number | null> {
  for (let at = from; at < size; at += SEEK_BYTES) {
    const chunk = await reader.read(at, Math.min(SEEK_BYTES, size - at));
    if (chunk.length === 0) return null;
    const newline = chunk.indexOf(0x0a);
    if (newline !== -1) return at + newline + 1 < size ? at + newline + 1 : null;
  }
  return null;
}
