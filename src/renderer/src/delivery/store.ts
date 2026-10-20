// P4-B5: the renderer's side of the owner's Send to (docs/doperpowers/plans/2026-10-19-p4-smoothing.md §4.7): the open
// sheet (one at a time, app-wide, opened from an editor header's Send to or a library row's Export menu), the deliveries
// running (the header's "Sending to …"), and the receipts main keeps for its life (the header's "Sent to …" and the
// library row's mark), read once and then followed by `delivery.receipt`.
import { create } from 'zustand';
import type { ArtifactKind } from '@shared/artifacts/entity';
import type { DeliveryTarget } from '@shared/delivery/destination';
import type { MawsBridge } from '@shared/ipc/schema';
import type { DeliveryReceipt } from '@shared/ipc/schema/delivery';
import { ipc } from '../ipc/client';
import { createSendToRun, type SendToRun } from './run';

// What is sent: the artifact the header or the row shows, a retained version's when the editor shows one.
export interface SendToSubject {
  artifactId: string;
  kind: ArtifactKind;
  title: string;
  versionId?: number;
}

interface DeliveryState {
  receipts: Readonly<Record<string, DeliveryReceipt>>; // by artifact and target
  sending: Readonly<Record<string, DeliveryTarget>>; // by artifact: a send under way
  sheet: { subject: SendToSubject; run: SendToRun } | null;
}

export const useDelivery = create<DeliveryState>()(() => ({ receipts: {}, sending: {}, sheet: null }));

const keyOf = (receipt: Pick<DeliveryReceipt, 'artifactId' | 'target'>) => `${receipt.artifactId}\0${receipt.target}`;

function keep(receipt: DeliveryReceipt): void {
  useDelivery.setState((s) => ({ receipts: { ...s.receipts, [keyOf(receipt)]: receipt } }));
}

// The latest receipt of an artifact, whichever target.
export function latestReceipt(state: Pick<DeliveryState, 'receipts'>, artifactId: string): DeliveryReceipt | null {
  let latest: DeliveryReceipt | null = null;
  for (const receipt of Object.values(state.receipts)) if (receipt.artifactId === artifactId && (latest === null || receipt.at > latest.at)) latest = receipt;
  return latest;
}

export function markSending(artifactId: string, target: DeliveryTarget | null): void {
  useDelivery.setState((s) => {
    const sending = { ...s.sending };
    if (target === null) delete sending[artifactId];
    else sending[artifactId] = target;
    return { sending };
  });
}

// The kinds whose Markdown Notion takes as a page (the target's other formats are not pages).
export const defaultTarget = (kind: ArtifactKind): DeliveryTarget => (kind === 'document' || kind === 'dashboard' ? 'notion' : 'drive');

// The sheet for `subject`, on `target` (the kind's default when none); one sheet at a time: opening another closes the
// one shown (its run cancelled where it may be).
export function openSendTo(subject: SendToSubject, target: DeliveryTarget = defaultTarget(subject.kind), client: MawsBridge = ipc): void {
  useDelivery.getState().sheet?.run.close();
  const run = createSendToRun({ client, artifactId: subject.artifactId, target, onSending: (sending) => markSending(subject.artifactId, sending), onReceipt: keep });
  useDelivery.setState({ sheet: { subject, run } });
  void run.check();
}

export function closeSendTo(run: SendToRun): void {
  run.close();
  useDelivery.setState((s) => (s.sheet?.run === run ? { sheet: null } : s));
}

// App-wide: main's receipts read once, then each new one as it is made.
export function connectDelivery(client: MawsBridge = ipc): () => void {
  let live = true;
  const stop = client.on('delivery.receipt', keep);
  void client.invoke('delivery.receipts', undefined).then((answer) => {
    if (live && answer.ok) for (const receipt of answer.value.receipts) keep(receipt);
  });
  return () => {
    live = false;
    stop();
  };
}

// Tests: nothing open, sent or sending.
export function resetDelivery(): void {
  useDelivery.setState({ receipts: {}, sending: {}, sheet: null });
}
