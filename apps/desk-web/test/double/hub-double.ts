// The DX3 protocol double (the DC5 plan's Decision Log, "Building ahead of the hub"): a local stand-in for the hub's
// browser side, for the web app's suites while DC3's local hub and fake machine are still to land. It speaks
// `desk-hub/protocol`'s types and nothing of its own: `/api/me` (an admin, or a member as `role` says), DX7's wrapped
// keys (./org-keys.ts) and machine records (./machines.ts: listed and revoked, and provisioning keys listed, made and revoked; enrollment is not served), the project
// socket (`ProjectUp` / `ProjectDown`), and the registry socket (`GridDown`); it numbers stored events with project offsets, seals what it appends with the org
// key the way a machine's daemon would (DX1), serves DX7's Web Push endpoints (./push.ts; it sends no pushes: the browser
// suites deliver one to the service worker directly), and serves a built app from a directory with the single-page fallback the
// Worker's static assets will have. Every discontinuity a test needs is a method: drop every socket (a deploy), send
// a frame in parts, hold acknowledgements, store an event whose code fails. For the conversation (the plan's M3) it also
// stands in for what DC3's M3 routes and its fake machine (M4) produces: requests raised and settled, deliveries, the
// RPC record per nonce (a retry answered from it, an offline machine failing at once, a dropped machine leaving its
// forwarded RPCs `uncertain`), subscriptions numbered and ended, and a session's compaction messages. Where DC3's hub
// is built, the double follows it (DX3 as `interfaces-M3` has it, checked by the local-hub suite): the order of what a
// socket gets on connect, presence withheld while its machine is offline, the audit record (`refused`, `rejected`,
// `decided`) replayed after every `caught-up`, the hub's at-once RPC failures sent to the sender and never recorded, an
// unknown frame refused `bad-shape`, the subscription limits (32 a socket, `rows` 1 to 1000, `output`'s task id and
// tail), and a resumed backlog paged, each page but the last ended by `more`. In front of it all, a stand-in for
// Access (`admit`): with no session it answers every request, the page and each socket's upgrade included, with a 302
// to a sign-in page on another origin (`signIn`), which sends the browser back through `/cdn-cgi/access/authorized` to
// the path it asked for, admitted; a network that drops every request is `unreachable`.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';
import { createGzip } from 'node:zlib';
import {
  hubWriter,
  importOrgKey,
  isOutputTail,
  isTaskId,
  readShapeError,
  seal,
  toWire,
  PartAssembler,
  type GridDown,
  type HumanEvent,
  type LogEvent,
  type MemberRecord,
  type OrgKey,
  type OrgRecord,
  type PendingRequest,
  type ProjectDown,
  type ProjectSummary,
  type ProjectUp,
  type Rpc,
  type RpcOutcome,
  type SessionMessage,
  type MachinePresence,
  type Delivery,
  type Refusal,
  type Rejection,
  type Raised,
  type Settled,
  type Decision,
  type RpcState,
  type Role,
  type SessionBodies,
  type SubscriptionKind,
  RPC_FRESHNESS_MS,
} from 'desk-hub/protocol';
import { WebSocketServer, type WebSocket } from 'ws';
import { MachinesDouble } from './machines';
import { OrgKeysDouble } from './org-keys';
import { PushDouble } from './push';

/** The org as the double holds it before any key is set up (`/api/me` answers its current `key_check`). */
export const DOUBLE_ORG: OrgRecord = { id: 'org-double', name: 'Double org', created: '2026-10-15T00:00:00.000Z', key_check: null };
export const DOUBLE_MEMBER: MemberRecord = { id: '4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c', email: 'owner@example.com', role: 'admin', created: '2026-10-15T00:00:00.000Z' };

/** The fields a machine writes beyond `ts`, `writer`, `seq`, and `mac`. */
export type EventDraft = { writer: string; kind: string } & Record<string, unknown>;

type ProjectSocket = { ws: WebSocket; resumed: boolean; assembler: PartAssembler; subs: Set<string> };
type AuditFrame = Extract<ProjectDown, { t: 'refused' | 'rejected' | 'decided' }>;
type ProjectState = {
  log: Array<{ offset: number; event: LogEvent }>;
  seqs: Map<string, number>;
  sockets: Set<ProjectSocket>;
  machines: Array<{ machine: string } & MachinePresence>;
  pending: PendingRequest[];
  deliveries: Delivery[];
  /** Each session's latest presence, sent to a socket when it connects (an assumption about DX3; see sendSession). */
  presence: Map<string, SessionMessage>;
  ops: Map<string, { at: number; message: SessionMessage<'op'> }>;
  /** The hub's record per RPC nonce: the RPC, its state, and its outcome once one came. */
  rpcs: Map<string, { rpc: Rpc; state: RpcState; outcome?: RpcOutcome }>;
  /** Each open subscription's machine and the `n` of its next message. */
  subs: Map<string, { machine: string; next: number }>;
  /** The audit record: the hub's refusals, the daemons' rejections, and the decisions, oldest first. */
  audit: AuditFrame[];
};

/** How many audit entries a browser is shown again after each `caught-up` (DX3). */
const AUDIT_REPLAY = 100;
/** Subscriptions a socket may hold (DX3). */
const SUBS_PER_SOCKET = 32;

export type DoubleOptions = {
  /** The org key's 32 bytes; what the double seals with, as an enrolled machine would. */
  orgKey: Uint8Array;
  /** Every frame down is cut into parts above this many bytes (DX2's bound is 1 MiB). */
  frameLimit?: number;
  /** A built app to serve, with the single-page fallback. */
  staticDir?: string;
  admit?: Admit;
};

/**
 * Who is let in: the member; a person the org does not hold (the Worker's `403 not-a-member`, a socket's upgrade refused);
 * nobody, Access's session having expired (a 302 to its sign-in, for every request); or nothing at all, the network
 * dropping every connection to `/api/*`.
 */
export type Admit = 'member' | 'not-a-member' | 'signed-out' | 'unreachable';

export class HubDouble {
  readonly url: string;
  readonly up: Array<{ project: string; frame: ProjectUp }> = [];
  /** One page of a resumed backlog, in bytes of JSON (DX3's is about 1 MiB); a suite lowers it to page a short log. */
  pageBytes = 1 << 20;
  /** Runs before each page of a resumed backlog is read: a suite stores an event between pages here. */
  beforePage?: (after: number) => Promise<void>;
  /** Answer each `human` with `human-ack` (true), or hold the acknowledgement as a hub that dropped mid-write would. */
  ackHumans = true;
  admit: Admit;
  /** Access's sign-in, on an origin of its own: `${signIn}/cdn-cgi/access/login/<host>?redirect_url=<path>`. */
  readonly signIn: string;
  /** The signed-in member's role in the org, as `/api/me` answers it and the endpoints judge it: an admin by default. */
  role: Role = 'admin';
  /** DX7's machine records (`/api/machines`): listed, and revoked by an admin. */
  readonly machineRecords = new MachinesDouble();
  /** DX7's wrapped keys (`/api/org/keys`), with the hub's rules: `not-key-holder`, `different-key`, `last-key`. */
  readonly orgKeys = new OrgKeysDouble();
  /** DX7's Web Push endpoints: the VAPID key and the member's subscriptions. */
  readonly push = new PushDouble();
  private readonly projects = new Map<string, ProjectState>();
  private readonly gridSockets = new Set<WebSocket>();
  private grid: ProjectSummary[] = [];
  private readonly wss = new WebSocketServer({ noServer: true });

  private constructor(
    private readonly server: Server,
    private readonly access: Server,
    private readonly key: OrgKey,
    private readonly options: DoubleOptions,
  ) {
    this.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    this.signIn = `http://127.0.0.1:${(access.address() as AddressInfo).port}`;
    this.admit = options.admit ?? 'member';
  }

  static async start(options: DoubleOptions): Promise<HubDouble> {
    const key = await importOrgKey(options.orgKey);
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const access = createServer((req, res) => double.accessSignIn(req, res));
    await new Promise<void>((resolve) => access.listen(0, '127.0.0.1', resolve));
    const double = new HubDouble(server, access, key, options);
    server.on('request', (req, res) => void double.http(req, res));
    server.on('upgrade', (req, socket, head) => double.upgrade(req, socket as never, head));
    return double;
  }

  /**
   * Ends every connection, not only the idle ones `close()` ends by itself: a browser still open at teardown (a test's
   * page outlives its hub) can hold a connection it opened and never sent on, which Node's `close()` waits on for as long
   * as the browser keeps it (Chrome keeps an unused one 60 s or more).
   */
  async close(): Promise<void> {
    for (const socket of this.allSockets()) socket.terminate();
    this.wss.close();
    const closed = [this.server, this.access].map((server) => new Promise<void>((resolve) => server.close(() => resolve())));
    this.server.closeAllConnections();
    this.access.closeAllConnections();
    await Promise.all(closed);
  }

  // The log.

  /** Appends an event under its writer's next seq, sealed with the org key, and sends it to every resumed socket. */
  async append(project: string, draft: EventDraft, ts: string = new Date().toISOString()): Promise<{ offset: number; event: LogEvent }> {
    const state = this.project(project);
    const seq = (state.seqs.get(draft.writer) ?? 0) + 1;
    state.seqs.set(draft.writer, seq);
    const event = (await seal(this.key, 'log', project, { ts, seq, ...draft })) as unknown as LogEvent;
    return this.store(project, event);
  }

  /** Stores an event exactly as given, code and all (a forged or altered one), and sends it on. */
  appendRaw(project: string, event: LogEvent): { offset: number; event: LogEvent } {
    return this.store(project, event);
  }

  /** Sends a project's whole log again to every resumed socket, as a hub repeating a backlog would. */
  sendLogAgain(project: string): void {
    const state = this.project(project);
    for (const socket of state.sockets) if (socket.resumed) this.sendRaw(socket.ws, { t: 'log', events: state.log });
  }

  /** The project's log as stored, offsets beside events. */
  logOf(project: string): Array<{ offset: number; event: LogEvent }> {
    return this.project(project).log;
  }

  head(project: string): number {
    return this.project(project).log.at(-1)?.offset ?? 0;
  }

  /** Forgets a project's log, as a hub whose storage was wiped would: offsets start again from 1. */
  wipe(project: string): void {
    const state = this.project(project);
    state.log = [];
    state.seqs.clear();
  }

  // The session plane.

  /**
   * A DX4 message to every socket of the project. A `presence` is also kept and sent to each socket that connects later
   * (DX3); a presence of a machine whose lease lapsed is kept and not shown until the machine is back.
   */
  sendSession(project: string, message: SessionMessage): void {
    if (message.kind === 'presence') {
      this.project(project).presence.set(message.session, message);
      if (!this.online(project, message.machine)) return;
    }
    if (message.kind === 'op') {
      const op = message as SessionMessage<'op'>;
      if (op.body.op === 'command' && typeof op.body.rpc === 'string') {
        const ops = this.project(project).ops;
        const key = `${op.machine}/${op.session}/${op.body.rpc}`;
        if (ops.get(key)?.message.body.phase !== 'end') { ops.delete(key); ops.set(key, { at: Date.now(), message: op }); }
        let bytes = 0;
        for (const [index, [id, held]] of [...ops].reverse().entries()) {
          bytes += Buffer.byteLength(JSON.stringify(held.message));
          if (index >= 256 || bytes > 4 * 1024 * 1024 || Date.now() - held.at >= 86400000) ops.delete(id);
        }
      }
    }
    this.broadcast(project, { t: 'session', message });
  }

  /** Whether the hub holds a machine online: one it has no `machines` entry for counts as online here. */
  private online(project: string, machine: string): boolean {
    return this.project(project).machines.find((m) => m.machine === machine)?.online !== false;
  }

  setMachines(project: string, machines: Array<{ machine: string } & MachinePresence>): void {
    this.project(project).machines = machines;
    this.broadcast(project, { t: 'machines', machines });
  }

  setPending(project: string, requests: PendingRequest[]): void {
    this.project(project).pending = requests;
    this.broadcast(project, { t: 'pending', requests });
  }

  /**
   * A request the bridge raised on a machine, sealed with the org key as the machine would: a `raised` message to every
   * browser, and the pending set again. `terminalOnly` stands for the hub's own clock having passed its deadline.
   */
  async raise(project: string, machine: string, draft: Omit<Raised, 'mac'>, options: { terminalOnly?: boolean } = {}): Promise<Raised> {
    const raised = await seal(this.key, 'raised', project, draft);
    this.raiseRaw(project, machine, raised, options);
    return raised;
  }

  /** A raised request exactly as given, code and all (an altered or forged one). */
  raiseRaw(project: string, machine: string, raised: Raised, options: { terminalOnly?: boolean } = {}): void {
    const state = this.project(project);
    this.sendSession(project, { project, machine, session: raised.session, kind: 'raised', sub: null, n: null, body: raised });
    // The hub keys a request by (machine, session, request): a synthetic `request-…` id is minted per bridge.
    const same = (p: PendingRequest) => p.machine === machine && p.raised.session === raised.session && p.raised.request === raised.request;
    this.setPending(project, [...state.pending.filter((p) => !same(p)), { machine, raised, terminal_only: options.terminalOnly === true }]);
  }

  /** The hub's clock passed a background request's deadline: it stays pending, answerable only in the terminal. */
  markTerminalOnly(project: string, request: string): void {
    const state = this.project(project);
    this.setPending(project, state.pending.map((p) => (p.raised.request === request ? { ...p, terminal_only: true } : p)));
  }

  /**
   * The bridge settled a request: a `settled` message to every browser, the decision in the audit record (with the
   * `raised` it settled, null when the hub no longer held it), and the pending set without it.
   */
  async settle(project: string, machine: string, session: string, draft: Omit<Settled, 'mac'>): Promise<Settled> {
    const settled = await seal(this.key, 'settled', project, draft);
    const state = this.project(project);
    const same = (p: PendingRequest) => p.machine === machine && p.raised.session === session && p.raised.request === draft.request;
    const raised = state.pending.find(same)?.raised ?? null;
    this.sendSession(project, { project, machine, session, kind: 'settled', sub: null, n: null, body: settled });
    this.decide(project, { machine, session, settled, raised });
    this.setPending(project, state.pending.filter((p) => !same(p)));
    return settled;
  }

  /** A decision entered in the audit record exactly as given (an altered one included) and sent to every browser. */
  decide(project: string, decision: Decision): void {
    this.record(project, { t: 'decided', decision: { ...this.audit(), ...decision } });
  }

  /** A machine's `deliver_next` settled an event for a recipient: kept as the latest per event and recipient, and sent on. */
  async deliver(project: string, machine: string, draft: Omit<Delivery, 'mac'>): Promise<Delivery> {
    return this.deliverRaw(project, machine, (await seal(this.key, 'delivery', project, draft)) as unknown as Delivery);
  }

  /** A delivery exactly as given, code and all. */
  deliverRaw(project: string, machine: string, delivery: Delivery): Delivery {
    const state = this.project(project);
    const same = (d: Delivery) => d.event.writer === delivery.event.writer && d.event.seq === delivery.event.seq && d.session === delivery.session;
    state.deliveries = [...state.deliveries.filter((d) => !same(d)), delivery];
    this.sendSession(project, { project, machine, session: delivery.session, kind: 'delivery', sub: null, n: null, body: delivery });
    return delivery;
  }

  /** A session's compaction (DX4 `compact`), outside any subscription. */
  sendCompact(project: string, machine: string, session: string, body: SessionBodies['compact']): void {
    this.broadcast(project, { t: 'session', message: { project, machine, session, kind: 'compact', sub: null, n: null, body } });
  }

  /** What a browser's `diff` on a main-transcript subscription is answered with, per session (DX3; DC6 draws it). */
  readonly diffs = new Map<string, SessionBodies['diff']>();

  /** The RPCs browsers sent on a project, oldest first, retries included. */
  rpcs(project: string): Rpc[] {
    return this.up.filter((u) => u.project === project && u.frame.t === 'rpc').map((u) => (u.frame as { rpc: Rpc }).rpc);
  }

  /** The state the double recorded for an RPC, or null for one it failed at once (or never received). */
  rpcState(project: string, nonce: string): RpcState | null {
    return this.project(project).rpcs.get(nonce)?.state ?? null;
  }

  /** The machine's result for an RPC, or `uncertain` (its lease lapsed first): recorded per nonce and sent on. */
  answerRpc(project: string, nonce: string, outcome: RpcOutcome | 'uncertain'): void {
    const record = this.project(project).rpcs.get(nonce);
    if (!record) throw new Error(`no RPC ${nonce}`);
    if (outcome === 'uncertain') record.state = 'uncertain';
    else Object.assign(record, { state: outcome.state, outcome });
    this.sendRpcState(project, nonce, outcome);
  }

  /** A message on an open subscription, numbered after the last one it carried (the snapshot is n 0). */
  sendSub<K extends SubscriptionKind>(project: string, sub: string, kind: K, body: SessionBodies[K]): void {
    const open = this.project(project).subs.get(sub);
    const target = this.subscriptions(project).find((s) => s.sub === sub);
    if (!open || !target) throw new Error(`no subscription ${sub}`);
    const n = open.next++;
    this.broadcast(project, { t: 'session', message: { project, machine: target.machine, session: target.session, kind, sub, n, body } as SessionMessage });
    if (kind === 'end') {
      // An ended sub frees its socket's place too: the 32-a-socket admission counts only what is open.
      this.project(project).subs.delete(sub);
      for (const socket of this.project(project).sockets) socket.subs.delete(sub);
    }
  }

  /**
   * A machine whose lease lapsed, as the hub sees it: offline in `machines`, each subscription it served ended
   * `machine-offline`, and each RPC forwarded to it without a result `uncertain`.
   */
  dropMachine(project: string, machine: string): void {
    const state = this.project(project);
    if (!state.machines.some((m) => m.machine === machine)) state.machines.push({ machine, online: true, policy: { read_only: false, ceiling: 'default' }, checkouts: [] });
    this.setMachines(project, state.machines.map((m) => (m.machine === machine ? { ...m, online: false } : m)));
    for (const [sub, open] of [...state.subs]) if (open.machine === machine) this.sendSub(project, sub, 'end', { reason: 'machine-offline' });
    for (const [nonce, record] of state.rpcs) if (record.rpc.machine === machine && record.state === 'forwarded') this.answerRpc(project, nonce, 'uncertain');
  }

  /** The machine's lease is fresh again: its sessions' kept presence goes to the browsers. */
  restoreMachine(project: string, machine: string): void {
    const state = this.project(project);
    this.setMachines(project, state.machines.map((m) => (m.machine === machine ? { ...m, online: true } : m)));
    for (const message of state.presence.values()) if (message.machine === machine) this.broadcast(project, { t: 'session', message });
  }

  sendRpcState(project: string, nonce: string, outcome: RpcOutcome | 'forwarded' | 'uncertain'): void {
    const frame: ProjectDown = typeof outcome === 'string' ? { t: 'rpc-state', nonce, state: outcome } : { t: 'rpc-state', nonce, state: outcome.state, outcome };
    this.broadcast(project, frame);
  }

  /** A refusal of the hub's own, entered in the project's audit record and sent to its browsers; `at` sets when it was recorded. */
  refuse(project: string, refusal: Refusal & { nonce?: string; machine?: string; member?: string; at?: string }): void {
    this.record(project, { t: 'refused', refusal: { ...this.audit(), ...refusal } });
  }

  /** A daemon's report of an event it refused (DX2 `rejected`), entered in the audit record and sent on. */
  reject(project: string, rejection: Rejection & { machine: string }): void {
    this.record(project, { t: 'rejected', rejection: { ...this.audit(), ...rejection } });
  }

  /** An entry of the audit record, to every browser of the project whether or not it follows the log. */
  private record(project: string, frame: AuditFrame): void {
    this.project(project).audit.push(frame);
    this.broadcast(project, frame);
  }

  private auditId = 0;
  private audit(): { id: number; at: string } {
    this.auditId++;
    return { id: this.auditId, at: new Date().toISOString() };
  }

  /** The subscriptions browsers hold open on a project, oldest first. */
  subscriptions(project: string): Array<{ machine: string; session: string; agentId: string | null; sub: string }> {
    const open = new Map<string, { machine: string; session: string; agentId: string | null; sub: string }>();
    for (const { project: p, frame } of this.up) {
      if (p !== project) continue;
      if (frame.t === 'subscribe') open.set(frame.sub, { machine: frame.machine, session: frame.session, agentId: frame.agentId, sub: frame.sub });
      if (frame.t === 'unsubscribe') open.delete(frame.sub);
    }
    return [...open.values()];
  }

  /** The `after` of every `resume` a project's sockets sent, in order. */
  resumes(project: string): number[] {
    return this.up.filter((u) => u.project === project && u.frame.t === 'resume').map((u) => (u.frame as { after: number }).after);
  }

  // The grid.

  setGrid(projects: ProjectSummary[]): void {
    this.grid = projects;
    for (const ws of this.gridSockets) this.sendRaw(ws, { t: 'grid', projects });
  }

  updateSummary(summary: ProjectSummary): void {
    this.grid = [...this.grid.filter((p) => p.id !== summary.id), summary];
    for (const ws of this.gridSockets) this.sendRaw(ws, { t: 'summary', project: summary } satisfies GridDown);
  }

  // Connections.

  /** Closes every socket, as a deploy restarting every object does. */
  dropConnections(): void {
    for (const socket of this.allSockets()) socket.terminate();
  }

  /** The hub recreated (a local hub started afresh): the project's log, pending set, deliveries, and audit record are
   * gone, and its sockets dropped. */
  recreate(project: string): void {
    const sockets = [...this.project(project).sockets];
    this.projects.delete(project);
    for (const socket of sockets) socket.ws.terminate();
  }

  connected(project: string): number {
    return this.project(project).sockets.size;
  }

  gridConnected(): number {
    return this.gridSockets.size;
  }

  // Internals.

  private project(id: string): ProjectState {
    let state = this.projects.get(id);
    if (!state) {
      state = { log: [], seqs: new Map(), sockets: new Set(), machines: [], pending: [], deliveries: [], presence: new Map(), ops: new Map(), rpcs: new Map(), subs: new Map(), audit: [] };
      this.projects.set(id, state);
    }
    return state;
  }

  private store(project: string, event: LogEvent): { offset: number; event: LogEvent } {
    const state = this.project(project);
    const entry = { offset: this.head(project) + 1, event };
    state.log.push(entry);
    for (const socket of state.sockets) if (socket.resumed) this.sendRaw(socket.ws, { t: 'log', events: [entry] });
    return entry;
  }

  private broadcast(project: string, frame: ProjectDown): void {
    for (const socket of this.project(project).sockets) this.sendRaw(socket.ws, frame);
  }

  /** Text frames sent on registry sockets: a grid over the frame bound goes down in DX2 `part`s (composite fa7f8e8d). */
  gridTexts = 0;

  private sendRaw(ws: WebSocket, frame: ProjectDown | GridDown): void {
    for (const text of toWire(frame, this.options.frameLimit)) {
      if (this.gridSockets.has(ws)) this.gridTexts++;
      ws.send(text);
    }
  }

  private *allSockets(): Iterable<WebSocket> {
    for (const state of this.projects.values()) for (const socket of state.sockets) yield socket.ws;
    yield* this.gridSockets;
  }

  private upgrade(req: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer): void {
    const path = new URL(req.url ?? '/', this.url).pathname;
    const projectMatch = /^\/api\/projects\/([^/]+)\/socket$/.exec(path);
    if (this.admit === 'signed-out') {
      socket.write(`HTTP/1.1 302 Found\r\nLocation: ${this.signInUrl(req)}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      return;
    }
    if (this.admit === 'unreachable') {
      socket.destroy();
      return;
    }
    if (this.admit !== 'member' || (!projectMatch && path !== '/api/registry/socket')) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      if (projectMatch) this.openProject(decodeURIComponent(projectMatch[1]), ws);
      else this.openGrid(ws);
    });
  }

  private openGrid(ws: WebSocket): void {
    this.gridSockets.add(ws);
    ws.on('close', () => this.gridSockets.delete(ws));
    this.sendRaw(ws, { t: 'grid', projects: this.grid });
  }

  private openProject(project: string, ws: WebSocket): void {
    const state = this.project(project);
    const socket: ProjectSocket = { ws, resumed: false, assembler: new PartAssembler(), subs: new Set() };
    state.sockets.add(socket);
    ws.on('close', () => {
      state.sockets.delete(socket);
      for (const sub of socket.subs) state.subs.delete(sub);
    });
    ws.on('message', (data) => {
      let frame = JSON.parse(String(data)) as ProjectUp;
      if (frame.t === 'part') {
        const whole = socket.assembler.add(frame);
        if (whole === undefined) return;
        frame = whole as ProjectUp;
      }
      this.up.push({ project, frame });
      void this.receive(project, socket, frame);
    });
    // DX3's order on connect: each session's presence only for a machine that is online now.
    this.sendRaw(ws, { t: 'welcome', project, member: DOUBLE_MEMBER.id, head: this.head(project) });
    this.sendRaw(ws, { t: 'machines', machines: state.machines });
    for (const message of state.presence.values()) if (this.online(project, message.machine)) this.sendRaw(ws, { t: 'session', message });
    this.sendRaw(ws, { t: 'pending', requests: state.pending });
    for (const held of state.ops.values()) if (Date.now() - held.at < 86400000) this.sendRaw(ws, { t: 'session', message: held.message });
    this.sendRaw(ws, { t: 'deliveries', deliveries: state.deliveries });
  }

  /** A refusal of a browser's frame: into the audit record, to every browser of the project. */
  private refuseFrame(project: string, message: string): void {
    this.refuse(project, { reason: 'bad-shape', message, member: DOUBLE_MEMBER.id });
  }

  private async receive(project: string, socket: ProjectSocket, frame: ProjectUp): Promise<void> {
    const state = this.project(project);
    switch (frame.t) {
      case 'resume': {
        // One page of the backlog (DX3): `more {offset}` when events remain, which the browser resumes from; live `log`
        // only from `caught-up` on, so what is stored between pages comes in a later page.
        socket.resumed = false;
        await this.beforePage?.(frame.after);
        const backlog = state.log.filter((entry) => entry.offset > frame.after);
        const page: typeof backlog = [];
        let size = 0;
        for (const entry of backlog) {
          const bytes = JSON.stringify(entry).length;
          if (page.length > 0 && size + bytes > this.pageBytes) break;
          page.push(entry);
          size += bytes;
        }
        if (page.length > 0) this.sendRaw(socket.ws, { t: 'log', events: page });
        if (page.length < backlog.length) {
          this.sendRaw(socket.ws, { t: 'more', offset: page.at(-1)!.offset });
          return;
        }
        this.sendRaw(socket.ws, { t: 'caught-up', offset: this.head(project) });
        socket.resumed = true;
        for (const frame of state.audit.slice(-AUDIT_REPLAY)) this.sendRaw(socket.ws, frame);
        return;
      }
      case 'human':
        return this.receiveHuman(project, socket, frame.event);
      case 'rpc':
        return this.receiveRpc(project, socket, frame.rpc);
      case 'subscribe': {
        // A subscribe the hub cannot take on ends at once, at n 0.
        const end = (reason: 'machine-offline' | 'error', message?: string) =>
          this.sendRaw(socket.ws, { t: 'session', message: { project, machine: frame.machine, session: frame.session, kind: 'end', sub: frame.sub, n: 0, body: { reason, ...(message && { message }) } } });
        if (state.subs.has(frame.sub)) return end('error', 'this sub is in use: pick a fresh one');
        if (socket.subs.size >= SUBS_PER_SOCKET) return end('error', `at most ${SUBS_PER_SOCKET} subscriptions a socket`);
        if (!this.online(project, frame.machine)) return end('machine-offline');
        state.subs.set(frame.sub, { machine: frame.machine, next: 0 });
        socket.subs.add(frame.sub);
        return;
      }
      case 'unsubscribe':
        state.subs.delete(frame.sub);
        socket.subs.delete(frame.sub);
        return;
      case 'rows':
        if (!Number.isInteger(frame.limit) || frame.limit < 1 || frame.limit > 1000) this.refuseFrame(project, 'rows is {sub, before: row uuid, limit: 1 to 1000}');
        return;
      case 'visibility':
        return;
      case 'output':
        // Carried to the machine at the hub; here a test answers it with `sendSub`, as a machine would.
        if (!isTaskId(frame.taskId) || !isOutputTail(frame.tail)) this.refuseFrame(project, 'output is {sub, taskId: [A-Za-z0-9_-]{1,64}, tail: 1 to 524288 bytes}');
        return;
      case 'read': {
        // Carried to the machine at the hub (the desk control surface's DX3 `read`); here a test or the fake machine
        // answers it with `sendSub`, as a machine would.
        const problem = readShapeError(frame);
        if (problem) this.refuseFrame(project, `read is {sub, id, what, args?}: ${problem}`);
        return;
      }
      case 'diff': {
        // Answered as DX4 `diff` on that sub; a main-transcript subscription's only, as DX3 has it.
        const target = this.subscriptions(project).find((s) => s.sub === frame.sub);
        if (target && target.agentId === null && state.subs.has(frame.sub)) this.sendSub(project, frame.sub, 'diff', this.diffs.get(target.session) ?? { base: 'main', text: '' });
        return;
      }
      default:
        this.refuseFrame(project, `no frame ${JSON.stringify((frame as { t?: unknown }).t)}`);
        return;
    }
  }

  private receiveHuman(project: string, socket: ProjectSocket, event: HumanEvent): void {
    if (event.member !== DOUBLE_MEMBER.id) {
      this.refuse(project, { reason: 'writer-not-yours', member: DOUBLE_MEMBER.id, nonce: event.mac.nonce, message: 'a web human is written by the member signed in' });
      return;
    }
    const known = this.project(project).log.find((entry) => (entry.event.mac as { nonce?: string }).nonce === event.mac.nonce);
    const writer = hubWriter(event.member);
    let entry = known;
    if (!entry) {
      const seq = (this.project(project).seqs.get(writer) ?? 0) + 1;
      this.project(project).seqs.set(writer, seq);
      entry = this.store(project, { ...event, writer, seq, ts: new Date().toISOString() } as unknown as LogEvent);
    }
    if (this.ackHumans) this.sendRaw(socket.ws, { t: 'human-ack', nonce: event.mac.nonce, offset: entry.offset, writer, seq: entry.event.seq });
  }

  /**
   * DX6 at the hub, in its order: a nonce it has recorded is answered from its record (an `uncertain` one forwarded
   * again once its machine is back); then an RPC older than 60 s, or to a machine without a fresh lease, fails at once
   * — to the sender alone, never recorded, so a retry is judged afresh; anything else is recorded `forwarded` and the
   * test answers it with `answerRpc`. A recorded state goes to every socket of the member (here, every socket).
   */
  private receiveRpc(project: string, socket: ProjectSocket, rpc: Rpc): void {
    const state = this.project(project);
    const known = state.rpcs.get(rpc.nonce);
    if (known) {
      if (known.state === 'uncertain' && this.online(project, rpc.machine)) {
        known.state = 'forwarded';
        this.sendRpcState(project, rpc.nonce, 'forwarded');
        return;
      }
      this.sendRaw(socket.ws, known.outcome ? { t: 'rpc-state', nonce: rpc.nonce, state: known.outcome.state, outcome: known.outcome } : { t: 'rpc-state', nonce: rpc.nonce, state: known.state });
      return;
    }
    const fail = (code: 'stale' | 'machine-offline', message: string) => this.sendRaw(socket.ws, { t: 'rpc-state', nonce: rpc.nonce, state: 'failed', outcome: { state: 'failed', error: { code, message } } });
    if (!(Date.now() - Date.parse(rpc.created) <= RPC_FRESHNESS_MS)) return fail('stale', 'older than 60 seconds: issue it again');
    if (!this.online(project, rpc.machine)) return fail('machine-offline', `${rpc.machine} is offline`);
    state.rpcs.set(rpc.nonce, { rpc, state: 'forwarded' });
    this.sendRpcState(project, rpc.nonce, 'forwarded');
  }

  private async http(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url);
    const path = url.pathname;
    if (path === '/cdn-cgi/access/authorized') {
      // Access's return leg: it sets its session cookie and sends the browser on to the path it first asked for.
      this.admit = 'member';
      res.writeHead(302, { Location: url.searchParams.get('redirect_url') ?? '/' });
      res.end();
      return;
    }
    if (this.admit === 'signed-out') {
      res.writeHead(302, { Location: this.signInUrl(req) });
      res.end();
      return;
    }
    if (path.startsWith('/api/') && this.admit === 'unreachable') {
      req.socket.destroy();
      return;
    }
    if (path.startsWith('/api/') && this.admit !== 'member') {
      json(res, 403, { error: 'not-a-member' });
      return;
    }
    const member: MemberRecord = { ...DOUBLE_MEMBER, role: this.role };
    if (path === '/api/me') {
      json(res, 200, { org: { ...DOUBLE_ORG, key_check: this.orgKeys.key_check }, member });
      return;
    }
    const body = await readJson(req);
    const method = req.method ?? 'GET';
    const answer = (await this.orgKeys.handle(member, method, path, body)) ?? (await this.push.handle(member, method, path, body)) ?? this.machineRecords.handle(member, method, path, body);
    if (answer) {
      json(res, answer.status, answer.body);
      return;
    }
    if (path.startsWith('/api/') || !this.options.staticDir) {
      json(res, 404, { error: 'not-found' });
      return;
    }
    this.serveStatic(this.options.staticDir, path, req, res);
  }

  private signInUrl(req: IncomingMessage): string {
    return `${this.signIn}/cdn-cgi/access/login/${new URL(this.url).host}?redirect_url=${encodeURIComponent(req.url ?? '/')}`;
  }

  /** Access's sign-in page: one button, which returns the browser to the hub's origin through Access's return leg. */
  private accessSignIn(req: IncomingMessage, res: ServerResponse): void {
    const back = new URL(req.url ?? '/', this.signIn).searchParams.get('redirect_url') ?? '/';
    const authorized = `${this.url}/cdn-cgi/access/authorized?redirect_url=${encodeURIComponent(back)}`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><title>Sign in · Cloudflare Access</title><a href="${authorized.replaceAll('"', '&quot;')}">Sign in</a>`);
  }

  /** The built app, compressed as the Worker's static assets are when the browser accepts it (gzip here). */
  private serveStatic(dir: string, path: string, req: IncomingMessage, res: ServerResponse): void {
    const file = normalize(join(dir, decodeURIComponent(path)));
    const inside = file.startsWith(normalize(dir)) && existsSync(file) && statSync(file).isFile();
    const target = inside ? file : join(dir, 'index.html');
    const type = CONTENT_TYPES[extname(target)] ?? 'application/octet-stream';
    const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? '')) && !type.startsWith('image/png');
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=0, must-revalidate', ...(gzip && { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' }) });
    const body = createReadStream(target);
    if (gzip) body.pipe(createGzip()).pipe(res);
    else body.pipe(res);
  }
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
