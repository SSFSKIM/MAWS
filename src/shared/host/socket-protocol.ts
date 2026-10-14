// The socket layer around C1's host protocol (E10 execution document, §Design 2). A detached engine host
// (the supervisor) serves one client over a Unix socket; the lines are newline-delimited JSON. The first line each way
// is this layer's handshake (`hello`, then `welcome` or `refuse`); after a `welcome` the lines are C1's envelope
// (`req`, `res`, `evt`, and the client's `ready`) exactly as over a MessagePort, plus this layer's `exit`.
//
// Stability promise, for every later protocol version: `hello`'s first three fields (`t`, `protocol`, `token`),
// `refuse`'s shape and `exit` keep their meaning, so a client of any version can tell an incompatible supervisor apart
// and ask it to exit. A child that bumps SOCKET_PROTOCOL owns the migration.
//
// Protocol 2 (P3-A M5; docs/doperpowers/plans/2026-10-12-p3-a-store.md, the P3 ledger's X24 binary-channel row): after
// the welcome, document frames ride the same socket beside the JSON lines (`encodeDocFrame`, `splitRecords`), and the
// socket layer gains three message types of its own, outside C1's envelope and the X2 registry (so the wire fingerprint
// never sees them): `documents.open` and `documents.close` from the client, `documents.closed` from the host. A
// protocol-1 peer is refused `protocol` at the hello, before any frame is written, and replaced by the existing path.
import * as z from 'zod';
import { ActorSchema } from '../artifacts/actor';

export const SOCKET_PROTOCOL = 2;
export const LINE_CAP = 64 * 1024 * 1024; // bytes per line, both ends (the engine transport's cap)
export const WRITABLE_CAP = 256 * 1024 * 1024; // a peer this far behind is stalled and is closed

export const ClientHelloSchema = z.strictObject({
  t: z.literal('hello'),
  protocol: z.number().int(),
  token: z.string(),
  buildId: z.string(),
  wire: z.string(),
  appPid: z.number().int(),
});
// What a server of any version reads from a hello before it checks the rest: the promised-stable fields only.
export const HelloPreambleSchema = z.looseObject({ t: z.literal('hello'), protocol: z.number().int(), token: z.string() });
export const ServerWelcomeSchema = z.strictObject({
  t: z.literal('welcome'),
  protocol: z.number().int(),
  buildId: z.string(),
  wire: z.string(),
  pid: z.number().int(),
  startedAt: z.string(),
  liveSessions: z.number().int().nonnegative(),
  rows: z.number().int().nonnegative(),
});
export const ServerRefuseSchema = z.strictObject({
  t: z.literal('refuse'),
  reason: z.enum(['token', 'protocol', 'wire', 'replaced']),
  protocol: z.number().int(),
  buildId: z.string(),
  wire: z.string(),
  liveSessions: z.number().int().nonnegative(),
});
// Honoured only on a connection whose token checked out, before or after a welcome.
export const ClientExitSchema = z.strictObject({ t: z.literal('exit'), when: z.enum(['now', 'idle']) });
export const SocketLineSchema = z.union([ClientHelloSchema, ServerWelcomeSchema, ServerRefuseSchema, ClientExitSchema]);

export type ClientHello = z.infer<typeof ClientHelloSchema>;
export type ServerWelcome = z.infer<typeof ServerWelcomeSchema>;
export type ServerRefuse = z.infer<typeof ServerRefuseSchema>;
export type RefuseReason = ServerRefuse['reason'];
export type ClientExit = z.infer<typeof ClientExitSchema>;
export type SocketLine = z.infer<typeof SocketLineSchema>;

export interface LineSplitter {
  push(chunk: Buffer): void;
  // The bytes read past the line whose handler answered 'stop' (and anything pushed since); empties the buffer.
  rest(): Buffer;
}

// A byte-accurate NDJSON splitter shared by both ends: lines are cut on 0x0A before decoding, so a multi-byte
// character split across reads decodes whole. A line longer than `cap` bytes calls `onOverflow` once and the splitter
// goes deaf (the caller closes the connection). A handler answering 'stop' halts the splitting; the bytes after that
// line stay buffered for `rest()`, which is how the handshake hands a connection's leftover to the SocketPort.
export function splitLines(onLine: (line: string) => void | 'stop', onOverflow: () => void, cap: number = LINE_CAP): LineSplitter {
  let parts: Buffer[] = [];
  let size = 0;
  let state: 'open' | 'stopped' | 'dead' = 'open';

  const keep = (bytes: Buffer) => {
    if (bytes.length === 0) return;
    parts.push(bytes);
    size += bytes.length;
  };
  const overflow = () => {
    state = 'dead';
    parts = [];
    size = 0;
    onOverflow();
  };

  return {
    push(chunk) {
      if (state === 'dead') return;
      if (state === 'stopped') return keep(chunk);
      let start = 0;
      while (state === 'open') {
        const newline = chunk.indexOf(0x0a, start);
        if (newline < 0) break;
        const length = size + newline - start;
        if (length > cap) return overflow();
        const line = size === 0 ? chunk.subarray(start, newline) : Buffer.concat([...parts, chunk.subarray(start, newline)], length);
        parts = [];
        size = 0;
        start = newline + 1;
        if (line.length > 0 && onLine(line.toString('utf8')) === 'stop') state = 'stopped';
      }
      keep(chunk.subarray(start));
      if (state === 'open' && size > cap) overflow();
    },
    rest() {
      const bytes = Buffer.concat(parts, size);
      parts = [];
      size = 0;
      return bytes;
    },
  };
}

// P3-A M5 start: document frames and the document messages (S2's `spikes/p3-store/s2/src/socket/framing.ts`, copied).
//
// A record after the welcome is either
//   a JSON line   the UTF-8 JSON of one object and 0x0A; its first byte is `{` (JSON of an object), never 0x00
//   a doc frame   0x00 | u32 BE length L | u32 BE channel | L - 4 bytes: one port-provider frame (src/artifacts/provider)
// so a reader at a record boundary tells them apart by one byte. JSON escapes every control character, so a line holds
// neither 0x00 nor a raw 0x0A; a frame's payload may hold both and is skipped by its length. The channel is main's u32
// key for one open document; a Yjs clientId (53-bit on v14) never goes in a frame header.
export const DOC_MARK = 0x00;
export const DOC_HEADER = 9;
export const DOC_FRAME_CAP = 64 * 1024 * 1024; // one frame's payload, as LINE_CAP bounds a line

export function encodeDocFrame(channel: number, frame: Uint8Array): Buffer {
  const out = Buffer.allocUnsafe(DOC_HEADER + frame.length);
  out[0] = DOC_MARK;
  out.writeUInt32BE(frame.length + 4, 1);
  out.writeUInt32BE(channel, 5);
  out.set(frame, DOC_HEADER);
  return out;
}

export interface RecordHandlers {
  line(text: string): void;
  doc(channel: number, frame: Uint8Array): void; // an exact-size copy with its own buffer, safe to post on a port
  overflow(why: string): void; // once; the splitter goes deaf and the caller closes the connection
}

export interface RecordSplitter {
  push(chunk: Buffer): void;
}

// The reader of everything after the handshake. A partial record is kept as the pieces it arrived in and joined once,
// when it completes, so a long line or a large frame read in many chunks is copied a bounded number of times. A line
// longer than `lineCap` bytes or a frame whose payload exceeds `frameCap` (or whose length cannot hold a channel) calls
// `overflow` once and the splitter goes deaf.
export function splitRecords(handlers: RecordHandlers, lineCap: number = LINE_CAP, frameCap: number = DOC_FRAME_CAP): RecordSplitter {
  let parts: Buffer[] = []; // the incomplete record at the head of the stream
  let size = 0;
  let need = 0; // a frame's whole size once its header is known; 0 for a line or a header still incomplete
  let dead = false;

  const fail = (why: string) => {
    dead = true;
    parts = [];
    size = 0;
    handlers.overflow(why);
  };
  const keep = (bytes: Buffer) => {
    parts.push(bytes);
    size += bytes.length;
  };
  const take = (): Buffer => {
    const whole = parts.length === 1 ? parts[0] : Buffer.concat(parts, size);
    parts = [];
    size = 0;
    need = 0;
    return whole;
  };
  // The frame's length from a header at `at`, or null after an overflow.
  const frameSize = (bytes: Buffer, at: number): number | null => {
    const length = bytes.readUInt32BE(at + 1);
    if (length < 4 || length - 4 > frameCap) {
      fail(`a doc frame of ${length} bytes`);
      return null;
    }
    return 5 + length;
  };
  const emitFrame = (bytes: Buffer, at: number, total: number) => handlers.doc(bytes.readUInt32BE(at + 5), new Uint8Array(bytes.subarray(at + DOC_HEADER, at + total)));

  return {
    push(chunk) {
      let at = 0;
      while (!dead && at < chunk.length) {
        if (size > 0) {
          // completing the record at the head
          if (parts[0][0] === DOC_MARK) {
            if (need === 0) {
              // its header is still short of 9 bytes: join the few bytes kept with this chunk and read on from there
              chunk = Buffer.concat([take(), chunk.subarray(at)]);
              at = 0;
              continue;
            }
            const wanted = Math.min(need - size, chunk.length - at);
            keep(chunk.subarray(at, at + wanted));
            at += wanted;
            if (size < need) return;
            const total = need;
            emitFrame(take(), 0, total);
            continue;
          }
          const newline = chunk.indexOf(0x0a, at);
          if (newline < 0) {
            keep(chunk.subarray(at));
            if (size > lineCap) fail(`a line over ${lineCap} bytes`);
            return;
          }
          if (size + newline - at > lineCap) return fail(`a line over ${lineCap} bytes`);
          keep(chunk.subarray(at, newline));
          at = newline + 1;
          const text = take().toString('utf8');
          if (text.length > 0) handlers.line(text);
          continue;
        }
        // at a record boundary
        if (chunk[at] === DOC_MARK) {
          if (chunk.length - at < DOC_HEADER) {
            keep(chunk.subarray(at));
            return;
          }
          const total = frameSize(chunk, at);
          if (total === null) return;
          if (chunk.length - at >= total) {
            emitFrame(chunk, at, total);
            at += total;
            continue;
          }
          keep(chunk.subarray(at));
          need = total;
          return;
        }
        const newline = chunk.indexOf(0x0a, at);
        if (newline < 0) {
          keep(chunk.subarray(at));
          if (size > lineCap) fail(`a line over ${lineCap} bytes`);
          return;
        }
        if (newline - at > lineCap) return fail(`a line over ${lineCap} bytes`);
        const text = chunk.toString('utf8', at, newline);
        at = newline + 1;
        if (text.length > 0) handlers.line(text);
      }
    },
  };
}

// The document messages, JSON lines of the socket layer itself (beside `exit`): main opens a channel for one document
// under the actor it names and closes it; the host tells main a channel it ended (`host`: the document service closed
// it, e.g. an eviction or a refused frame; `reset`: the socket was past the high-water mark, so the frame was not
// queued). Frames for a channel may follow its open at once: the socket keeps order and the host opens the channel as it
// reads the line.
const Channel = z.number().int().nonnegative().max(0xffff_ffff);
export const DocumentsOpenSchema = z.strictObject({ t: z.literal('documents.open'), channel: Channel, artifactId: z.uuid(), actor: ActorSchema, doc: z.enum(['suggestions']).optional() }); // `doc`: P3-A M8
export const DocumentsCloseSchema = z.strictObject({ t: z.literal('documents.close'), channel: Channel });
export const DocumentsClosedSchema = z.strictObject({ t: z.literal('documents.closed'), channel: Channel, reason: z.enum(['host', 'reset']) });
export type DocumentsOpen = z.infer<typeof DocumentsOpenSchema>;
export type DocumentsClose = z.infer<typeof DocumentsCloseSchema>;
export type DocumentsClosed = z.infer<typeof DocumentsClosedSchema>;
// P3-A M5 end
