// UX wave U1b (docs/doperpowers/plans/2026-11-15-ux-wave-U1b-requests-in-transcript.md, Interfaces §G "The receipt";
// decisions 8 and 21): what a question's row says between the answer and the transcript's own row. The card's own
// answer is written by the attention store's `deliver` at a delivered answer (M2). Here, the follower writes what each
// terminal session's lane A state says was settled, under that session's addressed id and the call the settlement names
// (the bridge's request id for an asynchronous question is its call's tool-use id, C17): a dismissal, or the
// settlement's own words. And a session's receipts go when the session leaves this window (the ruling of 2026-11-15 on
// M1's D-2). Both live here, started by `connectRequestCard()`, so MAWS alone runs them: a row's view reads the
// attention store and never the lane A store, which imports MAWS's IPC client (desk web bundles the rows).
import type { AppSessionId, ToolUseId } from '@shared/graph/ids';
import type { LaneAState } from '@shared/ipc/schema/lane-a';
import { raceOf, settledWords } from '../lane-a/race';
import { useAttention, type Receipt } from '../stores/attention';
import { useLaneA } from '../stores/lane-a';
import { useSessions, type SessionsState } from '../stores/sessions';

// The bridge's own name for itself as the one who settled (sminos's `RESERVED_BY`): a `/clear`, or the session's end,
// which says nothing of the question's answer.
const BY_BRIDGE = 'bridge';

// One settlement as its question's row says it, or null for one that says nothing of it.
function receiptOfSettlement(state: LaneAState, settled: LaneAState['settled'][number]): Receipt | null {
  if (settled.outcome === 'withdrawn') return settled.by === BY_BRIDGE ? null : { dismissed: true };
  const race = raceOf(state, null, settled.request, 0).settled;
  const words = race === null ? null : settledWords(race);
  return words === null ? null : { settled: words };
}

function writeSettlements(appSessionId: AppSessionId, state: LaneAState): void {
  const { recordReceipt } = useAttention.getState();
  for (const settled of state.settled) {
    const receipt = receiptOfSettlement(state, settled);
    if (receipt !== null) recordReceipt(appSessionId, settled.request as ToolUseId, receipt);
  }
}

/** Follows every lane A state's settlements into the attention store's receipts, those held now included. */
export function followSettlements(): () => void {
  for (const [id, state] of useLaneA.getState().states) writeSettlements(id, state);
  return useLaneA.subscribe((now, before) => {
    if (now.states === before.states) return;
    for (const [id, state] of now.states) if (before.states.get(id)?.settled !== state.settled) writeSettlements(id, state);
  });
}

// A session this window knows: a record it holds (its own machine's, or another machine's lane B session), or another
// machine's listed row (a terminal session there has no record).
const known = (state: Pick<SessionsState, 'records' | 'listed'>, id: AppSessionId): boolean => state.records.has(id) || state.listed.has(id);

/** Drops a session's receipts when it leaves this window: it was known (a record, or a listed row) and is known no
 * longer (its record removed, or gone from its machine's snapshot; its listing gone). A receipt of a session not yet
 * known stays: it has not left. Its attention list emptied or dropped is no leaving. */
export function followSessionsLeaving(): () => void {
  return useSessions.subscribe((now, before) => {
    if (now.records === before.records && now.listed === before.listed) return;
    for (const id of useAttention.getState().receipts.keys()) if (known(before, id) && !known(now, id)) useAttention.getState().forgetReceipts(id);
  });
}
