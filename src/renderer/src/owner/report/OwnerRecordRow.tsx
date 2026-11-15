// A marked turn's working record in the report view (the `owner_record` row; the P2-C document, Design §7): closed,
// "Working record" with what it holds in muted text (the divider's tool calls, the texts with unmarked words), so
// nothing is hidden silently, and a running mark while the turn works; opened, the turn's own summary and expanded
// work, without a second turn-level fold. One click either way; the record's state is the reader's, per turn, in the store.
import { useTranscriptStore } from '../../stores/transcript';
import type { Row } from '../../transcript/model/rows';
import { useTranscriptContext } from '../../transcript/view/context';
import { Chevron } from '../../transcript/view/rows/parts';
import { DividerDetails, PluginStatusLine, useDividerSummary } from '../../transcript/view/rows/Divider';
import { REPORT } from './copy';
import './report.css';

export function OwnerRecordRow({ row }: { row: Extract<Row, { kind: 'owner_record' }> }) {
  const { storeKey } = useTranscriptContext();
  const divider = row.divider;
  const toggle = () => row.turnId !== null && useTranscriptStore.getState().toggleReportRecord(storeKey, row.turnId);
  // Change only the disclosure's contents: keyboard focus stays on this button in both directions.
  const { label, controls, durationMs } = useDividerSummary(divider, row.open);
  const counts = [row.toolCalls > 0 ? REPORT.toolCalls(row.toolCalls) : null, row.messages > 0 ? REPORT.messages(row.messages) : null].filter((part) => part !== null);
  return (
    <>
      <div className={row.open && divider ? 'transcript-divider' : 'owner-record'} data-working={row.working ? '' : undefined}>
        <button type="button" className="transcript-disclosure" aria-expanded={row.open} aria-controls={controls || undefined} onClick={toggle}>
          <Chevron />
          {row.open ? (divider ? label : REPORT.fold) : REPORT.record}
          {!row.open && row.working && (
            <span className="transcript-working-dots owner-record-running" role="img" aria-label={REPORT.running}>
              <span />
              <span />
              <span />
            </span>
          )}
          {!row.open && counts.length > 0 && <span className="owner-record-counts">{counts.map((part) => ` · ${part}`).join('')}</span>}
        </button>
        {row.open && divider && <DividerDetails row={divider} durationMs={durationMs} />}
      </div>
      {row.open && divider?.state === 'working' && <PluginStatusLine storeKey={storeKey} />}
    </>
  );
}
