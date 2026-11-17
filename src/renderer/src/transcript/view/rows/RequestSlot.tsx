// A pending request's slot (X4: the card is C7's): the node `renderRequest` returns, docked where the request arose,
// or, without one, a status line saying what waits and where to answer. `jumpTo` targets this row when Needs-you opens
// the session at its pending request. The placeholder is a live region; a card is not wrapped in one, since its own
// controls changing would be announced as status. UX wave U1b (§C): no row is made for a request any more; the slots
// that pass are desk web's own rows and the transcript's end row, which with no renderer draws nothing.
import { requestSlotPlaceholder } from '../../model/copy';
import { END_ROW } from '../../model/keys';
import type { Row } from '../../model/rows';
import { useTranscriptContext } from '../context';

export function RequestSlotRow({ row }: { row: Extract<Row, { kind: 'request_slot' }> }) {
  const { renderRequest } = useTranscriptContext();
  if (renderRequest) {
    return (
      <div className="transcript-slot" data-request-id={row.requestId}>
        {renderRequest(row)}
      </div>
    );
  }
  if (row.id === END_ROW) return null;
  return (
    <div className="transcript-slot transcript-slot-placeholder" data-request-id={row.requestId} role="status">
      {requestSlotPlaceholder(row.toolName ?? row.requestKind)}
    </div>
  );
}
