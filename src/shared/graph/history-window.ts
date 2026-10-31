// The window of a transcript's history that one answer carries (docs/doperpowers/plans/2026-10-30-long-transcript-window.md):
// whole turns ending just before a cursor (or at the newest event), as many as fit a soft budget of event JSON, at
// least the newest one when it fits the hard cap, and cut at the hard cap when one turn alone passes it. A window never
// starts inside a rewind it carries: a `boundary.rewind` in it pulls its start back to the rewound turn, which the
// reducer needs on the same page to hide the abandoned branch (it hides nothing when the target is not loaded). The
// engine host cuts disk-backed `session.events` and `fs.agentEvents` answers with it; the renderer's tests cut pages
// with it too, so both sides agree on what a page is.
import * as z from 'zod';
import type { SessionEvent } from './events';
import type { MessageUuid } from './ids';

// Soft: the last 50 turns of the largest transcripts measured (600 MB of JSONL) come to about 2 MB of event JSON, so one
// window shows a long session's recent work at once; older pages are as big.
export const HISTORY_WINDOW_BYTES = 2 * 1024 * 1024;
// Hard: a quarter of the host socket's 64 MiB line cap (LINE_CAP, socket-protocol.ts), so one answer stays a line every
// reader takes even when non-ASCII text makes its UTF-8 up to three times its JSON's length; a turn bigger than this
// (an image-heavy one) is cut, not sent whole.
export const HISTORY_WINDOW_MAX_BYTES = 16 * 1024 * 1024;

export interface WindowBudget {
  soft: number;
  hard: number;
}

export const HISTORY_WINDOW_BUDGET: WindowBudget = { soft: HISTORY_WINDOW_BYTES, hard: HISTORY_WINDOW_MAX_BYTES };

// The message of the `fs.followState` `stopped` a follow reports when the engine host released it, its session having
// left every client's interest (FOLLOW_RELEASE_MS, src/engine-host/fs/service.ts). A source still attached then reads
// the history from the host again at the next sign of new history, which a released follow no longer sends; any other
// stop (a resume handing the session to its live stream, an unbind) carries no message.
export const FOLLOW_RELEASED = 'released: the session left every client\'s interest';

// Where a page stands to a message a jump looks for (`seek` on a `before` read; the long-transcript window's jumps into
// history): the message is on this page; on an earlier one, with `behind` events between it and this page's first; at or
// after the cursor (`newer`: in what the reader already holds, or arriving); or in none of the history (`absent`: a
// rewritten transcript, another session's message). `behind` is 0 unless `earlier`.
export const HistorySoughtSchema = z.strictObject({ at: z.enum(['page', 'earlier', 'newer', 'absent']), behind: z.number().int().nonnegative() });
export type HistorySought = z.infer<typeof HistorySoughtSchema>;

// Whether an event belongs to the message `target`: one of its blocks, or the turn its prompt started.
export const ofMessage = (event: SessionEvent, target: MessageUuid): boolean =>
  (event.kind === 'turn.started' && event.userMessageUuid === target) || ('messageUuid' in event && event.messageUuid === target);

// Where the page `[start, end)` of `events` stands to the message `target` (its first event: the whole message lies at
// or after it).
export function soughtIn(events: readonly SessionEvent[], target: MessageUuid, start: number, end: number): HistorySought {
  const at = events.findIndex((event) => ofMessage(event, target));
  if (at === -1) return { at: 'absent', behind: 0 };
  if (at >= end) return { at: 'newer', behind: 0 };
  return at >= start ? { at: 'page', behind: 0 } : { at: 'earlier', behind: start - at };
}

// One event's share of a window: its JSON's length.
export const eventBytes = (event: SessionEvent): number => JSON.stringify(event).length;

/**
 * The first index of the window that ends just before `end` (exclusive): `events.slice(start, end)` is the page, and
 * `start > 0` says older history remains (its cursor is `events[start].id`). `sizeOf(i)` is event `i`'s bytes.
 */
export function historyWindowStart(events: readonly SessionEvent[], end: number, sizeOf: (index: number) => number, budget: WindowBudget = HISTORY_WINDOW_BUDGET): number {
  let bytes = 0;
  let lowest = end; // the lowest index within the hard cap so far
  let start = -1; // the window's start at a turn's start, once one is found
  let whole = true; // the walk reached the first event within the cap
  for (let i = end - 1; i >= 0; i--) {
    const next = bytes + sizeOf(i);
    if (next > budget.hard) {
      whole = false;
      break;
    }
    if (events[i]!.kind === 'turn.started') {
      if (start !== -1 && next > budget.soft) {
        whole = false;
        break;
      }
      start = i;
    }
    bytes = next;
    lowest = i;
  }
  // The walk reached the first event: what lies before the window's first turn is the session's prelude (its start),
  // taken with it. No turn starts within the hard cap: the window is cut at the cap.
  if (whole || start === -1) start = lowest;
  // One event bigger than the hard cap still goes, alone: a page always moves the cursor back.
  if (start === end && end > 0) return end - 1;
  return pullBackToRewinds(events, start, end, bytes - sizeBetween(lowest, start, sizeOf), sizeOf, budget);
}

const sizeBetween = (from: number, to: number, sizeOf: (index: number) => number): number => {
  let bytes = 0;
  for (let i = from; i < to; i++) bytes += sizeOf(i);
  return bytes;
};

// The start moved back over every rewound turn a `boundary.rewind` in the window names, while the window stays within
// the hard cap; a target beyond it stays out (the reducer then shows that rewind as a plain boundary until the page
// that holds its target is loaded, when the rebuild applies them in order).
function pullBackToRewinds(events: readonly SessionEvent[], start: number, end: number, bytes: number, sizeOf: (index: number) => number, budget: WindowBudget): number {
  for (let moved = true; moved; ) {
    moved = false;
    for (let i = start; i < end; i++) {
      const event = events[i]!;
      if (event.kind !== 'boundary.rewind') continue;
      const found = turnOf(events, event.targetMessageUuid, start, budget.hard - bytes, sizeOf);
      if (found === null) continue;
      start = found.start;
      bytes += found.bytes;
      moved = true;
      break;
    }
  }
  return start;
}

// The start of the turn holding the message `target`, searched before `before` within `room` bytes; null when it is not
// there (or is at or after `before`).
function turnOf(events: readonly SessionEvent[], target: MessageUuid, before: number, room: number, sizeOf: (index: number) => number): { start: number; bytes: number } | null {
  let bytes = 0;
  let found = -1;
  for (let i = before - 1; i >= 0; i--) {
    bytes += sizeOf(i);
    if (bytes > room) return null;
    const event = events[i]!;
    if (found === -1 && ofMessage(event, target)) found = i;
    if (found !== -1 && event.kind === 'turn.started') return { start: i, bytes };
  }
  return found === -1 ? null : { start: 0, bytes };
}
