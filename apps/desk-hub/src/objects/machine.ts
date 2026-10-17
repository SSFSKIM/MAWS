// One enrolled machine's connection (DX2): the SSE stream down, which the machine opens outbound and this object holds,
// and the machine's POSTs up, which it hands, frame by frame and in order, to the projects they name. Each stream gets
// the next connection generation; a newer stream ends the older one, and a POST belongs to the stream it names. A
// `Project` reaches the machine only through `send`, which writes to the stream or answers "offline" at once.
//
// The machine's lease in each project it opened on a stream begins with that `hello` and is renewed by the daemon's
// `hb-ack` of the stream's generation, which this object hands to each of those projects; the stream's end is handed to
// them too, so the lease ends at once. Neither is relied on alone: an object can restart without running any of this,
// and the projects then find the lease lapsed (Project's alarm).
//
// A revocation is a fence: the revoked credential's client id is kept, and a request carrying it is refused here, so
// one the Worker admitted before the revocation and delivered after it opens nothing, and the name enrolled again (a
// new credential) is served.
import { DurableObject } from 'cloudflare:workers';
import { readLimited } from '../drain';
import { CLIENT_HEADER, heartbeatMs, MACHINE_HEADER, ORG_HEADER, type Env } from '../env';
import { GENERATION_HEADER, LEASE_PERIODS, POST_LIMIT, type DownFrame, type UpFrame } from '../protocol/machine';
import { FRAME_LIMIT, PartAssembler, PartsBudgetError, toWire, type Part } from '../protocol/parts';
import { PROJECT_ID, type MachineContext } from './project';

type Stream = {
  org: string;
  machine: string;
  generation: number;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  /** Errors the stream, both its sides: how it ends (`end`). */
  fail: (reason: Error) => void;
  heartbeat: ReturnType<typeof setInterval>;
  /** Part sets of frames posted on this stream, which may span POSTs. */
  parts: PartAssembler;
  /** The projects this stream opened with `hello`: those its lease is renewed and ended in. */
  projects: Set<string>;
};

/** How often the stream's heartbeat goes and how long a renewal keeps the machine online. */
export type Timing = { heartbeatMs: number; leaseMs: number };

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

/** The project a frame up is addressed to, or null for one that names none (`hb-ack`). */
function projectOf(frame: UpFrame): unknown {
  if (frame.t === 'session') return (frame.message as { project?: unknown } | undefined)?.project;
  return 'project' in frame ? frame.project : null;
}

export class Machine extends DurableObject<Env> {
  private stream: Stream | undefined;

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

  /** Ends the stream of this generation, if it is still the current one (a project could not deliver to it). */
  close(generation: number): void {
    if (this.stream?.generation === generation) this.end(this.stream);
  }

  /** The machine was revoked: its stream ends now, and a request with the revoked credential is refused from here on,
   * one the Worker admitted before the revocation included. Answers the newest stream generation it had opened, which
   * its projects stop counting it through. */
  async revoke(clientId: string | null): Promise<number> {
    if (clientId) this.ctx.storage.kv.put(revokedKey(clientId), true);
    this.end(this.stream);
    return this.ctx.storage.kv.get<number>('generation') ?? 0;
  }

  /** The configured heartbeat (DX2's 15 s deployed; shorter under the local command) and a lease of LEASE_PERIODS of
   * it; the suites' Worker sets both per machine (test/support/worker-under-test.ts). */
  protected timing(): Timing {
    const heartbeat = heartbeatMs(this.env);
    return { heartbeatMs: heartbeat, leaseMs: LEASE_PERIODS * heartbeat };
  }

  private open(request: Request): Response {
    const org = request.headers.get(ORG_HEADER) ?? '';
    const machine = request.headers.get(MACHINE_HEADER) ?? '';
    const generation = (this.ctx.storage.kv.get<number>('generation') ?? 0) + 1;
    this.ctx.storage.kv.put('generation', generation);
    this.end(this.stream);

    const { heartbeatMs } = this.timing();
    let fail!: (reason: Error) => void;
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({ start: (controller) => void (fail = (reason) => controller.error(reason)) });
    const stream: Stream = {
      org,
      machine,
      generation,
      writer: writable.getWriter(),
      fail,
      heartbeat: setInterval(() => void this.write(stream, { t: 'hb', at: new Date().toISOString() }), heartbeatMs),
      parts: new PartAssembler(),
      projects: new Set(),
    };
    this.stream = stream;
    // The client's close reaches the object as the request's abort (compatibility flag enable_request_signal).
    request.signal.addEventListener('abort', () => this.end(stream));
    void this.write(stream, { t: 'welcome', org, machine, generation, heartbeat_ms: heartbeatMs });
    return new Response(readable, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } });
  }

  /**
   * A POST of NDJSON frames. Refused whole, with nothing applied, when it is not for the current stream, too large, or
   * holds a line that is not a frame; otherwise each frame goes to its project in order, and the answer comes once
   * every reply the projects owe (`have`, the backlog, `resend`, `refused`) is written down the stream. Consecutive
   * frames for one project reach it in one call. The stream is checked again once the body is read and before each
   * call, and the project stops a call before a frame once it knows of a newer stream: a POST that a newer stream
   * outlived stops there (`stale-generation`, with how many frames it applied), so it changes nothing the newer stream
   * set up. A reply that
   * could not be written ends the stream and answers `503 delivery-failed`: reconnect, and the handshake heals it.
   */
  private async frames(request: Request): Promise<Response> {
    const stream = this.stream;
    if (!stream || request.headers.get(GENERATION_HEADER) !== String(stream.generation)) {
      return json(409, { error: 'stale-generation', message: 'the POST names no current stream of this machine; open the stream and use its generation' });
    }
    if (Number(request.headers.get('Content-Length') ?? 0) > POST_LIMIT) return json(413, { error: 'too-large' });
    // Read only to the limit: a body past it is refused as it passes, never read whole first.
    const body = await readLimited(request.body, POST_LIMIT);
    if (!body) return json(413, { error: 'too-large' });
    const text = new TextDecoder().decode(body);
    const stale = (applied: number) =>
      json(409, { error: 'stale-generation', message: 'a newer stream of this machine opened while this POST was read; send it again on that one', frames: applied });
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
    // so `applied` counts posted frames as before.
    let applied = 0;
    let carry = 0;
    let run: { project: string; frames: UpFrame[]; weights: number[] } | null = null;
    const flush = async (): Promise<Response | null> => {
      if (!run) return null;
      const { project, frames: batch, weights } = run;
      run = null;
      if (this.stream !== stream) return stale(applied);
      const failed = () => {
        this.end(stream);
        return json(503, { error: 'delivery-failed', message: 'a reply to this POST could not be written to the stream; reconnect and send it again', frames: applied });
      };
      let result: { applied: number; stale: boolean; failed: boolean };
      try {
        result = await this.project(stream, project).fromMachine(this.context(stream, project), batch);
      } catch {
        // The call itself failed: what the project applied of this run is unknown, so only earlier runs count.
        return failed();
      }
      applied += weights.slice(0, result.applied).reduce((sum, weight) => sum + weight, 0);
      if (result.failed) return failed();
      return result.stale ? stale(applied) : null;
    };

    for (const posted of frames) {
      let frame: UpFrame | undefined = posted;
      if (posted.t === 'part') {
        try {
          frame = stream.parts.add(posted as Part) as UpFrame | undefined;
        } catch (error) {
          const refusal = error instanceof PartsBudgetError ? json(413, { error: 'too-large', message: error.message }) : json(400, { error: 'bad-shape', message: 'a malformed part' });
          return (await flush()) ?? refusal;
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
        if (run && run.project !== project) {
          const refused = await flush();
          if (refused) return refused;
        }
        run ??= { project, frames: [], weights: [] };
        run.frames.push(frame);
        run.weights.push(weight);
        continue;
      }
      const refused = await flush();
      if (refused) return refused;
      if (this.stream !== stream) return stale(applied);
      if (project === null) {
        // `hb-ack`: renews the lease in every project this stream opened, when it names this stream's generation.
        if (frame.t === 'hb-ack' && frame.generation === stream.generation) await this.renew(stream);
      } else {
        await this.send({ t: 'refused', project: String(project), refusal: { reason: 'bad-shape', message: 'the frame names no .smns project id' } }, stream.generation);
      }
      applied += weight;
    }
    const refused = await flush();
    if (refused) return refused;
    return json(200, { ok: true, frames: applied + carry });
  }

  private async write(stream: Stream, frame: DownFrame): Promise<boolean> {
    try {
      await stream.writer.write(sse(frame));
      return true;
    } catch {
      this.end(stream);
      return false;
    }
  }

  private context(stream: Stream, project: string): MachineContext {
    return { org: stream.org, project, machine: stream.machine, generation: stream.generation, leaseMs: this.timing().leaseMs };
  }

  private project(stream: Stream, project: string) {
    return this.env.PROJECT.get(this.env.PROJECT.idFromName(`${stream.org}:${project}`));
  }

  /** The daemon answered a heartbeat of this stream: its lease goes on in every project the stream opened. */
  private async renew(stream: Stream): Promise<void> {
    await Promise.allSettled([...stream.projects].map((project) => this.project(stream, project).renew(this.context(stream, project))));
  }

  private end(stream: Stream | undefined): void {
    if (!stream) return;
    clearInterval(stream.heartbeat);
    if (this.stream === stream) this.stream = undefined;
    // Errored, not closed: a close (or an abort) waits behind a write a client that stopped reading never takes, and the
    // writes queued after it are a project's send chain and the POSTs waiting on it. Erroring the stream fails them all
    // at once, so they answer offline.
    stream.fail(new Error('the stream ended'));
    // The stream's end ends its lease at once in every project it opened; a project that misses this finds the lease
    // lapsed instead.
    for (const project of stream.projects) void this.project(stream, project).closed(this.context(stream, project)).catch(() => {});
    stream.projects.clear();
  }
}
