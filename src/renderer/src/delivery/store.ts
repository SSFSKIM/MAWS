// P4-B5: the renderer's side of the owner's Send to (docs/doperpowers/plans/2026-10-19-p4-smoothing.md §4.7): the open
// sheet (one at a time, app-wide, opened from an editor header's Send to or a library row's Export menu), the deliveries
// running (the header's "Sending to …"), and the receipts main keeps for its life (the header's "Sent to …" and the
// library row's mark), read once and then followed by `delivery.receipt`.
// P5 O7 M5c (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "O4's surfaces: leases, the window, delivery on the
// machine"): a Send to is its artifact's machine's (./run.ts), and so are its receipts, kept by machine: another machine's
// are read at each opening of its artifacts feed (`artifacts.resync`, which says what went untold meanwhile) and followed
// by the `delivery.receipt` it says; a receipt is shown only for the machine it came from.
import { create } from 'zustand';
import type { ArtifactKind } from '@shared/artifacts/entity';
import { DELIVERY_TARGETS, type DeliveryTarget } from '@shared/delivery/destination';
import type { MawsBridge } from '@shared/ipc/schema';
import type { DeliveryReceipt } from '@shared/ipc/schema/delivery';
import type { MachineRef } from '@shared/machine/ref';
import { artifactMachineOf } from '../artifacts/machines';
import { machineNameOf } from '../artifacts/remote-surfaces';
import { ipc } from '../ipc/client';
import { createSendToRun, type SendToRun } from './run';

// What is sent: the artifact the header or the row shows, a retained version's when the editor shows one; a design's
// PNG, the board its Export would picture.
export interface SendToSubject {
  artifactId: string;
  kind: ArtifactKind;
  title: string;
  versionId?: number;
  board?: string;
}

interface DeliveryState {
  receipts: Readonly<Record<string, DeliveryReceipt>>; // by machine (none: this Mac's), artifact and target (`receiptKey`)
  sending: Readonly<Record<string, Readonly<Record<string, DeliveryTarget>>>>; // by artifact, then run: the sends under way
  sheet: { subject: SendToSubject; run: SendToRun } | null;
}

export const useDelivery = create<DeliveryState>()(() => ({ receipts: {}, sending: {}, sheet: null }));

// `machine`: another machine's (the artifact table's word), null for this Mac's
export const receiptKey = (artifactId: string, target: DeliveryTarget, machine: MachineRef | null): string => (machine === null ? `${artifactId}\0${target}` : `${machine}\0${artifactId}\0${target}`);
const machinePrefix = (machine: MachineRef) => `${machine}\0`;

function keep(receipt: DeliveryReceipt, machine: MachineRef | null): void {
  useDelivery.setState((s) => ({ receipts: { ...s.receipts, [receiptKey(receipt.artifactId, receipt.target, machine)]: receipt } }));
}

// Another machine's receipts as it answers them now, in place of those kept of it
function replaceReceipts(machine: MachineRef, receipts: readonly DeliveryReceipt[]): void {
  useDelivery.setState((s) => {
    const kept = Object.fromEntries(Object.entries(s.receipts).filter(([key]) => !key.startsWith(machinePrefix(machine))));
    for (const receipt of receipts) kept[receiptKey(receipt.artifactId, receipt.target, machine)] = receipt;
    return { receipts: kept };
  });
}

// The latest receipt of an artifact of `machine` (null: this Mac's), whichever target.
export function latestReceipt(state: Pick<DeliveryState, 'receipts'>, artifactId: string, machine: MachineRef | null): DeliveryReceipt | null {
  let latest: DeliveryReceipt | null = null;
  for (const target of DELIVERY_TARGETS) {
    const receipt = state.receipts[receiptKey(artifactId, target, machine)];
    if (receipt && (latest === null || receipt.at > latest.at)) latest = receipt;
  }
  return latest;
}

// The target of the artifact's latest send still running (null: none). P4-B5 review: each run marks and clears its own,
// so a second run's `busy`, or another target's send ending first, leaves a running one's mark.
export function sendingTo(state: Pick<DeliveryState, 'sending'>, artifactId: string): DeliveryTarget | null {
  const runs = state.sending[artifactId];
  return runs ? (Object.values(runs).at(-1) ?? null) : null;
}

export function markSending(artifactId: string, runId: string, target: DeliveryTarget | null): void {
  useDelivery.setState((s) => {
    const runs = { ...s.sending[artifactId] };
    if (target === null) delete runs[runId];
    else runs[runId] = target;
    const sending = { ...s.sending, [artifactId]: runs };
    if (Object.keys(runs).length === 0) delete sending[artifactId];
    return { sending };
  });
}

// The kinds whose Markdown Notion takes as a page (the target's other formats are not pages).
export const defaultTarget = (kind: ArtifactKind): DeliveryTarget => (kind === 'document' || kind === 'dashboard' ? 'notion' : 'drive');

// The sheet for `subject`, on `target` (the kind's default when none); one sheet at a time: opening another closes the
// one shown (its run cancelled where it may be).
export function openSendTo(subject: SendToSubject, target: DeliveryTarget = defaultTarget(subject.kind), client: MawsBridge = ipc): void {
  useDelivery.getState().sheet?.run.close();
  const remote = artifactMachineOf(subject.artifactId); // P5 O7 M5c: the run is its artifact's machine's
  const run = createSendToRun({
    client,
    artifactId: subject.artifactId,
    machine: remote ?? client.localMachine,
    elsewhere: remote === null ? null : machineNameOf(remote),
    title: subject.title,
    target,
    onSending: (runId, sending) => markSending(subject.artifactId, runId, sending),
    onReceipt: (receipt) => keep(receipt, remote),
  });
  useDelivery.setState({ sheet: { subject, run } });
  void run.check();
}

export function closeSendTo(run: SendToRun): void {
  run.close();
  useDelivery.setState((s) => (s.sheet?.run === run ? { sheet: null } : s));
}

// App-wide: main's receipts read once, then each new one as it is made (a bridge that cannot answer leaves none).
// P5 O7 M5c: each other machine's read at every opening of its feed, the latest read's answer standing.
export function connectDelivery(client: MawsBridge = ipc): () => void {
  let live = true;
  const local = client.localMachine;
  const machineOf = (from: MachineRef): MachineRef | null => (from === local ? null : from);
  const reads = new Map<MachineRef, { heard: DeliveryReceipt[] }>(); // each machine's latest read, and what it said meanwhile
  const stop = client.on('delivery.receipt', (receipt, from) => {
    const machine = machineOf(from.machine);
    keep(receipt, machine);
    if (machine !== null) reads.get(machine)?.heard.push(receipt); // newer than any answer the read may bring
  });
  void client.invoke('delivery.receipts', undefined, { machine: local }).then(
    (answer) => {
      if (live && answer.ok) for (const receipt of answer.value.receipts) keep(receipt, null);
    },
    () => {},
  );
  const stopResync = client.on('artifacts.resync', (_resync, from) => {
    const machine = machineOf(from.machine);
    if (machine === null) return;
    const read = { heard: [] as DeliveryReceipt[] };
    reads.set(machine, read);
    const done = () => reads.get(machine) === read && reads.delete(machine);
    void client.invoke('delivery.receipts', undefined, { machine }).then(
      (answer) => {
        if (live && answer.ok && reads.get(machine) === read) replaceReceipts(machine, [...answer.value.receipts, ...read.heard]);
        done();
      },
      () => void done(),
    );
  });
  return () => {
    live = false;
    stop();
    stopResync();
  };
}

// Tests: nothing open, sent or sending.
export function resetDelivery(): void {
  useDelivery.setState({ receipts: {}, sending: {}, sheet: null });
}
