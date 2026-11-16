// UX wave U1b (docs/doperpowers/plans/2026-11-15-ux-wave-U1b-requests-in-transcript.md, Interfaces §G "The receipt";
// decisions 8 and 21): what a question's row says between the answer and the transcript's own row. The card's own
// answer is written by the attention store's `deliver` at a delivered answer (M2). Here, the follower writes what each
// terminal session's lane A state says was settled, under that session's addressed id and the call the settlement names
// (the bridge's request id for an asynchronous question is its call's tool-use id, C17): a dismissal, or the
// settlement's own words. And a session's receipts go when the session leaves this window (the ruling of 2026-11-15 on
// M1's D-2). A late answer's port records what it was told of the settlement (`told`, `noteLaneASettlement`) before
// it says `not_pending`: that is written as a state's settlement is, in the same words (the branch review). And (M3) a
// terminal session's request answered first elsewhere is held SETTLED_MS as a settling receipt where it stood
// (decision 20). All live here, started by `connectRequestCard()`, so MAWS alone runs them: a row's view reads the
// attention store and never the lane A store, which imports MAWS's IPC client (desk web bundles the rows).
import type { AttentionItem } from '@shared/graph/attention';
import type { AgentId, AppSessionId, ToolUseId } from '@shared/graph/ids';
import type { LaneAState } from '@shared/ipc/schema/lane-a';
import { raceOf, SETTLED_MS, settledWords } from '../lane-a/race';
import { selectWaitingRequests, useAttention, type Receipt, type Settling } from '../stores/attention';
import { useLaneA, type RequestSettlement } from '../stores/lane-a';
import { useSessions, type SessionsState } from '../stores/sessions';

// The bridge's own name for itself as the one who settled (sminos's `RESERVED_BY`): a `/clear`, or the session's end,
// which says nothing of the question's answer.
const BY_BRIDGE = 'bridge';

// One settlement as its question's row says it, or null for one that says nothing of it: the state's own, or what a
// late answer of this window was told (`told`), in the same words.
function receiptOfSettlement(state: LaneAState | null, told: RequestSettlement | null, request: string, said: Pick<RequestSettlement, 'outcome' | 'by'>): Receipt | null {
  if (said.outcome === 'withdrawn') return said.by === BY_BRIDGE ? null : { dismissed: true };
  const race = raceOf(state, told, request, 0).settled;
  const words = race === null ? null : settledWords(race);
  return words === null ? null : { settled: words };
}

function writeSettlements(appSessionId: AppSessionId, state: LaneAState | null, told: ReadonlyMap<string, RequestSettlement> | undefined): void {
  const { recordReceipt } = useAttention.getState();
  for (const settled of state?.settled ?? []) {
    const receipt = receiptOfSettlement(state, null, settled.request, settled);
    if (receipt !== null) recordReceipt(appSessionId, settled.request as ToolUseId, receipt);
  }
  // the branch review (2026-11-15 UTC): a late answer's port writes what it was told before it says `not_pending`, so a
  // state stream that has not caught up still has the settlement's words; the state's own, once it lists one, comes first
  for (const [request, settlement] of told ?? []) {
    if (state?.settled.some((s) => s.request === request) === true) continue;
    const receipt = receiptOfSettlement(state, settlement, request, settlement);
    if (receipt !== null) recordReceipt(appSessionId, request as ToolUseId, receipt);
  }
}

/** Follows every lane A state's settlements, and what this window's late answers were told, into the attention store's
 * receipts, those held now included. */
export function followSettlements(): () => void {
  const { states, told } = useLaneA.getState();
  for (const id of new Set([...states.keys(), ...told.keys()])) writeSettlements(id, states.get(id) ?? null, told.get(id));
  return useLaneA.subscribe((now, before) => {
    if (now.states === before.states && now.told === before.told) return;
    for (const id of new Set([...now.states.keys(), ...now.told.keys()])) {
      const state = now.states.get(id) ?? null;
      if (before.states.get(id)?.settled !== state?.settled || before.told.get(id) !== now.told.get(id)) writeSettlements(id, state, now.told.get(id));
    }
  });
}

// A session this window knows: a record it holds (its own machine's, or another machine's lane B session), or another
// machine's listed row (a terminal session there has no record).
const known = (state: Pick<SessionsState, 'records' | 'listed'>, id: AppSessionId): boolean => state.records.has(id) || state.listed.has(id);

/** Drops a session's receipts when it leaves this window: it was known (a record, or a listed row) and is known no
 * longer (its record removed, or gone from its machine's snapshot; its listing gone). A receipt of a session not yet
 * known stays: it has not left. Its attention list emptied or dropped is no leaving. Every leaving is told to the store,
 * also one with no receipt held yet, so an answer still in flight writes none for it (`deliver`). */
export function followSessionsLeaving(): () => void {
  return useSessions.subscribe((now, before) => {
    if (now.records === before.records && now.listed === before.listed) return;
    const left = new Set<AppSessionId>();
    for (const id of [...before.records.keys(), ...before.listed.keys()]) if (!known(now, id)) left.add(id);
    for (const id of left) useAttention.getState().forgetReceipts(id);
  });
}

// UX wave U1b (Interfaces §G "The settling receipt", decision 20): a request this window listed as waiting that leaves its
// session's list with a settlement naming somewhere other than this app ("Answered in the terminal: Allowed") stands
// SETTLED_MS where it stood, as `useSettling` kept it in the docked card; one this app answered, or one whose settlement
// has no words, writes none.
function settlingOf(item: AttentionItem): Settling | null {
  const { requestId } = item.request;
  if (requestId === null) return null;
  const lanes = useLaneA.getState();
  const state = lanes.states.get(item.appSessionId) ?? null;
  const told = lanes.told.get(item.appSessionId)?.get(requestId) ?? null;
  const settled = raceOf(state, told, requestId, 0).settled;
  if (settled === null || settled.where === 'maws') return null;
  const words = settledWords(settled, { asyncQuestion: item.kind === 'async_input' });
  if (words === null) return null;
  return { id: item.id, call: item.request.toolUseId, agentId: (item.request.agentId ?? null) as AgentId | null, summary: item.summary, words, until: Date.now() + SETTLED_MS };
}

/** Follows the sessions' waiting lists into the settling receipts: each held SETTLED_MS by its own timer. */
export function followSettling(): () => void {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const off = useAttention.subscribe((now, before) => {
    if (now.bySession === before.bySession) return;
    for (const [id, items] of before.bySession) {
      if (now.bySession.get(id) === items) continue;
      const still = new Set(selectWaitingRequests(now, id).map((item) => item.id));
      for (const item of selectWaitingRequests(before, id)) {
        if (still.has(item.id)) continue;
        const entry = settlingOf(item);
        if (entry === null) continue;
        useAttention.getState().holdSettling(id, entry);
        const timer = setTimeout(() => {
          timers.delete(timer);
          useAttention.getState().releaseSettling(id, entry.id);
        }, SETTLED_MS);
        timers.add(timer);
      }
    }
  });
  return () => {
    off();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
}
