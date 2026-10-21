// P4-R7 (the P4 spec's Decision Log 46; the cross-repo contract of doperpowers' to-human message tool spec): a message
// tool's call read as a to-human message. A message the model sends before another tool call goes through a tool,
// since text written there comes back as a progress-update thinking block that no reader shows; the tool's input is
// never summarized. Two tools have the shape, input `{text}` in Markdown and result `sent`: MAWS's own `message`
// (`../maws/message-tool`) and the to-human plugin's, which a MAWS launch does not register but a session outside MAWS,
// or one MAWS's lane was off for, may have called. Every reader of to-human parts reads both names the same way: the
// call is one to-human message, its text the input's whole `text`, at the call's place among the turn's parts, and it
// counts once its result is in and is not an error (an accepted call). A call still waiting for its result is the
// message about to be sent: the live transcript draws it, while readers of a finished record (a summary, a preview)
// wait for the result. A refused or failed call was not sent: it stays the engine's own tool row.
export const MAWS_MESSAGE_TOOL = 'mcp__maws__message';
export const PLUGIN_MESSAGE_TOOL = 'mcp__to-human__message';
export const MESSAGE_TOOLS: readonly string[] = [MAWS_MESSAGE_TOOL, PLUGIN_MESSAGE_TOOL];

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
