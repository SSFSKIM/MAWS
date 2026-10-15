// One enrolled machine's connection (DX2): the SSE stream down, which the machine opens outbound and this object holds.
// Each stream gets the next connection generation; a newer stream ends the older one. A `Project` reaches the machine
// only through `send`, which writes to the stream or answers "offline" at once. The lease that tells projects the
// machine is online (renewed on the heartbeat, fenced by generation) is M3's.
import { DurableObject } from 'cloudflare:workers';
import { MACHINE_HEADER, ORG_HEADER, type Env } from '../env';
import { HEARTBEAT_MS, type DownFrame } from '../protocol/machine';
import { toWire } from '../protocol/parts';

type Stream = { generation: number; writer: WritableStreamDefaultWriter<Uint8Array>; heartbeat: ReturnType<typeof setInterval> };

const encoder = new TextEncoder();

/** One SSE event per wire frame: `event: <t>` (`part` for a part) and the frame's JSON, which holds no line break. */
function sse(frame: DownFrame): Uint8Array {
  const lines = toWire(frame);
  const event = lines.length === 1 ? frame.t : 'part';
  return encoder.encode(lines.map((line) => `event: ${event}\ndata: ${line}\n\n`).join(''));
}

export class Machine extends DurableObject<Env> {
  private stream: Stream | undefined;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/stream' || request.method !== 'GET') return new Response('not found', { status: 404 });
    const org = request.headers.get(ORG_HEADER) ?? '';
    const machine = request.headers.get(MACHINE_HEADER) ?? '';
    const generation = (this.ctx.storage.kv.get<number>('generation') ?? 0) + 1;
    this.ctx.storage.kv.put('generation', generation);
    this.end(this.stream);

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const stream: Stream = {
      generation,
      writer: writable.getWriter(),
      heartbeat: setInterval(() => void this.write(stream, { t: 'hb', at: new Date().toISOString() }), HEARTBEAT_MS),
    };
    this.stream = stream;
    // The client's close reaches the object as the request's abort (compatibility flag enable_request_signal).
    request.signal.addEventListener('abort', () => this.end(stream));
    void this.write(stream, { t: 'welcome', org, machine, generation, heartbeat_ms: HEARTBEAT_MS });
    return new Response(readable, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } });
  }

  /** Writes a frame to the machine's current stream; "offline" when it has none. */
  async send(frame: DownFrame): Promise<'written' | 'offline'> {
    const stream = this.stream;
    if (!stream) return 'offline';
    return (await this.write(stream, frame)) ? 'written' : 'offline';
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

  private end(stream: Stream | undefined): void {
    if (!stream) return;
    clearInterval(stream.heartbeat);
    if (this.stream === stream) this.stream = undefined;
    stream.writer.close().catch(() => {});
  }
}
