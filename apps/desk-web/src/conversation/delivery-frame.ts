// A delivery's frame line (the composite's §9.1; the DC9 plan's M4 and M6). sminos pushes a send to a session as its
// frame: the first line names the event — `[sminos chat <project> <writer_short>:<seq> from <from> → <@you | @all>[ |
// unread N]]`, or `[sminos message from <via or from> id=<msg_id>]` for an event with a `msg_id` (doperpowers'
// `sminos.py`: `compose_chat_frame`, `compose_frame`) — and the text follows it. A row is a delivery only when it marks a
// delivery's provenance: the bridge submits as the user (`$.prompt.submit({asUser: true})` writes a user row whose
// `origin` is `{kind: "plugin", asUser: true}`), and the other last hops queue the prompt as a peer's or a plugin's. A
// prompt typed at the terminal, or a row that marks no origin, never is.
//
// The tail matches a send by its frame (`tail.ts`). The session view draws a delivered row without its frame line: the
// owner's own send (`from human`) needs none, its bubble says who wrote it; a peer's draws it as a label, the sender's
// name in its own first paragraph. The label is in the text, not beside the bubble, because a delivery the engine queued
// into a running turn is drawn as MAWS draws any prompt queued there — a bubble in the turn, under the queued message's
// own uuid (`source_uuid`), captioned "Sent during this turn" — and that caption is MAWS's alone. MAWS's backfill would
// otherwise keep such a delivery as a synthetic peer message and draw no body for it (its peer parser reads MAWS's own
// envelope, not sminos's frame), so its drawing's copy takes the shape MAWS gives a prompt queued at the terminal
// (`humanQueuedPrompt`). The text the session read is otherwise unchanged; only the drawing's copy of the row changes,
// the held row stays verbatim for the tail.
import type { JsonObject } from 'desk-hub/protocol';

const object = (value: unknown): JsonObject | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : null);

/** Where a row's prompts are, when it marks a delivery's provenance; null for any other row. */
type Prompts = { kind: 'content'; content: string | unknown[] } | { kind: 'queued'; prompt: string };

function deliveredPrompts(row: JsonObject): Prompts | null {
  if (row.type === 'user') {
    const origin = object(row.origin);
    if (origin?.kind !== 'plugin' || origin.asUser !== true) return null;
    const content = object(row.message)?.content;
    return typeof content === 'string' || Array.isArray(content) ? { kind: 'content', content } : null;
  }
  const attachment = object(row.attachment);
  if (row.type !== 'attachment' || attachment?.type !== 'queued_command' || typeof attachment.prompt !== 'string') return null;
  const origin = object(attachment.origin);
  return origin?.kind === 'peer' || origin?.kind === 'plugin' ? { kind: 'queued', prompt: attachment.prompt } : null;
}

const firstLine = (text: string) => text.split('\n', 1)[0];
const isText = (block: unknown): block is { type: 'text'; text: string } => object(block)?.type === 'text' && typeof object(block)!.text === 'string';

/**
 * The first lines of the prompts a row carries that may be deliveries: a user row's text or text blocks (never a tool's
 * result), a queued command's prompt; none for a row that marks no delivery's provenance.
 */
export function deliveredLines(row: JsonObject): string[] {
  const prompts = deliveredPrompts(row);
  if (prompts === null) return [];
  if (prompts.kind === 'queued') return [firstLine(prompts.prompt)];
  if (typeof prompts.content === 'string') return [firstLine(prompts.content)];
  return prompts.content.flatMap((block) => (isText(block) ? [firstLine(block.text)] : []));
}

const CHAT = /^\[sminos chat .+? \S+:\d+ from (.+) → @(?:you|all)(?: \| unread [1-9][0-9]*)?\]$/;
const MESSAGE = /^\[sminos message from (.+) id=\S+\]$/;

/** Who a frame line says sent the event, or null when the line is not a whole frame. */
function senderOf(line: string): string | null {
  return (CHAT.exec(line) ?? MESSAGE.exec(line))?.[1] ?? null;
}

/** The first prompt text of a delivered row, where its frame would be. */
function firstPrompt(prompts: Prompts): string | null {
  if (prompts.kind === 'queued') return prompts.prompt;
  if (typeof prompts.content === 'string') return prompts.content;
  return prompts.content.find(isText)?.text ?? null;
}

/** The frame a delivered row opens with — who sent it, and whether that is the owner — or null for any other row. */
export function deliveryFrame(row: JsonObject): { from: string; own: boolean } | null {
  const prompts = deliveredPrompts(row);
  const text = prompts && firstPrompt(prompts);
  if (!text?.includes('\n')) return null;
  const from = senderOf(firstLine(text));
  return from === null ? null : { from, own: from === 'human' };
}

/** A sender's name as Markdown text: every character Markdown could read as syntax escaped. */
const literal = (text: string) => text.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, '\\$&');

/**
 * The row as the session view draws it: a delivered row with its frame line dropped (the owner's own send) or drawn as
 * a label naming the peer who sent it, and a delivery queued into a running turn in the shape of a prompt queued there,
 * under the queued message's own uuid; any other row as it is.
 */
export function deliveryAsDrawn(row: JsonObject): JsonObject {
  const frame = deliveryFrame(row);
  if (frame === null) return row;
  const cut = (text: string) => (frame.own ? '' : `*From ${literal(frame.from)}*\n\n`) + text.slice(text.indexOf('\n') + 1);
  const prompts = deliveredPrompts(row)!;
  if (prompts.kind === 'queued') {
    const attachment = { ...object(row.attachment)! };
    delete attachment.isMeta; // MAWS reads a meta queued prompt as context, not as a prompt
    const source = typeof attachment.source_uuid === 'string' && attachment.source_uuid !== '' ? attachment.source_uuid : row.uuid;
    return { ...row, attachment: { ...attachment, prompt: cut(prompts.prompt), commandMode: 'prompt', origin: { kind: 'human' }, source_uuid: source as string } };
  }
  const message = object(row.message)!;
  if (typeof prompts.content === 'string') return { ...row, message: { ...message, content: cut(prompts.content) } };
  const first = prompts.content.findIndex(isText);
  const content = prompts.content.map((block, i) => (i === first ? { ...(block as JsonObject), text: cut((block as { text: string }).text) } : block)) as JsonObject[];
  return { ...row, message: { ...message, content } };
}
