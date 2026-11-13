// A delivery's frame line, as the session view and the tail read it (the composite's §9.1; the DC9 plan's M4 and M6).
// Which rows are deliveries, their frame and whose they are, is read in `@shared/engine/sminos-delivery` (moved there
// for the arrivals reader, UX wave U3, UC-2); this module keeps what the drawing and the tail do with them.
//
// The tail matches a send by its frame (`tail.ts`). The session view draws a delivered row without its frame line: the
// owner's own send (`from human`) needs none, its bubble says who wrote it. One that came through the inbox is drawn as
// the owner's own words too, not as the peer message the engine made of it: the envelope is only the channel. A peer's
// in an envelope is left to MAWS's peer drawing (a message between agents, its frame and reply line cut from the body
// by `parsePeerMessage`, the row naming its sender); one through the bridge or queued raw draws its frame as a label, the
// sender's name in its own first paragraph. The label is in the text, not beside the bubble, because a delivery that entered a
// running turn — one the engine queued there, or one the bridge appended — is drawn as MAWS draws any prompt queued
// there: a bubble in the turn, under the message's own uuid (a queued one's `source_uuid`, an appended row's own),
// captioned "Sent during this turn", and that caption is MAWS's alone. MAWS's backfill would otherwise draw no body for
// either (a queued delivery is a synthetic peer message to it, its peer parser reading MAWS's own envelope, not sminos's
// frame; an appended row is meta), so its drawing's copy takes the shape MAWS gives a prompt queued at the terminal
// (`humanQueuedPrompt`). The text the session read is otherwise unchanged; only the drawing's copy of the row changes,
// the held row stays verbatim for the tail. The owner's send whose words MAWS's backfill would read as an interrupt
// marker (`[Request interrupted by user…]` whole) keeps its frame line: without it the bubble would be read as the
// marker, drawing nothing and stopping the turn.
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
import { INTERRUPT_MARKER } from '@shared/engine/engine-markers';
import { deliveredFrameLine, deliveredPrompts, deliveryFrame, firstLine, isBridgeWake } from '@shared/engine/sminos-delivery';
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

/** A sender's name as Markdown text: every character Markdown could read as syntax escaped, math's `$` included. */
const literal = (text: string) => text.replace(/[\\`*_{}[\]()#+\-.!|<>~$]/g, '\\$&');

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

/**
 * The row as the session view draws it: a delivered row with its frame line dropped (the owner's own send) or drawn as
 * a label naming the peer who sent it, and a delivery that entered a running turn (queued there, or appended by the
 * bridge) in the shape of a prompt queued there, under the message's own uuid. The owner's send that came through the
 * inbox is drawn as their own prompt; a peer's, and any other row, as it is.
 */
export function deliveryAsDrawn(row: JsonObject): JsonObject {
  const frame = deliveryFrame(row);
  if (frame === null) return row;
  const drawnWords = (line: string, words: string) => {
    // Words MAWS's backfill would read as an interrupt marker (its rule, the renderer's two markers among them): kept framed.
    if (frame.own && INTERRUPT_MARKER.test(words.trim())) return `${line}\n${words}`;
    return (frame.own ? '' : `*From ${literal(frame.from)}*\n\n`) + words;
  };
  const cut = (text: string) => drawnWords(firstLine(text), text.slice(text.indexOf('\n') + 1));
  const asQueued = (prompt: string): JsonObject => {
    const attachment = { ...object(row.attachment)! };
    delete attachment.isMeta; // MAWS reads a meta queued prompt as context, not as a prompt
    const source = typeof attachment.source_uuid === 'string' && attachment.source_uuid !== '' ? attachment.source_uuid : row.uuid;
    return { ...row, attachment: { ...attachment, prompt, commandMode: 'prompt', origin: { kind: 'human' }, source_uuid: source as string } };
  };
  const prompts = deliveredPrompts(row)!;
  if (prompts.kind === 'enveloped') {
    if (!frame.own) return row; // a peer's: MAWS draws it as a message between agents
    const words = drawnWords(prompts.frame, prompts.words);
    if (prompts.queued) return asQueued(words);
    const drawn: JsonObject = { ...row, message: { ...object(row.message)!, content: words } };
    delete drawn.origin; // a prompt of the owner's, not the peer message the engine made of it
    delete drawn.isMeta;
    return drawn;
  }
  if (prompts.kind === 'queued') return asQueued(cut(prompts.prompt));
  const first = Array.isArray(prompts.content) ? prompts.content.findIndex(isText) : -1;
  const content =
    typeof prompts.content === 'string'
      ? cut(prompts.content)
      : (prompts.content.map((block, i) => (i === first ? { ...(block as JsonObject), text: cut((block as { text: string }).text) } : block)) as JsonObject[]);
  if (prompts.kind === 'appended') return asQueuedPrompt(row, content);
  return { ...row, message: { ...object(row.message)!, content } };
}
