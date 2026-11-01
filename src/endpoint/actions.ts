// Actions to their executing side (O10 M7; RL4, RL §4.7; Interfaces §B, §H). An `act` is checked at the endpoint, then
// handed to the side that runs it, which keeps the one durable ledger for its `opId`, bound to the operation and its
// sender; the endpoint keeps none for others' actions (only freshness.ts's nonce window).
//
// The endpoint's checks, in order, the first refusal answering `ack {state: 'refused', reason}`:
//   1. freshness and replay (freshness.ts: `stale`, `malformed`, `expired`, `replayed`), before anything is read;
//   2. authorization (M5's gate, which calls `execute` with what it decided);
//   3. the lane's shape and context: a lane B action carries a lane B context, the engine session it was authorized
//      against is the one the session runs now (`unavailable`: the machine's index lags it, P5 O7 M2), and its
//      `launchId` and `engineSessionId` are the session's now (`context`; the engine host rechecks both at its claim);
//      a lane A action's launch is its member's bridge now (`context`), a member with no bridge has nothing to fence it
//      (`unavailable`), its own fields must agree with its args (`malformed`) (rl10's `rpc`);
//   4. an executor that keeps a ledger: the engine host (lane B, `host.op`), sminos (lane A, RL10's `rpc`), the endpoint
//      itself (endpoint-actions.ts) or the machine's services (P5 O3-D M4: `machine.op`, `mawsd`'s spine, whose ledger
//      claims no launch, so a session's context is not read for it), or the pty host (P5 O7 M3: `pty.op`, the shape of
//      `machine.op`, with no sealed action: no reader of a terminal's act needs its proof, and the pty host keeps none);
//      main's commands are `no-ledger` until main gives them one.
// Then `ack {state: 'accepted'}`, and `done {opId, outcome}` when the executing side answers, its own refusals
// (`tombstoned`, `op-conflict`, `digest-mismatch`, `context`, `expired`, `unavailable`) included. An outcome is in
// sminos's vocabulary on either lane, so a device reads one: lane A's is sminos's `rpc-result` outcome; lane B's and the
// endpoint's are the ledger's answer read so (`outcomeOf`: a command that answered `{state: 'done', result}`, one that
// failed `{state: 'failed', error}`; `{state: 'refused', reason}`; `{state: 'in-progress'}`). An engine host that can't
// be reached once the action is handed on leaves it unknown (`{state: 'unknown', reason}`): the device asks by `query`.
//
// What reaches the engine host or the machine's services carries the asking channel's `ClientRef` (P5 O7 M2).
//
// P5 O7 M4: a `machine` act goes to `machine.op` with the sealed action beside its claim (`action`), which the services'
// ledger keeps and hands to the handler as the requester's proof (`session.spawn`'s `launchedBy`, RL9's `ownersProof`).
// `files.upload` goes without it: its args are the file's bytes, which the ledger would keep for a day, and the claim's
// fingerprint binds the op to its action already. The services are this build's own, in `mawsd`'s process, so every
// field this build sends (`action`, an upload's `part`, `session.spawn`) is one they read.
//
// Lane A's copies go through lane-a.ts, which asks sminos whose an op is before a first copy goes down and routes each
// result by the nonce it answers.
//
// Each action in flight holds `mawsd` (`hold('op')`) until its result is recorded: lane B's and the endpoint's until
// their answer, lane A's until sminos's result or its channel's close (sminos keeps its result, and a reconnecting device
// asks). `stop()` takes no action more (`restart`) and waits up to STOP_WAIT_MS for those in flight.
import { actionFingerprint, type ActMessage, type RefusalReason } from 'org-protocol';
import type { RemoteChannel } from './channels';
import type { EndpointActions } from './endpoint-actions';
import type { Freshness } from './freshness';
import type { Granted } from './gate';
import { LaneA } from './lane-a';
import { OFFERS, type Offers } from './offers';
import type { Rl10, RpcResult } from './rl10/link';
import { dispatchAs, type EndpointServices } from './services';

export const STOP_WAIT_MS = 2000;

/** `machine` acts whose sealed action the services' ledger does not keep: their args are bulk bytes (P5 O7 M4). */
export const KEPT_WITHOUT_ACTION: ReadonlySet<string> = new Set(['files.upload']);

export type ActionsContext = {
  freshness: Freshness;
  own: EndpointActions;
  rl10: Pick<Rl10, 'draw' | 'rpc' | 'query'>;
  dispatch: EndpointServices['dispatch'];
  hold(reason: string): () => void;
  /** What the engine host's last ledger answer said of its ledger: why it is closed, or null (the status shows it). */
  engineHostLedger?(closed: string | null): void;
  offers?: Offers;
  now(): number;
  log(line: string): void;
};

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
  const outcome = { ...answer };
  delete outcome.ledger;
  return outcome;
}

/** Why the engine host's ledger is closed, as its answer says it (`ledger`, on every answer while it is), or null: open. */
export function closedLedgerOf(value: unknown): string | null {
  return isObject(value) && typeof value.ledger === 'string' ? value.ledger : null;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export class Actions {
  readonly #inflight = new Set<Promise<unknown>>();
  /** Lane A's copies, and whose an op is (lane-a.ts). */
  readonly #laneA: LaneA;
  /** Every hold out for an action in flight; `stop` lets go of those still out once it has waited. */
  readonly #holds = new Set<() => void>();
  #stopping = false;

  constructor(private readonly ctx: ActionsContext) {
    this.#laneA = new LaneA({ rl10: ctx.rl10, hold: (reason) => ctx.hold(reason), now: () => ctx.now() });
  }

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

  /** sminos's result of a lane A action (lane-a.ts). */
  result(result: RpcResult): void {
    this.#laneA.result(result);
  }

  /** Takes no action more and waits, up to STOP_WAIT_MS, for those in flight to record their results. */
  async stop(): Promise<void> {
    this.#stopping = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.allSettled([...this.#inflight]), new Promise<void>((resolve) => (timer = setTimeout(resolve, STOP_WAIT_MS)))]);
    clearTimeout(timer);
    this.#laneA.stop();
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
    if (row.executor === 'main') return refuse('no-ledger');
    const who = { member: channel.member, device: channel.device };
    const dispatch = dispatchAs(this.ctx.dispatch, channel.client);
    const fingerprint = await actionFingerprint(action);
    if (channel.closed) return;

    if (row.executor === 'sminos') {
      const refusal = await this.#laneA.hand(channel, action, who, fingerprint);
      if (refusal !== null) return refuse(refusal);
      accept();
      return;
    }

    if (row.executor === 'endpoint') {
      accept();
      const release = this.#hold();
      try {
        channel.send({ t: 'done', opId: action.opId, outcome: answered(await this.ctx.own.run(action, who, fingerprint, channel)) });
      } finally {
        release();
      }
      return;
    }

    if (row.executor === 'machine' || row.executor === 'pty-host') {
      accept();
      const release = this.#hold();
      try {
        const kept = row.executor === 'pty-host' || KEPT_WITHOUT_ACTION.has(action.action) ? {} : { action };
        const op = { opId: action.opId, opCreated: action.opCreated, claim: { ...who, fingerprint }, name: action.action, input: action.args, ...kept };
        const answer = row.executor === 'machine' ? await dispatch('machine', 'machine.op', op) : await dispatch('pty-host', 'pty.op', op);
        // A pty host older than `pty.op` (adopted by a newer mawsd) knows no ledger: nothing ran, ask again later.
        const outcome = answer.ok ? answered(answer.value) : row.executor === 'pty-host' && answer.error.code === 'unknown_command' ? { state: 'refused', reason: 'unavailable' } : { state: 'unknown', reason: answer.error.code };
        channel.send({ t: 'done', opId: action.opId, outcome });
      } finally {
        release();
      }
      return;
    }

    // Lane B: the context the action was sealed for is the session's now, checked here and again at the claim.
    const context = action.context;
    const appSessionId = decision.target?.lane === 'B' ? decision.target.appSessionId : undefined;
    if (context?.lane !== 'B' || appSessionId === undefined) return refuse('malformed');
    const status = await dispatch('engine-host', 'session.status', { appSessionId });
    if (!status.ok) return refuse(status.error.code === 'host_unavailable' || status.error.code === 'timeout' ? 'unavailable' : 'context');
    const now = isObject(status.value) ? status.value : {};
    // The engine session authorization placed (the index's) must be the one running, else the index lags a change of it.
    if (now.engineSessionId !== decision.target?.session) return refuse('unavailable');
    if (now.launchId !== context.launchId || now.engineSessionId !== context.engineSessionId) return refuse('context');
    if (channel.closed) return;
    accept();
    const release = this.#hold();
    try {
      const answer = await dispatch('engine-host', 'host.op', {
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
