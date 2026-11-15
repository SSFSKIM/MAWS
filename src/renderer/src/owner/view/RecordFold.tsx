// A stretch's record line in the to-human view where MAWS draws it (the `record_fold` row the mirror places; the U2b
// execution document, Interfaces §D): closed, `› working record` in the place of the stretch's first folding row;
// opened, `‹ fold to report` under its last. One button, whose accessible name is its text; the stretch's state is the
// tab's, in the store. The two lines stand at the two ends of the stretch, so a press hands focus to the other line once
// it is drawn (the list may not have it mounted: then focus rests where the browser leaves it).
import { useLayoutEffect, useRef } from 'react';
import { useTranscriptStore } from '../../stores/transcript';
import { rowId } from '../../transcript/model/keys';
import type { Row } from '../../transcript/model/rows';
import { useTranscriptContext } from '../../transcript/view/context';
import { RECORD } from './copy';
import './view.css';

let handedFocus: string | null = null; // the line a press asked focus for, until it is drawn

export function RecordFold({ row }: { row: Extract<Row, { kind: 'record_fold' }> }) {
  const { storeKey } = useTranscriptContext();
  const button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (handedFocus !== row.id) return;
    handedFocus = null;
    button.current?.focus({ preventScroll: true });
  }, [row.id]);
  const toggle = () => {
    handedFocus = rowId.recordFold(row.stretch, !row.open);
    useTranscriptStore.getState().toggleStretch(storeKey, row.stretch);
  };
  return (
    <div className="owner-record-fold" data-open={row.open ? '' : undefined}>
      <button ref={button} type="button" aria-expanded={row.open} onClick={toggle}>
        {row.open ? RECORD.open : RECORD.closed}
      </button>
    </div>
  );
}
