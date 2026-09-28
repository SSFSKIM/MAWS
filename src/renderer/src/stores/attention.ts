// Attention items per session (C5 execution document, Renderer stores; residue *Stores and events*). Fed by
// `ipc/events.ts`. `attention.list` and `attention.changed` carry no revision by agreement, so while the snapshot is
// outstanding every change is buffered per session (last one wins, an empty list included) and replayed over the
// snapshot when it lands; after that a change replaces its session's list directly.
import { create } from 'zustand';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { EventPayload } from '@shared/ipc/schema';
import { isOpen, needsYou, type NeedsYouRow } from '../attention/derive';

export interface AttentionState {
  loaded: boolean;
  bySession: Map<AppSessionId, AttentionItem[]>;
  version: number; // bumped on every write to bySession; selectors memoise on it
  notificationDelivery: 'os' | 'fallback' | null;
  pendingReplacements: Map<AppSessionId, AttentionItem[]> | null; // non-null only while attention.list is outstanding
  beginSnapshot(): void;
  applySnapshot(items: AttentionItem[]): void;
  applyChanged(change: EventPayload<'attention.changed'>): void;
  applyNotified(notified: EventPayload<'attention.notified'>): void;
}

export function createAttentionStore() {
  return create<AttentionState>()((set, get) => ({
    loaded: false,
    bySession: new Map(),
    version: 0,
    notificationDelivery: null,
    pendingReplacements: null,
    beginSnapshot() {
      set({ pendingReplacements: new Map() });
    },
    applySnapshot(items) {
      const bySession = new Map<AppSessionId, AttentionItem[]>();
      for (const item of items) bySession.set(item.appSessionId, [...(bySession.get(item.appSessionId) ?? []), item]);
      for (const [appSessionId, replacement] of get().pendingReplacements ?? []) bySession.set(appSessionId, replacement);
      set({ bySession, version: get().version + 1, loaded: true, pendingReplacements: null });
    },
    applyChanged({ appSessionId, items }) {
      const buffer = get().pendingReplacements;
      if (buffer) {
        set({ pendingReplacements: new Map(buffer).set(appSessionId, items) });
        return;
      }
      set({ bySession: new Map(get().bySession).set(appSessionId, items), version: get().version + 1 });
    },
    applyNotified({ delivery }) {
      set({ notificationDelivery: delivery });
    },
  }));
}

export const useAttention = createAttentionStore();

const EMPTY: AttentionItem[] = [];

// Items still waiting on a human (pending or delivered), memoised per session list.
const openCache = new WeakMap<AttentionItem[], AttentionItem[]>();
export function selectPendingOf(state: Pick<AttentionState, 'bySession'>, appSessionId: AppSessionId): AttentionItem[] {
  const items = state.bySession.get(appSessionId);
  if (!items) return EMPTY;
  let open = openCache.get(items);
  if (!open) openCache.set(items, (open = items.filter(isOpen)));
  return open;
}

// The Needs-you rows, recomputed only when either input's version moves, so a component gets the same array until
// then. The memo is held per attention map (a store's own), so two stores never share an entry.
type RecordsInput = { records: Map<AppSessionId, SessionRecord>; recordsVersion: number };
type AttentionInput = Pick<AttentionState, 'bySession' | 'version'>;
const rowsMemo = new WeakMap<object, { attention: number; records: number; rows: NeedsYouRow[] }>();
export function selectNeedsYou(state: AttentionInput, sessions: RecordsInput): NeedsYouRow[] {
  const memo = rowsMemo.get(state.bySession);
  if (memo && memo.attention === state.version && memo.records === sessions.recordsVersion) return memo.rows;
  const rows = needsYou(state.bySession, sessions.records);
  rowsMemo.set(state.bySession, { attention: state.version, records: sessions.recordsVersion, rows });
  return rows;
}

export const selectOldestNeedsYou = (state: AttentionInput, sessions: RecordsInput) => selectNeedsYou(state, sessions)[0] ?? null;
export const selectCountNeedsYou = (state: AttentionInput, sessions: RecordsInput) => selectNeedsYou(state, sessions).length;
