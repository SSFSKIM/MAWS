// The request card in a transcript (C7 execution document, Placements; UX wave U1b, Interfaces §C): C6's registry holds
// one renderer for every session and hands it a slot value, never told which session's Transcript draws it. Two slots
// pass: the transcript's end row, whose reserved request id names the transcript it ends (`endRequestOf`), drawn as
// `EndRegion`; and a waiting row's form, whose item is found by request id in the attention store, drawn as the full
// inline card, nothing once the item no longer waits. `renderInlineRequest` is for a transcript mounted without the
// session's pane (C8b's drill-in), searching the named session only.
import type { ReactNode } from 'react';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import { waits } from '@shared/attention/kinds';
import { useAttention } from '../stores/attention';
import type { Row } from '../transcript';
import { endRequestOf } from '../transcript/model/keys';
import { EndRegion } from './EndRegion';
import { RequestCard } from './RequestCard';

type RequestSlot = Extract<Row, { kind: 'request_slot' }>;
export type RequestRenderer = (slot: RequestSlot) => ReactNode;

// The waiting item for a slot (UC-1). A request id is the engine's `request_id`, a UUID per request live; two replays of
// one fixture, though, carry the same recorded ids in two sessions (C3's replay maps only host-minted ids). The slot's
// tool use id narrows such a collision to the item of the same tool use; an id shared by both stays ambiguous, and the
// first session's item wins.
function findItem(bySession: ReadonlyMap<AppSessionId, AttentionItem[]>, slot: RequestSlot, appSessionId: AppSessionId | null): AttentionItem | null {
  const lists = appSessionId === null ? [...bySession.values()] : [bySession.get(appSessionId) ?? []];
  const matches = lists.flatMap((items) => items.filter((item) => item.request.requestId === slot.requestId && waits(item)));
  return matches.find((item) => slot.toolUseId !== null && item.request.toolUseId === slot.toolUseId) ?? matches[0] ?? null;
}

function SlotCard({ slot, appSessionId }: { slot: RequestSlot; appSessionId: AppSessionId | null }) {
  const item = useAttention((s) => findItem(s.bySession, slot, appSessionId));
  if (!item) return null;
  return <RequestCard item={item} request={null} placement="inline" region="row" askInPlace paneIndex={null} />;
}

function drawSlot(slot: RequestSlot, appSessionId: AppSessionId | null): ReactNode {
  const end = endRequestOf(slot.requestId);
  if (end !== null) return <EndRegion appSessionId={end.appSessionId} agentId={end.agentId} />;
  return <SlotCard slot={slot} appSessionId={appSessionId} />;
}

export const renderSessionRequest: RequestRenderer = (slot) => drawSlot(slot, null);

export const renderInlineRequest =
  (appSessionId: AppSessionId): RequestRenderer =>
  (slot) => drawSlot(slot, appSessionId);
