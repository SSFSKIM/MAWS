// A message between the parent and a subagent (or between agents): one muted line with a bubble mark.
import type { Row } from '../../model/rows';
import { MessageIcon } from './icons';

export function AgentMessageRow({ row }: { row: Extract<Row, { kind: 'agent_message' }> }) {
  return (
    <div className="transcript-lifecycle" data-direction={row.direction}>
      <MessageIcon />
      <span>{row.text}</span>
    </div>
  );
}
