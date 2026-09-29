// The prompt a refusal interrupted (C7 execution document, Terms "Initiating prompt"): the newest human `user` row of
// the session's transcript, with its pasted bodies and images, as the composer prefill that puts it back in edit mode.
// Human means its turn's origin in C6's `activity` is `human` (a peer turn's opening message is not the owner's). The
// refusal's `retractedMessageUuids` names the turn's assistant messages and tool results, never the prompt, so it plays
// no part. The prefill is built as a bubble's Edit builds it (`composer/edit-prefill.ts`), with the prompt itself as
// the seen cursor. Pure.
import type { MessageUuid } from '@shared/graph/ids';
import { rowPrefill, type UserRow } from '../composer/edit-prefill';
import type { Prefill } from '../stores/composer';
import type { Row, TurnActivity } from '../transcript';

export function initiatingPrompt(rows: readonly Row[], activity: readonly TurnActivity[]): Prefill | null {
  const human = new Set(activity.filter((turn) => turn.origin === 'human').map((turn) => turn.turnId));
  const row = rows.findLast((r): r is UserRow & { messageUuid: MessageUuid } => r.kind === 'user' && r.messageUuid !== null && r.editable && r.turnId !== null && human.has(r.turnId));
  return row ? rowPrefill(row, row.messageUuid) : null;
}
