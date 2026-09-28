// PLACEHOLDER rows for the kinds M5 builds (plan, question, request slot, boundary and error rows): one plain line
// each. Replaced kind by kind; nothing here is a design.
import { requestSlotPlaceholder } from '../../model/copy';
import type { Row } from '../../model/rows';

function lineOf(row: Row): string {
  switch (row.kind) {
    case 'plan': return `Plan · ${row.outcome ?? 'Pending'}`;
    case 'question': return row.questions.map((question) => question.header || question.question).join(' · ');
    case 'request_slot': return requestSlotPlaceholder(row.toolName ?? row.requestKind);
    case 'error': case 'boundary': return row.text;
    default: return row.kind;
  }
}

export function PlaceholderRow({ row }: { row: Row }) {
  return <div className="transcript-placeholder">{lineOf(row)}</div>;
}
