// A marked turn's working record in the report view (the `owner_record` row; the P2-C document, Design §7): closed,
// "Working record" with what it holds in muted text (the divider's tool calls, the texts with unmarked words), so
// nothing is hidden silently, and a running mark while the turn works; opened, "Fold to report", above the turn as the
// full transcript draws it. One click either way; the record's state is the reader's, per turn, in the store.
import { useTranscriptStore } from '../../stores/transcript';
import type { Row } from '../../transcript/model/rows';
import { useTranscriptContext } from '../../transcript/view/context';
import { Chevron } from '../../transcript/view/rows/parts';
import { REPORT } from './copy';
import './report.css';

export function OwnerRecordRow({ row }: { row: Extract<Row, { kind: 'owner_record' }> }) {
  const { storeKey } = useTranscriptContext();
  const counts = [row.toolCalls > 0 ? REPORT.toolCalls(row.toolCalls) : null, row.messages > 0 ? REPORT.messages(row.messages) : null].filter((part) => part !== null);
  return (
    <div className="owner-record" data-working={row.working ? '' : undefined}>
      <button type="button" className="transcript-disclosure" aria-expanded={row.open} onClick={() => row.turnId !== null && useTranscriptStore.getState().toggleReportRecord(storeKey, row.turnId)}>
        <Chevron />
        {row.open ? REPORT.fold : REPORT.record}
        {!row.open && row.working && (
          <span className="transcript-working-dots owner-record-running" role="img" aria-label={REPORT.running}>
            <span />
            <span />
            <span />
          </span>
        )}
        {!row.open && counts.length > 0 && <span className="owner-record-counts">{counts.map((part) => ` · ${part}`).join('')}</span>}
      </button>
    </div>
  );
}
