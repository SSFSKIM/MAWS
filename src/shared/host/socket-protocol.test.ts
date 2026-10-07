import { describe, expect, it } from 'vitest';
import {
  ClientExitSchema,
  ClientHelloSchema,
  HelloPreambleSchema,
  LINE_CAP,
  ServerRefuseSchema,
  ServerWelcomeSchema,
  SOCKET_PROTOCOL,
  SocketLineSchema,
  splitLines,
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
