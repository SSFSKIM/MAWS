// One enrolled machine's connection (DX2): the SSE stream down, which the machine opens outbound and this object holds,
// and the machine's POSTs up, which it hands, frame by frame and in order, to the projects they name. Each stream gets
// the next connection generation; a newer stream ends the older one, and a POST belongs to the stream it names. A
// `Project` reaches the machine only through `send`, which writes to the stream or answers "offline" at once.
//
// The machine's lease in each project it opened on a stream begins with that `hello` and is renewed by the daemon's
// `hb-ack` of the stream's generation, which this object hands to each of those projects; the stream's end is handed to
// them too, so the lease ends at once. Neither is relied on alone: an object can restart without running any of this,
// and the projects then find the lease lapsed (Project's alarm).
import { DurableObject } from 'cloudflare:workers';
import { MACHINE_HEADER, ORG_HEADER, type Env } from '../env';
import { GENERATION_HEADER, HEARTBEAT_MS, LEASE_MS, POST_LIMIT, type DownFrame, type UpFrame } from '../protocol/machine';
import { FRAME_LIMIT, PartAssembler, toWire, type Part } from '../protocol/parts';
import { PROJECT_ID, type MachineContext } from './project';

type Stream = {
  org: string;
  machine: string;
  generation: number;
  writer: WritableStreamDefaultWriter<Uint8Array>;
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

/** The project a frame up is addressed to, or null for one that names none (`hb-ack`). */
function projectOf(frame: UpFrame): unknown {
  if (frame.t === 'session') return (frame.message as { project?: unknown } | undefined)?.project;
  return 'project' in frame ? frame.project : null;
}

export class Machine extends DurableObject<Env> {
  private stream: Stream | undefined;

  async fetch(request: Request): Promise<Response> {
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

  /** The machine was revoked: its stream ends now (the Worker refuses its credential from here on). */
  revoke(): void {
    this.end(this.stream);
  }

  /** The deployed timing; the suites' Worker shortens it per machine (test/support/worker-under-test.ts). */
  protected timing(): Timing {
    return { heartbeatMs: HEARTBEAT_MS, leaseMs: LEASE_MS };
  }

  private open(request: Request): Response {
    const org = request.headers.get(ORG_HEADER) ?? '';
    const machine = request.headers.get(MACHINE_HEADER) ?? '';
    const generation = (this.ctx.storage.kv.get<number>('generation') ?? 0) + 1;
    this.ctx.storage.kv.put('generation', generation);
    this.end(this.stream);

    const { heartbeatMs } = this.timing();
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const stream: Stream = {
      org,
      machine,
      generation,
      writer: writable.getWriter(),
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
   * every reply the projects owe (`have`, the backlog, `resend`, `refused`) is written down the stream. The stream is
   * checked again once the body is read and before each frame: a POST that a newer stream outlived stops there
   * (`stale-generation`, with how many frames it applied), so it changes nothing the newer stream set up. A reply that
   * could not be written ends the stream and answers `503 delivery-failed`: reconnect, and the handshake heals it.
   */
  private async frames(request: Request): Promise<Response> {
    const stream = this.stream;
    if (!stream || request.headers.get(GENERATION_HEADER) !== String(stream.generation)) {
      return json(409, { error: 'stale-generation', message: 'the POST names no current stream of this machine; open the stream and use its generation' });
    }
    if (Number(request.headers.get('Content-Length') ?? 0) > POST_LIMIT) return json(413, { error: 'too-large' });
    const text = await request.text();
    if (utf8Length(text) > POST_LIMIT) return json(413, { error: 'too-large' });
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

    let applied = 0;
    for (const posted of frames) {
      if (this.stream !== stream) return stale(applied);
      let frame: UpFrame | undefined = posted;
      if (posted.t === 'part') {
        try {
          frame = stream.parts.add(posted as Part) as UpFrame | undefined;
        } catch {
          return json(400, { error: 'bad-shape', message: 'a malformed part' });
        }
        if (frame === undefined) {
          applied++;
          continue;
        }
      }
      const project = projectOf(frame);
      if (project === null) {
        // `hb-ack`: renews the lease in every project this stream opened, when it names this stream's generation.
        if (frame.t === 'hb-ack' && frame.generation === stream.generation) await this.renew(stream);
        applied++;
        continue;
      }
      if (typeof project !== 'string' || !PROJECT_ID.test(project)) {
        await this.send({ t: 'refused', project: String(project), refusal: { reason: 'bad-shape', message: 'the frame names no .smns project id' } }, stream.generation);
        applied++;
        continue;
      }
      const target = this.project(stream, project);
      if (frame.t === 'hello') stream.projects.add(project);
      try {
        await target.fromMachine(this.context(stream, project), frame);
      } catch {
        this.end(stream);
        return json(503, { error: 'delivery-failed', message: 'a reply to this POST could not be written to the stream; reconnect and send it again', frames: applied });
      }
      applied++;
    }
    return json(200, { ok: true, frames: applied });
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
    stream.writer.close().catch(() => {});
    // The stream's end ends its lease at once in every project it opened; a project that misses this finds the lease
    // lapsed instead.
    for (const project of stream.projects) void this.project(stream, project).closed(this.context(stream, project)).catch(() => {});
    stream.projects.clear();
  }
}
