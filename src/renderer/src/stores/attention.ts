// Attention items per session (C5 execution document, Renderer stores; residue *Stores and events*). Fed by
// `ipc/events.ts`. `attention.list` and `attention.changed` carry no revision by agreement, so while the snapshot is
// outstanding every change is buffered per session (last one wins, an empty list included) and replayed over the
// snapshot when it lands; after that a change replaces its session's list directly. P5 O6 M4: all of this per machine,
// each machine's snapshot and buffer its own (docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, M4).
// P5 O7 M6 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M6 "The feed"): another machine's attention feed,
// as main says it in `remote.attention`, replaces that machine's partition whole, and says whether main holds it greyed
// (from its link's `down` until the next snapshot, through an `up` before it): a greyed partition's items are drawn and
// never counted (`selectGreyedNeedsYou` beside `selectNeedsYou`). Greying is main's word alone, never read from the roster.
import { create } from 'zustand';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, AttentionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { EventPayload, MawsBridge } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import { isOpen, needsYou, type NeedsYouRow } from '../attention/derive';
import type { QuestionDraft } from '../request-card/question-steps';
import type { ListedSession } from './sessions';

export interface AttentionState {
  loaded: boolean;
  bySession: Map<AppSessionId, AttentionItem[]>;
  version: number; // bumped on every write to bySession; selectors memoise on it
  notificationDelivery: 'os' | 'fallback' | null;
  // Non-null only while some machine's attention.list is outstanding: every such machine's buffered changes (P5 O6 M4).
  pendingReplacements: Map<AppSessionId, AttentionItem[]> | null;
  // The originating `*.requested` event of an item (`attention.request`), fetched once per item for the previews; null
  // for an item with no broker request, and for one whose read failed twice (then also in `unreadable`), so the docked
  // swap shows it as a notice instead of waiting for a read that will not come.
  requests: Map<AttentionId, SessionEvent | null>;
  unreadable: Map<AttentionId, string>; // why an item's request could not be read; forgotten once the item is not pending
  // W4: a question card's answers in progress, beside its request, so a remount or a move between placements resumes
  // them (`request-card/question-steps.ts`); dropped once the item is no longer open.
  drafts: Map<AttentionId, QuestionDraft>;
  // P5 O7 M6: the sessions of every machine whose attention main holds greyed.
  greyed: ReadonlySet<AppSessionId>;
  // P5 O6 M4: per machine. A machine's snapshot replaces its sessions' lists only, and buffers only its changes; begun
  // again (a new generation of its link) it drops what it had buffered.
  beginSnapshot(machine: MachineRef): void;
  applySnapshot(items: AttentionItem[], machine: MachineRef): void;
  // The snapshot nobody answered: the machine's buffer replays over what is held, and nothing is removed.
  cancelSnapshot(machine: MachineRef): void;
  applyChanged(change: EventPayload<'attention.changed'>, machine: MachineRef): void;
  // P5 O7 M6: another machine's feed snapshot (`remote.attention`), its partition replaced whole and greyed or not.
  applyRemote(snapshot: EventPayload<'remote.attention'>): void;
  applyNotified(notified: EventPayload<'attention.notified'>): void;
  loadRequest(client: MawsBridge, item: AttentionItem): Promise<void>; // once per item; a failed read is retried once
  retryRequest(client: MawsBridge, item: AttentionItem): Promise<void>; // an unreadable item's read, asked again (the card's Retry)
  setDraft(id: AttentionId, draft: QuestionDraft): void;
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

// The drafts of items no longer open (answered, retired, gone) are dropped.
function forgetClosedDrafts(drafts: Map<AttentionId, QuestionDraft>, bySession: Map<AppSessionId, AttentionItem[]>): Partial<AttentionState> {
  if (drafts.size === 0) return {};
  const open = new Set([...bySession.values()].flatMap((items) => items.filter(isOpen).map((item) => item.id)));
  const kept = new Map([...drafts].filter(([id]) => open.has(id)));
  return kept.size === drafts.size ? {} : { drafts: kept };
}

// P5 O6 M4: a machine's part of the store, the sessions whose lists the calls naming it wrote (never parsed from ids), and
// its changes buffered while its snapshot is outstanding.
interface Partition {
  sessions: Set<AppSessionId>;
  buffer: Map<AppSessionId, AttentionItem[]> | null;
  greyed: boolean; // P5 O7 M6: as main last said it in `remote.attention`
  // P5 O7 M6 (M6c fix wave 1): main's feed speaks for this machine (a first `remote.attention` came), for the page's life:
  // a snapshot begun for it (an RL2 machine the roster brought up before the org rows named it) buffers nothing, and its
  // answer, late or failed, writes nothing, so it can neither bring back an item the feed cleared nor erase one it holds.
  fed: boolean;
}

export function createAttentionStore() {
  const inFlight = new Map<AttentionId, Promise<void>>();
  const partitions = new Map<MachineRef, Partition>();
  const partition = (machine: MachineRef): Partition => {
    let p = partitions.get(machine);
    if (!p) partitions.set(machine, (p = { sessions: new Set(), buffer: null, greyed: false, fed: false }));
    return p;
  };
  // Every outstanding snapshot's buffer, as the state shows them.
  const buffered = (): Map<AppSessionId, AttentionItem[]> | null => {
    const outstanding = [...partitions.values()].filter((p) => p.buffer !== null);
    return outstanding.length === 0 ? null : new Map(outstanding.flatMap((p) => [...p.buffer!]));
  };
  return create<AttentionState>()((set, get) => {
    // P5 O7 M6: the greyed sessions once the partition's sessions were `before`: theirs as the partition now says.
    const greyedAfter = (p: Partition, before: Iterable<AppSessionId>): ReadonlySet<AppSessionId> => {
      const greyed = new Set(get().greyed);
      for (const id of before) greyed.delete(id);
      if (p.greyed) for (const id of p.sessions) greyed.add(id);
      return greyed;
    };
    // The partition's sessions replaced by `items`, grouped per session, into `bySession`.
    const replace = (p: Partition, bySession: Map<AppSessionId, AttentionItem[]>, items: AttentionItem[]) => {
      for (const id of p.sessions) bySession.delete(id);
      p.sessions = new Set();
      for (const item of items) {
        bySession.set(item.appSessionId, [...(bySession.get(item.appSessionId) ?? []), item]);
        p.sessions.add(item.appSessionId);
      }
    };
    // The machine's snapshot over its own sessions: `items` null keeps what it holds; its buffer replays over it.
    const settle = (machine: MachineRef, items: AttentionItem[] | null) => {
      const p = partition(machine);
      if (p.fed) return; // the feed's partition (fix wave 1): it buffered nothing, and its answer is older than the feed
      const before = [...p.sessions];
      const bySession = new Map(get().bySession);
      if (items !== null) replace(p, bySession, items);
      for (const [appSessionId, replacement] of p.buffer ?? []) {
        bySession.set(appSessionId, replacement);
        p.sessions.add(appSessionId);
      }
      p.buffer = null;
      set({ bySession, version: get().version + 1, loaded: true, pendingReplacements: buffered(), greyed: greyedAfter(p, before), ...forgetSettled(get(), bySession), ...forgetClosedDrafts(get().drafts, bySession) });
    };
    return {
      loaded: false,
      bySession: new Map(),
      version: 0,
      notificationDelivery: null,
      pendingReplacements: null,
      requests: new Map(),
      unreadable: new Map(),
      drafts: new Map(),
      greyed: new Set(),
      beginSnapshot(machine) {
        const p = partition(machine);
        if (p.fed) return; // fix wave 1: the feed's changes apply as they come
        p.buffer = new Map();
        set({ pendingReplacements: buffered() });
      },
      applySnapshot: (items, machine) => settle(machine, items),
      cancelSnapshot: (machine) => settle(machine, null),
      applyChanged({ appSessionId, items }, machine) {
        const p = partition(machine);
        if (p.buffer) {
          p.buffer.set(appSessionId, items);
          set({ pendingReplacements: buffered() });
          return;
        }
        p.sessions.add(appSessionId);
        const bySession = new Map(get().bySession).set(appSessionId, items);
        const greyed = p.greyed && !get().greyed.has(appSessionId) ? greyedAfter(p, []) : get().greyed;
        set({ bySession, greyed, version: get().version + 1, ...forgetSettled(get(), bySession), ...forgetClosedDrafts(get().drafts, bySession) });
      },
      // Main's word, newer than anything an `attention.list` of the machine still outstanding could say (an RL2 machine's
      // roster can come up before its rows say it is listed): from here the feed alone speaks for the partition (`fed`),
      // so that list's buffered changes are dropped and its answer will write nothing.
      applyRemote({ machine, items, greyed: grey }) {
        const p = partition(machine);
        const before = [...p.sessions];
        const bySession = new Map(get().bySession);
        replace(p, bySession, items);
        p.buffer = null;
        p.fed = true;
        p.greyed = grey;
        set({ bySession, version: get().version + 1, pendingReplacements: buffered(), greyed: greyedAfter(p, before), ...forgetSettled(get(), bySession), ...forgetClosedDrafts(get().drafts, bySession) });
      },
      applyNotified({ delivery }) {
        if (delivery !== 'in-app') set({ notificationDelivery: delivery });
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
      setDraft(id, draft) {
        set({ drafts: new Map(get().drafts).set(id, draft) });
      },
    };
  });
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
// then. The memo is held per attention map (a store's own), so two stores never share an entry. P5 O7 M6: another
// machine's listed rows stand in for records (`listed`, the sessions store's, memoised by identity), and the rows split
// in two: `selectNeedsYou`'s are live, the ones every count and ⌘⇧J read; `selectGreyedNeedsYou`'s are a greyed
// machine's, drawn after them and counted nowhere.
type RecordsInput = { records: Map<AppSessionId, SessionRecord>; recordsVersion: number; listed?: ReadonlyMap<AppSessionId, ListedSession> };
type AttentionInput = Pick<AttentionState, 'bySession' | 'version' | 'greyed'>;
interface RowsMemo { attention: number; records: number; listed: RecordsInput['listed']; live: NeedsYouRow[]; greyed: NeedsYouRow[] }
const rowsMemo = new WeakMap<object, RowsMemo>();
function needsYouRows(state: AttentionInput, sessions: RecordsInput): RowsMemo {
  const memo = rowsMemo.get(state.bySession);
  if (memo && memo.attention === state.version && memo.records === sessions.recordsVersion && memo.listed === sessions.listed) return memo;
  const rows = needsYou(state.bySession, sessions.records, { listed: sessions.listed, greyed: state.greyed });
  const next = { attention: state.version, records: sessions.recordsVersion, listed: sessions.listed, live: rows.filter((r) => !r.greyed), greyed: rows.filter((r) => r.greyed) };
  rowsMemo.set(state.bySession, next);
  return next;
}
export const selectNeedsYou = (state: AttentionInput, sessions: RecordsInput): NeedsYouRow[] => needsYouRows(state, sessions).live;
export const selectGreyedNeedsYou = (state: AttentionInput, sessions: RecordsInput): NeedsYouRow[] => needsYouRows(state, sessions).greyed;

export const selectOldestNeedsYou = (state: AttentionInput, sessions: RecordsInput) => selectNeedsYou(state, sessions)[0] ?? null;
export const selectCountNeedsYou = (state: AttentionInput, sessions: RecordsInput) => selectNeedsYou(state, sessions).length;
