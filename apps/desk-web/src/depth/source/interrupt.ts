// An interrupted turn's end (DC9 M5; the composite's writer's addition). The owner's Interrupt — Esc at the terminal, or
// the desk's through the bridge — leaves the engine's marker row, `[Request interrupted by user]`, in the transcript.
// MAWS's backfill keeps the turn open past it (it only leaves the tool loop: `engine-host/fs/backfill.ts`, the marker
// opens no turn), since MAWS's live path ends the turn from the SDK result, which the desk never receives, and DX4
// carries no turn end. So the turn read "working" until the next prompt (local transcripts, 2026-10-17: 160 markers,
// 8 followed by a `turn_duration`). The desk ends it at the marker: a `turn.ended` placed right after the marker's own
// events, its id derived from the marker row's uuid, so a reset, a rebuild and an older page replay it alike; its
// terminal reason is the engine's for an aborted turn, so MAWS reads the turn as stopped. A `turn_duration` that follows
// names the turn already closed and, with no other turn open, MAWS's reducer keeps it loose, ending nothing.
//
// Only the row the engine writes, or the bridge's interrupt record, ends a turn. MAWS's `INTERRUPT_MARKER` admits any
// bracketed words after "interrupted by user" and reads no origin, so the desk's check is its own and strict: the
// backfill must have read the row as the marker; the row is a user row, not meta, of one text block whose whole text is
// one of the engine's two forms with no `origin` (a typed prompt carries `origin.kind`, `human` or another), or one of the
// bridge's two (`hooks/mods/bridge.tsx` `interruptText`, a plugin append) with no origin or a plugin's. A typed prompt,
// a steer or a delivery frame carrying the same words never ends one.
import type { SessionEvent } from '@shared/graph/events';
import type { JsonObject } from 'desk-hub/protocol';
import { eventBase, type BackfillContext } from '../../../../../src/engine-host/fs/backfill';

const ENGINE_MARKERS = new Set(['[Request interrupted by user]', '[Request interrupted by user for tool use]']);
const BRIDGE_MARKERS = new Set(['[Request interrupted by user from the desk]', '[Request interrupted by user from outside the terminal]']);

/** Where each mapping context's current turn started, for the end's duration. */
const turnStarts = new WeakMap<BackfillContext, string>();

/** The text of a row made of one text block (or a string), else null. */
function singleText(row: JsonObject): string | null {
  const content = (row.message as JsonObject | undefined)?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content) || content.length !== 1) return null;
  const block = content[0] as JsonObject;
  return block?.type === 'text' && typeof block.text === 'string' ? block.text : null;
}

/** The engine's interrupt marker row, or the bridge's interrupt record, by the strict rule above. */
export function isInterruptRow(row: JsonObject): boolean {
  if (row.type !== 'user' || row.isMeta === true) return false;
  const text = singleText(row)?.trim();
  if (text === undefined) return false;
  const origin = row.origin as { kind?: unknown } | undefined | null;
  if (ENGINE_MARKERS.has(text)) return origin == null;
  if (BRIDGE_MARKERS.has(text)) return origin == null || origin.kind === 'plugin';
  return false;
}

/**
 * The events a row maps to, with the turn it interrupted ended right after them when it is an interrupt marker the
 * backfill read as one. Called on every row a context maps, in order, so it also keeps where the current turn started.
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
