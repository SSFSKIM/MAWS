// S2 → P3-A's amendment of E10's socket layer (`src/shared/host/socket-protocol.ts`, X13): document frames beside
// the JSON lines on the one Unix socket, from socket protocol 2 on (after the hello/welcome, which stay JSON lines).
//
// A record is either
//   a JSON line   the UTF-8 JSON of one object and 0x0A; its first byte is `{` (JSON.stringify of an object), never 0x00
//   a doc frame   0x00 | u32 BE length L | u32 BE channel | L - 4 bytes: one y-protocols frame (frames.ts)
// so a reader at a record boundary tells them apart by one byte. JSON.stringify escapes every control character, so
// a line can contain neither 0x00 nor a raw 0x0A; a frame's payload may contain both, and is skipped by its length.
// A protocol-1 peer never meets a frame: the hello's protocol check refuses it before the first one is written.
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
  doc(channel: number, frame: Uint8Array): void; // an exact-size copy, safe to post on a MessagePort
  overflow(why: string): void; // the splitter goes deaf; the caller closes the connection
}

export interface RecordSplitter {
  push(chunk: Buffer): void;
}

export function splitRecords(handlers: RecordHandlers, lineCap = 64 * 1024 * 1024, frameCap = DOC_FRAME_CAP): RecordSplitter {
  let buf: Buffer = Buffer.alloc(0);
  let scanFrom = 0; // where the newline search resumes inside a partial line
  let want = 0; // bytes a partial doc frame needs in total; while > 0 chunks are gathered without concatenation
  let gathered: Buffer[] = [];
  let gatheredSize = 0;
  let dead = false;

  const fail = (why: string) => {
    dead = true;
    buf = Buffer.alloc(0);
    gathered = [];
    handlers.overflow(why);
  };

  const parse = () => {
    while (!dead && buf.length > 0) {
      if (buf[0] === DOC_MARK) {
        if (buf.length < DOC_HEADER) return;
        const length = buf.readUInt32BE(1);
        if (length < 4 || length - 4 > frameCap) return fail(`a doc frame of ${length} bytes`);
        const total = 5 + length;
        if (buf.length < total) {
          want = total;
          gathered = [buf];
          gatheredSize = buf.length;
          buf = Buffer.alloc(0);
          return;
        }
        const channel = buf.readUInt32BE(5);
        const frame = new Uint8Array(buf.subarray(DOC_HEADER, total)); // a copy: a view would ship its whole pool
        buf = buf.subarray(total);
        handlers.doc(channel, frame);
      } else {
        const newline = buf.indexOf(0x0a, scanFrom);
        if (newline < 0) {
          scanFrom = buf.length;
          if (buf.length > lineCap) fail(`a line over ${lineCap} bytes`);
          return;
        }
        const text = buf.toString('utf8', 0, newline);
        buf = buf.subarray(newline + 1);
        scanFrom = 0;
        if (text.length > 0) handlers.line(text);
      }
    }
  };

  return {
    push(chunk) {
      if (dead) return;
      if (want > 0) {
        gathered.push(chunk);
        gatheredSize += chunk.length;
        if (gatheredSize < want) return;
        buf = Buffer.concat(gathered, gatheredSize);
        gathered = [];
        want = 0;
      } else {
        buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
      }
      parse();
    },
  };
}
