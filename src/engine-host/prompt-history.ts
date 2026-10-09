// P2-C (2026-10-09; the P2-C document, Design §6 "Restarts and reconnects", Interfaces `session.promptHistory`): the
// human's prompts' record read back from the journals the host retains (X8). Two readers share it:
// - `promptHistory`, what happened to them while main was not listening. Each retained launch is read through a fresh
//   Normalizer seeded as its live process was (the spawn row's engine session id), so the events and their ids are the
//   ones the live stream carried; only `queue.transition` and `command.lifecycle` at or after `since` are answered.
// - `unsettledPrompts`, what a launch that ended without settling its queue (the host died with it) left unstated: the
//   steers it wrote whose end no lifecycle or row recorded. The next launch's queue recovery abandons each as a row.
// The journal walker (`JournalReader.launches`) is P2-A's, shared with its X17 recovery.
import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs';
import type { PromptHistoryEvent, SessionEvent } from '@shared/graph/events';
import type { AppSessionId, MessageUuid, SessionId } from '@shared/graph/ids';
import { parseJournalRow, type JournalRow } from '@shared/wire/journal';
import { JournalReader, type LaunchFiles } from './journal';
import { Normalizer } from './normalizer';

export interface PromptHistory {
  events: PromptHistoryEvent[];
  // false when a launch from before `since` may have been pruned, a launch could not be read to its end, or the newest
  // launch ended without its exit row and is not the live one (its process's end is not on record)
  complete: boolean;
}

const isPromptHistory = (event: SessionEvent): event is PromptHistoryEvent => event.kind === 'queue.transition' || event.kind === 'command.lifecycle';

// `since` is an ISO-8601 instant; the rows' `at` is the host's clock, and a lifecycle frame carries no timestamp of its
// own, so both kinds compare on that clock. A launch whose last file was last written before `since` holds nothing at or
// after it and is not read. Complete only when the oldest retained launch began at or before `since` (pruning removes
// whole launches, oldest first), every launch read parsed to its end, and the newest launch either is `live` (the
// launch id of the process the host runs for the session now) or ended with its exit row.
export async function promptHistory(dir: string, appSessionId: AppSessionId, since: string, opts: { live?: string | null } = {}): Promise<PromptHistory> {
  const from = Date.parse(since);
  const launches = JournalReader.launches(dir);
  const newest = launches.at(-1);
  let complete = launches.length > 0 && launches[0]!.startedAt <= from && (newest!.launchId === opts.live || endsWithExit(newest!));
  const events: PromptHistoryEvent[] = [];
  for (const launch of launches) {
    if (statSync(launch.files.at(-1)!).mtimeMs < from) continue;
    const normalizer = new Normalizer({ appSessionId, launchId: launch.launchId, sessionId: spawnSessionId(launch) });
    try {
      for (const file of launch.files) {
        for await (const row of JournalReader.rows(file)) {
          for (const event of normalizer.push(row)) if (isPromptHistory(event) && Date.parse(event.at) >= from) events.push(event);
        }
      }
    } catch {
      complete = false; // a row that is not X8 (a torn or foreign line): what follows it in this launch is unknown
    }
  }
  return { events, complete };
}

// The steers the launches before `current` wrote and left unstated: each launch that ended without settling its queue
// is folded, oldest first, from the last launch that did. A launch settled when it ended with its exit row after its
// handshake (`initialize`), the point from which the session's exit settles the queue and abandons what is pending.
export async function unsettledPrompts(dir: string, current: string): Promise<MessageUuid[]> {
  const launches = JournalReader.launches(dir);
  const at = launches.findIndex((launch) => launch.launchId === current);
  const before = at < 0 ? launches : launches.slice(0, at);
  const unsettled: LaunchFiles[] = [];
  for (let i = before.length - 1; i >= 0; i -= 1) {
    const launch = before[i]!;
    if (endsWithExit(launch) && headRows(launch).some((row) => metaEvent(row) === 'initialize')) break;
    unsettled.unshift(launch);
  }
  const fold = new UnsettledFold();
  for (const launch of unsettled) {
    try {
      for (const file of launch.files) for await (const row of JournalReader.rows(file)) fold.push(row);
    } catch {
      // a torn last line (the host died mid-write): what was read is what that launch recorded
    }
  }
  return fold.unsettled();
}

// The fold over one or more launches' rows, in order. A steer is a host-written `user` frame carrying a priority (steer,
// promote, and every host sequence's prompt; a queue submission carries none, and its end is the state file's entry). It
// is settled by a lifecycle that started or dropped it, or by a row that ended it (`hold`, `cancel`, `abandon`); a drop
// while the host was withdrawing it waits for the withdrawal's outcome row, as main does (Design §6), and a `giveback`
// after such a drop settles it.
export class UnsettledFold {
  private readonly open = new Set<MessageUuid>();
  private readonly withdrawing = new Set<MessageUuid>();
  private readonly droppedWhileWithdrawing = new Set<MessageUuid>();

  push(row: JournalRow): void {
    const frame = row.frame as Record<string, unknown> | null;
    if (frame === null || typeof frame !== 'object') return;
    const uuid = (key: string) => (typeof frame[key] === 'string' ? (frame[key] as MessageUuid) : null);
    if (row.direction === 'out' && frame.type === 'user' && typeof frame.priority === 'string') {
      const written = uuid('uuid');
      if (written) this.open.add(written);
    } else if (row.direction === 'in' && frame.type === 'command_lifecycle') {
      const named = uuid('command_uuid');
      if (!named) return;
      if (frame.state === 'started' || frame.state === 'completed') this.settle(named);
      else if (frame.state === 'cancelled' || frame.state === 'discarded' || frame.state === 'refused') {
        if (this.withdrawing.has(named)) this.droppedWhileWithdrawing.add(named);
        else this.settle(named);
      }
    } else if (row.direction === 'meta' && frame.event === 'queue') {
      const named = uuid('messageUuid');
      if (!named) return;
      if (frame.action === 'withdraw') this.withdrawing.add(named);
      else if (frame.action === 'hold' || frame.action === 'cancel' || frame.action === 'abandon') this.settle(named);
      else if (frame.action === 'giveback') {
        this.withdrawing.delete(named);
        if (this.droppedWhileWithdrawing.has(named)) this.settle(named);
      }
    }
  }

  unsettled(): MessageUuid[] {
    return [...this.open];
  }

  private settle(uuid: MessageUuid): void {
    this.open.delete(uuid);
    this.withdrawing.delete(uuid);
    this.droppedWhileWithdrawing.delete(uuid);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Bounded reads of a launch's head and tail (the spawn row can be long; the exit row is short)

const HEAD_BYTES = 1024 * 1024;
const TAIL_BYTES = 64 * 1024;

function readSlice(file: string, from: 'head' | 'tail', bytes: number): string {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const length = Math.min(bytes, size);
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, from === 'head' ? 0 : size - length);
    return buffer.toString('utf8', 0, read);
  } finally {
    closeSync(fd);
  }
}

const parseLine = (line: string): JournalRow | null => {
  try {
    return parseJournalRow(JSON.parse(line));
  } catch {
    return null;
  }
};

// The complete rows at the start of a launch's first file, up to the first that does not parse.
function headRows(launch: LaunchFiles): JournalRow[] {
  const lines = readSlice(launch.files[0]!, 'head', HEAD_BYTES).split('\n').slice(0, -1);
  const rows: JournalRow[] = [];
  for (const line of lines) {
    const row = parseLine(line);
    if (row === null) break;
    rows.push(row);
  }
  return rows;
}

const metaEvent = (row: JournalRow): unknown => (row.direction === 'meta' ? (row.frame as { event?: unknown } | null)?.event : undefined);

// Whether the launch's last row is its exit row (a host that died with the process leaves none).
function endsWithExit(launch: LaunchFiles): boolean {
  const lines = readSlice(launch.files.at(-1)!, 'tail', TAIL_BYTES).split('\n').filter((line) => line.length > 0);
  const last = lines.length > 0 ? parseLine(lines.at(-1)!) : null;
  return last !== null && metaEvent(last) === 'exit';
}

// The engine session id the launch's process was planned with (its spawn row), which seeds its live normaliser.
function spawnSessionId(launch: LaunchFiles): SessionId | null {
  const spawn = headRows(launch).find((row) => metaEvent(row) === 'spawn');
  const id = (spawn?.frame as { sessionId?: unknown } | undefined)?.sessionId;
  return typeof id === 'string' && id.length > 0 ? (id as SessionId) : null;
}
