// E3 (M3): a side thread opened from this session (E3 execution document, Design §6): one row per thread, updated in
// place as the thread's turns end. A thread glyph, "Side thread on `x.ts:42` opened" (then "finished: …", "ended with an
// error: …", with the turn count past one), and Open, which shows the thread in this session's Side pane. A row whose
// `opened` has not arrived yet names the thread by its record's title. It stays in view when its turn folds
// (isPersistentRow).
import { useSessions } from '../../../stores/sessions';
import { displayTitle } from '../../../sessions/title';
import { SIDE_COPY, sideRowStatus } from '../../../side/copy';
import type { Row } from '../../model/rows';
import { useActions, useRowSession } from '../context';
import { ThreadIcon } from './icons';

type SideThreadRowData = Extract<Row, { kind: 'side_thread' }>;

export function SideThreadRow({ row }: { row: SideThreadRowData }) {
  const actions = useActions();
  const parent = useRowSession();
  const child = useSessions((s) => s.records.get(row.childAppSessionId) ?? null);
  const label = row.label ?? (row.openedBy === null && child !== null ? displayTitle(child) : SIDE_COPY.label(null, row.openedBy));
  return (
    <section className="transcript-side-thread" data-side-thread={row.childAppSessionId} data-state={row.state}>
      <ThreadIcon />
      <p className="transcript-side-thread-text">
        {SIDE_COPY.row.lead} <code className="transcript-side-thread-label">{label}</code> {sideRowStatus(row)}
      </p>
      <button type="button" className="transcript-quiet-button" disabled={parent === null} onClick={() => parent !== null && actions.openSideThread(parent, row.childAppSessionId)}>
        {SIDE_COPY.row.open}
      </button>
    </section>
  );
}
