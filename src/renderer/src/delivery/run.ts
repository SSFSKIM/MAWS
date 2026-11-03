// P4-B5: one Send to sheet's run, outside React (docs/doperpowers/plans/2026-10-19-p4-smoothing.md §4.7): it reads the
// target's state from main (Notion's connector found through MAWS's own connection, or the gws CLI's sign-in), runs the
// owner's sign-in when the state asks for one, and sends. No session, no prompt: every step is a `delivery.*` command
// main runs itself. The sheet shows the phase; closing it cancels a sign-in and a send that has not written yet (main
// refuses to call back one that may have reached the service: that send's receipt still lands in the header, and its
// failure, which may say the service has it, is a toast).
// P5 O7 M5c (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "O4's surfaces: leases, the window, delivery on the
// machine"): every step is the artifact's machine's, which exports and delivers it there with its own connections; a
// connection's sign-in is that machine's to make (`delivery.connect` is not offered elsewhere), so a run of another
// machine's artifact never asks for one. A refusal by that machine is said in its words (it doesn't offer this, a right
// the device lacks there, the link down).
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { DeliveryDestination, DeliveryTarget } from '@shared/delivery/destination';
import type { MawsBridge } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import type { DeliveryReceipt, DeliveryStatus } from '@shared/ipc/schema/delivery';
import type { ArtifactExportFormat } from '@shared/maws/tools';
import { remoteRefusalWords } from '../artifacts/remote-surfaces';
import { toast } from '../stores/notices';
import { CONNECT_FAILURE, MAYBE_SENT, SEND_TO_COPY, sendFailure } from './copy';

export type SendToPhase =
  | { phase: 'checking' }
  | { phase: 'ready'; status: DeliveryStatus } // the target's state known, nothing running
  | { phase: 'connecting'; status: DeliveryStatus }
  | { phase: 'sending'; status: DeliveryStatus }
  | { phase: 'sent'; status: DeliveryStatus; receipt: DeliveryReceipt }
  | { phase: 'failed'; status: DeliveryStatus | null; words: string; maybeSent?: boolean };

export interface SendToState {
  target: DeliveryTarget;
  phase: SendToPhase;
}

export interface SendToChoice {
  format: ArtifactExportFormat;
  versionId?: number;
  board?: string; // a design's PNG: the board shown
  destination: DeliveryDestination;
}

export interface SendToRun {
  state: StoreApi<SendToState>;
  readonly elsewhere: string | null; // P5 O7 M5c: the artifact's machine's name when it is another machine's
  check(target?: DeliveryTarget): Promise<void>; // the target's state read again (another target: switched to it)
  connect(): Promise<void>;
  send(choice: SendToChoice): Promise<void>;
  close(): void; // the sheet went: a sign-in or an unwritten send is cancelled
}

export interface SendToRunDeps {
  client: MawsBridge;
  artifactId: string;
  machine: MachineRef; // P5 O7 M5c: the artifact's, where every step runs
  elsewhere: string | null; // its name when it is another machine's
  title: string; // the artifact's, for a failure said after the sheet closed
  target: DeliveryTarget;
  onSending?(runId: string, target: DeliveryTarget | null): void; // the header's "Sending to …", this run's mark
  onReceipt?(receipt: DeliveryReceipt): void;
}

const statusOf = (phase: SendToPhase): DeliveryStatus | null => ('status' in phase ? phase.status : null);
const sourceOf = (status: DeliveryStatus | null): string | undefined => (status?.target === 'notion' ? status.source?.key : undefined);

export function createSendToRun(deps: SendToRunDeps): SendToRun {
  const { client, artifactId, elsewhere } = deps;
  const on = { machine: deps.machine };
  const state = createStore<SendToState>()(() => ({ target: deps.target, phase: { phase: 'checking' } }));
  let reading = 0; // a newer read (or a switch) makes an older read's answer moot
  let running: string | null = null; // the run id of a sign-in or a send under way
  let closed = false;
  const set = (phase: SendToPhase) => {
    if (!closed) state.setState({ phase }, false);
  };

  async function check(target: DeliveryTarget = state.getState().target): Promise<void> {
    if (running !== null && target === state.getState().target) return; // a run under way reads again when it ends
    const mine = ++reading;
    if (target !== state.getState().target) state.setState({ target }, false);
    set({ phase: 'checking' });
    const answer = await client.invoke('delivery.status', { target, artifactId }, on).catch(() => null);
    if (mine !== reading || closed) return;
    if (answer && !answer.ok && elsewhere !== null) return set({ phase: 'failed', status: null, words: remoteRefusalWords(answer.error, elsewhere) });
    if (!answer?.ok) return set({ phase: 'failed', status: null, words: SEND_TO_COPY.checkFailed[target] });
    set({ phase: 'ready', status: answer.value });
  }

  async function connect(): Promise<void> {
    const { target, phase } = state.getState();
    const status = statusOf(phase);
    if (running !== null || status === null || elsewhere !== null) return; // P5 O7 M5c: that machine's sign-in, made there
    const runId = crypto.randomUUID();
    running = runId;
    set({ phase: 'connecting', status });
    const source = sourceOf(status);
    const answer = await client.invoke('delivery.connect', { runId, target, artifactId, ...(source && { source }) }, on).catch(() => null);
    running = null;
    if (closed || state.getState().target !== target) return;
    if (answer?.ok && answer.value.ok) return check(target);
    const why = answer?.ok && !answer.value.ok && answer.value.why ? { why: answer.value.why, message: answer.value.message } : null;
    // the state read again, then the sign-in's failure in words over it
    await check(target);
    if (closed || state.getState().target !== target) return;
    const words = why ? `${CONNECT_FAILURE[why.why] ?? CONNECT_FAILURE.failed}${why.message ? ` ${why.message}` : ''}` : CONNECT_FAILURE.failed;
    set({ phase: 'failed', status: statusOf(state.getState().phase), words });
  }

  async function send(choice: SendToChoice): Promise<void> {
    const { target, phase } = state.getState();
    const status = statusOf(phase);
    if (running !== null || status === null) return;
    const runId = crypto.randomUUID();
    running = runId;
    set({ phase: 'sending', status });
    deps.onSending?.(runId, target);
    const source = sourceOf(status);
    const answer = await client
      .invoke('delivery.send', { runId, target, artifactId, format: choice.format, ...(choice.versionId !== undefined && { versionId: choice.versionId }), ...(choice.board !== undefined && { board: choice.board }), destination: choice.destination, ...(source && { source }) }, on)
      .catch(() => null);
    running = null;
    deps.onSending?.(runId, null);
    const receipt = answer?.ok && answer.value.ok ? answer.value.receipt : undefined;
    if (receipt) {
      deps.onReceipt?.(receipt);
      return set({ phase: 'sent', status, receipt });
    }
    const failure = answer?.ok && !answer.value.ok && answer.value.why ? { why: answer.value.why, maybeSent: answer.value.maybeSent, message: answer.value.message } : null;
    const base = sendFailure(failure?.why ?? 'failed', target);
    const refusal = answer && !answer.ok && elsewhere !== null ? remoteRefusalWords(answer.error, elsewhere) : null; // P5 O7 M5c
    const words = refusal ?? `${base}${failure?.message ? `: ${failure.message}` : base.endsWith('.') ? '' : '.'}${failure?.maybeSent ? ` ${MAYBE_SENT(target)}` : ''}`;
    // P4-B5 review: the sheet closed while main would not call the send back: what became of it is said, not dropped
    if (closed) {
      if (failure?.why !== 'cancelled' || failure.maybeSent) toast({ level: 'warning', text: SEND_TO_COPY.closedFailure(deps.title, target, words), actions: [], dismissible: true });
      return;
    }
    // a refusal that says the connection or the sign-in moved: the state is read again under the words
    if (failure && ['unauthorized', 'source', 'signIn', 'reconnect', 'auth', 'absent', 'needsSetup', 'none'].includes(failure.why)) await check(target);
    if (closed) return;
    set({ phase: 'failed', status: statusOf(state.getState().phase) ?? status, words, ...(failure?.maybeSent && { maybeSent: true }) });
  }

  return {
    state,
    elsewhere,
    check,
    connect,
    send,
    close() {
      if (closed) return;
      closed = true;
      reading += 1;
      if (running !== null) void client.invoke('delivery.cancel', { runId: running }, on).catch(() => {});
    },
  };
}
