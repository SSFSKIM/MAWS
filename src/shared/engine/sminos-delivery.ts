// What sminos delivers into a session, read off the rows and frames that carry it (the composite's §9.1; the DC9 plan's
// M4 and M6; moved here from `renderer/src/lane-a/conversation/delivery-frame.ts` and `source/bridge-rows.ts` for the
// arrivals reader, UX wave U3, UC-2). Pure.
//
// sminos pushes a send to a session as its frame: the first line names the event — `[sminos chat <project>
// <writer_short>:<seq> from <from> → <@you | @all | a broadcast's scope>[ | unread N]]`, or `[sminos message from <via or
// from> id=<msg_id>]` for an event with a `msg_id` (doperpowers' `sminos.py`: `compose_chat_frame`, `compose_frame`) —
// and the text follows it. A row is a delivery only when it marks a delivery's provenance:
// - idle, the bridge submits it as the user (`$.prompt.submit({asUser: true})` writes a user row whose `origin` is
//   `{kind: "plugin", asUser: true}`);
// - while the main turn runs (doperpowers PR 233 on), the bridge appends it into the turn (`$.session.append`), read at the
//   loop's next model request: the engine keeps a plugin's appended row as a user row, `isMeta`, origin `{kind:
//   "plugin", name: <the bridge's plugin>}` and no `asUser` (`isBridgeRow`), whatever the plugin asks, so the frame is
//   the only word that it is one. The bridge's steers, interrupt rows and notes have the same shape, and none opens with a whole
//   frame line (a steer's own first line, `[sminos steer from human]`, names no event: `STEER_LINE` below);
// - through sminos's inbox, the engine's messaging socket (a session with no bridge, or PR 233's fallback after an Esc),
//   the engine keeps it as a peer message: a user row (idle) or a `queued_command` (busy) of origin `peer`, the frame
//   the first line of its envelope's body (`parsePeerMessage`'s `frame`); an engine through 2.1.289 queued it raw, the
//   frame the prompt's own first line;
// - the bridge's busy submission before PR 233 is a `queued_command` of origin `plugin`.
// A prompt typed at the terminal, another plugin's row, or a row that marks no origin, never is.
//
// The bridge's wake is no delivery: when a turn ends with a steer or a delivered row unread, the bridge sends a prompt
// of its own pointing the session at it, as the user or, after an Esc, through the inbox, its first line the bridge's
// name (`isBridgeWake`). It carries no frame.
import { parsePeerMessage, sminosFrameSender } from './peer-envelope';

type Json = Record<string, unknown>;
const object = (value: unknown): Json | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null);

/**
 * The plugins the bridge has run in: sminos from sminos 1.0.0, doperpowers before it (doperpowers' sminos plugin design,
 * §11). Transcripts keep either, and a project's machines may be on either, so both are read, for good.
 */
export const BRIDGE_PLUGINS = ['sminos', 'doperpowers'] as const;
const isBridgePlugin = (name: unknown): boolean => (BRIDGE_PLUGINS as readonly unknown[]).includes(name);

/**
 * A row the bridge appended (`$.session.append`), as the engine keeps it: a meta user row with the plugin's origin,
 * whose content is the plugin's text blocks and nothing else (2.1.287 to 2.1.312 build it so). The engine writes rows of
 * its own under the plugin's origin too, which are no appends:
 * - a companion beside a turn (`turnCompanion`: a plugin skill's body, loaded for a command the plugin ran; local
 *   transcripts, 2.1.272–2.1.277);
 * - what a command the plugin queued writes (`$.command.run`, `$.prompt.submit`): each of its user rows takes the queued
 *   command's origin and its priority (`queuePriority`), its content as the command wrote it. The O9 M10 sitting's
 *   `/rename` left one: the system reminder telling the model the session's new name, a meta string row of the bridge's
 *   origin (2.1.312, `queuePriority: "later"`), which read as a steer and drew as the person's words.
 */
export function isBridgeRow(row: Json): boolean {
  const origin = object(row.origin);
  if (row.type !== 'user' || row.isMeta !== true || row.turnCompanion === true || row.queuePriority !== undefined) return false;
  return origin?.kind === 'plugin' && isBridgePlugin(origin.name) && Array.isArray(object(row.message)?.content);
}

/**
 * Where a row's prompts are, when it marks a delivery's provenance: a user row's content, submitted as the user
 * (`submitted`) or appended into the running turn by the bridge (`appended`); a queued command's prompt (`queued`, the
 * queue's origin `peer` for one an engine through 2.1.289 queued raw, else `plugin`); or the frame and words of a peer
 * message the engine made of one, idle or queued (`enveloped`). Null for any other row.
 */
export type DeliveredPrompts =
  | { kind: 'submitted' | 'appended'; content: string | unknown[] }
  | { kind: 'queued'; prompt: string; via: 'peer' | 'plugin' }
  | { kind: 'enveloped'; frame: string; words: string; queued: boolean };

/** The frame and words of a peer message whose envelope's body opens with sminos's frame, else null. */
function enveloped(text: string, queued: boolean): DeliveredPrompts | null {
  const envelope = parsePeerMessage(text);
  return envelope?.kind === 'cross-session' && envelope.frame !== null ? { kind: 'enveloped', frame: envelope.frame, words: envelope.body, queued } : null;
}

export function deliveredPrompts(row: Json): DeliveredPrompts | null {
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
  if (origin?.kind === 'peer') return enveloped(attachment.prompt, true) ?? { kind: 'queued', prompt: attachment.prompt, via: 'peer' };
  return origin?.kind === 'plugin' ? { kind: 'queued', prompt: attachment.prompt, via: 'plugin' } : null;
}

export const firstLine = (text: string): string => text.split('\n', 1)[0]!;
const isText = (block: unknown): block is { type: 'text'; text: string } => object(block)?.type === 'text' && typeof object(block)!.text === 'string';

/** The text of a delivered row's first prompt: the frame line where it has one, and the words after it. */
export function deliveredText(prompts: DeliveredPrompts): string | null {
  if (prompts.kind === 'enveloped') return `${prompts.frame}\n${prompts.words}`;
  if (prompts.kind === 'queued') return prompts.prompt;
  return typeof prompts.content === 'string' ? prompts.content : (prompts.content.find(isText)?.text ?? null);
}

/** The line where a delivered row's frame would be: its first prompt's first line, with text after it. */
function frameLine(prompts: DeliveredPrompts): string | null {
  if (prompts.kind === 'enveloped') return prompts.frame;
  const text = deliveredText(prompts);
  return text?.includes('\n') ? firstLine(text) : null;
}

/** The whole sminos frame line a delivered row opens with, or null for any other row. */
export function deliveredFrameLine(row: Json): string | null {
  const prompts = deliveredPrompts(row);
  const line = prompts && frameLine(prompts);
  return line && sminosFrameSender(line) !== null ? line : null;
}

/** The frame a delivered row opens with — who sent it, and whether that is the owner — or null for any other row. */
export function deliveryFrame(row: Json): { from: string; own: boolean } | null {
  const line = deliveredFrameLine(row);
  if (line === null) return null;
  const from = sminosFrameSender(line)!;
  return { from, own: from === 'human' };
}

/** The first line of every prompt the bridge sends of its own to wake a session (PR 233: `STEER_WAKE`, `DELIVERY_WAKE`). */
export const BRIDGE_WAKE_LINE = '[sminos bridge]';

/**
 * The bridge's wake, by its first line: its prompt as the user (`$.prompt.submit({asUser: true})`), or the inbox frame
 * it sends after an Esc, which the engine keeps as a peer message, idle or queued into a running turn, the line opening
 * its envelope's body.
 */
export function isBridgeWake(row: Json): boolean {
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

/**
 * The first line of the bridge's steer row (doperpowers `hooks/mods/bridge.tsx`, `STEER_LINE`), the owner's words after
 * it; also the line `sminos steer` opens its inbox fallback with.
 */
export const STEER_LINE = '[sminos steer from human]';

/** The one text of a user row: its string content, or its one text block. */
function singleText(row: Json): string | null {
  const content = object(row.message)?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content) || content.length !== 1) return null;
  return isText(content[0]) ? content[0].text : null;
}

/** The owner's words of a steer the bridge marked as one (its one text block, the steer line first), else null. */
export function markedSteerWords(row: Json): string | null {
  if (!isBridgeRow(row)) return null;
  const text = singleText(row);
  return text !== null && text.startsWith(`${STEER_LINE}\n`) ? text.slice(STEER_LINE.length + 1) : null;
}

/**
 * The bridge's mirror of a row it appended for the owner: after a steer's or a delivery's append it logs the words
 * (`$.ui.log`: `steer: <text>`, `delivered: <text>`, a delivery's frame line still in it), which the engine keeps as a
 * system notice under the plugin's name (`<plugin>: steer: …`, either plugin the bridge has run in) for the terminal to
 * draw.
 */
export function isMirrorLine(row: Json): boolean {
  return row.type === 'system' && row.subtype === 'informational' && typeof row.content === 'string' && MIRRORS.some((prefix) => (row.content as string).startsWith(prefix));
}
const MIRRORS = BRIDGE_PLUGINS.flatMap((plugin) => [`${plugin}: steer: `, `${plugin}: delivered: `]);
