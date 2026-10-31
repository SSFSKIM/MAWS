// The session host protocol (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, Interfaces §A; the host is
// native/session-host/, M1): over the host's Unix socket, newline-delimited JSON control lines, plus two byte records
// whose header line is followed by exactly `len` raw bytes, `stdin` from the client and `out`/`err` from the host, so a
// 64 MiB engine line is never JSON-escaped on the hot path (D4). The first client line is `auth`; a wrong token gets
// no byte. The protocol grows additively within its major (`hello.protocol`): unknown fields are ignored, an unknown
// `t` is answered `error`, and a client never adopts a host of another major. The constants mirror
// native/session-host/host/limits.go.
import * as z from 'zod';

export const SESSION_HOST_PROTOCOL = 1;
export const SESSION_HOST_VERSION = '1.0.0'; // `maws-session-host --version` prints `maws-session-host <it> protocol <major>`
export const LINE_CAP = 64 * 1024 * 1024; // an output line past it is dropped with a `problem`
export const RING_CAP = 8 * 1024 * 1024; // unacknowledged output the host keeps for a writer
export const STDIN_QUEUE_CAP = 64 * 1024 * 1024; // queued stdin bytes; one record of any valid size into an empty queue
export const FRAME_CAP = LINE_CAP + 256; // a control line, or a record's header and bytes
export const LINGER_MS = 10 * 60_000; // an exited child's host serves its exit this long, or until `release`
export const HOST_EXIT_GRACE_MS = 5_000; // the child's time to exit after the host's own SIGTERM relay
export const AUTH_WINDOW_MS = 2_000; // a connection's time to authenticate
export const HOST_NO_CHILD_MS = 30_000; // a host with no child and no writer exits after it
export const SOCKET_CHECK_MS = 60_000; // how often the host checks its socket file is still there

// Client → host.
export type ClientMessage =
  | { t: 'auth'; token: string }
  | { t: 'attach'; role: 'writer'; fence: number }
  | { t: 'attach'; role: 'observer' }
  | { t: 'launch'; appSessionId: string; engineSessionId: string; argv: string[]; cwd: string; env: Record<string, string> }
  | { t: 'commit' }
  | { t: 'read'; fromSeq: number }
  | { t: 'ack'; seq: number }
  | { t: 'end' }
  | { t: 'signal'; name: 'SIGTERM' | 'SIGINT' | 'SIGKILL'; group: boolean }
  | { t: 'release' }
  | { t: 'hb' };

// Host → client control lines, read tolerantly (loose objects: a later minor may add fields).
const ChildSchema = z.looseObject({ pid: z.number().int(), procStart: z.string() });
const RingSchema = z.looseObject({ firstSeq: z.number().int(), lastSeq: z.number().int(), bytes: z.number().int() });
const ExitSchema = z.looseObject({ code: z.number().int().nullable(), signal: z.string().nullable(), at: z.string() });

export const HostMessageSchema = z.discriminatedUnion('t', [
  z.looseObject({
    t: z.literal('hello'),
    protocol: z.number().int(),
    holderId: z.string(),
    pid: z.number().int(),
    procStart: z.string(),
    appSessionId: z.string().nullable(),
    engineSessionId: z.string().nullable(),
    state: z.enum(['ready', 'committed', 'running', 'exited']),
    child: ChildSchema.nullable(),
    fence: z.number().int(),
    writer: z.boolean(),
    stdinApplied: z.number().int(),
    stdinAccepted: z.number().int(),
    stdinQueued: z.number().int(),
    ring: RingSchema,
    exit: ExitSchema.nullable(),
  }),
  z.looseObject({ t: z.literal('spawned'), pid: z.number().int(), procStart: z.string() }),
  z.looseObject({ t: z.literal('spawnFailed'), message: z.string() }),
  z.looseObject({ t: z.literal('attached'), fence: z.number().int(), stdinApplied: z.number().int(), stdinAccepted: z.number().int(), ring: RingSchema }),
  z.looseObject({ t: z.literal('refused'), reason: z.string() }),
  z.looseObject({ t: z.literal('caughtUp'), lastSeq: z.number().int(), gap: z.number().int().nullable() }),
  z.looseObject({ t: z.literal('applied'), offset: z.number().int() }),
  z.looseObject({ t: z.literal('duplicate'), accepted: z.number().int(), applied: z.number().int() }),
  z.looseObject({ t: z.literal('gap'), accepted: z.number().int() }),
  z.looseObject({ t: z.literal('fenced'), fence: z.number().int() }),
  z.looseObject({ t: z.literal('busy'), queued: z.number().int() }),
  z.looseObject({ t: z.literal('stdinClosed'), applied: z.number().int(), partial: z.number().int() }),
  z.looseObject({ t: z.literal('exit'), code: z.number().int().nullable(), signal: z.string().nullable(), at: z.string() }),
  z.looseObject({ t: z.literal('problem'), kind: z.string(), length: z.number().int(), stream: z.enum(['out', 'err']).optional() }),
  z.looseObject({ t: z.literal('error'), message: z.string() }),
]);
export type HostMessage = z.infer<typeof HostMessageSchema>;
export type Hello = Extract<HostMessage, { t: 'hello' }>;

// One decoded item of the host's stream: a control line as JSON (validate it with HostMessageSchema), or a record.
export type HostItem = { kind: 'control'; message: { t: string } & Record<string, unknown> } | { kind: 'record'; stream: 'out' | 'err'; seq: number; data: Buffer };

export class HostStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostStreamError';
  }
}

// Splits the host's byte stream into items. A record's header names its length, and its bytes follow whatever they
// hold; a line or record past `frameCap`, or a line that is not a JSON object with a string `t`, throws HostStreamError
// (the connection is beyond repair: close it).
export class HostStreamDecoder {
  private pending: Buffer = Buffer.alloc(0);
  private record: { stream: 'out' | 'err'; seq: number; len: number } | null = null;

  constructor(private readonly frameCap: number = FRAME_CAP) {}

  push(chunk: Buffer): HostItem[] {
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    const items: HostItem[] = [];
    for (;;) {
      if (this.record) {
        if (this.pending.length < this.record.len) break;
        const { stream, seq, len } = this.record;
        items.push({ kind: 'record', stream, seq, data: Buffer.from(this.pending.subarray(0, len)) });
        this.pending = this.pending.subarray(len);
        this.record = null;
        continue;
      }
      const newline = this.pending.indexOf(0x0a);
      if (newline === -1) {
        if (this.pending.length > this.frameCap) throw new HostStreamError(`a line over ${this.frameCap} bytes`);
        break;
      }
      const line = this.pending.subarray(0, newline).toString('utf8');
      this.pending = this.pending.subarray(newline + 1);
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        throw new HostStreamError(`a line that is not JSON: ${line.slice(0, 80)}`);
      }
      if (typeof message !== 'object' || message === null || typeof (message as { t?: unknown }).t !== 'string') {
        throw new HostStreamError(`a line with no type: ${line.slice(0, 80)}`);
      }
      const typed = message as { t: string } & Record<string, unknown>;
      if (typed.t === 'out' || typed.t === 'err') {
        const { seq, len } = typed;
        if (typeof seq !== 'number' || typeof len !== 'number' || !Number.isInteger(len) || len < 0 || len > this.frameCap) {
          throw new HostStreamError(`a record header out of range: ${line.slice(0, 80)}`);
        }
        this.record = { stream: typed.t, seq, len };
        continue;
      }
      items.push({ kind: 'control', message: typed });
    }
    if (this.pending.length === 0) this.pending = Buffer.alloc(0); // drop the reference to a consumed chunk
    return items;
  }
}

export function controlLine(message: ClientMessage): Buffer {
  return Buffer.from(`${JSON.stringify(message)}\n`, 'utf8');
}

// A stdin record, header and bytes in one buffer, so the transport hands it to the socket as one write (Interfaces §C).
export function stdinRecord(offset: number, data: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`{"t":"stdin","offset":${offset},"len":${data.length}}\n`, 'utf8'), data]);
}
