// The streaming layer's blocks as the rows MAWS's transcript view draws after its derived ones (`Transcript`'s `tail`):
// a text block as a live answer with its authored text unchanged (UX1-C: unfinished marks stay literal, only closed
// marks receive ink), a thinking block as live thinking, each through MAWS's own row components and their Markdown.
// Live thinking is its label alone, as MAWS draws a thinking block with no text: the engine's live
// `thinking` chunks carry none (DC2's walk on 2.1.300, composite 2038124c), and where it records thinking as omitted
// the settled row holds none either. A tool call's input is not drawn while it streams, as MAWS draws none: the call's row appears when its
// transcript row lands. Except a message tool's (the to-human plugin's, or MAWS's former one, which MAWS reads alike,
// `@shared/owner/message-call`): its input is the message itself, which the session writes to its owner as it would write a
// `<message>` span, so it is drawn as it streams (`message-input.ts`) as the row MAWS draws for the call once it lands, a
// `to_human` row (P4-R7), its result still to come. Their ids are the block's identity.
//
// The report's bridge (DC9; the composite's §9.1, "Streaming in the report"). MAWS's report reads turns: its projection
// groups rows by `turnId` and reads streaming marks independently of their closed-only ink. DX4's chunks never enter
// its live buffers (DC6's settling decision: the reducer pairs a block with its row only by a message id the chunks
// lack), so these live rows carry their raw text inline. The projection reads that text as it reads a native live
// buffer: even an open mark folds the turn into its working record, without repairing the displayed text. The rows
// belong to the latest stored turn — the prompt or notification the model is answering. A message tool's streaming
// message marks its turn as its landed row does (`to_human`). Without a turn (a subagent's pane, which draws no report)
// the rows belong to no turn, as DC6 drew them.
import type { ToolUseId } from '@shared/graph/ids';
import type { Row, RowId, TurnId } from '../../../../../src/renderer/src/transcript/model/rows';
import { isMessageTool } from '@shared/owner/message-call';
import type { StreamBlock } from '../stream/layer';
import { streamingMessageText } from './message-input';

const rowId = (block: StreamBlock) => `desk-stream:${block.turnId}:${block.agentId ?? 'main'}:${block.step}:${block.index}` as RowId;

/** The turn the model is answering: the latest turn among the rows the store derived, or none before the first. */
export function latestTurn(rows: readonly Row[]): TurnId | null {
  return rows.findLast((row) => row.turnId !== null)?.turnId ?? null;
}

/** `turn`: the turn the blocks belong to (the report's bridge); absent, they belong to none. */
export function streamingRows(blocks: readonly StreamBlock[], since: (block: StreamBlock) => string, options: { turn?: TurnId | null } = {}): Row[] {
  const turnId = options.turn ?? null;
  const rows: Row[] = [];
  for (const block of blocks) {
    if (block.kind === 'text') {
      rows.push({ id: rowId(block), turnId, at: since(block), kind: 'assistant_text', messageUuid: null, blockIndex: block.index, markdown: block.text, live: true, phase: 'answer', model: null });
    } else if (block.kind === 'thinking') {
      rows.push({ id: rowId(block), turnId, at: since(block), kind: 'thinking', messageUuid: null, text: '', live: true, durationMs: null });
    } else if (isMessageTool(block.toolName) && block.toolUseId !== null) {
      const text = streamingMessageText(block.text);
      if (text !== null) rows.push({ id: rowId(block), turnId, at: since(block), kind: 'to_human', toolUseId: block.toolUseId as ToolUseId, text, pending: true });
    }
  }
  return rows;
}
