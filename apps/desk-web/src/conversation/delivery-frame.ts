// A delivery's frame line (the composite's §9.1; the DC9 plan's M4 and M6). sminos pushes a send to a session as its
// frame: the first line names the event — `[sminos chat <project> <writer_short>:<seq> from <from> → <@you | @all |
// a broadcast's scope>[ | unread N]]`, or `[sminos message from <via or from> id=<msg_id>]` for an event with a `msg_id` (doperpowers'
// `sminos.py`: `compose_chat_frame`, `compose_frame`) — and the text follows it. A row is a delivery only when it marks a
// delivery's provenance:
// - idle, the bridge submits it as the user (`$.prompt.submit({asUser: true})` writes a user row whose `origin` is
//   `{kind: "plugin", asUser: true}`);
// - while the main turn runs (doperpowers #233 on), the bridge appends it into the turn (`$.session.append`), read at the
//   loop's next model request: the engine keeps a plugin's appended row as a user row, `isMeta`, origin `{kind:
//   "plugin", name: <the bridge's plugin>}` and no `asUser` (`isBridgeRow`), whatever the plugin asks, so the frame is
//   the only word that it is one. The bridge's steers, interrupt rows and notes have the same shape, and none opens with a whole
//   frame line (a steer's own first line, `[sminos steer from human]`, names no event: `depth/source/bridge-rows.ts`);
// - through sminos's inbox, the engine's messaging socket (a session with no bridge, or #233's fallback after an Esc),
//   the engine keeps it as a peer message: a user row (idle) or a `queued_command` (busy) of origin `peer`, the frame
//   the first line of its envelope's body (`parsePeerMessage`'s `frame`); an engine through 2.1.289 queued it raw, the
//   frame the prompt's own first line;
// - the bridge's busy submission before #233 is a `queued_command` of origin `plugin`.
// A prompt typed at the terminal, another plugin's row, or a row that marks no origin, never is.
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
// branch no request reads, and the bridge appends it again (doperpowers #233, `recheckDeliveries`), the same text. Its
// frame line names its event (`id=<msg_id>`, or the chat frame's `<writer_short>:<seq>`), so the session view draws one
// row per frame line, the last held: the copy the engine read (`supersededDeliveries`). A producer that marks the rows
// off the live chain says so of the first copy itself (`depth/source/off-chain.ts`); this dedupe stays for the rows it
// does not mark.
//
// The bridge's wake is no delivery: when a turn ends with a steer or a delivered row unread, the bridge sends a prompt
// of its own pointing the session at it, as the user or, after an Esc, through the inbox, its first line the bridge's
// name (`isBridgeWake`). It carries no frame, so it never takes a send at the tail.
import { parsePeerMessage, sminosFrameSender } from '@shared/engine/peer-envelope';
import type { JsonObject } from 'desk-hub/protocol';
import { INTERRUPT_MARKER } from '../../../../src/engine-host/normalizer-support';

const object = (value: unknown): JsonObject | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : null);

/**
 * The plugins the bridge has run in: sminos from sminos 1.0.0, doperpowers before it (doperpowers' sminos plugin design,
 * §11). Transcripts keep either, and a project's machines may be on either, so both are read, for good.
 */
export const BRIDGE_PLUGINS = ['sminos', 'doperpowers'] as const;
const isBridgePlugin = (name: unknown): boolean => (BRIDGE_PLUGINS as readonly unknown[]).includes(name);

/**
 * A row the bridge appended (`$.session.append`), as the engine keeps it: a meta user row with the plugin's origin. A
 * companion the engine writes beside a turn (`turnCompanion`: a plugin skill's body, loaded for a command the plugin
 * ran, carries the plugin's origin too; local transcripts, 2.1.272–2.1.277) is the engine's, not an append.
 */
export function isBridgeRow(row: JsonObject): boolean {
  const origin = object(row.origin);
  return row.type === 'user' && row.isMeta === true && row.turnCompanion !== true && origin?.kind === 'plugin' && isBridgePlugin(origin.name);
}

/**
 * Where a row's prompts are, when it marks a delivery's provenance: a user row's content, submitted as the user
 * (`submitted`) or appended into the running turn by the bridge (`appended`); a queued command's prompt; or the frame
 * and words of a peer message the engine made of one, idle or queued (`enveloped`). Null for any other row.
 */
type Prompts =
  | { kind: 'submitted' | 'appended'; content: string | unknown[] }
  | { kind: 'queued'; prompt: string }
  | { kind: 'enveloped'; frame: string; words: string; queued: boolean };

/** The frame and words of a peer message whose envelope's body opens with sminos's frame, else null. */
function enveloped(text: string, queued: boolean): Prompts | null {
  const envelope = parsePeerMessage(text);
  return envelope?.kind === 'cross-session' && envelope.frame !== null ? { kind: 'enveloped', frame: envelope.frame, words: envelope.body, queued } : null;
}

function deliveredPrompts(row: JsonObject): Prompts | null {
  if (row.type === 'user') {
    const origin = object(row.origin);
    const content = object(row.message)?.content;
    if (typeof content !== 'string' && !Array.isArray(content)) return null;
    if (origin?.kind === 'peer') return enveloped(typeof content === 'string' ? content : content.flatMap((block) => (isText(block) ? [block.text] : [])).join('\n'), false);
    const kind = origin?.kind === 'plugin' && origin.asUser === true ? 'submitted' : isBridgeRow(row) ? 'appended' : null;
    return kind !== null ? { kind, content } : null;
  }
  const attachment = object(row.attachment);
  if (row.type !== 'attachment' || attachment?.type !== 'queued_command' || typeof attachment.prompt !== 'string') return null;
  const origin = object(attachment.origin);
  if (origin?.kind === 'peer') return enveloped(attachment.prompt, true) ?? { kind: 'queued', prompt: attachment.prompt };
  return origin?.kind === 'plugin' ? { kind: 'queued', prompt: attachment.prompt } : null;
}

const firstLine = (text: string) => text.split('\n', 1)[0];
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

/** The line where a delivered row's frame would be: its first prompt's first line, with text after it. */
function frameLine(prompts: Prompts): string | null {
  if (prompts.kind === 'enveloped') return prompts.frame;
  const text = prompts.kind === 'queued' ? prompts.prompt : typeof prompts.content === 'string' ? prompts.content : (prompts.content.find(isText)?.text ?? null);
  return text?.includes('\n') ? firstLine(text) : null;
}

/** The whole sminos frame line a delivered row opens with, or null for any other row. */
function deliveredFrameLine(row: JsonObject): string | null {
  const prompts = deliveredPrompts(row);
  const line = prompts && frameLine(prompts);
  return line && sminosFrameSender(line) !== null ? line : null;
}

/** The frame a delivered row opens with — who sent it, and whether that is the owner — or null for any other row. */
export function deliveryFrame(row: JsonObject): { from: string; own: boolean } | null {
  const line = deliveredFrameLine(row);
  if (line === null) return null;
  const from = sminosFrameSender(line)!;
  return { from, own: from === 'human' };
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

/** The first line of every prompt the bridge sends of its own to wake a session (#233: `STEER_WAKE`, `DELIVERY_WAKE`). */
export const BRIDGE_WAKE_LINE = '[sminos bridge]';

/**
 * The bridge's wake, by its first line: its prompt as the user (`$.prompt.submit({asUser: true})`), or the inbox frame
 * it sends after an Esc, which the engine keeps as a peer message, idle or queued into a running turn, the line opening
 * its envelope's body.
 */
export function isBridgeWake(row: JsonObject): boolean {
  let text: string | null = null;
  if (row.type === 'user') {
    const origin = object(row.origin);
    const content = object(row.message)?.content;
    if (origin?.kind === 'plugin' && origin.asUser === true) text = typeof content === 'string' ? content : Array.isArray(content) ? (content.find(isText)?.text ?? null) : null;
    else if (origin?.kind === 'peer') text = envelopeBody(typeof content === 'string' ? content : Array.isArray(content) ? content.flatMap((block) => (isText(block) ? [block.text] : [])).join('\n') : '');
  } else {
    const attachment = object(row.attachment);
    if (row.type === 'attachment' && attachment?.type === 'queued_command' && object(attachment.origin)?.kind === 'peer' && typeof attachment.prompt === 'string') text = envelopeBody(attachment.prompt);
  }
  return text !== null && firstLine(text) === BRIDGE_WAKE_LINE;
}

/** The body of an unframed message from another session, as the engine's envelope carries it (the wake carries no sminos frame); null for any other text. */
function envelopeBody(text: string): string | null {
  const envelope = parsePeerMessage(text);
  return envelope?.kind === 'cross-session' && envelope.frame === null ? envelope.body : null;
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
