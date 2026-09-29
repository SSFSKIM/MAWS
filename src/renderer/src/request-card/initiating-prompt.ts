// The prompt a refusal interrupted (C7 execution document, Terms "Initiating prompt"): the newest human `user` row of
// the session's transcript, with its pasted bodies and images, as the composer prefill that puts it back in edit mode.
// Human means its turn's origin in C6's `activity` is `human` (a peer turn's opening message is not the owner's). The
// refusal's `retractedMessageUuids` names the turn's assistant messages and tool results, never the prompt, so it plays
// no part. Pure.
import type { MessageUuid } from '@shared/graph/ids';
import type { Prefill } from '../stores/composer';
import type { Row, TurnActivity } from '../transcript';

type UserRow = Extract<Row, { kind: 'user' }>;

// `data:<mediaType>;base64,<data>` → its parts; null for anything else.
function dataUrlParts(url: string): { mediaType: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  return match ? { mediaType: match[1], data: match[2] } : null;
}

export function initiatingPrompt(rows: readonly Row[], activity: readonly TurnActivity[]): Prefill | null {
  const human = new Set(activity.filter((turn) => turn.origin === 'human').map((turn) => turn.turnId));
  const row = rows.findLast((r): r is UserRow & { messageUuid: MessageUuid } => r.kind === 'user' && r.messageUuid !== null && r.editable && r.turnId !== null && human.has(r.turnId));
  if (!row) return null;
  const pasted = row.attachments.filter((a) => a.kind === 'text' && a.text !== null).map((a) => ({ name: a.name, text: a.text! }));
  const images = row.attachments.flatMap((a) => {
    const parts = a.kind === 'image' && a.dataUrl !== null ? dataUrlParts(a.dataUrl) : null;
    return parts ? [{ name: a.name, mediaType: a.mediaType ?? parts.mediaType, data: parts.data }] : [];
  });
  return { text: row.text, pasted, images, editing: { messageUuid: row.messageUuid, seenCursor: row.messageUuid } };
}
