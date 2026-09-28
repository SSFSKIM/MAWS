import { describe, expect, it } from 'vitest';
import type { LaunchPlan } from './launch';
import { LineSplitter, MAX_LINE_CHARS, spawnEngine, type EngineTransport, type TransportItem } from './transport';

// A fake engine is `node -e <script>` run through the real transport: the plan is the X6 shape with the bin swapped.
function fakeEngine(script: string): LaunchPlan {
  return {
    bin: process.execPath,
    args: ['-e', script],
    env: { PATH: process.env.PATH ?? '' },
    cwd: process.cwd(),
    flagSettings: {},
    launchId: 'aaaaaaaa',
    sessionId: 'sess' as LaunchPlan['sessionId'],
    gateway: 'direct',
    engineVersion: 'fake',
  };
}

// Echoes every stdin line back as `{"echo": <line>}`; writes one stderr line at start; exits when stdin ends.
const ECHO_ENGINE = `
  process.stderr.write('engine says hi\\n');
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (s) => { buf += s; let i; while ((i = buf.indexOf('\\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); process.stdout.write(JSON.stringify({ echo: JSON.parse(line) }) + '\\n'); } });
  process.stdin.on('end', () => process.exit(0));
`;

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms))]);
}

describe('transport frames and journals', () => {
  describe('LineSplitter', () => {
    it('reassembles a 3-byte UTF-8 character split across two chunks', () => {
      const splitter = new LineSplitter(MAX_LINE_CHARS);
      const bytes = Buffer.from('{"t":"한"}\n', 'utf8'); // 한 is 3 bytes
      const cut = bytes.indexOf(Buffer.from('한', 'utf8')) + 1; // inside the character
      expect(splitter.push(bytes.subarray(0, cut))).toEqual([]);
      expect(splitter.push(bytes.subarray(cut))).toEqual(['{"t":"한"}']);
    });

    it('reassembles a frame split across three chunks and cuts several lines in one chunk', () => {
      const splitter = new LineSplitter(MAX_LINE_CHARS);
      expect(splitter.push(Buffer.from('{"a"'))).toEqual([]);
      expect(splitter.push(Buffer.from(':1'))).toEqual([]);
      expect(splitter.push(Buffer.from('}\n{"b":2}\n{"c"'))).toEqual(['{"a":1}', '{"b":2}']);
      expect(splitter.push(Buffer.from(':3}\n'))).toEqual(['{"c":3}']);
      expect(splitter.pending).toBe(0);
    });

    it('drops blank lines and strips a leading U+FEFF', () => {
      const splitter = new LineSplitter(MAX_LINE_CHARS);
      expect(splitter.push(Buffer.from('﻿{"a":1}\n\n   \n\r\n{"b":2}\r\n'))).toEqual(['{"a":1}', '{"b":2}']);
    });

    it('rejects a 64 Mi + 1 character unterminated line as a line-budget error', () => {
      expect(MAX_LINE_CHARS).toBe(64 * 1024 * 1024);
      const splitter = new LineSplitter(MAX_LINE_CHARS);
      const chunk = Buffer.alloc(1024 * 1024, 0x61); // 1 Mi of 'a'
      for (let i = 0; i < 64; i += 1) expect(splitter.push(chunk)).toEqual([]);
      expect(splitter.pending).toBe(MAX_LINE_CHARS);
      expect(() => splitter.push(Buffer.from('a'))).toThrow(/line budget/);
    });

    it('with a small budget accepts a line exactly at the budget and rejects one over it', () => {
      const splitter = new LineSplitter(8);
      expect(splitter.push(Buffer.from('12345678\n'))).toEqual(['12345678']);
      expect(() => splitter.push(Buffer.from('123456789'))).toThrow(/line budget/);
    });
  });

  describe('spawnEngine', () => {
    async function firstFrame(transport: EngineTransport): Promise<TransportItem> {
      for await (const item of transport.frames) return item;
      throw new Error('frames ended');
    }

    it('spawns, writes with flush semantics, splits stdout into frames, captures stderr and reports exit', async () => {
      const transport = spawnEngine(fakeEngine(ECHO_ENGINE), { maxLineChars: MAX_LINE_CHARS });
      expect(transport.pid).toEqual(expect.any(Number));

      const frames = collect(transport.frames);
      const stderr = collect(transport.stderr);
      await transport.write({ type: 'keep_alive' });
      await transport.write({ type: 'control_cancel_request', request_id: 'r1' });
      transport.endInput();

      const exit = await withTimeout(transport.exited, 10_000, 'exit');
      expect(exit).toEqual({ code: 0, signal: null });
      expect(await frames).toEqual([
        { frame: { echo: { type: 'keep_alive' } }, raw: '{"echo":{"type":"keep_alive"}}', error: null },
        { frame: { echo: { type: 'control_cancel_request', request_id: 'r1' } }, raw: '{"echo":{"type":"control_cancel_request","request_id":"r1"}}', error: null },
      ]);
      expect(await stderr).toEqual(['engine says hi']);
    });

    it('rejects a write after the process exited', async () => {
      const transport = spawnEngine(fakeEngine('process.exit(3)'), { maxLineChars: MAX_LINE_CHARS });
      expect(await withTimeout(transport.exited, 10_000, 'exit')).toEqual({ code: 3, signal: null });
      await expect(transport.write({ type: 'keep_alive' })).rejects.toThrow(/exited|closed/);
      expect(await collect(transport.frames)).toEqual([]);
    });

    it('reports a malformed stdout line as a parse error item and keeps going', async () => {
      const script = `process.stdout.write('not json\\n{"ok":1}\\n'); setTimeout(() => process.exit(0), 50);`;
      const transport = spawnEngine(fakeEngine(script), { maxLineChars: MAX_LINE_CHARS });
      const items = await withTimeout(collect(transport.frames), 10_000, 'frames');
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({ frame: null, raw: 'not json', error: { kind: 'parse_error', length: 8 } });
      expect(items[1]).toEqual({ frame: { ok: 1 }, raw: '{"ok":1}', error: null });
    });

    it('kills the process on an unterminated line over the budget and surfaces a transport error', async () => {
      // 64 chars, no newline, then the process sits there until killed.
      const script = `process.stdout.write('x'.repeat(64)); setInterval(() => {}, 1000);`;
      const transport = spawnEngine(fakeEngine(script), { maxLineChars: 32 });
      const items = await withTimeout(collect(transport.frames), 10_000, 'frames');
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ frame: null, error: { kind: 'line_budget' } });
      expect((items[0]!.error as { message: string }).message).toMatch(/line budget/);
      const exit = await withTimeout(transport.exited, 10_000, 'exit');
      expect(exit.signal).toBe('SIGKILL');
    });

    it('kill() ends the process and exited reports the signal', async () => {
      const transport = spawnEngine(fakeEngine('setInterval(() => {}, 1000);'), { maxLineChars: MAX_LINE_CHARS });
      transport.kill('SIGTERM');
      expect(await withTimeout(transport.exited, 10_000, 'exit')).toEqual({ code: null, signal: 'SIGTERM' });
      await expect(firstFrame(transport)).rejects.toThrow('frames ended');
    });

    it('resolves exited with a spawn error item when the binary does not exist', async () => {
      const plan = { ...fakeEngine(''), bin: '/nonexistent/maws-engine-bin' };
      const transport = spawnEngine(plan, { maxLineChars: MAX_LINE_CHARS });
      expect(await withTimeout(transport.exited, 10_000, 'exit')).toEqual({ code: null, signal: null });
      const items = await collect(transport.frames);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ frame: null, error: { kind: 'spawn_error' } });
      await expect(transport.write({ type: 'keep_alive' })).rejects.toThrow();
    });
  });
});
