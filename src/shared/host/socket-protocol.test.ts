import { describe, expect, it } from 'vitest';
import {
  ClientExitSchema,
  ClientHelloSchema,
  DOC_FRAME_CAP,
  DocumentsCloseSchema,
  DocumentsClosedSchema,
  DocumentsOpenSchema,
  encodeDocFrame,
  HelloPreambleSchema,
  LINE_CAP,
  ServerRefuseSchema,
  ServerWelcomeSchema,
  SOCKET_PROTOCOL,
  SocketLineSchema,
  splitLines,
  splitRecords,
  WRITABLE_CAP,
} from './socket-protocol';

function collect(cap?: number) {
  const lines: string[] = [];
  let overflows = 0;
  const splitter = splitLines(
    (line) => void lines.push(line),
    () => void overflows++,
    cap,
  );
  return { lines, splitter, overflows: () => overflows };
}

describe('splitLines', () => {
  it('splits lines across and within chunks, and skips blank lines', () => {
    const { lines, splitter } = collect();
    splitter.push(Buffer.from('{"a":1}\n{"b"'));
    splitter.push(Buffer.from(':2}\n\n{"c":3}\n{"d"'));
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
    splitter.push(Buffer.from(':4}\n'));
    expect(lines.at(-1)).toBe('{"d":4}');
  });

  it('decodes a multi-byte character split between two chunks', () => {
    const { lines, splitter } = collect();
    const bytes = Buffer.from('"héllo ✓"\n');
    const cut = bytes.indexOf(0xc3) + 1; // inside the two-byte é
    splitter.push(bytes.subarray(0, cut));
    splitter.push(bytes.subarray(cut));
    expect(lines).toEqual(['"héllo ✓"']);
  });

  it('accepts a line of exactly the cap and overflows once past it, ignoring everything after', () => {
    const small = collect(8);
    small.splitter.push(Buffer.from('12345678\n'));
    expect(small.lines).toEqual(['12345678']);
    small.splitter.push(Buffer.from('1234'));
    small.splitter.push(Buffer.from('56789'));
    expect(small.overflows()).toBe(1);
    small.splitter.push(Buffer.from('\n{"later":1}\n'));
    expect(small.lines).toEqual(['12345678']);
    expect(small.overflows()).toBe(1);

    const whole = collect(8); // a complete line past the cap inside one chunk overflows too
    whole.splitter.push(Buffer.from('ok\n123456789\nnext\n'));
    expect(whole.lines).toEqual(['ok']);
    expect(whole.overflows()).toBe(1);
  });

  it('carries a line near the real 64 MiB cap and refuses one byte past it', () => {
    const body = Buffer.alloc(LINE_CAP, 0x61);
    const near = collect();
    near.splitter.push(body.subarray(0, LINE_CAP / 2));
    near.splitter.push(body.subarray(LINE_CAP / 2));
    near.splitter.push(Buffer.from('\n'));
    expect(near.lines).toHaveLength(1);
    expect(near.lines[0]).toHaveLength(LINE_CAP);
    expect(near.overflows()).toBe(0);

    const over = collect();
    over.splitter.push(body);
    over.splitter.push(Buffer.from('a'));
    expect(over.overflows()).toBe(1);
    expect(over.lines).toEqual([]);
  });

  it('stops at a line whose handler says stop and hands back every byte after it', () => {
    const lines: string[] = [];
    const splitter = splitLines(
      (line) => {
        lines.push(line);
        return 'stop';
      },
      () => {},
    );
    splitter.push(Buffer.from('{"t":"hello"}\n{"t":"req"'));
    splitter.push(Buffer.from(',"id":"1"}\n{"t":'));
    expect(lines).toEqual(['{"t":"hello"}']);
    expect(splitter.rest().toString()).toBe('{"t":"req","id":"1"}\n{"t":');
    expect(splitter.rest().length).toBe(0);
  });
});

describe('the socket layer schemas', () => {
  const hello = { t: 'hello', protocol: SOCKET_PROTOCOL, token: 'ab', buildId: 'b', wire: 'w', appPid: 7 };

  it('parses each line kind and refuses unknown ones', () => {
    expect(SocketLineSchema.parse(hello)).toEqual(hello);
    const welcome = { t: 'welcome', protocol: 1, buildId: 'b', wire: 'w', pid: 9, startedAt: '2026-10-06T00:00:00.000Z', liveSessions: 0, rows: 0 };
    expect(ServerWelcomeSchema.parse(welcome)).toEqual(welcome);
    for (const reason of ['token', 'protocol', 'wire', 'replaced'] as const) {
      expect(ServerRefuseSchema.parse({ t: 'refuse', reason, protocol: 1, buildId: 'b', wire: 'w', liveSessions: 2 }).reason).toBe(reason);
    }
    expect(ClientExitSchema.parse({ t: 'exit', when: 'idle' })).toEqual({ t: 'exit', when: 'idle' });
    expect(SocketLineSchema.safeParse({ t: 'nope' }).success).toBe(false);
    expect(ClientHelloSchema.safeParse({ ...hello, extra: 1 }).success).toBe(false);
  });

  it('reads the stable preamble of a hello whatever else a later protocol adds', () => {
    expect(HelloPreambleSchema.parse({ t: 'hello', protocol: 2, token: 'x', somethingNew: [1] })).toMatchObject({ protocol: 2, token: 'x' });
    expect(HelloPreambleSchema.safeParse({ t: 'hello', protocol: 2 }).success).toBe(false);
  });

  it('caps writes at 256 MiB and lines at 64 MiB', () => {
    expect(LINE_CAP).toBe(64 * 1024 * 1024);
    expect(WRITABLE_CAP).toBe(256 * 1024 * 1024);
  });
});

// P3-A M5 (docs/doperpowers/plans/2026-10-12-p3-a-store.md; the P3 ledger's X24 binary-channel row): socket protocol 2
// carries document frames `0x00 | u32 length | u32 channel | payload` beside the JSON lines after the welcome.
type Record_ = { line: string } | { doc: number; frame: Uint8Array };

function records(lineCap?: number, frameCap?: number) {
  const out: Record_[] = [];
  const overflows: string[] = [];
  const splitter = splitRecords(
    {
      line: (text) => void out.push({ line: text }),
      doc: (channel, frame) => {
        expect(frame).toBeInstanceOf(Uint8Array);
        expect(frame.byteOffset).toBe(0); // its own buffer, so posting it on a MessagePort ships nothing more
        expect(frame.buffer.byteLength).toBe(frame.length);
        out.push({ doc: channel, frame });
      },
      overflow: (why) => void overflows.push(why),
    },
    lineCap,
    frameCap,
  );
  return { out, overflows, splitter };
}

// A frame whose payload holds a newline and the doc mark, between two lines, and a line right after a frame.
const PAYLOAD = Uint8Array.from([0x0a, 0x00, 0x7b, 0x0a, 0x00, 0xff]);
const STREAM = Buffer.concat([
  Buffer.from('{"t":"req","id":"1"}\n'),
  encodeDocFrame(7, PAYLOAD),
  Buffer.from('{"t":"évt"}\n'),
  encodeDocFrame(0xffff_ffff, new Uint8Array(0)),
  encodeDocFrame(3, Uint8Array.from([1, 2, 3])),
  Buffer.from('\n{"t":"res"}\n'),
]);
const EXPECTED: Record_[] = [
  { line: '{"t":"req","id":"1"}' },
  { doc: 7, frame: PAYLOAD },
  { line: '{"t":"évt"}' },
  { doc: 0xffff_ffff, frame: new Uint8Array(0) },
  { doc: 3, frame: Uint8Array.from([1, 2, 3]) },
  { line: '{"t":"res"}' },
];

describe('socket protocol 2: document frames beside the JSON lines (P3-A M5)', () => {
  it('is protocol 2', () => {
    expect(SOCKET_PROTOCOL).toBe(2);
  });

  it('encodes a frame as the mark, the length of channel and payload, the channel and the payload', () => {
    const frame = encodeDocFrame(0x0102_0304, Uint8Array.from([9, 8]));
    expect([...frame]).toEqual([0x00, 0, 0, 0, 6, 1, 2, 3, 4, 9, 8]);
  });

  it('splits lines and frames identically whichever byte boundary a read is cut at', () => {
    const whole = records();
    whole.splitter.push(STREAM);
    expect(whole.out).toEqual(EXPECTED);
    for (let cut = 1; cut < STREAM.length; cut++) {
      const two = records();
      two.splitter.push(STREAM.subarray(0, cut));
      two.splitter.push(STREAM.subarray(cut));
      expect(two.out, `cut at ${cut}`).toEqual(EXPECTED);
      expect(two.overflows).toEqual([]);
    }
    const bytewise = records();
    for (const byte of STREAM) bytewise.splitter.push(Buffer.from([byte]));
    expect(bytewise.out).toEqual(EXPECTED);
  });

  it('keeps a frame’s own 0x0A and 0x00 inside it and resumes on the line after it', () => {
    const { out, splitter } = records();
    splitter.push(Buffer.concat([encodeDocFrame(1, Buffer.from('a\nb\n\u0000c')), Buffer.from('{"after":1}\n')]));
    expect(out).toEqual([{ doc: 1, frame: new Uint8Array(Buffer.from('a\nb\n\u0000c')) }, { line: '{"after":1}' }]);
  });

  it('accepts a frame of exactly the cap and goes deaf at one past it, or at a length too short for a channel', () => {
    const at = records(64, 16);
    at.splitter.push(encodeDocFrame(1, new Uint8Array(16)));
    expect(at.out).toHaveLength(1);
    at.splitter.push(encodeDocFrame(1, new Uint8Array(17)).subarray(0, 9)); // the header alone names the length
    expect(at.overflows).toEqual(['a doc frame of 21 bytes']);
    at.splitter.push(Buffer.from('{"later":1}\n'));
    expect(at.out).toHaveLength(1);

    const short = records();
    short.splitter.push(Buffer.from([0x00, 0, 0, 0, 3, 0, 0, 0, 1]));
    expect(short.overflows).toHaveLength(1);
  });

  it('still caps a line at the line cap, whole or split, and a frame does not count against it', () => {
    const capped = records(8);
    capped.splitter.push(Buffer.concat([Buffer.from('12345678\n'), encodeDocFrame(2, new Uint8Array(100)), Buffer.from('1234')]));
    expect(capped.out.map((r) => ('line' in r ? r.line : r.doc))).toEqual(['12345678', 2]);
    capped.splitter.push(Buffer.from('56789'));
    expect(capped.overflows).toEqual(['a line over 8 bytes']);

    const whole = records(8);
    whole.splitter.push(Buffer.from('ok\n123456789\nnext\n'));
    expect(whole.out).toEqual([{ line: 'ok' }]);
    expect(whole.overflows).toHaveLength(1);
  });

  it('carries the real caps: a 64 MiB frame payload in pieces', () => {
    expect(DOC_FRAME_CAP).toBe(64 * 1024 * 1024);
    const { out, splitter, overflows } = records();
    const frame = encodeDocFrame(5, new Uint8Array(DOC_FRAME_CAP).fill(0x0a));
    for (let at = 0; at < frame.length; at += 1 << 20) splitter.push(frame.subarray(at, at + (1 << 20)));
    expect(overflows).toEqual([]);
    expect(out).toHaveLength(1);
    expect((out[0] as { frame: Uint8Array }).frame.length).toBe(DOC_FRAME_CAP);
  });

  it('names the document messages: open and close from main, closed from the host', () => {
    const open = { t: 'documents.open', channel: 4, artifactId: '11111111-1111-4111-8111-111111111111', actor: { kind: 'human' } };
    expect(DocumentsOpenSchema.parse(open)).toEqual(open);
    expect(DocumentsOpenSchema.safeParse({ ...open, channel: 2 ** 32 }).success).toBe(false);
    expect(DocumentsCloseSchema.parse({ t: 'documents.close', channel: 4 })).toEqual({ t: 'documents.close', channel: 4 });
    for (const reason of ['host', 'reset'] as const) expect(DocumentsClosedSchema.parse({ t: 'documents.closed', channel: 4, reason }).reason).toBe(reason);
    expect(DocumentsClosedSchema.safeParse({ t: 'documents.closed', channel: 4, reason: 'client' }).success).toBe(false);
  });
});
