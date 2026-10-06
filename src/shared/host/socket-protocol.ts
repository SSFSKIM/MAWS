// The socket layer around C1's host protocol (E10 execution document, §Design 2). A detached engine host
// (the supervisor) serves one client over a Unix socket; the lines are newline-delimited JSON. The first line each way
// is this layer's handshake (`hello`, then `welcome` or `refuse`); after a `welcome` the lines are C1's envelope
// (`req`, `res`, `evt`, and the client's `ready`) exactly as over a MessagePort, plus this layer's `exit`.
//
// Stability promise, for every later protocol version: `hello`'s first three fields (`t`, `protocol`, `token`),
// `refuse`'s shape and `exit` keep their meaning, so a client of any version can tell an incompatible supervisor apart
// and ask it to exit. A child that bumps SOCKET_PROTOCOL owns the migration.
import * as z from 'zod';

export const SOCKET_PROTOCOL = 1;
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
