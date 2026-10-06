// E1 (M4): the Question sheet's state, one vanilla zustand store per session (E1 execution document, M4's decisions;
// `ReviewTool`'s per-session store, the budget store's read-at-every-ready). The asks are the host's (G6, X13: pending
// asks are host memory): read from `maws.asks.list` when a sheet first mounts for the session and again whenever the
// engine host is back at `ready` (a restarted host lost its table), and followed through the live `maws.ask.*` events,
// an event about an ask winning over a snapshot still on its way. A cancelled ask stays, marked, so the sheet can say
// the session ended. Drafts live here, not in components, so switching tabs or sessions keeps half-filled answers.
//
// What the sheet shows (`shownAsk`): the selected ask when the store holds it; else the ask a capsule handed over
// (`historical`, residue 14), read-only from its own data, which works after a reload and for a disk-only session;
// else the first pending ask; else a cancelled one, until dismissed; else the resting state.
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { PendingAsk } from '@shared/maws/ask';
import type { AskRowData } from '../../../transcript';
import { SHEET } from './copy';
import { EMPTY_DRAFT, toAnswers, type Draft, type ProjectRef } from './draft';

export interface SheetAsk extends PendingAsk {
  state: 'pending' | 'cancelled';
}

export interface AskSheetState {
  asks: Map<string, SheetAsk>; // in the order they opened
  drafts: Map<string, Map<string, Draft>>; // askId → question id → draft
  selected: string | null;
  historical: AskRowData | null; // the read-only ask a capsule handed over
  loaded: boolean; // a `maws.asks.list` answer has been applied
  submitting: string | null; // the ask whose answers are on their way
  failed: { askId: string; detail: string | null } | null; // the last Submit's refusal, offered for a retry
  notice: string | null;
}

export type ShownAsk = { kind: 'live'; ask: SheetAsk } | { kind: 'historical'; ask: AskRowData } | { kind: 'rest' };

const initial = (): AskSheetState => ({ asks: new Map(), drafts: new Map(), selected: null, historical: null, loaded: false, submitting: null, failed: null, notice: null });

const stores = new Map<AppSessionId, StoreApi<AskSheetState>>();
// A read in flight per session: its token, and the asks an event touched since it left (their state is the event's).
const reads = new Map<AppSessionId, { token: symbol; touched: Set<string> }>();
const requested = new Set<AppSessionId>(); // sessions whose sheet asked for the host's table at least once

export function askSheet(appSessionId: AppSessionId): StoreApi<AskSheetState> {
  let store = stores.get(appSessionId);
  if (!store) {
    store = createStore<AskSheetState>()(initial);
    stores.set(appSessionId, store);
  }
  return store;
}

// Tests.
export function resetAskSheets(): void {
  stores.clear();
  reads.clear();
  requested.clear();
}

export function shownAsk(state: AskSheetState): ShownAsk {
  const selected = state.selected === null ? undefined : state.asks.get(state.selected);
  if (selected) return { kind: 'live', ask: selected };
  if (state.historical !== null && state.historical.askId === state.selected) return { kind: 'historical', ask: state.historical };
  const held = [...state.asks.values()];
  const next = held.find((ask) => ask.state === 'pending') ?? held[0];
  return next ? { kind: 'live', ask: next } : { kind: 'rest' };
}

// An ask leaves the sheet: its drafts go, and so does the selection naming it (with the capsule's copy of it, which
// would otherwise show a stale pending ask read-only).
function without(state: AskSheetState, askId: string): Partial<AskSheetState> {
  const asks = new Map(state.asks);
  asks.delete(askId);
  const drafts = new Map(state.drafts);
  drafts.delete(askId);
  const leaving = state.selected === askId;
  return { asks, drafts, ...(leaving && { selected: null, historical: null }), ...(state.failed?.askId === askId && { failed: null }) };
}

// ---- the host's table --------------------------------------------------------------------------------------------------

export async function loadAsks(appSessionId: AppSessionId, client: MawsBridge): Promise<void> {
  const read = { token: Symbol('maws.asks.list'), touched: new Set<string>() };
  reads.set(appSessionId, read);
  const result = await client.invoke('maws.asks.list', { appSessionId });
  if (reads.get(appSessionId) !== read) return; // a newer read superseded this one
  reads.delete(appSessionId);
  if (!result.ok) {
    console.warn(`[maws] maws.asks.list unavailable: ${result.error.message}`);
    return;
  }
  const store = askSheet(appSessionId);
  const state = store.getState();
  const listed = new Map(result.value.asks.map((ask) => [ask.askId, ask]));
  const asks = new Map<string, SheetAsk>();
  // what the store held: kept when the host still lists it, when an event spoke for it since the read left, or as a
  // cancelled ask's notice
  for (const [askId, ask] of state.asks) {
    if (listed.has(askId) || read.touched.has(askId) || ask.state === 'cancelled') asks.set(askId, ask);
  }
  for (const [askId, ask] of listed) {
    if (!asks.has(askId) && !read.touched.has(askId)) asks.set(askId, { ...ask, state: 'pending' });
  }
  const drafts = new Map([...state.drafts].filter(([askId]) => asks.has(askId)));
  store.setState({ asks, drafts, loaded: true });
}

// The sheet's first mount for the session reads the host's table; later mounts rely on the events and on `reloadAsks`.
export function ensureLoaded(appSessionId: AppSessionId, client: MawsBridge): void {
  if (requested.has(appSessionId)) return;
  requested.add(appSessionId);
  void loadAsks(appSessionId, client);
}

// The engine host is back at `ready`: every session read before is read again.
export function reloadAsks(client: MawsBridge): void {
  for (const appSessionId of requested) void loadAsks(appSessionId, client);
}

// ---- live events ---------------------------------------------------------------------------------------------------------

// Applies a batch's `maws.ask.*` events; answers the asks it opened that are still pending at its end.
export function applyAskEvents(appSessionId: AppSessionId, events: readonly SessionEvent[]): string[] {
  const relevant = events.filter((event) => event.kind === 'maws.ask.opened' || event.kind === 'maws.ask.answered' || event.kind === 'maws.ask.cancelled');
  if (relevant.length === 0) return [];
  const store = askSheet(appSessionId);
  const read = reads.get(appSessionId);
  const opened: string[] = [];
  for (const event of relevant) {
    read?.touched.add(event.askId);
    const state = store.getState();
    switch (event.kind) {
      case 'maws.ask.opened': {
        const { askId, toolUseId, requestId, blocking, title, context, questions, at } = event;
        const asks = new Map(state.asks).set(askId, { askId, toolUseId, requestId, blocking, title, context, questions, openedAt: at, state: 'pending' });
        store.setState({ asks });
        opened.push(askId);
        break;
      }
      case 'maws.ask.answered':
        if (state.asks.has(event.askId)) store.setState(without(state, event.askId));
        break;
      case 'maws.ask.cancelled': {
        const ask = state.asks.get(event.askId);
        if (!ask) break;
        const drafts = new Map(state.drafts);
        drafts.delete(event.askId);
        store.setState({ asks: new Map(state.asks).set(event.askId, { ...ask, state: 'cancelled' }), drafts });
        break;
      }
    }
  }
  const { asks } = store.getState();
  return opened.filter((askId) => asks.get(askId)?.state === 'pending');
}

// ---- the person's moves --------------------------------------------------------------------------------------------------

// Shows an ask: one the store holds, else `historical` (the capsule's copy) read-only.
export function selectAsk(appSessionId: AppSessionId, askId: string | null, historical: AskRowData | null = null): void {
  askSheet(appSessionId).setState({ selected: askId, historical, notice: null });
}

export function editDraft(appSessionId: AppSessionId, askId: string, questionId: string, edit: (draft: Draft) => Draft): void {
  const store = askSheet(appSessionId);
  const { drafts } = store.getState();
  const forAsk = new Map(drafts.get(askId));
  forAsk.set(questionId, edit(forAsk.get(questionId) ?? EMPTY_DRAFT));
  store.setState({ drafts: new Map(drafts).set(askId, forAsk) });
}

// A cancelled ask, read: it leaves the sheet.
export function dismissAsk(appSessionId: AppSessionId, askId: string): void {
  const store = askSheet(appSessionId);
  if (store.getState().asks.get(askId)?.state === 'cancelled') store.setState(without(store.getState(), askId));
}

export const dismissNotice = (appSessionId: AppSessionId): void => askSheet(appSessionId).setState({ notice: null });

// Submit: every question's answer (the empty ones skipped) through `maws.ask.answer`. Delivered: the ask leaves and the
// next pending one shows. Not pending: answered elsewhere, so it leaves with a notice. Refused (`write_failed`, or the
// command itself): the drafts stay and the sheet offers a retry.
export async function submitAsk(appSessionId: AppSessionId, askId: string, client: MawsBridge, projects: readonly ProjectRef[]): Promise<void> {
  const store = askSheet(appSessionId);
  const state = store.getState();
  const ask = state.asks.get(askId);
  if (!ask || ask.state !== 'pending' || state.submitting !== null) return;
  store.setState({ submitting: askId, failed: null, notice: null });
  const result = await client.invoke('maws.ask.answer', { appSessionId, askId, answers: toAnswers(ask.questions, state.drafts.get(askId), projects) });
  const now = store.getState();
  if (!result.ok) {
    store.setState({ submitting: null, failed: { askId, detail: result.error.message } });
    return;
  }
  switch (result.value.outcome) {
    case 'delivered':
      store.setState({ submitting: null, ...(now.asks.has(askId) ? without(now, askId) : {}) });
      return;
    case 'not_pending':
      store.setState({ submitting: null, ...(now.asks.has(askId) ? without(now, askId) : {}), notice: SHEET.answeredElsewhere });
      return;
    case 'write_failed':
      store.setState({ submitting: null, failed: { askId, detail: null } });
  }
}
