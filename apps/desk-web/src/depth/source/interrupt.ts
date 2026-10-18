// An interrupted turn's end (DC9 M5; the composite's writer's addition). The owner's Interrupt — Esc at the terminal, or
// the desk's through the bridge — leaves a marker row in the transcript: the engine's `[Request interrupted by user]`,
// or the bridge's record of its own interrupt. MAWS's backfill keeps the turn open past it (it only leaves the tool
// loop: `engine-host/fs/backfill.ts`, the marker opens no turn), since MAWS's live path ends the turn from the SDK
// result, which the desk never receives, and DX4 carries no turn end. So the turn read "working" until the next prompt
// (local transcripts, 2026-10-17: 160 markers, 8 followed by a `turn_duration`). The desk ends it at the marker: a
// `turn.ended` placed right after the marker's own events, its id derived from the marker row's uuid, so a reset, a
// rebuild and an older page replay it alike; its terminal reason is the engine's for an aborted turn, so MAWS reads the
// turn as stopped. A `turn_duration` that follows names the turn already closed and, with no other turn open, MAWS's
// reducer keeps it loose, ending nothing.
//
// Only these rows end a turn, recognized strictly, since MAWS's `INTERRUPT_MARKER` admits any bracketed words after
// "interrupted by user" and reads no origin. The bridge's rows are appended with `$.session.append`, which the engine
// stores as meta user rows of text blocks with the plugin's origin (2.1.300 `cli.pretty.js:1462`):
// - the engine's marker, one text block exactly one of the engine's two forms, on a user row with no `origin` and not
//   meta (Esc; a typed prompt carries `origin.kind`), or on the bridge's meta row (the bridge's interrupt from
//   doperpowers #225 on, which writes the marker alone and then a note row, "The interrupt came from …", with a line
//   per background task; the note is meta and one of the bridge's records, never a steer (`bridge-rows.ts`), so neither
//   a prompt nor a bubble, and ends nothing);
// - the bridge's record before #225 (`interruptText`), kept for the history that holds it and the plugins that still
//   write it: on the bridge's meta row, one text block whose first line is one of its two marker lines ("… from the
//   desk]", "… from outside the terminal]") and whose other lines, if any, are each one of its own "Task …" lines for a
//   Bash call the interrupt stopped or could not stop.
// A typed prompt, another plugin's row, or a row whose lines are not those never ends one, nor does a delivery frame.
// Residual (the composite's writer's ruling, tech debt): a steer through a plugin older than #225 whose whole text is
// one of these, since the bridge's steers are the same meta rows; #225's steer refuses such a text, and from 7.180.0 a
// steer's row opens with its own line (`bridge-rows.ts`, `STEER_LINE`), so its whole text is none of these.
//
// The bridge's record with "Task …" lines is multi-line, so MAWS's marker rule misses it. Its mapping takes it
// normalized (`normalizeInterruptRow`, before MAWS's backfill sees it): its marker line alone, so the backfill reads the
// marker and the turn ends there. The held row is kept verbatim; the lines are the model's, and a meta row draws none.
import type { SessionEvent } from '@shared/graph/events';
import type { JsonObject } from 'desk-hub/protocol';
import { eventBase, type BackfillContext } from '../../../../../src/engine-host/fs/backfill';
import { isBridgeRow } from '../../conversation/delivery-frame';

const ENGINE_MARKERS = new Set(['[Request interrupted by user]', '[Request interrupted by user for tool use]']);
const BRIDGE_MARKERS = new Set(['[Request interrupted by user from the desk]', '[Request interrupted by user from outside the terminal]']);
/** The bridge's line for each Bash call the interrupt moved to the background, stopped or not (`interruptText`). */
export const BRIDGE_TASK_LINE =
  /^Task [A-Za-z0-9_-]+, the Bash command the interrupt moved to the background, (?:was then stopped: it is not running, and no notification will come for it\.|could not be stopped: it may still be running\.)$/;

/** Where each mapping context's current turn started, for the end's duration. */
const turnStarts = new WeakMap<BackfillContext, string>();

/** The text of a row made of one text block (or a string), else null. */
export function singleText(row: JsonObject): string | null {
  const content = (row.message as JsonObject | undefined)?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content) || content.length !== 1) return null;
  const block = content[0] as JsonObject;
  return block?.type === 'text' && typeof block.text === 'string' ? block.text : null;
}

const isUserRow = (row: JsonObject) => row.type === 'user';

/** The engine's marker text, written by the engine (Esc) or by the bridge. */
export function isEngineMarker(row: JsonObject): boolean {
  const engines = isUserRow(row) && row.isMeta !== true && row.origin == null;
  if (!engines && !isBridgeRow(row)) return false;
  const text = singleText(row);
  return text !== null && ENGINE_MARKERS.has(text.trim());
}

/** The bridge's record before #225, its lines with its marker line first; null for any other row. */
export function bridgeRecordLines(row: JsonObject): string[] | null {
  if (!isBridgeRow(row)) return null;
  const text = singleText(row);
  if (text === null) return null;
  const [first, ...rest] = text.split('\n');
  return BRIDGE_MARKERS.has(first) && rest.every((line) => BRIDGE_TASK_LINE.test(line)) ? [first, ...rest] : null;
}

/** The engine's interrupt marker row, or the bridge's interrupt record, by the strict rule above. */
export function isInterruptRow(row: JsonObject): boolean {
  return isEngineMarker(row) || bridgeRecordLines(row) !== null;
}

/** The row as the mapping takes it: the bridge's older record with "Task …" lines as its marker line alone; any other as is. */
export function normalizeInterruptRow(row: JsonObject): JsonObject {
  const lines = bridgeRecordLines(row);
  if (lines === null || lines.length === 1) return row;
  return { ...row, message: { ...(row.message as JsonObject), content: [{ type: 'text', text: lines[0] }] } };
}

/**
 * The events a row maps to, with the turn it interrupted ended right after them when it is an interrupt marker the
 * backfill read as one. Called on every row a context maps, in order (normalized), so it also keeps where the current
 * turn started.
 */
export function withInterruptEnd(row: JsonObject, events: SessionEvent[], ctx: BackfillContext): SessionEvent[] {
  for (const event of events) if (event.kind === 'turn.started') turnStarts.set(ctx, event.at);
  const uuid = row.uuid;
  const read = events.some((event) => event.kind === 'user.message' && event.origin === 'interrupt-marker' && event.messageUuid === uuid);
  if (!read || typeof uuid !== 'string' || !isInterruptRow(row)) return events;
  const at = ctx.lastAt;
  const started = turnStarts.get(ctx);
  const forToolUse = singleText(row)!.trim().endsWith('for tool use]');
  const end: SessionEvent = {
    ...eventBase(ctx, `${uuid}#interrupt-end`),
    kind: 'turn.ended',
    result: 'error_during_execution',
    isError: true,
    terminalReason: forToolUse ? 'aborted_tools' : 'aborted_streaming',
    resultText: null,
    durationMs: started === undefined ? 0 : Math.max(0, Date.parse(at) - Date.parse(started)),
    numTurns: 1,
    costUsd: 0,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, thinkingTokens: null },
    permissionDenials: [],
    errors: [],
    userMessageUuids: ctx.lastTurnUserUuid === null ? [] : [ctx.lastTurnUserUuid],
    origin: null,
    resultIndex: null,
    isEchoReceipt: false,
  } as SessionEvent;
  return [...events, end];
}
