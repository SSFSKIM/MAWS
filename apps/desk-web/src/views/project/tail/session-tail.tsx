// What only the log and the hub know, joined to the session view's transcript at its tail (the composite's §9.1; the DC9
// plan's M4): the sends not yet in the transcript (`conversation/tail.ts`), then the session's pending requests as the
// channel's own cards, answerable in place and gone once settled (the owner's 2B: inline, never folded inside a working
// record, since they come after the last one), then, for an ended or retired session, its end marker.
//
// They reach MAWS's `Transcript` as the rows after its derived ones (its `tail`), each a `request_slot` row with no turn —
// so the report never folds it — drawn by the view's `renderRequest`, the one seam MAWS's list offers for a row of the
// host's own. The rows carry only their identity; what each draws is read from this module's context, so a delivery's
// new state redraws its bubble alone and the list's rows keep their keys.
import { createContext, useContext, type ReactNode } from 'react';
import type { RequestId } from '@shared/graph/ids';
import type { Row, RowId } from '../../../../../../src/renderer/src/transcript/model/rows';
import type { TranscriptProps } from '../../../../../../src/renderer/src/transcript/view/Transcript';
import { footOf, type FootContext, type TailSend } from '../../../conversation/tail';
import type { DeskSession } from '../../../shell/sessions';
import { RequestCard } from '../../requests/RequestCard';
import { EndMarker } from './EndMarker';
import { TailBubble } from './TailBubble';

export type TailItem = { kind: 'send'; send: TailSend } | { kind: 'request'; key: string; request: string } | { kind: 'end' };

const PREFIX = 'desk-tail:';
/** The tail row of a pending request, by its key in the conversation's requests. */
export const requestRowId = (key: string): string => `${PREFIX}request:${key}`;
const idOf = (item: TailItem): string => (item.kind === 'request' ? requestRowId(item.key) : PREFIX + (item.kind === 'send' ? `send:${item.send.key}` : 'end'));

type TailValue = { items: ReadonlyMap<string, TailItem>; foot: FootContext; session: DeskSession; landed: string | null };
const TailContext = createContext<TailValue | null>(null);

/** The tail's rows for MAWS's list, in order (sends, then requests, then the end), and each row's item by its id. */
export function tailRows(items: readonly TailItem[]): { rows: Row[]; byId: Map<string, TailItem> } {
  const ids = items.map(idOf);
  const rows = ids.map((id): Row => ({ id: id as RowId, turnId: null, at: '', kind: 'request_slot', requestId: id as RequestId, toolUseId: null, requestKind: 'question', toolName: null, requestedAt: '' }));
  return { rows, byId: new Map(items.map((item, i) => [ids[i], item])) };
}

export function TailProvider({ value, children }: { value: TailValue; children: ReactNode }) {
  return <TailContext.Provider value={value}>{children}</TailContext.Provider>;
}

/** MAWS's request slot, drawn: a tail row of the desk's by its id; any other slot (the desk raises none) draws nothing. */
export const renderTailRow: NonNullable<TranscriptProps['renderRequest']> = (slot) => (String(slot.requestId).startsWith(PREFIX) ? <TailRow id={String(slot.requestId)} /> : null);

function TailRow({ id }: { id: string }) {
  const tail = useContext(TailContext);
  const item = tail?.items.get(id);
  if (!tail || !item) return null;
  switch (item.kind) {
    case 'send':
      return <TailBubble text={item.send.text} at={item.send.at} foot={footOf(item.send, tail.foot)} />;
    case 'request':
      return (
        <div data-tail-request={item.request} {...(tail.landed === item.request ? { 'data-landed': '', className: 'desk-landed', tabIndex: -1 } : {})}>
          <RequestCard request={item.key} embedded />
        </div>
      );
    case 'end':
      return <EndMarker session={tail.session} />;
  }
}
