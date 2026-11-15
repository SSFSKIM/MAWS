// UX wave U1b (docs/doperpowers/plans/2026-11-15-ux-wave-U1b-requests-in-transcript.md, Interfaces §C and §D "A waiting
// row"; decisions 3 and 8a): a question, ask or plan row that waits draws its request's form in place of its receipt,
// through the host seam (`renderRequest`, handed a slot value for the request, never a row of the list), inside an
// element the transcript tracks. Only while the session's list names the call with a request that is no permission
// prompt, whose delivery is not closed as answered elsewhere, and with a renderer present: otherwise the row draws its
// receipt as before, so a row never draws an empty form slot. The row asks no mod's site of its own while the form stands
// (law 2: the card asks the AskUserQuestion site for its form, once).
import { useCallback, useMemo, type ReactNode } from 'react';
import { selectWaitingByCall, useAttention } from '../../../stores/attention';
import { rowId } from '../../model/keys';
import type { Row } from '../../model/rows';
import { useRowSession, useTranscriptContext } from '../context';
import { useWaitingView } from '../waiting-view';
import { AskCapsule } from './AskCapsule';

type FormRow = Extract<Row, { kind: 'question' | 'plan' | 'ask' }>;
type Slot = Extract<Row, { kind: 'request_slot' }>;

// The form of a waiting row, or null when the row draws its receipt.
function useWaitingForm(row: FormRow): ReactNode {
  const { renderRequest } = useTranscriptContext();
  const session = useRowSession();
  const item = useAttention((s) => (session === null ? undefined : selectWaitingByCall(s, session).get(row.toolUseId)));
  const closed = useAttention((s) => item !== undefined && s.deliveries.get(item.id)?.phase === 'closed');
  const { track } = useWaitingView();
  const id = item?.id;
  const tracked = useCallback((element: HTMLDivElement | null) => {
    if (id !== undefined) track(id, element);
  }, [id, track]);
  const slot = useMemo<Slot | null>(() => {
    const requestId = item?.request.requestId ?? null;
    if (item === undefined || requestId === null) return null;
    return { kind: 'request_slot', id: rowId.slot(requestId), turnId: row.turnId, at: row.at, requestId, toolUseId: row.toolUseId, requestKind: row.kind === 'plan' ? 'plan' : 'question', toolName: null, requestedAt: item.createdAt };
  }, [item, row.turnId, row.at, row.toolUseId, row.kind]);
  if (renderRequest === null || item === undefined || item.kind === 'permission' || closed || slot === null) return null;
  return (
    <div ref={tracked} className="transcript-waiting-form" data-waiting-form={item.id}>
      {renderRequest(slot)}
    </div>
  );
}

/** A waiting question or plan row: the form while it stands, else `receipt`, the row as it draws without one. */
export function WaitingRow({ row, receipt }: { row: Extract<Row, { kind: 'question' | 'plan' }>; receipt: ReactNode }) {
  return useWaitingForm(row) ?? receipt;
}

/** A waiting ask's capsule: its top line, and the form under it while it stands. */
export function WaitingAsk({ row }: { row: Extract<Row, { kind: 'ask' }> }) {
  return <AskCapsule row={row} form={useWaitingForm(row)} />;
}
