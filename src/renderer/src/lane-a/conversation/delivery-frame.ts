// A delivery's frame line, as the session view and the tail read it (the composite's §9.1; the DC9 plan's M4 and M6).
// Which rows are deliveries, their frame and whose they are, is read in `@shared/engine/sminos-delivery` (moved there
// for the arrivals reader, UX wave U3, UC-2); this module keeps what the drawing and the tail do with them.
//
// The tail matches a send by its frame (`tail.ts`). How a delivered row draws is the arrivals reader's (UX wave U3,
// UC-2: `@shared/engine/arrival`, which MAWS's backfill asks): the owner's own send (`from human`) is their bubble
// without the frame line, through whichever route it came, and a peer's is the peer's message line, never the owner's
// bubble (O-41: the "From <name>" label this module drew is gone). An owner's send the session never read, which the
// desk draws as undone (`source/off-chain.ts`), asks the same reader for its words.
//
// A delivered row can be on disk twice. An Esc before the model answers hands the human's prompt back to the input box,
// and the prompt sent next goes in under the same parent: a row the bridge appended after the first one is left on a
// branch no request reads, and the bridge appends it again (doperpowers PR 233, `recheckDeliveries`), the same text. Its
// frame line names its event (`id=<msg_id>`, or the chat frame's `<writer_short>:<seq>`), so the session view draws one
// row per frame line, the last held: the copy the engine read (`supersededDeliveries`). A producer that marks the rows
// off the live chain says so of the first copy itself (`depth/source/off-chain.ts`); this dedupe stays for the rows it
// does not mark.
//
// The bridge's wake is no delivery: when a turn ends with a steer or a delivered row unread, the bridge sends a prompt
// of its own pointing the session at it, as the user or, after an Esc, through the inbox, its first line the bridge's
// name (`isBridgeWake`). It carries no frame, so it never takes a send at the tail.
import { deliveredFrameLine, deliveredPrompts, firstLine, isBridgeWake } from '@shared/engine/sminos-delivery';
import type { JsonObject } from 'desk-hub/protocol';

export { BRIDGE_PLUGINS, BRIDGE_WAKE_LINE, deliveryFrame, isBridgeRow, isBridgeWake } from '@shared/engine/sminos-delivery';

const object = (value: unknown): JsonObject | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : null);
const isText = (block: unknown): block is { type: 'text'; text: string } => object(block)?.type === 'text' && typeof object(block)!.text === 'string';

/**
 * The first lines of the prompts a row carries that may be deliveries — a user row's text or text blocks (never a tool's
 * result), a queued command's prompt, each with its text after it as sminos writes a frame, or a peer message's frame —
 * none for a row that marks no delivery's provenance.
 */
export function deliveredLines(row: JsonObject): string[] {
  const prompts = deliveredPrompts(row);
  if (prompts === null || isBridgeWake(row)) return [];
  const framed = (text: string) => (text.includes('\n') ? [firstLine(text)] : []);
  if (prompts.kind === 'enveloped') return [prompts.frame];
  if (prompts.kind === 'queued') return framed(prompts.prompt);
  if (typeof prompts.content === 'string') return framed(prompts.content);
  return prompts.content.flatMap((block) => (isText(block) ? framed(block.text) : []));
}

/**
 * The uuids of the delivered rows a later row of `rows` (oldest first) repeats the frame line of: the copy an Esc left
 * on a dead branch, which the engine never read. The session view draws only the last copy of each.
 */
export function supersededDeliveries(rows: readonly JsonObject[]): Set<string> {
  const last = new Map<string, string>();
  const superseded = new Set<string>();
  for (const row of rows) {
    const line = deliveredFrameLine(row);
    if (line === null || typeof row.uuid !== 'string') continue;
    const earlier = last.get(line);
    if (earlier !== undefined) superseded.add(earlier);
    last.set(line, row.uuid);
  }
  return superseded;
}

/**
 * A user row the bridge appended into the running turn, as MAWS draws a prompt queued there: the shape the engine
 * writes for a prompt typed mid-turn (`queued_command`, origin `human`, MAWS's `humanQueuedPrompt`), its words
 * `prompt`, under the row's own uuid.
 */
export function asQueuedPrompt(row: JsonObject, prompt: string | JsonObject[]): JsonObject {
  const drawn: JsonObject = { ...row, type: 'attachment', attachment: { type: 'queued_command', prompt, commandMode: 'prompt', origin: { kind: 'human' }, source_uuid: row.uuid as string } };
  delete drawn.message;
  delete drawn.origin;
  delete drawn.isMeta;
  return drawn;
}
