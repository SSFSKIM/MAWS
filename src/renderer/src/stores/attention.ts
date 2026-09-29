// Attention items per session (C5 execution document, Renderer stores; residue *Stores and events*). Fed by
// `ipc/events.ts`. `attention.list` and `attention.changed` carry no revision by agreement, so while the snapshot is
// outstanding every change is buffered per session (last one wins, an empty list included) and replayed over the
// snapshot when it lands; after that a change replaces its session's list directly.
import { create } from 'zustand';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, AttentionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { EventPayload, MawsBridge } from '@shared/ipc/schema';
import { isOpen, needsYou, type NeedsYouRow } from '../attention/derive';

export interface AttentionState {
  loaded: boolean;
  bySession: Map<AppSessionId, AttentionItem[]>;
  version: number; // bumped on every write to bySession; selectors memoise on it
  notificationDelivery: 'os' | 'fallback' | null;
  pendingReplacements: Map<AppSessionId, AttentionItem[]> | null; // non-null only while attention.list is outstanding
  // The originating `*.requested` event of an item (`attention.request`), fetched once per item for the previews; null
  // for an item with no broker request, and for one whose read failed twice (then also in `unreadable`), so the docked
  // swap shows it as a notice instead of waiting for a read that will not come.
  requests: Map<AttentionId, SessionEvent | null>;
  unreadable: Map<AttentionId, string>; // why an item's request could not be read; forgotten once the item is not pending
  beginSnapshot(): void;
  applySnapshot(items: AttentionItem[]): void;
  applyChanged(change: EventPayload<'attention.changed'>): void;
  applyNotified(notified: EventPayload<'attention.notified'>): void;
  loadRequest(client: MawsBridge, item: AttentionItem): Promise<void>; // once per item; a failed read is retried once
  retryRequest(client: MawsBridge, item: AttentionItem): Promise<void>; // an unreadable item's read, asked again (the card's Retry)
}

export const REQUEST_RETRY_MS = 1_000; // the wait before a failed `attention.request` read is retried, once

// The unreadable items no longer pending (answered or retired) are forgotten, with the null their read left cached.
function forgetSettled(state: Pick<AttentionState, 'requests' | 'unreadable'>, bySession: Map<AppSessionId, AttentionItem[]>): Partial<AttentionState> {
  if (state.unreadable.size === 0) return {};
  const pending = new Set([...bySession.values()].flatMap((items) => items.filter((item) => item.state === 'pending').map((item) => item.id)));
  const settled = [...state.unreadable.keys()].filter((id) => !pending.has(id));
  if (settled.length === 0) return {};
  const requests = new Map(state.requests);
  const unreadable = new Map(state.unreadable);
  for (const id of settled) {
    requests.delete(id);
    unreadable.delete(id);
  }
  return { requests, unreadable };
}

export function createAttentionStore() {
  const inFlight = new Map<AttentionId, Promise<void>>();
  return create<AttentionState>()((set, get) => ({
    loaded: false,
    bySession: new Map(),
    version: 0,
    notificationDelivery: null,
    pendingReplacements: null,
    requests: new Map(),
    unreadable: new Map(),
    beginSnapshot() {
      set({ pendingReplacements: new Map() });
    },
    applySnapshot(items) {
      const bySession = new Map<AppSessionId, AttentionItem[]>();
      for (const item of items) bySession.set(item.appSessionId, [...(bySession.get(item.appSessionId) ?? []), item]);
      for (const [appSessionId, replacement] of get().pendingReplacements ?? []) bySession.set(appSessionId, replacement);
      set({ bySession, version: get().version + 1, loaded: true, pendingReplacements: null, ...forgetSettled(get(), bySession) });
    },
    applyChanged({ appSessionId, items }) {
      const buffer = get().pendingReplacements;
      if (buffer) {
        set({ pendingReplacements: new Map(buffer).set(appSessionId, items) });
        return;
      }
      const bySession = new Map(get().bySession).set(appSessionId, items);
      set({ bySession, version: get().version + 1, ...forgetSettled(get(), bySession) });
    },
    applyNotified({ delivery }) {
      set({ notificationDelivery: delivery });
    },
    loadRequest(client, item) {
      if (get().requests.has(item.id)) return Promise.resolve();
      const keep = (event: SessionEvent | null) => set({ requests: new Map(get().requests).set(item.id, event) });
      const { requestId } = item.request;
      if (requestId === null) {
        keep(null);
        return Promise.resolve();
      }
      let pending = inFlight.get(item.id);
      if (!pending) {
        const read = () => client.invoke('attention.request', { appSessionId: item.appSessionId, requestId });
        pending = (async () => {
          let result = await read();
          if (!result.ok) {
            console.warn(`[attention] attention.request ${item.id} unavailable; retrying once`, result.error);
            await new Promise((resolve) => setTimeout(resolve, REQUEST_RETRY_MS));
            result = await read();
          }
          inFlight.delete(item.id);
          if (result.ok) return keep(result.value.event);
          console.warn(`[attention] attention.request ${item.id} unavailable`, result.error);
          set({ unreadable: new Map(get().unreadable).set(item.id, result.error.message) });
          keep(null);
        })();
        inFlight.set(item.id, pending);
      }
      return pending;
    },
    retryRequest(client, item) {
      if (!get().unreadable.has(item.id)) return get().loadRequest(client, item);
      const requests = new Map(get().requests);
      const unreadable = new Map(get().unreadable);
      requests.delete(item.id);
      unreadable.delete(item.id);
      set({ requests, unreadable });
      return get().loadRequest(client, item);
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
