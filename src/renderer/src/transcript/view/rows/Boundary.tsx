// A boundary (residue *Boundaries*): a line where the model's context changed — compaction, reset, a retracted
// response, a rewind. A rewind's line offers to show the branch it hid (rendered muted and marked not in context) and
// to hide it again; the rows come and go below the line, so the line itself stays where it is. The word cut (T50): a
// line's second sentence (`secondary`, a continued branch's) waits on its words, which take the keyboard. Where nothing
// points the sentence stands after them (the touch rule, ticket 830). Ticket 815: the identifiers (`detail`) wait on the
// same words, under the sentence, and only there: they are the developer's words the cut took off the screen, so a
// screen that cannot point does not draw them. Board ticket 850: the branch's rows come and go through the shared
// disclosure motion, as a turn's work area does (`motion.ts`): revealed, they grow in from nothing; hidden, they close to
// nothing before the store hides them, and a second press while they close takes it back.
import { useSyncExternalStore } from 'react';
import { useTranscriptStore } from '../../../stores/transcript';
import { REWIND_TOGGLE, rewindLabel } from '../../model/copy';
import type { Row } from '../../model/rows';
import { useTranscriptContext, useWorkMotion } from '../context';
import { Tip } from '../../../ui/tip';
import { TouchFact } from '../../../ui/touch-fact';

export function BoundaryRow({ row }: { row: Extract<Row, { kind: 'boundary' }> }) {
  const { storeKey } = useTranscriptContext();
  const toggle = row.boundaryKind === 'rewind' && row.hiddenRows > 0;
  const motion = useWorkMotion();
  const key = `branch:${row.id}`;
  const hiding = useSyncExternalStore(motion.subscribe, () => row.revealed && motion.isFoldingRows(key));
  const press = () => {
    const turns = new Set(useTranscriptStore.getState().entries[storeKey]?.state.hidden?.branches.get(row.id)?.turns ?? []);
    motion.toggleRows(key, (candidate) => candidate.turnId !== null && turns.has(candidate.turnId), row.revealed, () => {
      const current = useTranscriptStore.getState().entries[storeKey]?.rows.find((candidate) => candidate.id === row.id);
      if (current?.kind !== 'boundary' || current.revealed === row.revealed) useTranscriptStore.getState().toggleBoundary(storeKey, row.id);
    });
  };
  const words = row.secondary ? row.text : row.boundaryKind === 'rewind' ? rewindLabel(row.hiddenRows) : row.text;
  const facts = [row.secondary, row.detail].filter((fact): fact is string => typeof fact === 'string' && fact !== '');
  return (
    <div className="transcript-boundary" data-boundary-kind={row.boundaryKind}>
      <span className="transcript-boundary-rule" aria-hidden="true" />
      <span className="transcript-boundary-text">
        {facts.length > 0 ? (
          <>
            <Tip content={facts.map((fact, index) => <span key={index} className={index === 0 ? 'block' : 'block text-fg-muted'}>{fact}</span>)} description={facts.join(' · ')}>
              <span tabIndex={0} className="transcript-boundary-words">{words}</span>
            </Tip>
            <TouchFact className="ms-1">{row.secondary}</TouchFact>
          </>
        ) : (
          <span>{words}</span>
        )}
      </span>
      {toggle && (
        <button type="button" className="transcript-quiet-button" aria-expanded={row.revealed && !hiding} onClick={press}>
          {row.revealed && !hiding ? REWIND_TOGGLE.hide : REWIND_TOGGLE.show}
        </button>
      )}
      <span className="transcript-boundary-rule" aria-hidden="true" />
    </div>
  );
}
