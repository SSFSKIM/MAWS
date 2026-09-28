// One X3 row → its component, in the transcript's reading column. The wrapper carries the row's element id (the
// divider's aria-controls names work-area rows by it), its kind and turn for tests and the harness, and is focusable
// so a jump can land on it.
import type { Row } from '../../model/rows';
import { rowElementId, useTranscriptContext } from '../context';
import { AssistantTextRow } from './AssistantText';
import { DividerRow } from './Divider';
import { LocalCommandRow } from './LocalCommand';
import { PlaceholderRow } from './Placeholder';
import { ThinkingRow } from './Thinking';
import { TimeRow } from './Time';
import { UserRow } from './User';

function body(row: Row) {
  switch (row.kind) {
    case 'time': return <TimeRow row={row} />;
    case 'user': return <UserRow row={row} />;
    case 'assistant_text': return <AssistantTextRow row={row} />;
    case 'thinking': return <ThinkingRow row={row} />;
    case 'divider': return <DividerRow row={row} />;
    case 'local_command': return <LocalCommandRow row={row} />;
    default: return <PlaceholderRow row={row} />;
  }
}

export function RowView({ row }: { row: Row }) {
  const { idPrefix } = useTranscriptContext();
  return (
    <div id={rowElementId(idPrefix, row.id)} className="transcript-row" data-kind={row.kind} data-turn-id={row.turnId ?? undefined} tabIndex={-1}>
      {body(row)}
    </div>
  );
}
