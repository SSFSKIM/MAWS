// The fake machine (DC3's M4): an enrolled machine without a Mac. It speaks DX2 to the hub with the org key, as DC4's
// daemon and DC7's controls will, and replays recorded sessions under DX4's semantics, so the web (DC5, DC6) builds and
// tests against the real protocol. It
//   - syncs one project's log (the recordings' log events, sealed with the org key, under its own writers) and imports
//     the hub's, refusing what does not verify and reporting it up (`rejected`);
//   - publishes its presence, each session's presence, pending requests, settlements, and delivery outcomes;
//   - serves subscriptions (session.ts), and the depth's `rows`, `diff`, and (as DC8's producer) `output`;
//   - as the desk control surface's M0 producer (`m0`), advertises its sessions' bridge capabilities and its own `desk`,
//     answers `read status`, and runs `command` RPCs through the vendored route table, answered at once and reported
//     as `op` messages (commands.ts), a stale session (`staleSessions`, `reload`) kept without capabilities;
//   - answers RPCs from a script, with a ledger of its own: a nonce is claimed before the effect and its outcome recorded
//     before the result, and a nonce the ledger knows is never executed again;
//   - can drop its connection, end a session's process while it stays connected, crash after an RPC's effect and before
//     recording its outcome, end its subscriptions as the bridge's discontinuity does, refuse a subscribe before its
//     snapshot, and race a snapshot with the replay.
import { randomUUID } from 'node:crypto';
import { base64urlDecode } from '../src/protocol/base64url';
import { isTaskId } from '../src/protocol/browser';
import { canonicalize } from '../src/protocol/canonical';
import { deriveLogNonce, importOrgKey, inputSha256, seal, verify, verifyRpc, type OrgKey } from '../src/protocol/codes';
import { decodeEnrollmentCode, type Redeemed } from '../src/protocol/identity';
import type { JsonObject } from '../src/protocol/json';
import type { LogEvent, Vector } from '../src/protocol/log';
import type { DownFrame, OrgFrame, Refusal, RejectionReason, UpFrame } from '../src/protocol/machine';
import { RPC_FRESHNESS_MS, RPC_NAMES, type Rpc, type RpcError, type RpcName, type RpcOutcome } from '../src/protocol/rpc';
import type { Delivery, MachinePresence, Raised, SessionMessage, Settled } from '../src/protocol/session';
import { Link, LinkError, type Credentials } from './link';
import { emptyMemory, expireLedger, type Memory } from './memory';
import type { Recording, Row, Step } from './recording';
import { Commands, opMessages, refusalMessage, type CommandPlan, type CommandScript } from './commands';
import { M0_SMINOS, M1_SMINOS, producerAtLeast, SessionDepth, type BridgePlugin, type Producer, type SnapshotOptions } from './session';

/** What a script answers an RPC with: an outcome, or undefined for the fake machine's own default. */
export type RpcScript = { [N in RpcName]?: (rpc: Rpc<N>, machine: FakeMachine) => RpcOutcome<N> | undefined | Promise<RpcOutcome<N> | undefined> };

export type FakeMachineOptions = {
  /** The hub's origin: the stand-in's URL on the local runtime, or the deployment's. */
  hub: string;
  /** The machine's enrolled name; its writers are `<machine>/…`. */
  machine: string;
  /** The machine's service token, from its enrollment. */
  credentials: Credentials;
  /** The org key: its 32 bytes, or a key already imported. */
  orgKey: Uint8Array | OrgKey;
  /** The `.smns` project id it opens, and the name it registers the project under. */
  project: string;
  projectName?: string;
  /**
   * Opens the project as a follower (DX2 `hello.follow`): a machine with no checkout and no session of it, which reads
   * and delivers only. It posts no presence, its own or a session's; give it no recordings.
   */
  follow?: boolean;
  /** The sessions it replays, one per recording (`loadRecording`, `session` to rename one). */
  recordings?: Recording[];
  /** The member whose id replaces the recordings' member placeholder in a recorded settlement's `by`. */
  member?: string;
  /** What outlives a run (the ledger above all); hand the same object to the machine that comes back after a crash. */
  memory?: Memory;
  /** Called after every change to `memory` that a restart must find. */
  onMemory?: (memory: Memory) => void;
  /**
   * At a recorded settlement whose request is still pending: `recorded` settles it as recorded; `wait` holds the replay
   * until the web answers it (an RPC) or `answerInTerminal` does. A request the web answered first is settled by the
   * web either way, and its recorded settlement passed over.
   */
  decisions?: 'recorded' | 'wait';
  /** The machine's policy: read-only refuses every RPC and delivers nothing from outside. */
  readOnly?: boolean;
  ceiling?: string;
  /** The project's known checkouts on this machine (spawn's choices); each recording's working directory by default. */
  checkouts?: Array<{ path: string; branch: string }>;
  /** Log events take `ts` from when this machine first writes them (default), so a `message` pushes as a fresh one
   * would; false keeps the recorded times. */
  retime?: boolean;
  /** The snapshot's race hooks, per subscription. */
  snapshot?: (session: string, sub: string, agentId: string | null) => SnapshotOptions | undefined;
  /** Answers RPCs instead of the defaults. */
  script?: RpcScript;
  /** The outcome of delivering an outside event to one of its sessions (`delivered` by default). */
  delivery?: (event: LogEvent, session: string) => Pick<Delivery, 'outcome' | 'reason'> | undefined;
  /**
   * Whether its sessions have the bridge (default true). Without it, as §5's table has it: presence says so, no chunk,
   * `block-row`, `step-end`, or `usage` is sent (rows only), a steer goes out as a seat's `reply` and names no row
   * (`{row: null}`), and interrupt, decisions, answers, model, compact, and stop fail `unsupported`.
   */
  bridge?: boolean;
  /** Reconnects by itself, with backoff, whenever the stream ends (as the daemon does; a redeploy ends every stream).
   * Off by default: a suite drops and reconnects when it chooses. */
  reconnect?: boolean;
  /** The branch each session's working-tree diff is against (DX4 `diff`'s `base`); `main` when this gives none. */
  diffBase?: (session: string) => string | undefined;
  /**
   * The daemon it stands for (`Producer`): `dc8` carries DX4's widened `subagents` body, `jobs` and `mcp`, and answers
   * `output`; `dc3` (the default, as DC3 built it) sends each agent's id and meta alone and passes `output` by; `m0`
   * (the desk control surface's M0) adds each bridged session's `capabilities` to its presence and `desk` to the
   * machine's, answers `read status`, and runs `command` RPCs.
   */
  producer?: Producer;
  /** What each command prints, by name, in the place of `commands.ts`'s defaults (an `m0` producer). */
  commands?: CommandScript;
  /** Sessions whose mod loaded before the machine's update (an `m0` producer): bridged, with no capabilities, until
   * `reload` brings their mod up to date. */
  staleSessions?: string[];
  /**
   * The plugin its sessions' bridge and ask run in (doperpowers' sminos plugin design, §11): `doperpowers` (the default),
   * a machine not yet rolled; `sminos`, one on sminos 1.0.0, whose bridge appends its rows under origin `sminos` and
   * raises the ask as `mcp__sminos__AskUserQuestion` — a recorded ask under the old name is raised under the new one.
   * The recordings' own rows are replayed as recorded.
   */
  plugin?: BridgePlugin;
};

/** What happened to an RPC this machine received, for a test to read. */
export type RpcRecord = { nonce: string; rpc: RpcName; outcome: RpcOutcome | null; executed: boolean };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const SESSION_RPCS = new Set<RpcName>(['steer', 'interrupt', 'answer', 'decide', 'model', 'compact', 'retire', 'resume', 'stop', 'command']);
/** Whether text holds a control character, which a command's name may not (DX6 `command`). */
const hasControl = (text: string) => [...text].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);
const fail = (code: RpcError['code'], message: string, extra: Partial<RpcError> = {}): RpcOutcome => ({ state: 'failed', error: { code, message, ...extra } });
const done = (result: object): RpcOutcome => ({ state: 'done', result }) as RpcOutcome;

export class FakeMachine {
  readonly name: string;
  readonly project: string;
  readonly memory: Memory;
  /** Every frame the hub sent, in order. */
  readonly frames: DownFrame[] = [];
  /** The hub's refusals of what this machine uploaded (DX2 `refused`). */
  readonly refusals: Refusal[] = [];
  /** Events this machine refused on import, as it reported them (DX2 `rejected`). */
  readonly rejected: Array<{ event: { writer: string; seq: number } | null; reason: RejectionReason }> = [];
  /** Each RPC received, with its outcome and whether this machine ran its effect. */
  readonly rpcs: RpcRecord[] = [];
  /** What went wrong without stopping the machine, kept rather than thrown: a POST the hub refused (a stale generation
   * after a drop, say), a replay step that failed. */
  readonly postErrors: Error[] = [];
  readonly sessions = new Map<string, SessionDepth>();
  private readonly link: Link;
  private key!: OrgKey;
  private readonly timeline: Array<{ session: SessionDepth; step: Step }> = [];
  private cursor = 0;
  private chain: Promise<void> = Promise.resolve();
  private rpcChain: Promise<void> = Promise.resolve();
  private outbox: UpFrame[] = [];
  private flushing: Promise<void> = Promise.resolve();
  private flushScheduled = false;
  private readonly pending = new Map<string, { session: string; raised: Raised }>();
  private readonly settledRequests = new Map<string, Settled>();
  private readonly waiters = new Map<string, () => void>();
  private readonly compactsAtTurnEnd: Array<{ session: string; nonce: string }> = [];
  /** The commands queued behind each session's running turn: each one's `op` end is sent at the turn's end (H-queue). */
  private readonly commandsAtTurnEnd: Array<{ session: string; nonce: string; plan: Extract<CommandPlan, { ok: true }> }> = [];
  private readonly commands: Commands;
  private readonly models = new Map<string, { model: string | null; effort: string | null }>();
  private have: ((frame: Extract<DownFrame, { t: 'have' }>) => void) | null = null;
  private crashArmed: ((rpc: Rpc) => boolean) | null = null;
  private refuseNext: { reason: 'session-ended' | 'discontinuity' | 'error'; message?: string } | null = null;
  private race: SnapshotOptions & { advance?: number } = {};
  private crashed = false;
  private stopped = false;

  constructor(private readonly options: FakeMachineOptions) {
    this.name = options.machine;
    this.project = options.project;
    this.memory = options.memory ?? emptyMemory();
    this.memory.written ??= {};
    this.link = new Link(
      options.hub,
      options.credentials,
      (frame) => this.receive(frame),
      () => this.closed(),
      (error) => this.refused(error),
    );
    this.commands = new Commands(options.commands, undefined, producerAtLeast(this.producer, 'm1'));
    const where = { project: this.project, machine: this.name };
    for (const recording of options.recordings ?? []) {
      const depth = new SessionDepth(recording.session, recording, (m) => this.queue({ t: 'session', message: m }), where, options.bridge !== false, this.diffBase(recording.session), this.producer, this.plugin);
      depth.stale = options.staleSessions?.includes(recording.session) === true;
      this.sessions.set(recording.session, depth);
      for (const step of recording.steps) this.timeline.push({ session: depth, step });
    }
    this.timeline.sort((a, b) => a.step.at - b.step.at);
    // A steer the machine ran before a crash left its row in the transcript, and a stop its TaskStop rows (DX6's trace).
    for (const trace of Object.values(this.memory.trace)) {
      if (trace.rpc === 'steer' && trace.row && trace.session) this.sessions.get(trace.session)?.appendRow(null, trace.row as Row);
      else if (trace.rpc === 'stop' && trace.session && typeof trace.result.taskId === 'string') this.sessions.get(trace.session)?.restoreStop(trace.result.taskId);
      else if (trace.rpc === 'spawn' && trace.session && !this.sessions.has(trace.session)) this.sessions.set(trace.session, new SessionDepth(trace.session, null, (m) => this.queue({ t: 'session', message: m }), where, true, this.diffBase(trace.session), this.producer, this.plugin));
    }
  }

  /**
   * Redeems an enrollment code (what the owner pastes at `sminos hub enroll`'s prompt) at the hub it names: the
   * machine's service token, and the code's hub, name, and org key, for the constructor.
   */
  static async redeem(code: string): Promise<{ hub: string; machine: string; credentials: Credentials; orgKey: Uint8Array }> {
    const decoded = decodeEnrollmentCode(code);
    const response = await fetch(`${decoded.hub}/machine/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: decoded.token, machine: decoded.machine }),
    });
    if (response.status !== 200) throw new Error(`the enrollment was refused: ${response.status} ${await response.text()}`);
    const redeemed = (await response.json()) as Redeemed;
    return { hub: decoded.hub, machine: redeemed.machine, credentials: { clientId: redeemed.client_id, clientSecret: redeemed.client_secret }, orgKey: base64urlDecode(decoded.key) };
  }

  private diffBase(session: string): string {
    return this.options.diffBase?.(session) ?? 'main';
  }

  private get plugin(): BridgePlugin {
    return this.options.plugin ?? 'doperpowers';
  }

  private get producer(): Producer {
    return this.options.producer ?? 'dc3';
  }

  // The connection.

  get isConnected(): boolean {
    return this.link.isOpen;
  }

  /** The service token it connects with: hand it to the machine that comes back after a crash. */
  get credentials(): Credentials {
    return this.options.credentials;
  }

  get generation(): number {
    return this.link.generation;
  }

  /** Whether each heartbeat is answered: false is a suspended daemon, whose lease lapses within 45 s. */
  set answerHeartbeats(answer: boolean) {
    this.link.answerHeartbeats = answer;
  }

  /**
   * Opens the stream and the project, as a daemon does after every (re)connect: `hello` with its vector, its own
   * events the hub lacks, its complete pending set, every result the hub has not acknowledged, and its presence.
   */
  async connect(): Promise<void> {
    if (this.crashed) throw new Error('this fake machine crashed; construct another with its memory');
    this.key ??= this.options.orgKey instanceof Uint8Array ? await importOrgKey(this.options.orgKey) : this.options.orgKey;
    expireLedger(this.memory);
    await this.link.connect();
    const have = new Promise<Extract<DownFrame, { t: 'have' }>>((resolve) => (this.have = resolve));
    const answered = Promise.race([have, new Promise((_, reject) => this.onDrop.push(() => reject(new Error('the stream ended before the hub answered hello'))))]);
    // A write waits for this handshake's `have`, or for the stream's end, never longer.
    this.handshake = answered.then(() => undefined, () => undefined);
    const follow = this.options.follow === true;
    this.queue({ t: 'hello', project: this.project, name: this.options.projectName ?? this.options.recordings?.[0]?.name ?? 'fake', have: this.vector(), ...(follow ? { follow } : {}) });
    await this.flush();
    const timer = setTimeout(() => void this.drop(), 15_000);
    await answered.finally(() => clearTimeout(timer));
    this.queue({ t: 'pending', project: this.project, raised: [...this.pending.values()].map((p) => p.raised) });
    for (const [nonce, r] of Object.entries(this.memory.unacked)) this.queue({ t: 'rpc-result', project: r.project, nonce, outcome: r.outcome });
    if (!follow) {
      this.queue({ t: 'session', message: { project: this.project, machine: this.name, session: null, kind: 'machine', sub: null, n: null, body: this.presence() } });
      for (const depth of this.sessions.values()) this.sendPresence(depth);
    }
    await this.flush();
  }

  /** The org's directory as the hub last sent it (DX2 `org`), or null before the first. */
  get directory(): OrgFrame | null {
    return (this.frames.findLast((f) => f.t === 'org') as OrgFrame | undefined) ?? null;
  }

  /** The machine's DX4 `machine` presence. */
  presence(): MachinePresence {
    const checkouts = this.options.checkouts ?? [...new Set([...this.sessions.values()].map((s) => s.cwd).filter((c): c is string => c !== null))].map((path) => ({ path, branch: 'main' }));
    const desk = producerAtLeast(this.producer, 'm0') ? { desk: { sminos: producerAtLeast(this.producer, 'm1') ? M1_SMINOS : M0_SMINOS, rpcs: [...RPC_NAMES], reads: [] } } : {};
    return { online: true, policy: { read_only: this.options.readOnly === true, ceiling: this.options.ceiling ?? 'default' }, checkouts, ...desk };
  }

  /**
   * A session's mod reloaded (`/reload-plugins`, or a restart): a stale session's presence carries its capabilities
   * from now on, and is published again. `stale: true` stages the opposite, a mod that loaded before the update.
   */
  reload(session: string, stale = false): void {
    const depth = this.sessions.get(session);
    if (!depth) return;
    depth.stale = stale;
    this.sendPresence(depth);
  }

  /** Drops the connection, as a daemon whose network went: the hub ends its subscriptions and marks its forwarded RPCs
   * `uncertain` (at once locally, as the stream's close reaches the object). */
  async drop(): Promise<void> {
    await this.link.drop();
    this.closed();
  }

  /** Drops the connection and opens it again. */
  async reconnect(): Promise<void> {
    await this.drop();
    await this.connect();
  }

  /**
   * Stops the replay and closes the connection. Its sessions end with it, so it first publishes each one's presence as
   * ended (`record: null`), as a machine does when a session's process goes; otherwise a session last seen waiting
   * would stay waiting on the grid while the machine, back under the same name, serves other sessions.
   */
  async close(): Promise<void> {
    this.stopped = true;
    for (const resolve of this.waiters.values()) resolve();
    if (this.link.isOpen && !this.crashed) {
      for (const depth of this.sessions.values()) {
        depth.presence = null;
        this.sendPresence(depth);
      }
      await this.flush();
    }
    await this.link.drop();
  }

  /** A session's process gone, the machine still connected: its presence published as ended (`record: null`), as the
   * daemon publishes a member whose process it no longer sees. Every session, or the one named. */
  async end(session?: string): Promise<void> {
    for (const depth of this.sessions.values()) {
      if (session !== undefined && depth.id !== session) continue;
      depth.presence = null;
      this.sendPresence(depth);
    }
    await this.flush();
  }

  /**
   * A POST refused because the stream it names is no longer the machine's current one (409 stale-generation), or
   * because the hub could not write its replies (503 delivery-failed): the stream this machine holds is not the one the
   * hub serves, though it may still be open and beating. (M5 saw it on the deployment: minutes after a deploy, new
   * requests reached a restarted object while the old one kept the stream.) A machine that reconnects by itself drops
   * the stream and opens a fresh one, as the daemon does.
   */
  private refused(error: LinkError): void {
    if (!this.options.reconnect || this.stopped || this.crashed || this.reconnecting) return;
    if (error.status === 409 || error.status === 503) void this.drop();
  }

  private onDrop: Array<() => void> = [];

  private closed(): void {
    for (const drop of this.onDrop.splice(0)) drop();
    // The subscriptions ran on the stream that went; the hub ended them at the browsers.
    for (const depth of this.sessions.values()) depth.forgetAll();
    this.outbox = [];
    if (this.options.reconnect && !this.stopped && !this.crashed && !this.reconnecting) void this.reconnectLoop();
  }

  private reconnecting = false;

  private async reconnectLoop(): Promise<void> {
    this.reconnecting = true;
    for (let wait = 500; !this.stopped && !this.link.isOpen; wait = Math.min(wait * 2, 10_000)) {
      await sleep(wait);
      try {
        await this.connect();
      } catch (error) {
        this.postErrors.push(error as Error);
      }
    }
    this.reconnecting = false;
  }

  // The replay.

  /**
   * Plays the timeline from where it stands, at `speed` times the recorded pace (0: as fast as it goes), until its end,
   * or until `until` holds after a step.
   */
  async play(options: { speed?: number; until?: (step: Step, session: string) => boolean } = {}): Promise<void> {
    const speed = options.speed ?? 1;
    let last = this.timeline[this.cursor]?.step.at ?? 0;
    while (this.cursor < this.timeline.length && !this.stopped && !this.crashed) {
      const { session, step } = this.timeline[this.cursor];
      const wait = speed > 0 ? (step.at - last) / speed : 0;
      if (wait > 0) await sleep(wait);
      else if (this.cursor % 50 === 0) await sleep(0);
      last = step.at;
      if (step.k === 'settled' && this.options.decisions === 'wait' && this.pending.has(step.draft.request)) {
        await new Promise<void>((resolve) => this.waiters.set(step.draft.request, resolve));
      }
      if (this.timeline[this.cursor]?.step !== step) continue; // a race advanced the replay meanwhile
      await this.advance();
      if (options.until?.(step, session.id)) break;
    }
    await this.chain;
    await this.flush();
  }

  /** Applies the next `count` steps of the timeline, whatever their times. */
  async step(count = 1): Promise<void> {
    for (let i = 0; i < count && this.cursor < this.timeline.length; i++) await this.advance();
    await this.flush();
  }

  /** Whether the whole timeline has been played. */
  get played(): boolean {
    return this.cursor >= this.timeline.length;
  }

  /** The next step to play, or null at the end. */
  get next(): { session: string; step: Step } | null {
    const at = this.timeline[this.cursor];
    return at ? { session: at.session.id, step: at.step } : null;
  }

  private advance(): Promise<void> {
    const at = this.timeline[this.cursor++];
    if (!at) return this.chain;
    // A step that fails is kept in `postErrors`, and the replay goes on.
    this.chain = this.chain.then(() => this.apply(at.session, at.step)).catch((error: unknown) => void this.postErrors.push(error as Error));
    return this.chain;
  }

  private async apply(depth: SessionDepth, step: Step): Promise<void> {
    switch (step.k) {
      case 'presence':
        depth.presence = step.record;
        this.sendPresence(depth);
        return;
      case 'raised':
        return this.raise(depth.id, step.draft);
      case 'settled': {
        if (!this.pending.has(step.draft.request)) return;
        const placeholder = this.options.recordings?.find((r) => r.session === depth.id)?.member;
        const by = placeholder && step.draft.by === placeholder && this.options.member ? this.options.member : step.draft.by;
        await this.settle(step.draft.request, { ...step.draft, by });
        return;
      }
      case 'log':
        return this.writeRecorded(depth, step.id, step.event);
      case 'delivery':
        return this.deliverRecorded(depth, step);
      case 'turn-end':
        depth.apply(step);
        if (step.agentId === null) await this.compactAtTurnEnd(depth.id);
        return;
      default:
        depth.apply(step);
    }
  }

  // The session plane.

  private sendPresence(depth: SessionDepth): void {
    this.queue({ t: 'session', message: { project: this.project, machine: this.name, session: depth.id, kind: 'presence', sub: null, n: null, body: depth.presenceBody() } });
  }

  private sendSessionWide(message: SessionMessage): void {
    this.queue({ t: 'session', message });
  }

  private async raise(session: string, draft: Omit<Raised, 'mac' | 'session'>): Promise<void> {
    // A background subagent's window is the bridge's 3 s from now, whenever the recording ran; the ask is raised under
    // the name the machine's plugin registers it by.
    const named = draft.tool === OLD_ASK_TOOL ? { ...draft, tool: ASK_TOOL_IN[this.plugin] } : draft;
    const timed = named.deadline ? { ...named, deadline: new Date(Date.now() + 3000).toISOString() } : named;
    const raised = await seal(this.key, 'raised', this.project, { ...timed, session } as Omit<Raised, 'mac'>);
    this.pending.set(raised.request, { session, raised });
    this.sendSessionWide({ project: this.project, machine: this.name, session, kind: 'raised', sub: null, n: null, body: raised });
  }

  /** Settles a pending request, once: false when it was no longer pending (another side settled it first). */
  private async settle(request: string, draft: Omit<Settled, 'mac' | 'request'> & { request?: string }): Promise<boolean> {
    const held = this.pending.get(request);
    if (!held) return false;
    this.pending.delete(request);
    const settled = await seal(this.key, 'settled', this.project, { request, winner: draft.winner, outcome: draft.outcome, by: draft.by });
    this.settledRequests.set(request, settled);
    this.sendSessionWide({ project: this.project, machine: this.name, session: held.session, kind: 'settled', sub: null, n: null, body: settled });
    this.waiters.get(request)?.();
    this.waiters.delete(request);
    await this.flush();
    return true;
  }

  /** The terminal answers a pending request first: settled `terminal`, and a later web decision is refused naming it. */
  async answerInTerminal(request: string, outcome: Settled['outcome'] = 'allow'): Promise<void> {
    await this.settle(request, { winner: 'terminal', outcome, by: 'terminal' });
  }

  /** The requests pending now. */
  pendingRequests(): Raised[] {
    return [...this.pending.values()].map((p) => p.raised);
  }

  /** Ends every open subscription of `session` (all sessions when omitted) with `discontinuity`, as the end of the
   * bridge's own subscription (a module reload, a replacement child) or a gap in it does. */
  discontinuity(session?: string): void {
    for (const depth of this.sessions.values()) if (!session || depth.id === session) for (const sub of depth.openSubs()) depth.end(sub, 'discontinuity');
    void this.flush();
  }

  /** The next subscribe is ended before its snapshot (`end` at n 0), as for a bridge not ready yet or a cut row that
   * never reached the disk. */
  refuseNextSubscribe(reason: 'session-ended' | 'discontinuity' | 'error' = 'discontinuity', message?: string): void {
    this.refuseNext = { reason, message };
  }

  /**
   * Races the next subscription's snapshot: while it is being built, `advance` more steps of the replay are applied
   * (they reach the subscriber after the snapshot), and with `overlap` the live part is also handed what the snapshot
   * holds (its newest row, each streaming message's last chunk), which the watermark and the row ids must drop.
   */
  raceNextSnapshot(race: { advance?: number; overlap?: boolean }): void {
    this.race = race;
  }

  private async subscribe(frame: Extract<DownFrame, { t: 'subscribe' }>): Promise<void> {
    const depth = this.sessions.get(frame.session);
    const end = (reason: 'session-ended' | 'discontinuity' | 'error', message?: string) =>
      this.sendSessionWide({ project: this.project, machine: this.name, session: frame.session, kind: 'end', sub: frame.sub, n: 0, body: { reason, ...(message && { message }) } });
    if (!depth) return end('session-ended', `no session ${frame.session} on ${this.name}`);
    if (this.refuseNext) {
      const { reason, message } = this.refuseNext;
      this.refuseNext = null;
      return end(reason, message);
    }
    const race = this.race;
    this.race = {};
    const given = this.options.snapshot?.(frame.session, frame.sub, frame.agentId) ?? {};
    await depth.subscribe(frame.sub, frame.agentId, {
      overlap: race.overlap || given.overlap,
      budget: given.budget,
      duringSnapshot: async () => {
        if (race.advance) await this.step(race.advance);
        await given.duringSnapshot?.();
      },
    });
    await this.flush();
  }

  // The log plane.

  private feed(project = this.project): LogEvent[] {
    return (this.memory.log[project] ??= []);
  }

  /** The machine's `{writer: max seq}`, its spent positions included (DX2). */
  vector(project = this.project): Vector {
    const out: Vector = {};
    for (const e of this.feed(project)) out[e.writer] = Math.max(out[e.writer] ?? 0, e.seq);
    for (const s of this.memory.spent[project] ?? []) out[s.writer] = Math.max(out[s.writer] ?? 0, s.seq);
    return out;
  }

  private own(writer: string): boolean {
    return writer.startsWith(`${this.name}/`);
  }

  /** A recorded log event, written under this machine's name: once, whatever restarts come between. */
  private async writeRecorded(depth: SessionDepth, id: string, recorded: JsonObject): Promise<void> {
    const writer = String(recorded.writer);
    const from = writer.slice(0, writer.indexOf('/'));
    const fields: JsonObject = { ...recorded };
    delete fields.writer;
    delete fields.seq;
    delete fields.ts;
    delete fields.mac;
    if (fields.machine === from) fields.machine = this.name;
    await this.write(`recording:${depth.id}:${id}`, `${this.name}/${writer.slice(writer.indexOf('/') + 1)}`, fields, this.options.retime === false ? String(recorded.ts) : undefined);
  }

  /** A recorded delivery outcome, naming the event as this machine wrote it. */
  private async deliverRecorded(depth: SessionDepth, step: Extract<Step, { k: 'delivery' }>): Promise<void> {
    await this.writeLock;
    const written = this.memory.written[`${this.project}:recording:${depth.id}:${step.log}`];
    if (!written) throw new Error(`the recording delivers ${step.log}, which this machine never wrote`);
    const delivery = await seal(this.key, 'delivery', this.project, { event: { writer: written.writer, seq: written.seq }, session: step.session, outcome: step.outcome, reason: step.reason });
    this.sendSessionWide({ project: this.project, machine: this.name, session: step.session, kind: 'delivery', sub: null, n: null, body: delivery });
    await this.flush();
  }

  /**
   * Appends an event to one of this machine's feeds, sealed with a nonce derived from it, and uploads it; written once
   * per `src`. Writes run one at a time, whoever asks (the replay, an RPC's effect, a test), so each takes the next seq.
   */
  write(src: string, writer: string, fields: JsonObject, ts?: string): Promise<LogEvent> {
    const run = this.writeLock.then(() => this.writeNow(src, writer, fields, ts));
    this.writeLock = run.catch(() => {});
    return run;
  }

  private writeLock: Promise<unknown> = Promise.resolve();
  /** The hub's vector from the latest `have`: a feed of this machine's never takes a seq at or below it. */
  private hubHave: Vector = {};
  /** Settles when the connect in progress has the hub's `have`; a write waits for it, so it never allocates a seq
   * before the hub's vector is known. */
  private handshake: Promise<void> = Promise.resolve();

  private async writeNow(src: string, writer: string, fields: JsonObject, ts?: string): Promise<LogEvent> {
    const key = `${this.project}:${src}`;
    const known = this.memory.written[key];
    if (known) return this.feed().find((e) => e.writer === known.writer && e.seq === known.seq)!;
    await this.handshake;
    const seq = Math.max(this.vector()[writer] ?? 0, this.hubHave[writer] ?? 0) + 1;
    const event = { ts: ts ?? new Date().toISOString(), writer, seq, ...fields };
    const sealed = (await seal(this.key, 'log', this.project, event, await deriveLogNonce(this.key, this.project, event))) as unknown as LogEvent;
    this.feed().push(sealed);
    this.memory.written[key] = { writer, seq };
    this.remember();
    this.queue({ t: 'events', project: this.project, events: [sealed] });
    await this.flush();
    return sealed;
  }

  private uploadFrom(vector: Vector, only?: { writer: string; from: number }): void {
    const events = this.feed()
      .filter((e) => this.own(e.writer) && (only ? e.writer === only.writer && e.seq >= only.from : e.seq > (vector[e.writer] ?? 0)))
      .sort((a, b) => (a.writer === b.writer ? a.seq - b.seq : a.writer < b.writer ? -1 : 1));
    if (events.length) this.queue({ t: 'events', project: this.project, events });
  }

  /** Imports events the hub sent, as a daemon does: each verified, a repeated nonce or a different payload at a held
   * position refused and reported, the refused position spent. Newly held outside events are delivered. */
  private async import(events: LogEvent[]): Promise<void> {
    for (const event of events) {
      const feed = this.feed();
      const writer = typeof event.writer === 'string' ? event.writer : null;
      const seq = typeof event.seq === 'number' ? event.seq : null;
      const position = writer !== null && seq !== null ? { writer, seq } : null;
      const held = position && feed.find((e) => e.writer === position.writer && e.seq === position.seq);
      if (held) {
        if (canonicalize(held) !== canonicalize(event)) this.reject(event, position, 'conflict');
        continue;
      }
      if (!(await verify(this.key, 'log', this.project, event))) {
        this.reject(event, position, 'bad-code');
        continue;
      }
      const nonce = event.mac.nonce;
      if (this.memory.nonces.includes(nonce)) {
        this.reject(event, position, 'seen-nonce');
        continue;
      }
      this.memory.nonces.push(nonce);
      feed.push(event);
      this.remember();
      if (!this.own(event.writer)) await this.deliver(event);
    }
  }

  private reject(event: LogEvent, position: { writer: string; seq: number } | null, reason: RejectionReason): void {
    if (position) (this.memory.spent[this.project] ??= []).push(position);
    this.remember();
    this.rejected.push({ event: position, reason });
    const nonce = typeof event.mac?.nonce === 'string' ? event.mac.nonce : undefined;
    this.queue({ t: 'rejected', project: this.project, event: position, ...(nonce !== undefined && { nonce }), reason, message: `${reason}: refused on import by ${this.name}` });
  }

  /** An outside `human` or `say` addressed to its sessions: each recipient's DX4 `delivery`, and, delivered, the text as
   * the human's prompt in the session's transcript. */
  private async deliver(event: LogEvent): Promise<void> {
    if (event.kind !== 'human' && event.kind !== 'say') return;
    const to = event.to;
    const recipients = [...this.sessions.keys()].filter((id) => to === '*' || (Array.isArray(to) && to.some((r) => (r as JsonObject)?.session === id)));
    for (const session of recipients) {
      const chosen = this.options.delivery?.(event, session) ?? (this.options.readOnly ? { outcome: 'refused-read-only' as const, reason: 'this machine is read-only' } : { outcome: 'delivered' as const, reason: 'submitted to the session' });
      const delivery = await seal(this.key, 'delivery', this.project, { event: { writer: event.writer, seq: event.seq }, session, outcome: chosen.outcome, reason: chosen.reason });
      this.sendSessionWide({ project: this.project, machine: this.name, session, kind: 'delivery', sub: null, n: null, body: delivery });
      if (chosen.outcome === 'delivered') this.sessions.get(session)!.appendRow(null, userRow(session, String(event.text ?? '')));
    }
    await this.flush();
  }

  // RPCs.

  /**
   * The next RPC that `match` admits (any, by default) crashes this machine after its effect and before its outcome is
   * recorded: the stream drops and this instance stops. A machine constructed with the same `memory` finds the claim
   * without an outcome, reconciles it from the effect's trace, and never runs the effect again.
   */
  crashAfterEffect(match: (rpc: Rpc) => boolean = () => true): void {
    this.crashArmed = match;
  }

  get isCrashed(): boolean {
    return this.crashed;
  }

  private handleRpc(rpc: Rpc): Promise<void> {
    this.rpcChain = this.rpcChain.then(() => this.runRpc(rpc));
    return this.rpcChain;
  }

  private async runRpc(rpc: Rpc): Promise<void> {
    if (this.crashed) return;
    const record: RpcRecord = { nonce: rpc.nonce, rpc: rpc.rpc, outcome: null, executed: false };
    this.rpcs.push(record);
    const answer = (outcome: RpcOutcome) => {
      record.outcome = outcome;
      this.memory.unacked[rpc.nonce] = { project: rpc.project, outcome };
      this.remember();
      this.queue({ t: 'rpc-result', project: rpc.project, nonce: rpc.nonce, outcome });
      return this.flush();
    };
    // Bound to where it runs, before the ledger and before freshness (DX6).
    if (rpc.project !== this.project) return answer(fail('unknown-project', `${this.name} serves no project ${rpc.project}`));
    if (!(await verifyRpc(this.key, rpc, this.project))) return answer(fail('bad-code', 'the RPC’s code does not verify'));
    if (rpc.machine !== this.name) return answer(fail('wrong-machine', `this is ${this.name}, not ${rpc.machine}`));
    // A daemon older than the desk control surface's M0 knows no `command`.
    if (rpc.rpc === 'command' && !producerAtLeast(this.producer, 'm0')) return answer(fail('bad-shape', 'no RPC "command"'));
    const malformed = argumentProblem(rpc);
    if (malformed) return answer(fail('bad-shape', malformed));
    const session = (rpc.args as { session?: string }).session;
    if (SESSION_RPCS.has(rpc.rpc) && (typeof session !== 'string' || !this.sessions.has(session))) return answer(fail('no-session', `no session ${session} on ${this.name}`));
    // The ledger answers a nonce it knows, before freshness, and never runs it again.
    const entry = this.memory.ledger[rpc.nonce];
    if (entry) {
      if (!entry.outcome) {
        const trace = this.memory.trace[rpc.nonce];
        entry.outcome = trace ? done(trace.result) : fail('interrupted', 'the machine stopped between running it and recording its outcome');
        this.remember();
      }
      return answer(entry.outcome);
    }
    if (Date.now() - Date.parse(rpc.created) > RPC_FRESHNESS_MS) return answer(fail('stale', 'older than 60 seconds'));
    if (this.options.readOnly) return answer(fail('read-only', `${this.name} is read-only`));
    // A decision or an answer that does not fit the request it names is malformed, refused before the claim.
    if (rpc.rpc === 'decide' || rpc.rpc === 'answer') {
      const held = this.pending.get(rpc.args.digest.request);
      const misfit = held && decisionMisfit(rpc as Rpc<'decide' | 'answer'>, held.raised);
      if (misfit) return answer(misfit);
    }
    // A stop needs the bridge and a running session, then names a job the session's own jobs index holds as running,
    // or it is refused before the claim, in that order (DC10, the machine half's DX6).
    if (rpc.rpc === 'stop') {
      const depth = this.sessions.get(rpc.args.session)!;
      if (this.options.bridge === false || depth.presence === null) return answer(fail('unsupported', 'the session has no bridge, or has ended'));
      if (!depth.runningJob(rpc.args.taskId)) return answer(fail('unknown-task', `${rpc.args.taskId} is not a running job of ${rpc.args.session}`));
    }
    // A command needs a running session whose bridge takes it: a stale session's mod (loaded before the update) does not.
    if (rpc.rpc === 'command') {
      const depth = this.sessions.get(rpc.args.session)!;
      if (this.options.bridge === false || depth.presence === null) return answer(fail('unsupported', 'the session has no bridge, or has ended'));
      if (!depth.capabilities?.ops.includes('command')) return answer(fail('unsupported', "the session's bridge takes no commands: its plugin loaded before the update"));
    }
    this.memory.ledger[rpc.nonce] = { rpc: rpc.rpc, session: session ?? null, claimed: Date.now(), outcome: null };
    this.remember();
    // Every effect is complete (and its trace kept) when this returns; only progress notices follow the result.
    const notices: Array<() => Promise<void>> = [];
    let outcome: RpcOutcome;
    try {
      const script = this.options.script?.[rpc.rpc] as ((r: Rpc, m: FakeMachine) => RpcOutcome | undefined | Promise<RpcOutcome | undefined>) | undefined;
      outcome = (await script?.(rpc, this)) ?? (await this.execute(rpc, record, notices));
    } catch (error) {
      outcome = fail('failed', error instanceof Error ? error.message : String(error));
    }
    if (this.crashArmed?.(rpc)) {
      this.crashArmed = null;
      this.crashed = true;
      this.stopped = true;
      await this.link.drop();
      return;
    }
    this.memory.ledger[rpc.nonce].outcome = outcome;
    this.remember();
    await answer(outcome);
    for (const notice of notices) await notice();
  }

  /** Keeps what an effect left behind, in the step that made it: how a claim without an outcome is reconciled. */
  private traced(rpc: Rpc, record: RpcRecord, session: string | null, result: JsonObject, row?: Row): RpcOutcome {
    this.memory.trace[rpc.nonce] = { rpc: rpc.rpc, session, result, ...(row && { row }) };
    this.remember();
    record.executed = true;
    return done(result);
  }

  /** The default effects: what a bridged session would do, on the replay's state. */
  private async execute(rpc: Rpc, record: RpcRecord, notices: Array<() => Promise<void>>): Promise<RpcOutcome> {
    const member = rpc.member;
    if (this.options.bridge === false) {
      if (rpc.rpc === 'steer') return this.traced(rpc, record, rpc.args.session, { row: null });
      if (['interrupt', 'decide', 'answer', 'model', 'compact'].includes(rpc.rpc)) return fail('unsupported', 'the session has no bridge');
    }
    switch (rpc.rpc) {
      case 'steer': {
        const depth = this.sessions.get(rpc.args.session)!;
        if (depth.mainTurn === null) return fail('idle', 'no turn is running to steer: send it instead');
        // The bridge appends a steer (`$.session.append`), which the engine keeps meta with the plugin's origin: the
        // owner's words under the steer's own first line (doperpowers 7.180.0, DX5 `steer` [steer-line]).
        const row = { ...userRow(depth.id, `[sminos steer from human]\n${rpc.args.text}`), isMeta: true, origin: { kind: 'plugin', name: this.plugin } } as Row;
        const outcome = this.traced(rpc, record, depth.id, { row: row.uuid }, row);
        depth.appendRow(null, row);
        return outcome;
      }
      case 'interrupt': {
        const depth = this.sessions.get(rpc.args.session)!;
        return this.traced(rpc, record, depth.id, { turnId: depth.mainTurn, stopped: [], running: [] });
      }
      case 'decide':
      case 'answer': {
        const { digest } = rpc.args;
        const notPending = () => {
          const settled = this.settledRequests.get(digest.request);
          return fail('not-pending', settled ? `already settled: ${settled.outcome} (${settled.by})` : 'no such request is pending', settled ? { winner: settled.winner, by: settled.by } : {});
        };
        const held = this.pending.get(digest.request);
        if (!held) return notPending();
        const { raised } = held;
        const inputSha = await inputSha256(raised.input);
        // The request may have settled (the terminal, the replay) while its input was hashed.
        if (this.pending.get(digest.request) !== held) return notPending();
        if (digest.session !== raised.session || digest.tool !== raised.tool || digest.input_sha256 !== inputSha) {
          return fail('digest-mismatch', 'the request as drawn is not the one pending');
        }
        if (raised.deadline && Date.now() > Date.parse(raised.deadline) - 200) {
          return fail('not-pending', 'the window closed; the terminal answers it', { terminalOnly: true });
        }
        const outcome: Settled['outcome'] = rpc.rpc === 'answer' ? 'answered' : rpc.args.decision;
        if (!(await this.settle(digest.request, { winner: 'web', outcome, by: member }))) return notPending();
        return this.traced(rpc, record, raised.session, {});
      }
      case 'model': {
        const pick = (v: string | undefined, now: string | null) => (v === undefined ? now : v === 'default' ? null : v);
        const now = this.models.get(rpc.args.session) ?? { model: null, effort: null };
        const chosen = { model: pick(rpc.args.model, now.model), effort: pick(rpc.args.effort, now.effort) };
        this.models.set(rpc.args.session, chosen);
        return this.traced(rpc, record, rpc.args.session, chosen);
      }
      case 'compact': {
        const depth = this.sessions.get(rpc.args.session)!;
        if (depth.mainTurn !== null) {
          this.compactsAtTurnEnd.push({ session: depth.id, nonce: rpc.nonce });
          return this.traced(rpc, record, depth.id, { at: 'turn-end' });
        }
        // The compaction's progress is a notice after the answer, as the bridge's `compact` events are.
        notices.push(() => this.compact(depth.id, rpc.nonce));
        return this.traced(rpc, record, depth.id, { at: 'now' });
      }
      case 'spawn': {
        const checkouts = this.presence().checkouts;
        if (!checkouts.some((c) => c.path === rpc.args.checkout)) return fail('unknown-checkout', `${rpc.args.checkout} is not a known checkout here`);
        const session = randomUUID();
        const alias = `fake-${session.slice(0, 4)}`;
        const depth = new SessionDepth(session, null, (m) => this.queue({ t: 'session', message: m }), { project: this.project, machine: this.name }, true, this.diffBase(session), this.producer, this.plugin);
        this.sessions.set(session, depth);
        await this.write(`rpc:${rpc.nonce}:joined`, `${this.name}/${session}`, {
          kind: 'joined', session, alias, name_source: 'seat', machine: this.name, cwd: rpc.args.checkout, worktree: rpc.args.worktree ?? '', role: rpc.args.brief, seat: alias, by: member,
        });
        this.sendPresence(depth);
        await this.flush();
        return this.traced(rpc, record, session, { session, alias });
      }
      case 'retire': {
        const depth = this.sessions.get(rpc.args.session)!;
        await this.write(`rpc:${rpc.nonce}:retired`, `${this.name}/${depth.id}`, { kind: 'retired', session: depth.id, by: member, reason: 'retire' });
        depth.presence = null;
        this.sendPresence(depth);
        await this.flush();
        return this.traced(rpc, record, depth.id, {});
      }
      case 'resume': {
        const depth = this.sessions.get(rpc.args.session)!;
        if (depth.presence !== null) return fail('session-live', `${depth.id} is live on ${this.name}`);
        depth.presence = { status: 'idle', waitingFor: null, needs: null };
        this.sendPresence(depth);
        await this.flush();
        return this.traced(rpc, record, depth.id, { session: depth.id });
      }
      case 'stop': {
        // TaskStop through the bridge, then its note in the transcript, from which the job reads stopped.
        const depth = this.sessions.get(rpc.args.session)!;
        if (!depth.stopJob(rpc.args.taskId)) return fail('failed', `Task ${rpc.args.taskId} is not running (status: killed)`);
        await this.flush();
        return this.traced(rpc, record, depth.id, { taskId: rpc.args.taskId });
      }
      case 'command': {
        // The bridge's route check, then the op answered at once; its start and end follow as `op` notices.
        const depth = this.sessions.get(rpc.args.session)!;
        if (rpc.args.name === 'cd' && !this.presence().checkouts.some((checkout) => checkout.path === rpc.args.args?.trim())) return fail('unknown-checkout', 'use an absolute path of a known checkout of this project');
        const plan = this.commands.plan(rpc.args.name, rpc.args.args ?? '', depth.id, this.name, depth.catalog);
        if (!plan.ok) return fail('failed', refusalMessage(plan));
        notices.push(() => this.runCommand(depth, rpc.nonce, plan));
        return this.traced(rpc, record, depth.id, { queued: true, route: plan.route, id: plan.id });
      }
    }
  }

  /** A queued command: its `op` start now, its end now or, mid-turn, at the turn's end (H-queue). */
  private async runCommand(depth: SessionDepth, nonce: string, plan: Extract<CommandPlan, { ok: true }>): Promise<void> {
    this.sendSessionWide(opMessages({ project: this.project, machine: this.name }, depth.id, nonce, plan).start);
    if (depth.mainTurn !== null) {
      this.commandsAtTurnEnd.push({ session: depth.id, nonce, plan });
      await this.flush();
      return;
    }
    await this.finishCommand(depth.id, nonce, plan);
  }

  private async finishCommand(session: string, nonce: string, plan: Extract<CommandPlan, { ok: true }>): Promise<void> {
    this.sendSessionWide(opMessages({ project: this.project, machine: this.name }, session, nonce, plan).end);
    this.sessions.get(session)?.commandCatalog(plan.name);
    const { title } = plan.outcome;
    if (title !== undefined) await this.write(`rpc:${nonce}:titled`, `${this.name}/${session}`, { kind: 'titled', session, title });
    await this.flush();
  }

  private async compact(session: string, nonce: string): Promise<void> {
    const depth = this.sessions.get(session)!;
    const before = depth.usage?.context.tokens ?? null;
    const base = { project: this.project, machine: this.name, session, sub: null, n: null } as const;
    this.sendSessionWide({ ...base, kind: 'compact', body: { rpc: nonce, phase: 'start' } });
    this.sendSessionWide({ ...base, kind: 'compact', body: { rpc: nonce, phase: 'end', tokensBefore: before, tokensAfter: before === null ? null : Math.round(before / 5) } });
    await this.flush();
  }

  private async compactAtTurnEnd(session: string): Promise<void> {
    for (const held of this.compactsAtTurnEnd.filter((c) => c.session === session)) {
      this.compactsAtTurnEnd.splice(this.compactsAtTurnEnd.indexOf(held), 1);
      await this.compact(session, held.nonce);
    }
    // The commands the turn held run now, in the order they were queued.
    for (const held of this.commandsAtTurnEnd.filter((c) => c.session === session)) {
      this.commandsAtTurnEnd.splice(this.commandsAtTurnEnd.indexOf(held), 1);
      await this.finishCommand(session, held.nonce, held.plan);
    }
  }

  // Frames.

  private receive(frame: DownFrame): void {
    if (this.crashed) return;
    this.frames.push(frame);
    switch (frame.t) {
      case 'have':
        if (frame.project !== this.project) return;
        this.hubHave = frame.have;
        this.uploadFrom(frame.have);
        this.have?.(frame);
        this.have = null;
        return;
      case 'events':
        if (frame.project === this.project) this.chain = this.chain.then(() => this.import(frame.events)).catch((error: unknown) => void this.postErrors.push(error as Error));
        return;
      case 'resend':
        if (frame.project === this.project) this.uploadFrom({}, { writer: frame.writer, from: frame.from });
        return;
      case 'refused':
        this.refusals.push(frame.refusal);
        return;
      case 'rpc':
        void this.handleRpc(frame.rpc);
        return;
      case 'rpc-ack':
        delete this.memory.unacked[frame.nonce];
        this.remember();
        return;
      case 'subscribe':
        if (frame.project === this.project) void this.subscribe(frame);
        return;
      case 'unsubscribe':
        for (const depth of this.sessions.values()) if (depth.holds(frame.sub)) depth.end(frame.sub, 'unsubscribed');
        return;
      case 'rows':
        this.sessions.get(frame.session)?.page(frame.sub, frame.before, frame.limit);
        return;
      case 'diff':
        this.sessions.get(frame.session)?.diff(frame.sub);
        return;
      case 'output':
        this.sessions.get(frame.session)?.output(frame.sub, frame.taskId, frame.tail);
        return;
      case 'read':
        this.sessions.get(frame.session)?.read(frame.sub, frame.id, frame.what);
        return;
      default:
        return;
    }
  }

  private queue(frame: UpFrame): void {
    this.outbox.push(frame);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    setTimeout(() => void this.flush(), 0);
  }

  /** Posts everything queued, in order; resolves once the hub has taken it. */
  flush(): Promise<void> {
    this.flushScheduled = false;
    const frames = this.outbox.splice(0);
    if (frames.length && this.link.isOpen && !this.crashed) {
      this.flushing = this.flushing.then(() =>
        this.link.post(frames).catch((error: unknown) => {
          this.postErrors.push(error as Error);
          if (error instanceof LinkError) return this.refused(error);
          // The POST never reached an answer (the connection failed): nothing says what the hub took. The frames go
          // back to the front of the outbox for the next flush, and a machine that reconnects drops the stream, whose
          // handshake uploads every own event the hub lacks and republishes the rest.
          this.outbox.unshift(...frames);
          if (this.options.reconnect && !this.stopped && !this.crashed && !this.reconnecting) void this.drop();
        }),
      );
    }
    return this.flushing;
  }

  private remember(): void {
    this.options.onMemory?.(this.memory);
  }
}

/** A user row with the human's text: a delivered prompt, kept without its frame or origin (the fake's simplification). */
function userRow(session: string, text: string): Row {
  return { type: 'user', uuid: randomUUID(), sessionId: session, timestamp: new Date().toISOString(), isSidechain: false, message: { role: 'user', content: [{ type: 'text', text }] } } as Row;
}


/** What is wrong with an RPC's arguments for its name, or null: checked before anything is claimed. */
function argumentProblem(rpc: Rpc): string | null {
  const a = rpc.args as unknown as Record<string, unknown> | null;
  if (typeof a !== 'object' || a === null || Array.isArray(a)) return 'args is an object';
  const str = (k: string) => typeof a[k] === 'string';
  const optStr = (k: string) => a[k] === undefined || typeof a[k] === 'string';
  const needs = (ok: boolean, what: string) => (ok ? null : `${rpc.rpc}'s args are ${what}`);
  const digest = a.digest as Record<string, unknown> | undefined;
  const digestOk = typeof digest === 'object' && digest !== null && ['session', 'request', 'tool', 'input_sha256'].every((k) => typeof digest[k] === 'string');
  // A decision acts on the session it names: a digest of another session's request is malformed, as the real machine
  // has it (sminos_rpc.py's `need`, "the digest names another session").
  const ownSession = () => (digest!.session === a.session ? null : 'the digest names another session');
  switch (rpc.rpc) {
    case 'steer':
      return needs(str('session') && str('text'), '{session, text}');
    case 'interrupt':
    case 'compact':
    case 'retire':
    case 'resume':
      return needs(str('session'), '{session}');
    case 'decide':
      return (
        needs(str('session') && digestOk && (a.decision === 'allow' || a.decision === 'deny') && optStr('message'), '{session, digest, decision: allow | deny, message?}') ??
        ownSession()
      );
    case 'answer': {
      const answers = a.answers as Record<string, unknown> | undefined;
      const answersOk = typeof answers === 'object' && answers !== null && !Array.isArray(answers) && Object.values(answers).every((v) => typeof v === 'string');
      return needs(str('session') && digestOk && answersOk, '{session, digest, answers: {question: label}}') ?? ownSession();
    }
    case 'model':
      return needs(str('session') && optStr('model') && optStr('effort') && (a.model !== undefined || a.effort !== undefined), '{session, model?, effort?} with at least one');
    case 'stop':
      return needs(str('session') && isTaskId(a.taskId), '{session, taskId}, taskId as the engine spells it');
    case 'spawn':
      return needs(str('checkout') && str('brief') && ['worktree', 'model', 'effort', 'permission_mode'].every(optStr), '{checkout, brief, worktree?, model?, effort?, permission_mode?}');
    case 'command': {
      const name = a.name;
      const nameOk = typeof name === 'string' && name.length >= 1 && name.length <= 128 && !hasControl(name);
      return needs(str('session') && nameOk && optStr('args') && (a.args === undefined || (a.args as string).length <= 4096), '{session, name: 1 to 128 characters without a control character, args?: at most 4,096}');
    }
    default:
      return `no RPC ${String((rpc as { rpc: unknown }).rpc)}`;
  }
}

/** The ask mod's tool as each plugin it has run in registers it (doperpowers' sminos plugin design, §11). */
const ASK_TOOL_IN: Record<BridgePlugin, string> = { doperpowers: 'mcp__doperpowers__AskUserQuestion', sminos: 'mcp__sminos__AskUserQuestion' };
const OLD_ASK_TOOL = ASK_TOOL_IN.doperpowers;
const QUESTION_TOOLS = new Set(['AskUserQuestion', ...Object.values(ASK_TOOL_IN)]);

/**
 * Whether a decision or an answer fits the request it names, as the bridge's decision route checks it (DX5): a question
 * is answered (`answer`, its answers keyed by its questions) or denied, and an async one is never denied; a permission
 * prompt is allowed or denied (`decide`). Every misfit fails `bad-shape` (composite dd908dfa), with the bridge's own
 * words, and answers not keyed by exactly its questions too.
 */
function decisionMisfit(rpc: Rpc<'decide' | 'answer'>, raised: Raised): RpcOutcome | null {
  const question = QUESTION_TOOLS.has(raised.tool) || raised.async === true;
  if (!question) return rpc.rpc === 'answer' ? fail('bad-shape', 'a permission is allowed or denied as asked: updatedInput carries a question\'s answers only') : null;
  if (rpc.rpc === 'decide' && rpc.args.decision === 'allow') return fail('bad-shape', 'a question is allowed with its answers: updatedInput.answers, keyed by the question');
  if (rpc.rpc === 'decide' && raised.async) return fail('bad-shape', 'an async question waits for an answer; it cannot be denied');
  if (rpc.rpc === 'answer') {
    const asked = ((raised.input.questions as Array<{ question?: unknown }> | undefined) ?? []).map((q) => String(q.question));
    const given = Object.keys(rpc.args.answers);
    if (given.length !== asked.length || !given.every((q) => asked.includes(q))) return fail('bad-shape', `the answers are keyed by the request's questions: ${asked.join(' | ')}`);
  }
  return null;
}
