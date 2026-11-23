// A stretch's record line in the to-human view where MAWS draws it (the `record_fold` row the mirror places; the U2b
// execution document, Interfaces §D): closed, `› working record` in the place of the stretch's first folding row;
// opened, `‹ fold to report` under its last. One button, whose accessible name is its text; the stretch's state is the
// tab's, in the store. The two lines stand at the two ends of the stretch, so a press hands focus to the other line of
// the same transcript as it is drawn (`handoff.ts`; the list may not have it mounted: then focus rests where the browser
// leaves it). The press resolves that line from the stretch it toggled, as the store gives its keys back. M7 (§M): a
// closed line reads its label where the mirror wrote one, on one line that the column cuts with an ellipsis; the
// button's accessible name is its whole text.
// Board ticket 850: the stretch opens and folds through the shared disclosure motion, as a turn's work area does
// (`transcript/view/motion.ts`): opened, its rows and its `‹ fold to report` grow in from nothing; folded, they close to
// nothing before the store folds it, and a second press while they close takes the fold back. The rows moved are the
// ones the fold adds or takes away (`inStretch`: a mixed head, in sight either way, is not one); under reduced motion it
// changes at once. The other line takes focus only where the reader left it on the line pressed, or nowhere.
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { useTranscriptStore } from '../../stores/transcript';
import { rowId } from '../../transcript/model/keys';
import type { Row } from '../../transcript/model/rows';
import { useTranscriptContext, useWorkMotion } from '../../transcript/view/context';
import { RECORD } from './copy';
import { handFocus, takesFocus } from './handoff';
import { inStretch } from './mirror';
import './view.css';

export function RecordFold({ row }: { row: Extract<Row, { kind: 'record_fold' }> }) {
  const { storeKey, idPrefix } = useTranscriptContext();
  const button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (takesFocus(idPrefix, row.id)) button.current?.focus({ preventScroll: true });
  }, [idPrefix, row.id]);
  const motion = useWorkMotion();
  const set = `stretch:${row.stretch}`;
  const folding = useSyncExternalStore(motion.subscribe, () => row.open && motion.isFoldingRows(set));
  // the other line's id is resolved from the stretch the press toggled, after it: a closed line carries its stretch's
  // first key, not always the key the reader opened it by (regrouping or a page may have moved its first row since)
  const toggle = () => {
    const store = useTranscriptStore.getState();
    const { keys: names, moving } = store.stretchKeys(storeKey, row.stretch);
    const pressed = button.current;
    motion.toggleRows(set, inStretch(new Set(names), new Set(moving)), row.open, () => {
      const state = useTranscriptStore.getState();
      // a fold that ran while something else closed the stretch (who draws changed) leaves it as it is
      if (row.open && !(state.entries[storeKey]?.state.ui.openStretches?.has(row.stretch) ?? false)) return;
      // focus goes to the other line only where the reader left it on the line pressed, or nowhere: focus they moved
      // elsewhere while the fold ran stays where they put it (the review of 2026-11-23)
      const active = document.activeElement;
      const keepsFocus = active === null || active === document.body || active === pressed;
      const keys = state.toggleStretch(storeKey, row.stretch);
      if (keepsFocus) handFocus(idPrefix, keys.map((key) => rowId.recordFold(key, !row.open)));
    });
  };
  return (
    <div className="owner-record-fold" data-open={row.open ? '' : undefined}>
      <button ref={button} type="button" aria-expanded={row.open && !folding} onClick={toggle}>
        {row.open ? RECORD.open : row.label !== undefined ? RECORD.labelled(row.label) : RECORD.closed}
      </button>
    </div>
  );
}
