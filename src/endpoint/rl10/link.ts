// RL10, the endpoint's side of its conversation with the sminos daemon (O10 M6; Interfaces §D): the endpoint stands
// where the hub stood for sminos. It serves only while the machine is enrolled and `org-listed` (`serve` / `unserve`,
// which the module calls as the machine's standing comes and goes): before that no `welcome` exists to give, and a
// sminos that met one would cut its machine over before its owner enrolled it.
//
// The hello. sminos's first line carries the token; its `policy` is taken only while the endpoint holds none. The
// welcome answers with the machine's identity under the head (`org`, `hub`, `name`, `former` as names, `ref`,
// `enrolled`), the policy and the head's version; then the head's whole revocation set, the org directory, and, while
// no legacy key is held, `legacy-key?`. After each welcome sminos restates its session-lane state whole and closes it
// with `restated {}`, and the restatement replaces what was held (members.ts); the endpoint restates its revocation
// set and directory whenever the head changes them.
//
// What sminos sends:
//   - the log plane (`hello`, `events`, `rejected`), relayed to RL1 (log-relay.ts);
//   - the session lane, which stops here and never reaches the hub: `member` and `restated` (members.ts), `pending`
//     (M3's notify counts), and `session` messages of every DX4 kind: a `machine` presence gives its project's
//     checkouts, a sub-less `host` is a to-human event (M3's `wrote`, once per `(writer, seq)`, durably), and every
//     message goes to the session listeners (M8's subscriptions);
//   - `words?`, answered `words` (words.ts); `policy-set`, the policy changed and restated; `legacy-key`, kept;
//   - `rpc-result`, handed to the result listeners (M7) and acknowledged `rpc-ack {opId, nonce}`; `queried` and
//     `tombstoned`, the answers to `query` and `tombstone`.
//
// What the endpoint sends besides: lane A actions as DX2's `rpc` (`rpc()`, M7's to call), `query` and `tombstone`
// (answered within `ANSWER_MS`, else `unavailable`), M8's session-lane requests (`send`), and the policy at each change.
import type { Action, Certificates, OrgState, SigningKey } from 'org-protocol';
import type { EndpointPolicy, Policy } from '../policy';
import { isCeiling } from '../policy';
import type { LogProject } from '../hub-link';
import type { SessionLaneMessage } from '../notify';
import type { EndpointState } from '../state/store';
import { InboundIndex } from './inbound-index';
import { LegacyKey } from './legacy';
import { LogRelay } from './log-relay';
import { Members, type MembersContext } from './members';
import { formerNames, orgDirectory, revocationSet, type RevocationSet } from './org-directory';
import { RL10_PROTOCOL, Rl10Server, type Frame, type Rl10Connection } from './server';
import { SignatureLedger } from './signature-ledger';
import { decideWords } from './words';

/** How long a `query` or `tombstone` waits for sminos's answer before it is `unavailable`. */
export const ANSWER_MS = 10_000;

/** sminos's `opId` shape (`OP_ID_RE`): sminos answers nothing for another, so none is sent. */
export const OP_ID = /^[A-Za-z0-9_-]{16,128}$/;

export type Identity = { org: string; hub: string; name: string; ref: string; enrolled: string };

export type Rl10Context = {
  /** The module's state directory, once started. */
  stateDir(): string;
  build: string;
  state(): EndpointState | null;
  /** The head and certificates; null before the first sync. */
  head(): { state: OrgState; certificates: Certificates } | null;
  identity(): Identity | null;
  key(): { key: SigningKey; keyId: string } | null;
  policy: EndpointPolicy;
  hub: { openProject(project: string, handler: LogProject): () => void; send(frame: Frame): boolean };
  /** M3's listings and notify, which the session lane feeds. */
  listings: MembersContext['listings'] & { refresh(): Promise<void>; listedSessions(): readonly string[] };
  notifier: { pendingSet(project: string, raised: ReadonlyArray<{ session: string }>): void; hostMessage(message: SessionLaneMessage): void; forget(session: string): void };
  machineOwners(): Promise<string[]>;
  dispatch: MembersContext['dispatch'];
  now(): number;
  log(line: string): void;
};

/** A lane A action's result, as sminos reports it. */
export type RpcResult = { project: string; opId?: string; nonce: string; outcome: unknown };
export type QueryAnswer = { state: string } & Record<string, unknown>;

type Waiting = { resolve(answer: QueryAnswer): void; timer: ReturnType<typeof setTimeout> };

export class Rl10 {
  readonly members: Members;
  readonly relay: LogRelay;
  readonly legacy: LegacyKey;
  readonly #ctx: Rl10Context;
  readonly #server: Rl10Server;
  readonly #ledger: SignatureLedger;
  readonly #index: InboundIndex;
  readonly #results = new Set<(result: RpcResult) => void>();
  readonly #sessions = new Set<(message: SessionLaneMessage) => void>();
  readonly #queries = new Map<string, Waiting[]>();
  readonly #tombstones = new Map<string, Waiting[]>();
  readonly #said = new Set<string>();
  /** What this connection was last told of the head (a restatement goes only when it changed). */
  #told: { revoked: string; org: string } | null = null;
  #welcomed = false;
  #wanted = false;
  #changing: Promise<void> = Promise.resolve();

  constructor(ctx: Rl10Context) {
    this.#ctx = ctx;
    const sub = (name: string) => () => {
      const state = ctx.state();
      if (state === null) throw new Error('the endpoint has not started');
      return state.subdirectory(name);
    };
    this.#ledger = new SignatureLedger(sub('signatures'));
    this.#index = new InboundIndex(sub('inbound'), ctx.now);
    this.legacy = new LegacyKey(ctx.state);
    this.members = new Members({ dispatch: ctx.dispatch, listings: ctx.listings, listed: () => ctx.listings.listedSessions(), forget: (s) => ctx.notifier.forget(s), log: ctx.log, now: ctx.now });
    this.relay = new LogRelay({
      org: () => {
        const head = ctx.head();
        const identity = ctx.identity();
        return head === null || identity === null ? null : { head: head.state, certificates: head.certificates, ref: identity.ref, name: identity.name };
      },
      key: ctx.key,
      members: this.members,
      ledger: this.#ledger,
      index: this.#index,
      legacy: this.legacy,
      hub: ctx.hub,
      toSminos: (frame) => this.send(frame),
      opened: () => void ctx.listings.refresh(),
      now: ctx.now,
      log: ctx.log,
    });
    this.#server = new Rl10Server({
      stateDir: ctx.stateDir,
      build: ctx.build,
      log: ctx.log,
      handlers: { hello: (c, f) => this.#hello(c, f), frame: (c, f) => this.#frame(c, f), closed: () => this.#closed() },
    });
    ctx.policy.onChange((policy) => this.send({ t: 'policy', read_only: policy.read_only, ceiling: policy.ceiling }));
  }

  /** Whether RL10 is wanted served (the last `serve` or `unserve` called); the socket follows, one change at a time. */
  get serving(): boolean {
    return this.#wanted;
  }

  /** Whether a sminos is connected and welcomed. */
  get connected(): boolean {
    return this.#server.current !== null && this.#welcomed;
  }

  /** Serves RL10 (the machine is enrolled and listed); a failure is logged and leaves it unserved. */
  serve(): Promise<void> {
    this.#wanted = true;
    return this.#change();
  }

  /** Stops serving: the connection closes, the socket and `rl10.json` go. */
  unserve(): Promise<void> {
    this.#wanted = false;
    return this.#change();
  }

  /** Brings the socket to what is wanted, after any change in flight. */
  #change(): Promise<void> {
    this.#changing = this.#changing.then(async () => {
      try {
        if (this.#wanted) await this.#server.serve();
        else {
          await this.#server.close();
          this.#closed();
        }
      } catch (error) {
        this.#ctx.log(`endpoint: RL10 could not be ${this.#wanted ? 'served' : 'closed'}: ${(error as Error).message}`);
      }
    });
    return this.#changing;
  }

  /** A frame down to sminos; dropped while none is connected. */
  send(frame: object): void {
    if (this.#welcomed) this.#server.current?.send(frame);
  }

  /**
   * A new head or certificate set: the revocation set and the directory restated where they changed (first, so a
   * revocation reaches sminos before what the new head lets through), then the arriving events held for it judged again.
   */
  async adopted(): Promise<void> {
    if (!this.#welcomed) return;
    await this.#restate(false);
    await this.relay.retry();
  }

  /** An RL1 connection was welcomed (the log relay checks what the hub holds). */
  hubWelcomed(): void {
    this.relay.hubWelcomed();
  }

  // ---- M7's and M8's seams ----------------------------------------------------------------------------------------

  /** Each `rpc-result` sminos reports (M7 answers the device by its opId); acknowledged after the listeners ran. */
  onResult(listener: (result: RpcResult) => void): () => void {
    this.#results.add(listener);
    return () => this.#results.delete(listener);
  }

  /** Each session-lane message (M8's subscriptions read them). */
  onSession(listener: (message: SessionLaneMessage) => void): () => void {
    this.#sessions.add(listener);
    return () => this.#sessions.delete(listener);
  }

  /**
   * An authorized lane A action down as DX2's `rpc` (Interfaces §D), or why it can't go: `unavailable` with no sminos
   * connected, no member for its session, or a member with no `launch` (no bridge to fence it: sminos would refuse it
   * unfenced anyway), or a spawn whose checkout no presence lists; `malformed` when the action's own session, context or
   * digest disagree with its args.
   */
  rpc(action: Action, who: { member: string; device: string }, fingerprint: string): { ok: true; frame: Frame } | { ok: false; reason: 'unavailable' | 'malformed' } {
    const identity = this.#ctx.identity();
    if (!this.connected || identity === null || !action.action.startsWith('sminos.')) return { ok: false, reason: 'unavailable' };
    const name = action.action.slice('sminos.'.length);
    const args = action.args;
    let project: string | null;
    if (name === 'spawn') {
      project = typeof args.checkout === 'string' ? this.members.projectOfCheckout(args.checkout) : null;
    } else {
      const session = args.session;
      if (typeof session !== 'string') return { ok: false, reason: 'malformed' };
      const digest = (args as { digest?: unknown }).digest;
      if (action.session !== undefined && action.session !== session) return { ok: false, reason: 'malformed' };
      if (action.context !== undefined && (action.context.lane !== 'A' || action.context.session !== session)) return { ok: false, reason: 'malformed' };
      if (action.requestDigest !== undefined && JSON.stringify(action.requestDigest) !== JSON.stringify(digest)) return { ok: false, reason: 'malformed' };
      const member = this.members.get(session);
      if (member === null || member.lane !== 'A' || member.launch === undefined) return { ok: false, reason: 'unavailable' };
      project = member.project;
    }
    if (project === null) return { ok: false, reason: 'unavailable' };
    const rpc = {
      rpc: name,
      project,
      machine: identity.name,
      member: who.member,
      device: who.device,
      created: action.created,
      nonce: action.nonce,
      opId: action.opId,
      opCreated: action.opCreated,
      args,
      ...(action.context === undefined ? {} : { context: action.context }),
      fingerprint,
      ...(name === 'spawn' ? { proof: action } : {}),
    };
    const frame = { t: 'rpc', rpc };
    this.send(frame);
    return { ok: true, frame };
  }

  /** sminos's ledger answer for an op (`query`), or `unavailable` when it can't answer within `ANSWER_MS`. */
  query(opId: string, opCreated?: string): Promise<QueryAnswer> {
    return this.#ask(this.#queries, opId, { t: 'query', opId, ...(opCreated === undefined ? {} : { opCreated }) });
  }

  /** sminos's tombstone of an op (`tombstone`): `{ok}` and the state it holds, or `unavailable` past `ANSWER_MS`. */
  tombstone(opId: string, opCreated?: string): Promise<QueryAnswer> {
    return this.#ask(this.#tombstones, opId, { t: 'tombstone', opId, ...(opCreated === undefined ? {} : { opCreated }) });
  }

  #ask(waiting: Map<string, Waiting[]>, opId: string, frame: Frame): Promise<QueryAnswer> {
    if (!OP_ID.test(opId) || !this.connected) return Promise.resolve({ state: 'unavailable' });
    return new Promise((resolve) => {
      const entry: Waiting = {
        resolve,
        timer: setTimeout(() => {
          const left = (waiting.get(opId) ?? []).filter((w) => w !== entry);
          if (left.length > 0) waiting.set(opId, left);
          else waiting.delete(opId);
          resolve({ state: 'unavailable' });
        }, ANSWER_MS),
      };
      entry.timer.unref?.();
      waiting.set(opId, [...(waiting.get(opId) ?? []), entry]);
      this.send(frame);
    });
  }

  #answered(waiting: Map<string, Waiting[]>, frame: Frame): void {
    if (typeof frame.opId !== 'string') return;
    const entries = waiting.get(frame.opId) ?? [];
    waiting.delete(frame.opId);
    const answer: Record<string, unknown> = { ...frame };
    delete answer.t;
    delete answer.opId;
    for (const entry of entries) {
      clearTimeout(entry.timer);
      entry.resolve({ state: typeof answer.state === 'string' ? answer.state : 'unavailable', ...answer });
    }
  }

  // ---- A connection -----------------------------------------------------------------------------------------------

  async #hello(connection: Rl10Connection, hello: Frame): Promise<void> {
    const protocol = hello.protocol as { major?: unknown } | undefined;
    const identity = this.#ctx.identity();
    const head = this.#ctx.head();
    if (protocol?.major !== RL10_PROTOCOL.major || identity === null || head === null) {
      connection.send({ t: 'refuse', reason: protocol?.major !== RL10_PROTOCOL.major ? 'protocol' : 'not-enrolled' });
      return connection.close();
    }
    const policy = readPolicy(hello.policy);
    if (policy !== null) this.#ctx.policy.fromSminos(policy);
    // A connection replaced: what the last one held open on RL1 closes, and is opened again by this one's hellos.
    this.relay.closeAll();
    this.#told = null;
    const current = this.#ctx.policy.current();
    connection.send({
      t: 'welcome',
      protocol: RL10_PROTOCOL,
      capabilities: [],
      build: this.#ctx.build,
      identity: { org: identity.org, hub: identity.hub, name: identity.name, former: formerNames(head.state, identity.ref, identity.name), ref: identity.ref, enrolled: identity.enrolled },
      policy: { read_only: current.read_only, ceiling: current.ceiling },
      stateVersion: head.state.version,
    });
    this.#welcomed = true;
    await this.#restate(true);
    if (!this.legacy.held) this.send({ t: 'legacy-key?' });
    this.members.welcome();
  }

  #closed(): void {
    this.#welcomed = false;
    this.members.stop();
    this.#told = null;
    this.relay.closeAll();
    for (const waiting of [this.#queries, this.#tombstones]) {
      for (const entries of waiting.values()) {
        for (const entry of entries) {
          clearTimeout(entry.timer);
          entry.resolve({ state: 'unavailable' });
        }
      }
      waiting.clear();
    }
  }

  /** The revocation set and the directory, sent when `always` or when they changed since this connection was told. */
  async #restate(always: boolean): Promise<void> {
    const head = this.#ctx.head();
    if (head === null) return;
    const revoked: RevocationSet = await revocationSet(head.state, head.certificates);
    const org = orgDirectory(head.state, head.certificates, new Date(this.#ctx.now()), (name) => this.relay.seen(name));
    const told = { revoked: JSON.stringify(revoked), org: JSON.stringify(org) };
    if (always || this.#told?.revoked !== told.revoked) this.send({ t: 'revoked', ...revoked });
    if (always || this.#told?.org !== told.org) this.send(org);
    this.#told = told;
  }

  async #frame(connection: Rl10Connection, frame: Frame): Promise<void> {
    if (!this.#welcomed || connection !== this.#server.current) return;
    switch (frame.t) {
      case 'hello':
        return this.relay.hello(frame);
      case 'events':
        return this.relay.events(frame);
      case 'rejected':
        return this.relay.rejected(frame);
      case 'member':
        return this.members.member(frame);
      case 'restated':
        return this.members.restated();
      case 'pending':
        return this.#pending(frame);
      case 'session':
        return this.#session(frame.message);
      case 'words?':
        return this.#words(frame);
      case 'rpc-result':
        return this.#result(frame);
      case 'queried':
        return this.#answered(this.#queries, frame);
      case 'tombstoned':
        return this.#answered(this.#tombstones, frame);
      case 'policy-set':
        return this.#policySet(frame);
      case 'legacy-key':
        return this.#legacyKey(frame);
      default:
        if (!this.#said.has(frame.t)) {
          this.#said.add(frame.t);
          this.#ctx.log(`endpoint: sminos sent an RL10 \`${frame.t.slice(0, 32)}\` frame, which this endpoint doesn't know; ignored`);
        }
    }
  }

  #pending(frame: Frame): void {
    const { project, raised } = frame;
    if (typeof project !== 'string' || !Array.isArray(raised)) return this.#ctx.log('endpoint: an RL10 pending frame that is not one was ignored');
    this.#ctx.notifier.pendingSet(project, raised.filter((r): r is { session: string } => typeof r === 'object' && r !== null && typeof (r as { session?: unknown }).session === 'string'));
  }

  #session(raw: unknown): void {
    if (typeof raw !== 'object' || raw === null) return;
    const message = raw as SessionLaneMessage & Record<string, unknown>;
    if (typeof message.kind !== 'string' || typeof message.project !== 'string') return this.#ctx.log('endpoint: an RL10 session message that is not one was ignored');
    if (message.kind === 'machine' && message.session === null) this.members.presence(message.project, message.body);
    if (message.kind === 'host' && message.sub === null && this.#newHost(message)) this.#ctx.notifier.hostMessage(message);
    for (const listener of this.#sessions) {
      try {
        listener(message);
      } catch (error) {
        this.#ctx.log(`endpoint: a session-lane listener failed: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Whether a sub-less host message is one not taken before (by its event's `(writer, seq)` in its project's host store,
   * against the durable mark, `hosts.json`); a new one moves the mark.
   */
  #newHost(message: SessionLaneMessage): boolean {
    const event = (message.body as { event?: { writer?: unknown; seq?: unknown } } | null)?.event;
    const state = this.#ctx.state();
    if (state === null || typeof event?.writer !== 'string' || !Number.isSafeInteger(event.seq)) return true;
    const held = state.hosts[message.project] ?? {};
    if ((held[event.writer] ?? 0) >= (event.seq as number)) return false;
    state.setHosts({ ...state.hosts, [message.project]: { ...held, [event.writer]: event.seq as number } });
    return true;
  }

  async #words(frame: Frame): Promise<void> {
    if (typeof frame.id !== 'string') return;
    const head = this.#ctx.head();
    const identity = this.#ctx.identity();
    const verdict = await decideWords(
      {
        org: () => (head === null || identity === null ? null : { head: head.state, certificates: head.certificates, ref: identity.ref }),
        machineOwners: this.#ctx.machineOwners,
        members: this.members,
        ledger: this.#ledger,
        index: this.#index,
        now: this.#ctx.now,
      },
      frame,
    );
    this.send({ t: 'words', id: frame.id, verdict });
  }

  #result(frame: Frame): void {
    if (typeof frame.project !== 'string' || typeof frame.nonce !== 'string') return this.#ctx.log('endpoint: an RL10 rpc-result that is not one was ignored');
    const result: RpcResult = { project: frame.project, ...(typeof frame.opId === 'string' ? { opId: frame.opId } : {}), nonce: frame.nonce, outcome: frame.outcome };
    for (const listener of this.#results) {
      try {
        listener(result);
      } catch (error) {
        this.#ctx.log(`endpoint: an rpc-result listener failed: ${(error as Error).message}`);
      }
    }
    this.send({ t: 'rpc-ack', ...(result.opId === undefined ? {} : { opId: result.opId }), nonce: result.nonce });
  }

  #policySet(frame: Frame): void {
    const change: Partial<Policy> = {};
    if (typeof frame.read_only === 'boolean') change.read_only = frame.read_only;
    if (typeof frame.ceiling === 'string' && isCeiling(frame.ceiling)) change.ceiling = frame.ceiling;
    if (Object.keys(change).length === 0) return this.#ctx.log('endpoint: an RL10 policy-set with nothing to set was ignored');
    // The change is written, and every listener (this connection's `policy` among them) told.
    this.#ctx.policy.set(change);
  }

  async #legacyKey(frame: Frame): Promise<void> {
    const identity = this.#ctx.identity();
    if (identity === null) return;
    const kept = this.legacy.take(frame, identity.org);
    this.#ctx.log(kept === 'kept' ? 'endpoint: the legacy org key is kept (handed over by sminos)' : `endpoint: a legacy org key sminos sent was not kept (${kept})`);
    // v1 events held for want of the key can be checked now.
    if (kept === 'kept') await this.relay.retry();
  }
}

function readPolicy(value: unknown): Policy | null {
  if (typeof value !== 'object' || value === null) return null;
  const { read_only, ceiling } = value as { read_only?: unknown; ceiling?: unknown };
  return typeof read_only === 'boolean' && typeof ceiling === 'string' && isCeiling(ceiling) ? { read_only, ceiling } : null;
}
