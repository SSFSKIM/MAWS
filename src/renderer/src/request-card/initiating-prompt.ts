// The prompt a refusal interrupted (C7 execution document, Terms "Initiating prompt"): the newest human `user` row of
// the session's transcript, which its Edit prompt edits in place as a bubble's Edit does (W3, B6). Human means its
// turn's origin in C6's `activity` is `human` (a peer turn's opening message is not the owner's). The refusal's
// `retractedMessageUuids` names the turn's assistant messages and tool results, never the prompt, so it plays no part.
// UX wave U5a (Decision Log 49): the person's own prompt includes a message of several comments, which the dialog does
// not offer to edit. Pure.
import type { MessageUuid } from '@shared/graph/ids';
import { isOwnPrompt, type UserRow } from '../composer/edit-prefill';
import type { Row, TurnActivity } from '../transcript';

export function initiatingPrompt(rows: readonly Row[], activity: readonly TurnActivity[]): (UserRow & { messageUuid: MessageUuid }) | null {
  const human = new Set(activity.filter((turn) => turn.origin === 'human').map((turn) => turn.turnId));
  return rows.findLast((r): r is UserRow & { messageUuid: MessageUuid } => isOwnPrompt(r) && r.turnId !== null && human.has(r.turnId)) ?? null;
}
