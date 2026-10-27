// RL1's side of a machine (O11 M6; Interfaces §C): the endpoint's one WebSocket and each app's WebSocket to the machine,
// held by a `Machine` object addressed by the machine's ref (`relayObjectName`), never by its name. DX2's stream stays in
// the name-addressed object (machine.ts), so the two never share an object; that object keeps the one generation
// counter both transports draw from, the revocation fence, and the address its projects reach the machine by: a
// project's frame for an RL1 generation reaches this object through it (`relaySend`).
//
// A generation is a name's: a machine renamed in the org state keeps its ref, so connections of two names, each counted
// by its own name's object, meet here. Connections here are numbered by this object (`conn`), the newest installed one
// is current whatever its name, and each name has a fence (`fence:<name>`): the lowest generation of that name that
// may still install. Installing a connection raises its name's fence to its generation, and a connection replaced,
// superseded by a DX2 stream, or revoked raises its name's fence past its own, so a claim the name's object granted
// before any of these and that arrives after them is refused, never installed (`endpoint`), and a connection under the
// fence carries nothing more (`live`). The name's object delivers its supersessions and revocations until they are
// taken (machine.ts's owed calls).
//
// A fence orders one name's generations; it cannot order two names', whose counters are apart, and a rename moves the
// ref from one name to the other. So an upgrade installs only while the Registry still binds its name to this ref
// (`machineBinds`, asked after its claim is answered: the Worker's binding is as old as the Worker's admission), and
// only if no connection of another name that reached this object later installed while it waited: each upgrade takes
// this object's next arrival number first, and the newest install keeps its name and the highest arrival installed
// (`installed`). An upgrade the Worker admitted under the old name before a rename thus cannot displace the renamed
// endpoint's connection, however late it reaches this object.
//
// Over the endpoint's socket travel DX2's log plane (each project's frames handed to it through `Project.fromMachine`,
// as DX2's POSTs are), `hb`/`hb-ack` with the lease, the machine's signed `listing` and `endpoint` records and its
// `notify` (to the Registry), the `state` notice, and the channel multiplex. An app's socket carries channels only.
// Channel frames are forwarded at once, unread and unbuffered, with no flow control: credit is RL3's, end to end.
//
// Both kinds of socket hibernate. Nothing kept in memory is needed after an eviction:
//   - the endpoint socket's attachment is `{kind: 'endpoint', conn}`; the current connection (its conn, generation,
//     org, name, credential, whether it said hello) is in `kv` `endpoint`;
//   - the projects a connection opened are in `kv` `rl1-projects:<conn>`, with what their lease calls need;
//   - each app socket's attachment is `{kind: 'app', member, device?, channels}`, and the channel → socket map is
//     rebuilt from them (`map`);
//   - the members of the newest org state the Registry announced here are in `kv` `state-members`;
//   - the per-project order of log frames lives only while frames are in flight, which no idle object (the only kind
//     evicted) has. A frame sent as parts can span an eviction: a part that continues a set this instance never began
//     closes the connection `4412 parts-lost`, and the endpoint, reconnecting, sends again what its hellos say is
//     missing.
// The ends drive the heartbeats; this object keeps no timer. A code update drops hibernated sockets: every end
// reconnects, and the endpoint's next connection takes a higher generation.
import {
  CHANNEL_CLOSE,
  decodeChannelFrame,
  encodeChannelFrame,
  isEndpointHello,
  isNotify,
  isRl1Heartbeat,
  MAX_CHANNELS_PER_SOCKET,
  RL1_MESSAGE_LIMIT,
  RL1_PROTOCOL,
  tagBytes,
  type ChannelCloseReason,
  type NotifyFrame,
  type RelayPresence,
  type Rl1Refusal,
} from 'org-protocol';
import { CLIENT_HEADER, MACHINE_HEADER, MEMBER_HEADER, ORG_HEADER, REF_HEADER, type Env } from '../env';
import { NOT_ON_RL1, RL1_LOG_DOWN, type DownFrame, type UpFrame } from '../protocol/machine';
import { PartAssembler, toWire, utf8Length, type Part } from '../protocol/parts';
import type { Machine, Sent, Timing } from './machine';
import { described, PROJECT_ID, type MachineContext } from './project';
import { lacksMethod } from './retry';

/** The name of the `Machine` object that holds a machine's RL1 sockets: its ref under the org. A machine name holds no
 * `:`, so this never names a DX2 object (`<org>:<name>`). */
export const relayObjectName = (org: string, ref: string) => `${org}:ref:${ref}`;

/** The current endpoint connection: `conn` is this object's number for it, `generation` its name's. */
type Current = { conn: number; generation: number; org: string; name: string; client: string; welcomed: boolean };
type EndpointAttachment = { kind: 'endpoint'; conn: number };
type AppAttachment = { kind: 'app'; member: string; device?: string; channels: number[] };
type Attachment = EndpointAttachment | AppAttachment;
/** The projects a connection opened, and what a lease call for it carries. */
type Opened = { org: string; name: string; client: string; generation: number; projects: string[] };
/** A name's fence: the lowest generation of it that may install, and why the ones below may not. */
type Fence = { from: number; cause: 'replaced' | 'revoked' };
/** The newest install's name, and the highest arrival number (`arrival-seq`) any install held. */
type Installed = { name: string; arrival: number };

/** Close codes of the sockets: the endpoint's when a newer connection or a revocation ends it, or when a frame's parts
 * were lost to an eviction (send it again), either kind's for a message over 1 MiB, or for a frame out of order. */
const CLOSE = { replaced: 4409, revoked: 4403, partsLost: 4412, protocol: 4400, tooLarge: 1009, failed: 1011 } as const;

/** Codes a close reports but no close frame may carry (no status, abnormal closure, TLS failure): answered 1000. */
const ECHOLESS = new Set([1005, 1006, 1015]);

const json = (status: number, body: unknown) => Response.json(body, { status });
type Frame = { t: string } & Record<string, unknown>;
const isFrame = (value: unknown): value is Frame => typeof value === 'object' && value !== null && !Array.isArray(value) && typeof (value as { t?: unknown }).t === 'string';
const projectsKey = (conn: number) => `rl1-projects:${conn}`;
/** A name's fence, keyed by the exact name its generation counter's object is addressed by (`<org>:<name>`): names
 * that differ only in case are two counters, and never compared. */
const fenceKey = (name: string) => `fence:${name}`;

function note(line: Record<string, unknown>): void {
  console.log(JSON.stringify({ desk: 'machine-stream', transport: 'rl1', ...line }));
}

export class Relay {
  /** Channel id → the app socket that holds it; rebuilt from the attachments after an eviction (`map`). */
  private channels: Map<number, WebSocket> | undefined;
  /** A connection's part sets being joined (its conn's). */
  private parts: { conn: number; assembler: PartAssembler } | undefined;
  /** The last call queued per order key (a project, the Registry): each waits for the one before it. */
  private readonly order = new Map<string, Promise<unknown>>();

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
    private readonly timing: () => Timing,
  ) {
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS relay_pending (session TEXT PRIMARY KEY, project TEXT NOT NULL, kind TEXT NOT NULL, pending INTEGER NOT NULL)');
    // An app's ping is answered without waking the object (the ends drive the heartbeats); one that wakes it anyway is
    // answered by `fromApp`.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private get kv() {
    return this.ctx.storage.kv;
  }

  private current(): Current | undefined {
    return this.kv.get<Current>('endpoint');
  }

  /** The current connection, unless its name's fence passed it: then it ends here, and nothing more travels on it. */
  private live(): Current | undefined {
    const current = this.current();
    const fence = current && this.fence(current.name);
    if (!current || !fence || current.generation >= fence.from) return current;
    this.retire(current, fence.cause === 'revoked' ? CLOSE.revoked : CLOSE.replaced, fence.cause);
    return undefined;
  }

  private fence(name: string): Fence | undefined {
    return this.kv.get<Fence>(fenceKey(name));
  }

  /** Raises a name's fence to `from`; never lowers it. */
  private raiseFence(name: string, from: number, cause: Fence['cause']): void {
    const held = this.fence(name);
    if (!held || held.from < from) this.kv.put(fenceKey(name), { from, cause } satisfies Fence);
  }

  private get ref(): string {
    return this.kv.get<string>('ref') ?? '';
  }

  // ---- Upgrades ------------------------------------------------------------------------------------------------

  /** The endpoint's socket: the next generation, drawn from the machine's name-addressed object, which refuses a revoked
   * credential and ends the machine's DX2 stream; installed unless the name no longer binds this ref, its name's fence
   * passed it while it waited, or a later upgrade of another name installed meanwhile, and then it ends the connection
   * before it here, whatever that one's name, with its channels. */
  async endpoint(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return json(426, { error: 'upgrade-required' });
    const org = request.headers.get(ORG_HEADER) ?? '';
    const name = request.headers.get(MACHINE_HEADER) ?? '';
    const client = request.headers.get(CLIENT_HEADER) ?? '';
    const ref = request.headers.get(REF_HEADER) ?? '';
    this.kv.put('ref', ref);
    const arrival = (this.kv.get<number>('arrival-seq') ?? 0) + 1;
    this.kv.put('arrival-seq', arrival);
    let claimed: { generation: number } | { refused: 'revoked' };
    try {
      claimed = await this.named(org, name).claimGeneration(org, name, ref, client);
    } catch (error) {
      note({ event: 'claim-failed', machine: name, ref, error: described(error) });
      return json(503, { error: lacksMethod(error, 'claimGeneration') ? 'hub-updating' : 'hub-unavailable', message: 'connect again' });
    }
    if ('refused' in claimed) return json(403, { error: 'not-enrolled', message: 'this credential was revoked' });
    const { generation } = claimed;
    // The org state may have renamed the machine since the Worker resolved this name to the ref. Asked last, so the
    // fences below order whatever installed while it was answered.
    let binds: boolean;
    try {
      binds = await this.registry(org).machineBinds(name, ref);
    } catch (error) {
      note({ event: 'binding-failed', machine: name, ref, error: described(error) });
      return json(503, { error: lacksMethod(error, 'machineBinds') ? 'hub-updating' : 'hub-unavailable', message: 'connect again' });
    }
    if (!binds) return json(409, { error: 'not-listed', message: 'the org state lists no machine of this name: RL1 serves a machine once an admin lists its key' });
    // While it waited, a newer connection of the name installed, a DX2 stream took a newer generation, or
    // the credential was revoked: this one is ended already.
    const fence = this.fence(name);
    if (fence && generation < fence.from) {
      return fence.cause === 'revoked'
        ? json(403, { error: 'not-enrolled', message: 'this credential was revoked' })
        : json(409, { error: 'stale-generation', message: 'a newer connection of this machine opened meanwhile' });
    }
    // While it waited, a connection of another name (the machine renamed) that came after this one installed.
    const installed = this.kv.get<Installed>('installed');
    if (installed && installed.name !== name && installed.arrival > arrival) {
      return json(409, { error: 'stale-generation', message: 'a newer connection of this machine opened meanwhile' });
    }
    const before = this.current();
    const conn = (this.kv.get<number>('conn-seq') ?? 0) + 1;
    this.kv.put('conn-seq', conn);
    const pair = new WebSocketPair();
    const [outside, inside] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(inside, ['endpoint']);
    inside.serializeAttachment({ kind: 'endpoint', conn } satisfies EndpointAttachment);
    this.kv.put('endpoint', { conn, generation, org, name, client, welcomed: false } satisfies Current);
    this.kv.put(projectsKey(conn), { org, name, client, generation, projects: [] } satisfies Opened);
    this.raiseFence(name, generation, 'replaced');
    this.kv.put('installed', { name, arrival: Math.max(arrival, installed?.arrival ?? 0) } satisfies Installed);
    if (before) {
      this.raiseFence(before.name, before.generation + 1, 'replaced');
      this.retire(before, CLOSE.replaced, 'replaced');
    }
    note({ event: 'open', machine: name, ref, generation, conn });
    return new Response(null, { status: 101, webSocket: outside });
  }

  /** An app's socket, as a member (a device once M7's principal exists): channels only. */
  app(request: Request): Response {
    if (request.headers.get('Upgrade') !== 'websocket') return json(426, { error: 'upgrade-required' });
    const ref = request.headers.get(REF_HEADER);
    if (ref) this.kv.put('ref', ref);
    const member = request.headers.get(MEMBER_HEADER) ?? '';
    // A member the newest state announced here no longer holds, admitted by the Worker just before it was removed.
    const announced = this.kv.get<{ members: string[] }>('state-members');
    if (announced && !announced.members.includes(member)) return json(403, { error: 'removed' });
    const pair = new WebSocketPair();
    const [outside, inside] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(inside, ['app']);
    inside.serializeAttachment({ kind: 'app', member, channels: [] } satisfies AppAttachment);
    this.sendTo(inside, JSON.stringify(this.presence()));
    return new Response(null, { status: 101, webSocket: outside });
  }

  // ---- Messages ------------------------------------------------------------------------------------------------

  async message(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment;
    const size = typeof message === 'string' ? utf8Length(message) : message.byteLength;
    if (size > RL1_MESSAGE_LIMIT) {
      this.closeSocket(ws, CLOSE.tooLarge, 'too-large');
      return this.gone(ws, attachment);
    }
    // A connection its name's fence passed ends before anything travels, either way.
    const current = this.live();
    if (attachment.kind === 'app') return this.fromApp(ws, attachment, message);
    if (current?.conn !== attachment.conn) return this.closeSocket(ws, CLOSE.replaced, 'replaced');
    if (typeof message === 'string') return this.fromEndpointText(ws, current, message);
    return this.fromEndpointBinary(ws, message);
  }

  /** A socket closed (`code` its other end's) or failed: an endpoint's ends its connection, an app's its channels. A
   * close is answered first, with the code and reason it came with (RFC 6455 §5.5.1: a close frame is answered by
   * one, its code typically echoed), so the closing end is not left to time out, and the endpoint's code is not
   * replaced by a server error's. */
  closed(ws: WebSocket, code?: number, reason = ''): void {
    if (code !== undefined) this.closeSocket(ws, ECHOLESS.has(code) ? 1000 : code, reason);
    this.gone(ws, ws.deserializeAttachment() as Attachment);
  }

  private gone(ws: WebSocket, attachment: Attachment): void {
    if (attachment.kind === 'app') return this.appGone(ws, attachment);
    const current = this.current();
    if (current?.conn === attachment.conn) this.retire(current, CLOSE.failed, 'closed');
    // An older connection's projects are closed once; a retired connection's were already.
    else this.closeProjects(attachment.conn);
  }

  // ---- The endpoint's text frames ------------------------------------------------------------------------------

  private async fromEndpointText(ws: WebSocket, current: Current, text: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return this.refuse(ws, { frame: '', status: 400, error: 'bad-shape', message: 'a text message is one JSON frame' });
    }
    if (!isFrame(parsed)) return this.refuse(ws, { frame: '', status: 400, error: 'bad-shape', message: 'a frame is a JSON object with a string `t`' });
    let frame = parsed;
    if (!current.welcomed) return this.hello(ws, current, frame);
    if (frame.t === 'part') {
      const joined = this.join(current, frame as unknown as Part, ws);
      if (!isFrame(joined)) return;
      frame = joined;
    }
    if (frame.t === 'hb') return this.heartbeat(ws, current, frame);
    if (frame.t === 'hello' || frame.t === 'events' || frame.t === 'rejected') return this.logPlane(ws, current, frame as UpFrame);
    if (frame.t === 'listing' || frame.t === 'endpoint') return this.record(ws, current, frame.t, frame.record);
    if (frame.t === 'notify') return this.notify(ws, current, frame);
    if (NOT_ON_RL1.has(frame.t)) {
      return this.refuse(ws, { frame: frame.t, status: 422, error: 'not-on-rl1', message: 'RL1 carries no DX4/DX6 session-plane frame: send it in a channel' });
    }
    return this.refuse(ws, { frame: frame.t, status: 400, error: 'bad-shape', message: `RL1 has no frame "${frame.t}"` });
  }

  /** The connection's first frame: the endpoint's hello, for this machine's ref, in a protocol this hub speaks. */
  private async hello(ws: WebSocket, current: Current, frame: Record<string, unknown>): Promise<void> {
    if (!isEndpointHello(frame)) return this.closeSocket(ws, CLOSE.protocol, 'hello-first');
    if (frame.machine !== this.ref) return this.closeSocket(ws, CLOSE.protocol, 'wrong-machine');
    if (frame.protocol.major !== RL1_PROTOCOL.major) return this.closeSocket(ws, CLOSE.protocol, 'unsupported-protocol');
    this.kv.put('endpoint', { ...current, welcomed: true } satisfies Current);
    note({ event: 'hello', machine: current.name, generation: current.generation, build: frame.build, leaseGeneration: frame.leaseGeneration ?? null });
    this.sendTo(ws, JSON.stringify({ t: 'welcome', generation: current.generation, heartbeat_ms: this.timing().heartbeatMs }));
    this.broadcastPresence();
    let version: number | null = null;
    try {
      version = await this.registry(current.org).stateVersion();
    } catch {
      // A Registry on older code, or out of reach: the endpoint reads the state on its own.
    }
    if (version !== null && this.current()?.conn === current.conn) this.sendTo(ws, JSON.stringify({ t: 'state', version }));
  }

  /** `hb {generation}`: while the connection is still the machine's newest and its credential is not revoked, the lease
   * goes on in every project it opened, then `hb-ack`. */
  private async heartbeat(ws: WebSocket, current: Current, frame: Record<string, unknown>): Promise<void> {
    if (!isRl1Heartbeat(frame) || frame.generation !== current.generation) {
      return this.refuse(ws, { frame: 'hb', status: 400, error: 'bad-shape', message: `a heartbeat names this connection's generation, ${current.generation}` });
    }
    let standing: 'current' | 'replaced' | 'revoked' = 'current';
    try {
      standing = await this.named(current.org, current.name).rl1Check(this.ref, current.generation, current.client);
    } catch {
      // Unknown: the lease's own fence (the generation) still holds.
    }
    if (this.current()?.conn !== current.conn) return;
    if (standing !== 'current') {
      this.raiseFence(current.name, current.generation + 1, standing);
      this.retire(current, standing === 'revoked' ? CLOSE.revoked : CLOSE.replaced, standing);
      return;
    }
    const opened = this.kv.get<Opened>(projectsKey(current.conn));
    await Promise.allSettled((opened?.projects ?? []).map((project) => this.project(current.org, project).renew(this.context(current, project))));
    this.sendTo(ws, JSON.stringify({ t: 'hb-ack', generation: current.generation }));
  }

  /** A log-plane frame for a project, handed to it in order behind the project's earlier ones; a `hello` opens it on
   * this connection first. A frame the project could not answer ends the connection, as a DX2 POST's ends the stream. */
  private async logPlane(ws: WebSocket, current: Current, frame: UpFrame): Promise<void> {
    const project = (frame as { project?: unknown }).project;
    if (typeof project !== 'string' || !PROJECT_ID.test(project)) {
      return this.refuse(ws, { frame: frame.t, status: 400, error: 'bad-shape', message: 'the frame names no .smns project id' });
    }
    if (frame.t === 'hello') {
      const opened = this.kv.get<Opened>(projectsKey(current.conn));
      if (opened && !opened.projects.includes(project)) this.kv.put(projectsKey(current.conn), { ...opened, projects: [...opened.projects, project] });
    }
    const result = await this.inOrder(`project:${project}`, async () => {
      try {
        return await this.project(current.org, project).fromMachine(this.context(current, project), [frame]);
      } catch (error) {
        note({ event: 'run-failed', machine: current.name, generation: current.generation, project, error: described(error) });
        return { applied: 0, stale: false, failed: true, refused: [] };
      }
    });
    const now = this.current();
    if (now?.conn !== current.conn) return;
    if (result.stale) this.retire(now, CLOSE.replaced, 'replaced');
    else if (result.failed) this.retire(now, CLOSE.failed, 'undeliverable');
  }

  /** A listing or an endpoint record of this machine's, for the Registry to verify and keep, in order with the
   * connection's other Registry calls (a listing reaches it before the notify that pushes by it). */
  private async record(ws: WebSocket, current: Current, kind: 'listing' | 'endpoint', record: unknown): Promise<void> {
    const body = (record as { body?: { machine?: unknown; session?: unknown; revision?: unknown; issued?: unknown } } | null)?.body;
    const named = kind === 'listing' ? { session: typeof body?.session === 'string' ? body.session : undefined, revision: typeof body?.revision === 'number' ? body.revision : undefined } : { issued: typeof body?.issued === 'string' ? body.issued : undefined };
    if (body?.machine !== this.ref) return this.refuse(ws, { frame: kind, status: 403, error: 'not-yours', message: "a machine posts its own records: the record's machine is not this connection's ref", ...named });
    const answer = await this.inOrder('registry', async () => {
      try {
        const registry = this.registry(current.org);
        return await (kind === 'listing' ? registry.storeListing(record) : registry.storeEndpoint(record));
      } catch (error) {
        return { ok: false as const, status: 503, error: 'hub-unavailable', message: described(error) };
      }
    });
    if (!answer.ok) this.refuse(ws, { frame: kind, status: answer.status, error: answer.error, ...(answer.message ? { message: answer.message } : {}), ...named });
  }

  /** A session's state: its pending count kept for badges and told to the app sockets, and a push to its listed owners'
   * devices when it is waiting or wrote. */
  private async notify(ws: WebSocket, current: Current, frame: Record<string, unknown>): Promise<void> {
    if (!isNotify(frame)) return this.refuse(ws, { frame: 'notify', status: 400, error: 'bad-shape', message: 'notify is {session, project, kind: waiting | wrote | settled, pending}' });
    const { session, project, kind, pending } = frame as NotifyFrame;
    if (pending === 0) this.ctx.storage.sql.exec('DELETE FROM relay_pending WHERE session = ?', session);
    else this.ctx.storage.sql.exec('INSERT OR REPLACE INTO relay_pending (session, project, kind, pending) VALUES (?, ?, ?, ?)', session, project, kind, pending);
    this.broadcastPresence();
    if (kind === 'settled') return;
    await this.inOrder('registry', () =>
      this.registry(current.org)
        .notify(this.ref, { project, session, kind })
        .catch((error: unknown) => note({ event: 'notify-failed', machine: current.name, session, error: described(error) })),
    );
  }

  /** Joins a part to its set. A socket keeps its messages' order, so a set's parts arrive from index 0 up: one past 0 for
   * a set this instance does not hold was begun before an eviction, and the connection closes `4412 parts-lost` for
   * the endpoint to send the frame again on its next one. */
  private join(current: Current, part: Part, ws: WebSocket): unknown {
    if (this.parts?.conn !== current.conn) this.parts = { conn: current.conn, assembler: new PartAssembler() };
    if (typeof part.index === 'number' && part.index > 0 && typeof part.id === 'string' && !this.parts.assembler.holds(part.id)) {
      note({ event: 'parts-lost', machine: current.name, generation: current.generation, id: part.id, index: part.index });
      this.retire(current, CLOSE.partsLost, 'parts-lost');
      return undefined;
    }
    try {
      return this.parts.assembler.add(part);
    } catch (error) {
      this.refuse(ws, { frame: 'part', status: 400, error: 'bad-shape', message: described(error) });
      return undefined;
    }
  }

  private refuse(ws: WebSocket, refusal: Omit<Rl1Refusal, 't'>): void {
    this.sendTo(ws, JSON.stringify({ t: 'refusal', ...refusal } satisfies Rl1Refusal));
  }

  // ---- Channels ------------------------------------------------------------------------------------------------

  private fromApp(ws: WebSocket, attachment: AppAttachment, message: string | ArrayBuffer): void {
    // Text from an app is its ping (answered without waking the object, `setWebSocketAutoResponse`) or nothing RL1 has.
    if (typeof message === 'string') return message === 'ping' ? this.sendTo(ws, 'pong') : undefined;
    const frame = decodeChannelFrame(message);
    if (!frame) {
      this.closeSocket(ws, CLOSE.protocol, 'bad-frame');
      return this.appGone(ws, attachment);
    }
    if (frame.type === 'open') return this.open(ws, attachment, frame.channel, frame.payload);
    const held = attachment.channels.includes(frame.channel);
    if (frame.type === 'data') {
      if (!held) return this.sendTo(ws, encodeChannelFrame('close', frame.channel, CHANNEL_CLOSE['unknown-channel']));
      return void this.toEndpoint(message);
    }
    if (!held) return;
    this.drop(ws, attachment, frame.channel);
    this.toEndpoint(message);
  }

  /** An app opens a channel: the id is this object's next, the endpoint is told, and the app is answered with the id and
   * its tag; refused (no endpoint, too many channels) with a close right after. */
  private open(ws: WebSocket, attachment: AppAttachment, tag: number, payload: Uint8Array): void {
    const id = this.nextChannel();
    this.sendTo(ws, encodeChannelFrame('open', id, tagBytes(tag)));
    let refusal: ChannelCloseReason | null = null;
    if (!this.current()?.welcomed || !this.endpointSocket()) refusal = 'endpoint-gone';
    else if (attachment.channels.length >= MAX_CHANNELS_PER_SOCKET) refusal = 'too-many-channels';
    if (refusal) return this.sendTo(ws, encodeChannelFrame('close', id, CHANNEL_CLOSE[refusal]));
    attachment.channels.push(id);
    ws.serializeAttachment(attachment);
    this.map().set(id, ws);
    this.toEndpoint(encodeChannelFrame('open', id, payload));
  }

  private fromEndpointBinary(ws: WebSocket, message: ArrayBuffer): void {
    const frame = decodeChannelFrame(message);
    if (!frame) return this.refuse(ws, { frame: 'binary', status: 400, error: 'bad-shape', message: 'a binary message is a channel frame' });
    const app = this.map().get(frame.channel);
    if (frame.type === 'close') {
      if (!app) return;
      this.drop(app, app.deserializeAttachment() as AppAttachment, frame.channel);
      return this.toApp(app, message);
    }
    // Only an app opens a channel; data for none is answered closed.
    if (frame.type === 'open' || !app) return this.sendTo(ws, encodeChannelFrame('close', frame.channel, CHANNEL_CLOSE['unknown-channel']));
    this.toApp(app, message);
  }

  private toApp(app: WebSocket, message: ArrayBuffer | Uint8Array): void {
    try {
      app.send(message);
    } catch {
      // A send that throws ends the socket and every channel on it.
      this.closeSocket(app, CLOSE.failed, 'send-failed');
      this.appGone(app, app.deserializeAttachment() as AppAttachment);
    }
  }

  /** To the current endpoint; a send that throws ends the connection and every channel with it. */
  private toEndpoint(message: string | ArrayBuffer | Uint8Array): boolean {
    const socket = this.endpointSocket();
    const current = this.current();
    if (!socket || !current) return false;
    try {
      socket.send(message);
      return true;
    } catch {
      this.retire(current, CLOSE.failed, 'send-failed');
      return false;
    }
  }

  /** An app's socket ended: the endpoint is told each of its channels closed. */
  private appGone(ws: WebSocket, attachment: AppAttachment): void {
    const held = attachment.channels;
    if (held.length === 0) return;
    for (const channel of held) {
      this.map().delete(channel);
      this.toEndpoint(encodeChannelFrame('close', channel, CHANNEL_CLOSE['app-gone']));
    }
    attachment.channels = [];
    try {
      ws.serializeAttachment(attachment);
    } catch {
      // closed already
    }
  }

  private drop(ws: WebSocket, attachment: AppAttachment, channel: number): void {
    attachment.channels = attachment.channels.filter((c) => c !== channel);
    ws.serializeAttachment(attachment);
    this.map().delete(channel);
  }

  /** Every app's channels end with the endpoint's connection: each app is told `endpoint-gone`. */
  private closeAllChannels(): void {
    for (const ws of this.ctx.getWebSockets('app')) {
      const attachment = ws.deserializeAttachment() as AppAttachment;
      if (attachment.channels.length === 0) continue;
      for (const channel of attachment.channels) this.sendTo(ws, encodeChannelFrame('close', channel, CHANNEL_CLOSE['endpoint-gone']));
      attachment.channels = [];
      try {
        ws.serializeAttachment(attachment);
      } catch {
        // closed already
      }
    }
    this.channels = new Map();
  }

  /** The channel → socket map, rebuilt from the app sockets' attachments when this instance has none (an eviction). */
  private map(): Map<number, WebSocket> {
    if (!this.channels) {
      this.channels = new Map();
      for (const ws of this.ctx.getWebSockets('app')) for (const channel of (ws.deserializeAttachment() as AppAttachment).channels) this.channels.set(channel, ws);
    }
    return this.channels;
  }

  /** Channel ids rise for the object's life, so an id is never reused within a connection, nor across one. */
  private nextChannel(): number {
    const id = this.kv.get<number>('next-channel') ?? 1;
    this.kv.put('next-channel', id >= 0xffffffff ? 1 : id + 1);
    return id;
  }

  // ---- The connection's end ------------------------------------------------------------------------------------

  /** Ends the connection `current` names: its socket closes with `code`, every channel with it, and its lease in each
   * project it opened (held through the grace for the next connection, as DX2's stream's end). */
  private retire(current: Current, code: number, reason: string): void {
    for (const ws of this.ctx.getWebSockets('endpoint')) {
      if ((ws.deserializeAttachment() as EndpointAttachment).conn === current.conn) this.closeSocket(ws, code, reason);
    }
    if (this.current()?.conn === current.conn) this.kv.delete('endpoint');
    this.closeAllChannels();
    this.closeProjects(current.conn);
    if (this.parts?.conn === current.conn) this.parts = undefined;
    note({ event: 'end', machine: current.name, generation: current.generation, conn: current.conn, cause: reason });
    this.broadcastPresence();
  }

  private closeProjects(conn: number): void {
    const opened = this.kv.get<Opened>(projectsKey(conn));
    if (!opened) return;
    this.kv.delete(projectsKey(conn));
    const { leaseMs, graceMs } = this.timing();
    for (const project of opened.projects) {
      const context: MachineContext = { org: opened.org, project, machine: opened.name, client: opened.client, generation: opened.generation, leaseMs, graceMs, transport: 'rl1' };
      void this.project(opened.org, project).closed(context).catch(() => {});
    }
  }

  private endpointSocket(): WebSocket | undefined {
    const conn = this.current()?.conn;
    return this.ctx.getWebSockets('endpoint').find((ws) => (ws.deserializeAttachment() as EndpointAttachment).conn === conn);
  }

  // ---- Calls from the machine's name-addressed object (machine.ts) --------------------------------------------

  /** A project's frame for the connection of `name` at `generation`: "offline" unless it is the current one. Only the
   * log plane reaches an RL1 endpoint: a session-plane frame is refused `not-on-rl1` to its sender, the project, which
   * settles what asked for it (the machine reads its sessions in channels). */
  relaySend(name: string, generation: number, frame: DownFrame): Sent {
    const current = this.live();
    if (current?.name !== name || current.generation !== generation || !current.welcomed) return 'offline';
    if (!RL1_LOG_DOWN.has(frame.t)) return 'not-on-rl1';
    for (const line of toWire(frame)) if (!this.toEndpoint(line)) return 'offline';
    return 'written';
  }

  /** A project could not deliver to the connection of `name` at `generation`: it ends, when it is still the current one. */
  relayClose(name: string, generation: number): void {
    const current = this.current();
    if (current?.name === name && current.generation === generation) this.retire(current, CLOSE.failed, 'undeliverable');
  }

  /** A newer connection of either transport took `generation` of `name`: its connections up to it end, here now and when
   * a claim of one arrives late. */
  relaySupersede(name: string, generation: number): void {
    this.raiseFence(name, generation + 1, 'replaced');
    this.live();
  }

  /** A credential of `name` was revoked when the name had counted `generation`: its connections up to it end, here now
   * and when a claim of one arrives late. */
  relayRevoke(name: string, generation: number): void {
    this.raiseFence(name, generation + 1, 'revoked');
    this.live();
  }

  /**
   * The org state advanced (the Registry's announcement, sent until taken): the `state` notice, to a connection that
   * said hello, and every app socket of a member the head no longer holds closes `4403 removed`, such a member's upgrade
   * refused from now on, as the project and grid sockets are (O11 M3). An announcement behind one taken is passed by.
   */
  relayState(version: number, members: string[]): void {
    const held = this.kv.get<{ version: number; members: string[] }>('state-members');
    if (held && held.version >= version) return;
    this.kv.put('state-members', { version, members });
    for (const ws of this.ctx.getWebSockets('app')) {
      const attachment = ws.deserializeAttachment() as AppAttachment;
      if (members.includes(attachment.member)) continue;
      this.closeSocket(ws, CLOSE.revoked, 'removed');
      this.appGone(ws, attachment);
    }
    if (this.current()?.welcomed) this.toEndpoint(JSON.stringify({ t: 'state', version }));
  }

  // ---- Helpers -------------------------------------------------------------------------------------------------

  private presence(): RelayPresence {
    const rows = this.ctx.storage.sql.exec<{ session: string; project: string; kind: RelayPresence['pending'][string]['kind']; pending: number }>('SELECT session, project, kind, pending FROM relay_pending').toArray();
    return { t: 'presence', online: this.current()?.welcomed === true, pending: Object.fromEntries(rows.map(({ session, ...rest }) => [session, rest])) };
  }

  private broadcastPresence(): void {
    const sockets = this.ctx.getWebSockets('app');
    if (sockets.length === 0) return;
    const text = JSON.stringify(this.presence());
    for (const ws of sockets) this.sendTo(ws, text);
  }

  private sendTo(ws: WebSocket, message: string | Uint8Array): void {
    try {
      ws.send(message);
    } catch {
      // A socket closing: its close event does the rest.
    }
  }

  private closeSocket(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // closed already
    }
  }

  /** Runs `call` after the last one queued under `key`. */
  private inOrder<T>(key: string, call: () => Promise<T>): Promise<T> {
    const run = (this.order.get(key) ?? Promise.resolve()).then(call);
    const settled = run.catch(() => {});
    this.order.set(key, settled);
    void settled.then(() => {
      if (this.order.get(key) === settled) this.order.delete(key);
    });
    return run;
  }

  private context(current: Current, project: string): MachineContext {
    const { leaseMs, graceMs } = this.timing();
    return { org: current.org, project, machine: current.name, client: current.client, generation: current.generation, leaseMs, graceMs, transport: 'rl1' };
  }

  private named(org: string, name: string): DurableObjectStub<Machine> {
    return this.env.MACHINE.get(this.env.MACHINE.idFromName(`${org}:${name}`));
  }

  private project(org: string, project: string) {
    return this.env.PROJECT.get(this.env.PROJECT.idFromName(`${org}:${project}`));
  }

  private registry(org: string) {
    return this.env.REGISTRY.get(this.env.REGISTRY.idFromName(org));
  }
}
