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
import type { RequestAnswer } from '@shared/engine/answers';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, AppSessionId, AttentionId, ToolUseId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { ipcError } from '@shared/ipc/errors';
import type { CommandResult, EventPayload, MawsBridge } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import { waitingAgents, waitingByCall, waits } from '@shared/attention/kinds';
import { waitingForms, waitingRequests } from '@shared/attention/waiting'; // UX wave U1b
import { needsYou, type NeedsYouRow } from '../attention/derive';
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
  unreadable: Map<AttentionId, string>; // why an item's request could not be read; forgotten once the item no longer waits
  // W4: a question card's answers in progress, beside its request, so a remount or a move between placements resumes
  // them (`request-card/question-steps.ts`); dropped once the item no longer waits (UC-1: at the answer).
  drafts: Map<AttentionId, QuestionDraft>;
  // UX wave U1b (the branch review's ruling of 2026-11-15 UTC): beside them, by the same lifetime, the text a card's box
  // holds: a prompt's reason for denying, a plan's feedback. Present: the box is open with that text; absent: closed.
  textDrafts: Map<AttentionId, string>;
  // P5 O7 M6: the sessions of every machine whose attention main holds greyed.
  greyed: ReadonlySet<AppSessionId>;
  // UX wave U1b (Interfaces §G, decisions 8 and 21): what is known of a question's answer before the transcript's own row
  // carries it, by the addressed session and the call: the answers this window sent, a dismissal, or a settlement's
  // words. Memory, per window. The ruling of 2026-11-15 on M1's D-2: a receipt lasts until the row carries its own
  // answers (the row then reads its own) or the session leaves this window (`forgetReceipts`, called by the card's
  // follower, `request-card/receipts.ts`); a session's list emptied or dropped by a snapshot is no leaving.
  receipts: ReadonlyMap<AppSessionId, ReadonlyMap<ToolUseId, Receipt>>;
  recordReceipt(appSessionId: AppSessionId, call: ToolUseId, receipt: Receipt): void; // a `settled` receipt never replaces an `answers` or a `dismissed` one
  forgetReceipts(appSessionId: AppSessionId): void; // the session left: its receipts go, and only its own
  // UX wave U1b (Interfaces §G "The delivery", decision 17): a card's answer, held by the request so that a card mounted
  // again, or another placement of the same item, reads the one state. One answer in flight per item; `sent` until the
  // item leaves the session's list; `not_pending` for NOT_PENDING_MS, then `closed` (drawn by no placement) until the
  // item leaves; `failed` with the answer a Retry sends again. An entry goes when its item leaves the list.
  deliveries: ReadonlyMap<AttentionId, Delivery>;
  deliver(item: AttentionItem, answer: RequestAnswer): Promise<Outcome>; // the card's submit: the session's port (`connectAnswers`), its outcome, the receipt
  // UX wave U1b M3 (the architect's ruling of 2026-11-15): the test reset's (`fillStores`), which no `setState` reaches:
  // the answers held in flight, so a case that left one out keeps no later case's answer from being sent. The app never
  // calls it.
  forgetAnswersInFlight(): void;
  // UX wave U1b (Interfaces §G "The settling receipt", decision 20): a terminal session's request answered first elsewhere
  // says so for SETTLED_MS where it stood, held here (the end row leaves with its last request). Written and removed by
  // the card's follower (`request-card/receipts.ts`); never a waiting request: no list, count or key reads it.
  settling: ReadonlyMap<AppSessionId, readonly Settling[]>;
  holdSettling(appSessionId: AppSessionId, entry: Settling): void;
  releaseSettling(appSessionId: AppSessionId, id: AttentionId): void;
  // P5 O6 M4: per machine. A machine's snapshot replaces its sessions' lists only, and buffers only its changes; begun
  // again (a new generation of its link) it drops what it had buffered.
  beginSnapshot(machine: MachineRef): void;
  applySnapshot(items: AttentionItem[], machine: MachineRef): void;
  // The snapshot nobody answered: the machine's buffer replays over what is held, and nothing is removed.
  cancelSnapshot(machine: MachineRef): void;
  applyChanged(change: EventPayload<'attention.changed'>, machine: MachineRef): void;
  // UX wave U1a (Reported 9): a session's list that the machine's feed and lists never carry (lane A's mirror of a remote
  // terminal session, `lane-a/remote-connect.ts`), written at once, never buffered, and left standing, its drafts with it,
  // by the machine's snapshots until the mirror empties it.
  applyMirrored(change: EventPayload<'attention.changed'>, machine: MachineRef): void;
  // P5 O7 M6: another machine's feed snapshot (`remote.attention`), its partition replaced whole and greyed or not.
  applyRemote(snapshot: EventPayload<'remote.attention'>): void;
  applyNotified(notified: EventPayload<'attention.notified'>): void;
  loadRequest(client: MawsBridge, item: AttentionItem): Promise<void>; // once per item; a failed read is retried once
  retryRequest(client: MawsBridge, item: AttentionItem): Promise<void>; // an unreadable item's read, asked again (the card's Retry)
  setDraft(id: AttentionId, draft: QuestionDraft): void;
  setTextDraft(id: AttentionId, text: string | null): void; // null: the box closed, its text gone
}

/** UX wave U1b (Interfaces §G): what is known of a question's answer before the transcript's own row carries it. */
export type Receipt = { answers: Record<string, string> } | { dismissed: true } | { settled: string };

/** UX wave U1b (Interfaces §G "The delivery"): where a card's answer stands, by its item. `closed`: answered elsewhere and
 * said so for NOT_PENDING_MS; no placement draws the card again until its item leaves the list. */
export type Delivery = { phase: 'answering' | 'sent' | 'not_pending' | 'closed' } | { phase: 'failed'; detail: string | null; answer: RequestAnswer };
export type Outcome = 'delivered' | 'not_pending' | 'write_failed';
export const NOT_PENDING_MS = 2_000;
/** What a card says while its answer was too late (`not_pending`), and, after (decision 8a), its question's receipt: the
 * race's own words for the same fact (`lane-a/race.ts`; the word cut, N107). */
export const ANSWERED_ELSEWHERE = 'Answered elsewhere';

/** UX wave U1b (Interfaces §G "The settling receipt"): one request its terminal, or another client, answered first. */
export interface Settling { id: AttentionId; call: ToolUseId | null; agentId: AgentId | null; summary: string; words: string; until: number }

/** The way an answer reaches its session, given by the card's module (`request-card/RequestCard.tsx`): the session's
 * controls port and lane A's race. Both import MAWS's IPC client, which this store must not: a row's view imports the
 * store, and desk web bundles the rows. */
export interface AnswerPort {
  send(item: AttentionItem, answer: RequestAnswer): Promise<CommandResult<'session.answer'>>;
  terminalOnly(item: AttentionItem): boolean; // a request the terminal alone answers now: answered elsewhere puts it back to pending
}
const NOT_CONNECTED: CommandResult<'session.answer'> = { ok: false, error: ipcError('internal', 'No answer path is connected') };
const NO_PORT: AnswerPort = { send: () => Promise.resolve(NOT_CONNECTED), terminalOnly: () => false };
let answerPort: AnswerPort = NO_PORT;
/** Gives the store its answer path; the returned function takes it back. */
export function connectAnswers(port: AnswerPort): () => void {
  answerPort = port;
  return () => {
    if (answerPort === port) answerPort = NO_PORT;
  };
}

// A question's call, for the receipts a delivery writes: the engine's or a bridge's question (kind `question`, or
// `async_input` for a terminal's asynchronous question) with a call id; null for any other request.
const questionCall = (item: AttentionItem): ToolUseId | null => (item.kind === 'question' || item.kind === 'async_input' ? item.request.toolUseId : null);
// Decision 8b: a plan's row keeps the known answer too, so the answered-elsewhere receipt is written for a plan's call as
// well as a question's.
const answeredCall = (item: AttentionItem): ToolUseId | null => (item.kind === 'plan' ? item.request.toolUseId : questionCall(item));

// What a delivered answer says of its question (M1's D-5, moved here with the delivery): the answers sent, or a dismissal
// for the decline; nothing for an answer to any other request. A question's item, the engine's or a bridge's, is of kind
// `question`, or `async_input` for a terminal's asynchronous question.
function receiptOfAnswer(item: AttentionItem, answer: RequestAnswer): Receipt | null {
  if (questionCall(item) === null) return null;
  if (answer.kind === 'question') return { answers: { ...answer.answers } };
  return answer.kind === 'permission' && answer.decision !== 'allow' ? { dismissed: true } : null;
}

export const REQUEST_RETRY_MS = 1_000; // the wait before a failed `attention.request` read is retried, once

// The unreadable items that no longer wait (answered or retired) are forgotten, with the null their read left cached.
function forgetSettled(state: Pick<AttentionState, 'requests' | 'unreadable'>, bySession: Map<AppSessionId, AttentionItem[]>): Partial<AttentionState> {
  if (state.unreadable.size === 0) return {};
  const pending = new Set([...bySession.values()].flatMap((items) => items.filter(waits).map((item) => item.id)));
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

// The drafts of items that no longer wait (answered, retired, gone) are dropped: a question's answers in progress and a
// box's text (UX wave U1b) alike.
function forgetClosedDrafts(state: Pick<AttentionState, 'drafts' | 'textDrafts'>, bySession: Map<AppSessionId, AttentionItem[]>): Partial<AttentionState> {
  if (state.drafts.size === 0 && state.textDrafts.size === 0) return {};
  const open = new Set([...bySession.values()].flatMap((items) => items.filter(waits).map((item) => item.id)));
  const drafts = new Map([...state.drafts].filter(([id]) => open.has(id)));
  const textDrafts = new Map([...state.textDrafts].filter(([id]) => open.has(id)));
  return { ...(drafts.size !== state.drafts.size && { drafts }), ...(textDrafts.size !== state.textDrafts.size && { textDrafts }) };
}

// UX wave U1b (§G "The delivery"): the deliveries of items that no longer wait (answered, retired, gone) go, as drafts do.
function forgetClosedDeliveries(deliveries: AttentionState['deliveries'], bySession: Map<AppSessionId, AttentionItem[]>): Partial<AttentionState> {
  if (deliveries.size === 0) return {};
  const open = new Set([...bySession.values()].flatMap((items) => items.filter(waits).map((item) => item.id)));
  const kept = new Map([...deliveries].filter(([id]) => open.has(id)));
  return kept.size === deliveries.size ? {} : { deliveries: kept };
}

const sameReceipt = (a: Receipt | undefined, b: Receipt): boolean => a !== undefined && JSON.stringify(a) === JSON.stringify(b);

// P5 O6 M4: a machine's part of the store, the sessions whose lists the calls naming it wrote (never parsed from ids), and
// its changes buffered while its snapshot is outstanding.
interface Partition {
  sessions: Set<AppSessionId>;
  mirrored: Set<AppSessionId>; // U1a: those of its sessions whose list the mirror writes (`applyMirrored`), which no snapshot replaces
  buffer: Map<AppSessionId, AttentionItem[]> | null;
  greyed: boolean; // P5 O7 M6: as main last said it in `remote.attention`
  // P5 O7 M6 (M6c fix wave 1): main's feed speaks for this machine (a first `remote.attention` came), for the page's life:
  // a snapshot begun for it (an RL2 machine the roster brought up before the org rows named it) buffers nothing, and its
  // answer, late or failed, writes nothing, so it can neither bring back an item the feed cleared nor erase one it holds.
  fed: boolean;
}

export function createAttentionStore() {
  const inFlight = new Map<AttentionId, Promise<void>>();
  const answering = new Map<AttentionId, Promise<Outcome>>(); // U1b: the one answer in flight per item
  // U1b (M2's review, on the ruling on M1's D-2): how many times each session left this window (`forgetReceipts`). A
  // delivery writes its receipt only when its session has not left since the answer went out: the leaving is said once,
  // at its edge, and an outcome arriving after it would otherwise write the session's receipts again.
  const departures = new Map<AppSessionId, number>();
  const departuresOf = (id: AppSessionId) => departures.get(id) ?? 0;
  const partitions = new Map<MachineRef, Partition>();
  const partition = (machine: MachineRef): Partition => {
    let p = partitions.get(machine);
    if (!p) partitions.set(machine, (p = { sessions: new Set(), mirrored: new Set(), buffer: null, greyed: false, fed: false }));
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
    // The partition's sessions replaced by `items`, grouped per session, into `bySession`; a mirrored session's list stands.
    const replace = (p: Partition, bySession: Map<AppSessionId, AttentionItem[]>, items: AttentionItem[]) => {
      for (const id of p.sessions) if (!p.mirrored.has(id)) bySession.delete(id);
      p.sessions = new Set(p.mirrored);
      for (const item of items) {
        if (p.mirrored.has(item.appSessionId)) continue; // the feed carries no terminal session's item; the mirror's list is the session's
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
      set({ bySession, version: get().version + 1, loaded: true, pendingReplacements: buffered(), greyed: greyedAfter(p, before), ...forgetSettled(get(), bySession), ...forgetClosedDrafts(get(), bySession), ...forgetClosedDeliveries(get().deliveries, bySession) });
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
      textDrafts: new Map(),
      greyed: new Set(),
      receipts: new Map(),
      deliveries: new Map(),
      settling: new Map(),
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
        set({ bySession, greyed, version: get().version + 1, ...forgetSettled(get(), bySession), ...forgetClosedDrafts(get(), bySession), ...forgetClosedDeliveries(get().deliveries, bySession) });
      },
      applyMirrored({ appSessionId, items }, machine) {
        const p = partition(machine);
        if (items.length === 0) p.mirrored.delete(appSessionId);
        else p.mirrored.add(appSessionId);
        p.sessions.add(appSessionId);
        const bySession = new Map(get().bySession).set(appSessionId, items);
        const greyed = p.greyed && !get().greyed.has(appSessionId) ? greyedAfter(p, []) : get().greyed;
        set({ bySession, greyed, version: get().version + 1, ...forgetSettled(get(), bySession), ...forgetClosedDrafts(get(), bySession), ...forgetClosedDeliveries(get().deliveries, bySession) });
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
        set({ bySession, version: get().version + 1, pendingReplacements: buffered(), greyed: greyedAfter(p, before), ...forgetSettled(get(), bySession), ...forgetClosedDrafts(get(), bySession), ...forgetClosedDeliveries(get().deliveries, bySession) });
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
      setTextDraft(id, text) {
        const textDrafts = new Map(get().textDrafts);
        if (text === null) textDrafts.delete(id);
        else textDrafts.set(id, text);
        set({ textDrafts });
      },
      recordReceipt(appSessionId, call, receipt) {
        const held = get().receipts.get(appSessionId)?.get(call);
        if (sameReceipt(held, receipt) || ('settled' in receipt && held !== undefined && !('settled' in held))) return;
        set({ receipts: new Map(get().receipts).set(appSessionId, new Map(get().receipts.get(appSessionId)).set(call, receipt)) });
      },
      forgetReceipts(appSessionId) {
        departures.set(appSessionId, departuresOf(appSessionId) + 1);
        if (!get().receipts.has(appSessionId)) return;
        const receipts = new Map(get().receipts);
        receipts.delete(appSessionId);
        set({ receipts });
      },
      holdSettling(appSessionId, entry) {
        const held = (get().settling.get(appSessionId) ?? []).filter((s) => s.id !== entry.id);
        set({ settling: new Map(get().settling).set(appSessionId, [...held, entry]) });
      },
      releaseSettling(appSessionId, id) {
        const held = get().settling.get(appSessionId);
        if (held === undefined || !held.some((s) => s.id === id)) return;
        const rest = held.filter((s) => s.id !== id);
        const settling = new Map(get().settling);
        if (rest.length > 0) settling.set(appSessionId, rest);
        else settling.delete(appSessionId);
        set({ settling });
      },
      forgetAnswersInFlight() {
        answering.clear();
      },
      deliver(item, answer) {
        const out = answering.get(item.id);
        if (out) return out; // one answer in flight per item: a second call sends nothing
        const held = get().deliveries.get(item.id);
        if (held !== undefined && held.phase !== 'failed') return Promise.resolve(held.phase === 'sent' ? 'delivered' : 'not_pending'); // answered already
        const entry: Delivery = { phase: 'answering' };
        const write = (next: Delivery | null) => {
          if (get().deliveries.get(item.id) !== entry) return; // the item left the list meanwhile, and its entry with it
          const deliveries = new Map(get().deliveries);
          if (next === null) deliveries.delete(item.id);
          else deliveries.set(item.id, next);
          set({ deliveries });
        };
        set({ deliveries: new Map(get().deliveries).set(item.id, entry) });
        const departed = departuresOf(item.appSessionId);
        const sent = (async (): Promise<Outcome> => {
          const result = await answerPort.send(item, answer);
          answering.delete(item.id);
          const outcome: Outcome = result.ok ? result.value.outcome : 'write_failed';
          const call = questionCall(item);
          const stayed = departuresOf(item.appSessionId) === departed; // its session has not left this window meanwhile
          if (outcome === 'delivered') {
            // the receipt is the answer's, whether or not its item is still listed (an asynchronous question's leaves at once)
            const receipt = receiptOfAnswer(item, answer);
            if (call !== null && receipt !== null && stayed) get().recordReceipt(item.appSessionId, call, receipt);
            write({ phase: 'sent' });
          } else if (outcome === 'not_pending') {
            if (answerPort.terminalOnly(item)) write(null); // P5 O9 M6: the terminal's to answer, still pending
            else {
              // decisions 8a and 8b: the question's or plan's row says so past the card's two seconds, until its own
              // answers or outcome arrive; a receipt already held (a settlement's own words, an answer, a dismissal)
              // says more and stays
              const elsewhere = answeredCall(item);
              if (elsewhere !== null && stayed && get().receipts.get(item.appSessionId)?.get(elsewhere) === undefined) get().recordReceipt(item.appSessionId, elsewhere, { settled: ANSWERED_ELSEWHERE });
              const said: Delivery = { phase: 'not_pending' };
              write(said);
              setTimeout(() => {
                if (get().deliveries.get(item.id) === said) set({ deliveries: new Map(get().deliveries).set(item.id, { phase: 'closed' }) });
              }, NOT_PENDING_MS);
            }
          } else write({ phase: 'failed', detail: result.ok ? null : result.error.message, answer });
          return outcome;
        })();
        answering.set(item.id, sent);
        return sent;
      },
    };
  });
}

export const useAttention = createAttentionStore();

const EMPTY: AttentionItem[] = [];

// UC-1 (U1a's Interfaces §A): what waits in a session's list, by the one predicate, each reading memoised per list so a
// component gets the same object until the list changes. `selectPendingOf` keeps its name: the items for which `waits`
// holds (an answered request is not among them).
const openCache = new WeakMap<AttentionItem[], AttentionItem[]>();
export function selectPendingOf(state: Pick<AttentionState, 'bySession'>, appSessionId: AppSessionId): AttentionItem[] {
  const items = state.bySession.get(appSessionId);
  if (!items) return EMPTY;
  let open = openCache.get(items);
  if (!open) openCache.set(items, (open = items.filter(waits)));
  return open;
}

const NO_CALLS: ReadonlyMap<ToolUseId, AttentionItem> = new Map();
const callsCache = new WeakMap<AttentionItem[], ReadonlyMap<ToolUseId, AttentionItem>>();
/** The session's waiting requests by the tool call each names (`waitingByCall`). */
export function selectWaitingByCall(state: Pick<AttentionState, 'bySession'>, appSessionId: AppSessionId): ReadonlyMap<ToolUseId, AttentionItem> {
  const items = state.bySession.get(appSessionId);
  if (!items) return NO_CALLS;
  let calls = callsCache.get(items);
  if (!calls) callsCache.set(items, (calls = waitingByCall(items)));
  return calls;
}

// UX wave U1b (Interfaces §A): the session's waiting requests oldest first, and the calls its transcript marks as
// waiting rows, by the shared rule, memoised per list as the readings above.
const requestsCache = new WeakMap<AttentionItem[], AttentionItem[]>();
export function selectWaitingRequests(state: Pick<AttentionState, 'bySession'>, appSessionId: AppSessionId): AttentionItem[] {
  const items = state.bySession.get(appSessionId);
  if (!items) return EMPTY;
  let requests = requestsCache.get(items);
  if (!requests) requestsCache.set(items, (requests = waitingRequests(items)));
  return requests;
}
const NO_FORMS: ReadonlySet<ToolUseId> = new Set();
const formsCache = new WeakMap<AttentionItem[], ReadonlySet<ToolUseId>>();
export function selectWaitingForms(state: Pick<AttentionState, 'bySession'>, appSessionId: AppSessionId): ReadonlySet<ToolUseId> {
  const items = state.bySession.get(appSessionId);
  if (!items) return NO_FORMS;
  let forms = formsCache.get(items);
  if (!forms) formsCache.set(items, (forms = waitingForms(items)));
  return forms;
}

const NO_AGENTS: ReadonlySet<string> = new Set();
const agentsCache = new WeakMap<AttentionItem[], ReadonlySet<string>>();
/** The session's agents with a request of their own waiting (`waitingAgents`). */
export function selectWaitingAgents(state: Pick<AttentionState, 'bySession'>, appSessionId: AppSessionId): ReadonlySet<string> {
  const items = state.bySession.get(appSessionId);
  if (!items) return NO_AGENTS;
  let agents = agentsCache.get(items);
  if (!agents) agentsCache.set(items, (agents = waitingAgents(items)));
  return agents;
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
