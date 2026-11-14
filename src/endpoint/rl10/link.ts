// RL10, the endpoint's side of its conversation with the sminos daemon (O10 M6; Interfaces §D): the endpoint stands
// where the hub stood for sminos. It serves only while the machine is enrolled and `org-listed` (`serve` / `unserve`,
// which the module calls as the machine's standing comes and goes): before that no `welcome` exists to give, and a
// sminos that met one would cut its machine over before its owner enrolled it.
//
// The hello. sminos's first line carries the token; its `policy` is taken only while the endpoint holds none. The
// welcome answers with the machine's identity under the head (`org`, `hub`, `name`, `former` as names, `ref`,
// `enrolled`), the policy and the head's version; then the head's whole revocation set, the org directory, and, while
// no legacy key is held and the org state has not retired it (legacy.ts), `legacy-key?`. After each welcome sminos restates its session-lane state whole and closes it
// with `restated {}`, and the restatement replaces what was held (members.ts); the endpoint restates its revocation
// set and directory whenever the head changes them.
//
// What sminos sends:
//   - the log plane (`hello`, `events`, `rejected`), relayed to RL1 (log-relay.ts); signed uploads wait for the hub
//     link's room in the relay's own capped queue, never holding the frames behind them;
//   - the session lane, which stops here and never reaches the hub: `member` and `restated` (members.ts), `pending`
//     (a project's whole set of requests, for M3's notify counts), and `session` messages of every DX4 kind: a
//     `machine` presence gives its project's checkouts, a sub-less `host` is a to-human event (M3's `wrote`, once per
//     `(writer, seq)`, durably), a sub-less `raised` or `settled` moves its session's notify count by one request
//     between the sets, and every message goes to the session listeners (M8's subscriptions);
//   - `reach?`, answered `reach` (reach.ts, P5 O18 D3), and `snapshots`, the policy cache's rebuild (rebuild.ts);
//   - `words?`, answered `words` (words.ts); `policy-set`, the policy changed and restated; `legacy-key`, kept (logged
//     and dropped once the org state retires the key);
//   - `rpc-result`, handed to the result listeners (M7) and acknowledged `rpc-ack {opId, nonce}`; `queried` and
//     `tombstoned`, the answers to `query` and `tombstone`.
//
// What the endpoint sends besides: lane A actions as DX2's `rpc` (`rpc()`, M7's to call), `query` and `tombstone`
// (answered within `ANSWER_MS`, else `unavailable`), M8's session-lane requests (`send`: `subscribe`, `unsubscribe`,
// `rows`, `diff`, `output`, `read`, fed by `onSession`, `onPending` and `onLink`), and the policy at each change.
//
// Message reach (P5 O18, docs/doperpowers/plans/2026-11-05-p5-o18-message-reach.md D7, D9). The welcome advertises
// `capabilities: ['access', 'reach']`: sminos may send a member's `access`, `shares` and `policyRev`, and ask `reach?`.
// To an sminos whose hello advertises `audience`, the endpoint sends an `audience {session, owners, members, digest,
// policyRev}` for each local session as its record or the head moves, and for each remote session the policy cache
// holds, all of them after each welcome, and asks `snapshots?` while the cache's rebuild is incomplete; to any other,
// neither, and no stream writer goes down (log-relay.ts). Each local session's audience by `policyRev` is kept in the
// cache as its record moves, which an `unlisted` notice is checked against.
//
// Record acts (P5 O8 M6b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M6b and Interfaces §Q, agreed with the
// desk track). The welcome advertises `record` too exactly when this build serves the three `record.*` offers
// (`welcomeCapabilities`): "this machine's sessions can be widened from any member's MAWS through this endpoint", which
// sminos keys its terminal's "use MAWS" on, whether or not the machine has an app. A record act goes down as DX2's `rpc`
// on either lane, its `rpc` keeping the `record.` prefix, only to an sminos whose hello advertised `record` (else
// `not-offered`, nothing sent): its `args` are `{session: <the id keying sminos's record>, …the change}` (lane A the act's
// own `session`; lane B the member the members join placed its `appSessionId` on, which authorization ranked: else
// `no-session`, nothing sent, never queued), its `proof` the act verbatim as signed, and no `context` or `requestDigest`:
// a record act doesn't depend on how the session was launched. Its result comes back as a lane A action's does.
//
// The project registry (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §D). The directory's hub
// projects are the records' (`Rl10Context.registry`). To an sminos whose hello advertises `locations` the welcome
// advertises it too, and every org frame carries `complete` and, once anything is known of them, this machine's
// `locations`; sminos answers each kept frame with `locations-kept {gen}`, which counts only on the connection that
// carried that `gen` (`locationsKept`). Any other sminos is told neither, nor the capability: it reads the frame as before.
import { RL1_CAPABILITIES, type Action, type Certificates, type OrgState, type SigningKey } from 'org-protocol';
import type { EndpointPolicy, Policy } from '../policy';
import { isCeiling } from '../policy';
import type { NewHostEntry } from '@shared/ipc/schema/channel';
import type { LogProject } from '../hub-link';
import type { SessionLaneMessage } from '../notify';
import type { EndpointState } from '../state/store';
import { InboundIndex } from './inbound-index';
import { LegacyKey } from './legacy';
import { localPolicy, digestOf, withdrawnBy, type AudienceContext } from './audiences';
import { LogRelay, type RelayContext } from './log-relay';
import { Members, type MembersContext } from './members';
import { PolicyCache } from './policy-cache';
import { decideReach } from './reach';
import { Rebuild } from './rebuild';
import { formerNames, orgDirectory, revocationSet, type RevocationSet } from './org-directory';
import { RL10_PROTOCOL, Rl10Server, type Frame, type Rl10Connection } from './server';
import { OFFERS, RECORD_ACTS, type Offers } from '../offers';
import type { SessionTarget } from '../sources';
import { SignatureLedger } from './signature-ledger';
import { LOCATIONS_CAPABILITY, type DirectoryPart } from '../registry';
import { decideWords } from './words';

/** What the welcome advertises to sminos (P5 O18 D9): a member frame's `access`, `shares`, `policyRev`, and `reach?`. */
export const RL10_CAPABILITIES = ['access', 'reach'] as const;

/**
 * P5 O8 M6b: the capability of record acts: sminos's hello advertises it once its executors are in, and the endpoint's
 * welcome once this build serves the three `record.*` offers.
 */
export const RECORD_CAPABILITY = 'record';

/** The welcome's capabilities: RL10_CAPABILITIES, and `record` exactly when `offers` serve every record act. */
export function welcomeCapabilities(offers: Offers = OFFERS): string[] {
  return [...RL10_CAPABILITIES, ...(RECORD_ACTS.every((name) => Object.hasOwn(offers.commands, name)) ? [RECORD_CAPABILITY] : [])];
}

/** Why `draw` sends nothing (P5 O8 M6b: `not-offered` and `no-session`, a record act's). */
export type DrawRefusal = 'unavailable' | 'malformed' | 'context' | 'not-offered' | 'no-session';

/** How long a `query` or `tombstone` waits for sminos's answer before it is `unavailable`. */
export const ANSWER_MS = 10_000;

/** sminos's `opId` shape (`OP_ID_RE`): sminos answers nothing for another, so none is sent. */
export const OP_ID = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * The longest text a `send` carries, in UTF-16 code units: MAWS's own limit on a prompt as typed
 * (`session.history.append`), so a text within it is within sminos's bound, which counts code points (O9 M1).
 */
const SEND_TEXT_MAX = 65_536;

/** Whether a `send`'s text is one the endpoint hands on: a string, not blank, within `SEND_TEXT_MAX`. */
const isSendText = (text: unknown): boolean => typeof text === 'string' && text.length <= SEND_TEXT_MAX && text.trim() !== '';

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
  hub: { openProject(project: string, handler: LogProject): () => void; send(frame: Frame): boolean; writable?(): Promise<void>; readonly capabilities?: readonly string[] };
  /** M3's listings and notify, which the session lane feeds. */
  listings: MembersContext['listings'] & { refresh(): Promise<void>; listedSessions(): readonly string[] };
  notifier: {
    pendingSet(project: string, raised: ReadonlyArray<{ session: string; request: string }>): void;
    requestMessage(message: SessionLaneMessage): void;
    hostMessage(message: SessionLaneMessage, sent?: () => void): void;
    forget(session: string): void;
  };
  machineOwners(): Promise<string[]>;
  dispatch: MembersContext['dispatch'];
  /** U9: an operation's hold, around the members' listing rule's reads (MembersContext's `hold`). */
  hold?: MembersContext['hold'];
  /** A read of the hub's org state, asked for an arriving event held for a key it may bring (log-relay.ts). */
  behind?(): void;
  /**
   * P5 O8 M7b: the project channel's journal (`EndpointServices.channel`), which each sub-less host message's to-human
   * entry is handed to (`#host`); absent in a suite that hands nothing on.
   */
  channel?: { record(entry: NewHostEntry): void };
  now(): number;
  log(line: string): void;
  /** The uplink's cap, reserve and ask wait (the suites'; uplink.ts's defaults unless given). */
  uplink?: RelayContext['uplink'];
  /** P5 O8 M6b: the offer table the welcome's `record` follows (the suites' seam; OFFERS unless given). */
  offers?: Offers;
  /** The project registry's parts of the org frame (registry.ts); none: no hub project, no `locations`. */
  registry?: { directory(): DirectoryPart };
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
  readonly #pendings = new Set<(project: string, raised: readonly unknown[]) => void>();
  readonly #links = new Set<(connected: boolean) => void>();
  readonly #projectsMoved = new Set<() => void>();
  /** The highest locations `gen` sent on this connection, and the highest it acknowledged (0 before either). */
  #sentGen = 0;
  #keptGen = 0;
  readonly #kept = new Set<{ gen: number; resolve(kept: boolean): void }>();
  readonly #queries = new Map<string, Waiting[]>();
  readonly #tombstones = new Map<string, Waiting[]>();
  readonly #said = new Set<string>();
  /** P5 O18: the policy cache and its rebuild. */
  readonly cache: PolicyCache;
  readonly #rebuild: Rebuild;
  /** What sminos's hello advertised on this connection (`audience`, P5 O18 D9). */
  #sminos: readonly string[] = [];
  /** Each session's `audience` frame as last sent on this connection, by session. */
  readonly #audienceSent = new Map<string, string>();
  /** What this connection was last told of the head (a restatement goes only when it changed). */
  #told: { revoked: string; org: string } | null = null;
  /** The last restatement queued (`#restate`). */
  #restating: Promise<void> = Promise.resolve();
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
    this.cache = new PolicyCache(sub('policy'), ctx.log);
    this.#index = new InboundIndex(sub('inbound'), ctx.now);
    // The enrollment's org, listed or not, or a pending provisioning's (O14 M1, whose first sync precedes its set): the
    // first sync's head, which an enrollment adopts before it is listed, is one `legacy.json` follows (legacy.ts).
    this.legacy = new LegacyKey(ctx.state, () => {
      const state = ctx.state();
      return ctx.identity()?.org ?? (state?.enrolled ? (state.enrollment?.org ?? null) : (state?.provisioning?.redeemed.org ?? null));
    });
    this.members = new Members({
      dispatch: ctx.dispatch,
      ...(ctx.hold === undefined ? {} : { hold: ctx.hold }),
      listings: ctx.listings,
      listed: () => ctx.listings.listedSessions(),
      forget: (s) => ctx.notifier.forget(s),
      log: ctx.log,
      now: ctx.now,
      // P5 O12 M11: the handed-off mark, in the state directory (`handed-off.json`); unread while the state is refused
      marks: {
        read: () => {
          const state = ctx.state();
          return state === null || state.refusing !== null ? null : state.handedOff;
        },
        write: (marks) => {
          const state = ctx.state();
          if (state === null) throw new Error('the endpoint has not started');
          state.setHandedOff(marks);
        },
      },
    });
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
      behind: () => ctx.behind?.(),
      now: ctx.now,
      log: ctx.log,
      ...(ctx.uplink === undefined ? {} : { uplink: ctx.uplink }),
      cache: this.cache,
      streamsDown: () => this.#streams,
      hubStreams: () => ctx.hub.capabilities?.includes(RL1_CAPABILITIES.audience) === true,
      rebuilding: () => this.#rebuild.incomplete,
      policyChanged: (session) => {
        const remote = this.cache.get(session);
        if (remote !== null) this.#tellAudience(session, { owners: remote.owners, members: remote.audience, policyRev: remote.policyRev });
        this.relay.release();
      },
    });
    this.#rebuild = new Rebuild({
      cache: this.cache,
      send: (frame) => this.send(frame),
      take: (project, events) => this.relay.snapshots(project, events),
      projects: () => this.relay.projects(),
      enabled: () => this.#streams,
      progressed: () => this.relay.release(),
      log: ctx.log,
    });
    this.#server = new Rl10Server({
      stateDir: ctx.stateDir,
      build: ctx.build,
      log: ctx.log,
      handlers: {
        hello: (c, f) => this.#hello(c, f),
        frame: (c, f) => this.#frame(c, f),
        // A connection a newer one replaced closes after the newer one's hello: it ends nothing of the newer one's.
        closed: (c) => {
          const current = this.#server.current;
          if (current === null || current === c) this.#closed();
        },
      },
    });
    ctx.policy.onChange((policy) => this.send({ t: 'policy', read_only: policy.read_only, ceiling: policy.ceiling }));
  }

  /** The kept records were moved aside (`EndpointState.claimRecords`): what was read of them is dropped. */
  forgetRecords(): void {
    this.#ledger.forget();
    this.#index.forget();
    this.cache.forget();
  }

  /** Whether sminos's hello on this connection advertised `audience` (P5 O18 D9). */
  get #streams(): boolean {
    return this.#sminos.includes('audience');
  }

  /** Whether sminos's hello on this connection advertised `locations` (the project registry, §D). */
  get #locations(): boolean {
    return this.#sminos.includes(LOCATIONS_CAPABILITY);
  }

  /** P5 O8 M6b: what the welcomed sminos's hello advertised, null while none is connected and welcomed. */
  sminosCapabilities(): readonly string[] | null {
    return this.connected ? this.#sminos : null;
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
    // A head moves what `@machine` resolves to, so every local audience is stated again where it moved.
    for (const session of this.members.sessions()) await this.#recordMoved(session);
    await this.relay.retry();
  }

  /** An RL1 connection was welcomed (the log relay checks what the hub holds; stream events held for it go up). */
  hubWelcomed(): void {
    this.relay.hubWelcomed();
    if (this.#ctx.hub.capabilities?.includes(RL1_CAPABILITIES.audience) === true) this.relay.release();
  }

  /**
   * A local session's record as it stands (a `member` frame, or a new head): its audience at its `policyRev` kept in the
   * cache's history, and told to sminos when it moved.
   */
  async #recordMoved(session: string): Promise<void> {
    const head = this.#ctx.head();
    const identity = this.#ctx.identity();
    if (head === null || identity === null) return;
    const ctx: AudienceContext = { org: () => ({ head: head.state, certificates: head.certificates, ref: identity.ref }), members: this.members, cache: this.cache, now: this.#ctx.now };
    const policy = await localPolicy(ctx, session);
    if (policy === null) return;
    // What this rev's change withdrew, against the newest rev before it the cache holds (none held: nothing to name).
    const before = this.cache.before(session, policy.policyRev);
    const withdrawn = before === undefined ? [] : withdrawnBy(before.audience, policy.members, head.state.members.map((m) => m.id));
    this.cache.remember(session, policy.policyRev, policy.members);
    this.#tellAudience(session, { ...policy, withdrawn });
  }

  /**
   * An `audience` frame down, when sminos takes them and it differs from the last sent of the session. `withdrawn` (O18
   * M4) names the members the change at this `policyRev` withdrew, the exact audience of its `unlisted` notice, since
   * sminos holds no member list; absent when it withdrew none.
   */
  #tellAudience(session: string, policy: { owners: string[]; members: string[] | null; policyRev: number; withdrawn?: string[] }): void {
    if (!this.#welcomed || !this.#streams) return;
    const withdrawn = policy.withdrawn !== undefined && policy.withdrawn.length > 0 ? { withdrawn: policy.withdrawn } : {};
    const frame = { t: 'audience', session, owners: policy.owners, members: policy.members, digest: digestOf(policy.members), policyRev: policy.policyRev, ...withdrawn };
    const text = JSON.stringify(frame);
    if (this.#audienceSent.get(session) === text) return;
    this.#audienceSent.set(session, text);
    this.send(frame);
  }

  // ---- M7's and M8's seams ----------------------------------------------------------------------------------------

  /** Each `rpc-result` sminos reports (M7 answers the device whose copy it answers, by its nonce); acknowledged after the listeners ran. */
  onResult(listener: (result: RpcResult) => void): () => void {
    this.#results.add(listener);
    return () => this.#results.delete(listener);
  }

  /** Each session-lane message (M8's subscriptions read them). */
  onSession(listener: (message: SessionLaneMessage) => void): () => void {
    this.#sessions.add(listener);
    return () => this.#sessions.delete(listener);
  }

  /** Each project's pending set as sminos restates it (`pending`; M8's `cards` view reads them). */
  onPending(listener: (project: string, raised: readonly unknown[]) => void): () => void {
    this.#pendings.add(listener);
    return () => this.#pendings.delete(listener);
  }

  /**
   * sminos's connection: `true` once one is welcomed, `false` when it ends or a new one replaces it (its session-plane
   * subscriptions go with it; M8's lane A subscriptions end).
   */
  onLink(listener: (connected: boolean) => void): () => void {
    this.#links.add(listener);
    return () => this.#links.delete(listener);
  }

  /**
   * The project registry: the sessions sminos holds, or the projects it opened on the log plane, may have moved (a
   * `member`, a `restated`, a log-plane `hello`, the connection's end), which its `known` reads.
   */
  onProjects(listener: () => void): () => void {
    this.#projectsMoved.add(listener);
    return () => this.#projectsMoved.delete(listener);
  }

  /** What the registry reads of the connected sminos (registry.ts' `SminosView`); null while none is welcomed. */
  sminosView(): { capabilities: readonly string[]; restating: boolean; sessionProjects(): string[]; logProjects(): Array<{ project: string; name: string; follow: boolean }> } | null {
    if (!this.connected) return null;
    return {
      capabilities: this.#sminos,
      restating: this.members.restating,
      sessionProjects: () => this.members.sessions().flatMap((session) => this.members.get(session)?.project ?? []),
      logProjects: () => this.relay.hellos(),
    };
  }

  /** The org frame stated again where it changed (the registry moved: this machine's locations, the records, `complete`). */
  restate(): Promise<void> {
    if (!this.#welcomed) return Promise.resolve();
    return this.#restate(false);
  }

  /**
   * True once the connected sminos acknowledged locations at or above `gen` on the connection that carried them, false
   * after `ms` (a connection that replaces this one and is told a `gen` at or above it releases it too).
   */
  locationsKept(gen: number, ms: number): Promise<boolean> {
    if (this.connected && this.#keptGen >= gen) return Promise.resolve(true);
    return new Promise((resolve) => {
      const waiting = {
        gen,
        resolve: (kept: boolean) => {
          clearTimeout(timer);
          this.#kept.delete(waiting);
          resolve(kept);
        },
      };
      const timer = setTimeout(() => waiting.resolve(false), ms);
      timer.unref?.();
      this.#kept.add(waiting);
    });
  }

  /** sminos's `locations-kept {gen}`: a `gen` this connection was sent releases what waits at or below it. */
  #locationsKept(frame: Frame): void {
    const gen = frame.gen;
    if (typeof gen !== 'number' || !Number.isSafeInteger(gen) || gen > this.#sentGen) return this.#ctx.log('endpoint: an RL10 locations-kept for no locations sent on this connection was ignored');
    this.#keptGen = Math.max(this.#keptGen, gen);
    for (const waiting of [...this.#kept]) if (waiting.gen <= this.#keptGen) waiting.resolve(true);
  }

  #tellProjects(): void {
    for (const listener of this.#projectsMoved) {
      try {
        listener();
      } catch (error) {
        this.#ctx.log(`endpoint: a projects listener failed: ${(error as Error).message}`);
      }
    }
  }

  /**
   * An authorized lane A action down as DX2's `rpc` (Interfaces §D), or why it can't go: `unavailable` with no sminos
   * connected, no member for its session, or a member with no `launch` (no bridge to fence it: sminos would refuse it
   * unfenced anyway), or a spawn whose checkout no presence lists; `malformed` when the action's own session, context or
   * digest disagree with its args, an action on a session carries no lane A context, or a `send`'s text is no string, is
   * blank or is longer than `SEND_TEXT_MAX`; `context` (M7) when the launch it
   * was sealed for is not the session's launch now (the bridge rechecks it at the effect, for a relaunch after this).
   * P5 O8 M6b: or a record act (`record.*`, `#drawRecord`), on the session authorization placed it on (`target`).
   */
  rpc(action: Action, who: { member: string; device: string }, fingerprint: string, target?: SessionTarget): { ok: true; frame: Frame } | { ok: false; reason: DrawRefusal } {
    const drawn = this.draw(action, who, fingerprint, target);
    if (drawn.ok) this.send(drawn.frame);
    return drawn;
  }

  /** `rpc`'s checks and frame, sent nowhere: what M7 checks before it asks sminos whose an op is. */
  draw(action: Action, who: { member: string; device: string }, fingerprint: string, target?: SessionTarget): { ok: true; frame: Frame } | { ok: false; reason: DrawRefusal } {
    const identity = this.#ctx.identity();
    if (!this.connected || identity === null) return { ok: false, reason: 'unavailable' };
    if (action.action.startsWith('record.')) return this.#drawRecord(action, who, fingerprint, identity, target);
    if (!action.action.startsWith('sminos.')) return { ok: false, reason: 'unavailable' };
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
      if (action.context === undefined || action.context.lane !== 'A' || action.context.session !== session) return { ok: false, reason: 'malformed' };
      if (action.requestDigest !== undefined && JSON.stringify(action.requestDigest) !== JSON.stringify(digest)) return { ok: false, reason: 'malformed' };
      // A `/` text is graded by its slash command (by-effect.ts) and refused by sminos itself, never here.
      if (name === 'send' && !isSendText(args.text)) return { ok: false, reason: 'malformed' };
      const member = this.members.get(session);
      if (member === null || member.lane !== 'A' || member.launch === undefined) return { ok: false, reason: 'unavailable' };
      if (action.context.launch !== member.launch) return { ok: false, reason: 'context' };
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
    return { ok: true, frame: { t: 'rpc', rpc } };
  }

  /**
   * P5 O8 M6b: a record act's frame (the module's header): to an sminos that advertised `record` alone, on the member that
   * keys sminos's record, which for lane B is the one authorization ranked (`target`) while the join still places the app
   * session there.
   */
  #drawRecord(action: Action, who: { member: string; device: string }, fingerprint: string, identity: Identity, target: SessionTarget | undefined): { ok: true; frame: Frame } | { ok: false; reason: DrawRefusal } {
    if (!(RECORD_ACTS as readonly string[]).includes(action.action) || !this.#sminos.includes(RECORD_CAPABILITY)) return { ok: false, reason: 'not-offered' };
    if (action.session !== undefined || action.context !== undefined || action.requestDigest !== undefined) return { ok: false, reason: 'malformed' };
    const { session: laneA, appSessionId, ...change } = action.args;
    if ((laneA === undefined) === (appSessionId === undefined)) return { ok: false, reason: 'malformed' };
    let sid: string | null = null;
    if (typeof laneA === 'string') sid = this.members.get(laneA)?.lane === 'A' ? laneA : null;
    else if (typeof appSessionId === 'string' && target?.lane === 'B' && target.appSessionId === appSessionId && this.members.appSessionId(target.session) === appSessionId) sid = target.session;
    const member = sid === null ? null : this.members.get(sid);
    if (sid === null || member === null) return { ok: false, reason: 'no-session' };
    const rpc = {
      rpc: action.action,
      project: member.project,
      machine: identity.name,
      member: who.member,
      device: who.device,
      created: action.created,
      nonce: action.nonce,
      opId: action.opId,
      opCreated: action.opCreated,
      args: { session: sid, ...change },
      fingerprint,
      proof: action,
    };
    return { ok: true, frame: { t: 'rpc', rpc } };
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
    this.#rebuild.ended();
    if (this.#welcomed) this.#link(false);
    this.#told = null;
    this.#sminos = Array.isArray(hello.capabilities) ? hello.capabilities.filter((c): c is string => typeof c === 'string').slice(0, 32) : [];
    this.#audienceSent.clear();
    this.#sentGen = 0;
    this.#keptGen = 0;
    const current = this.#ctx.policy.current();
    connection.send({
      t: 'welcome',
      protocol: RL10_PROTOCOL,
      // P5 O18 D9: sminos may send a member's access, shares and policyRev, and ask `reach?`; P5 O8 M6b: `record`, while
      // this build serves the record acts; the project registry: `locations`, to an sminos that reads them.
      capabilities: [...welcomeCapabilities(this.#ctx.offers), ...(this.#locations ? [LOCATIONS_CAPABILITY] : [])],
      build: this.#ctx.build,
      identity: { org: identity.org, hub: identity.hub, name: identity.name, former: formerNames(head.state, identity.ref, identity.name), ref: identity.ref, enrolled: identity.enrolled },
      policy: { read_only: current.read_only, ceiling: current.ceiling },
      stateVersion: head.state.version,
    });
    this.#welcomed = true;
    // The restatement is open before the link's listeners hear of the connection: the registry's publication they queue
    // reads `known` from the sessions held, which only a closed restatement answers for (panel 1, scalpel-3#1).
    this.members.welcome();
    this.#link(true);
    await this.#restate(true);
    if (!this.legacy.held && !this.legacy.retired) this.send({ t: 'legacy-key?' });
    // The remote sessions' audiences; the local ones follow their member frames in the restatement.
    for (const [session, remote] of this.cache.policies()) this.#tellAudience(session, { owners: remote.owners, members: remote.audience, policyRev: remote.policyRev });
  }

  #closed(): void {
    if (this.#welcomed) this.#link(false);
    this.#welcomed = false;
    this.#sentGen = 0;
    this.#keptGen = 0;
    this.members.stop();
    this.#told = null;
    this.relay.closeAll();
    this.#rebuild.ended();
    this.#sminos = [];
    this.#audienceSent.clear();
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

  /**
   * The revocation set and the directory, sent when `always` or when they changed since this connection was told. One
   * restatement at a time, each reading the head as it starts: the head's listeners don't await `adopted`, and one begun
   * on an older head that finished last would leave sminos told of it. A failed one leaves the next to run.
   */
  #restate(always: boolean): Promise<void> {
    const run = this.#restating.then(async () => {
      const head = this.#ctx.head();
      if (head === null) return;
      const revoked: RevocationSet = await revocationSet(head.state, head.certificates);
      const registry = this.#ctx.registry?.directory() ?? { hub: [], complete: false, locations: null };
      const directory = await orgDirectory(head.state, head.certificates, new Date(this.#ctx.now()), (name) => this.relay.seen(name), registry.hub);
      // The project registry (§D): `complete` and the locations, to an sminos that reads them
      const locations = this.#locations ? registry.locations : null;
      const org = this.#locations ? { ...directory, complete: registry.complete, ...(locations === null ? {} : { locations }) } : directory;
      const told = { revoked: JSON.stringify(revoked), org: JSON.stringify(org) };
      if (always || this.#told?.revoked !== told.revoked) this.send({ t: 'revoked', ...revoked });
      if (always || this.#told?.org !== told.org) {
        this.send(org);
        if (locations !== null) this.#sentGen = Math.max(this.#sentGen, locations.gen);
      }
      this.#told = told;
    });
    this.#restating = run.catch(() => {});
    return run;
  }

  async #frame(connection: Rl10Connection, frame: Frame): Promise<void> {
    if (!this.#welcomed || connection !== this.#server.current) return;
    switch (frame.t) {
      case 'hello':
        this.relay.hello(frame);
        this.#tellProjects();
        return this.#rebuild.kick();
      case 'events':
        return this.relay.events(frame);
      case 'rejected':
        return this.relay.rejected(frame);
      case 'member':
        await this.members.member(frame);
        if (frame.gone !== true && typeof frame.session === 'string') await this.#recordMoved(frame.session);
        return this.#tellProjects();
      case 'restated':
        await this.members.restated();
        return this.#tellProjects();
      case 'locations-kept':
        return this.#locationsKept(frame);
      case 'pending':
        return this.#pending(frame);
      case 'session':
        return this.#session(frame.message);
      case 'words?':
        return this.#words(frame);
      case 'reach?':
        return this.#reach(frame);
      case 'snapshots':
        return this.#rebuild.answer(frame);
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
    const requests = raised.filter((r): r is { session: string; request: string } => typeof (r as { session?: unknown } | null)?.session === 'string' && typeof (r as { request?: unknown }).request === 'string');
    this.#ctx.notifier.pendingSet(project, requests);
    for (const listener of this.#pendings) {
      try {
        listener(project, raised);
      } catch (error) {
        this.#ctx.log(`endpoint: a pending-set listener failed: ${(error as Error).message}`);
      }
    }
  }

  #link(connected: boolean): void {
    for (const listener of this.#links) {
      try {
        listener(connected);
      } catch (error) {
        this.#ctx.log(`endpoint: an RL10 link listener failed: ${(error as Error).message}`);
      }
    }
  }

  #session(raw: unknown): void {
    if (typeof raw !== 'object' || raw === null) return;
    const message = raw as SessionLaneMessage & Record<string, unknown>;
    if (typeof message.kind !== 'string' || typeof message.project !== 'string') return this.#ctx.log('endpoint: an RL10 session message that is not one was ignored');
    if (message.kind === 'machine' && message.session === null) this.members.presence(message.project, message.body);
    if (message.kind === 'host' && message.sub === null) this.#host(message);
    if (message.kind === 'raised' || message.kind === 'settled') this.#ctx.notifier.requestMessage(message);
    for (const listener of this.#sessions) {
      try {
        listener(message);
      } catch (error) {
        this.#ctx.log(`endpoint: a session-lane listener failed: ${(error as Error).message}`);
      }
    }
  }

  /**
   * A sub-less host message: a `wrote` unless its event's `(writer, seq)` in its project's host store is at or below the
   * durable mark (`hosts.json`), which moves only once the `wrote` has gone to the hub: one held while RL1 is down and
   * lost to a restart comes again in sminos's resend of the last 50.
   */
  #host(message: SessionLaneMessage): void {
    this.#journal(message);
    const event = (message.body as { event?: { writer?: unknown; seq?: unknown } } | null)?.event;
    const state = this.#ctx.state();
    if (state === null || typeof event?.writer !== 'string' || !Number.isSafeInteger(event.seq)) return this.#ctx.notifier.hostMessage(message);
    const { writer } = event;
    const seq = event.seq as number;
    if ((state.hosts[message.project]?.[writer] ?? 0) >= seq) return;
    this.#ctx.notifier.hostMessage(message, () => {
      const held = state.hosts[message.project] ?? {};
      if ((held[writer] ?? 0) >= seq) return;
      try {
        state.setHosts({ ...state.hosts, [message.project]: { ...held, [writer]: seq } });
      } catch (error) {
        this.#ctx.log(`endpoint: the host mark could not be kept: ${(error as Error).message}`);
      }
    });
  }

  /**
   * P5 O8 M7b (Interfaces §O): a sub-less host message's to-human entry, handed to the project channel's journal beside
   * notify and before the durable mark is read, since the mark moves once a `wrote` reaches the hub, not once the entry is
   * kept: an entry the hub was told of is journaled still. Its `src` is the host event's `<project>/<writer>/<seq>`, each
   * part URI-encoded as lane B's are (the writer holds a `/`), so sminos's resend of the last 50 records nothing new
   * (the journal's `UNIQUE(src)`). sminos's three host kinds map as they come: `message` and `answered` by their text, a
   * `question` by its questions (one text, or several, joined as the channel draws them) and its choices; its time is the
   * event's `ts` (in UTC), else now. An entry no session is named for, which nobody could be ranked on, is not kept.
   */
  #journal(message: SessionLaneMessage): void {
    const channel = this.#ctx.channel;
    if (channel === undefined || typeof message.session !== 'string' || message.session === '') return;
    const event = (message.body as { event?: Record<string, unknown> } | null)?.event;
    if (typeof event !== 'object' || event === null || typeof event.writer !== 'string' || !Number.isSafeInteger(event.seq)) return;
    const { kind, writer } = event;
    if (kind !== 'message' && kind !== 'question' && kind !== 'answered') return;
    const text = kind === 'question' && Array.isArray(event.text) ? event.text.filter((t): t is string => typeof t === 'string').join('\n\n') : event.text;
    if (typeof text !== 'string') return;
    const choices = kind === 'question' && Array.isArray(event.choices) ? event.choices.filter((c): c is string => typeof c === 'string') : [];
    const said = typeof event.ts === 'string' ? Date.parse(event.ts) : NaN;
    const at = new Date(Number.isFinite(said) ? said : this.#ctx.now()).toISOString();
    const src = [message.project, writer, String(event.seq)].map(encodeURIComponent).join('/');
    try {
      channel.record({ project: message.project, appSessionId: null, engineSessionId: message.session as NewHostEntry['engineSessionId'], lane: 'A', kind, text, ...(choices.length > 0 ? { choices } : {}), at, src });
    } catch (error) {
      this.#ctx.log(`endpoint: a host entry of ${message.project.slice(0, 64)} could not be handed to the channel: ${(error as Error).message}`);
    }
  }

  /**
   * `words?`, decided against what it read: when the head, the certificates or the session's record moved while it was
   * decided, it is decided again, once, against the state now (M5's `authorize` does the same). Moved again, no answer
   * goes: no answer is no words, and sminos keeps the delivery owed and asks again, where `peer` would deliver the
   * person's words for good as a peer message.
   */
  async #words(frame: Frame): Promise<void> {
    if (typeof frame.id !== 'string') return;
    const session = typeof frame.session === 'string' ? frame.session : null;
    const stamp = () => {
      const head = this.#ctx.head();
      return [head?.state, head?.certificates, session === null ? null : JSON.stringify([this.members.get(session), this.members.recordOf(session)])];
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      const before = stamp();
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
      const after = stamp();
      if (before.every((v, i) => v === after[i])) return this.send({ t: 'words', id: frame.id, verdict });
    }
    this.#ctx.log(`endpoint: words? ${frame.id.slice(0, 64)} went unanswered: the head or the session's record moved twice while it was decided`);
  }

  /**
   * `reach?` (P5 O18 D3), decided against what it read as `words?` is: decided again, once, when the head, the
   * certificates or the recipient's record moved meanwhile; moved again, or a recipient the endpoint holds no record
   * of, and no answer goes, so the delivery stays owed and sminos asks again.
   */
  async #reach(frame: Frame): Promise<void> {
    if (typeof frame.id !== 'string') return;
    const session = typeof frame.session === 'string' ? frame.session : null;
    const stamp = () => {
      const head = this.#ctx.head();
      return [head?.state, head?.certificates, session === null ? null : JSON.stringify([this.members.get(session), this.members.recordOf(session)])];
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      const before = stamp();
      const head = this.#ctx.head();
      const identity = this.#ctx.identity();
      const verdict = await decideReach(
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
      const after = stamp();
      if (!before.every((v, i) => v === after[i])) continue;
      if (verdict === null) return;
      return this.send(verdict === 'deliver' ? { t: 'reach', id: frame.id, verdict } : { t: 'reach', id: frame.id, verdict: 'refuse', reason: verdict.refuse });
    }
    this.#ctx.log(`endpoint: reach? ${frame.id.slice(0, 64)} went unanswered: the head or the session's record moved twice while it was decided`);
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
