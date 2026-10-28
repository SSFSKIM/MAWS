// Actions to their executing side (O10 M7; RL4, RL §4.7; Interfaces §B, §H). An `act` is checked at the endpoint, then
// handed to the side that runs it, which keeps the one durable ledger for its `opId`, bound to the operation and its
// sender; the endpoint keeps none for others' actions (only freshness.ts's nonce window).
//
// The endpoint's checks, in order, the first refusal answering `ack {state: 'refused', reason}`:
//   1. freshness and replay (freshness.ts: `stale`, `malformed`, `expired`, `replayed`), before anything is read;
//   2. authorization (M5's gate, which calls `execute` with what it decided);
//   3. the lane's shape and context: a lane B action carries a lane B context, and its `launchId` and `engineSessionId`
//      are the session's now (`context`; the engine host rechecks both at its claim); a lane A action's launch is its
//      member's bridge now (`context`), a member with no bridge has nothing to fence it (`unavailable`), its own fields
//      must agree with its args (`malformed`) (rl10's `rpc`);
//   4. an executor that keeps a ledger: the engine host (lane B, `host.op`), sminos (lane A, RL10's `rpc`) or the
//      endpoint itself (endpoint-actions.ts); any other is `no-ledger` (a pty-host or machine command, until O3 and O7
//      give theirs ledgers).
// Then `ack {state: 'accepted'}`, and `done {opId, outcome}` when the executing side answers, its own refusals
// (`tombstoned`, `op-conflict`, `digest-mismatch`, `context`, `expired`, `unavailable`) included. An outcome is in
// sminos's vocabulary on either lane, so a device reads one: lane A's is sminos's `rpc-result` outcome; lane B's and the
// endpoint's are the ledger's answer read so (`outcomeOf`: a command that answered `{state: 'done', result}`, one that
// failed `{state: 'failed', error}`; `{state: 'refused', reason}`; `{state: 'in-progress'}`). An engine host that can't
// be reached once the action is handed on leaves it unknown (`{state: 'unknown', reason}`): the device asks by `query`.
//
// Lane A's results are bound to their sender for as long as sminos can answer them (KEPT_S): the endpoint holds each op
// it handed down by opId, with its sender (sminos's identity: the member and the operation's fingerprint) and every
// nonce a copy of it went under. A copy of a held op from anyone else is refused `op-conflict` and never handed down; a
// nonce already used is `replayed`, whoever sends it (the freshness window is each device's). A result under any of the
// op's nonces (sminos answers under the latest copy's, but one under an earlier copy's may already be on its way) goes
// to the open channels its sender's copies came on; with none open it goes nowhere, and the device asks by `query`. A
// closed channel frees nothing: the op stays its sender's.
//
// Each action in flight holds `mawsd` (`hold('op')`) until its result is recorded: lane B's and the endpoint's until
// their answer, lane A's until sminos's result or the close of every channel its copies came on (sminos keeps its result,
// and a reconnecting device asks). `stop()` takes no action more (`restart`) and waits up to STOP_WAIT_MS for those in flight.
import { actionFingerprint, KEPT_S, type ActMessage, type RefusalReason } from 'org-protocol';
import type { RemoteChannel } from './channels';
import type { EndpointActions } from './endpoint-actions';
import type { Freshness } from './freshness';
import type { Granted } from './gate';
import { OFFERS, type Offers } from './offers';
import type { Rl10, RpcResult } from './rl10/link';
import type { EndpointServices } from './services';

export const STOP_WAIT_MS = 2000;

export type ActionsContext = {
  freshness: Freshness;
  own: EndpointActions;
  rl10: Pick<Rl10, 'rpc'>;
  dispatch: EndpointServices['dispatch'];
  hold(reason: string): () => void;
  /** What the engine host's last ledger answer said of its ledger: why it is closed, or null (the status shows it). */
  engineHostLedger?(closed: string | null): void;
  offers?: Offers;
  now(): number;
  log(line: string): void;
};

/** At most this many lane A ops are held; past it a new one is refused `busy` until older ones age out. */
export const LANE_A_MAX = 100_000;

/**
 * A lane A op handed down, held until KEPT_S after its first copy (as long as sminos keeps it, and so can answer it):
 * its sender (sminos's identity, the member and the operation), every nonce a copy of it went under (sminos answers
 * under any of them: the latest copy's, or an earlier one's already on its way), the open channels its copies came on
 * with each one's close listener, and the hold while an answer is awaited on one.
 */
type LaneAOp = { member: string; fingerprint: string; nonces: Set<string>; channels: Map<RemoteChannel, () => void>; until: number; release: (() => void) | null };

/** A ledger's kept result (`{ok: true, value}` or `{ok: false, error}`) as a device reads an outcome. */
export function outcomeOf(result: unknown): unknown {
  if (!isObject(result)) return { state: 'failed', error: { code: 'internal' } };
  return result.ok === true ? { state: 'done', result: result.value } : { state: 'failed', error: result.error };
}

/** A ledger's answer to an action (host.op's, the endpoint's own) as `done`'s outcome; why a ledger is closed is the
 * machine's status, not the device's. */
function answered(answer: unknown): unknown {
  if (!isObject(answer)) return answer;
  if (answer.state === 'done') return outcomeOf(answer.result);
  return answer.state === 'refused' ? { state: 'refused', reason: answer.reason } : answer;
}

/** Why the engine host's ledger is closed, as its answer says it (`ledger`), or null for an answer of an open one. */
export function closedLedgerOf(value: unknown): string | null {
  return isObject(value) && typeof value.ledger === 'string' ? value.ledger : null;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export class Actions {
  readonly #inflight = new Set<Promise<unknown>>();
  /** Lane A's ops handed down, by opId, oldest first; and each nonce a copy went under, to its opId. */
  readonly #laneA = new Map<string, LaneAOp>();
  readonly #nonces = new Map<string, string>();
  /** Every hold out for an action in flight; `stop` lets go of those still out once it has waited. */
  readonly #holds = new Set<() => void>();
  #stopping = false;

  constructor(private readonly ctx: ActionsContext) {}

  /** The channel's `act` route: freshness and replay, then `authorized` (the gate, which calls `execute`). */
  receive(channel: RemoteChannel, m: ActMessage, authorized: (channel: RemoteChannel, m: ActMessage) => void): void {
    const refusal = this.#stopping ? 'restart' : this.ctx.freshness.check(m.action, channel.device, this.ctx.now());
    if (refusal !== null) return void channel.send({ t: 'ack', opId: m.action.opId, state: 'refused', reason: refusal });
    authorized(channel, m);
  }

  /** An authorized action, handed to its executing side (the gate's `act` executor). */
  execute(channel: RemoteChannel, m: ActMessage, decision: Granted): void {
    const progress = { accepted: false };
    const run = this.#execute(channel, m, decision, progress).catch((error: unknown) => {
      this.ctx.log(`endpoint: an action on channel ${channel.key} failed on its way to its executor: ${(error as Error).message}`);
      // Handed on already, its fate is the executor's to say: the device asks by `query`.
      if (progress.accepted) channel.send({ t: 'done', opId: m.action.opId, outcome: { state: 'unknown', reason: 'internal' } });
      else channel.send({ t: 'ack', opId: m.action.opId, state: 'refused', reason: 'unavailable' });
    });
    this.#track(run);
  }

  /** sminos's result of a lane A action: `done` to the open channels its sender's copies came on, when the nonce is one
   * of that op's; none open, it goes nowhere (the device asks by `query`). */
  result(result: RpcResult): void {
    const opId = this.#nonces.get(result.nonce);
    const op = opId === undefined || opId !== result.opId ? undefined : this.#laneA.get(opId);
    if (opId === undefined || op === undefined) return;
    for (const [channel, off] of op.channels) {
      off();
      if (!channel.closed) channel.send({ t: 'done', opId, outcome: result.outcome });
    }
    op.channels.clear();
    this.#letGo(op);
  }

  /** Takes no action more and waits, up to STOP_WAIT_MS, for those in flight to record their results. */
  async stop(): Promise<void> {
    this.#stopping = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.allSettled([...this.#inflight]), new Promise<void>((resolve) => (timer = setTimeout(resolve, STOP_WAIT_MS)))]);
    clearTimeout(timer);
    for (const op of this.#laneA.values()) for (const off of op.channels.values()) off();
    this.#laneA.clear();
    this.#nonces.clear();
    for (const release of [...this.#holds]) release();
  }

  /** `mawsd` held for one action, once: the returned function lets go. */
  #hold(): () => void {
    const release = this.ctx.hold('op');
    const once = () => {
      if (this.#holds.delete(once)) release();
    };
    this.#holds.add(once);
    return once;
  }

  /** A copy of `op` awaits its answer on `channel`: held while one of its channels is open. */
  #await(op: LaneAOp, channel: RemoteChannel): void {
    if (!op.channels.has(channel)) {
      op.channels.set(
        channel,
        channel.onClose(() => {
          op.channels.delete(channel);
          if (op.channels.size === 0) this.#letGo(op);
        }),
      );
    }
    op.release ??= this.#hold();
  }

  #letGo(op: LaneAOp): void {
    op.release?.();
    op.release = null;
  }

  /** Lane A ops past KEPT_S let go: sminos keeps none of them longer, so none is answered after. */
  #expire(now: number): void {
    for (const [opId, op] of this.#laneA) {
      if (op.until > now) break;
      for (const off of op.channels.values()) off();
      this.#letGo(op);
      for (const nonce of op.nonces) this.#nonces.delete(nonce);
      this.#laneA.delete(opId);
    }
  }

  async #execute(channel: RemoteChannel, m: ActMessage, decision: Granted, progress: { accepted: boolean }): Promise<void> {
    const { action } = m;
    const refuse = (reason: RefusalReason) => void channel.send({ t: 'ack', opId: action.opId, state: 'refused', reason });
    const accept = () => {
      progress.accepted = true;
      channel.send({ t: 'ack', opId: action.opId, state: 'accepted' });
    };
    const offers = this.ctx.offers ?? OFFERS;
    const row = Object.hasOwn(offers.commands, action.action) ? offers.commands[action.action] : undefined;
    if (row === undefined) return refuse('not-offered');
    if (row.executor !== 'engine-host' && row.executor !== 'sminos' && row.executor !== 'endpoint') return refuse('no-ledger');
    const who = { member: channel.member, device: channel.device };
    const fingerprint = await actionFingerprint(action);
    if (channel.closed) return;

    if (row.executor === 'sminos') {
      const now = this.ctx.now();
      this.#expire(now);
      const known = this.#laneA.get(action.opId);
      // A nonce is a copy's own for as long as its op is held: one already handed down is a replay, whoever sends it.
      if (this.#nonces.has(action.nonce)) return refuse('replayed');
      // A copy of an op held here is its sender's (sminos's identity: the member and the operation); anyone else's is
      // refused here and never handed down, so nothing of the op's answers can reach it.
      if (known !== undefined && (known.member !== who.member || known.fingerprint !== fingerprint)) return refuse('op-conflict');
      if (known === undefined && this.#laneA.size >= LANE_A_MAX) return refuse('busy');
      const sent = this.ctx.rl10.rpc(action, who, fingerprint);
      if (!sent.ok) return refuse(sent.reason);
      const op = known ?? { member: who.member, fingerprint, nonces: new Set<string>(), channels: new Map(), until: now + KEPT_S * 1000, release: null };
      if (known === undefined) this.#laneA.set(action.opId, op);
      op.nonces.add(action.nonce);
      this.#nonces.set(action.nonce, action.opId);
      this.#await(op, channel);
      accept();
      return;
    }

    if (row.executor === 'endpoint') {
      accept();
      const release = this.#hold();
      try {
        channel.send({ t: 'done', opId: action.opId, outcome: answered(await this.ctx.own.run(action, who, fingerprint)) });
      } finally {
        release();
      }
      return;
    }

    // Lane B: the context the action was sealed for is the session's now, checked here and again at the claim.
    const context = action.context;
    const appSessionId = decision.target?.lane === 'B' ? decision.target.appSessionId : undefined;
    if (context?.lane !== 'B' || appSessionId === undefined) return refuse('malformed');
    const status = await this.ctx.dispatch('engine-host', 'session.status', { appSessionId });
    if (!status.ok) return refuse(status.error.code === 'host_unavailable' || status.error.code === 'timeout' ? 'unavailable' : 'context');
    const now = isObject(status.value) ? status.value : {};
    if (now.launchId !== context.launchId || now.engineSessionId !== context.engineSessionId) return refuse('context');
    if (channel.closed) return;
    accept();
    const release = this.#hold();
    try {
      const answer = await this.ctx.dispatch('engine-host', 'host.op', {
        opId: action.opId,
        opCreated: action.opCreated,
        member: who.member,
        device: who.device,
        fingerprint,
        name: action.action,
        input: action.args,
        context: { launchId: context.launchId, engineSessionId: context.engineSessionId },
        ...(action.requestDigest === undefined ? {} : { requestDigest: action.requestDigest }),
      });
      if (answer.ok) this.ctx.engineHostLedger?.(closedLedgerOf(answer.value));
      channel.send({ t: 'done', opId: action.opId, outcome: answer.ok ? answered(answer.value) : { state: 'unknown', reason: answer.error.code } });
    } finally {
      release();
    }
  }

  #track(run: Promise<unknown>): void {
    this.#inflight.add(run);
    void run.finally(() => this.#inflight.delete(run));
  }
}
