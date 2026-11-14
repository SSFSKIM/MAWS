// Actions to their executing side (O10 M7; RL4, RL §4.7; Interfaces §B, §H). An `act` is checked at the endpoint, then
// handed to the side that runs it, which keeps the one durable ledger for its `opId`, bound to the operation and its
// sender; the endpoint keeps none for others' actions (only freshness.ts's nonce window).
//
// The endpoint's checks, in order, the first refusal answering `ack {state: 'refused', reason}`:
//   1. freshness and replay (freshness.ts: `stale`, `malformed`, `expired`, `replayed`), before anything is read;
//   2. authorization (M5's gate, which calls `execute` with what it decided). The action's fingerprint is taken before
//      it is decided (P5 O7 M5a fix wave 1), so `execute` hands a lane B, machine, pty host or artifact act to its ledger
//      with nothing awaited from its decision's continuation, and each asks the decision whether it stands (`stands`)
//      in the step it is accepted and sent, decided again once when it moved: a right withdrawn after that step finds
//      the act on its way, never run on a decision that no longer stood;
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
// P5 O7 M8: a `session.send`'s `uploads` are read into its content after the context check and before the ledger
// (send-uploads.ts), so what the engine host claims and queues is the send with its documents. The claim's fingerprint is
// the sealed action's, which names the uploads: a resealed copy reads them again and the ledger answers it as the first
// (an upload swept between the two, a day after its root's last upload, would refuse the copy `malformed` instead).
//
// P5 O7 M4: a `machine` act goes to `machine.op` with the sealed action beside its claim (`action`), which the services'
// ledger keeps and hands to the handler as the requester's proof (`session.spawn`'s `launchedBy`, RL9's `ownersProof`).
// `files.upload` goes without it: its args are the file's bytes, which the ledger would keep for a day, and the claim's
// fingerprint binds the op to its action already. The services are this build's own, in `mawsd`'s process, so every
// field this build sends (`action`, an upload's `part`, `session.spawn`) is one they read.
//
// Lane A's copies go through lane-a.ts, which asks sminos whose an op is before a first copy goes down and routes each
// result by the nonce it answers, and (UX wave U1a, UC-1) tells this machine's spine `laneA.accepted` when an answer's
// result is `done`.
//
// P5 O7 M5a (M5 "Artifact writes are engine-host acts with no session"): an artifact's write (an engine-host row whose
// target rule is `artifact`) names no session and is sealed with no context, so it goes to the engine host's ledger as
// `host.artifactOp` (ARTIFACT_OP): the claim's fields and `target`, the artifact authorization placed (`artifact:<id>`,
// `artifact:` for the orphan form), which the ledger keeps and `host.opQuery` answers, so a query re-places the artifact
// (queries.ts); no status is read, the rule having placed the target. Its `input` is the action's `args` as sealed, in the
// bytes codec's tagged form for a device that carries bytes (the ledger decodes its own copy). An engine host that
// predates the command answers `unknown_command` (its runtime: a name outside its registry): nothing ran, and the act is
// `refused {reason: 'unavailable'}`, logged, until the host is replaced. Every `done` result goes to a device that listed
// `rl2.bytes` tagged (bytes.ts). An artifact act's result tells its sender nothing of a session they don't view
// (session-safe.ts, P5 O7 M5a2 fix wave 1).
//
// P5 O7 M5c: a `machine` act on the `artifact` rule (a lease's `connectors.call` and `refresh`, Send to's `delivery.send`
// and `cancel`) is claimed with the artifact authorization placed (the claim's `target`, `artifact:<id>`), so a query
// re-places it as an artifact write's is; a `delivery.send` handed on is kept with its artifact for its cancel (leases.ts);
// and its result tells the sender nothing of a session (session-safe.ts: a call's `via.sessionId`).
//
// P5 O7 M5c review 1: a `delivery.send` is pending on its channel from the step it is received (leases.ts), so a cancel
// the device sends while the send is decided is placed on it. Such a cancel, once decided, waits on its send and is
// handed on in the step the send is admitted, before the send; a send refused, its waiting cancel is refused
// `no-target`. A cancel goes to the machine only for a run its channel holds reserved. Every refusal of a received act
// (the gate's, through `refused`, and this module's own) settles its pending send.
//
// Each action in flight holds `mawsd` (`hold('op')`) until its result is recorded: lane B's and the endpoint's until
// their answer, lane A's until sminos's result or its channel's close (sminos keeps its result, and a reconnecting device
// asks). `stop()` takes no action more (`restart`) and waits up to STOP_WAIT_MS for those in flight.
import { actionFingerprint, type ActMessage, type RefusalReason } from 'org-protocol';
import { DRAIN_REPLIES } from '@shared/host/host-supervisor'; // UX wave U9: a completion's act reads no status
import type { ArtifactTarget } from './authorize';
import { doneMessage } from './bytes';
import type { RemoteChannel } from './channels';
import type { EndpointActions } from './endpoint-actions';
import type { Freshness } from './freshness';
import type { Granted } from './gate';
import type { Leases } from './leases';
import { DECISION_MOVED, LaneA } from './lane-a';
import { OFFERS, type Offers } from './offers';
import type { Rl10, RpcResult } from './rl10/link';
import { readSendUploads } from './send-uploads';
import { dispatchAs, type EndpointServices } from './services';
import type { SessionSafe } from './session-safe';

export const STOP_WAIT_MS = 2000;

/**
 * `machine` acts whose sealed action the services' ledger does not keep: their args are bulk bytes (P5 O7 M4), or (P5 O8
 * M6a) a composer's draft, written at each pause in the typing, which no handler reads a proof from.
 */
export const KEPT_WITHOUT_ACTION: ReadonlySet<string> = new Set(['files.upload', 'session.drafts.set']);
/** The setup acts that read in their checked directory, and so take the asking member's opens with it. */
const OPENED_ACTS: ReadonlySet<string> = new Set(['session.projects.addFolder', 'session.projects.relocate']);

/**
 * P5 O7 M5a: the engine host's ledger command for an act with no session (an artifact's write), and the answer of a host
 * that predates it, which the act reads as `refused unavailable`.
 */
export const ARTIFACT_OP = { name: 'host.artifactOp', predates: 'unknown_command' } as const;

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
  /** P5 O7 M5a2 fix wave 1: what an artifact act's result says of sessions (session-safe.ts). */
  sessionSafe?: SessionSafe;
  /** P5 O7 M5c: the runs each channel sent, for their cancel (leases.ts); review 1: the sends still being decided. */
  leases?: Pick<Leases, 'reserveRun' | 'sendEnded' | 'pendRun' | 'holdCancel' | 'sendRefused' | 'reserved'>;
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
/** P5 O7 M5c: the run a `delivery.send` or `delivery.cancel` names, or null. */
const runIdOf = (args: unknown): string | null => (isObject(args) && typeof args.runId === 'string' ? args.runId : null);

/** P5 O7 M5a: the prefix of the target a claim stores for an artifact act, which a query reads back (queries.ts). */
export const ARTIFACT_TARGET = 'artifact:';
/** The target an artifact act's claim stores: `artifact:<id>`, `artifact:` for the orphan form. */
const artifactTarget = ({ artifactId }: ArtifactTarget): string => `${ARTIFACT_TARGET}${artifactId ?? ''}`;

export class Actions {
  readonly #inflight = new Set<Promise<unknown>>();
  /** Lane A's copies, and whose an op is (lane-a.ts). */
  readonly #laneA: LaneA;
  /** Every hold out for an action in flight; `stop` lets go of those still out once it has waited. */
  readonly #holds = new Set<() => void>();
  #stopping = false;
  /** Each received action's fingerprint, taken before its decision (`receive`), read by `execute`. */
  readonly #fingerprints = new WeakMap<ActMessage, string>();
  /** Each received action's way back to authorization, taken once (a lane B act whose decision moved under its status read). */
  readonly #decideAgain = new WeakMap<ActMessage, () => void>();
  /** P5 O7 M5c review 1: each received `delivery.send` still pending (leases.ts' `pendRun`), until it is admitted or refused. */
  readonly #pending = new WeakSet<ActMessage>();

  constructor(private readonly ctx: ActionsContext) {
    this.#laneA = new LaneA({
      rl10: ctx.rl10,
      hold: (reason) => ctx.hold(reason),
      now: () => ctx.now(),
      // UX wave U1a (UC-1, Interfaces §B): this machine's lane A list hides an answer sminos took, before its settlement
      accepted: async (session, request) => {
        const told = await ctx.dispatch('machine', 'laneA.accepted', { session, request });
        if (!told.ok) throw new Error(`${told.error.code}: ${told.error.message}`);
      },
      log: (line) => ctx.log(line),
    });
  }

  /** The channel's `act` route: freshness and replay, then `authorized` (the gate, which calls `execute`). */
  receive(channel: RemoteChannel, m: ActMessage, authorized: (channel: RemoteChannel, m: ActMessage) => void): void {
    const refusal = this.#stopping ? 'restart' : this.ctx.freshness.check(m.action, channel.device, this.ctx.now());
    if (refusal !== null) return void channel.send({ t: 'ack', opId: m.action.opId, state: 'refused', reason: refusal });
    // P5 O7 M5c review 1: a send is pending from here, so its channel's cancel is placed on it while it is decided; one
    // past the channel's bound, or a second of an id pending, is `busy` at once
    const runId = m.action.action === 'delivery.send' ? runIdOf(m.action.args) : null;
    const artifactId = runId !== null && isObject(m.action.args) && typeof m.action.args.artifactId === 'string' ? m.action.args.artifactId : null;
    if (this.ctx.leases !== undefined && runId !== null && artifactId !== null) {
      if (!this.ctx.leases.pendRun(channel, runId, artifactId)) return void channel.send({ t: 'ack', opId: m.action.opId, state: 'refused', reason: 'busy' });
      this.#pending.add(m);
    }
    const fingerprinted = actionFingerprint(m.action).then(
      (fingerprint) => {
        if (channel.closed) return;
        if (this.#stopping) return this.refused(channel, m, 'restart');
        this.#fingerprints.set(m, fingerprint);
        this.#decideAgain.set(m, () => authorized(channel, m));
        authorized(channel, m);
      },
      (error: unknown) => {
        this.ctx.log(`endpoint: an action on channel ${channel.key} could not be fingerprinted: ${(error as Error).message}`);
        if (!channel.closed) this.refused(channel, m, 'unavailable');
      },
    );
    this.#track(fingerprinted);
  }

  /**
   * A received action refused (the gate's `actRefused` executor, and this module's own refusals): answered, and a send
   * still pending settled, its waiting cancel refused with it (P5 O7 M5c review 1).
   */
  refused(channel: RemoteChannel, m: ActMessage, reason: string): void {
    channel.send({ t: 'ack', opId: m.action.opId, state: 'refused', reason });
    if (this.#pending.delete(m)) this.ctx.leases?.sendRefused(channel, runIdOf(m.action.args)!);
  }

  /** An authorized action, handed to its executing side (the gate's `act` executor). */
  execute(channel: RemoteChannel, m: ActMessage, decision: Granted): void {
    const progress = { accepted: false };
    const run = this.#execute(channel, m, decision, progress).catch((error: unknown) => {
      this.ctx.log(`endpoint: an action on channel ${channel.key} failed on its way to its executor: ${(error as Error).message}`);
      // Handed on already, its fate is the executor's to say: the device asks by `query`.
      if (progress.accepted) channel.send({ t: 'done', opId: m.action.opId, outcome: { state: 'unknown', reason: 'internal' } });
      else this.refused(channel, m, 'unavailable');
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
    const refuse = (reason: RefusalReason) => this.refused(channel, m, reason);
    const accept = () => {
      progress.accepted = true;
      channel.send({ t: 'ack', opId: action.opId, state: 'accepted' });
    };
    const offers = this.ctx.offers ?? OFFERS;
    const row = Object.hasOwn(offers.commands, action.action) ? offers.commands[action.action] : undefined;
    if (row === undefined) return refuse('not-offered');
    if (row.executor === 'main') return refuse('no-ledger');
    const who = { member: channel.member, device: channel.device };
    // P5 O8 M6a: a `machine` act's claimed run reads and writes as the decision's reader (readers.ts), a draft its writer's own
    const dispatch = dispatchAs(this.ctx.dispatch, channel.client, decision.reader);
    // Taken before the decision (`receive`): nothing is awaited from the decision to the ledger's dispatch.
    const fingerprint = this.#fingerprints.get(m);
    if (fingerprint === undefined) return refuse('unavailable');
    // The gate hands the act on in a later continuation than its decision's, and no executor takes this decision again:
    // it is asked whether it still stands before any branch, and taken again once when it moved
    // (P5 O7 M5a's milestone review). Nothing is awaited from here to a branch's `accept()` but its own work, after
    // which the lane B and artifact branches ask again.
    if (decision.stands?.() === false) return this.#again(m, refuse);

    if (row.executor === 'sminos') {
      // Its own waits (its turn, sminos's admission query) end in the step the copy goes down: a decision that moved
      // meanwhile is taken again, as lane B's after its status read.
      // P5 O8 M6b: a record act on the session its decision placed it on (`no-session` past RL4's vocabulary: rl10/link.ts)
      const refusal = await this.#laneA.hand(channel, action, who, fingerprint, () => decision.stands?.() !== false, decision.target);
      if (refusal === DECISION_MOVED) return this.#again(m, refuse);
      if (refusal !== null) return this.refused(channel, m, refusal);
      accept();
      return;
    }

    if (row.executor === 'endpoint') {
      accept();
      const release = this.#hold();
      try {
        channel.send(doneMessage(channel, action.opId, answered(await this.ctx.own.run(action, who, fingerprint, channel))));
      } finally {
        release();
      }
      return;
    }

    if (row.executor === 'machine' || row.executor === 'pty-host') {
      // P5 O7 M5c: an artifact act's claim names the artifact authorization placed.
      const onArtifact = row.executor === 'machine' && row.target === 'artifact';
      if (onArtifact && decision.artifact === undefined) return refuse('malformed');
      // P5 O7 M5c review 1: a cancel goes to the machine only for a run its channel holds reserved; one of a send still
      // being decided waits on it (handed on in the step the send is admitted, refused `no-target` with the send)
      if (action.action === 'delivery.cancel') {
        const cancelled = runIdOf(action.args);
        if (cancelled === null || this.ctx.leases === undefined) return refuse('no-target');
        if (!this.ctx.leases.reserved(channel.client, cancelled)) {
          const waiting = { admit: () => this.execute(channel, m, decision), drop: () => refuse('no-target') };
          return this.ctx.leases.holdCancel(channel, cancelled, waiting) ? undefined : refuse('no-target');
        }
      }
      // A send's run id reserved for this channel and its artifact in the step it is handed on (leases.ts): one any
      // channel holds is `busy`, never moved to another artifact; freed when the machine says the run ended. Its cancel
      // waiting, if any, is handed on in that step, before the send.
      const runId = action.action === 'delivery.send' ? runIdOf(action.args) : null;
      if (runId !== null && (decision.artifact?.artifactId == null || this.ctx.leases?.reserveRun(channel, runId, decision.artifact.artifactId) !== true)) return refuse('busy');
      this.#pending.delete(m);
      accept();
      const release = this.#hold();
      let ended = false;
      try {
        const kept = row.executor === 'pty-host' || KEPT_WITHOUT_ACTION.has(action.action) ? {} : { action };
        const target = onArtifact ? { target: artifactTarget(decision.artifact!) } : {};
        // P5 O7 M9: a setup act runs on the directory the setup policy checked, guarded by the asking member's opens; the
        // sealed action keeps what was signed. The project registry: its other args go as signed (`addFolder`'s `into` and
        // `own`, `relocate`'s row), and the acts that read in the directory take the opens (M9's review 1, F1).
        const setupInput = decision.setup === undefined ? action.args : { ...action.args, directory: decision.setup.directory, ...(OPENED_ACTS.has(action.action) ? { opened: decision.setup.opened } : {}) };
        const input = decision.opened === undefined ? setupInput : { ...setupInput, opened: decision.opened }; // a link's (Fix 1c)
        const op = { opId: action.opId, opCreated: action.opCreated, claim: { ...who, fingerprint, ...target }, name: action.action, input, ...kept };
        const answer = row.executor === 'machine' ? await dispatch('machine', 'machine.op', op) : await dispatch('pty-host', 'pty.op', op);
        // A pty host older than `pty.op` (adopted by a newer mawsd) knows no ledger: nothing ran, ask again later.
        const outcome = answer.ok ? answered(answer.value) : row.executor === 'pty-host' && answer.error.code === 'unknown_command' ? { state: 'refused', reason: 'unavailable' } : { state: 'unknown', reason: answer.error.code };
        // the run ended when its op did (its send answered) or never ran; anything else may still be running
        ended = answer.ok && isObject(answer.value) && (answer.value.state === 'done' || answer.value.state === 'refused');
        const told = onArtifact ? (await this.#sessionSafe(who.member, action.action, outcome, dispatch))() : outcome;
        if (!channel.closed) channel.send(doneMessage(channel, action.opId, told));
      } finally {
        if (runId !== null) this.ctx.leases?.sendEnded(channel, runId, ended);
        release();
      }
      return;
    }

    // P5 O7 M5a: an artifact's write, under the engine host's ledger with the artifact as its target and no session.
    if (row.target === 'artifact') {
      if (decision.artifact === undefined) return refuse('malformed');
      // The gate hands the act on in a later continuation than its decision's, and the engine host's ledger checks no
      // standing: the decision is asked whether it stands in the step the act is accepted and sent, and taken again,
      // once, when it moved meanwhile, `unavailable` when it moved again (the lane B branch's rule).
      if (decision.stands?.() === false) return this.#again(m, refuse);
      accept();
      const release = this.#hold();
      try {
        const answer = await dispatch('engine-host', ARTIFACT_OP.name, {
          opId: action.opId,
          opCreated: action.opCreated,
          member: who.member,
          device: who.device,
          fingerprint,
          target: artifactTarget(decision.artifact),
          name: action.action,
          input: action.args,
        });
        if (answer.ok) this.ctx.engineHostLedger?.(closedLedgerOf(answer.value));
        else if (answer.error.code === ARTIFACT_OP.predates) this.ctx.log(`endpoint: the engine host predates \`${ARTIFACT_OP.name}\`: \`${action.action}\` refused unavailable until it is replaced`);
        const outcome = answer.ok ? answered(answer.value) : answer.error.code === ARTIFACT_OP.predates ? { state: 'refused', reason: 'unavailable' } : { state: 'unknown', reason: answer.error.code };
        const told = (await this.#sessionSafe(who.member, action.action, outcome, dispatch))(); // taken, sent or not
        if (!channel.closed) channel.send(doneMessage(channel, action.opId, told));
      } finally {
        release();
      }
      return;
    }

    // Lane B: the context the action was sealed for is the session's now, checked here and again at the claim.
    const context = action.context;
    const appSessionId = decision.target?.lane === 'B' ? decision.target.appSessionId : undefined;
    if (context?.lane !== 'B' || appSessionId === undefined) return refuse('malformed');
    if (DRAIN_REPLIES.has(action.action)) {
      // UX wave U9 (docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, M1): a completion of the engine host's
      // own request (a pane's answer) reads no status first. During a handover's drain the host that raised the request
      // still holds its call, and the supervisor sends the op there by the completion's route, while a status read waits
      // for the successor, which comes only once that call has settled. The claim checks the context against the session
      // in the host that holds the request; here, only that the action was sealed for the session authorization placed.
      if (context.engineSessionId !== decision.target?.session) return refuse('context');
    } else {
      const status = await dispatch('engine-host', 'session.status', { appSessionId });
      if (!status.ok) return refuse(status.error.code === 'host_unavailable' || status.error.code === 'timeout' ? 'unavailable' : 'context');
      const now = isObject(status.value) ? status.value : {};
      // The engine session authorization placed (the index's) must be the one running, else the index lags a change of it.
      if (now.engineSessionId !== decision.target?.session) return refuse('unavailable');
      if (now.launchId !== context.launchId || now.engineSessionId !== context.engineSessionId) return refuse('context');
    }
    // P5 O7 M8: a send's uploads read into its content here, so the engine host queues the blocks themselves
    // (send-uploads.ts); one the files service refuses is the act's `malformed`, and nothing is queued
    const read = action.action === 'session.send' ? await readSendUploads(action.args, appSessionId, dispatch) : { ok: true as const, args: action.args };
    if (!read.ok) {
      this.ctx.log(`endpoint: a send on channel ${channel.key} was refused ${read.reason}: ${read.why}`);
      return refuse(read.reason);
    }
    if (channel.closed) return;
    // The status read was awaited: the decision is asked whether it stands in the step the act goes to the ledger, and
    // taken again, once, when it moved meanwhile (authorize's own rule), `unavailable` when it moved again.
    if (decision.stands?.() === false) return this.#again(m, refuse);
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
        input: read.args,
        context: { launchId: context.launchId, engineSessionId: context.engineSessionId },
        ...(action.requestDigest === undefined ? {} : { requestDigest: action.requestDigest }),
      });
      if (answer.ok) this.ctx.engineHostLedger?.(closedLedgerOf(answer.value));
      channel.send(doneMessage(channel, action.opId, answer.ok ? answered(answer.value) : { state: 'unknown', reason: answer.error.code }));
    } finally {
      release();
    }
  }

  /** An act whose decision moved before it was handed on: decided again, once, through the gate; then `unavailable`. */
  #again(m: ActMessage, refuse: (reason: RefusalReason) => void): void {
    const again = this.#decideAgain.get(m);
    this.#decideAgain.delete(m);
    return again === undefined ? refuse('unavailable') : again();
  }

  /**
   * P5 O7 M5a2 fix wave 1: an artifact act's outcome as the sender may be told it, its result's sessions they don't view
   * withheld (session-safe.ts), made as it is sent; one the spine can't place is `unknown` (the device asks by `query`).
   */
  async #sessionSafe(member: string, name: string, outcome: unknown, dispatch: EndpointServices['dispatch']): Promise<() => unknown> {
    if (this.ctx.sessionSafe === undefined || !isObject(outcome) || outcome.state !== 'done') return () => outcome;
    try {
      const projected = await this.ctx.sessionSafe.prepare(member, name, outcome.result, dispatch);
      return () => {
        const result = projected();
        return result.ok ? { ...outcome, result: result.output } : { state: 'unknown', reason: 'unavailable' };
      };
    } catch (error) {
      this.ctx.log(`endpoint: the result of \`${name}\` could not be told: ${(error as Error).message}`);
      return () => ({ state: 'unknown', reason: 'unavailable' });
    }
  }

  #track(run: Promise<unknown>): void {
    this.#inflight.add(run);
    void run.finally(() => this.#inflight.delete(run));
  }
}
