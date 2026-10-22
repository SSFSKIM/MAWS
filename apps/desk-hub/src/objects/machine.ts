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
import { DurableObject } from 'cloudflare:workers';
import { readLimited } from '../drain';
import { CLIENT_HEADER, heartbeatMs, MACHINE_HEADER, ORG_HEADER, type Env } from '../env';
import { GENERATION_HEADER, LEASE_PERIODS, POST_LIMIT, type DownFrame, type OrgFrame, type PostAnswer, type RefusedFrame, type UpFrame } from '../protocol/machine';
import { FRAME_LIMIT, PartAssembler, PartsBudgetError, toWire, type Part } from '../protocol/parts';
import { SESSION_KINDS } from '../protocol/session';
import { described, PROJECT_ID, type MachineContext } from './project';

/** Why a stream ended, as its log line says. */
type EndCause = 'newer-stream' | 'client-closed' | 'write-failed' | 'write-stalled' | 'undeliverable' | 'directory' | 'revoked' | 'replaced';

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
    return new Response('not found', { status: 404 });
  }

  /** Writes a frame to the machine's current stream; "offline" when it has none, or when `generation` names an older
   * one (a project's frame for a stream the machine has since replaced). */
  async send(frame: DownFrame, generation?: number): Promise<'written' | 'offline'> {
    const stream = this.stream;
    if (!stream || (generation !== undefined && generation !== stream.generation)) return 'offline';
    return (await this.write(stream, frame)) ? 'written' : 'offline';
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

  /** Ends the stream of this generation, if it is still the current one (a project could not deliver to it). */
  close(generation: number): void {
    if (this.stream?.generation === generation) this.end(this.stream, 'undeliverable');
  }

  /** The machine was revoked: its stream ends now, and a request with the revoked credential is refused from here on,
   * one the Worker admitted before the revocation included. Answers the newest stream generation it had opened, which
   * its projects stop counting it through. */
  async revoke(clientId: string | null): Promise<number> {
    if (clientId) this.ctx.storage.kv.put(revokedKey(clientId), true);
    this.end(this.stream, 'revoked');
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
