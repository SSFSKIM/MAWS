// A message tool's body is a message in the transcript, never an MCP detail row or a MAWS report card: the same drawing
// as a `<message>` span (`owner/view/Message.tsx`).
import type { Row } from '../../transcript/model/rows';
import { messagePresentation } from './Presenter';

export function ToHumanMessageRow({ row }: { row: Extract<Row, { kind: 'to_human' }> }) {
  return <div data-to-human-call={row.toolUseId}>{messagePresentation(row.text)}</div>;
}
