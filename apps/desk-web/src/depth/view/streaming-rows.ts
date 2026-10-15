// The streaming layer's blocks as the rows MAWS's transcript view draws after its derived ones (`Transcript`'s `tail`):
// a text block as a live answer, a thinking block as live thinking, each through MAWS's own row components and their
// Markdown. Live thinking is its label alone, as MAWS draws a thinking block with no text: the engine's live
// `thinking` chunks carry none (DC2's walk on 2.1.300, composite 2038124c), and where it records thinking as omitted
// the settled row holds none either. A tool call's input is not drawn while it streams, as MAWS draws none: the call's row appears when its
// transcript row lands. The rows belong to no turn, so they fold with none, and their ids are the block's identity.
import type { Row, RowId } from '../../../../../src/renderer/src/transcript/model/rows';
import type { StreamBlock } from '../stream/layer';

const rowId = (block: StreamBlock) => `desk-stream:${block.turnId}:${block.agentId ?? 'main'}:${block.step}:${block.index}` as RowId;

export function streamingRows(blocks: readonly StreamBlock[], since: (block: StreamBlock) => string): Row[] {
  const rows: Row[] = [];
  for (const block of blocks) {
    if (block.kind === 'text') {
      rows.push({ id: rowId(block), turnId: null, at: since(block), kind: 'assistant_text', messageUuid: null, blockIndex: block.index, markdown: block.text, live: true, phase: 'answer', model: null });
    } else if (block.kind === 'thinking') {
      rows.push({ id: rowId(block), turnId: null, at: since(block), kind: 'thinking', messageUuid: null, text: '', live: true, durationMs: null });
    }
  }
  return rows;
}
