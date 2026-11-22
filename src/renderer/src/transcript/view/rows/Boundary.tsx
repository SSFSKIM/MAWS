// A boundary (residue *Boundaries*): a line where the model's context changed — compaction, reset, a retracted
// response, a rewind. A rewind's line offers to show the branch it hid (rendered muted and marked not in context) and
// to hide it again; the rows come and go below the line, so the line itself stays where it is. The word cut (T50): a
// line's second sentence (`secondary`, a continued branch's) waits on its words, which take the keyboard; they carry an
// empty title, so the identifiers' title on the row is not drawn over the sentence.
import { useTranscriptStore } from '../../../stores/transcript';
import { REWIND_TOGGLE, rewindLabel } from '../../model/copy';
import type { Row } from '../../model/rows';
import { useTranscriptContext } from '../context';
import { Tip } from '../../../ui/tip';

export function BoundaryRow({ row }: { row: Extract<Row, { kind: 'boundary' }> }) {
  const { storeKey } = useTranscriptContext();
  const toggle = row.boundaryKind === 'rewind' && row.hiddenRows > 0;
  return (
    <div className="transcript-boundary" data-boundary-kind={row.boundaryKind} title={row.detail ?? undefined}>
      <span className="transcript-boundary-rule" aria-hidden="true" />
      <span className="transcript-boundary-text">
        {row.secondary ? (
          <Tip content={row.secondary} description={row.secondary}>
            <span tabIndex={0} title="" className="transcript-boundary-words">{row.text}</span>
          </Tip>
        ) : (
          <span>{row.boundaryKind === 'rewind' ? rewindLabel(row.hiddenRows) : row.text}</span>
        )}
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
