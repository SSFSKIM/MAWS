// A boundary (residue *Boundaries*): a line where the model's context changed — compaction, reset, a retracted
// response, a rewind. A rewind's line offers to show the branch it hid (rendered muted and marked not in context) and
// to hide it again; the rows come and go below the line, so the line itself stays where it is.
import { useTranscriptStore } from '../../../stores/transcript';
import { REWIND_TOGGLE, rewindLabel } from '../../model/copy';
import type { Row } from '../../model/rows';
import { useTranscriptContext } from '../context';

export function BoundaryRow({ row }: { row: Extract<Row, { kind: 'boundary' }> }) {
  const { storeKey } = useTranscriptContext();
  const toggle = row.boundaryKind === 'rewind' && row.hiddenRows > 0;
  return (
    <div className="transcript-boundary" data-boundary-kind={row.boundaryKind} title={row.detail ?? undefined}>
      <span className="transcript-boundary-rule" aria-hidden="true" />
      <span className="transcript-boundary-text">
        <span>{row.boundaryKind === 'rewind' ? rewindLabel(row.hiddenRows) : row.text}</span>
        {row.secondary && <span className="transcript-boundary-secondary">{row.secondary}</span>}
      </span>
      {toggle && (
        <button type="button" className="transcript-quiet-button" aria-expanded={row.revealed} onClick={() => useTranscriptStore.getState().toggleBoundary(storeKey, row.id)}>
          {row.revealed ? REWIND_TOGGLE.hide : REWIND_TOGGLE.show}
        </button>
      )}
      <span className="transcript-boundary-rule" aria-hidden="true" />
    </div>
  );
}
