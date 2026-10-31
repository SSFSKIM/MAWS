// A `RemoteLink` in memory, for remote lane B's unit suites (src/main/lane-b/*.test.ts): what the adapter asks of the link
// is recorded (calls, acts, subscriptions), and the suite answers it (a call's answer, an act's progress and outcome, a
// subscription's messages) and moves the link's state and caps.
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import type { Cursor, SessionRef } from 'org-protocol';
import type { LinkState } from '../../src/main/machines/manager';
import type { ActHandle, ActOutcome, ActProgress, ActRequest, CallResult, DeviceCaps, RemoteLink, SubscribeRequest, Subscription, SubscriptionSink } from '../../src/main/machines/remote/link';

export const MINI = 'MiniMachineRef00000000' as MachineRef;

export class FakeAct implements ActHandle {
  static #n = 0;
  readonly opId = `op-${++FakeAct.#n}`;
  readonly opCreated = new Date().toISOString();
  readonly outcome: Promise<ActOutcome>;
  #progress: ActProgress;
  #resolve!: (outcome: ActOutcome) => void;
  readonly #listeners = new Set<(progress: ActProgress) => void>();
  settled: ActOutcome | null = null;

  constructor(readonly request: ActRequest, progress: ActProgress = 'sent') {
    this.#progress = progress;
    this.outcome = new Promise((resolve) => (this.#resolve = resolve));
  }

  progress(): ActProgress {
    return this.#progress;
  }

  onProgress(listener: (progress: ActProgress) => void): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  move(progress: ActProgress): void {
    this.#progress = progress;
    for (const listener of [...this.#listeners]) listener(progress);
  }

  settle(outcome: ActOutcome): void {
    this.settled = outcome;
    this.#resolve(outcome);
  }
}

export type FakeSub = { id: string; request: SubscribeRequest; sink: SubscriptionSink; closed: boolean; at: Cursor | null };

export class FakeLink implements RemoteLink {
  readonly machine: MachineRef;
  name = 'mini';
  #state: LinkState = 'up';
  #carrier: 'direct' | 'relay' | null = 'direct';
  #refusal: string | null = null;
  #caps: DeviceCaps | null = { member: 'member-a', device: 'mac1', clientClass: 'native-mac', machine: { grades: ['spawn'] }, stateVersion: 2 };
  peers: string[] = ['rl2.executor.machine'];
  /** Each call, with the session it named (P5 O7 M4's `call.session`) when it named one. */
  readonly calls: Array<{ name: string; input: unknown; session?: SessionRef }> = [];
  readonly answers = new Map<string, (input: Record<string, unknown>) => CallResult | Promise<CallResult>>();
  readonly acts: FakeAct[] = [];
  /** The progress a new act starts in, and an outcome to settle it with at once, if any. */
  onAct: (act: FakeAct) => void = () => {};
  readonly subs: FakeSub[] = [];
  readonly #stateListeners = new Set<(state: LinkState) => void>();
  readonly #capsListeners = new Set<(caps: DeviceCaps) => void>();
  #subN = 0;

  constructor(machine: MachineRef = MINI) {
    this.machine = machine;
  }

  state(): LinkState {
    return this.#state;
  }
  carrier() {
    return this.#carrier;
  }
  refusal() {
    return this.#refusal;
  }
  caps() {
    return this.#caps;
  }
  peerCapabilities() {
    return this.#state === 'up' ? this.peers : null;
  }
  onState(listener: (state: LinkState) => void): () => void {
    this.#stateListeners.add(listener);
    return () => void this.#stateListeners.delete(listener);
  }
  onCaps(listener: (caps: DeviceCaps) => void): () => void {
    this.#capsListeners.add(listener);
    return () => void this.#capsListeners.delete(listener);
  }
  onEvent(): () => void {
    return () => {};
  }
  dispatch(): Promise<CommandResult<CommandName>> {
    throw new Error('the adapter never dispatches on the link');
  }
  close(): void {}
  probe(): void {}

  /** The link's state, carrier and refusal moved, as the real link's `onState` says it. */
  set(state: LinkState, carrier: 'direct' | 'relay' | null = state === 'up' ? 'direct' : null, refusal: string | null = null): void {
    this.#state = state;
    this.#carrier = carrier;
    this.#refusal = refusal;
    for (const listener of [...this.#stateListeners]) listener(state);
  }

  setCaps(caps: DeviceCaps): void {
    this.#caps = caps;
    for (const listener of [...this.#capsListeners]) listener(caps);
  }

  async call(name: string, input: unknown, options?: { session?: SessionRef }): Promise<CallResult> {
    this.calls.push({ name, input, ...(options?.session !== undefined && { session: options.session }) });
    const answer = this.answers.get(name);
    if (answer === undefined) return { ok: false, error: { code: 'not-offered' } };
    return answer((input ?? {}) as Record<string, unknown>);
  }

  act(request: ActRequest): ActHandle {
    const act = new FakeAct(request);
    this.acts.push(act);
    this.onAct(act);
    // As the link holds it: one never put on a channel by its `sendBy` is refused `offline` then.
    if (request.sendBy !== undefined)
      setTimeout(() => {
        if (act.settled === null && act.progress() === 'waiting') act.settle({ state: 'refused', reason: 'offline' });
      }, Math.max(0, request.sendBy - Date.now()));
    return act;
  }

  subscribe(request: SubscribeRequest, sink: SubscriptionSink): Subscription {
    // An `ended` is final: the real link removes the subscription, as the fake does.
    const sub: FakeSub = { id: `sub-${++this.#subN}`, request, sink: { ...sink, ended: (reason) => ((sub.closed = true), sink.ended(reason)) }, closed: false, at: request.cursor ?? null };
    this.subs.push(sub);
    return {
      id: sub.id,
      cursor: () => sub.at,
      close: () => void (sub.closed = true),
    };
  }

  /** The subscriptions still open. */
  open(): FakeSub[] {
    return this.subs.filter((s) => !s.closed);
  }
}

/** A lane B event at its cursor, as the endpoint's plane delivers it (the sink's `event` moves the fake's cursor). */
export function deliver(sub: FakeSub, at: Cursor, body: unknown): void {
  sub.at = at;
  sub.sink.event(at, body);
}
