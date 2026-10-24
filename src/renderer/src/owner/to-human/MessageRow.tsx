// A message tool's body is a message in the transcript, never an MCP detail row or a MAWS report card.
import type { Row } from '../../transcript/model/rows';
import { messagePresentation } from './Presenter';

export function ToHumanMessageRow({ row }: { row: Extract<Row, { kind: 'to_human' }> }) {
  return <div data-to-human-call={row.toolUseId}>{messagePresentation(row.text)}</div>;
}
