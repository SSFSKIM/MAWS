// The RL2 link's acts (P5 O7 M1, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Acts"; RL4, RL §4.7): one
// entry per opId, from the action's building to its outcome. Main builds every action from typed fields and the session's
// identity; a step-up goes only through the session's signer (RL §5.6).
//
// - Sent, or resealed, only within ACT_FRESH_MS of its creation (a step-up act's window runs from its signature, the
//   time the person confirmed it), and never after the caller's own `sendBy` (P5 O7 M2: a send's pending budget, which a
//   resume may have spent most of). One the link could not put on a channel in that window resolves `refused offline` and
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
// - P5 O7 M2: what the peer could not read never goes. An act or a query for an executor the current channel's peer did
//   not list in `h2` (capabilities.ts) is refused `not-offered` while no copy of it went out, and left `unknown
//   not-offered` once one did (it can't be asked after); and an act whose sealed form would be over the channel's message
//   limit is refused `too-large`, checked as built (before a person is asked to confirm it) and as signed.
// - P5 O7 M5a: an act's `args` that carry bytes (./bytes.ts) are sealed in json-bytes' tagged form, and go only to a peer
//   that lists `rl2.bytes` (else `not-offered`, as an executor it doesn't read); an act may name a capability its peer must
//   list (`requires`: an artifact write's `rl2.artifacts`), judged the same way at each transmission; and a result from a
//   peer that lists `rl2.bytes` is read back from the tagged form.
// - P5 O8 M6b: several step-up acts under one confirmation (`actMany`, a Share sheet's save). Each is built and checked
//   as `act` builds it, all are signed at once (the step-up sheet lists them all), and each is then entered and sent only
//   when its caller says (`SignedAct.send`), so a caller sends them in its order and stops at a failure. A signed act's
//   window runs from the confirmation; one sent past it is refused `stale`, never sent.
import { base64urlEncode, isAction, MESSAGE_MAX_BYTES, NONCE_BYTES, OP_HORIZON_S, type Action, type ActionContext, type DeviceMessage, type EndpointMessage, type Executor, type RefusalReason, type RequestDigest } from '../../../../apps/org-protocol/src/index.ts';
import type { MachineRef } from '@shared/machine/ref';
import type { SignedIn } from '../../org/session';
import { fromWire, needsCodec, toWire } from '@shared/host/json-bytes';
import { BYTES_CAPABILITY } from './bytes';
import { peerTakesExecutor } from './capabilities';
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
  /** Epoch ms past which no copy goes out or is resealed, inside ACT_FRESH_MS (P5 O7 M2: the caller's bound). */
  sendBy?: number;
  /** P5 O7 M5a: a capability the peer must list for the act to go (an artifact write's `rl2.artifacts`); `not-offered` else. */
  requires?: string;
  /**
   * P5 O7 M5c: an act that names what only one channel holds (a page's lease) goes only on the channel current when it was
   * made: refused `offline` with none current, or once that channel ends before a copy went out; one a copy of which went
   * out settles `unknown` (`channel-lost`) at that channel's end, never resealed or asked about on the next one.
   */
  oneChannel?: true;
}
/** P5 O8 M6b: one act of a batch, signed under the batch's one confirmation; `send` enters it in the table, once. */
export interface SignedAct {
  readonly opId: string;
  send(): ActHandle;
}
/** P5 O8 M6b: a batch signed (its acts in the order asked), or why nothing was asked or signed. */
export type ActManyResult = { ok: true; acts: SignedAct[] } | { ok: false; reason: 'removed' | 'closed' | 'offline' | 'malformed' | 'too-large' | 'step-up-cancelled' };
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
  /** The capabilities the current channel's peer listed in `h2`; null while none is current. */
  peerCapabilities(): readonly string[] | null;
  timing: RemoteTiming;
  now(): number;
  log(line: string): void;
}

/** An act as built, before its table entry: its creation (ms) and whether its args are sealed in the tagged form. */
type Built = { action: Action; createdAt: number; tagged: boolean };

type Entry = {
  opId: string;
  opCreated: string;
  executor: Executor;
  /** P5 O7 M5a: what the peer must list beyond the executor's capability: `requires`, and `rl2.bytes` for tagged args. */
  needs: string[];
  /** P5 O7 M5c: `ActRequest.oneChannel`; `strayed` once the channel it was made on ended. */
  oneChannel: boolean;
  strayed: boolean;
  mode: 'required' | 'if-asked' | 'never';
  /** The act as built, or as signed; a send stamps `created` (and a reseal a fresh nonce) on an unsigned one. */
  action: Action;
  signed: boolean;
  signing: boolean;
  /** When its send window began: its creation, or its signature. */
  windowFrom: number;
  /** The caller's end of the window (`ActRequest.sendBy`), if any. */
  sendBy: number | null;
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
const encoder = new TextEncoder();
/** Whether the channel would carry the act: its `act` message, as `Channel.send` measures it, within the message limit. */
const fits = (action: Action) => encoder.encode(JSON.stringify({ t: 'act', action })).length <= MESSAGE_MAX_BYTES;

export const executorOf = (name: string): Executor => (name.startsWith('sminos.') ? 'sminos' : name.startsWith('endpoint.') ? 'endpoint' : 'engine-host');

/** A terminal outcome in the executing side's words (`done`'s, a query's), or null for one that is not terminal. */
function terminalOf(outcome: unknown): ActOutcome | null {
  if (!isObject(outcome)) return null;
  if (outcome.state === 'done') return { state: 'done', result: outcome.result };
  if (outcome.state === 'failed') return { state: 'failed', error: outcome.error };
  if (outcome.state === 'refused') return { state: 'refused', reason: typeof outcome.reason === 'string' ? outcome.reason : 'refused' };
  return null;
}

/** What `onCurrent` wrote on the new channel: its messages, acts and queries alike, and their UTF-8 JSON bytes. */
export type ActsWritten = { messages: number; bytes: number };

export class ActTable {
  readonly #entries = new Map<string, Entry>();
  readonly #deps: ActTableDeps;
  /** While `onCurrent` runs: what it has written so far. */
  #written: ActsWritten | null = null;

  constructor(deps: ActTableDeps) {
    this.#deps = deps;
  }

  get size(): number {
    return this.#entries.size;
  }

  /** A new act; `ended` names the link's permanent end (`removed`, `closed`) when it holds one. */
  act(request: ActRequest, ended: 'removed' | 'closed' | null): ActHandle {
    const signedIn = this.#deps.signedIn();
    const { entry, handle } = this.#enter(request, this.#build(request, signedIn));
    // Refused locally, as the endpoint would refuse it: a session without its context, a shape it would not read (which
    // would close the channel), or a link already ended.
    const refusal = ended ?? (signedIn === null ? 'offline' : this.#unsendable(request, entry.action));
    if (refusal !== null) this.#settle(entry, { state: 'refused', reason: refusal });
    else if (entry.mode === 'required') void this.#sign(entry);
    else this.#trySend(entry);
    this.#armHorizon(entry);
    return handle;
  }

  /**
   * P5 O8 M6b: several step-up acts under one confirmation (the module's header). Each is built and judged as `act` does
   * before anyone is asked, and any refusal refuses the batch; then all are signed at once, whatever their `stepUp`.
   * `ended` is read again at each act's send.
   */
  async actMany(requests: readonly ActRequest[], ended: () => 'removed' | 'closed' | null): Promise<ActManyResult> {
    const end = ended();
    if (end !== null) return { ok: false, reason: end };
    const signedIn = this.#deps.signedIn();
    if (signedIn === null) return { ok: false, reason: 'offline' };
    if (requests.length === 0) return { ok: false, reason: 'malformed' };
    const built = requests.map((request) => this.#build(request, signedIn));
    for (let i = 0; i < built.length; i++) {
      const refusal = this.#unsendable(requests[i], built[i].action);
      if (refusal !== null) return { ok: false, reason: refusal };
    }
    let result: Awaited<ReturnType<SignedIn['stepUp']['signActions']>>;
    try {
      result = await signedIn.stepUp.signActions(built.map(({ action: a }) => ({ machine: a.machine, action: a.action, args: a.args, session: a.session, context: a.context, requestDigest: a.requestDigest, opId: a.opId, opCreated: a.opCreated })));
    } catch {
      result = { ok: false, reason: 'failed' };
    }
    if (!result.ok) return { ok: false, reason: result.reason === 'malformed' ? 'malformed' : 'step-up-cancelled' };
    const actions = result.actions;
    if (actions.length !== built.length || actions.some((a, i) => a.opId !== built[i].action.opId || a.opCreated !== built[i].action.opCreated)) return { ok: false, reason: 'malformed' };
    if (actions.some((a) => !fits(a))) return { ok: false, reason: 'too-large' };
    const signedAt = this.#deps.now();
    return {
      ok: true,
      acts: requests.map((request, i) => {
        let handle: ActHandle | null = null;
        return {
          opId: actions[i].opId,
          send: () => (handle ??= this.#sendSigned(request, built[i], actions[i], signedAt, ended())),
        };
      }),
    };
  }

  /** A batch's signed act entered and sent: refused if its link ended, signed out, or its window has passed. */
  #sendSigned(request: ActRequest, built: Built, action: Action, signedAt: number, ended: 'removed' | 'closed' | null): ActHandle {
    const { entry, handle } = this.#enter(request, built);
    entry.mode = 'required';
    entry.action = action;
    entry.signed = true;
    entry.windowFrom = signedAt;
    if (ended !== null) this.#settle(entry, { state: 'refused', reason: ended });
    else if (this.#deps.signedIn() === null) this.#settle(entry, { state: 'refused', reason: 'offline' });
    else if (!this.#inWindow(entry)) this.#settle(entry, { state: 'refused', reason: 'stale' });
    else this.#trySend(entry);
    this.#armHorizon(entry);
    return handle;
  }

  /** The act a request names, from the session's identity: its opId and creation now, its args sealed as the peer reads them. */
  #build(request: ActRequest, signedIn: SignedIn | null): Built {
    const createdAt = this.#deps.now();
    const opCreated = new Date(createdAt).toISOString();
    const tagged = needsCodec(request.args);
    const action = {
      v: 1,
      org: signedIn?.identity.org ?? '',
      machine: this.#deps.machine,
      device: signedIn?.identity.device ?? '',
      opId: random(16),
      opCreated,
      action: request.action,
      ...(request.session === undefined ? {} : { session: request.session }),
      ...(request.context === undefined ? {} : { context: request.context }),
      args: tagged ? toWire(request.args) : request.args,
      ...(request.requestDigest === undefined ? {} : { requestDigest: request.requestDigest }),
      nonce: random(NONCE_BYTES),
      created: opCreated,
    } as Action;
    return { action, createdAt, tagged };
  }

  /** Why the endpoint would refuse the act as built, before anything is sent or asked: a session without its context, a shape it would not read (which would close the channel), or a size past the message limit; else null. */
  #unsendable(request: ActRequest, action: Action): 'malformed' | 'too-large' | null {
    if ((request.session !== undefined && request.context === undefined) || !isAction(action)) return 'malformed';
    return fits(action) ? null : 'too-large';
  }

  /** The table's entry for a built act, and its caller's handle. */
  #enter(request: ActRequest, built: Built): { entry: Entry; handle: ActHandle } {
    const { action, createdAt, tagged } = built;
    let resolve!: (outcome: ActOutcome) => void;
    const outcome = new Promise<ActOutcome>((done) => (resolve = done));
    const entry: Entry = {
      opId: action.opId,
      opCreated: action.opCreated,
      executor: request.executor ?? executorOf(request.action),
      needs: [...(request.requires === undefined ? [] : [request.requires]), ...(tagged ? [BYTES_CAPABILITY] : [])],
      oneChannel: request.oneChannel === true,
      strayed: request.oneChannel === true && !this.#deps.current(),
      mode: request.stepUp ?? 'if-asked',
      action,
      signed: false,
      signing: false,
      windowFrom: createdAt,
      sendBy: request.sendBy ?? null,
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
      opId: entry.opId,
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
    this.#entries.set(entry.opId, entry);
    return { entry, handle };
  }

  /** Past the horizon the executor's ledger no longer answers (`#query`), and a lost channel may never come back to ask. */
  #armHorizon(entry: Entry): void {
    if (entry.settled) return;
    entry.horizon = setTimeout(
      () => this.#settle(entry, entry.outstanding ? { state: 'unknown', reason: 'expired' } : { state: 'refused', reason: 'expired' }),
      Date.parse(entry.opCreated) + OP_HORIZON_S * 1000 + 1 - this.#deps.now(),
    );
    entry.horizon.unref?.();
  }

  /**
   * P5 O7 M4 (the architect's ruling on a spawn that answered `unknown`): the executing side's ledger asked again about an
   * op this table settled `unknown`, which may still have run and whose ledger may since record its outcome. A handle on
   * that answer: only `query` is sent, never the act; past the op's horizon no ledger answers, so it settles `unknown`
   * (`expired`) at once.
   */
  requery(op: { opId: string; opCreated: string; executor: Executor }, ended: 'removed' | 'closed' | null): ActHandle {
    let resolve!: (outcome: ActOutcome) => void;
    const outcome = new Promise<ActOutcome>((done) => (resolve = done));
    const entry: Entry = {
      opId: op.opId,
      opCreated: op.opCreated,
      executor: op.executor,
      needs: [],
      oneChannel: false,
      strayed: false,
      mode: 'never',
      action: null as unknown as Action, // never sent: `signed`, `outstanding` and `acked` keep every path to a query
      signed: true,
      signing: false,
      windowFrom: this.#deps.now(),
      sendBy: null,
      outstanding: true,
      ambiguous: true,
      acked: true,
      querying: false,
      queryAttempt: 0,
      progress: 'unknown',
      listeners: new Set(),
      timers: new Set(),
      horizon: null,
      settled: false,
      resolve,
    };
    const handle: ActHandle = {
      opId: op.opId,
      opCreated: op.opCreated,
      progress: () => entry.progress,
      onProgress(listener) {
        entry.listeners.add(listener);
        return () => void entry.listeners.delete(listener);
      },
      outcome,
    };
    const held = this.#entries.get(op.opId);
    if (held !== undefined) {
      // still out here (sent, or asked again already): its own outcome, shared
      const first = held.resolve;
      let also!: (outcome: ActOutcome) => void;
      const shared = new Promise<ActOutcome>((done) => (also = done));
      held.resolve = (settled) => (first(settled), also(settled));
      return { ...handle, progress: () => held.progress, onProgress: (listener) => (held.listeners.add(listener), () => void held.listeners.delete(listener)), outcome: shared };
    }
    this.#entries.set(op.opId, entry);
    if (ended !== null) {
      this.#settle(entry, { state: 'unknown', reason: ended });
      return handle;
    }
    this.#query(entry); // settles `expired` past the horizon
    if (!entry.settled) {
      entry.horizon = setTimeout(() => this.#settle(entry, { state: 'unknown', reason: 'expired' }), Date.parse(op.opCreated) + OP_HORIZON_S * 1000 + 1 - this.#deps.now());
      entry.horizon.unref?.();
    }
    return handle;
  }

  /**
   * A channel became current: every unsettled act is sent, resealed or queried on it. P5 O15 M2b §F: answers what that
   * wrote, since the link writes the subscriptions after it and the wake's bound holds only while it is small.
   */
  onCurrent(): ActsWritten {
    const written: ActsWritten = { messages: 0, bytes: 0 };
    this.#written = written;
    try {
      for (const entry of [...this.#entries.values()]) {
        if (entry.settled || entry.signing) continue;
        if (!entry.outstanding) this.#trySend(entry);
        else if (entry.ambiguous && !entry.acked && !entry.signed && !entry.oneChannel && this.#inWindow(entry)) this.#transmit(entry, true);
        else this.#query(entry);
      }
    } finally {
      this.#written = null;
    }
    return written;
  }

  /** One message on the current channel, counted while `onCurrent` runs. */
  #send(message: DeviceMessage): boolean {
    const sent = this.#deps.send(message);
    if (sent && this.#written !== null) {
      this.#written.messages += 1;
      this.#written.bytes += Buffer.byteLength(JSON.stringify(message), 'utf8');
    }
    return sent;
  }

  /** The current channel was lost: every act a copy of which went out on it is ambiguous. */
  onLost(): void {
    for (const entry of this.#entries.values()) {
      if (entry.settled) continue;
      entry.querying = false;
      this.#clearTimers(entry);
      if (entry.oneChannel) entry.strayed = true;
      // P5 O7 M5c (the review's finding 2): a copy of a channel-bound act went out on the channel that ended: its caller
      // hears at once that it may have run, and nothing of it goes to, or is asked of, the next channel
      if (entry.oneChannel && entry.outstanding) {
        this.#settle(entry, { state: 'unknown', reason: 'channel-lost' });
        continue;
      }
      if (entry.outstanding) {
        entry.ambiguous = true;
        this.#progress(entry, 'unknown');
      } else if (entry.oneChannel && !entry.signing) this.#settle(entry, { state: 'refused', reason: 'offline' });
      else if (!entry.signing) this.#armWindow(entry);
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
    if (message.t === 'done') return this.#done(entry, this.#read(message.outcome));
    this.#queried(entry, message.state, this.#read(message.outcome), message.reason);
  }

  /** P5 O7 M5a: an outcome's `result` as the executing side meant it: read back from the tagged form when the peer tags. */
  #read(outcome: unknown): unknown {
    if (!isObject(outcome) || !('result' in outcome) || this.#deps.peerCapabilities()?.includes(BYTES_CAPABILITY) !== true) return outcome;
    return { ...outcome, result: fromWire(outcome.result) };
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
    if (!fits(result.action)) return this.#settle(entry, { state: 'refused', reason: 'too-large' });
    entry.action = result.action;
    entry.signed = true;
    entry.windowFrom = this.#deps.now();
    this.#trySend(entry);
  }

  /** An act with no copy out: sent now if a channel is current, else held for the rest of its window. */
  #trySend(entry: Entry): void {
    if (!this.#inWindow(entry) || entry.strayed) return this.#settle(entry, { state: 'refused', reason: 'offline' });
    if (this.#deps.current()) return this.#transmit(entry, false);
    this.#progress(entry, 'waiting');
    this.#armWindow(entry);
  }

  #armWindow(entry: Entry): void {
    this.#clearTimers(entry);
    const left = this.#windowEnd(entry) - this.#deps.now();
    this.#after(entry, Math.max(0, left), () => {
      if (!entry.outstanding && !entry.signing) this.#settle(entry, { state: 'refused', reason: 'offline' });
    });
  }

  #inWindow(entry: Entry): boolean {
    return this.#deps.now() < this.#windowEnd(entry);
  }

  #windowEnd(entry: Entry): number {
    return Math.min(entry.windowFrom + this.#deps.timing.ACT_FRESH_MS, entry.sendBy ?? Infinity);
  }

  /** Whether the current channel's peer reads `entry`'s executor and lists what it needs; else the act settles (see the header). */
  #offered(entry: Entry): boolean {
    const capabilities = this.#deps.peerCapabilities();
    if (capabilities === null || (peerTakesExecutor(entry.executor, capabilities) && entry.needs.every((needed) => capabilities.includes(needed)))) return true;
    this.#settle(entry, entry.outstanding ? { state: 'unknown', reason: 'not-offered' } : { state: 'refused', reason: 'not-offered' });
    return false;
  }

  /** One copy on the current channel: the act as built or signed, or (`reseal`) with a fresh nonce; `created` now unless signed. */
  #transmit(entry: Entry, reseal: boolean): void {
    this.#clearTimers(entry);
    if (!this.#offered(entry)) return;
    if (!entry.signed) entry.action = { ...entry.action, ...(reseal ? { nonce: random(NONCE_BYTES) } : {}), created: new Date(this.#deps.now()).toISOString() };
    if (!this.#send({ t: 'act', action: entry.action })) {
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
    if (!this.#deps.current() || !this.#offered(entry)) return;
    if (this.#send({ t: 'query', opId: entry.opId, opCreated: entry.opCreated, executor: entry.executor })) entry.querying = true;
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
