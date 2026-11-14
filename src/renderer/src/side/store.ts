// The Side pane's state per parent session (E3 execution document, Design §6 and §7, Interfaces "Renderer"): which view
// the pane shows (set by whoever opens it: the composer, a summary row's Open, a chip), which child the
// pane is showing right now, so the unread rule counts that child as on screen (`session/visibility.ts`), and the
// session's side questions. Outside React and keyed by the parent, so a pane opened before its tab exists, or restored
// from layout.json, reads the same view.
//
// The side questions are the host's log (X13: it outlives a renderer reload), listed by `side.question.list` and
// patched from `session.operation` completions; a question this window asked shows at once as a local pending entry
// (`local:<n>`) until the first listing after its receipt holds the host's entry for it. A question the host never
// took (the invoke itself refused) stays here, failed, until it is retried or cleared. A Retry of a host entry names it
// (`retryOf`), and the host's log drops it once the retry is entered (E11); until then this window's stand-in is drawn in
// its place, and nothing is hidden once the stand-in is gone (a reload lists the host's log as it is).
import { create } from 'zustand';
import type { OperationEvent } from '@shared/engine/operations';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { isAddress, machineOf } from '@shared/machine/address'; // UX wave U4a
import { SIDE_ANSWER_CAP, SIDE_QUESTION_CAP } from '@shared/ipc/schema/side';
import type { SideExchange } from '@shared/side/question';
import type { SideQuestionResponse } from '@shared/wire/control';
import { ipc } from '../ipc/client';
import { askSession, drivenByBridge } from '../session/controls/controls-for'; // P5 O9 M4
import { followOp, sideAnswerOf } from '../lane-a/outcomes'; // P5 O9 M5

// UX wave U4a (O-20): the question view left the pane for the session's `/btw` card (below); a view an earlier build
// stored as `{ kind: 'btw' }` reads as no choice, so the pane shows the newest thread
export type SideView = { kind: 'thread'; childAppSessionId: AppSessionId };

// exported because connectVisibility's default `stores` names it in its declaration (TS4076 in the composite build)
export interface SidePane {
  view: SideView | null;
  shownChild: AppSessionId | null; // the child whose transcript the pane draws while the pane is on screen
  exchanges: readonly SideExchange[] | null; // the side questions, oldest first; null until first listed
  // a side thread's own: its side questions open under its thread view in the pane that hosts it (a `/btw` typed in
  // the thread's composer answers there, never in the thread's own panel off screen)
  inlineQuestions: boolean;
}

const EMPTY: SidePane = { view: null, shownChild: null, exchanges: null, inlineQuestions: false };

export const useSidePane = create<{ panes: ReadonlyMap<AppSessionId, SidePane> }>()(() => ({ panes: new Map() }));

export const sidePaneOf = (state: { panes: ReadonlyMap<AppSessionId, SidePane> }, parent: AppSessionId): SidePane => state.panes.get(parent) ?? EMPTY;

function patch(parent: AppSessionId, change: Partial<SidePane>): void {
  useSidePane.setState(({ panes }) => {
    const before = panes.get(parent) ?? EMPTY;
    const next = { ...before, ...change };
    if ((Object.keys(next) as (keyof SidePane)[]).every((key) => next[key] === before[key])) return { panes };
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

// A thread drawn on screen in its parent's pane now (its composer is the pane's).
export const hostedInSidePane = (child: AppSessionId, state = useSidePane.getState()): boolean => [...sideChildrenShown(state).values()].includes(child);

// The thread's side questions under its thread view, open or closed.
export const setInlineQuestions = (child: AppSessionId, open: boolean): void => patch(child, { inlineQuestions: open });

// Every parent whose pane shows a child now, with that child.
export function sideChildrenShown(state = useSidePane.getState()): ReadonlyMap<AppSessionId, AppSessionId> {
  const shown = new Map<AppSessionId, AppSessionId>();
  for (const [parent, pane] of state.panes) if (pane.shownChild !== null) shown.set(parent, pane.shownChild);
  return shown;
}

// ---- side questions ----------------------------------------------------------------------------------------------------

// This window's questions the host does not list (yet): awaiting their receipt, or refused before the host took them.
const locals = new Map<AppSessionId, SideExchange[]>();
// A local that asks a failed host entry again, by its id: the host entry it stands in for until the host enters it.
const standsIn = new Map<string, string>();
// The latest listing asked per parent: an older answer arriving after it is dropped.
const listings = new Map<AppSessionId, number>();
// The completions patched in per parent, counted: a listing asked before one and answered after it holds that exchange
// as it was before, so it is dropped and asked again (the host settles its entry before the completion goes out).
const completions = new Map<AppSessionId, number>();
let localSerial = 0;

const localsOf = (parent: AppSessionId) => locals.get(parent) ?? [];

// Keeps the parent's locals `keep` accepts; a dropped one stands in for nothing any more.
function keepLocals(parent: AppSessionId, keep: (local: SideExchange) => boolean): void {
  const [kept, dropped] = [localsOf(parent).filter(keep), localsOf(parent).filter((e) => !keep(e))];
  for (const local of dropped) {
    standsIn.delete(local.id);
    heldSince.delete(local.id); // UX wave U4a: a host entry that took its place has its time already
  }
  locals.set(parent, kept);
}

function show(parent: AppSessionId, listed: readonly SideExchange[]): void {
  const replaced = new Set(localsOf(parent).flatMap((e) => standsIn.get(e.id) ?? []));
  const merged = [...listed.filter((e) => !replaced.has(e.id)), ...localsOf(parent)].sort((a, b) => a.askedAt.localeCompare(b.askedAt));
  holdPending(merged);
  patch(parent, { exchanges: merged });
}

// The exchanges as listed last, without this window's locals (which `show` adds back).
const hostListed = (parent: AppSessionId): SideExchange[] => (sidePaneOf(useSidePane.getState(), parent).exchanges ?? []).filter((e) => !e.id.startsWith('local:'));

// Lists the host's log again (on the view's mount, when the process returns to ready, after each receipt).
export async function refreshSide(parent: AppSessionId, client: MawsBridge = ipc): Promise<void> {
  if (drivenByBridge(parent)) return show(parent, []); // P5 O9 M5: no host log; this window's locals only
  const serial = (listings.get(parent) ?? 0) + 1;
  listings.set(parent, serial);
  const completed = completions.get(parent) ?? 0;
  const result = await client.invoke('side.question.list', { appSessionId: parent });
  if (listings.get(parent) !== serial) return;
  if ((completions.get(parent) ?? 0) !== completed) return refreshSide(parent, client);
  if (!result.ok) {
    console.warn('[side] side.question.list failed', result.error.message);
    if (sidePaneOf(useSidePane.getState(), parent).exchanges === null) show(parent, []);
    return;
  }
  show(parent, result.value.exchanges);
}

// Asks the engine a side question beside the running turn: drawn pending at once, sent through the session's controls
// port (lane B: the host, which adds the earlier answers as `history`), and listed again once the host took it. `retryOf`: the failed host entry this
// question asks again, which the new one is drawn in place of.
export async function askSide(parent: AppSessionId, question: string, client: MawsBridge = ipc, retryOf?: string): Promise<void> {
  const local: SideExchange = { id: `local:${++localSerial}`, question, state: 'pending', response: null, synthetic: false, error: null, askedAt: new Date().toISOString(), answeredAt: null };
  locals.set(parent, [...localsOf(parent), local]);
  if (retryOf !== undefined) standsIn.set(local.id, retryOf);
  show(parent, hostListed(parent));
  const result = await askSession(parent, question, retryOf, client); // P5 O9 M4: the session's controls port
  if (!result.ok) {
    // P5 O9: an ask the bridge may have taken (its acknowledgement timed out) stays pending, saying so, its op followed
    const uncertainOp = drivenByBridge(parent) ? uncertainOpOf(result.error.issues) : null;
    const settle = (e: SideExchange): SideExchange => (uncertainOp !== null ? { ...e, error: result.error.message } : { ...e, state: 'failed', error: result.error.message, answeredAt: new Date().toISOString() });
    locals.set(parent, localsOf(parent).map((e) => (e.id === local.id ? settle(e) : e)));
    show(parent, hostListed(parent));
    if (uncertainOp !== null) followBridgeAnswer(parent, local.id, uncertainOp, client);
    return;
  }
  if (drivenByBridge(parent)) return followBridgeAnswer(parent, local.id, result.value.opId, client); // P5 O9 M5
  heldSince.set(result.value.opId, heldSince.get(local.id) ?? Date.now()); // UX wave U4a: the host's entry waits since this ask
  keepLocals(parent, (e) => e.id !== local.id);
  await refreshSide(parent, client);
}

// P5 O9 M5 start: a terminal session driven through its bridge keeps no log of side questions, so its exchange stays
// this window's local, settled from the watch's `op` messages for its id (the end's text, else its reason) and failed
// when no end arrives; a Retry asks again as a new op. An ask whose acknowledgement is unknown but names its op (the
// bridge's 504) is followed the same way, pending with its doubt as its `error` until the op ends; Retry stays offered.
const uncertainOpOf = (issues: unknown): string | null => {
  const named = issues !== null && typeof issues === 'object' ? (issues as { unknown?: unknown; opId?: unknown }) : null;
  return named?.unknown !== undefined && typeof named.opId === 'string' ? named.opId : null;
};

function followBridgeAnswer(parent: AppSessionId, localId: string, opId: string, client: MawsBridge): void {
  followOp(
    parent,
    opId,
    (body) => {
      const answer = sideAnswerOf(body);
      const at = new Date().toISOString();
      const settle = (e: SideExchange): SideExchange =>
        'response' in answer ? { ...e, state: 'answered', response: answer.response, error: null, answeredAt: at } : { ...e, state: 'failed', error: answer.error, answeredAt: at };
      locals.set(parent, localsOf(parent).map((e) => (e.id === localId && e.state === 'pending' ? settle(e) : e)));
      show(parent, hostListed(parent));
    },
    client,
  );
}
// P5 O9 M5 end

// Retry on a failed exchange: the same question asked again, standing in for the failed one. A host entry is named to
// the host; a local one hands on the host entry it stood in for, if any.
export function retrySide(parent: AppSessionId, exchange: SideExchange, client: MawsBridge = ipc): Promise<void> {
  if (!exchange.id.startsWith('local:')) return askSide(parent, exchange.question, client, exchange.id);
  const retryOf = standsIn.get(exchange.id);
  keepLocals(parent, (e) => e.id !== exchange.id);
  return askSide(parent, exchange.question, client, retryOf);
}

// A new side conversation: the host drops its answered and failed exchanges (pending ones stay, so their completions
// find them), and so does this window.
export async function clearSide(parent: AppSessionId, client: MawsBridge = ipc): Promise<void> {
  keepLocals(parent, (e) => e.state === 'pending');
  if (drivenByBridge(parent)) return show(parent, []); // P5 O9 M5
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
  completions.set(parent, (completions.get(parent) ?? 0) + 1);
  patch(parent, { exchanges: exchanges.map((e) => (e === entry ? settled : e)) });
}

// P5 O7 M8 (§U, the panel parts): main's `remote.reopened`, a remote session's stream opened again after an end, over
// which a side question's change may have gone unheard: its log is listed again. A session whose log this window never
// listed is left to its first listing, as a completion leaves it.
export function onSideReopened(parent: AppSessionId, client: MawsBridge = ipc): void {
  if (sidePaneOf(useSidePane.getState(), parent).exchanges === null) return;
  void refreshSide(parent, client);
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

// The ids of the exchanges `promotable` carries, in its order.
const promotedIds = (exchanges: readonly SideExchange[]): string[] =>
  exchanges
    .filter((e) => e.state === 'answered' && e.response !== null)
    .slice(-50)
    .map((e) => e.id);

// The exchanges a "Continue as a side thread" in flight carries, per session (UX wave U4a, the panel's finding 9): here and
// not in the component, so a fold and a reopen of the card (a new mount) still know one is under way, and a second press
// opens no second thread; each press's fork is a thread of its own (`side.thread.open` does not deduplicate).
export const usePromotions = create<{ inFlight: ReadonlyMap<AppSessionId, ReadonlySet<string>> }>()(() => ({ inFlight: new Map() }));

/** Whether a promotion of any of these exchanges is under way. */
export function promotionInFlight(state: { inFlight: ReadonlyMap<AppSessionId, ReadonlySet<string>> }, parent: AppSessionId, exchanges: readonly SideExchange[]): boolean {
  const held = state.inFlight.get(parent);
  return held !== undefined && promotedIds(exchanges).some((id) => held.has(id));
}

/** The promotion of these exchanges begun, and its end to call once it is answered; null while one of them is under way. */
export function beginPromotion(parent: AppSessionId, exchanges: readonly SideExchange[]): (() => void) | null {
  if (promotionInFlight(usePromotions.getState(), parent, exchanges)) return null;
  const ids = promotedIds(exchanges);
  const change = (keep: (held: ReadonlySet<string>) => Set<string>) =>
    usePromotions.setState(({ inFlight }) => ({ inFlight: new Map(inFlight).set(parent, keep(inFlight.get(parent) ?? new Set())) }));
  change((held) => new Set([...held, ...ids]));
  return () => change((held) => new Set([...held].filter((id) => !ids.includes(id))));
}

// ---- the `/btw` card (UX wave U4a, decision 26) ------------------------------------------------------------------------

// When this window first held each exchange pending (its id), the clock a session on another machine's wait is counted
// on: that machine's `askedAt` is its own clock, which this window's need not agree with. A question this window asked
// hands its time on to the host's entry that takes its place.
const heldSince = new Map<string, number>();
function holdPending(exchanges: readonly SideExchange[]): void {
  for (const e of exchanges) {
    if (e.state === 'pending') {
      if (!heldSince.has(e.id)) heldSince.set(e.id, Date.now());
    } else heldSince.delete(e.id);
  }
}

// From when the card's waiting line counts, in this window's milliseconds: the question's `askedAt`, except for a host
// entry of a session on another machine, which counts from when this window first held it pending.
export function waitingSince(parent: AppSessionId, exchange: SideExchange): number {
  const elsewhere = isAddress(parent) && machineOf(parent) !== ipc.localMachine;
  if (!elsewhere || exchange.id.startsWith('local:')) return Date.parse(exchange.askedAt);
  if (!heldSince.has(exchange.id)) heldSince.set(exchange.id, Date.now());
  return heldSince.get(exchange.id)!;
}

// Each session's card: closed (drawn as nothing), open, or folded to its chip; whether the session's side-question field
// is to take the keyboard once drawn (a pick of `/btw` from the palette asks it, for the card or, for a side thread hosted
// in its parent's pane, the questions under its thread view); the question typed in the card and not asked yet, so a fold
// or a close hides it and loses nothing; and the settled exchanges seen while it was open on screen, so an answer that
// settles while it is folded, closed or off screen is unseen until it is open again. The window's for its life and never
// stored: after a reload every card is closed and empty until the next `/btw`.
export type BtwCardView = 'closed' | 'open' | 'folded';
export interface BtwCard {
  view: BtwCardView;
  focus: boolean;
  question: string;
  seen: ReadonlySet<string>; // each settled exchange seen, by its id and its state
}
const CLOSED: BtwCard = { view: 'closed', focus: false, question: '', seen: new Set() };

export const useBtwCards = create<{ cards: ReadonlyMap<AppSessionId, BtwCard> }>()(() => ({ cards: new Map() }));

export const btwCardOf = (state: { cards: ReadonlyMap<AppSessionId, BtwCard> }, parent: AppSessionId): BtwCard => state.cards.get(parent) ?? CLOSED;

function patchCard(parent: AppSessionId, change: (card: BtwCard) => BtwCard): void {
  useBtwCards.setState(({ cards }) => {
    const before = cards.get(parent) ?? CLOSED;
    const next = change(before);
    return next === before ? { cards } : { cards: new Map(cards).set(parent, next) };
  });
}

export const openBtwCard = (parent: AppSessionId, options: { focus?: boolean } = {}): void =>
  patchCard(parent, (card) => (card.view === 'open' && (card.focus || !options.focus) ? card : { ...card, view: 'open', focus: card.focus || options.focus === true }));
// The keyboard asked for the session's side-question field wherever it is drawn, the card left as it is.
export const requestSideFocus = (parent: AppSessionId): void => patchCard(parent, (card) => (card.focus ? card : { ...card, focus: true }));
// The card's unasked question, a value or the next from the current one.
export const setBtwQuestion = (parent: AppSessionId, next: string | ((current: string) => string)): void =>
  patchCard(parent, (card) => {
    const question = typeof next === 'function' ? next(card.question) : next;
    return question === card.question ? card : { ...card, question };
  });
// The field took the keyboard: the request is spent, so a later mount (the tab shown again) leaves the keyboard alone.
export const takeBtwFocus = (parent: AppSessionId): void => patchCard(parent, (card) => (card.focus ? { ...card, focus: false } : card));
export const foldBtwCard = (parent: AppSessionId): void => patchCard(parent, (card) => (card.view === 'open' ? { ...card, view: 'folded', focus: false } : card));
export const closeBtwCard = (parent: AppSessionId): void => patchCard(parent, (card) => (card.view === 'closed' ? card : { ...card, view: 'closed', focus: false }));

// Each settled exchange by its id and how it settled (the panel's finding 10): a late answer that replaces a failure keeps
// the exchange's id (`onSideOperation`), and is news all the same.
const settled = (exchanges: readonly SideExchange[]): string[] => exchanges.flatMap((e) => (e.state === 'pending' ? [] : [`${e.id}\u0000${e.state}`]));

// The open card on screen has seen every settled exchange it draws.
export function markBtwSeen(parent: AppSessionId, exchanges: readonly SideExchange[]): void {
  patchCard(parent, (card) => {
    const fresh = settled(exchanges).filter((id) => !card.seen.has(id));
    return fresh.length === 0 ? card : { ...card, seen: new Set([...card.seen, ...fresh]) };
  });
}

// An answer (or a failure) that settled since the card was last open on screen: the folded chip's dot.
export const btwUnseen = (card: BtwCard, exchanges: readonly SideExchange[]): boolean => settled(exchanges).some((id) => !card.seen.has(id));

// Tests: the module's own bookkeeping back to empty, the cards with it.
export function resetSideQuestions(): void {
  locals.clear();
  standsIn.clear();
  listings.clear();
  completions.clear(); // UX wave U4a
  heldSince.clear(); // UX wave U4a
  useBtwCards.setState({ cards: new Map() }); // UX wave U4a
  usePromotions.setState({ inFlight: new Map() }); // UX wave U4a
  localSerial = 0;
}
