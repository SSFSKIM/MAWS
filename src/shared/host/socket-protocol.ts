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
//
// Protocol 3 (P5 O1 M6, OX1; docs/doperpowers/plans/2026-10-27-p5-o1-seams.md): `protocol` is the wire's major
// (WIRE_MAJOR, src/shared/ipc/wire.ts), and the hello and welcome carry the `minor`, the `build` and the `capabilities`
// in place of protocol 2's exact `buildId` and `wire` fingerprint. Peers of one major interoperate: a change within it is
// additive (src/shared/ipc/wire-manifest.json holds the code to that), and each receiver reads tolerantly
// (src/shared/ipc/tolerant.ts). Protocol 2's hello and welcome are kept, unchanged, for one major (the protocol-2
// window): a client refused by a protocol-2 supervisor whose fingerprint equals its own speaks protocol 2 to it, and a
// server answers a protocol-2 hello as protocol 2 did. They go when major 4 lands.
//
// P5 O2 M4 (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md): a third record kind after the welcome, the pty frame
// (`0x01`, `encodePtyFrame`), carries a pty host's `pty.data` event as bytes instead of a base64 JSON line. It is gated by
// the capability `socket.ptyFrames` (PTY_FRAMES_CAPABILITY): a writer frames `pty.data` only for a peer whose hello or
// welcome listed it, so a peer of an earlier minor, or any protocol-2 one, never reads a `0x01` and the frozen lines
// (P5 Decision Log 42) are untouched; a reader decodes the frame into the same `evt` it replaces.
import * as z from 'zod';
import { ActorSchema } from '../artifacts/actor';

export const SOCKET_PROTOCOL = 3;
export const SOCKET_PROTOCOL_V2 = 2; // the previous major, still spoken through the protocol-2 window
export const LINE_CAP = 64 * 1024 * 1024; // bytes per line, both ends (the engine transport's cap)
export const WRITABLE_CAP = 256 * 1024 * 1024; // a peer this far behind is stalled and is closed

export const ClientHelloSchema = z.strictObject({
  t: z.literal('hello'),
  protocol: z.number().int(),
  token: z.string(),
  minor: z.number().int().nonnegative(),
  build: z.string(),
  capabilities: z.array(z.string()),
  appPid: z.number().int(),
});
// What a server of any version reads from a hello before it checks the rest: the promised-stable fields only.
export const HelloPreambleSchema = z.looseObject({ t: z.literal('hello'), protocol: z.number().int(), token: z.string() });
export const ServerWelcomeSchema = z.strictObject({
  t: z.literal('welcome'),
  protocol: z.number().int(),
  minor: z.number().int().nonnegative(),
  build: z.string(),
  capabilities: z.array(z.string()),
  pid: z.number().int(),
  startedAt: z.string(),
  liveSessions: z.number().int().nonnegative(),
  rows: z.number().int().nonnegative(),
});
// Protocol 2's hello and welcome, exactly as a pre-O1 build writes and reads them: the protocol-2 window's form.
export const ClientHelloV2Schema = z.strictObject({
  t: z.literal('hello'),
  protocol: z.number().int(),
  token: z.string(),
  buildId: z.string(),
  wire: z.string(),
  appPid: z.number().int(),
});
export const ServerWelcomeV2Schema = z.strictObject({
  t: z.literal('welcome'),
  protocol: z.number().int(),
  buildId: z.string(),
  wire: z.string(),
  pid: z.number().int(),
  startedAt: z.string(),
  liveSessions: z.number().int().nonnegative(),
  rows: z.number().int().nonnegative(),
});
// Unchanged since protocol 1 and read alike by every major: `buildId` is the build, `wire` the wire fingerprint.
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
export type ClientHelloV2 = z.infer<typeof ClientHelloV2Schema>;
export type ServerWelcomeV2 = z.infer<typeof ServerWelcomeV2Schema>;
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
//   a pty frame   0x01 | u32 BE length L | u8 n | n bytes ptyId (ASCII) | u32 BE offset high | u32 BE offset low |
//                 L - 9 - n bytes of output (P5 O2 M4, under PTY_FRAMES_CAPABILITY; offset < 2^53)
// so a reader at a record boundary tells them apart by one byte. JSON escapes every control character, so a line holds
// neither 0x00 nor 0x01 nor a raw 0x0A; a frame's payload may hold all three and is skipped by its length. The channel is
// main's u32 key for one open document; a Yjs clientId (53-bit on v14) never goes in a frame header. Either frame's whole
// record is at most DOC_FRAME_CAP + 9 bytes (L - 4 <= the frame cap).
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

// P5 O2 M4 start: the pty frame (above), for one `pty.data` event's payload
export const PTY_MARK = 0x01;
export const PTY_FRAMES_CAPABILITY = 'socket.ptyFrames';
const PTY_FIXED = 9; // the id's length byte and the offset's two words, inside L
const OFFSET_HIGH_LIMIT = 2 ** 21; // the offset's high word stays below this: offset < 2^53

export interface PtyFrame {
  ptyId: string;
  offset: number;
  data: Uint8Array;
}

// The frame of one chunk, or null when it cannot be one (an id that is not ASCII or is longer than 255 bytes, an offset
// that is not an integer in 0..2^53 - 1, or output past the frame cap): the writer then sends the event as a JSON line.
export function encodePtyFrame({ ptyId, offset, data }: PtyFrame, frameCap: number = DOC_FRAME_CAP): Buffer | null {
  if (ptyId.length > 255 || [...ptyId].some((char) => char.charCodeAt(0) > 0x7f)) return null;
  if (!Number.isSafeInteger(offset) || offset < 0) return null;
  const length = PTY_FIXED + ptyId.length + data.byteLength;
  if (length - 4 > frameCap) return null;
  const out = Buffer.allocUnsafe(5 + length);
  out[0] = PTY_MARK;
  out.writeUInt32BE(length, 1);
  out[5] = ptyId.length;
  out.write(ptyId, 6, 'latin1');
  const at = 6 + ptyId.length;
  out.writeUInt32BE(Math.floor(offset / 2 ** 32), at);
  out.writeUInt32BE(offset % 2 ** 32, at + 4);
  out.set(data, at + 8);
  return out;
}
// P5 O2 M4 end

export interface RecordHandlers {
  line(text: string): void;
  doc(channel: number, frame: Uint8Array): void; // an exact-size copy with its own buffer, safe to post on a port
  pty(frame: PtyFrame): void; // P5 O2 M4: its data an exact-size copy, as a doc frame's
  overflow(why: string): void; // once; the splitter goes deaf and the caller closes the connection
}

export interface RecordSplitter {
  push(chunk: Buffer): void;
}

// The reader of everything after the handshake. A partial record is kept as the pieces it arrived in and joined once,
// when it completes, so a long line or a large frame read in many chunks is copied a bounded number of times. A line
// longer than `lineCap` bytes or a frame whose payload exceeds `frameCap` (or whose length cannot hold a channel, or a
// pty frame's id and offset; P5 O2 M4: or whose id or offset breaks its rules) calls `overflow` once and the splitter
// goes deaf.
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
    const pty = bytes[at] === PTY_MARK; // P5 O2 M4
    if (length < (pty ? PTY_FIXED : 4) || length - 4 > frameCap) {
      fail(`a ${pty ? 'pty' : 'doc'} frame of ${length} bytes`);
      return null;
    }
    return 5 + length;
  };
  const emitFrame = (bytes: Buffer, at: number, total: number) => {
    if (bytes[at] === PTY_MARK) return emitPty(bytes, at, total); // P5 O2 M4
    handlers.doc(bytes.readUInt32BE(at + 5), new Uint8Array(bytes.subarray(at + DOC_HEADER, at + total)));
  };
  // P5 O2 M4: a pty frame whose id runs past its length, is not ASCII, or whose offset reaches 2^53 is a broken record
  const emitPty = (bytes: Buffer, at: number, total: number) => {
    const n = bytes[at + 5];
    const offsetAt = at + 6 + n;
    if (offsetAt + 8 > at + total) return fail(`a pty frame whose id of ${n} bytes runs past its length`);
    const id = bytes.subarray(at + 6, offsetAt);
    if (id.some((byte) => byte > 0x7f)) return fail('a pty frame whose id is not ASCII');
    const high = bytes.readUInt32BE(offsetAt);
    if (high >= OFFSET_HIGH_LIMIT) return fail('a pty frame whose offset is past 2^53');
    handlers.pty({ ptyId: id.toString('latin1'), offset: high * 2 ** 32 + bytes.readUInt32BE(offsetAt + 4), data: new Uint8Array(bytes.subarray(offsetAt + 8, at + total)) });
  };
  const isFrame = (byte: number) => byte === DOC_MARK || byte === PTY_MARK; // P5 O2 M4

  return {
    push(chunk) {
      let at = 0;
      while (!dead && at < chunk.length) {
        if (size > 0) {
          // completing the record at the head
          if (isFrame(parts[0][0])) {
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
        if (isFrame(chunk[at])) {
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
