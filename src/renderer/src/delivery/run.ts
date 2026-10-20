// P4-B5: one Send to sheet's run, outside React (docs/doperpowers/plans/2026-10-19-p4-smoothing.md §4.7): it reads the
// target's state from main (Notion's connector found through MAWS's own connection, or the gws CLI's sign-in), runs the
// owner's sign-in when the state asks for one, and sends. No session, no prompt: every step is a `delivery.*` command
// main runs itself. The sheet shows the phase; closing it cancels a sign-in and a send that has not written yet (main
// refuses to call back one that may have reached the service, and that send's receipt still lands in the header).
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { DeliveryDestination, DeliveryTarget } from '@shared/delivery/destination';
import type { MawsBridge } from '@shared/ipc/schema';
import type { DeliveryReceipt, DeliveryStatus } from '@shared/ipc/schema/delivery';
import type { ArtifactExportFormat } from '@shared/maws/tools';
import { CONNECT_FAILURE, MAYBE_SENT, SEND_FAILURE } from './copy';

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
  destination: DeliveryDestination;
}

export interface SendToRun {
  state: StoreApi<SendToState>;
  check(target?: DeliveryTarget): Promise<void>; // the target's state read again (another target: switched to it)
  connect(): Promise<void>;
  send(choice: SendToChoice): Promise<void>;
  close(): void; // the sheet went: a sign-in or an unwritten send is cancelled
}

export interface SendToRunDeps {
  client: MawsBridge;
  artifactId: string;
  target: DeliveryTarget;
  onSending?(target: DeliveryTarget | null): void; // the header's "Sending to …"
  onReceipt?(receipt: DeliveryReceipt): void;
}

const statusOf = (phase: SendToPhase): DeliveryStatus | null => ('status' in phase ? phase.status : null);
const sourceOf = (status: DeliveryStatus | null): string | undefined => (status?.target === 'notion' ? status.source?.key : undefined);

export function createSendToRun(deps: SendToRunDeps): SendToRun {
  const { client, artifactId } = deps;
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
    const answer = await client.invoke('delivery.status', { target, artifactId }).catch(() => null);
    if (mine !== reading || closed) return;
    if (!answer?.ok) return set({ phase: 'failed', status: null, words: SEND_FAILURE.unavailable });
    set({ phase: 'ready', status: answer.value });
  }

  async function connect(): Promise<void> {
    const { target, phase } = state.getState();
    const status = statusOf(phase);
    if (running !== null || status === null) return;
    const runId = crypto.randomUUID();
    running = runId;
    set({ phase: 'connecting', status });
    const source = sourceOf(status);
    const answer = await client.invoke('delivery.connect', { runId, target, artifactId, ...(source && { source }) }).catch(() => null);
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
    deps.onSending?.(target);
    const source = sourceOf(status);
    const answer = await client
      .invoke('delivery.send', { runId, target, artifactId, format: choice.format, ...(choice.versionId !== undefined && { versionId: choice.versionId }), destination: choice.destination, ...(source && { source }) })
      .catch(() => null);
    running = null;
    deps.onSending?.(null);
    const receipt = answer?.ok && answer.value.ok ? answer.value.receipt : undefined;
    if (receipt) {
      deps.onReceipt?.(receipt);
      return set({ phase: 'sent', status, receipt });
    }
    if (closed) return;
    const failure = answer?.ok && !answer.value.ok && answer.value.why ? { why: answer.value.why, maybeSent: answer.value.maybeSent, message: answer.value.message } : null;
    const base = failure ? SEND_FAILURE[failure.why] : SEND_FAILURE.failed;
    const words = `${base}${failure?.message ? `: ${failure.message}` : base.endsWith('.') ? '' : '.'}${failure?.maybeSent ? ` ${MAYBE_SENT(target)}` : ''}`;
    // a refusal that says the connection or the sign-in moved: the state is read again under the words
    if (failure && ['unauthorized', 'source', 'signIn', 'reconnect', 'auth', 'absent', 'needsSetup', 'none'].includes(failure.why)) await check(target);
    if (closed) return;
    set({ phase: 'failed', status: statusOf(state.getState().phase) ?? status, words, ...(failure?.maybeSent && { maybeSent: true }) });
  }

  return {
    state,
    check,
    connect,
    send,
    close() {
      if (closed) return;
      closed = true;
      reading += 1;
      if (running !== null) void client.invoke('delivery.cancel', { runId: running }).catch(() => {});
    },
  };
}
