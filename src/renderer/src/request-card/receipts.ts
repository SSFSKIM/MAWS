// UX wave U1b (docs/doperpowers/plans/2026-11-15-ux-wave-U1b-requests-in-transcript.md, Interfaces §G "The receipt";
// decisions 8 and 21): the two writers of what a question's row says between the answer and the transcript's own row.
// The card writes what it sent, at a delivered answer (`receiptOfAnswer`). The follower writes what each terminal
// session's lane A state says was settled, under that session's addressed id and the call the settlement names (the
// bridge's request id for an asynchronous question is its call's tool-use id, C17): a dismissal, or the settlement's
// own words. It lives here, started by `connectRequestCard()`, so MAWS alone runs it: a row's view reads the attention
// store and never the lane A store, which imports MAWS's IPC client (desk web bundles the rows).
import type { RequestAnswer } from '@shared/engine/answers';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, ToolUseId } from '@shared/graph/ids';
import type { LaneAState } from '@shared/ipc/schema/lane-a';
import { raceOf, settledWords } from '../lane-a/race';
import { useAttention, type Receipt } from '../stores/attention';
import { useLaneA } from '../stores/lane-a';

// The bridge's own name for itself as the one who settled (sminos's `RESERVED_BY`): a `/clear`, or the session's end,
// which says nothing of the question's answer.
const BY_BRIDGE = 'bridge';

/** What a delivered answer to a request says of its question: the answers sent, or a dismissal for the decline; null
 * for an answer to any other request. */
export function receiptOfAnswer(request: SessionEvent | null, answer: RequestAnswer): Receipt | null {
  if (request?.kind !== 'question.requested') return null;
  if (answer.kind === 'question') return { answers: { ...answer.answers } };
  return answer.kind === 'permission' && answer.decision !== 'allow' ? { dismissed: true } : null;
}

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
