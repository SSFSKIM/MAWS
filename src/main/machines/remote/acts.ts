// The RL2 link's acts (P5 O7 M1, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Acts"; RL4, RL §4.7): one
// entry per opId, from the action's building to its outcome. Main builds every action from typed fields and the session's
// identity; a step-up goes only through the session's signer (RL §5.6).
//
// - Sent, or resealed, only within ACT_FRESH_MS of its creation (a step-up act's window runs from its signature, the
//   time the person confirmed it). One the link could not put on a channel in that window resolves `refused offline` and
//   is never sent.
// - An act is *ambiguous* once a transmission of it may have reached its executing side without its answer reaching the
//   link: its channel was lost after it went and before a terminal answer, or ACK_TIMEOUT_MS passed. The endpoint checks
//   freshness, grade and lane B's context before the executor's ledger, and a closed ledger refuses before it looks the
//   id up, so while an act is ambiguous no refusal settles it (an `ack refused` or a `done {state: 'refused'}`): it is
//   queried, and only the executor's ledger, through `queried`, settles it.
// - After a lost channel, an act sent but never acked, within its window and not step-up-signed, is resealed (a fresh
//   nonce and `created`, the rest kept, so the ledger returns the stored result if it ran); every other unsettled act is
//   queried. A step-up act is never resealed: its signature covers the nonce and `created`.
// - `if-asked` signs after an `ack refused {reason: 'step-up'}` on an act that is not ambiguous, and sends again under the
//   same opId: an act the endpoint refused is claimed nowhere, so the id runs once.
// - A `queried {state: 'refused'}` without an outcome is the endpoint's authorization of the asker: `unavailable` (it could
//   not be answered now) is asked again on the query backoff; any other reason resolves `unknown {reason}`.
// - An act unsettled OP_HORIZON_S after its creation resolves `unknown expired` (a copy went out) or `refused expired`,
//   whether or not a channel is current: the ledger no longer answers for it.
// - Pending acts live in memory: an app quit forgets them, while the machine's ledger keeps each result for a day.
import { base64urlEncode, isAction, NONCE_BYTES, OP_HORIZON_S, type Action, type ActionContext, type DeviceMessage, type EndpointMessage, type Executor, type RefusalReason, type RequestDigest } from '../../../../apps/org-protocol/src/index.ts';
import type { MachineRef } from '@shared/machine/ref';
import type { SignedIn } from '../../org/session';
import type { RemoteTiming } from './timing';

export interface ActRequest {
  /** An offered name: a registry command, 'sminos.<rpc>', 'endpoint.grant' | 'endpoint.state', O8's 'record.*'. */
  action: string;
  /** The bare target: lane B's appSessionId, lane A's engine session id (lane A also names it in args.session). */
  session?: string;
  /** Mandatory with `session` (RL4). */
  context?: ActionContext;
  args: unknown;
  requestDigest?: RequestDigest;
  /** Default 'if-asked'. */
  stepUp?: 'required' | 'if-asked' | 'never';
  /** Default by name: 'sminos.' → 'sminos', 'endpoint.' → 'endpoint', else 'engine-host'. */
  executor?: Executor;
}
/** waiting: not yet on a channel; unknown: lost track, querying. */
export type ActProgress = 'waiting' | 'sent' | 'accepted' | 'unknown';
export type ActOutcome =
  | { state: 'done'; result: unknown } // it ran
  | { state: 'failed'; error: unknown } // it was tried and failed
  | { state: 'refused'; reason: RefusalReason | 'offline' | 'step-up-cancelled' | string } // nothing ran (the endpoint's, the executor's or the link's word)
  | { state: 'not-sent' } // query said not-received: tombstoned; nothing ran or will
  | { state: 'unknown'; reason: 'expired' | 'grade' | 'class' | 'removed' | 'closed' | string }; // final, outcome unknown
export interface ActHandle {
  readonly opId: string;
  readonly opCreated: string;
  progress(): ActProgress;
  onProgress(listener: (progress: ActProgress) => void): () => void;
  /** Never rejects. */
  readonly outcome: Promise<ActOutcome>;
}

export interface ActTableDeps {
  machine: MachineRef;
  /** The session's signed-in state when an act is built and signed; null signed out. */
  signedIn(): SignedIn | null;
  /** Sends on the current channel; false when none is current. */
  send(message: DeviceMessage): boolean;
  /** Whether a channel is current (the link `up`, or within its grace on a fresh channel). */
  current(): boolean;
  timing: RemoteTiming;
  now(): number;
  log(line: string): void;
}

type Entry = {
  opId: string;
  opCreated: string;
  executor: Executor;
  mode: 'required' | 'if-asked' | 'never';
  /** The act as built, or as signed; a send stamps `created` (and a reseal a fresh nonce) on an unsigned one. */
  action: Action;
  signed: boolean;
  signing: boolean;
  /** When its send window began: its creation, or its signature. */
  windowFrom: number;
  /** A copy went out with no definitive answer since: it may run. */
  outstanding: boolean;
  /** A copy may have reached the executing side without its answer reaching the link. */
  ambiguous: boolean;
  acked: boolean;
  /** A query is out on the current channel. */
  querying: boolean;
  queryAttempt: number;
  progress: ActProgress;
  listeners: Set<(progress: ActProgress) => void>;
  timers: Set<ReturnType<typeof setTimeout>>;
  /** At OP_HORIZON_S past its creation, whatever the channel: no ledger answers for it after. */
  horizon: ReturnType<typeof setTimeout> | null;
  settled: boolean;
  resolve(outcome: ActOutcome): void;
};

const random = (bytes: number) => base64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export const executorOf = (name: string): Executor => (name.startsWith('sminos.') ? 'sminos' : name.startsWith('endpoint.') ? 'endpoint' : 'engine-host');

/** A terminal outcome in the executing side's words (`done`'s, a query's), or null for one that is not terminal. */
function terminalOf(outcome: unknown): ActOutcome | null {
  if (!isObject(outcome)) return null;
  if (outcome.state === 'done') return { state: 'done', result: outcome.result };
  if (outcome.state === 'failed') return { state: 'failed', error: outcome.error };
  if (outcome.state === 'refused') return { state: 'refused', reason: typeof outcome.reason === 'string' ? outcome.reason : 'refused' };
  return null;
}

export class ActTable {
  readonly #entries = new Map<string, Entry>();
  readonly #deps: ActTableDeps;

  constructor(deps: ActTableDeps) {
    this.#deps = deps;
  }

  get size(): number {
    return this.#entries.size;
  }

  /** A new act; `ended` names the link's permanent end (`removed`, `closed`) when it holds one. */
  act(request: ActRequest, ended: 'removed' | 'closed' | null): ActHandle {
    const { now } = this.#deps;
    let resolve!: (outcome: ActOutcome) => void;
    const outcome = new Promise<ActOutcome>((done) => (resolve = done));
    const opId = random(16);
    const createdAt = now();
    const opCreated = new Date(createdAt).toISOString();
    const signedIn = this.#deps.signedIn();
    const action = {
      v: 1,
      org: signedIn?.identity.org ?? '',
      machine: this.#deps.machine,
      device: signedIn?.identity.device ?? '',
      opId,
      opCreated,
      action: request.action,
      ...(request.session === undefined ? {} : { session: request.session }),
      ...(request.context === undefined ? {} : { context: request.context }),
      args: request.args,
      ...(request.requestDigest === undefined ? {} : { requestDigest: request.requestDigest }),
      nonce: random(NONCE_BYTES),
      created: opCreated,
    } as Action;
    const entry: Entry = {
      opId,
      opCreated,
      executor: request.executor ?? executorOf(request.action),
      mode: request.stepUp ?? 'if-asked',
      action,
      signed: false,
      signing: false,
      windowFrom: createdAt,
      outstanding: false,
      ambiguous: false,
      acked: false,
      querying: false,
      queryAttempt: 0,
      progress: 'waiting',
      listeners: new Set(),
      timers: new Set(),
      horizon: null,
      settled: false,
      resolve,
    };
    const handle: ActHandle = {
      opId,
      get opCreated() {
        return entry.opCreated;
      },
      progress: () => entry.progress,
      onProgress(listener) {
        entry.listeners.add(listener);
        return () => void entry.listeners.delete(listener);
      },
      outcome,
    };
    this.#entries.set(opId, entry);
    // Refused locally, as the endpoint would refuse it: a session without its context, a shape it would not read (which
    // would close the channel), or a link already ended.
    if (ended !== null) this.#settle(entry, { state: 'refused', reason: ended });
    else if (signedIn === null) this.#settle(entry, { state: 'refused', reason: 'offline' });
    else if ((request.session !== undefined && request.context === undefined) || !isAction(action)) this.#settle(entry, { state: 'refused', reason: 'malformed' });
    else if (entry.mode === 'required') void this.#sign(entry);
    else this.#trySend(entry);
    // Past the horizon the executor's ledger no longer answers (`#query`), and a lost channel may never come back to ask.
    if (!entry.settled) {
      entry.horizon = setTimeout(
        () => this.#settle(entry, entry.outstanding ? { state: 'unknown', reason: 'expired' } : { state: 'refused', reason: 'expired' }),
        createdAt + OP_HORIZON_S * 1000 + 1 - now(),
      );
      entry.horizon.unref?.();
    }
    return handle;
  }

  /** A channel became current: every unsettled act is sent, resealed or queried on it. */
  onCurrent(): void {
    for (const entry of [...this.#entries.values()]) {
      if (entry.settled || entry.signing) continue;
      if (!entry.outstanding) this.#trySend(entry);
      else if (entry.ambiguous && !entry.acked && !entry.signed && this.#inWindow(entry)) this.#transmit(entry, true);
      else this.#query(entry);
    }
  }

  /** The current channel was lost: every act a copy of which went out on it is ambiguous. */
  onLost(): void {
    for (const entry of this.#entries.values()) {
      if (entry.settled) continue;
      entry.querying = false;
      this.#clearTimers(entry);
      if (entry.outstanding) {
        entry.ambiguous = true;
        this.#progress(entry, 'unknown');
      } else if (!entry.signing) this.#armWindow(entry);
    }
  }

  /** The link ended for good: an act no copy of which may have run is refused, the rest unknown. */
  close(reason: 'removed' | 'closed'): void {
    for (const entry of [...this.#entries.values()]) this.#settle(entry, entry.outstanding ? { state: 'unknown', reason } : { state: 'refused', reason });
  }

  /** An `ack`, `done` or `queried` from the current channel. */
  receive(message: EndpointMessage): void {
    if (message.t !== 'ack' && message.t !== 'done' && message.t !== 'queried') return;
    const entry = this.#entries.get(message.opId);
    if (entry === undefined || entry.settled) return;
    if (message.t === 'ack') return this.#ack(entry, message.state === 'accepted' ? null : message.reason);
    if (message.t === 'done') return this.#done(entry, message.outcome);
    this.#queried(entry, message.state, message.outcome, message.reason);
  }

  #ack(entry: Entry, refusal: string | null): void {
    this.#clearTimers(entry);
    if (refusal === null) {
      entry.acked = true;
      this.#progress(entry, 'accepted');
      this.#after(entry, this.#deps.timing.DONE_QUERY_MS, () => this.#query(entry));
      return;
    }
    if (entry.ambiguous) return this.#query(entry);
    entry.outstanding = false;
    if (refusal === 'step-up' && entry.mode === 'if-asked' && !entry.signed) return void this.#sign(entry);
    this.#settle(entry, { state: 'refused', reason: refusal });
  }

  #done(entry: Entry, outcome: unknown): void {
    const terminal = terminalOf(outcome);
    if (terminal !== null && !(terminal.state === 'refused' && entry.ambiguous)) return this.#settle(entry, terminal);
    // in-progress, unknown, or a refusal of an act that may have run: the ledger says.
    this.#clearTimers(entry);
    this.#query(entry);
  }

  #queried(entry: Entry, state: string, outcome: unknown, reason: string | undefined): void {
    if (!entry.querying) return; // an answer to a query of an earlier channel, or one already superseded
    entry.querying = false;
    switch (state) {
      case 'done': {
        const terminal = terminalOf(outcome);
        if (terminal !== null) return this.#settle(entry, terminal);
        return this.#requery(entry);
      }
      case 'refused':
        if (outcome !== undefined) return this.#settle(entry, terminalOf(outcome) ?? { state: 'refused', reason: isObject(outcome) && typeof outcome.reason === 'string' ? outcome.reason : 'refused' });
        // The endpoint's authorization could not be answered now (its inputs moved, the org or the ref briefly away):
        // asked again. Any other reason is the machine declining to say (`grade`, `class`): unknown for good.
        if (reason === 'unavailable') return this.#requery(entry);
        return this.#settle(entry, { state: 'unknown', reason: reason ?? 'refused' });
      case 'not-received':
        return this.#settle(entry, { state: 'not-sent' });
      case 'expired':
        return this.#settle(entry, { state: 'unknown', reason: 'expired' });
      default: // in-progress, unavailable
        return this.#requery(entry);
    }
  }

  async #sign(entry: Entry): Promise<void> {
    const signedIn = this.#deps.signedIn();
    if (signedIn === null) return this.#settle(entry, { state: 'refused', reason: 'offline' });
    entry.signing = true;
    const a = entry.action;
    let result: Awaited<ReturnType<SignedIn['stepUp']['sign']>>;
    try {
      result = await signedIn.stepUp.sign({
        machine: a.machine,
        action: a.action,
        args: a.args,
        session: a.session,
        context: a.context,
        requestDigest: a.requestDigest,
        opId: a.opId,
        opCreated: a.opCreated,
      });
    } catch {
      result = { ok: false, reason: 'failed' };
    }
    entry.signing = false;
    if (entry.settled) return;
    if (!result.ok) return this.#settle(entry, { state: 'refused', reason: result.reason === 'malformed' ? 'malformed' : 'step-up-cancelled' });
    if (result.action.opId !== entry.opId || result.action.opCreated !== entry.opCreated) return this.#settle(entry, { state: 'refused', reason: 'malformed' });
    entry.action = result.action;
    entry.signed = true;
    entry.windowFrom = this.#deps.now();
    this.#trySend(entry);
  }

  /** An act with no copy out: sent now if a channel is current, else held for the rest of its window. */
  #trySend(entry: Entry): void {
    if (!this.#inWindow(entry)) return this.#settle(entry, { state: 'refused', reason: 'offline' });
    if (this.#deps.current()) return this.#transmit(entry, false);
    this.#progress(entry, 'waiting');
    this.#armWindow(entry);
  }

  #armWindow(entry: Entry): void {
    this.#clearTimers(entry);
    const left = entry.windowFrom + this.#deps.timing.ACT_FRESH_MS - this.#deps.now();
    this.#after(entry, Math.max(0, left), () => {
      if (!entry.outstanding && !entry.signing) this.#settle(entry, { state: 'refused', reason: 'offline' });
    });
  }

  #inWindow(entry: Entry): boolean {
    return this.#deps.now() - entry.windowFrom < this.#deps.timing.ACT_FRESH_MS;
  }

  /** One copy on the current channel: the act as built or signed, or (`reseal`) with a fresh nonce; `created` now unless signed. */
  #transmit(entry: Entry, reseal: boolean): void {
    this.#clearTimers(entry);
    if (!entry.signed) entry.action = { ...entry.action, ...(reseal ? { nonce: random(NONCE_BYTES) } : {}), created: new Date(this.#deps.now()).toISOString() };
    if (!this.#deps.send({ t: 'act', action: entry.action })) {
      if (!entry.outstanding) this.#armWindow(entry);
      return;
    }
    entry.outstanding = true;
    entry.acked = false;
    this.#progress(entry, entry.ambiguous ? 'unknown' : 'sent');
    this.#after(entry, this.#deps.timing.ACK_TIMEOUT_MS, () => {
      entry.ambiguous = true;
      this.#query(entry);
    });
  }

  /** Asks the executor's ledger, now if a channel is current, else at the next one. */
  #query(entry: Entry): void {
    this.#clearTimers(entry);
    this.#progress(entry, 'unknown');
    if (this.#deps.now() - Date.parse(entry.opCreated) > OP_HORIZON_S * 1000) return this.#settle(entry, { state: 'unknown', reason: 'expired' });
    if (!this.#deps.current()) return;
    if (this.#deps.send({ t: 'query', opId: entry.opId, opCreated: entry.opCreated, executor: entry.executor })) entry.querying = true;
  }

  #requery(entry: Entry): void {
    const delays = this.#deps.timing.QUERY_BACKOFF_MS;
    const delay = delays[Math.min(entry.queryAttempt, delays.length - 1)];
    entry.queryAttempt += 1;
    this.#after(entry, delay, () => this.#query(entry));
  }

  #after(entry: Entry, ms: number, run: () => void): void {
    const timer = setTimeout(() => {
      entry.timers.delete(timer);
      if (!entry.settled) run();
    }, ms);
    entry.timers.add(timer);
  }

  #clearTimers(entry: Entry): void {
    for (const timer of entry.timers) clearTimeout(timer);
    entry.timers.clear();
  }

  #progress(entry: Entry, progress: ActProgress): void {
    if (entry.progress === progress) return;
    entry.progress = progress;
    for (const listener of [...entry.listeners]) listener(progress);
  }

  #settle(entry: Entry, outcome: ActOutcome): void {
    if (entry.settled) return;
    entry.settled = true;
    this.#clearTimers(entry);
    if (entry.horizon !== null) clearTimeout(entry.horizon);
    this.#entries.delete(entry.opId);
    entry.resolve(outcome);
  }
}
