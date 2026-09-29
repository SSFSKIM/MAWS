// The request card in the transcript's `request_slot` row (C7 execution document, Placements). C6's registry holds
// one renderer for every session and hands it only the row, so `renderSessionRequest` finds the item by request id in
// the attention store: the pointer while a docked placement of its session shows that request, the full inline card
// otherwise (a child's request while the main's is docked), nothing once the item retired. `renderInlineRequest` is
// for a transcript with no composer (C8b's drill-in): always the full card, looked up in the named session.
import type { ReactNode } from 'react';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import { isOpen } from '../attention/derive';
import { useAttention } from '../stores/attention';
import { isDocked, useComposerStore } from '../stores/composer';
import type { Row } from '../transcript';
import { InlinePointer } from './InlinePointer';
import { RequestCard } from './RequestCard';

type RequestSlot = Extract<Row, { kind: 'request_slot' }>;
export type RequestRenderer = (slot: RequestSlot) => ReactNode;

// The open item for a slot. The registered renderer is not told which session's Transcript renders the row (C6 hands
// it the row alone, and the transcript's context is not public surface), so it searches every session. A request id is
// the engine's `request_id`, a UUID per request live; two replays of one fixture, though, carry the same recorded ids
// in two sessions (C3's replay maps only host-minted ids). The slot's tool use id narrows such a collision to the item
// of the same tool use; an id shared by both stays ambiguous, and the first session's item wins.
function findItem(bySession: ReadonlyMap<AppSessionId, AttentionItem[]>, slot: RequestSlot, appSessionId: AppSessionId | null): AttentionItem | null {
  const lists = appSessionId === null ? [...bySession.values()] : [bySession.get(appSessionId) ?? []];
  const matches = lists.flatMap((items) => items.filter((item) => item.request.requestId === slot.requestId && isOpen(item)));
  return matches.find((item) => slot.toolUseId !== null && item.request.toolUseId === slot.toolUseId) ?? matches[0] ?? null;
}

function SlotCard({ slot, appSessionId }: { slot: RequestSlot; appSessionId: AppSessionId | null }) {
  const item = useAttention((s) => findItem(s.bySession, slot, appSessionId));
  const docked = useComposerStore((s) => appSessionId === null && item !== null && isDocked(s, item.appSessionId, slot.requestId));
  if (!item) return null;
  if (docked) return <InlinePointer appSessionId={item.appSessionId} what={slot.toolName ?? slot.requestKind} />;
  return <RequestCard item={item} request={null} placement="inline" paneIndex={null} />;
}

export const renderSessionRequest: RequestRenderer = (slot) => <SlotCard slot={slot} appSessionId={null} />;

export const renderInlineRequest =
  (appSessionId: AppSessionId): RequestRenderer =>
  (slot) => <SlotCard slot={slot} appSessionId={appSessionId} />;
