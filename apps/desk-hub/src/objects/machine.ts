// One enrolled machine's connection (DX2): the SSE stream down, which the machine opens outbound and this object holds,
// and the machine's POSTs up, which it hands, frame by frame and in order, to the projects they name. Each stream gets
// the next connection generation; a newer stream ends the older one, and a POST belongs to the stream it names. A
// `Project` reaches the machine only through `send`, which writes to the stream or answers "offline" at once.
//
// The machine's lease in each project it opened on a stream begins with that `hello` and is renewed by the daemon's
// `hb-ack` of the stream's generation, which this object hands to each of those projects; the stream's end is handed to
// them too, and the project holds the machine online for a short grace (one heartbeat) in which its next stream takes
// the lease over, so a reconnect does not flap its presence. Neither is relied on alone: an object can restart without
// running any of this, and the projects then find the lease lapsed (Project's alarm).
//
// Cloudflare replaces an object (a deploy, a runtime update, a move, an isolate over its memory) by routing new requests
// to a successor instance while the old one's in-flight requests run on, with no limit stated, as long as they touch no
// storage (developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/ and …/platform/known-issues/).
// The stream is such a request: left alone, the old instance keeps it open and beating while the machine's POSTs reach a
// successor that holds no stream and refuse them `stale-generation`, so the machine found out only at its next
// heartbeat's ack. So the instance holding a stream asks, every `probeMs`, whether it is still the one new requests reach
// (`replaced`), and ends the stream the moment it is not: the machine reconnects to the successor at once.
//
// The org's directory (`org`) is second on every stream: the object asks the org's `Registry` for it as the stream
// opens and writes nothing else after `welcome` until it is written (a stream it cannot be had for ends, and the daemon
// reconnects for it). The `Registry` sends it again on every change
// (`directory`), and again after a call that failed, each carrying its version, so one that arrives behind a later one,
// or behind the snapshot, is passed by.
//
// A revocation is a fence: the revoked credential's client id is kept, and a request carrying it is refused here, so
// one the Worker admitted before the revocation and delivered after it opens nothing, and the name enrolled again (a
// new credential) is served.
//
// RL1 (O11 M6): a machine's RL1 sockets are held by another object of this class, addressed by the machine's ref
// (relay.ts). This object, addressed by the name, stays the machine's one generation counter and fence for both
// transports: an RL1 connection draws its generation here (`claimGeneration`), which ends a DX2 stream, and a DX2
// stream opened here ends the RL1 connection (`relaySupersede`). It is also where the machine's projects reach it
// (`send`, `close`) and where a revocation arrives (`revoke`): each goes on to the ref's object while an RL1 connection
// holds the newest generation (`kv` `rl1`). A supersession or a revocation is a fence the ref's object must hold, so
// it is kept here (`kv` `rl1-owed`) and sent again, by the alarm, until that object takes it. The org state's notices
// reach the ref's object from the Registry.
import { DurableObject } from 'cloudflare:workers';
import { readLimited } from '../drain';
import { CLIENT_HEADER, heartbeatMs, MACHINE_HEADER, ORG_HEADER, type Env } from '../env';
import { GENERATION_HEADER, LEASE_PERIODS, POST_LIMIT, type DownFrame, type OrgFrame, type PostAnswer, type RefusedFrame, type UpFrame } from '../protocol/machine';
import { FRAME_LIMIT, PartAssembler, PartsBudgetError, toWire, type Part } from '../protocol/parts';
import { SESSION_KINDS } from '../protocol/session';
import { described, PROJECT_ID, type MachineContext } from './project';
import { Relay, relayObjectName } from './relay';
import { lacksMethod, RETRY_ATTEMPTS, RETRY_BASE_MS, RETRY_CAP_MS, retryDelay } from './retry';

/** Why a stream ended, as its log line says. */
type EndCause = 'newer-stream' | 'newer-socket' | 'client-closed' | 'write-failed' | 'write-stalled' | 'undeliverable' | 'directory' | 'revoked' | 'replaced';

export type Stream = {
  org: string;
  machine: string;
  /** The credential the stream was opened with (the Access client id): which enrollment of the name it is. */
  client: string;
  generation: number;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  /** Errors the stream, both its sides: how it ends (`end`). */
  fail: (reason: Error) => void;
  heartbeat: ReturnType<typeof setInterval>;
  /** Asks, every `probeMs`, whether this instance still receives the object's new requests (`replaced`). */
  probe: ReturnType<typeof setInterval>;
  probing: boolean;
  /** When it opened (ms), for its log line's lifetime. */
  opened: number;
  /** Ended once: its log line is written once, whichever way ends it first. */
  ended: boolean;
  /** Part sets of frames posted on this stream, which may span POSTs. */
  parts: PartAssembler;
  /** The projects this stream opened with `hello`: those its lease is renewed and ended in. */
  projects: Set<string>;
  /** Settles once the org's directory is written after `welcome` (or could not be had): every other write waits on it. */
  ready: Promise<void>;
  /** The version of the directory written on this stream; 0 before the first. */
  directoryVersion: number;
  /** How long the write at the head may wait for the stream to take it (`WRITE_TIMEOUT_MS`, a suite's shorter one). */
  writeTimeoutMs: number;
  /** The last write queued: each write reaches the stream once the one before it settled (`write`). */
  writing: Promise<boolean>;
};

/** How often the stream's heartbeat goes, how long a renewal keeps the machine online, how long a closed stream's lease
 * holds the machine online for its next stream to take over, how often the instance holding a stream asks whether it
 * was replaced, and how long a write may wait for the stream to take it. */
export type Timing = { heartbeatMs: number; leaseMs: number; graceMs: number; probeMs: number; writeTimeoutMs: number };

/** How often a stream's instance asks whether new requests still reach it: a replaced one ends its stream within this. */
export const PROBE_MS = 1000;
/**
 * How long the write at the head of a stream may wait for the stream to take it before the stream ends `write-stalled`.
 * Writes reach the stream one at a time, so the bound is one frame's wait on the client reading, never its wait behind
 * the frames queued before it (many projects' backlog pages at once): a frame of 1 MiB taking this long is 100 KB/s, a
 * dead link rather than a slow one. Without a bound, a client that stopped reading held every write, every send chain,
 * and the POSTs waiting on them, until the machine's own minute ran out.
 */
export const WRITE_TIMEOUT_MS = 10_000;
/** How long a probe waits for its answer before it counts as no answer. */
const PROBE_WAIT_MS = 5000;

const encoder = new TextEncoder();
const utf8Length = (text: string) => encoder.encode(text).length;
const json = (status: number, body: unknown) => Response.json(body, { status });

/** One SSE event per wire frame: `event: <t>` (`part` for a part) and the frame's JSON, which holds no line break. */
function sse(frame: DownFrame): Uint8Array {
  const lines = toWire(frame);
  const event = lines.length === 1 ? frame.t : 'part';
  return encoder.encode(lines.map((line) => `event: ${event}\ndata: ${line}\n\n`).join(''));
}

const revokedKey = (clientId: string) => `revoked:${clientId}`;

/** The RL1 connection that holds the machine's newest generation: its ref's object, its name as this object knows it,
 * and the credential it opened with. */
type Rl1Claim = { org: string; name: string; ref: string; generation: number; client: string };
const RL1_KEY = 'rl1';
/** Each credential's newest RL1 claim, by its client id: a revocation fences the revoked credential's connections in
 * their ref's object even while another credential holds the newest claim, which it leaves alone. */
const RL1_CLAIMS_KEY = 'rl1-claims';

/** What a write to the machine became: a session-plane frame for an RL1 connection is `not-on-rl1` (relay.ts). */
export type Sent = 'written' | 'offline' | 'not-on-rl1';

/** A fence owed to a ref's object, sent until it is taken: `due` is the next try, a minute ahead while one is in flight. */
type Owed = { op: 'supersede' | 'revoke'; org: string; ref: string; name: string; generation: number; attempts: number; due: number };
const OWED_KEY = 'rl1-owed';
const sameOwed = (a: Owed, b: Owed) => a.op === b.op && a.ref === b.ref && a.name === b.name && a.generation === b.generation;

/** One log line of a stream's life (`wrangler tail`, or the Worker's logs once observability is on): how often the hub
 * loses a machine's stream and why, the hub's half of the reconnect count each machine's daemon.log keeps. */
function note(line: Record<string, unknown>): void {
  console.log(JSON.stringify({ desk: 'machine-stream', ...line }));
}

/** A POST's frames for one project, consecutive in the POST, handed to it in one call; each frame weighs the posted lines
 * it took (a joined frame its parts), and sits at its index among the POST's frames (a joined frame its last part's). */
type Run = { project: string; frames: UpFrame[]; weights: number[]; indices: number[] };
/** What a project made of its run; `refused` indexes the run's frames. */
type Applied = { applied: number; stale: boolean; failed: boolean; refused: RefusedFrame[] };

/** The project a frame up is addressed to, or null for one that names none (`hb-ack`). */
function projectOf(frame: UpFrame): unknown {
  if (frame.t === 'session') return (frame.message as { project?: unknown } | undefined)?.project;
  return 'project' in frame ? frame.project : null;
}

export class Machine extends DurableObject<Env> {
  private stream: Stream | undefined;
  /** This instance's id: a successor Cloudflare routes new requests to is another instance, with another id. */
  protected readonly life = crypto.randomUUID();
  private relayInstance: Relay | undefined;

  /** The RL1 sockets, in the object addressed by the machine's ref; made on first use, so a DX2 machine's object never
   * makes it. */
  private get relay(): Relay {
    return (this.relayInstance ??= new Relay(this.ctx, this.env, () => this.timing()));
  }

  /** Which instance of the object answers: a stream's probe asks this through the object's own id. */
  instance(): string {
    return this.life;
  }

  async fetch(request: Request): Promise<Response> {
    if (this.ctx.storage.kv.get(revokedKey(request.headers.get(CLIENT_HEADER) ?? ''))) {
      return json(403, { error: 'not-enrolled', message: 'this credential was revoked' });
    }
    const url = new URL(request.url);
    if (url.pathname === '/stream' && request.method === 'GET') return this.open(request);
    if (url.pathname === '/frames' && request.method === 'POST') return this.frames(request);
    if (url.pathname === '/socket' && request.method === 'GET') return this.relay.endpoint(request);
    if (url.pathname === '/app' && request.method === 'GET') return this.relay.app(request);
    return new Response('not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.relay.message(ws, message);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.relay.closed(ws, code, reason);
  }

  /** A failed socket has no close to answer. */
  async webSocketError(ws: WebSocket): Promise<void> {
    this.relay.closed(ws);
  }

  /** Writes a frame to the machine's current stream, or to its RL1 connection's when that holds the newest generation;
   * "offline" when neither does, or when `generation` names an older one (a project's frame for a stream or connection
   * the machine has since replaced). */
  async send(frame: DownFrame, generation?: number): Promise<Sent> {
    const stream = this.stream;
    if (stream && (generation === undefined || generation === stream.generation)) return (await this.write(stream, frame)) ? 'written' : 'offline';
    const rl1 = this.rl1();
    if (!stream && rl1 && (generation === undefined || generation === rl1.generation)) return this.relayOf(rl1).relaySend(rl1.name, rl1.generation, frame);
    return 'offline';
  }

  // ---- RL1: the generation and the fence for the ref's object (relay.ts) ----------------------------------------

  /** An RL1 connection of the machine opens: the next generation, which ends the DX2 stream and any older RL1
   * connection; refused for a revoked credential. */
  async claimGeneration(org: string, name: string, ref: string, client: string): Promise<{ generation: number } | { refused: 'revoked' }> {
    if (this.ctx.storage.kv.get(revokedKey(client))) return { refused: 'revoked' };
    const generation = (this.ctx.storage.kv.get<number>('generation') ?? 0) + 1;
    this.ctx.storage.kv.put('generation', generation);
    const before = this.rl1();
    const claim: Rl1Claim = { org, name, ref, generation, client };
    this.ctx.storage.kv.put(RL1_KEY, claim);
    this.ctx.storage.kv.put(RL1_CLAIMS_KEY, { ...this.claims(), [client]: claim });
    this.end(this.stream, 'newer-socket');
    // A connection under another ref (the machine enrolled again with a new one) ends; the same ref's object ends its
    // own older connection as it installs the new one.
    if (before && before.ref !== ref) void this.owe('supersede', before, generation);
    note({ event: 'claim', ref, generation });
    return { generation };
  }

  /** Whether the RL1 connection of `generation` still holds the machine's newest generation (`current`), was replaced
   * by a newer connection of either kind, or carries a revoked credential: its object asks at each heartbeat, so a
   * replacement or a revocation it was not told of ends it within one. */
  rl1Check(ref: string, generation: number, client: string): 'current' | 'replaced' | 'revoked' {
    if (this.ctx.storage.kv.get(revokedKey(client))) return 'revoked';
    const rl1 = this.rl1();
    return rl1?.ref === ref && rl1.generation === generation ? 'current' : 'replaced';
  }

  private rl1(): Rl1Claim | undefined {
    return this.ctx.storage.kv.get<Rl1Claim>(RL1_KEY);
  }

  private claims(): Record<string, Rl1Claim> {
    return this.ctx.storage.kv.get<Record<string, Rl1Claim>>(RL1_CLAIMS_KEY) ?? {};
  }

  private relayOf(claim: { org: string; ref: string }): DurableObjectStub<Machine> {
    return this.env.MACHINE.get(this.env.MACHINE.idFromName(relayObjectName(claim.org, claim.ref)));
  }

  /**
   * Fences the RL1 connections of `claim`'s name up to `generation` in its ref's object: superseded (a newer generation
   * was taken) or revoked. Kept until that object takes it, and tried now; a try that fails is tried again by the
   * alarm, its wait growing as retry.ts's does, up to a minute, for as long as it takes: a fence the ref's object never
   * holds leaves a connection carrying channels, or a claim granted before it installing after it.
   */
  private async owe(op: Owed['op'], claim: Rl1Claim, generation: number): Promise<void> {
    const owed: Owed = { op, org: claim.org, ref: claim.ref, name: claim.name, generation, attempts: 0, due: Date.now() + RETRY_CAP_MS };
    this.ctx.storage.kv.put(OWED_KEY, [...this.owed().filter((o) => !sameOwed(o, owed)), owed]);
    await this.scheduleOwed();
    await this.deliver(owed);
  }

  private owed(): Owed[] {
    return this.ctx.storage.kv.get<Owed[]>(OWED_KEY) ?? [];
  }

  private async deliver(owed: Owed): Promise<void> {
    const method = owed.op === 'revoke' ? 'relayRevoke' : 'relaySupersede';
    let failure: { error: unknown } | null = null;
    try {
      await this.relayOf(owed)[method](owed.name, owed.generation);
    } catch (error) {
      // A ref's object on the code before the fence holds no RL1 socket the fence could reach.
      if (!lacksMethod(error, method)) failure = { error };
    }
    const rest = this.owed().filter((o) => !sameOwed(o, owed));
    if (failure === null) {
      this.ctx.storage.kv.put(OWED_KEY, rest);
      return;
    }
    const attempts = (this.owed().find((o) => sameOwed(o, owed))?.attempts ?? owed.attempts) + 1;
    const wait = retryDelay(Math.min(attempts, RETRY_ATTEMPTS), RETRY_BASE_MS, failure.error);
    note({ event: 'fence-failed', op: owed.op, ref: owed.ref, generation: owed.generation, attempt: attempts, error: described(failure.error), retry_ms: Math.round(wait) });
    this.ctx.storage.kv.put(OWED_KEY, [...rest, { ...owed, attempts, due: Date.now() + wait }]);
    await this.scheduleOwed();
  }

  /** The alarm at the soonest owed fence's time, or none. */
  private async scheduleOwed(): Promise<void> {
    const owed = this.owed();
    if (owed.length === 0) return;
    const at = Math.min(...owed.map((o) => o.due));
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > at || current <= Date.now()) await this.ctx.storage.setAlarm(at);
  }

  /** Sends again every owed fence whose time has come; one in flight waits a minute before it is sent again, unless its
   * answer says otherwise first. */
  async alarm(): Promise<void> {
    const now = Date.now();
    const due = this.owed().filter((o) => o.due <= now);
    this.ctx.storage.kv.put(OWED_KEY, this.owed().map((o) => (o.due <= now ? { ...o, due: now + RETRY_CAP_MS } : o)));
    await this.scheduleOwed();
    await Promise.all(due.map((o) => this.deliver({ ...o, due: now + RETRY_CAP_MS })));
  }

  // ---- RL1: the ref's object's own calls, from the object above, and from the Registry ---------------------------

  relaySend(name: string, generation: number, frame: DownFrame): Sent {
    return this.relay.relaySend(name, generation, frame);
  }

  relayClose(name: string, generation: number): void {
    this.relay.relayClose(name, generation);
  }

  relaySupersede(name: string, generation: number): void {
    this.relay.relaySupersede(name, generation);
  }

  relayRevoke(name: string, generation: number): void {
    this.relay.relayRevoke(name, generation);
  }

  relayState(version: number, members: string[]): void {
    this.relay.relayState(version, members);
  }

  /** Writes the org's directory to the machine's current stream, unless it wrote that version or a later one already;
   * "offline" when it has no stream. */
  async directory(frame: OrgFrame, version: number): Promise<'written' | 'offline'> {
    const stream = this.stream;
    if (!stream) return 'offline';
    await stream.ready;
    if (this.stream !== stream) return 'offline';
    if (version <= stream.directoryVersion) return 'written';
    stream.directoryVersion = version;
    return (await this.write(stream, frame, false)) ? 'written' : 'offline';
  }

  /** Ends the stream of this generation, or the RL1 connection, if it is still the current one (a project could not
   * deliver to it). */
  async close(generation: number): Promise<void> {
    if (this.stream?.generation === generation) return this.end(this.stream, 'undeliverable');
    const rl1 = this.rl1();
    if (rl1?.generation === generation) await this.relayOf(rl1).relayClose(rl1.name, generation);
  }

  /** The machine was revoked: its stream ends now, and a request with the revoked credential is refused from here on,
   * one the Worker admitted before the revocation included. Answers the newest stream generation it had opened, which
   * its projects stop counting it through. */
  async revoke(clientId: string | null): Promise<number> {
    if (clientId) this.ctx.storage.kv.put(revokedKey(clientId), true);
    this.end(this.stream, 'revoked');
    const rl1 = this.rl1();
    if (rl1 && (clientId === null || rl1.client === clientId)) this.ctx.storage.kv.delete(RL1_KEY);
    // The revoked credential's RL1 connections end, up to its newest claim, whether or not another credential's claim
    // followed it, and a claim of it still in flight is refused when it arrives; until the ref's object takes the fence,
    // its heartbeats find the credential revoked here too (`rl1Check`). A newer credential's claim stays above it.
    const claims = this.claims();
    const revoked = clientId === null ? Object.values(claims) : claims[clientId] ? [claims[clientId]] : [];
    if (revoked.length > 0) {
      this.ctx.storage.kv.put(RL1_CLAIMS_KEY, Object.fromEntries(Object.entries(claims).filter(([client]) => clientId !== null && client !== clientId)));
      await Promise.all(revoked.map((claim) => this.owe('revoke', claim, claim.generation)));
    }
    return this.ctx.storage.kv.get<number>('generation') ?? 0;
  }

  /** The configured heartbeat (DX2's 15 s deployed; shorter under the local command), a lease of LEASE_PERIODS of it, a
   * closed stream's grace of one heartbeat, and PROBE_MS; the suites' Worker sets them per machine
   * (test/support/worker-under-test.ts). */
  protected timing(): Timing {
    const heartbeat = heartbeatMs(this.env);
    return { heartbeatMs: heartbeat, leaseMs: LEASE_PERIODS * heartbeat, graceMs: heartbeat, probeMs: PROBE_MS, writeTimeoutMs: WRITE_TIMEOUT_MS };
  }

  /**
   * Whether new requests to this object reach another instance than this one. A replaced instance's storage access
   * throws ("Uniqueness is enforced upon starting a new event … and upon accessing storage"), and the object's own id
   * routes to whichever instance is current, so its answer names a successor. A probe that fails (the call itself, an
   * overload) says nothing, and the next one asks again.
   */
  protected async replaced(): Promise<boolean> {
    try {
      this.ctx.storage.kv.get('generation');
    } catch {
      return true;
    }
    const current = await this.current();
    return current !== null && current !== this.life;
  }

  /** The instance new requests to this object reach, by its id; null when the call fails or takes longer than a few
   * probes' time (a call that never settles must not keep every later probe from asking). */
  protected async current(): Promise<string | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), PROBE_WAIT_MS)));
    try {
      return await Promise.race([this.env.MACHINE.get(this.ctx.id).instance(), late]);
    } catch {
      return null;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private open(request: Request): Response {
    const org = request.headers.get(ORG_HEADER) ?? '';
    const machine = request.headers.get(MACHINE_HEADER) ?? '';
    const generation = (this.ctx.storage.kv.get<number>('generation') ?? 0) + 1;
    this.ctx.storage.kv.put('generation', generation);
    this.end(this.stream, 'newer-stream');
    // The DX2 stream takes the generation from an RL1 connection: that one ends.
    const rl1 = this.rl1();
    if (rl1) {
      this.ctx.storage.kv.delete(RL1_KEY);
      void this.owe('supersede', rl1, generation);
    }

    const { heartbeatMs, probeMs, writeTimeoutMs } = this.timing();
    let fail!: (reason: Error) => void;
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({ start: (controller) => void (fail = (reason) => controller.error(reason)) });
    const stream: Stream = {
      org,
      machine,
      client: request.headers.get(CLIENT_HEADER) ?? '',
      generation,
      writer: writable.getWriter(),
      fail,
      heartbeat: setInterval(() => void this.write(stream, { t: 'hb', at: new Date().toISOString() }), heartbeatMs),
      probe: setInterval(() => void this.check(stream), probeMs),
      probing: false,
      opened: Date.now(),
      ended: false,
      parts: new PartAssembler(),
      projects: new Set(),
      ready: Promise.resolve(),
      directoryVersion: 0,
      writeTimeoutMs,
      writing: Promise.resolve(true),
    };
    this.stream = stream;
    note({ event: 'open', machine, generation, instance: this.life });
    // The client's close reaches the object as the request's abort (compatibility flag enable_request_signal).
    request.signal.addEventListener('abort', () => this.end(stream, 'client-closed'));
    // `kinds`: every session kind the project objects list, so a daemon sends a kind added since its hub's deploy (the
    // desk control surface's `read`, `op`, `catalog`) only to a hub that relays it.
    void this.write(stream, { t: 'welcome', org, machine, generation, heartbeat_ms: heartbeatMs, kinds: [...SESSION_KINDS] }, false);
    // A stream the Registry could not give its directory ends before anything else is written on it: the daemon
    // reconnects, and its next stream asks again. Nothing waits for a change that may never come.
    stream.ready = this.env.REGISTRY.get(this.env.REGISTRY.idFromName(org))
      .orgFrame()
      .then(async ({ frame, version }) => {
        if (version < stream.directoryVersion) return;
        stream.directoryVersion = version;
        await this.write(stream, frame, false);
      })
      .catch(() => this.end(stream, 'directory'));
    return new Response(readable, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } });
  }

  /**
   * A POST of NDJSON frames. Refused whole, with nothing applied, when it is not for the current stream, too large, or
   * holds a line that is not a frame; otherwise each project's frames go to it in order, every project's at once, and
   * the answer comes once every reply those frames owe their machine (a hello's `have`, an upload's `resend` and
   * `refused`) is written down the stream — not the backlog, which streams behind its `have`, and not what else is
   * queued for the stream. Consecutive frames for one project reach it in one call. The stream is checked again once
   * the body is read and before each call, and the project stops a call before a frame once it knows of a newer
   * stream: a POST that a newer stream outlived stops there (`stale-generation`, with how many frames it applied), so it
   * changes nothing the newer stream set up. A reply that could not be written — the call or the send threw, the stream
   * went, or a write outlasted `WRITE_TIMEOUT_MS` — ends the stream and answers `503 delivery-failed`, with the frames
   * applied before the run's frame that owed it: reconnect, and the handshake heals it. Every answer that counts the
   * frames applied names, among them, those the hub refused whole (`refused`, MAWS #88: a frame for a project the
   * stream has not opened, one the hub cannot read), each by its index in the POST, so the machine learns a refusal in
   * the same exchange and not only later on its stream, where it is still sent.
   */
  private async frames(request: Request): Promise<Response> {
    const stream = this.stream;
    const named = request.headers.get(GENERATION_HEADER);
    if (!stream || named !== String(stream.generation)) {
      // A POST of the generation this object opened last, with no stream here: the stream runs on the instance this
      // one replaced, whose probe ends it within PROBE_MS. The answer says so, which the machine's log keeps.
      const replaced = !stream && named === String(this.ctx.storage.kv.get<number>('generation') ?? 0);
      note({ event: 'stale-post', machine: request.headers.get(MACHINE_HEADER) ?? '', generation: Number(named), current: stream?.generation ?? null, replaced });
      return json(409, {
        error: 'stale-generation',
        message: replaced
          ? 'the hub replaced this machine\'s object (a deploy, a runtime update, a move) under its stream; open the stream again'
          : 'the POST names no current stream of this machine; open the stream and use its generation',
        ...(replaced ? { replaced: true } : {}),
      });
    }
    if (Number(request.headers.get('Content-Length') ?? 0) > POST_LIMIT) return json(413, { error: 'too-large' });
    // Read only to the limit: a body past it is refused as it passes, never read whole first.
    const body = await readLimited(request.body, POST_LIMIT);
    if (!body) return json(413, { error: 'too-large' });
    const text = new TextDecoder().decode(body);
    // The frames refused whole among those counted applied, in POST order: every answer that counts frames names them.
    const refused: RefusedFrame[] = [];
    const stale = (applied: number) =>
      json(409, { error: 'stale-generation', message: 'a newer stream of this machine opened while this POST was read; send it again on that one', frames: applied, refused });
    if (this.stream !== stream) return stale(0);

    const frames: UpFrame[] = [];
    const lines = text.split('\n');
    for (let line = 0; line < lines.length; line++) {
      if (lines[line].trim() === '') continue;
      if (utf8Length(lines[line]) > FRAME_LIMIT) return json(413, { error: 'too-large', line });
      let frame: unknown;
      try {
        frame = JSON.parse(lines[line]);
      } catch {
        frame = undefined;
      }
      if (typeof frame !== 'object' || frame === null || Array.isArray(frame) || typeof (frame as { t?: unknown }).t !== 'string') {
        return json(400, { error: 'bad-shape', line });
      }
      frames.push(frame as UpFrame);
    }

    // Consecutive frames for one project go to it in one call (a run): one Durable Object round trip per frame was the
    // session plane's limit (M5's measured run). Each frame weighs the posted lines it took (a joined frame its parts),
    // so `applied` counts posted frames as before. The parts are joined and the runs formed first; a part that cannot
    // be joined ends the POST there, after what came before it.
    const items: Array<{ run: Run } | { frame: UpFrame; weight: number; index: number }> = [];
    let carry = 0;
    let refusal: Response | null = null;
    for (const [index, posted] of frames.entries()) {
      let frame: UpFrame | undefined = posted;
      if (posted.t === 'part') {
        try {
          frame = stream.parts.add(posted as Part) as UpFrame | undefined;
        } catch (error) {
          refusal = error instanceof PartsBudgetError ? json(413, { error: 'too-large', message: error.message }) : json(400, { error: 'bad-shape', message: 'a malformed part' });
          break;
        }
        if (frame === undefined) {
          carry++;
          continue;
        }
      }
      const weight = carry + 1;
      carry = 0;
      const project = projectOf(frame);
      if (typeof project === 'string' && PROJECT_ID.test(project)) {
        if (frame.t === 'hello') stream.projects.add(project);
        const last = items.at(-1);
        if (last && 'run' in last && last.run.project === project) {
          last.run.frames.push(frame);
          last.run.weights.push(weight);
          last.run.indices.push(index);
        } else {
          items.push({ run: { project, frames: [frame], weights: [weight], indices: [index] } });
        }
        continue;
      }
      items.push({ frame, weight, index });
    }

    if (this.stream !== stream) return stale(0);
    const results = this.dispatch(stream, items.flatMap((item) => ('run' in item ? [item.run] : [])));
    let applied = 0;
    const failed = () => {
      this.end(stream, 'undeliverable');
      return json(503, { error: 'delivery-failed', message: 'a reply to this POST could not be written to the stream; reconnect and send it again', frames: applied, refused });
    };
    // The answer reads the runs in the POST's order: a run that failed, or that a newer stream outlived, answers for the
    // POST with what came before it, though other projects' runs after it went on.
    for (const item of items) {
      if ('run' in item) {
        const result = await results.get(item.run)!;
        applied += item.run.weights.slice(0, result.applied).reduce((sum, weight) => sum + weight, 0);
        for (const { index, reason } of result.refused) refused.push({ index: item.run.indices[index], reason });
        if (result.failed) return failed();
        if (result.stale) return stale(applied);
        continue;
      }
      if (this.stream !== stream) return stale(applied);
      const { frame, weight, index } = item;
      const project = projectOf(frame);
      if (project === null) {
        // `hb-ack`: renews the lease in every project this stream opened, when it names this stream's generation.
        if (frame.t === 'hb-ack' && frame.generation === stream.generation) await this.renew(stream);
      } else {
        await this.send({ t: 'refused', project: String(project), refusal: { reason: 'bad-shape', message: 'the frame names no .smns project id' } }, stream.generation);
        refused.push({ index, reason: 'bad-shape' });
      }
      applied += weight;
    }
    return refusal ?? json(200, { ok: true, frames: applied + carry, refused } satisfies PostAnswer);
  }

  /**
   * Hands each run to its project: every project's first run at once, each project's later runs behind its earlier ones,
   * and none behind a run of its project that did not apply whole. So every project's call of a POST leaves from the
   * POST itself, never from behind the calls the projects before it made back into this object (a hello's `have`). A
   * POST carrying more than about six projects' hellos, sent one project after another, was answered 503 on the deployed
   * hub every time (2026-10-20, the archive confirmation's), and never on the local runtime; the Workers call-depth limit
   * is the likeliest cause and is unconfirmed, and `run-failed` lines name what such a failure throws.
   */
  private dispatch(stream: Stream, runs: Run[]): Map<Run, Promise<Applied>> {
    const results = new Map<Run, Promise<Applied>>();
    const last = new Map<string, Promise<Applied>>();
    runs.forEach((run, index) => {
      const before = last.get(run.project);
      const result = before
        ? before.then((earlier) => (earlier.failed || earlier.stale ? { applied: 0, stale: earlier.stale, failed: earlier.failed, refused: [] } : this.apply(stream, run, index, runs.length)))
        : this.apply(stream, run, index, runs.length);
      results.set(run, result);
      last.set(run.project, result);
    });
    return results;
  }

  /** One run to its project; a call that fails, or a run that fails, is logged with where it stood in the POST. */
  private async apply(stream: Stream, run: Run, index: number, runs: number): Promise<Applied> {
    if (this.stream !== stream) return { applied: 0, stale: true, failed: false, refused: [] };
    const where = { machine: stream.machine, generation: stream.generation, project: run.project, run: index + 1, runs, frames: run.frames.length };
    try {
      const result = await this.project(stream, run.project).fromMachine(this.context(stream, run.project), run.frames);
      if (result.failed) note({ event: 'run-failed', ...where, applied: result.applied });
      return result;
    } catch (error) {
      // The call itself failed: what the project applied of this run is unknown, so none of it counts.
      note({ event: 'run-failed', ...where, applied: null, error: described(error) });
      return { applied: 0, stale: false, failed: true, refused: [] };
    }
  }

  /** Writes a frame to the stream, after the directory unless `ordered` is false (the frames that open it), and behind
   * every write queued on the stream before it, whichever project or lane queued it. */
  private async write(stream: Stream, frame: DownFrame, ordered = true): Promise<boolean> {
    if (ordered) await stream.ready;
    const turn = stream.writing.then(() => this.take(stream, frame));
    stream.writing = turn;
    return turn;
  }

  /** The write at the head of the stream. Its bound starts here, not when it was queued: a write the stream does not
   * take within the bound ends the stream `write-stalled`, which fails every write queued behind it, while a reader
   * that takes each frame in time keeps the stream however long the queue behind the head is. */
  private async take(stream: Stream, frame: DownFrame): Promise<boolean> {
    if (stream.ended) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stalled = new Promise<'stalled'>((resolve) => (timer = setTimeout(() => resolve('stalled'), stream.writeTimeoutMs)));
    const writing = this.put(stream, frame);
    // A write that fails after the bound ended the stream is answered already.
    writing.catch(() => {});
    try {
      if ((await Promise.race([writing, stalled])) !== 'stalled') return true;
      this.end(stream, 'write-stalled');
      return false;
    } catch {
      this.end(stream, 'write-failed');
      return false;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** The frame onto the stream: settles once the stream took it (the suites' Worker stalls one here). */
  protected put(stream: Stream, frame: DownFrame): Promise<void> {
    return stream.writer.write(sse(frame));
  }

  /** The stream's probe: ends it once this instance no longer receives the object's new requests. */
  private async check(stream: Stream): Promise<void> {
    if (stream.probing || this.stream !== stream) return;
    stream.probing = true;
    try {
      if ((await this.replaced()) && this.stream === stream) this.end(stream, 'replaced');
    } finally {
      stream.probing = false;
    }
  }

  private context(stream: Stream, project: string): MachineContext {
    const { leaseMs, graceMs } = this.timing();
    return { org: stream.org, project, machine: stream.machine, client: stream.client, generation: stream.generation, leaseMs, graceMs };
  }

  private project(stream: Stream, project: string) {
    return this.env.PROJECT.get(this.env.PROJECT.idFromName(`${stream.org}:${project}`));
  }

  /** The daemon answered a heartbeat of this stream: its lease goes on in every project the stream opened. */
  private async renew(stream: Stream): Promise<void> {
    await Promise.allSettled([...stream.projects].map((project) => this.project(stream, project).renew(this.context(stream, project))));
  }

  private end(stream: Stream | undefined, cause: EndCause): void {
    if (!stream) return;
    clearInterval(stream.heartbeat);
    clearInterval(stream.probe);
    if (this.stream === stream) this.stream = undefined;
    if (!stream.ended) note({ event: 'end', machine: stream.machine, generation: stream.generation, cause, ms: Date.now() - stream.opened });
    stream.ended = true;
    // Errored, not closed: a close (or an abort) waits behind a write a client that stopped reading never takes, and the
    // writes queued after it are a project's send chain and the POSTs waiting on it. Erroring the stream fails them all
    // at once, so they answer offline.
    stream.fail(new Error('the stream ended'));
    // The stream's end closes its lease in every project it opened (held through the grace for the next stream); a
    // project that misses this finds the lease lapsed instead.
    for (const project of stream.projects) void this.project(stream, project).closed(this.context(stream, project)).catch(() => {});
    stream.projects.clear();
  }
}
