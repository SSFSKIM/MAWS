// The one extraction of what a session said to its human (P5 O8 M7b; the architect's condition, the O8 document's
// Decision Log "M7b's refresh at its cut", item 4). Every MAWS reader that counts a to-human message or question reads
// it here, so no two of them can disagree about what was one: the transcript's `to_human` row, which the report view
// draws at level 0 (src/renderer/src/transcript/model/derive.ts), the owner channel's marks (src/services/owner/
// projection.ts) and the spine's project-channel journal (src/services/channel/lane-b.ts).
// - A message is a message tool's call (`message-call.ts`: the to-human plugin's, and MAWS's former one in a recorded
//   session), its whole input text, at the call's place; or a to-human part of a finished assistant text (a `<message>`
//   span, or the legacy `<to-human>`), one per part as the parser reads it, so a message a nested mark splits is the two
//   messages the report draws.
// - A question is a need-input part of the same text, numbered as the owner channel numbers its marks (`marks.ts`'s
//   `span`), so a question's mark id names it.
// - Neither is an essential, an insight or plain text.
import type { SessionEvent } from '../graph/events';
import type { MessageUuid } from '../graph/ids';
import { questionHead } from './marks';
import { isMessageTool, messageCallState, messageCallText, type MessageCallState } from './message-call';
import { parse, type Choice } from './to-human-parser';

export type ToHumanItem =
  | { kind: 'message'; text: string; span: number } // span: its ordinal among the text's messages
  | { kind: 'question'; text: string; head: string; choices: Choice[]; span: number }; // span: its ordinal among the text's questions (a mark's)

/** A finished assistant text's messages and questions, in the text's order. */
export function toHumanOfText(text: string): ToHumanItem[] {
  const items: ToHumanItem[] = [];
  let messages = 0;
  let questions = 0;
  for (const part of parse(text)) {
    if (part.kind === 'to-human') items.push({ kind: 'message', text: part.text, span: messages++ });
    else if (part.kind === 'need-input') items.push({ kind: 'question', text: part.text, head: questionHead(part.text), choices: part.choices ?? [], span: questions++ });
  }
  return items;
}

export type CallMessage = { text: string; state: MessageCallState };

/**
 * A tool call read as the message it sends: its text and where the call stands (pending, sent, refused); null for a
 * call of another tool, or of a message tool with no words in its input, which the tool refuses.
 */
export function messageOfCall(use: { toolName: unknown; input: unknown }, result: { isError: boolean } | null | undefined): CallMessage | null {
  if (!isMessageTool(use.toolName)) return null;
  const text = messageCallText(use.input);
  return text === null ? null : { text, state: messageCallState(result) };
}

export type FinishedText = { text: string; messageUuid: MessageUuid; blockIndex: number; aborted: boolean };

/**
 * A finished text block of the main conversation, its text and anchor: none for a subagent's block, a block of another
 * type, or the engine's synthetic API-error message, which the transcript draws as an error. `aborted` says an interrupt
 * flushed it partway: the transcript still draws its words, and the owner channel keeps no mark of it.
 */
export function finishedTextOf(event: SessionEvent): FinishedText | null {
  if (event.kind !== 'assistant.block.complete' || event.parentToolUseId !== null || event.isApiErrorMessage === true) return null;
  if (event.block.type !== 'text' || typeof event.block.text !== 'string') return null;
  return { text: event.block.text, messageUuid: event.messageUuid, blockIndex: event.blockIndex, aborted: event.aborted };
}
