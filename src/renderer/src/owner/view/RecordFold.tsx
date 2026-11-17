// A stretch's record line in the to-human view where MAWS draws it (the `record_fold` row the mirror places; the U2b
// execution document, Interfaces §D): closed, `› working record` in the place of the stretch's first folding row;
// opened, `‹ fold to report` under its last. One button, whose accessible name is its text; the stretch's state is the
// tab's, in the store. The two lines stand at the two ends of the stretch, so a press hands focus to the other line of
// the same transcript as it is drawn (`handoff.ts`; the list may not have it mounted: then focus rests where the browser
// leaves it). The press resolves that line from the stretch it toggled, as the store gives its keys back.
import { useLayoutEffect, useRef } from 'react';
import { useTranscriptStore } from '../../stores/transcript';
import { rowId } from '../../transcript/model/keys';
import type { Row } from '../../transcript/model/rows';
import { useTranscriptContext } from '../../transcript/view/context';
import { RECORD } from './copy';
import { handFocus, takesFocus } from './handoff';
import './view.css';

export function RecordFold({ row }: { row: Extract<Row, { kind: 'record_fold' }> }) {
  const { storeKey, idPrefix } = useTranscriptContext();
  const button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (takesFocus(idPrefix, row.id)) button.current?.focus({ preventScroll: true });
  }, [idPrefix, row.id]);
  // the other line's id is resolved from the stretch the press toggled, after it: a closed line carries its stretch's
  // first key, not always the key the reader opened it by (regrouping or a page may have moved its first row since)
  const toggle = () => {
    const keys = useTranscriptStore.getState().toggleStretch(storeKey, row.stretch);
    handFocus(idPrefix, keys.map((key) => rowId.recordFold(key, !row.open)));
  };
  return (
    <div className="owner-record-fold" data-open={row.open ? '' : undefined}>
      <button ref={button} type="button" aria-expanded={row.open} onClick={toggle}>
        {row.open ? RECORD.open : RECORD.closed}
      </button>
    </div>
  );
}
