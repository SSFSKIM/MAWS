// The prompt a refusal interrupted (C7 execution document, Terms "Initiating prompt"): the newest human turn's own `user`
// row in the session's transcript, which its Edit prompt edits in place as a bubble's Edit does (W3, B6). Human means its
// turn's origin in C6's `activity` is `human` (a peer turn's opening message is not the owner's). The refusal's
// `retractedMessageUuids` names the turn's assistant messages and tool results, never the prompt, so it plays no part.
// UX wave U5a (Decision Log 49): the person's own prompt includes a message of several comments, which the dialog does
// not offer to edit. Pure.
import type { MessageUuid } from '@shared/graph/ids';
import { isOwnPrompt, type UserRow } from '../composer/edit-prefill';
import type { Row, TurnActivity } from '../transcript';

// Board ticket 714: the prompt is the newest human turn's own; a turn the person's answer to an asynchronous question
// opened alone has none (the split leaves it no prompt row of the person's), so nothing is found rather than the prompt
// of the turn before it.
export function initiatingPrompt(rows: readonly Row[], activity: readonly TurnActivity[]): (UserRow & { messageUuid: MessageUuid }) | null {
  const turn = newestHumanTurn(rows, activity);
  if (turn === null) return null;
  return rows.findLast((r): r is UserRow & { messageUuid: MessageUuid } => r.turnId === turn && isOwnPrompt(r)) ?? null;
}

/** Board ticket 714: the newest human turn holds no prompt of the person's own (an answer opened it alone): nothing to edit. */
export function opensWithoutPrompt(rows: readonly Row[], activity: readonly TurnActivity[]): boolean {
  return newestHumanTurn(rows, activity) !== null && initiatingPrompt(rows, activity) === null;
}

function newestHumanTurn(rows: readonly Row[], activity: readonly TurnActivity[]): Row['turnId'] {
  const human = new Set(activity.filter((turn) => turn.origin === 'human').map((turn) => turn.turnId));
  return rows.findLast((r) => r.turnId !== null && human.has(r.turnId))?.turnId ?? null;
}
