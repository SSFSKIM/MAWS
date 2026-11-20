// P4-B5: the editor header's Send to (X32's `actions[]` entry `sendTo`, docs/doperpowers/plans/2026-10-19-p4-smoothing.md
// §4.7): one pinned action an editor adds to its registration, drawn by its label beside the first three. Its label is
// the header's receipt: "Send to…", "Sending to Notion…" while a delivery of the artifact runs, "Sent to Notion" once one
// was made (main's receipt, this main's life). It opens the Send to sheet on the target last used, else the kind's.
// P5 O7 M5c: another machine's artifact reads that machine's receipts, and its Send to is greyed while that machine
// doesn't offer it (../artifacts/remote-surfaces.ts; the sheet that found it out said why).
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../ipc/client';
import { useMemo } from 'react';
import { SEND_NEEDS, useRemoteGreyed } from '../artifacts/remote-surfaces';
import { useArtifactMachine } from '../artifacts/use-artifact-machine';
import type { EditorHostAction } from '../panel/editor-host';
import { SEND_TO_COPY } from './copy';
import { latestReceipt, openSendTo, sendingTo, useDelivery, type SendToSubject } from './store';

export const SEND_TO_ACTION = 'sendTo';

// What an editor shows in place of the live artifact, as its Export reads it: a version's id, or the live one; two
// versions compared send nothing (`compare`), as Export offers nothing then. `board`: a design's, the one its Export takes.
export function sendToSubject(artifactId: string, machine: MachineRef, kind: SendToSubject['kind'], title: string | null | undefined, shown: { versionId: number } | 'compare' | null | undefined, board?: string | null): SendToSubject | null {
  if (!title || shown === 'compare') return null;
  return { artifactId, machine, kind, title, ...(shown && { versionId: shown.versionId }), ...(board != null && { board }) };
}

// The action for `subject` (null: nothing to send yet, as while the artifact's row is unread).
export function useSendToAction(subject: SendToSubject | null): EditorHostAction | null {
  const artifactId = subject?.artifactId ?? null;
  const on = subject?.machine;
  const hint = useArtifactMachine(on === undefined ? artifactId : null);
  const machine = on === undefined ? hint : on === ipc.localMachine ? null : on;
  const sending = useDelivery((s) => (artifactId === null ? null : sendingTo(s, artifactId, machine)));
  const receipt = useDelivery((s) => (artifactId === null ? null : latestReceipt(s, artifactId, machine)));
  const greyed = useRemoteGreyed(artifactId, SEND_NEEDS, on) !== null;
  const { kind, title, versionId, board } = subject ?? {};
  return useMemo(() => {
    if (artifactId === null || kind === undefined || title === undefined) return null;
    const label = sending ? SEND_TO_COPY.actionSending(sending) : receipt ? SEND_TO_COPY.actionSent(receipt.target) : SEND_TO_COPY.action;
    return { id: SEND_TO_ACTION, label, pinned: true, ...(greyed && { disabled: true }), onSelect: () => openSendTo({ artifactId, kind, title, ...(on !== undefined && { machine: on }), ...(versionId !== undefined && { versionId }), ...(board !== undefined && { board }) }, sending ?? receipt?.target) };
  }, [artifactId, on, kind, title, versionId, board, sending, receipt, greyed]);
}
