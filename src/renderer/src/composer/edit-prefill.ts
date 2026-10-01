// A user row as editable text (C7 execution document, "Edit-and-resubmit and the fork seam"; W3: the bubble edited in
// place, and the refusal dialog's Edit prompt): the row's text as typed (history recall's and the queue edit's reading:
// no extra newline before a pasted block, a typed tag un-neutralised) with its pasted placeholders in place, its pasted
// bodies (C6's `text` attachments, placeholder order) and its images that carry a data URL. Pure.
import type { MessageUuid } from '@shared/graph/ids';
import type { Prefill } from '../stores/composer';
import type { Row } from '../transcript';
import { typedFromRowText } from './editor/recall';

export type UserRow = Extract<Row, { kind: 'user' }>;

// `data:<mediaType>;base64,<data>` → its parts; null for anything else.
function dataUrlParts(url: string): { mediaType: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  return match ? { mediaType: match[1], data: match[2] } : null;
}

export function rowPrefill(row: UserRow): Prefill {
  const pasted = row.attachments.filter((a) => a.kind === 'text' && a.text !== null).map((a) => ({ name: a.name, text: a.text! }));
  const images = row.attachments.flatMap((a) => {
    const parts = a.kind === 'image' && a.dataUrl !== null ? dataUrlParts(a.dataUrl) : null;
    return parts ? [{ name: a.name, mediaType: a.mediaType ?? parts.mediaType, data: parts.data }] : [];
  });
  return { text: typedFromRowText(row.text), pasted, images };
}

// The seen cursor's source: the newest user message the transcript holds (any origin: a queued prompt or an
// engine-initiated turn after the edited message is what the rewind would discard).
export function newestUserUuid(rows: readonly Row[]): MessageUuid | null {
  const row = rows.findLast((r): r is UserRow & { messageUuid: MessageUuid } => r.kind === 'user' && r.messageUuid !== null);
  return row?.messageUuid ?? null;
}
