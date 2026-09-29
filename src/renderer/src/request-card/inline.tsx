// The request card in the transcript's `request_slot` row (C7 execution document, Placements). C6's registry holds
// one renderer for every session and hands it only the row, so `renderSessionRequest` finds the item by request id in
// the attention store: the pointer while a docked placement of its session shows that request, the full inline card
// otherwise (a child's request while the main's is docked), nothing once the item retired. `renderInlineRequest` is
// for a transcript with no composer (C8b's drill-in): always the full card, looked up in the named session.
import type { ReactNode } from 'react';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import { isOpen } from '../attention/derive';
import { useAttention } from '../stores/attention';
import { isDocked, useComposerStore } from '../stores/composer';
import type { Row } from '../transcript';
import { InlinePointer } from './InlinePointer';
import { RequestCard } from './RequestCard';

type RequestSlot = Extract<Row, { kind: 'request_slot' }>;
export type RequestRenderer = (slot: RequestSlot) => ReactNode;

function findItem(bySession: ReadonlyMap<AppSessionId, AttentionItem[]>, requestId: RequestId, appSessionId: AppSessionId | null): AttentionItem | null {
  const lists = appSessionId === null ? [...bySession.values()] : [bySession.get(appSessionId) ?? []];
  for (const items of lists) {
    const found = items.find((item) => item.request.requestId === requestId && isOpen(item));
    if (found) return found;
  }
  return null;
}

function SlotCard({ slot, appSessionId }: { slot: RequestSlot; appSessionId: AppSessionId | null }) {
  const item = useAttention((s) => findItem(s.bySession, slot.requestId, appSessionId));
  const docked = useComposerStore((s) => appSessionId === null && item !== null && isDocked(s, item.appSessionId, slot.requestId));
  if (!item) return null;
  if (docked) return <InlinePointer appSessionId={item.appSessionId} what={slot.toolName ?? slot.requestKind} />;
  return <RequestCard item={item} request={null} placement="inline" paneIndex={null} />;
}

export const renderSessionRequest: RequestRenderer = (slot) => <SlotCard slot={slot} appSessionId={null} />;

export const renderInlineRequest =
  (appSessionId: AppSessionId): RequestRenderer =>
  (slot) => <SlotCard slot={slot} appSessionId={appSessionId} />;
