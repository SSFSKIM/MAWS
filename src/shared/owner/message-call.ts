// P4-R7z (the P4 spec's Decision Log 92, reversing Decision Logs 48 to 50 in part; the cross-repo contract of doperpowers'
// to-human message tool spec): a message tool's call read as a to-human message. A message the model sends before
// another tool call goes through a tool, since text written there comes back as a progress-update thinking block that no
// reader shows; the tool's input is never summarized. A MAWS session messages its human through the to-human plugin's
// `mcp__to-human__message` (input `{text, final}` in Markdown, result `sent`), the one message tool it has: MAWS offers
// none of its own, and its launch turns the lane on only for a style whose plugin registers that tool
// (`../../main/owner/launch.ts`). MAWS's own `mcp__maws__message` (P4-R7, input `{text}`, result `sent`) left its tool
// server; a recorded session's calls of it still read as messages, so history reads as it did. Every MAWS reader of
// to-human parts reads both names the same way: the call is one to-human message, its text the input's whole `text`, at
// the call's place among the turn's parts, and it counts once its result is in and is not an error (an accepted call).
// A call still waiting for its result is the message about to be sent: the live transcript draws it, while readers of a
// finished record (a summary, a preview) wait for the result. A refused or failed call was not sent: it stays the
// engine's own tool row.
export const PLUGIN_MESSAGE_TOOL = 'mcp__to-human__message';
export const MAWS_MESSAGE_TOOL = 'mcp__maws__message'; // P4-R7's, in recorded sessions only
export const MESSAGE_TOOLS: readonly string[] = [PLUGIN_MESSAGE_TOOL, MAWS_MESSAGE_TOOL];

export const isMessageTool = (toolName: unknown): boolean => typeof toolName === 'string' && MESSAGE_TOOLS.includes(toolName);

// The message a call's input carries, whole; null when the input holds none (no text, or only whitespace), which the
// tool refuses.
export function messageCallText(input: unknown): string | null {
  const text = typeof input === 'object' && input !== null ? (input as { text?: unknown }).text : undefined;
  return typeof text === 'string' && text.trim() !== '' ? text : null;
}

// Where a call stands: `pending` until its result is in, `sent` once it is in and is no error, `refused` once it is an
// error (a refusal, a denial, a failure).
export type MessageCallState = 'pending' | 'sent' | 'refused';
export const messageCallState = (result: { isError: boolean } | null | undefined): MessageCallState =>
  result === null || result === undefined ? 'pending' : result.isError ? 'refused' : 'sent';

// A response a hook made up in place of a request: the engine gives it a `msg_hook_` message id, whichever plugin made
// it. The live normaliser streams no partials of one (its text is not known to be a reply until it is whole).
export const isHookMadeMessageId = (id: unknown): boolean => typeof id === 'string' && id.startsWith('msg_hook_');

// The response the to-human plugin makes up after a final message (doperpowers #411, to-human 0.7.0): a call of its
// tool with `final: true` ends the turn once sent, the plugin answering the engine's next step itself with no request.
// The answer is one text block, `Message sent to the human.`, under a `msg_hook_` message id with no request id; the
// transcript's record of it carries the engine's `answeredWithoutRequest` flag too, which the stream-json frame does not
// (doperpowers #415's live MAWS check). The plugin's view draws it as nothing, and no MAWS reader shows it, counts it or
// takes it as a session's last line: the backfill and the live normaliser map it to no event, so no reader of events
// meets it; the readers of records (the summary, the search text) pass over it, and the desk's reading of what a
// response read does not count it, since it read nothing. Known by where it came from (the flag, or a hook-made id) and
// by its exact text, as the plugin's view knows it, so another hook's made-up response and a model that writes the same
// sentence stay as written. Self-contained, `isHookMadeMessageId`'s prefix spelled out: the search text's worker runs
// its source.
export function isMadeUpFinalAnswer(record: { type?: unknown; answeredWithoutRequest?: unknown; message?: unknown }): boolean {
  const message = record.message as { id?: unknown; content?: unknown } | null | undefined;
  const madeUp = record.answeredWithoutRequest === true || (typeof message?.id === 'string' && message.id.startsWith('msg_hook_'));
  const block = Array.isArray(message?.content) && message.content.length === 1 ? (message.content[0] as { type?: unknown; text?: unknown } | null) : null;
  return record.type === 'assistant' && madeUp && block?.type === 'text' && typeof block.text === 'string' && block.text.trim() === 'Message sent to the human.';
}
