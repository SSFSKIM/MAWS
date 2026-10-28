// The conversation the engine holds, among the rows the desk holds (DX4's off-chain marks; doperpowers' `Chain` in
// `sminos_plane.py`). A transcript is a tree: each row names its `parentUuid`, and the engine reads only the chain from
// its leaf. The rows a branch left behind stay in the file: a prompt an Esc handed back to the input box before the
// model answered (sent again, it goes in under the same point), the turns a terminal `/rewind` undid, a steer or a
// delivery the bridge appended under a turn so undone, a response the engine dropped when a message reached its turn
// mid-stream. The machine follows each subscription's chain and marks the rows off it (`offChain` on the snapshot, on
// each `rows` page, and on a `row` that took rows off; `onChain` on one that put rows back), so the desk draws what the
// session read:
// - a row off the chain is not drawn;
// - but an owner input — a prompt typed at the terminal, a steer, a delivery of the owner's words — that went off it
//   before the session read it, and was not sent again, is drawn in place, dimmed, as a prompt the engine never ran
//   (MAWS's dropped prompt, the desk's mount saying why: `UNDONE`), so the owner sees it was not read rather than lose
//   it silently. It never draws as delivered or read.
// "Before the session read it": no response was written under it, nor, for a row appended while a tool ran, under the
// call's result (a row the model answered and a `/rewind` then undid was read, and goes with its turn). "Sent again": a
// later owner input on the chain with the same words (an Esc's prompt sent again as it was, a delivery the bridge
// appended again after an Esc, doperpowers #233), or, for a prompt typed at the terminal, a typed prompt sent in its
// place, edited or not: the next one from the same point of the conversation, with no response and no other owner input
// in between. An Esc hands the prompt back to the input box, and most go back in edited (local transcripts, 2026-10-18:
// of 975 prompts sent again from the same point, 159 as they were), so nothing was lost. A steer or a delivery is a
// repeat only by its words, and an input with no words (a prompt of images alone) never is. Of several undone inputs
// with the same words, the last is drawn.
//
// The delivery frame's dedupe (`supersededDeliveries`, MAWS PR #42) is this rule's special case under a producer that
// marks: a delivery appended again after an Esc left its first copy off the chain, repeated by the copy on it. It is
// kept for the rows the plane does not mark — an older producer's, and a row whose parent the plane never saw — over
// the rows not marked off.
//
// The held rows stay verbatim; only the drawing's mapping changes. An older producer marks nothing, and the drawing is
// every held row, as before.
import type { ContentBlock, SessionEvent } from '@shared/graph/events';
import { isMadeUpFinalAnswer } from '@shared/owner/message-call';
import type { TranscriptRecord } from '@shared/wire/transcript';
import type { JsonObject } from 'desk-hub/protocol';
import { eventBase, isTaskNotification, localCommandKind, startsTurn, type BackfillContext } from '../../../../../src/engine-host/fs/backfill';
import { deliveryAsDrawn, deliveryFrame, supersededDeliveries } from '../../conversation/delivery-frame';
import { bridgeRowKind, steerContent } from './bridge-rows';

/** What the desk says under an owner input the session never read: its turn was undone first. */
export const UNDONE = 'Not read: the turn was undone';

/** The held rows the drawing leaves out, and those it draws as undone owner inputs; every other held row as it is. */
export type Drawing = { hidden: ReadonlySet<string>; undone: ReadonlySet<string> };

export const NONE_OFF: ReadonlySet<string> = new Set();

/**
 * An owner input: what its bubble draws (a delivery without its frame line), its words, by which a repeat is known, and
 * whether it is a prompt typed at the terminal, which a typed prompt sent in its place repeats whatever its words.
 */
export type OwnerInput = { content: string | ContentBlock[]; words: string; typed: boolean };

const object = (value: unknown): JsonObject | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : null);
const isBlock = (value: unknown): value is ContentBlock => typeof object(value)?.type === 'string';
const COMMAND_TEXT = /^\s*<(?:bash-|local-command|command-)/;

function input(content: unknown, typed = false): OwnerInput | null {
  const drawn = typeof content === 'string' ? content : Array.isArray(content) ? content.filter(isBlock) : null;
  if (drawn === null) return null;
  const text = typeof drawn === 'string' ? drawn : drawn.flatMap((block) => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])).join('\n');
  return { content: drawn, words: text.trim(), typed };
}

/** A prompt typed at the terminal: one that opens a turn (MAWS's `startsTurn`), of the human's origin, not a command's. */
function typedPrompt(row: JsonObject): OwnerInput | null {
  const origin = object(row.origin);
  if (row.type === 'attachment') {
    // One typed while a turn ran, which the engine queued into it (MAWS's `humanQueuedPrompt`).
    const attachment = object(row.attachment);
    const queued = attachment?.type === 'queued_command' && object(attachment.origin)?.kind === 'human' && attachment.commandMode === 'prompt' && attachment.isMeta !== true;
    return queued ? input(attachment.prompt, true) : null;
  }
  if (row.type !== 'user' || (origin !== null && origin.kind !== 'human')) return null;
  const record = row as TranscriptRecord;
  if (!startsTurn(record) || isTaskNotification(record) || localCommandKind(record) !== null) return null;
  const typed = input(object(row.message)?.content, true);
  return typed !== null && !COMMAND_TEXT.test(typed.words) ? typed : null;
}

const inputs = new WeakMap<JsonObject, OwnerInput | null>();

/** The owner input a held row is — a typed prompt, a steer, a delivery of the owner's words — or null. */
export function ownerInput(row: JsonObject): OwnerInput | null {
  if (inputs.has(row)) return inputs.get(row)!;
  let found: OwnerInput | null;
  const frame = deliveryFrame(row);
  if (frame !== null) {
    // The owner's send, drawn without its frame line; a peer's is no owner input.
    const drawn = frame.own ? deliveryAsDrawn(row) : null;
    found = drawn === null ? null : input(drawn.type === 'attachment' ? object(drawn.attachment)?.prompt : object(drawn.message)?.content);
  } else {
    const kind = bridgeRowKind(row);
    found = kind === 'steer' ? input(steerContent(row)) : kind === null ? typedPrompt(row) : null;
  }
  inputs.set(row, found);
  return found;
}

/**
 * A response the model wrote: an assistant row, but not one the engine wrote itself (`<synthetic>`) nor the to-human
 * plugin's answer after a final message (`isMadeUpFinalAnswer`), each written with no request, which read nothing.
 */
export const isResponse = (row: JsonObject): boolean => row.type === 'assistant' && object(row.message)?.model !== '<synthetic>' && !isMadeUpFinalAnswer(row);

/** The assistant row that issued a tool result (a user row holding a `tool_result` block), or null for any other row. */
function resultCall(row: JsonObject): string | null {
  const content = row.type === 'user' ? object(row.message)?.content : null;
  if (!Array.isArray(content) || !content.some((block) => object(block)?.type === 'tool_result')) return null;
  const call = typeof row.sourceToolAssistantUUID === 'string' ? row.sourceToolAssistantUUID : row.parentUuid;
  return typeof call === 'string' ? call : null;
}

/**
 * The rows a response was written under: the session read them. A row the bridge appended while a tool ran goes in
 * under the call's assistant, beside the call's result, and the next response descends from the result: the request it
 * answered read the row all the same.
 */
function readRows(rows: readonly JsonObject[]): Set<string> {
  const read = new Set<string>();
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if ((isResponse(row) || read.has(row.uuid as string)) && typeof row.parentUuid === 'string') read.add(row.parentUuid);
  }
  const answeredCalls = new Set<string>();
  for (const row of rows) {
    const call = resultCall(row);
    if (call !== null && read.has(row.uuid as string)) answeredCalls.add(call);
  }
  for (const row of rows) {
    if (typeof row.parentUuid === 'string' && answeredCalls.has(row.parentUuid)) read.add(row.uuid as string);
  }
  return read;
}

/**
 * For each point of the conversation a typed prompt on the chain was sent from, the index of the last such prompt: the
 * rows from its parent up to the nearest response or owner input, which it follows with nothing read in between.
 */
function promptPoints(rows: readonly JsonObject[], off: ReadonlySet<string>): Map<string, number> {
  const byUuid = new Map(rows.map((row) => [row.uuid as string, row]));
  const points = new Map<string, number>();
  rows.forEach((row, at) => {
    if (off.has(row.uuid as string) || ownerInput(row)?.typed !== true) return;
    let point = row.parentUuid;
    for (let step = 0; typeof point === 'string' && step < 64; step++) {
      points.set(point, at);
      const parent = byUuid.get(point);
      if (parent === undefined || isResponse(parent) || ownerInput(parent) !== null) break;
      point = parent.parentUuid;
    }
  });
  return points;
}

/** What the drawing leaves out of the held rows (oldest first), and what it draws as undone, given the rows marked off. */
export function drawingOf(rows: readonly JsonObject[], off: ReadonlySet<string>): Drawing {
  const marked = off.size > 0 && rows.some((row) => off.has(row.uuid as string));
  const hidden = supersededDeliveries(marked ? rows.filter((row) => !off.has(row.uuid as string)) : rows);
  const undone = new Set<string>();
  if (!marked) return { hidden, undone };
  const read = readRows(rows);
  const points = promptPoints(rows, off);
  // The words of the owner inputs after this row, on the chain or drawn undone. An input with no words (an image-only
  // prompt) repeats none and is repeated by none: its images are not compared.
  const later = new Set<string>();
  for (let at = rows.length - 1; at >= 0; at--) {
    const row = rows[at];
    const uuid = row.uuid as string;
    const owner = ownerInput(row);
    if (!off.has(uuid)) {
      if (owner !== null && owner.words !== '') later.add(owner.words);
      continue;
    }
    const replaced = owner?.typed === true && typeof row.parentUuid === 'string' && (points.get(row.parentUuid) ?? -1) > at;
    if (owner === null || read.has(uuid) || later.has(owner.words) || replaced) {
      hidden.add(uuid);
      continue;
    }
    undone.add(uuid);
    if (owner.words !== '') later.add(owner.words);
  }
  return { hidden, undone };
}

/** Whether two drawings differ for any row but `except` (a row not mapped yet). */
export function drawingsDiffer(a: Drawing, b: Drawing, except: string | null): boolean {
  const differ = (x: ReadonlySet<string>, y: ReadonlySet<string>) => [...x].some((u) => u !== except && !y.has(u)) || [...y].some((u) => u !== except && !x.has(u));
  return differ(a.hidden, b.hidden) || differ(a.undone, b.undone);
}

/**
 * An undone owner input's events, under the row's own uuid: its prompt, and the engine's discarding of it before it
 * ran, so MAWS's reducer draws it where it lies as a prompt the engine dropped (a turn of its own that never started and
 * receives nothing), and the desk's mount says why (`UNDONE`).
 */
export function undoneEvents(row: JsonObject, owner: OwnerInput, ctx: BackfillContext): SessionEvent[] {
  const uuid = row.uuid as string;
  if (typeof row.timestamp === 'string') ctx.lastAt = row.timestamp;
  return [
    { ...eventBase(ctx, uuid), kind: 'user.message', messageUuid: uuid, content: owner.content, isReplay: false, isSynthetic: false, origin: null, bash: null },
    { ...eventBase(ctx, `${uuid}#undone`), kind: 'command.lifecycle', commandUuid: uuid, state: 'discarded' },
  ] as SessionEvent[];
}
