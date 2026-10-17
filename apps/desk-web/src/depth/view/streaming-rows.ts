// The streaming layer's blocks as the rows MAWS's transcript view draws after its derived ones (`Transcript`'s `tail`):
// a text block as a live answer (its to-human marks closed, `live-marks.ts`, so MAWS's Presenter draws an open span as
// it draws a settled one), a thinking block as live thinking, each through MAWS's own row components and their
// Markdown. Live thinking is its label alone, as MAWS draws a thinking block with no text: the engine's live
// `thinking` chunks carry none (DC2's walk on 2.1.300, composite 2038124c), and where it records thinking as omitted
// the settled row holds none either. A tool call's input is not drawn while it streams, as MAWS draws none: the call's row appears when its
// transcript row lands. Their ids are the block's identity.
//
// The report's bridge (DC9; the composite's §9.1, "Streaming in the report"). MAWS's report reads turns: its projection
// groups rows by `turnId` and takes a streaming text's mark from the open turn's live buffers in its own store, which
// DX4's chunks never enter (DC6's settling decision: the reducer pairs a block with its row only by a message id the
// chunks lack). So for the session view the rows are given the turn of the latest row the store holds — the turn the
// model is answering, its prompt's or the notification's that woke it — and a text whose words already carry a mark is
// handed over as a settled text of the same words (`live` off, its marks closed): the projection then reads the mark
// from the text, folds the turn into its working record, and keeps the mark in view, while an unmarked text keeps its
// live drawing and folds inside the record like any unmarked text. Without a turn (a subagent's pane, which draws no
// report) the rows belong to no turn, as DC6 drew them.
import { marksOfText } from '../../../../../src/renderer/src/transcript/model/owner-marks';
import type { Row, RowId, TurnId } from '../../../../../src/renderer/src/transcript/model/rows';
import type { StreamBlock } from '../stream/layer';
import { liveMarkdown } from './live-marks';

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
      const markdown = liveMarkdown(block.text);
      const live = turnId === null || !marksOfText(markdown).marked;
      rows.push({ id: rowId(block), turnId, at: since(block), kind: 'assistant_text', messageUuid: null, blockIndex: block.index, markdown, live, phase: 'answer', model: null });
    } else if (block.kind === 'thinking') {
      rows.push({ id: rowId(block), turnId, at: since(block), kind: 'thinking', messageUuid: null, text: '', live: true, durationMs: null });
    }
  }
  return rows;
}
