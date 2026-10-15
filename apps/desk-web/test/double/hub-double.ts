// The DX3 protocol double (the DC5 plan's Decision Log, "Building ahead of the hub"): a local stand-in for the hub's
// browser side, for the web app's suites while DC3's local hub and fake machine are still to land. It speaks
// `desk-hub/protocol`'s types and nothing of its own: `/api/me`, DX7's wrapped keys (./org-keys.ts), the project
// socket (`ProjectUp` / `ProjectDown`), and the registry socket (`GridDown`); it numbers stored events with project offsets, seals what it appends with the org
// key the way a machine's daemon would (DX1), and serves a built app from a directory with the single-page fallback the
// Worker's static assets will have. Every discontinuity a test needs is a method: drop every socket (a deploy), send
// a frame in parts, hold acknowledgements, store an event whose code fails. For the conversation (the plan's M3) it also
// stands in for what DC3's M3 routes and its fake machine (M4) produces: requests raised and settled, deliveries, the
// RPC record per nonce (a retry answered from it, an offline machine failing at once, a dropped machine leaving its
// forwarded RPCs `uncertain`), subscriptions numbered and ended, and a session's compaction messages.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';
import {
  hubWriter,
  importOrgKey,
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
  type RpcState,
  type SessionBodies,
  type SubscriptionKind,
} from 'desk-hub/protocol';
import { WebSocketServer, type WebSocket } from 'ws';
import { OrgKeysDouble } from './org-keys';
import type { DeliveryAhead, RaisedAhead } from '../../src/hub/protocol-ahead';

/** The org as the double holds it before any key is set up (`/api/me` answers its current `key_check`). */
export const DOUBLE_ORG: OrgRecord = { id: 'org-double', name: 'Double org', created: '2026-10-15T00:00:00.000Z', key_check: null };
export const DOUBLE_MEMBER: MemberRecord = { id: '4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c', email: 'owner@example.com', role: 'admin', created: '2026-10-15T00:00:00.000Z' };

/** The fields a machine writes beyond `ts`, `writer`, `seq`, and `mac`. */
export type EventDraft = { writer: string; kind: string } & Record<string, unknown>;

type ProjectSocket = { ws: WebSocket; resumed: boolean; assembler: PartAssembler };
type ProjectState = {
  log: Array<{ offset: number; event: LogEvent }>;
  seqs: Map<string, number>;
  sockets: Set<ProjectSocket>;
  machines: Array<{ machine: string } & MachinePresence>;
  pending: PendingRequest[];
  deliveries: Delivery[];
  /** Each session's latest presence, sent to a socket when it connects (an assumption about DX3; see sendSession). */
  presence: Map<string, SessionMessage>;
  /** The hub's record per RPC nonce: the RPC, its state, and its outcome once one came. */
  rpcs: Map<string, { rpc: Rpc; state: RpcState; outcome?: RpcOutcome }>;
  /** Each open subscription's machine and the `n` of its next message. */
  subs: Map<string, { machine: string; next: number }>;
};

export type DoubleOptions = {
  /** The org key's 32 bytes; what the double seals with, as an enrolled machine would. */
  orgKey: Uint8Array;
  /** Every frame down is cut into parts above this many bytes (DX2's bound is 1 MiB). */
  frameLimit?: number;
  /** A built app to serve, with the single-page fallback. */
  staticDir?: string;
  /** Who `/api/me` admits: the member, or nobody (403 not-a-member). */
  admit?: 'member' | 'not-a-member';
};

export class HubDouble {
  readonly url: string;
  readonly up: Array<{ project: string; frame: ProjectUp }> = [];
  /** Answer each `human` with `human-ack` (true), or hold the acknowledgement as a hub that dropped mid-write would. */
  ackHumans = true;
  admit: 'member' | 'not-a-member';
  /** DX7's wrapped keys (`/api/org/keys`), with the hub's rules: `not-key-holder`, `different-key`, `last-key`. */
  readonly orgKeys = new OrgKeysDouble();
  private readonly projects = new Map<string, ProjectState>();
  private readonly gridSockets = new Set<WebSocket>();
  private grid: ProjectSummary[] = [];
  private readonly wss = new WebSocketServer({ noServer: true });

  private constructor(
    private readonly server: Server,
    private readonly key: OrgKey,
    private readonly options: DoubleOptions,
  ) {
    this.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    this.admit = options.admit ?? 'member';
  }

  static async start(options: DoubleOptions): Promise<HubDouble> {
    const key = await importOrgKey(options.orgKey);
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const double = new HubDouble(server, key, options);
    server.on('request', (req, res) => void double.http(req, res));
    server.on('upgrade', (req, socket, head) => double.upgrade(req, socket as never, head));
    return double;
  }

  async close(): Promise<void> {
    for (const socket of this.allSockets()) socket.terminate();
    this.wss.close();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
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
   * A DX4 message to every socket of the project. A `presence` is also kept and sent to each socket that connects
   * later: DX3 sends `machines` on connect and does not say whether presence follows it; the double assumes it does.
   */
  sendSession(project: string, message: SessionMessage): void {
    if (message.kind === 'presence') this.project(project).presence.set(message.session, message);
    this.broadcast(project, { t: 'session', message });
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
  async raise(project: string, machine: string, draft: Omit<RaisedAhead, 'mac'>, options: { terminalOnly?: boolean } = {}): Promise<Raised> {
    const raised = await seal(this.key, 'raised', project, draft);
    this.raiseRaw(project, machine, raised, options);
    return raised;
  }

  /** A raised request exactly as given, code and all (an altered or forged one). */
  raiseRaw(project: string, machine: string, raised: Raised, options: { terminalOnly?: boolean } = {}): void {
    const state = this.project(project);
    this.sendSession(project, { project, machine, session: raised.session, kind: 'raised', sub: null, n: null, body: raised });
    this.setPending(project, [...state.pending.filter((p) => p.raised.request !== raised.request), { machine, raised, terminal_only: options.terminalOnly === true }]);
  }

  /** The hub's clock passed a background request's deadline: it stays pending, answerable only in the terminal. */
  markTerminalOnly(project: string, request: string): void {
    const state = this.project(project);
    this.setPending(project, state.pending.map((p) => (p.raised.request === request ? { ...p, terminal_only: true } : p)));
  }

  /** The bridge settled a request: a `settled` message to every browser, and the pending set without it. */
  async settle(project: string, machine: string, session: string, draft: Omit<Settled, 'mac'>): Promise<Settled> {
    const settled = await seal(this.key, 'settled', project, draft);
    const state = this.project(project);
    this.sendSession(project, { project, machine, session, kind: 'settled', sub: null, n: null, body: settled });
    this.setPending(project, state.pending.filter((p) => p.raised.request !== draft.request));
    return settled;
  }

  /** A machine's `deliver_next` settled an event for a recipient: kept as the latest per event and recipient, and sent on. */
  async deliver(project: string, machine: string, draft: Omit<DeliveryAhead, 'mac'>): Promise<Delivery> {
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
    if (kind === 'end') this.project(project).subs.delete(sub);
  }

  /**
   * A machine whose lease lapsed, as the hub sees it: offline in `machines`, each subscription it served ended
   * `machine-offline`, and each RPC forwarded to it without a result `uncertain`.
   */
  dropMachine(project: string, machine: string): void {
    const state = this.project(project);
    this.setMachines(project, state.machines.map((m) => (m.machine === machine ? { ...m, online: false } : m)));
    for (const [sub, open] of [...state.subs]) if (open.machine === machine) this.sendSub(project, sub, 'end', { reason: 'machine-offline' });
    for (const [nonce, record] of state.rpcs) if (record.rpc.machine === machine && record.state === 'forwarded') this.answerRpc(project, nonce, 'uncertain');
  }

  /** The machine's lease is fresh again. */
  restoreMachine(project: string, machine: string): void {
    const state = this.project(project);
    this.setMachines(project, state.machines.map((m) => (m.machine === machine ? { ...m, online: true } : m)));
  }

  sendRpcState(project: string, nonce: string, outcome: RpcOutcome | 'forwarded' | 'uncertain'): void {
    const frame: ProjectDown = typeof outcome === 'string' ? { t: 'rpc-state', nonce, state: outcome } : { t: 'rpc-state', nonce, state: outcome.state, outcome };
    this.broadcast(project, frame);
  }

  /** A refusal of the hub's own, entered in the project's audit record and sent to its browsers. */
  refuse(project: string, refusal: Refusal & { nonce?: string; machine?: string; member?: string }): void {
    this.broadcast(project, { t: 'refused', refusal: { ...this.audit(), ...refusal } });
  }

  /** A daemon's report of an event it refused (DX2 `rejected`), entered in the audit record and sent on. */
  reject(project: string, rejection: Rejection & { machine: string }): void {
    this.broadcast(project, { t: 'rejected', rejection: { ...this.audit(), ...rejection } });
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
      state = { log: [], seqs: new Map(), sockets: new Set(), machines: [], pending: [], deliveries: [], presence: new Map(), rpcs: new Map(), subs: new Map() };
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
    const socket: ProjectSocket = { ws, resumed: false, assembler: new PartAssembler() };
    state.sockets.add(socket);
    ws.on('close', () => state.sockets.delete(socket));
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
    this.sendRaw(ws, { t: 'welcome', project, member: DOUBLE_MEMBER.id, head: this.head(project) });
    this.sendRaw(ws, { t: 'machines', machines: state.machines });
    this.sendRaw(ws, { t: 'pending', requests: state.pending });
    this.sendRaw(ws, { t: 'deliveries', deliveries: state.deliveries });
    for (const message of state.presence.values()) this.sendRaw(ws, { t: 'session', message });
  }

  private async receive(project: string, socket: ProjectSocket, frame: ProjectUp): Promise<void> {
    const state = this.project(project);
    switch (frame.t) {
      case 'resume': {
        const backlog = state.log.filter((entry) => entry.offset > frame.after);
        if (backlog.length > 0) this.sendRaw(socket.ws, { t: 'log', events: backlog });
        this.sendRaw(socket.ws, { t: 'caught-up', offset: this.head(project) });
        socket.resumed = true;
        return;
      }
      case 'human':
        return this.receiveHuman(project, socket, frame.event);
      case 'rpc':
        return this.receiveRpc(project, socket, frame.rpc);
      case 'subscribe':
        state.subs.set(frame.sub, { machine: frame.machine, next: 0 });
        return;
      case 'unsubscribe':
        state.subs.delete(frame.sub);
        return;
      case 'diff': {
        // Answered as DX4 `diff` on that sub; a main-transcript subscription's only, as DX3 has it.
        const target = this.subscriptions(project).find((s) => s.sub === frame.sub);
        if (target && target.agentId === null && state.subs.has(frame.sub)) this.sendSub(project, frame.sub, 'diff', this.diffs.get(target.session) ?? { base: 'main', text: '' });
        return;
      }
      default:
        return;
    }
  }

  private receiveHuman(project: string, socket: ProjectSocket, event: HumanEvent): void {
    if (event.member !== DOUBLE_MEMBER.id) {
      this.sendRaw(socket.ws, { t: 'refused', refusal: { ...this.audit(), reason: 'bad-shape', message: 'member is not the signed-in member', nonce: event.mac.nonce } });
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
   * DX6 at the hub: a nonce it holds a result for is answered from its record; an RPC to a machine without a fresh lease
   * fails at once, `machine-offline`, nothing queued; anything else is forwarded (again, for a retry of a `forwarded`
   * or `uncertain` one), and the test answers it with `answerRpc`.
   */
  private receiveRpc(project: string, socket: ProjectSocket, rpc: Rpc): void {
    const state = this.project(project);
    const known = state.rpcs.get(rpc.nonce);
    if (known?.outcome) {
      this.sendRaw(socket.ws, { t: 'rpc-state', nonce: rpc.nonce, state: known.outcome.state, outcome: known.outcome });
      return;
    }
    if (known && state.machines.find((m) => m.machine === rpc.machine)?.online === false) {
      this.sendRaw(socket.ws, { t: 'rpc-state', nonce: rpc.nonce, state: known.state });
      return;
    }
    if (state.machines.find((m) => m.machine === rpc.machine)?.online === false) {
      const outcome: RpcOutcome = { state: 'failed', error: { code: 'machine-offline', message: `${rpc.machine} is offline` } };
      state.rpcs.set(rpc.nonce, { rpc, state: 'failed', outcome });
      this.sendRaw(socket.ws, { t: 'rpc-state', nonce: rpc.nonce, state: 'failed', outcome });
      return;
    }
    state.rpcs.set(rpc.nonce, { rpc, state: 'forwarded' });
    this.sendRaw(socket.ws, { t: 'rpc-state', nonce: rpc.nonce, state: 'forwarded' });
  }

  private async http(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? '/', this.url).pathname;
    if (path.startsWith('/api/') && this.admit !== 'member') {
      json(res, 403, { error: 'not-a-member' });
      return;
    }
    if (path === '/api/me') {
      json(res, 200, { org: { ...DOUBLE_ORG, key_check: this.orgKeys.key_check }, member: DOUBLE_MEMBER });
      return;
    }
    const keys = await this.orgKeys.handle(DOUBLE_MEMBER, req.method ?? 'GET', path, await readJson(req));
    if (keys) {
      json(res, keys.status, keys.body);
      return;
    }
    if (path.startsWith('/api/') || !this.options.staticDir) {
      json(res, 404, { error: 'not-found' });
      return;
    }
    this.serveStatic(this.options.staticDir, path, res);
  }

  private serveStatic(dir: string, path: string, res: ServerResponse): void {
    const file = normalize(join(dir, decodeURIComponent(path)));
    const inside = file.startsWith(normalize(dir)) && existsSync(file) && statSync(file).isFile();
    const target = inside ? file : join(dir, 'index.html');
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(target)] ?? 'application/octet-stream' });
    createReadStream(target).pipe(res);
  }
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
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
