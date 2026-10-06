// The Side pane's state per parent session (E3 execution document, Design §6 and §7, Interfaces "Renderer"): which view
// the pane shows (set by whoever opens it: the composer, a summary row's Open, a chip, a typed `/btw`), which child the
// pane is showing right now, so the unread rule counts that child as on screen (`session/visibility.ts`), and the
// session's side questions. Outside React and keyed by the parent, so a pane opened before its tab exists, or restored
// from layout.json, reads the same view.
//
// The side questions are the host's log (X13: it outlives a renderer reload), listed by `side.question.list` and
// patched from `session.operation` completions; a question this window asked shows at once as a local pending entry
// (`local:<n>`) until the first listing after its receipt holds the host's entry for it. A question the host never
// took (the invoke itself refused) stays here, failed, until it is retried or cleared.
import { create } from 'zustand';
import type { OperationEvent } from '@shared/engine/operations';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { SIDE_ANSWER_CAP, SIDE_QUESTION_CAP } from '@shared/ipc/schema/side';
import type { SideExchange } from '@shared/side/question';
import type { SideQuestionResponse } from '@shared/wire/control';
import { ipc } from '../ipc/client';

export type SideView = { kind: 'thread'; childAppSessionId: AppSessionId } | { kind: 'btw' };

interface SidePane {
  view: SideView | null;
  shownChild: AppSessionId | null; // the child whose transcript the pane draws while the pane is on screen
  exchanges: readonly SideExchange[] | null; // the side questions, oldest first; null until first listed
}

const EMPTY: SidePane = { view: null, shownChild: null, exchanges: null };

export const useSidePane = create<{ panes: ReadonlyMap<AppSessionId, SidePane> }>()(() => ({ panes: new Map() }));

export const sidePaneOf = (state: { panes: ReadonlyMap<AppSessionId, SidePane> }, parent: AppSessionId): SidePane => state.panes.get(parent) ?? EMPTY;

function patch(parent: AppSessionId, change: Partial<SidePane>): void {
  useSidePane.setState(({ panes }) => {
    const before = panes.get(parent) ?? EMPTY;
    const next = { ...before, ...change };
    if (next.view === before.view && next.shownChild === before.shownChild && next.exchanges === before.exchanges) return { panes };
    return { panes: new Map(panes).set(parent, next) };
  });
}

export const setSideView = (parent: AppSessionId, view: SideView): void => patch(parent, { view });

// Published by the thread view while it draws `child` on screen; withdrawn (only if it is still the one shown) when it
// stops.
export const showSideChild = (parent: AppSessionId, child: AppSessionId): void => patch(parent, { shownChild: child });
export function hideSideChild(parent: AppSessionId, child: AppSessionId): void {
  if (sidePaneOf(useSidePane.getState(), parent).shownChild === child) patch(parent, { shownChild: null });
}

// Every parent whose pane shows a child now, with that child.
export function sideChildrenShown(state = useSidePane.getState()): ReadonlyMap<AppSessionId, AppSessionId> {
  const shown = new Map<AppSessionId, AppSessionId>();
  for (const [parent, pane] of state.panes) if (pane.shownChild !== null) shown.set(parent, pane.shownChild);
  return shown;
}

// ---- side questions ----------------------------------------------------------------------------------------------------

// This window's questions the host does not list (yet): awaiting their receipt, or refused before the host took them.
const locals = new Map<AppSessionId, SideExchange[]>();
// Host entries a Retry asked again: the new question stands in for them, so they are not drawn twice.
const retried = new Map<AppSessionId, Set<string>>();
// The latest listing asked per parent: an older answer arriving after it is dropped.
const listings = new Map<AppSessionId, number>();
let localSerial = 0;

const localsOf = (parent: AppSessionId) => locals.get(parent) ?? [];

function show(parent: AppSessionId, listed: readonly SideExchange[]): void {
  const hidden = retried.get(parent);
  const merged = [...listed.filter((e) => !hidden?.has(e.id)), ...localsOf(parent)].sort((a, b) => a.askedAt.localeCompare(b.askedAt));
  patch(parent, { exchanges: merged });
}

// The exchanges as listed last, without this window's locals (which `show` adds back).
const hostListed = (parent: AppSessionId): SideExchange[] => (sidePaneOf(useSidePane.getState(), parent).exchanges ?? []).filter((e) => !e.id.startsWith('local:'));

// Lists the host's log again (on the view's mount, when the process returns to ready, after each receipt).
export async function refreshSide(parent: AppSessionId, client: MawsBridge = ipc): Promise<void> {
  const serial = (listings.get(parent) ?? 0) + 1;
  listings.set(parent, serial);
  const result = await client.invoke('side.question.list', { appSessionId: parent });
  if (listings.get(parent) !== serial) return;
  if (!result.ok) {
    console.warn('[side] side.question.list failed', result.error.message);
    if (sidePaneOf(useSidePane.getState(), parent).exchanges === null) show(parent, []);
    return;
  }
  show(parent, result.value.exchanges);
}

// Asks the engine a side question beside the running turn: drawn pending at once, sent through the host (which adds
// the earlier answers as `history`), and listed again once the host took it.
export async function askSide(parent: AppSessionId, question: string, client: MawsBridge = ipc): Promise<void> {
  const local: SideExchange = { id: `local:${++localSerial}`, question, state: 'pending', response: null, synthetic: false, error: null, askedAt: new Date().toISOString(), answeredAt: null };
  locals.set(parent, [...localsOf(parent), local]);
  show(parent, hostListed(parent));
  const result = await client.invoke('session.sideQuestion', { appSessionId: parent, question });
  if (!result.ok) {
    locals.set(parent, localsOf(parent).map((e) => (e.id === local.id ? { ...e, state: 'failed', error: result.error.message, answeredAt: new Date().toISOString() } : e)));
    show(parent, hostListed(parent));
    return;
  }
  locals.set(parent, localsOf(parent).filter((e) => e.id !== local.id));
  await refreshSide(parent, client);
}

// Retry on a failed exchange: the same question asked again, standing in for the failed one.
export function retrySide(parent: AppSessionId, exchange: SideExchange, client: MawsBridge = ipc): Promise<void> {
  if (exchange.id.startsWith('local:')) locals.set(parent, localsOf(parent).filter((e) => e.id !== exchange.id));
  else retried.set(parent, new Set(retried.get(parent)).add(exchange.id));
  return askSide(parent, exchange.question, client);
}

// A new side conversation: the host drops its answered and failed exchanges (pending ones stay, so their completions
// find them), and so does this window.
export async function clearSide(parent: AppSessionId, client: MawsBridge = ipc): Promise<void> {
  locals.set(parent, localsOf(parent).filter((e) => e.state === 'pending'));
  retried.delete(parent);
  const result = await client.invoke('side.question.clear', { appSessionId: parent });
  if (!result.ok) console.warn('[side] side.question.clear failed', result.error.message);
  await refreshSide(parent, client);
}

// A `session.sideQuestion` completion (subscribed once, `register.ts`): its entry patched as the host settled it (a
// success answers it whatever it read before, a late one included; a failure settles only a pending one), or, for an
// entry not listed yet, the log listed again. A session whose log this window never listed is left to its first listing.
export function onSideOperation(event: OperationEvent, client: MawsBridge = ipc): void {
  if (event.command !== 'session.sideQuestion') return;
  const parent = event.appSessionId as AppSessionId;
  const exchanges = sidePaneOf(useSidePane.getState(), parent).exchanges;
  if (exchanges === null) return;
  const entry = exchanges.find((e) => e.id === event.opId);
  if (!entry) {
    void refreshSide(parent, client);
    return;
  }
  const at = new Date().toISOString();
  let settled: SideExchange;
  if (event.outcome.ok) {
    const value = event.outcome.value as SideQuestionResponse; // the side_question schema parsed it
    settled = { ...entry, state: 'answered', response: value.response, synthetic: value.synthetic, error: null, answeredAt: at };
  } else if (entry.state === 'pending') {
    settled = { ...entry, state: 'failed', error: event.outcome.error.message, answeredAt: at };
  } else return;
  patch(parent, { exchanges: exchanges.map((e) => (e === entry ? settled : e)) });
}

// `text` within `cap` UTF-16 units: whole, or cut with `…` as its last unit (never between a surrogate pair's halves).
function clip(text: string, cap: number): string {
  if (text.length <= cap) return text;
  let end = cap - 1;
  if (/[\uD800-\uDBFF]/.test(text[end - 1]!)) end -= 1;
  return `${text.slice(0, end)}…`;
}

// The answered exchanges a promotion carries (the most recent fifty, the command's bound), each clipped to the command's
// caps, so a long pasted question or answer shortens its own exchange rather than refusing the promotion.
export const promotable = (exchanges: readonly SideExchange[]): { question: string; response: string }[] =>
  exchanges
    .flatMap((e) => (e.state === 'answered' && e.response !== null ? [{ question: clip(e.question, SIDE_QUESTION_CAP), response: clip(e.response, SIDE_ANSWER_CAP) }] : []))
    .slice(-50);

// Tests: the module's own bookkeeping back to empty.
export function resetSideQuestions(): void {
  locals.clear();
  retried.clear();
  listings.clear();
  localSerial = 0;
}
