// One project: its log (DX2's sync with machines, DX3's resume for browsers), its audit record, and its session plane
// (DX4, DX6), held by a Durable Object on SQLite. Browsers hold WebSockets accepted with the Hibernation API, each
// tagged with its own id and carrying its member, visibility, log mark, and subscriptions' numbering in its attachment;
// the routes from a subscription to its socket are in storage. So a woken object routes again before it handles
// anything: hibernation is the common path (M1's probe). Machines reach it through their `Machine` objects
// (`fromMachine`, `renew`, `closed`), and it reaches them back the same way, two ordered queues of its own per machine
// stream: the log plane's replies and the browsers' control frames.
//
// What the session plane keeps survives an eviction while sockets stay open (§2): machines' leases and presence,
// sessions' presence, the pending set, delivery outcomes, RPC records, and subscription routes (session-store.ts).
// A machine is online while its lease is fresh; when its stream closes, or a newer stream replaces it, the stream's
// subscriptions end at the browsers and its forwarded RPCs without a result become `uncertain`. A stream's close does
// not put the machine offline at once: its lease holds for a grace (`graceMs`, one heartbeat), long enough for the
// machine's next stream to take it over, so a reconnect (the daemon's, or one the hub's own object forced) never flaps
// the machine's presence. A subscription or an RPC a browser sends in that grace waits for the next stream (`PARKED`)
// and is carried to it at its `hello`. When the lease lapses (the grace or the lease ran out) or the machine is revoked,
// the machine is offline, and what still waited ends too: a waiting subscription ends, a waiting RPC fails
// `machine-offline` (it never reached the machine).
//
// The log takes v1 (DX1's `mac`), dual-coded and v2-only (RL8's `sig`) events alike (O11 M5). A v2 signature is checked
// before its event is stored, by the protocol package against the org-state head this object caches from its Registry
// (signed-events.ts); a `mac` is still never checked here.
import { DurableObject } from 'cloudflare:workers';
import { HISTORY_PAGE_BYTES, isHistoryAttestation, isSigned, machineNameKey, verifyHistorySigner, type HistoryAttestation, type HistoryLogPage, type LogEventV2, type Signed } from 'org-protocol';
import { MEMBER_HEADER, ORG_HEADER, PROJECT_HEADER, type Env } from '../env';
import { isBase64urlOf } from '../protocol/base64url';
import { BROWSER_SET_LIMIT, BROWSER_SET_PARTS, isOutputTail, isTaskId, OUTPUT_TAIL_MAX, readShapeError, type AuditEntry, type PendingRequest, type ProjectDown, type PushNotice } from '../protocol/browser';
import { canonicalize } from '../protocol/canonical';
import { isMemberId, type OrgStateView, type ProjectRecord } from '../protocol/identity';
import type { JsonObject } from '../protocol/json';
import { HUB_WRITER_PREFIX, hubWriter, isHubPosition, isIsoMillis, LEGACY_WRITER_PREFIX, questionEffect, withoutPosition, writerMachine, type LogEvent, type Vector } from '../protocol/log';
import type { DownFrame, RefusedFrame, Refusal, Rejection, UpFrame } from '../protocol/machine';
import { FRAME_LIMIT, PartAssembler, PartsBudgetError, toWire, type Part } from '../protocol/parts';
import { RPC_FRESHNESS_MS, RPC_NAMES, type Rpc, type RpcError, type RpcErrorCode, type RpcOutcome } from '../protocol/rpc';
import { SESSION_WIDE_KINDS, SUBSCRIPTION_KINDS, SUGGESTION_BYTES_MAX, SUGGESTIONS_MAX, type Delivery, type MachinePresence, type Raised, type SessionKind, type SessionMessage, type Settled } from '../protocol/session';
import type { Sent } from './machine';
import { HistoryStore } from './history-store';
import { BATCH_BYTES, eventShapeError, LogStore, resendNonce, sameEvent, type AuditRow, type Stored } from './log-store';
import type { Result, SummaryReport } from './registry';
import { RETRY_ATTEMPTS, RETRY_BASE_MS, retryDelay } from './retry';
import { pendingKey, SessionStore, type Lease, type Route, type RpcRecord } from './session-store';
import { SignedEvents, STATE_READ_TIMEOUT_MS, STATE_UNAVAILABLE, type SignatureCheck } from './signed-events';

/** A `.smns` project id (a lowercase uuid). */
export const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A browser socket's attachment (at most 2,048 bytes serialized): its id, which is also its hibernation tag, the member
 * the Worker admitted, whether its tab shows the project, whether it follows the log live (from its `caught-up` on;
 * false while it pages through the backlog), and for each of its
 * subscriptions the `n` the browser expects next (one past the last relayed), so an `end` the hub writes itself carries
 * the right `n` after a hibernation too.
 */
/** `visibleAt`: when the socket last said it is visible (ms), or null while it says it is not; it counts as visible for
 * `VISIBLE_MS` after (DX3: a visible tab re-sends `visibility` every 30 s). */
export type SocketAttachment = { id: string; member: string; visibleAt: number | null; log: boolean; subs: Record<string, number> };

/** How long a socket's last `visibility {visible: true}` holds its member's pushes back. */
export const VISIBLE_MS = 90_000;

/** Who sent a machine's frame: its org, the project it names, the machine and the credential its stream was opened
 * with, the stream the POST belongs to, how long a renewal on that stream keeps the machine online, and how long the
 * lease holds after that stream closes (`graceMs`; absent from a `Machine` of an older deploy, whose closes lapse at
 * once as before). `transport` is `rl1` for a frame off a machine's RL1 socket (O11 M6), absent for DX2's stream. */
export type MachineContext = { org: string; project: string; machine: string; client: string; generation: number; leaseMs: number; graceMs?: number; transport?: 'rl1' };

/** The `kv` key of the newest org state announced to this project and the member ids it holds (`stateAdvanced`). */
const STATE_MEMBERS = 'state-members';
type StateMembers = { version: number; members: string[] };

/** A route's generation while its subscription waits for the machine's next stream: no stream is generation 0. */
const PARKED = 0;

/** How many audit entries a browser that resumes is shown after `caught-up`. */
const AUDIT_REPLAY = 100;
/** `log` frames (of about BATCH_BYTES, 256 KiB) in one page of a resume: about 1 MiB. */
const RESUME_PAGE_FRAMES = 4;
/** Subscriptions one socket may hold: their numbering rides in its attachment, which holds 2,048 bytes. */
const MAX_SUBS = 32;
/** A `<message>` or a `question` event pushes when it is this fresh: a machine's first sync uploads its whole backlog,
 * which must not. */
const PUSH_FRESH_MS = 10 * 60 * 1000;
const REJECTION_REASONS = new Set<string>(['bad-code', 'seen-nonce', 'bad-shape', 'conflict']);
const IN_SUB = new Set<string>(SUBSCRIPTION_KINDS);
const SESSION_WIDE = new Set<string>(SESSION_WIDE_KINDS);
const SETTLED_WINNERS = new Set(['web', 'terminal', 'other']);
const SETTLED_OUTCOMES = new Set(['allow', 'deny', 'answered', 'withdrawn']);
const DELIVERY_OUTCOMES = new Set(['delivered', 'recorded', 'refused-read-only', 'uncertain', 'failed']);
const encoder = new TextEncoder();

const newSocketId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isName = (v: unknown, max = 200): v is string => typeof v === 'string' && v !== '' && v.length <= max;

export class Project extends DurableObject<Env> {
  private readonly log: LogStore;
  private readonly plane: SessionStore;
  /** Machines' attestations of their phase-1 history in this log (O14 M4). */
  private readonly history: HistoryStore;
  /** This project's two promise chains per machine stream (`<machine>#<generation>#<lane>`, the `replies` and
   * `control` lanes), so every frame this object sends a stream on one lane arrives in the order it was queued there; a
   * chain that failed stays failed, its stream ended (`toMachine`). */
  protected readonly queues = new Map<string, Promise<void>>();
  /** Part sets a socket is sending (lost with a hibernation, as the socket's half-sent frame would be). */
  private readonly parts = new Map<WebSocket, PartAssembler>();
  /** Every subscription's route, rebuilt from storage whenever the object starts, woken or restarted. */
  private readonly routes = new Map<string, Route>();
  /** When this instance was constructed: the suites tell a woken object from the one before it by this. */
  protected readonly life = `${Date.now()}-${Math.random()}`;
  /** The retry of a summary report the Registry did not acknowledge, waiting for its time: one at most, any report sent
   * meanwhile superseding it (`reportFailed`; an object restart forgets it). */
  private reportRetry: ReturnType<typeof setTimeout> | undefined;
  /** v2 events' signatures, checked against the org-state head cached from the Registry (O11 M5). */
  private readonly signatures: SignedEvents;
  /** Each member's `human`s, taken one at a time in arrival order: a signed one waits for its check (`human`). */
  private readonly humans = new Map<string, Promise<void>>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.log = new LogStore(ctx.storage);
    this.plane = new SessionStore(ctx.storage);
    this.history = new HistoryStore(ctx.storage);
    this.signatures = new SignedEvents(
      () => this.readOrgState(),
      () => this.now(),
      () => this.stateReadTimeoutMs(),
    );
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS machines (name TEXT PRIMARY KEY, generation INTEGER NOT NULL)');
    // A route whose socket is gone (a restart drops every connection, and a socket's close may not have reached a
    // restarted object) is dropped; its machine's stream went with the restart too.
    for (const route of this.plane.routes()) {
      if (ctx.getWebSockets(route.socket).length > 0) this.routes.set(route.sub, route);
      else this.plane.deleteRoute(route.sub);
    }
  }

  // ---- Browsers ------------------------------------------------------------------------------------------------

  /** A browser's socket. The Worker sends one only for a project the registry holds. */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/socket') return new Response('not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected a WebSocket', { status: 426 });
    const member = request.headers.get(MEMBER_HEADER) ?? '';
    // The Worker admitted the member against the Registry's head, and a state announced since may have dropped them.
    if (!this.stateHolds(member)) return Response.json({ error: 'removed' }, { status: 403 });
    this.remember(request.headers.get(ORG_HEADER) ?? '', request.headers.get(PROJECT_HEADER) ?? '');
    this.sweepLeases();
    const id = newSocketId();
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [id]);
    server.serializeAttachment({ id, member, visibleAt: null, log: false, subs: {} } satisfies SocketAttachment);
    this.toSocket(server, { t: 'welcome', project: this.projectId, member, head: this.log.head() });
    this.toSocket(server, this.machinesFrame());
    // Each session's latest presence, but never a lapsed machine's as current: its sessions' presence is unknown.
    for (const { machine, message } of this.plane.presence()) if (this.isOnline(machine)) this.toSocket(server, { t: 'session', message });
    this.toSocket(server, this.pendingFrame());
    // Outcomes stay useful when their machine is offline. They are receipts, not fresh presence.
    for (const message of this.plane.ops(Date.now())) this.toSocket(server, { t: 'session', message });
    for (const deliveries of batched(this.plane.deliveries())) this.toSocket(server, { t: 'deliveries', deliveries });
    if (this.plane.deliveries().length === 0) this.toSocket(server, { t: 'deliveries', deliveries: [] });
    return new Response(null, { status: 101, webSocket: client });
  }

  /** A frame on the wire: at most 1 MiB, measured before it is read; a part joins its set, and a whole set is one
   * logical frame, which may be larger, up to BROWSER_SET_LIMIT in BROWSER_SET_PARTS parts. */
  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const bytes = typeof message === 'string' ? (message.length > FRAME_LIMIT ? message.length : encoder.encode(message).length) : message.byteLength;
    if (bytes > FRAME_LIMIT) return this.refuseBrowser(socket, { reason: 'too-large', message: 'a frame is at most 1 MiB on the wire; send a larger one as parts' });
    let frame: { t?: unknown; [key: string]: unknown };
    try {
      frame = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
    } catch {
      return this.refuseBrowser(socket, { reason: 'bad-shape', message: 'a frame is JSON' });
    }
    if (frame?.t !== 'part') return this.dispatch(socket, frame);
    let assembler = this.parts.get(socket);
    if (!assembler) this.parts.set(socket, (assembler = new PartAssembler({ maxSetBytes: BROWSER_SET_LIMIT, maxSetParts: BROWSER_SET_PARTS })));
    let whole: unknown;
    try {
      whole = assembler.add(frame as unknown as Part);
    } catch (error) {
      if (error instanceof PartsBudgetError) return this.refuseBrowser(socket, { reason: 'too-large', message: error.message });
      return this.refuseBrowser(socket, { reason: 'bad-shape', message: 'a malformed part' });
    }
    if (whole !== undefined) await this.dispatch(socket, whole as { t?: unknown; [key: string]: unknown });
  }

  /** A whole logical frame from a browser. */
  private dispatch(socket: WebSocket, frame: { t?: unknown; [key: string]: unknown } | null): void | Promise<void> {
    switch (frame?.t) {
      case 'resume':
        return this.resume(socket, frame.after);
      case 'human':
        return this.human(socket, frame.event);
      case 'rpc':
        return this.rpc(socket, frame.rpc);
      case 'subscribe':
        return this.subscribe(socket, frame);
      case 'unsubscribe':
        return this.unsubscribe(socket, frame.sub);
      case 'rows':
        return this.rows(socket, frame);
      case 'diff':
        return this.diff(socket, frame.sub);
      case 'output':
        return this.output(socket, frame);
      case 'read':
        return this.read(socket, frame);
      case 'visibility':
        if (typeof frame.visible !== 'boolean') return this.refuseBrowser(socket, { reason: 'bad-shape', message: 'visibility is {visible: boolean}' });
        return this.attach(socket, (a) => ({ ...a, visibleAt: frame.visible ? Date.now() : null }));
      default:
        return this.refuseBrowser(socket, { reason: 'bad-shape', message: `no frame ${JSON.stringify(frame?.t)}` });
    }
  }

  /** A browser that goes takes its subscriptions with it, at the machines too. */
  async webSocketClose(socket: WebSocket): Promise<void> {
    this.parts.delete(socket);
    const { id } = this.attachment(socket);
    for (const route of [...this.routes.values()]) {
      if (route.socket !== id) continue;
      this.dropRoute(route);
      if (this.leaseServes(route)) void this.toMachine(route.machine, route.generation, { t: 'unsubscribe', project: this.projectId, sub: route.sub }, 'control');
    }
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket);
  }

  // ---- Machines ------------------------------------------------------------------------------------------------

  /**
   * The frames a machine posted for this project, in the POST's order, handed over by its `Machine` object in one call
   * (one call per frame cost a Durable Object round trip each: M5's measured run). Applied one by one, as before; the
   * call stops before a frame once this project knows of a newer stream of the machine, and says so, so the POST is
   * refused `stale-generation` with what it applied. A frame counts as applied once the replies it owes the machine
   * are on the stream — its own, never what else is queued for the stream; a frame that throws, or whose owed reply was
   * not written (it threw, or answered 'offline': the stream went, or a write outlasted its bound), stops the call as
   * `failed`, uncounted, with the frames before it counted and none after it applied, so the POST's `503
   * delivery-failed` still says what was applied. The failure is logged (`frame-failed`, `reply-unwritten`).
   *
   * `refused` names the counted frames this project refused whole, by their place in `frames` (MAWS #88): the POST's
   * answer names them, beside the refusal each still sends down the stream.
   */
  async fromMachine(ctx: MachineContext, frames: UpFrame[]): Promise<{ applied: number; stale: boolean; failed: boolean; refused: RefusedFrame[] }> {
    this.remember(ctx.org, ctx.project);
    const refused: RefusedFrame[] = [];
    let applied = 0;
    for (const frame of frames) {
      if ((this.plane.lease(ctx.machine)?.generation ?? 0) > ctx.generation || this.isRevoked(ctx.machine, ctx.generation)) return { applied, stale: true, failed: false, refused };
      try {
        const taken = await this.fromMachineFrame(ctx, frame);
        if (taken === 'stale') return { applied, stale: true, failed: false, refused };
        // None for most of a stream's frames. A reply that resolves 'offline' (the stream went, or a write outlasted its
        // bound) was not written, as surely as one that threw: the frame does not count, and nothing after it applies.
        if ((await Promise.all(taken.owed)).some((sent) => sent !== 'written')) {
          logged({ event: 'reply-unwritten', ...where(ctx, frame, applied) });
          return { applied, stale: false, failed: true, refused };
        }
        if (taken.refused) refused.push({ index: applied, reason: taken.refused.reason });
      } catch (error) {
        logged({ event: 'frame-failed', ...where(ctx, frame, applied), error: described(error) });
        return { applied, stale: false, failed: true, refused };
      }
      applied++;
    }
    return { applied, stale: false, failed: false, refused };
  }

  /** One frame from a machine: the writes it queued that its POST owes the machine before it counts as applied (a
   * hello's `have`, an upload's `resend` and `refused`, a log frame's refusal), and the refusal when the frame was
   * refused whole; or 'stale' when a newer stream of the machine outlived it while it waited, before it changed
   * anything. A session-plane frame owes nothing: what it sends the machine goes on the control lane, and its POST is
   * held for this one call whatever the replies lane holds. An upload some of whose events were refused was not refused
   * whole: those refusals go down the stream alone. */
  private async fromMachineFrame(ctx: MachineContext, frame: UpFrame): Promise<'stale' | Taken> {
    // A lease whose time ran out lapses before anything the machine sent is served, whether or not its alarm ran yet.
    this.sweepLeases();
    if (frame.t === 'hello') return this.hello(ctx, frame);
    if (!this.isOpen(ctx)) {
      const refusal: Refusal = { reason: 'not-open', message: 'send hello for this project on this stream first' };
      if (frame.t === 'events') return { owed: [this.refusal(ctx, refusal)], refused: refusal };
      return { owed: [], refused: this.refuseMachine(ctx, refusal) };
    }
    if (frame.t === 'events') return this.upload(ctx, frame.events);
    let refused: Refusal | void = undefined;
    if (frame.t === 'rejected') refused = this.rejected(ctx, frame);
    else if (frame.t === 'rpc-result') refused = this.rpcResult(ctx, frame);
    else if (frame.t === 'pending') refused = this.pendingSet(ctx, frame.raised);
    else if (frame.t === 'session') refused = this.session(ctx, frame.message);
    return refused ? { owed: [], refused } : { owed: [] };
  }

  /** The daemon answered a heartbeat on the stream this lease belongs to: the machine stays online, or is online again
   * after a lapse. A lease whose time ran out lapses first, its stream's work ended, even when its alarm has not run:
   * a renewal never carries that work over. A renewal from any other generation, or one that arrives after its stream
   * closed, is ignored. */
  renew(ctx: MachineContext): void {
    this.remember(ctx.org, ctx.project);
    this.sweepLeases();
    const lease = this.plane.lease(ctx.machine);
    if (!lease || lease.generation !== ctx.generation || lease.closed || this.isRevoked(ctx.machine, ctx.generation)) return;
    const wasOnline = this.isFresh(lease);
    this.plane.putLease({ ...lease, expires: Date.now() + ctx.leaseMs, online: true });
    if (!wasOnline) this.cameOnline(ctx.machine);
    void this.schedule();
  }

  /** The stream this lease belongs to closed: what the stream carried ends at once, and the lease, closed (nothing of
   * that generation renews it again), holds the machine online for the grace, for its next stream to take over; it
   * lapses when the grace runs out. A close of an older generation is ignored. A close of a newer one than the lease
   * (its first `hello` here still waits on the Registry, or never came) ends the older stream's work and leaves the
   * closed generation's own lease, so that `hello` opens nothing, held through the grace as the older one was. */
  closed(ctx: MachineContext): void {
    this.remember(ctx.org, ctx.project);
    this.sweepLeases();
    const lease = this.plane.lease(ctx.machine);
    if (lease && (lease.generation > ctx.generation || (lease.generation === ctx.generation && lease.closed))) return;
    const holding = lease !== undefined && this.isFresh(lease);
    if (lease && holding) this.endStreamWork(ctx.machine, lease.generation, false);
    const grace = Math.min(lease?.expires ?? 0, Date.now() + (ctx.graceMs ?? 0));
    if (!lease || lease.generation < ctx.generation) {
      const held = holding && grace > Date.now();
      this.plane.putLease({ machine: ctx.machine, client: ctx.client, generation: ctx.generation, expires: held ? grace : 0, online: held, closed: true, follow: lease?.follow ?? false });
      if (holding && !held) this.lapsed(ctx.machine);
      void this.schedule();
      return;
    }
    if (holding && grace > Date.now()) this.plane.putLease({ ...lease, expires: grace, closed: true });
    else if (lease.online) this.lapse({ ...lease, closed: true });
    else this.plane.putLease({ ...lease, closed: true });
    void this.schedule();
  }

  /**
   * The machine was revoked from the org (DX7), its streams through `generation` with it: from now on the grid does not
   * count it, and a frame those streams still carry (a POST the Worker admitted before the revocation) is refused as
   * stale. Its sessions keep their history and read as on a machine that is offline. A machine enrolled again under the
   * name opens a newer stream, and counts again once it opens the project.
   *
   * A revoked stream's lease ends here, as that stream's close would end it: the close may never come (a Machine object
   * that restarted holds no stream to end, and the close is sent unawaited). A newer stream's lease is the name's anew.
   */
  forget(org: string, project: string, machine: string, generation: number): void {
    this.remember(org, project);
    this.plane.revoke(machine, generation);
    const lease = this.plane.lease(machine);
    if (lease?.online && lease.generation <= generation) this.lapse({ ...lease, closed: true });
    this.reportSummary();
  }

  /**
   * The Registry's announcement of an accepted org state (O11 M3): `version` is the state's, `members` the ids it holds.
   * The newest announced is kept (an older one arriving late changes nothing), every socket of a member it does not
   * hold closes `4403 removed`, and a socket the Worker admitted before the state but that reaches this object after it
   * is refused at its accept (`stateHolds`): a removed member keeps no read of the log, hibernated sockets included,
   * whose attachments name their member. The head v2 events are checked against is read again when it is older than
   * `version` (M5, signed-events.ts).
   */
  async stateAdvanced(version: number, members?: string[]): Promise<void> {
    // Called first, so the cached head counts as old before anything here waits.
    const refreshed = this.signatures.advanced(version);
    if (members !== undefined) await this.keepMembers(version, members);
    await refreshed;
  }

  private async keepMembers(version: number, members: string[]): Promise<void> {
    const held = this.ctx.storage.kv.get<StateMembers>(STATE_MEMBERS);
    if (held && held.version >= version) return;
    this.ctx.storage.kv.put(STATE_MEMBERS, { version, members } satisfies StateMembers);
    const kept = new Set(members);
    for (const socket of this.ctx.getWebSockets()) {
      if (kept.has(this.attachment(socket).member)) continue;
      await this.webSocketClose(socket);
      try {
        socket.close(4403, 'removed');
      } catch {
        // already closing
      }
    }
  }

  /** Whether the newest org state announced here holds `member` (any member, before the first announcement). */
  private stateHolds(member: string): boolean {
    const held = this.ctx.storage.kv.get<StateMembers>(STATE_MEMBERS);
    return held === undefined || held.members.includes(member);
  }

  /** Leases that lapsed, request windows that closed, and command receipts past retention, without new traffic. */
  async alarm(): Promise<void> {
    this.sweepLeases();
    if (this.plane.flipDeadlines(Date.now()) > 0) this.pendingChanged();
    this.plane.expireOps(Date.now());
    await this.schedule();
  }

  // The log handshake (DX2): the hub's vector and whether this machine writes the archive, then every writer's suffix
  // the machine lacks. The machine joins the fan-out in the same step the backlog is read, so an event stored after it
  // goes out live behind the backlog, and none falls between. The `hello` also starts the machine's lease here, a
  // follower's (`follow`) as a holder's, and says which the machine is.
  private async hello(ctx: MachineContext, frame: Extract<UpFrame, { t: 'hello' }>): Promise<Taken> {
    const have = frame.have as unknown;
    const valid =
      typeof frame.name === 'string' &&
      frame.name !== '' &&
      frame.name.length <= 200 &&
      typeof have === 'object' &&
      have !== null &&
      !Array.isArray(have) &&
      Object.values(have).every((seq) => Number.isSafeInteger(seq) && (seq as number) >= 0) &&
      (frame.follow === undefined || typeof frame.follow === 'boolean');
    if (!valid) {
      const refusal: Refusal = { reason: 'bad-shape', message: 'hello is {project, name, have: {writer: seq}, follow?: boolean}' };
      return { owed: [this.refusal(ctx, refusal)], refused: refusal };
    }
    const record = await this.register(ctx.project, frame.name, ctx.machine);
    // A newer stream of this machine may have opened the project while the registry answered: it keeps its place.
    this.ctx.storage.sql.exec(
      'INSERT INTO machines (name, generation) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET generation = excluded.generation WHERE excluded.generation > machines.generation',
      ctx.machine,
      ctx.generation,
    );
    if (!this.isOpen(ctx)) return { owed: [] };
    this.startLease(ctx, frame.follow === true);
    const owed = this.toMachine(ctx.machine, ctx.generation, { t: 'have', project: ctx.project, have: this.log.vector(), archive: record.archive_machine === ctx.machine }, 'replies');
    // The backlog is the log as of now, read a page at a time as the stream takes it: a page is read once the page
    // before it is written, so a long log is never held whole. An event stored from now on goes out live, queued
    // behind the whole backlog. The hello's POST waits for its `have` alone: a page that cannot be written ends the
    // stream through the send's own failure.
    const pages = this.log.beyond(have as Vector, this.log.head());
    void this.toMachineAll(ctx.machine, ctx.generation, mapped(pages, (events): DownFrame => ({ t: 'events', project: ctx.project, events })), 'replies');
    return { owed: [owed] };
  }

  // A machine's upload: each event stored once at the next seq of its writer, a copy of a stored one passed over, a
  // gap answered by `resend`, and a writer the machine may not write, a different payload at a stored position (its
  // `sig` included: ECDSA's are malleable, so a re-signed copy is another payload), or a v2 event whose signature the
  // org state does not verify, refused, reported, and recorded. A writer stops at its first refusal or gap in a batch.
  // The v2 signatures are checked first, every one that may be stored, so the batch is then stored in one step with no
  // wait inside it.
  private async upload(ctx: MachineContext, events: unknown): Promise<'stale' | Taken> {
    if (!Array.isArray(events)) {
      const refusal: Refusal = { reason: 'bad-shape', message: 'events is a list' };
      return { owed: [this.refusal(ctx, refusal)], refused: refusal };
    }
    const owed: Promise<Sent>[] = [];
    const refuse = (refusal: Refusal) => void owed.push(this.refusal(ctx, refusal));
    let archive: string | null | undefined;
    if (events.some((e) => typeof e?.writer === 'string' && e.writer.startsWith(LEGACY_WRITER_PREFIX))) {
      archive = await this.archiveMachine(ctx.project);
      // A newer stream may have opened the project while the Registry answered: this upload is the retired stream's,
      // and stores nothing.
      if ((this.plane.lease(ctx.machine)?.generation ?? 0) > ctx.generation || !this.isOpen(ctx)) return 'stale';
    }
    const checked = await this.checkSignatures(ctx, events, archive);
    // As above, and a revocation of this stream (DX7's `forget`) that came while the head was read: either way the
    // upload is the retired stream's.
    if (checked.size > 0 && ((this.plane.lease(ctx.machine)?.generation ?? 0) > ctx.generation || !this.isOpen(ctx) || this.isRevoked(ctx.machine, ctx.generation))) return 'stale';
    const accepted: Stored[] = [];
    const stopped = new Set<string>();
    for (const event of events as LogEvent[]) {
      const problem = eventShapeError(event);
      const position = positionOf(event);
      if (problem) {
        if (position.writer !== undefined) {
          if (stopped.has(position.writer)) continue;
          stopped.add(position.writer);
        }
        refuse({ reason: problem === 'an event is at most 1 MiB' ? 'too-large' : 'bad-shape', ...position, message: problem });
        continue;
      }
      const { writer, seq } = event;
      if (stopped.has(writer)) continue;
      const mine = writerMachine(writer) === ctx.machine || (writer.startsWith(LEGACY_WRITER_PREFIX) && archive === ctx.machine);
      if (!mine) {
        stopped.add(writer);
        refuse({ reason: 'writer-not-yours', writer, seq, message: `${ctx.machine} writes only ${ctx.machine}/… (and legacy/… as the archive machine)` });
        continue;
      }
      const last = this.log.last(writer);
      if (seq <= last) {
        if (!sameEvent(this.log.at(writer, seq)!.event, event)) {
          stopped.add(writer);
          refuse({ reason: 'conflict', writer, seq, message: 'a different payload is stored at this position' });
        }
      } else if (seq === last + 1) {
        const signature = event.sig === undefined ? undefined : (checked.get(event) ?? STATE_UNAVAILABLE);
        if (signature && !signature.ok) {
          stopped.add(writer);
          refuse({ reason: signature.reason, writer, seq, message: signature.message });
          continue;
        }
        accepted.push(this.log.append(event));
      } else {
        stopped.add(writer);
        owed.push(this.toMachine(ctx.machine, ctx.generation, { t: 'resend', project: ctx.project, writer, from: last + 1 }, 'replies'));
      }
    }
    this.fanOut(accepted, ctx.machine);
    // An async question opened, answered, or ended with its session: the grid's `waiting` may move (owner, 2026-10-18).
    if (accepted.some(({ event }) => questionEffect(event) !== null)) this.reportSummary();
    const now = Date.now();
    // A machine on RL1 pushes through its own `notify` (O11 M6): it knows a private session from a listed one, and its
    // requests wait in channels the log never sees. The log plane pushes nothing for it, so nothing is pushed twice.
    for (const { event } of ctx.transport === 'rl1' ? [] : accepted) {
      if ((event.kind !== 'message' && event.kind !== 'question') || !(now - Date.parse(event.ts) <= PUSH_FRESH_MS)) continue;
      const session = event.writer.slice(event.writer.indexOf('/') + 1);
      // An async ask (2026-10-18): its `question` event is the one signal of an ask nothing raises (MAWS's own), and a
      // second report of one a bridge raised as well (`src` its call's id), which pushes once, whichever came first.
      if (event.kind === 'question' && typeof event.src === 'string' && !this.plane.markAsked(ctx.machine, session, event.src, now)) continue;
      // The count holds the question this push announces while it is open: it is stored above (`waitingSessions`).
      this.push({ v: 1, project: this.projectId, session, alias: typeof event.from === 'string' ? event.from : null, kind: event.kind, event: { writer: event.writer, seq: event.seq } }, this.waitingSessions().size, event.writer.slice(0, event.writer.indexOf('/')));
    }
    return { owed };
  }

  /**
   * The v2 signature of each event of an upload that may be stored: well formed, the machine's to write, and past its
   * writer's last stored seq (a copy of a stored event, or a conflict, is decided by its bytes alone). An event past a
   * stored seq now stays past it, so every event `upload` stores was checked here. The batch is judged against one head
   * (`SignedEvents.checkAll`): no event keeps a verdict from a state a later read in the batch moved past.
   */
  private async checkSignatures(ctx: MachineContext, events: unknown[], archive: string | null | undefined): Promise<Map<unknown, SignatureCheck>> {
    const candidates = (events as LogEvent[]).filter((event) => {
      if (eventShapeError(event) !== null || event.sig === undefined || event.seq <= this.log.last(event.writer)) return false;
      return writerMachine(event.writer) === ctx.machine || (event.writer.startsWith(LEGACY_WRITER_PREFIX) && archive === ctx.machine);
    });
    if (candidates.length === 0) return new Map();
    const checks = await this.signatures.checkAll({ org: ctx.org, project: ctx.project }, candidates as LogEventV2[]);
    return new Map(candidates.map((event, i) => [event, checks[i]]));
  }

  /** A daemon's report of an event it refused: recorded in the audit record and shown to every browser. */
  private rejected(ctx: MachineContext, frame: Extract<UpFrame, { t: 'rejected' }>): Refusal | void {
    const event = frame.event as unknown;
    const valid =
      REJECTION_REASONS.has(frame.reason) &&
      (event === null || (typeof event === 'object' && typeof (event as { writer?: unknown }).writer === 'string' && typeof (event as { seq?: unknown }).seq === 'number')) &&
      (frame.nonce === undefined || typeof frame.nonce === 'string') &&
      (frame.message === undefined || (typeof frame.message === 'string' && frame.message.length <= 2000));
    if (!valid) return this.refuseMachine(ctx, { reason: 'bad-shape', message: 'rejected is {project, event: {writer, seq} | null, nonce?, reason, message?}' });
    const rejection: Rejection & { machine: string } = {
      machine: ctx.machine,
      event: event === null ? null : { writer: frame.event!.writer, seq: frame.event!.seq },
      ...(frame.nonce === undefined ? {} : { nonce: frame.nonce }),
      reason: frame.reason,
      ...(frame.message === undefined ? {} : { message: frame.message }),
    };
    this.broadcast(this.audited(this.log.record('rejected', rejection)));
  }

  // ---- History re-attestation (O14 M4, Interfaces §D) -----------------------------------------------------------

  /** This log's DX1 writers under `names` with their highest DX1 seq, for the Registry's inventory. */
  historyWriters(names: string[]): Array<{ writer: string; upTo: number }> {
    return this.log.dx1Writers(new Set(names.map(machineNameKey)));
  }

  /** A writer's stored events after `after`, about a page of them, as a machine reads its own history. */
  historyPage(writer: string, after: number): HistoryLogPage {
    return this.log.writerPage(writer, after, HISTORY_PAGE_BYTES);
  }

  /** The attestations this log keeps, the newest per writer. */
  attestations(): Signed<HistoryAttestation>[] {
    return this.history.records();
  }

  /**
   * A machine's attestation for this project, kept after the courtesy check (RL §5.5) of its signer and its writer's
   * binding against the Registry's head and certificates, read afresh (a post is rare): `403 bad-signature` or
   * `403 not-bound`, and `409 stale-attestation` for a record no newer than the one held while that one verifies.
   */
  async keepAttestation(org: string, project: string, record: unknown): Promise<Result<{ stored: boolean }>> {
    if (!isSigned(record, isHistoryAttestation) || record.body.org !== org || record.body.project !== project) {
      return { ok: false, status: 400, error: 'bad-shape', message: 'the body is {record}, a signed HistoryAttestation of this org and project' };
    }
    this.remember(org, project);
    const view = await this.readOrgState();
    if (view.head === null) return { ok: false, status: 403, error: 'bad-signature', message: 'the org has no signed state to check it against' };
    const now = new Date(this.now());
    const at = { project, writer: record.body.writer };
    const signer = await verifyHistorySigner(record, view.head.state, view.certificates, at, now);
    if (!signer.ok) {
      return signer.reason === 'binding'
        ? { ok: false, status: 403, error: 'not-bound', message: `the signer can't speak for ${record.body.writer}: another machine holds the name, or the record does not claim it` }
        : { ok: false, status: 403, error: 'bad-signature', message: 'the record is not signed by a machine key its current name binds at its created' };
    }
    // A held record that verifies no more (its key revoked since) gives way to a new one at the same upTo.
    const held = this.history.held(record.body.writer);
    const voided = held !== undefined && !(await verifyHistorySigner(held, view.head.state, view.certificates, at, now)).ok ? held : undefined;
    const kept = this.history.keep(record, voided);
    if (kept === 'stale') return { ok: false, status: 409, error: 'stale-attestation', message: 'a record for this writer at the same or a higher upTo is held' };
    return { ok: true, value: { stored: kept === 'stored' } };
  }

  // ---- The session plane, from machines ------------------------------------------------------------------------

  /** A DX4 message: the kinds the hub interprets are kept, the others relayed, a subscription's to its browser alone. */
  private session(ctx: MachineContext, message: unknown): Refusal | void {
    const m = message as Record<string, unknown>;
    if (!isObject(m) || m.project !== ctx.project || m.machine !== ctx.machine) return this.refuseMachine(ctx, { reason: 'bad-shape', message: 'a session message names this project and this machine' });
    const kind = m.kind as SessionKind;
    if (kind === 'machine') return this.machinePresence(ctx, m);
    if (!isName(m.session)) return this.refuseMachine(ctx, { reason: 'bad-shape', message: `${String(kind)} names a session` });
    if (IN_SUB.has(kind)) return this.relay(ctx, m);
    if (!SESSION_WIDE.has(kind)) return this.refuseMachine(ctx, { reason: 'bad-shape', message: `no session message ${JSON.stringify(kind)}` });
    if (m.sub !== null || m.n !== null) return this.refuseMachine(ctx, { reason: 'bad-shape', message: `${kind} goes to every browser: sub and n are null` });
    const session = m.session as string;
    const kept = { project: ctx.project, machine: ctx.machine, session, kind, sub: null, n: null, body: m.body } as SessionMessage;
    if (kind === 'presence') return this.presence(ctx, kept as SessionMessage<'presence'>);
    if (kind === 'raised') return this.raised(ctx, kept as SessionMessage<'raised'>);
    if (kind === 'settled') return this.settled(ctx, kept as SessionMessage<'settled'>);
    if (kind === 'delivery') return this.delivery(ctx, kept as SessionMessage<'delivery'>);
    if (!isObject(m.body)) return this.refuseMachine(ctx, { reason: 'bad-shape', message: `${kind}'s body is an object` });
    if (kind === 'op') {
      this.plane.putOp(kept as SessionMessage<'op'>, Date.now());
      void this.schedule();
    }
    this.broadcast({ t: 'session', message: kept });
  }

  /** A session's presence: the latest kept per session, for browsers that connect later, and sent to every browser. */
  private presence(ctx: MachineContext, message: SessionMessage<'presence'>): Refusal | void {
    const body = message.body as unknown as Record<string, unknown> | null;
    if (!isObject(body) || typeof body.bridge !== 'boolean' || !(body.record === null || isObject(body.record))) {
      return this.refuseMachine(ctx, { reason: 'bad-shape', message: 'presence is {record: object | null, bridge}' });
    }
    this.plane.putPresence(ctx.machine, message.session, message);
    // Kept either way; shown only while this stream's lease is fresh. A lapsed machine's presence is not current, and
    // it is shown when the lease is renewed.
    if (!this.streamOnline(ctx)) return;
    this.broadcast({ t: 'session', message });
    this.reportSummary();
  }

  /**
   * The machine's own presence (DX4 `machine`): its policy, its checkouts, and what its daemon can do itself (`desk`,
   * from the desk control surface's M0 on); `online` is the hub's, from the lease. The body is rebuilt from these
   * fields alone.
   */
  private machinePresence(ctx: MachineContext, m: Record<string, unknown>): Refusal | void {
    const body = m.body as Record<string, unknown>;
    const policy = isObject(body) ? (body.policy as Record<string, unknown>) : undefined;
    const desk = isObject(body) ? body.desk : undefined;
    const valid =
      m.session === null &&
      m.sub === null &&
      m.n === null &&
      isObject(policy) &&
      typeof policy.read_only === 'boolean' &&
      typeof policy.ceiling === 'string' &&
      Array.isArray(body.checkouts) &&
      body.checkouts.every((c) => isObject(c) && typeof c.path === 'string' && typeof c.branch === 'string') &&
      (desk === undefined || isDesk(desk));
    if (!valid) return this.refuseMachine(ctx, { reason: 'bad-shape', message: 'machine is {online, policy: {read_only, ceiling}, checkouts: [{path, branch}], desk?: {sminos, rpcs: [name], reads: [name]}} with session, sub, and n null' });
    this.plane.putMachinePresence(ctx.machine, {
      online: true,
      policy: { read_only: policy.read_only as boolean, ceiling: policy.ceiling as string },
      checkouts: body.checkouts as MachinePresence['checkouts'],
      ...(isDesk(desk) ? { desk: { sminos: desk.sminos, rpcs: [...desk.rpcs], reads: [...desk.reads] } } : {}),
    });
    this.machinesChanged();
  }

  /** A request raised: pending until settled, to every browser, and pushed to the members who are not looking. */
  private raised(ctx: MachineContext, message: SessionMessage<'raised'>): Refusal | void {
    const problem = raisedShapeError(message.body);
    if (problem || message.body.session !== message.session) return this.refuseMachine(ctx, { reason: 'bad-shape', message: problem ?? 'raised names the session its envelope names' });
    const fresh = this.plane.raise(ctx.machine, message.body, deadlineOf(message.body));
    this.broadcast({ t: 'session', message });
    this.pendingChanged();
    if (fresh) this.pushRaised(ctx.machine, message.body);
    void this.schedule();
  }

  /** The machine's complete pending set: a request it no longer holds is dropped, a new one raised. */
  private pendingSet(ctx: MachineContext, raised: unknown): Refusal | void {
    if (!Array.isArray(raised)) return this.refuseMachine(ctx, { reason: 'bad-shape', message: 'pending is {project, raised: [raised]}' });
    for (const r of raised) {
      const problem = raisedShapeError(r);
      if (problem) return this.refuseMachine(ctx, { reason: 'bad-shape', message: problem });
    }
    const before = JSON.stringify(this.plane.pending());
    this.plane.dropPendingExcept(ctx.machine, new Set((raised as Raised[]).map((r) => pendingKey(r.session, r.request))));
    const fresh = (raised as Raised[]).filter((r) => this.plane.raise(ctx.machine, r, deadlineOf(r)));
    if (JSON.stringify(this.plane.pending()) !== before) this.pendingChanged();
    for (const r of fresh) this.pushRaised(ctx.machine, r);
    void this.schedule();
  }

  /** A settlement: the request leaves the pending set, and the audit record keeps who won, from the bridge's word. */
  private settled(ctx: MachineContext, message: SessionMessage<'settled'>): Refusal | void {
    const s = message.body as unknown as Record<string, unknown>;
    const valid =
      isObject(s) &&
      isName(s.request, 512) &&
      SETTLED_WINNERS.has(s.winner as string) &&
      SETTLED_OUTCOMES.has(s.outcome as string) &&
      isName(s.by, 200) &&
      isMac(s.mac);
    if (!valid) return this.refuseMachine(ctx, { reason: 'bad-shape', message: 'settled is {request, winner, outcome, by, mac}' });
    const settled = message.body as Settled;
    // Once per raise: a daemon that restarted between sending a settlement and recording it sends it again, and the
    // hub takes it without a second broadcast or decision. The ids are in storage, so this holds across an eviction. A
    // request raised again after its settlement (the open ask a resumed session raises under its call's id) is pending
    // again, and its settlement settles it: sound because the daemon (7.188.2) never sends a settlement after a later
    // raise of the same request.
    const first = this.plane.markSettled(ctx.machine, message.session, settled.request, Date.now());
    if (!first && !this.plane.pendingOf(ctx.machine, message.session, settled.request)) return;
    const raised = this.plane.settle(ctx.machine, message.session, settled.request);
    this.broadcast({ t: 'session', message });
    this.broadcast(this.audited(this.log.record('decided', { machine: ctx.machine, session: message.session, settled, raised: raised ?? null })));
    if (raised) this.pendingChanged();
    // A settlement of a request this hub did not hold still settles the log's question for it.
    else this.reportSummary();
  }

  /** A delivery outcome: the latest per event and recipient kept, and sent to every browser. */
  private delivery(ctx: MachineContext, message: SessionMessage<'delivery'>): Refusal | void {
    const d = message.body as unknown as Record<string, unknown>;
    const event = isObject(d) ? d.event : undefined;
    const valid =
      isObject(d) &&
      isObject(event) &&
      typeof event.writer === 'string' &&
      Number.isSafeInteger(event.seq) &&
      d.session === message.session &&
      DELIVERY_OUTCOMES.has(d.outcome as string) &&
      typeof d.reason === 'string' &&
      isMac(d.mac);
    if (!valid) return this.refuseMachine(ctx, { reason: 'bad-shape', message: 'delivery is {event: {writer, seq}, session, outcome, reason, mac}' });
    this.plane.putDelivery(ctx.machine, message.body as Delivery);
    this.broadcast({ t: 'session', message });
  }

  /** A subscription's message, to the one browser that holds the sub; a message for a sub nobody holds unsubscribes it
   * at the machine. Relayed as the machine numbered it. */
  private relay(ctx: MachineContext, m: Record<string, unknown>): Refusal | void {
    const sub = m.sub;
    const n = m.n;
    if (typeof sub !== 'string' || !Number.isSafeInteger(n) || (n as number) < 0 || !isObject(m.body)) {
      return this.refuseMachine(ctx, { reason: 'bad-shape', message: `${String(m.kind)} belongs to a subscription: sub, n, and a body` });
    }
    const route = this.routes.get(sub);
    const socket = route && route.machine === ctx.machine && route.session === m.session ? this.socketById(route.socket) : undefined;
    if (!route || !socket) {
      if (route && route.machine === ctx.machine) this.dropRoute(route);
      if (m.kind !== 'end') this.toMachine(ctx.machine, ctx.generation, { t: 'unsubscribe', project: ctx.project, sub }, 'control');
      return;
    }
    const message = { project: ctx.project, machine: ctx.machine, session: route.session, kind: m.kind, sub, n, body: m.body } as SessionMessage;
    this.toSocket(socket, { t: 'session', message });
    if (m.kind === 'end') return this.dropRoute(route, socket);
    this.attach(socket, (a) => (sub in a.subs ? { ...a, subs: { ...a.subs, [sub]: (n as number) + 1 } } : a));
  }

  /** An RPC's result from the daemon's ledger: kept, shown to its member, and acknowledged so it is not sent again. */
  private rpcResult(ctx: MachineContext, frame: Extract<UpFrame, { t: 'rpc-result' }>): Refusal | void {
    const outcome = frame.outcome as unknown as Record<string, unknown>;
    const error = isObject(outcome) ? (outcome.error as Record<string, unknown>) : undefined;
    const valid =
      isBase64urlOf(frame.nonce, 16) &&
      isObject(outcome) &&
      ((outcome.state === 'done' && isObject(outcome.result)) ||
        (outcome.state === 'failed' &&
          isObject(error) &&
          typeof error.code === 'string' &&
          typeof error.message === 'string' &&
          // A late decision names the side that won (DX6): kept and relayed as sent, refused only of the wrong type.
          (error.winner === undefined || SETTLED_WINNERS.has(error.winner as string)) &&
          (error.by === undefined || typeof error.by === 'string') &&
          (error.terminalOnly === undefined || error.terminalOnly === true)));
    if (!valid) {
      return this.refuseMachine(ctx, {
        reason: 'bad-shape',
        message: 'rpc-result is {project, nonce, outcome: {state: done, result} | {state: failed, error: {code, message, winner?, by?, terminalOnly?: true}}}',
      });
    }
    const record = this.plane.rpc(frame.nonce);
    if (record && record.machine === ctx.machine && (record.state === 'forwarded' || record.state === 'uncertain')) {
      const done = frame.outcome as RpcOutcome;
      this.updateRpc({ ...record, state: done.state, outcome: done });
    }
    this.toMachine(ctx.machine, ctx.generation, { t: 'rpc-ack', project: ctx.project, nonce: frame.nonce }, 'control');
  }

  // ---- The session plane, from browsers ------------------------------------------------------------------------

  /**
   * A browser's RPC. Fails at once, never queued and never recorded, when it is malformed, not the signed-in member's,
   * older than 60 seconds, or for a machine without a fresh lease; otherwise it is recorded by its nonce and forwarded
   * to the machine's stream. A nonce the record holds is answered from it — or, when `uncertain` and its machine is
   * back, forwarded again for the daemon's ledger to answer — and never forwarded beside its first.
   */
  private rpc(socket: WebSocket, value: unknown): void {
    const { member } = this.attachment(socket);
    const rpc = value as Rpc;
    const nonce = isObject(rpc) && isBase64urlOf(rpc.nonce, 16) ? rpc.nonce : undefined;
    if (!nonce) return this.refuseBrowser(socket, { reason: 'bad-shape', message: 'an RPC carries its nonce: 128 bits, canonical base64url' });
    const fail = (code: RpcErrorCode, message: string) => this.toSocket(socket, { t: 'rpc-state', nonce, state: 'failed', outcome: { state: 'failed', error: { code, message } } });
    const problem = rpcShapeError(rpc, this.projectId);
    if (problem) return fail('bad-shape', problem);
    if (rpc.member !== member) return fail('not-member', 'an RPC is issued by the member signed in');
    // Leases first: a lapse this request is the first to find changes the record it is answered from.
    this.sweepLeases();
    const record = this.plane.rpc(nonce);
    if (record) {
      if (record.member !== member || canonicalize(record.rpc) !== canonicalize(rpc)) return fail('bad-shape', 'this nonce was sent with another RPC');
      // A retry waits for no stream: in a closed stream's grace it is answered from the record, and sent again later.
      if (record.state === 'uncertain' && this.reachable(record.machine)) return this.forward(record.rpc, member, true);
      return this.toSocket(socket, rpcStateFrame(record));
    }
    if (!(Date.now() - Date.parse(rpc.created) <= RPC_FRESHNESS_MS)) return fail('stale', 'older than 60 seconds: issue it again');
    if (!this.isOnline(rpc.machine)) return fail('machine-offline', `${rpc.machine} is offline`);
    this.forward(rpc, member);
  }

  /** Records the RPC as forwarded and writes it to the machine's stream; in a closed stream's grace it is recorded as
   * waiting for the next stream (`PARKED`), which takes it at its `hello`. */
  private forward(rpc: Rpc, member: string, retry = false): void {
    const lease = this.plane.lease(rpc.machine)!;
    const record: RpcRecord = { nonce: rpc.nonce, machine: rpc.machine, member, rpc, state: 'forwarded', outcome: null, generation: lease.closed ? PARKED : lease.generation };
    this.updateRpc(record);
    if (record.generation !== PARKED) this.send(record, retry);
  }

  /** Writes a forwarded RPC to the stream its record names. A send that finds no stream fails it `machine-offline`; but a
   * `retry` of an uncertain one stays uncertain, since a retry the hub could not deliver says nothing of what the first
   * forward did, whatever the transport answers. An RL1 connection carries no RPC (O11 M6): a first forward to one fails
   * `unsupported`, since it was never sent; a retry stays uncertain, since an earlier stream may have run it. */
  private send(record: RpcRecord, retry = false): void {
    const { rpc, generation } = record;
    const unsent = (undelivered: 'failed' | 'uncertain', error: RpcError = { code: 'machine-offline', message: `${rpc.machine} is offline` }) => {
      const state = retry ? 'uncertain' : undelivered;
      const now = this.plane.rpc(rpc.nonce);
      if (now?.state !== 'forwarded' || now.generation !== generation) return;
      const outcome: RpcOutcome | null = state === 'failed' ? { state: 'failed', error } : null;
      this.updateRpc({ ...now, state, outcome });
    };
    this.toMachine(rpc.machine, generation, { t: 'rpc', rpc }, 'control').then(
      (sent) => {
        if (sent === 'offline') unsent('failed');
        else if (sent === 'not-on-rl1') unsent('failed', { code: 'unsupported', message: `${rpc.machine} takes RPCs in its own channel, not through the hub (RL1)` });
      },
      () => unsent('uncertain'),
    );
  }

  private updateRpc(record: RpcRecord): void {
    this.plane.putRpc(record, Date.now());
    const frame = rpcStateFrame(record);
    for (const socket of this.ctx.getWebSockets()) if (this.attachment(socket).member === record.member) this.toSocket(socket, frame);
  }

  /** A browser's subscription, routed to its socket and carried to the machine; one the hub cannot serve ends at once. */
  private subscribe(socket: WebSocket, frame: Record<string, unknown>): void {
    const { machine, session, agentId, sub } = frame;
    if (!isBase64urlOf(sub, 16) || !isName(machine, 63) || !isName(session) || !(agentId === null || isName(agentId))) {
      return this.refuseBrowser(socket, { reason: 'bad-shape', message: 'subscribe is {machine, session, agentId: string | null, sub: 128 bits base64url}' });
    }
    const attachment = this.attachment(socket);
    const end = (reason: 'machine-offline' | 'error', message?: string) =>
      this.toSocket(socket, { t: 'session', message: { project: this.projectId, machine: machine as string, session: session as string, kind: 'end', sub: sub as string, n: 0, body: { reason, ...(message ? { message } : {}) } } });
    if (this.routes.has(sub as string)) return end('error', 'this sub is in use: pick a fresh one');
    if (Object.keys(attachment.subs).length >= MAX_SUBS) return end('error', `a socket holds at most ${MAX_SUBS} subscriptions`);
    this.sweepLeases();
    const lease = this.plane.lease(machine as string);
    if (!lease || !this.isFresh(lease)) return end('machine-offline');
    // A machine between streams (its lease closed, in the grace) takes the subscription with its next stream.
    const route: Route = { sub: sub as string, socket: attachment.id, machine: machine as string, session: session as string, agentId: agentId as string | null, generation: lease.closed ? PARKED : lease.generation };
    this.plane.putRoute(route);
    this.routes.set(route.sub, route);
    this.attach(socket, (a) => ({ ...a, subs: { ...a.subs, [route.sub]: 0 } }));
    if (route.generation !== PARKED) this.carry(route);
  }

  /** Carries a subscription to the stream of its route; one the stream cannot take ends. */
  private carry(route: Route): void {
    this.toMachine(route.machine, route.generation, { t: 'subscribe', project: this.projectId, session: route.session, agentId: route.agentId, sub: route.sub }, 'control').then(
      (sent) => {
        if (sent === 'offline') this.endSub(route, 'machine-offline');
        // Not `machine-offline`, which a browser answers by subscribing again: an RL1 machine is read in its own channel.
        else if (sent === 'not-on-rl1') this.endSub(route, 'error', `${route.machine} serves its sessions in its own channel, not through the hub (RL1)`);
      },
      () => this.endSub(route, 'machine-offline'),
    );
  }

  private unsubscribe(socket: WebSocket, sub: unknown): void {
    const route = this.ownRoute(socket, sub);
    if (!route) return;
    this.dropRoute(route, socket);
    if (this.leaseServes(route)) this.toMachine(route.machine, route.generation, { t: 'unsubscribe', project: this.projectId, sub: route.sub }, 'control');
  }

  private rows(socket: WebSocket, frame: Record<string, unknown>): void {
    const { before, limit } = frame;
    if (typeof before !== 'string' || !Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 1000) {
      return this.refuseBrowser(socket, { reason: 'bad-shape', message: 'rows is {sub, before: row uuid, limit: 1 to 1000}' });
    }
    const route = this.ownRoute(socket, frame.sub);
    if (!route || !this.leaseServes(route)) return;
    this.toMachine(route.machine, route.generation, { t: 'rows', project: this.projectId, session: route.session, agentId: route.agentId, sub: route.sub, before, limit: limit as number }, 'control');
  }

  private diff(socket: WebSocket, sub: unknown): void {
    const route = this.ownRoute(socket, sub);
    if (!route) return;
    if (route.agentId !== null) return this.refuseBrowser(socket, { reason: 'bad-shape', message: "diff is a main-transcript subscription's (agentId null)" });
    if (this.leaseServes(route)) this.toMachine(route.machine, route.generation, { t: 'diff', project: this.projectId, session: route.session, sub: route.sub }, 'control');
  }

  /** A task's output tail, carried to the sub's machine with its route; on a main or an agent sub alike. */
  private output(socket: WebSocket, frame: Record<string, unknown>): void {
    const { taskId, tail } = frame;
    if (!isTaskId(taskId) || !isOutputTail(tail)) {
      return this.refuseBrowser(socket, { reason: 'bad-shape', message: `output is {sub, taskId: [A-Za-z0-9_-]{1,64}, tail: 1 to ${OUTPUT_TAIL_MAX} bytes}` });
    }
    const route = this.ownRoute(socket, frame.sub);
    if (!route || !this.leaseServes(route)) return;
    this.toMachine(route.machine, route.generation, { t: 'output', project: this.projectId, session: route.session, agentId: route.agentId, sub: route.sub, taskId, tail }, 'control');
  }

  /**
   * A read of the session (the desk control surface spec, §5), carried to the sub's machine with its route; the answer
   * comes back as DX4 `read` on the sub and is relayed unread. Which kinds a scope serves is the machine's to say.
   */
  private read(socket: WebSocket, frame: Record<string, unknown>): void {
    const problem = readShapeError(frame);
    if (problem) return this.refuseBrowser(socket, { reason: 'bad-shape', message: `read is {sub, id, what, args?}: ${problem}` });
    const route = this.ownRoute(socket, frame.sub);
    if (!route || !this.leaseServes(route)) return;
    const { id, what, args } = frame as { id: string; what: string; args?: JsonObject };
    this.toMachine(route.machine, route.generation, { t: 'read', project: this.projectId, session: route.session, agentId: route.agentId, sub: route.sub, id, what, ...(args === undefined ? {} : { args }) }, 'control');
  }

  /** The route of a sub this socket holds; a sub it does not (one that just ended, say) is passed over quietly. */
  private ownRoute(socket: WebSocket, sub: unknown): Route | undefined {
    const route = typeof sub === 'string' ? this.routes.get(sub) : undefined;
    return route && route.socket === this.attachment(socket).id ? route : undefined;
  }

  // ---- Leases ----------------------------------------------------------------------------------------------------

  /** A follower's lease is a lease (it renews and lapses alike), but the machine is none of the project's machines: its
   * own presence, kept from when it held the project, goes, so it leaves the machines frame and the grid's counts. */
  private startLease(ctx: MachineContext, follow: boolean): void {
    const old = this.plane.lease(ctx.machine);
    if (old && old.generation > ctx.generation) return;
    // The older stream's subscriptions and unanswered RPCs went with it; those waiting for a stream wait for this one.
    if (old && old.generation < ctx.generation) this.endStreamWork(ctx.machine, old.generation, false);
    const wasOnline = old !== undefined && this.isFresh(old);
    // A second `hello` on a stream that already closed (it was on its way) opens nothing.
    if (old?.generation === ctx.generation && old.closed) return;
    this.plane.putLease({ machine: ctx.machine, client: ctx.client, generation: ctx.generation, expires: Date.now() + ctx.leaseMs, online: true, closed: false, follow });
    const presenceGone = follow && this.plane.deleteMachinePresence(ctx.machine);
    if (!wasOnline) this.cameOnline(ctx.machine);
    else if (old.generation !== ctx.generation || old.follow !== follow || presenceGone) this.machinesChanged();
    for (const parked of [...this.routes.values()]) {
      if (parked.machine !== ctx.machine || parked.generation !== PARKED) continue;
      const route = { ...parked, generation: ctx.generation };
      this.plane.deleteRoute(route.sub);
      this.plane.putRoute(route);
      this.routes.set(route.sub, route);
      this.carry(route);
    }
    for (const parked of this.plane.forwarded(ctx.machine, PARKED)) {
      const record = { ...parked, generation: ctx.generation };
      this.plane.putRpc(record, Date.now());
      this.send(record);
    }
    void this.schedule();
  }

  private lapse(lease: Lease): void {
    this.plane.putLease({ ...lease, online: false });
    this.lapsed(lease.machine, lease.generation);
  }

  /** The machine went offline: what its streams through `generation` carried ends, and what waited for a stream too. */
  private lapsed(machine: string, generation = this.plane.lease(machine)?.generation ?? 0): void {
    this.endStreamWork(machine, generation, true);
    this.machinesChanged();
  }

  /** What a machine's stream carried ends with it: its subscriptions end at their browsers, and its forwarded RPCs
   * without a result become `uncertain`. What waits for its next stream ends too when `parked` (the machine is offline):
   * a subscription ends, and an RPC, which never reached the machine, fails `machine-offline`; otherwise it waits on. */
  private endStreamWork(machine: string, generation: number, parked: boolean): void {
    for (const route of [...this.routes.values()]) {
      if (route.machine !== machine || route.generation > generation || (route.generation === PARKED && !parked)) continue;
      this.endSub(route, 'machine-offline');
    }
    for (const record of this.plane.forwarded(machine, generation)) {
      if (record.generation !== PARKED) this.updateRpc({ ...record, state: 'uncertain', outcome: null });
      else if (parked) this.updateRpc({ ...record, state: 'failed', outcome: { state: 'failed', error: { code: 'machine-offline', message: `${machine} is offline` } } });
    }
  }

  /** Lapses every lease whose time is up (checked on read, and by the alarm). */
  private sweepLeases(): void {
    for (const lease of this.plane.lapsed(Date.now())) this.lapse(lease);
  }

  private isFresh(lease: Lease): boolean {
    return lease.online && lease.expires > Date.now();
  }

  /** Whether the lease is fresh and belongs to this stream. */
  private streamOnline(ctx: MachineContext): boolean {
    const lease = this.plane.lease(ctx.machine);
    return lease !== undefined && lease.generation === ctx.generation && this.isFresh(lease);
  }

  /** A machine back online: browsers learn it, and see its sessions' presence as it was kept meanwhile. */
  private cameOnline(machine: string): void {
    this.machinesChanged();
    for (const kept of this.plane.presence()) if (kept.machine === machine) this.broadcast({ t: 'session', message: kept.message });
    this.reportSummary();
  }

  /** Whether `generation` of the machine's streams was revoked. */
  private isRevoked(machine: string, generation: number): boolean {
    const through = this.plane.revokedThrough(machine);
    return through !== null && generation <= through;
  }

  private isOnline(machine: string): boolean {
    const lease = this.plane.lease(machine);
    return lease !== undefined && this.isFresh(lease);
  }

  /** Whether an RPC can be carried to the machine now: online on a stream that is open, not in a closed stream's grace
   * (which holds its presence for the next stream, not its delivery). */
  private reachable(machine: string): boolean {
    const lease = this.plane.lease(machine);
    return lease !== undefined && !lease.closed && this.isFresh(lease);
  }

  /** Whether the machine is online and holds the project: one that only follows it is none of its machines. */
  private holds(machine: string): boolean {
    const lease = this.plane.lease(machine);
    return lease !== undefined && !lease.follow && this.isFresh(lease);
  }

  /** Whether the stream a route was set up on is still the machine's live one. */
  private leaseServes(route: Route): boolean {
    const lease = this.plane.lease(route.machine);
    return lease !== undefined && lease.generation === route.generation && this.isFresh(lease);
  }

  /** The earliest lease expiry, request deadline or command receipt expiry. */
  private async schedule(): Promise<void> {
    const now = Date.now();
    const next = [...this.plane.leases().filter((l) => l.online).map((l) => l.expires), this.plane.nextDeadline(now) ?? Infinity, this.plane.nextOpExpiry() ?? Infinity];
    const at = Math.max(Math.min(...next), now + 50);
    if (at === Infinity) return;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > at || current <= now) await this.ctx.storage.setAlarm(at);
  }

  // ---- What browsers are sent ------------------------------------------------------------------------------------

  private machinesFrame(): ProjectDown {
    return {
      t: 'machines',
      machines: this.plane.machinePresence().map(({ machine, body }) => ({ machine, ...body, online: this.isOnline(machine) })),
    };
  }

  private machinesChanged(): void {
    this.broadcast(this.machinesFrame());
    this.reportSummary();
  }

  private pendingFrame(): ProjectDown {
    const now = Date.now();
    const requests: PendingRequest[] = this.plane.pending().map(({ machine, raised, deadline }) => ({ machine, raised, terminal_only: deadline !== null && deadline <= now }));
    return { t: 'pending', requests };
  }

  /** The pending set moved: every browser is sent it, and the grid's `waiting` may move with an async question. */
  private pendingChanged(): void {
    this.broadcast(this.pendingFrame());
    this.reportSummary();
  }

  /**
   * The project's line on the org's grid, sent to the registry when it changes. Its counts are of the machines that hold
   * the project; `machines_state` names every machine leased here, followers included, with whether its lease is fresh
   * and the credential of the stream that opened it, which is how the Registry knows each machine's online state.
   * `live` counts sessions with a process on every holder, a lapsed lease's too: a machine asleep keeps its sessions,
   * and one gone for good is revoked.
   */
  private reportSummary(attempt = 1): void {
    // A revoked machine is no machine of the project, unless its name was enrolled anew and opened the project since.
    const leased = this.plane.leases().filter((l) => !this.isRevoked(l.machine, l.generation));
    const revoked = (machine: string) => this.isRevoked(machine, this.plane.lease(machine)?.generation ?? 0);
    const holding = leased.filter((l) => !l.follow);
    const holders = new Set(holding.map((l) => l.machine));
    const machines = new Set([...holders, ...this.plane.machinePresence().map((p) => p.machine).filter((m) => !revoked(m))]);
    const online = new Set(holding.filter((l) => this.isFresh(l)).map((l) => l.machine));
    let working = 0;
    let live = 0;
    for (const { machine, message } of this.plane.presence()) {
      const record = message.body.record;
      if (online.has(machine) && (record?.status === 'busy' || record?.status === 'shell')) working++;
      if (holders.has(machine) && record !== null) live++;
    }
    const summary: SummaryReport = {
      machines: machines.size,
      machines_online: online.size,
      working,
      waiting: this.waitingSessions().size,
      live,
      machines_state: leased.map((l) => ({ name: l.machine, online: this.isFresh(l), client: l.client })),
    };
    const text = JSON.stringify(summary);
    if (this.ctx.storage.kv.get('summary') === text) return;
    this.ctx.storage.kv.put('summary', text);
    if (this.reportRetry !== undefined) clearTimeout(this.reportRetry);
    this.reportRetry = undefined;
    // Reports travel asynchronously: the Registry takes one only when it is newer than the last it took.
    const seq = (this.ctx.storage.kv.get<number>('summary-seq') ?? 0) + 1;
    this.ctx.storage.kv.put('summary-seq', seq);
    void this.registry()
      .summary(this.projectId, { ...summary, seq })
      .then(
        (kept) => {
          if (kept !== true) this.reportFailed(seq, attempt, new Error('the Registry did not acknowledge the report'));
        },
        (error: unknown) => this.reportFailed(seq, attempt, error),
      )
      // An instance replaced under its call cannot read its storage: its successor reports at the project's next change.
      .catch(() => {});
  }

  /**
   * A report the Registry did not acknowledge (the call failed, or a Registry still on the previous version dropped
   * `live`), `attempt` being how many times it went (retry.ts), leaves no copy and is sent again: the project's summary as
   * it stands when the retry's time comes, under a new `seq`, even though its counts are the same. So a retry never
   * carries an older state than the project's latest, and the Registry, which takes a report only above the last `seq`
   * it took, never keeps one over a later report. A report sent meanwhile supersedes it, and has an answer of its own;
   * after RETRY_ATTEMPTS the next change's report goes out.
   */
  private reportFailed(seq: number, attempt: number, error: unknown): void {
    if (this.ctx.storage.kv.get<number>('summary-seq') !== seq) return;
    this.ctx.storage.kv.delete('summary');
    const wait = attempt < RETRY_ATTEMPTS ? retryDelay(attempt, this.retryBaseMs(), error) : null;
    logged({ event: 'report-failed', project: this.projectId, seq, attempt, error: described(error), retry_ms: wait === null ? null : Math.round(wait) });
    if (wait === null) return;
    this.reportRetry = setTimeout(() => {
      this.reportRetry = undefined;
      try {
        this.reportSummary(attempt + 1);
      } catch (retryError) {
        // An instance replaced meanwhile cannot read its storage, and gives the retry up.
        logged({ event: 'report-failed', seq, attempt: attempt + 1, error: described(retryError), retry_ms: null });
      }
    }, wait);
  }

  /** How long the first retry of a failed report waits at most (retry.ts; the suites' Worker shortens it). */
  protected retryBaseMs(): number {
    return RETRY_BASE_MS;
  }

  /**
   * The sessions of online machines holding the project that wait on a human, as `machine/session`: the grid's
   * `waiting`. A session waits when its presence says so, and (owner, 2026-10-18) while it holds an open async question,
   * though its presence says busy, as it does: its engine works on. A question is open while a bridge holds it raised
   * (`async`), and while the log holds it open (`questionEffect`) unless the plane settled it (a bridge's ask is its
   * call's request); one ask the hub learned both ways is still its one session. A log question counts only while its
   * session's process lives, not while the session's kept presence says no process is (`record: null`: a stopped seat
   * never retires), as a bridge's ask is withdrawn when its process ends; it counts again once the session runs. A
   * session with no kept presence still counts.
   */
  private waitingSessions(): Set<string> {
    const waiting = new Set<string>();
    const stopped = new Set<string>();
    for (const { machine, message } of this.plane.presence()) {
      if (message.body.record === null) stopped.add(`${machine}/${message.session}`);
      if (this.holds(machine) && message.body.record?.status === 'waiting') waiting.add(`${machine}/${message.session}`);
    }
    for (const { machine, raised } of this.plane.pending()) {
      if (raised.async === true && this.holds(machine)) waiting.add(`${machine}/${raised.session}`);
    }
    for (const { machine, session, ask } of this.log.openQuestions()) {
      const key = `${machine}/${session}`;
      if (this.holds(machine) && !stopped.has(key) && !this.plane.isSettled(machine, session, ask)) waiting.add(key);
    }
    return waiting;
  }

  // ---- Web Push ----------------------------------------------------------------------------------------------------

  private pushRaised(machine: string, raised: Raised): void {
    const question = raised.async === true || raised.tool === 'AskUserQuestion' || raised.tool.endsWith('__AskUserQuestion');
    // A question pushes once per ask: an async one also reaches the log as a `question` event naming its call, which
    // may have pushed already (`upload`).
    if (question && !this.plane.markAsked(machine, raised.session, raised.toolUseId ?? raised.request, Date.now())) return;
    const alias = this.log.latestOf(`${machine}/${raised.session}`)?.from;
    // The badge counts the session this request waits on, whether or not its presence says so yet.
    const waiting = this.waitingSessions().add(`${machine}/${raised.session}`);
    this.push({ v: 1, project: this.projectId, session: raised.session, alias: typeof alias === 'string' ? alias : null, kind: question ? 'question' : 'permission', request: raised.request }, waiting.size, machine);
  }

  /** To every member with no browser showing the project (a socket's visibility rides in its attachment). `waiting` is
   * this project's count as of this push; the Registry adds the other projects' to it for the badge. `machine`, the
   * session's machine by name, lets the Registry send a session that machine listed to its owners alone (O11 M4); a
   * Registry on older code takes the extra argument as nothing. */
  private push(notice: Omit<PushNotice, 'name' | 'waiting'>, waiting: number, machine: string): void {
    const looking = new Set<string>();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.attachment(socket);
      if (attachment.visibleAt !== null && Date.now() - attachment.visibleAt < this.visibleMs()) looking.add(attachment.member);
    }
    void this.registry()
      .push(notice, [...looking], waiting, machine)
      .catch(() => {});
  }

  // ---- Browsers' sockets ---------------------------------------------------------------------------------------

  /**
   * A browser resumes after an offset: one page of the backlog (RESUME_PAGE_FRAMES frames, about 1 MiB). When the page
   * reaches the head, `caught-up`, the log live from then on, and the audit record's latest; otherwise `more` with the
   * last offset sent, and the browser asks for the next page. A hibernatable socket's send gives no settlement, so the
   * browser's requests are what pace a long backlog. Until its `caught-up`, the socket gets nothing live (the mark is in
   * its attachment, so a hibernation between pages keeps it): what is stored meanwhile comes in a later page, once.
   */
  private resume(socket: WebSocket, after: unknown): void {
    if (!Number.isSafeInteger(after) || (after as number) < 0) return this.refuseBrowser(socket, { reason: 'bad-shape', message: 'resume is {after: offset}' });
    let last = after as number;
    let frames = 0;
    for (const events of this.log.after(last)) {
      this.toSocket(socket, { t: 'log', events });
      last = events[events.length - 1].offset;
      if (++frames === RESUME_PAGE_FRAMES) break;
    }
    const head = this.log.head();
    if (last < head) {
      this.attach(socket, (a) => ({ ...a, log: false }));
      return this.toSocket(socket, { t: 'more', offset: last });
    }
    this.attach(socket, (a) => ({ ...a, log: true }));
    this.toSocket(socket, { t: 'caught-up', offset: head });
    for (const row of this.log.audit(AUDIT_REPLAY)) this.toSocket(socket, this.audited(row));
  }

  /**
   * A browser's `human`, taken after every one its member sent before it (`takeHuman`), so a member's feed keeps the
   * order they were sent in and one signed send is never stored twice. Other members' humans don't wait: a sealed one
   * waits behind a signed one's read of the head only when the same member sent both, and that read is bounded
   * (signed-events.ts).
   */
  private human(socket: WebSocket, event: unknown): Promise<void> {
    const { member } = this.attachment(socket);
    const taken = (this.humans.get(member) ?? Promise.resolve()).then(() => this.takeHuman(socket, event));
    const tail = taken.catch(() => {});
    this.humans.set(member, tail);
    void tail.then(() => {
      if (this.humans.get(member) === tail) this.humans.delete(member);
    });
    return taken;
  }

  // A web `human`: accepted only from its own member, sealed by the browser without a position, and given one by the
  // hub (writer `hub/<member>`, the next seq, the time) that DX1's check admits. A device's signed one (RL8, O11 M5)
  // arrives the same way with `sig` and `nonce`, `mac` too when dual-coded, and is stored only once its signature
  // verifies for the member's devices. A nonce the member's feed holds (the event's own `nonce`, else its `mac.nonce`)
  // is the same send again: answered from the stored event, never stored twice, and refused `conflict` when its
  // payload differs, a re-signed copy included.
  private async takeHuman(socket: WebSocket, event: unknown): Promise<void> {
    const { member } = this.attachment(socket);
    // A state announced while this waited its turn may have removed the member, and closed this socket.
    if (!this.stateHolds(member)) return;
    const draft = event as Record<string, unknown> & { member?: unknown; nonce?: unknown; mac?: { nonce?: unknown; value?: unknown } };
    const nonce = typeof draft === 'object' && draft !== null ? resendNonce(draft) : undefined;
    const problem = humanShapeError(event);
    if (problem) return this.refuseBrowser(socket, { reason: problem === 'too-large' ? 'too-large' : 'bad-shape', message: problem, ...(nonce ? { nonce } : {}) });
    if (draft.member !== member) {
      return this.refuseBrowser(socket, { reason: 'writer-not-yours', nonce, message: 'a web human is written by the member signed in' });
    }
    const writer = hubWriter(member);
    const sent = this.log.byNonce(writer, nonce!);
    if (sent) {
      if (!sameEvent(withoutPosition(sent.event), draft)) return this.refuseBrowser(socket, { reason: 'conflict', writer, seq: sent.event.seq, nonce, message: 'this nonce was sent with another payload' });
      return this.toSocket(socket, { t: 'human-ack', nonce: nonce!, offset: sent.offset, writer, seq: sent.event.seq });
    }
    const positioned = () => ({ ts: new Date().toISOString(), writer, seq: this.log.last(writer) + 1, ...draft }) as LogEvent;
    if (draft.sig !== undefined) {
      const signature = await this.signatures.check({ org: this.orgId, project: this.projectId }, positioned() as LogEventV2);
      if (!signature.ok) return this.refuseBrowser(socket, { reason: signature.reason, writer, nonce, message: signature.message });
      // Or during the check.
      if (!this.stateHolds(member)) return;
    }
    const stored = positioned();
    if (!isHubPosition(stored)) throw new Error('the hub assigned a position DX1 refuses');
    const appended = this.log.append(stored);
    this.toSocket(socket, { t: 'human-ack', nonce: nonce!, offset: appended.offset, writer, seq: stored.seq });
    this.fanOut([appended]);
  }

  /** New events to every browser that follows the log and to every machine syncing the project, but the sender. */
  private fanOut(accepted: Stored[], except?: string): void {
    if (accepted.length === 0) return;
    for (const socket of this.ctx.getWebSockets()) {
      if (this.attachment(socket).log) this.toSocket(socket, { t: 'log', events: accepted });
    }
    const events = accepted.map((s) => s.event);
    for (const { name, generation } of this.ctx.storage.sql.exec<{ name: string; generation: number }>('SELECT name, generation FROM machines')) {
      if (name !== except) this.toMachine(name, generation, { t: 'events', project: this.projectId, events }, 'replies');
    }
  }

  /** A refusal of a session-plane frame: on the control lane, owed nothing by the POST that carried the frame, and
   * returned for that POST's answer to name the frame (MAWS #88). */
  private refuseMachine(ctx: MachineContext, refusal: Refusal): Refusal {
    void this.refusal(ctx, refusal, 'control');
    return refusal;
  }

  /** A refusal sent to the machine and recorded; by default one a log frame's POST owes the machine (the replies lane). */
  private refusal(ctx: MachineContext, refusal: Refusal, lane: Lane = 'replies'): Promise<Sent> {
    const sent = this.toMachine(ctx.machine, ctx.generation, { t: 'refused', project: ctx.project, refusal }, lane);
    this.broadcast(this.audited(this.log.record('refused', { ...refusal, machine: ctx.machine })));
    return sent;
  }

  private refuseBrowser(socket: WebSocket, refusal: Refusal & { nonce?: string }): void {
    const { member } = this.attachment(socket);
    this.broadcast(this.audited(this.log.record('refused', { ...refusal, member })));
  }

  private audited(row: AuditRow): ProjectDown {
    const entry = { ...row.entry, id: row.id, at: row.at } as AuditEntry & Record<string, unknown>;
    if (row.kind === 'rejected') return { t: 'rejected', rejection: entry } as ProjectDown;
    if (row.kind === 'decided') return { t: 'decided', decision: entry } as ProjectDown;
    return { t: 'refused', refusal: entry } as ProjectDown;
  }

  /** A frame to every browser of the project, following the log or not. */
  private broadcast(frame: ProjectDown): void {
    for (const socket of this.ctx.getWebSockets()) this.toSocket(socket, frame);
  }

  private toSocket(socket: WebSocket, frame: ProjectDown): void {
    try {
      for (const line of toWire(frame)) socket.send(line);
    } catch {
      // A socket closing as it is written to: its browser resumes after its last offset.
    }
  }

  private attachment(socket: WebSocket): SocketAttachment {
    return socket.deserializeAttachment() as SocketAttachment;
  }

  private attach(socket: WebSocket, change: (attachment: SocketAttachment) => SocketAttachment): void {
    socket.serializeAttachment(change(this.attachment(socket)));
  }

  private socketById(id: string): WebSocket | undefined {
    return this.ctx.getWebSockets(id)[0];
  }

  /** Ends a subscription the hub can no longer serve: an `end` with the next `n` the browser expects. */
  private endSub(route: Route, reason: 'machine-offline' | 'error', message?: string): void {
    const socket = this.socketById(route.socket);
    if (socket && this.routes.get(route.sub) === route) {
      const n = this.attachment(socket).subs[route.sub] ?? 0;
      this.toSocket(socket, { t: 'session', message: { project: this.projectId, machine: route.machine, session: route.session, kind: 'end', sub: route.sub, n, body: { reason, ...(message ? { message } : {}) } } });
    }
    this.dropRoute(route, socket);
  }

  /** Tears a route down: in memory, in storage, and in its socket's attachment. A route that is no longer the sub's (it
   * ended, and the browser subscribed again with the same sub) is passed over, so a late callback of the old one leaves
   * its replacement whole. */
  private dropRoute(route: Route, socket = this.socketById(route.socket)): void {
    if (this.routes.get(route.sub) !== route) return;
    this.routes.delete(route.sub);
    this.plane.deleteRoute(route.sub);
    if (socket) {
      this.attach(socket, (a) => {
        const subs = { ...a.subs };
        delete subs[route.sub];
        return { ...a, subs };
      });
    }
  }

  // ---- Machines' streams -------------------------------------------------------------------------------------

  /**
   * Queues a frame for a machine's stream on one of this project's two lanes to it (every project keeps its own),
   * behind everything this project queued on that lane before, and
   * resolves with what became of it: `replies` for what the log plane writes down the stream (what a machine's own
   * frames owe it, the backlog, the live fan-out of other machines' uploads), `control` for what the browsers' side
   * sends (subscriptions and their requests, forwarded RPCs and their acknowledgements, a session-plane frame's
   * refusal). Every project's lanes end at the machine's object, which writes one frame at a time in arrival order,
   * so a browser's subscribe never waits behind the rest of a backlog being paged here, only behind the frames already
   * queued at the machine's object; a
   * stream that takes no write stops them all, until its write bound ends it. A stream that
   * is gone (or older than the machine's current one) leaves the fan-out until the machine's next `hello`. A send that
   * fails otherwise leaves it too, and its stream is ended, so the machine reconnects and its `hello` heals what it
   * missed. The lane stays failed from then on: nothing more is sent on it, and everything queued behind the failure
   * answers it, until the machine's next stream starts lanes of its own.
   */
  protected toMachine(name: string, generation: number, frame: DownFrame, lane: Lane): Promise<Sent> {
    return this.toMachineAll(name, generation, [frame], lane);
  }

  /** `toMachine` for several frames in one place of the lane, each taken from `frames` once the one before it is
   * written, and none after one that found the stream gone. */
  private toMachineAll(name: string, generation: number, frames: Iterable<DownFrame>, lane: Lane): Promise<Sent> {
    const key = queueKey(name, generation, lane);
    // An older stream's lanes go; a newer one's stay (a reply on a retired stream can still be queued).
    for (const other of this.queues.keys()) {
      const queued = parseQueueKey(other);
      if (queued?.machine === name && queued.generation < generation) this.queues.delete(other);
    }
    const machine = this.env.MACHINE.get(this.env.MACHINE.idFromName(`${this.orgId}:${name}`));
    const sent = (this.queues.get(key) ?? Promise.resolve()).then(async () => {
      let result: Sent = 'written';
      let frame: DownFrame | undefined;
      try {
        for (frame of frames) if ((result = await machine.send(frame, generation)) !== 'written') break;
      } catch (error) {
        logged({ event: 'send-failed', machine: name, generation, lane, frame: frame?.t ?? null, error: described(error) });
        this.leaveFanOut(name, generation);
        void machine.close(generation).catch(() => {});
        throw error;
      }
      // A session-plane frame an RL1 connection does not carry (`not-on-rl1`) leaves the connection in the fan-out.
      if (result === 'offline') this.leaveFanOut(name, generation);
      return result;
    });
    const tail = sent.then(() => undefined);
    // Handled here, so a failure no caller waits for is not an unhandled rejection; a POST that waits still sees it.
    sent.catch(() => {});
    tail.catch(() => {});
    this.queues.set(key, tail);
    return sent;
  }

  private leaveFanOut(name: string, generation: number): void {
    this.ctx.storage.sql.exec('DELETE FROM machines WHERE name = ? AND generation = ?', name, generation);
  }

  private isOpen(ctx: MachineContext): boolean {
    const row = this.ctx.storage.sql.exec<{ generation: number }>('SELECT generation FROM machines WHERE name = ?', ctx.machine).toArray()[0];
    return row?.generation === ctx.generation;
  }

  /** How long a socket's `visibility` holds pushes back (the suites' Worker shortens it). */
  protected visibleMs(): number {
    return VISIBLE_MS;
  }

  /** The project registered in the org's Registry (the suites' Worker holds it here to race a close against it). */
  protected register(project: string, name: string, machine: string): Promise<ProjectRecord> {
    return this.registry().registerProject(project, name, machine);
  }

  /** The project's archive machine, from the org's Registry (the suites' Worker holds the lookup to race a newer stream
   * against it). */
  protected async archiveMachine(project: string): Promise<string | null | undefined> {
    return (await this.registry().project(project))?.archive_machine;
  }

  private registry() {
    return this.env.REGISTRY.get(this.env.REGISTRY.idFromName(this.orgId));
  }

  /** The org-state head v2 events are checked against (`Registry.head()`, O11 M3), from this object's org's Registry. */
  protected readOrgState(): Promise<OrgStateView> {
    if (!this.orgId) return Promise.reject(new Error('this project has not learned its org yet'));
    return this.registry().head();
  }

  /** How long a read of the org-state head may take (the suites' Worker shortens it). */
  protected stateReadTimeoutMs(): number {
    return STATE_READ_TIMEOUT_MS;
  }

  /** The clock the cached org state is aged by (the suites' Worker moves it on). */
  protected now(): number {
    return Date.now();
  }

  /** The org and project this object serves, which its name (`<org>:<project>`) holds but the object cannot read. */
  private remember(org: string, project: string): void {
    if (org && this.ctx.storage.kv.get('org') !== org) this.ctx.storage.kv.put('org', org);
    if (project && this.ctx.storage.kv.get('project') !== project) this.ctx.storage.kv.put('project', project);
  }

  private get orgId(): string {
    return this.ctx.storage.kv.get<string>('org') ?? '';
  }

  private get projectId(): string {
    return this.ctx.storage.kv.get<string>('project') ?? '';
  }
}

/** A lane of a machine stream's queue (`toMachine`). */
type Lane = 'replies' | 'control';

/** What one frame from a machine came to (`fromMachineFrame`): the replies its POST owes the machine, and the refusal
 * when the frame was refused whole. */
type Taken = { owed: Promise<Sent>[]; refused?: Refusal };

const queueKey = (machine: string, generation: number, lane: Lane) => `${machine}#${generation}#${lane}`;

function parseQueueKey(key: string): { machine: string; generation: number } | null {
  const match = /^(.*)#(\d+)#(?:replies|control)$/.exec(key);
  return match ? { machine: match[1], generation: Number(match[2]) } : null;
}

/** What a caught error says, for a log line: its name and message, bounded. */
export function described(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

/** A project's log line, beside the machine-stream lines: a frame a machine posted, or a send to its stream, that failed,
 * and why — the hub's half of a `503 delivery-failed` the machine's daemon.log records. */
function logged(line: Record<string, unknown>): void {
  console.log(JSON.stringify({ desk: 'project', ...line }));
}

/** Where a machine's frame stood when it failed: which stream, which frame, and how many of its run were applied. */
const where = (ctx: MachineContext, frame: UpFrame, applied: number) => ({ project: ctx.project, machine: ctx.machine, generation: ctx.generation, frame: frame.t, applied });

function* mapped<T, U>(items: Iterable<T>, map: (item: T) => U): Generator<U> {
  for (const item of items) yield map(item);
}

const rpcStateFrame = (record: RpcRecord): ProjectDown => ({ t: 'rpc-state', nonce: record.nonce, state: record.state, ...(record.outcome ? { outcome: record.outcome } : {}) });

/** A `mac` the hub can carry: `{nonce, value}`, 16 and 32 bytes, each in canonical base64url (DX1). */
const isMac = (mac: unknown) => isObject(mac) && isBase64urlOf(mac.nonce, 16) && isBase64urlOf(mac.value, 32);

/** When a background request's web window closes, in epoch ms; null for a request without one. */
const deadlineOf = (raised: Raised): number | null => (raised.deadline === undefined ? null : Date.parse(raised.deadline));

/** Deliveries in frames of about BATCH_BYTES. */
function batched(deliveries: Delivery[]): Delivery[][] {
  const out: Delivery[][] = [];
  let batch: Delivery[] = [];
  let bytes = 0;
  for (const d of deliveries) {
    const size = JSON.stringify(d).length;
    if (batch.length > 0 && bytes + size > BATCH_BYTES) {
      out.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(d);
    bytes += size;
  }
  if (batch.length > 0) out.push(batch);
  return out;
}

/** The position an event names, when it names one, for a refusal to report. */
function positionOf(event: unknown): { writer?: string; seq?: number } {
  const e = (typeof event === 'object' && event !== null ? event : {}) as { writer?: unknown; seq?: unknown };
  return { ...(typeof e.writer === 'string' ? { writer: e.writer } : {}), ...(typeof e.seq === 'number' ? { seq: e.seq } : {}) };
}

/** A machine presence's `desk` (DX4): the plugin's version and the names of the RPCs and reads the daemon serves, each
 * list at most 64 names of at most 64 characters, so what the hub keeps of it stays small. */
function isDesk(desk: unknown): desk is { sminos: string; rpcs: string[]; reads: string[] } {
  const names = (v: unknown) => Array.isArray(v) && v.length <= 64 && v.every((n) => isName(n, 64));
  return isObject(desk) && isName(desk.sminos, 64) && names(desk.rpcs) && names(desk.reads);
}

/** Why a `raised` is not one the hub can keep (DX4), or null. Its code is the bridge's: the hub keeps it as received. */
function raisedShapeError(raised: unknown): string | null {
  if (!isObject(raised)) return 'raised is an object';
  if (!isName(raised.request, 512) || !isName(raised.session) || !isName(raised.tool, 512)) return 'raised names its request, session, and tool';
  if (!isObject(raised.input)) return "raised carries the tool's input, an object";
  if (raised.deadline !== undefined && !isIsoMillis(raised.deadline)) return 'a deadline is ISO 8601 UTC with milliseconds';
  if (raised.async !== undefined && raised.async !== true) return 'async is true when present';
  if (raised.agentId !== undefined && !isName(raised.agentId)) return 'agentId names the subagent that asked, when present';
  if (raised.truncated !== undefined && raised.truncated !== true) return 'truncated is true when present';
  if (raised.toolUseId !== undefined && !isName(raised.toolUseId, 512)) return "toolUseId names the transcript's tool call, when present";
  if (raised.suggestions !== undefined && !suggestionsFit(raised.suggestions)) {
    return `suggestions are at most ${SUGGESTIONS_MAX} objects, each at most ${SUGGESTION_BYTES_MAX} bytes of canonical UTF-8 JSON, when present`;
  }
  if (!isMac(raised.mac)) return 'mac is {nonce, value}: 16 and 32 bytes, each in canonical base64url';
  return null;
}

/** Whether a raise's suggestions keep the bridge's bound exactly (DX5 `raised.suggestions`): a list of at most
 * SUGGESTIONS_MAX objects, each with a canonical form of at most SUGGESTION_BYTES_MAX bytes of UTF-8. Their shape inside
 * is the engine's and passes through; the code covers it. */
function suggestionsFit(suggestions: unknown): boolean {
  if (!Array.isArray(suggestions) || suggestions.length > SUGGESTIONS_MAX) return false;
  return suggestions.every((s) => {
    if (!isObject(s)) return false;
    try {
      return encoder.encode(canonicalize(s)).length <= SUGGESTION_BYTES_MAX;
    } catch {
      return false;
    }
  });
}

/** Why a browser's RPC is not one the hub can forward (DX6), or null. The daemon checks its code and its arguments. */
function rpcShapeError(rpc: Record<string, unknown>, project: string): string | null {
  if (!(RPC_NAMES as readonly string[]).includes(rpc.rpc as string)) return `no RPC ${JSON.stringify(rpc.rpc)}`;
  if (rpc.project !== project) return 'an RPC names the project of the socket it is sent on';
  if (!isName(rpc.machine, 63) || typeof rpc.member !== 'string' || !isIsoMillis(rpc.created)) return 'an RPC names its machine, member, and created time';
  if (!isObject(rpc.args)) return "an RPC's args are an object";
  if (!isBase64urlOf(rpc.mac, 32)) return "an RPC's mac is 32 bytes in canonical base64url";
  let canonical: string;
  try {
    canonical = canonicalize(rpc);
  } catch (error) {
    return `not canonical JSON: ${(error as Error).message}`;
  }
  // As an event is (DX1): what a person sends, and a record the object's storage must hold.
  if (encoder.encode(canonical).length > FRAME_LIMIT) return 'an RPC is at most 1 MiB';
  return null;
}

/** Why a browser's `human` is not a sealed `HumanDraft` or a signed one, or null. It must not name a position: the hub
 * assigns it. */
function humanShapeError(event: unknown): string | null {
  if (typeof event !== 'object' || event === null || Array.isArray(event)) return 'event is a sealed HumanDraft';
  const e = event as Record<string, unknown>;
  if ('writer' in e || 'seq' in e || 'ts' in e) return 'the hub assigns writer, seq, and ts';
  if (e.kind !== 'human' || e.from !== 'human') return 'kind and from are "human"';
  if (typeof e.member !== 'string' || !isMemberId(e.member)) return 'member is a member id';
  if (typeof e.text !== 'string' || typeof e.created !== 'string') return 'text and created are strings';
  const to = e.to;
  const recipients = Array.isArray(to) && to.every((r) => typeof r?.session === 'string' && typeof r?.alias === 'string');
  if (to !== '*' && !recipients) return 'to is "*" or [{session, alias}]';
  const mac = e.mac as { nonce?: unknown; value?: unknown } | undefined;
  if (mac === undefined && e.sig === undefined) return 'a human carries a mac, a sig, or both';
  if (mac !== undefined && (typeof mac !== 'object' || mac === null || typeof mac.nonce !== 'string' || mac.nonce === '' || typeof mac.value !== 'string')) return 'mac is {nonce, value}';
  const shape = eventShapeError({ ...e, writer: `${HUB_WRITER_PREFIX}${e.member}`, seq: 1, ts: '' });
  if (shape === 'an event is at most 1 MiB') return 'too-large';
  if (shape) return shape;
  if (encoder.encode(JSON.stringify(e)).length > FRAME_LIMIT) return 'too-large';
  return null;
}
