// The AttentionStore port (C3 execution document, Interfaces "Broker"; ruling 1 of the wave-2 ledger): where main's
// attention service keeps each session's merged Needs-you list. C4's `Index.attention` implements it; until that lands
// FileAttentionStore (`<userData>/attention.json`) does, the SessionStateStore pattern.
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';

export interface AttentionStore {
  list(): Promise<AttentionItem[]>; // every session's items
  replaceForSession(appSessionId: AppSessionId, items: AttentionItem[]): Promise<void>; // the session's whole list
  retireForSession(appSessionId: AppSessionId): Promise<void>; // the session was archived: nothing of it needs anyone
}
