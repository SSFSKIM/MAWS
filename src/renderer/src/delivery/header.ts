// P4-B5: the editor header's Send to (X32's `actions[]` entry `sendTo`, docs/doperpowers/plans/2026-10-19-p4-smoothing.md
// §4.7): one pinned action an editor adds to its registration, drawn by its label beside the first three. Its label is
// the header's receipt: "Send to…", "Sending to Notion…" while a delivery of the artifact runs, "Sent to Notion" once one
// was made (main's receipt, this main's life). It opens the Send to sheet on the target last used, else the kind's.
import { useMemo } from 'react';
import type { EditorHostAction } from '../panel/editor-host';
import { SEND_TO_COPY } from './copy';
import { latestReceipt, openSendTo, sendingTo, useDelivery, type SendToSubject } from './store';

export const SEND_TO_ACTION = 'sendTo';

// What an editor shows in place of the live artifact, as its Export reads it: a version's id, or the live one; two
// versions compared send nothing (`compare`), as Export offers nothing then. `board`: a design's, the one its Export takes.
export function sendToSubject(artifactId: string, kind: SendToSubject['kind'], title: string | null | undefined, shown: { versionId: number } | 'compare' | null | undefined, board?: string | null): SendToSubject | null {
  if (!title || shown === 'compare') return null;
  return { artifactId, kind, title, ...(shown && { versionId: shown.versionId }), ...(board != null && { board }) };
}

// The action for `subject` (null: nothing to send yet, as while the artifact's row is unread).
export function useSendToAction(subject: SendToSubject | null): EditorHostAction | null {
  const artifactId = subject?.artifactId ?? null;
  const sending = useDelivery((s) => (artifactId === null ? null : sendingTo(s, artifactId)));
  const receipt = useDelivery((s) => (artifactId === null ? null : latestReceipt(s, artifactId)));
  const { kind, title, versionId, board } = subject ?? {};
  return useMemo(() => {
    if (artifactId === null || kind === undefined || title === undefined) return null;
    const label = sending ? SEND_TO_COPY.actionSending(sending) : receipt ? SEND_TO_COPY.actionSent(receipt.target) : SEND_TO_COPY.action;
    return { id: SEND_TO_ACTION, label, pinned: true, onSelect: () => openSendTo({ artifactId, kind, title, ...(versionId !== undefined && { versionId }), ...(board !== undefined && { board }) }, sending ?? receipt?.target) };
  }, [artifactId, kind, title, versionId, board, sending, receipt]);
}
