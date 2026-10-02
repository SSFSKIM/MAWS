import { describe, expect, it, vi } from 'vitest';
import type { LaunchPlan } from './launch';
import { INIT_RESPONSE, ROUTED_STATUS, scriptedSession } from './conformance/session-harness';
import { ControlTimeout } from './rpc';
import { LineBudgetExceeded, LineSplitter, MAX_LINE_CHARS, spawnEngine, type EngineTransport, type TransportItem } from './transport';

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

    it('hands over the lines a chunk completed before its remainder passed the budget', () => {
      const splitter = new LineSplitter(8);
      let caught: unknown;
      try {
        splitter.push(Buffer.from('{"a":1}\n{"b":2}\n123456789'));
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(LineBudgetExceeded);
      expect((caught as LineBudgetExceeded).lines).toEqual(['{"a":1}', '{"b":2}']);
      expect((caught as LineBudgetExceeded).length).toBe(9);
      expect(splitter.pending).toBe(0);
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

    it('delivers a frame completed in the same chunk before the line-budget error that follows it', async () => {
      // One valid frame, then 40 unterminated characters, in one write; budget 32.
      const script = `process.stdout.write('{"ok":1}\\n' + 'x'.repeat(40)); setInterval(() => {}, 1000);`;
      const transport = spawnEngine(fakeEngine(script), { maxLineChars: 32 });
      const items = await withTimeout(collect(transport.frames), 10_000, 'frames');
      expect(items).toHaveLength(2);
      expect(items[0]).toEqual({ frame: { ok: 1 }, raw: '{"ok":1}', error: null });
      expect(items[1]).toMatchObject({ frame: null, error: { kind: 'line_budget', length: 40 } });
      expect((await withTimeout(transport.exited, 10_000, 'exit')).signal).toBe('SIGKILL');
    });

    it('kill() ends the process and exited reports the signal', async () => {
      const transport = spawnEngine(fakeEngine('setInterval(() => {}, 1000);'), { maxLineChars: MAX_LINE_CHARS });
      transport.kill('SIGTERM');
      expect(await withTimeout(transport.exited, 10_000, 'exit')).toEqual({ code: null, signal: 'SIGTERM' });
      await expect(firstFrame(transport)).rejects.toThrow('frames ended');
    });

    it('ends frames at stdout EOF, flushing the tail while the child is still alive', async () => {
      const transport = spawnEngine(fakeEngine(`process.stdout.end('{"tail":true}'); setInterval(() => {}, 1000);`), { maxLineChars: MAX_LINE_CHARS });
      let exited = false;
      void transport.exited.then(() => { exited = true; });
      try {
        expect(await withTimeout(collect(transport.frames), 2_000, 'stdout EOF')).toEqual([
          { frame: { tail: true }, raw: '{"tail":true}', error: null },
        ]);
        expect(exited).toBe(false);
      } finally {
        transport.kill('SIGKILL');
        await transport.exited;
      }
    });

    it.each(['forced', 'line budget'] as const)('%s stop kills descendants as well as the engine', async (mode) => {
      const script = `
        const { spawn } = require('node:child_process');
        const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
        process.stdout.write(JSON.stringify({ descendant: child.pid }) + '\\n');
        process.stdin.once('data', () => process.stdout.write('x'.repeat(128)));
        setInterval(() => {}, 1000);
      `;
      const transport = spawnEngine(fakeEngine(script), { maxLineChars: 64 });
      let descendant: number | undefined;
      const alive = (pid: number) => {
        try { process.kill(pid, 0); return true; } catch { return false; }
      };
      try {
        const first = await withTimeout(firstFrame(transport), 5_000, 'descendant pid');
        descendant = (first.frame as { descendant: number }).descendant;
        expect(alive(descendant)).toBe(true);
        if (mode === 'forced') transport.kill('SIGKILL');
        else await transport.write({ type: 'keep_alive' });
        expect((await withTimeout(transport.exited, 5_000, 'exit')).signal).toBe('SIGKILL');
        await vi.waitFor(() => expect(alive(descendant!)).toBe(false), { timeout: 2_000 });
      } finally {
        transport.kill('SIGKILL');
        if (descendant && alive(descendant)) process.kill(descendant, 'SIGKILL');
        await transport.exited;
      }
    });

    it('discards an aborted queued write without closing the pipe or delivering it later', async () => {
      const script = `
        process.on('SIGUSR1', () => {
          let buffer = '';
          process.stdin.on('data', chunk => {
            buffer += chunk;
            let end;
            while ((end = buffer.indexOf('\\n')) >= 0) {
              const frame = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
              process.stdout.write(JSON.stringify({ id: frame.request_id }) + '\\n');
            }
          });
          process.stdin.on('end', () => process.exit(0));
        });
        process.stdout.write('{"ready":true}\\n');
        setInterval(() => {}, 1000);
      `;
      const transport = spawnEngine(fakeEngine(script), { maxLineChars: MAX_LINE_CHARS });
      try {
        await withTimeout(firstFrame(transport), 5_000, 'ready');
        const first = transport.write({ type: 'control_request', request_id: 'first', request: { subtype: 'test', padding: 'x'.repeat(4 * 1024 * 1024) } });
        void first.catch(() => {});
        const controller = new AbortController();
        const queued = transport.write({ type: 'control_request', request_id: 'cancelled', request: { subtype: 'rename_session', title: 'late' } }, controller.signal).catch((error: unknown) => error);
        controller.abort();
        expect(await withTimeout(queued, 500, 'queued abort')).toBeInstanceOf(Error);
        process.kill(transport.pid!, 'SIGUSR1');
        await first;
        await transport.write({ type: 'control_cancel_request', request_id: 'last' });
        transport.endInput();
        const received = await withTimeout(collect(transport.frames), 5_000, 'received');
        expect(received.map((item) => item.frame)).toEqual([{ id: 'first' }, { id: 'last' }]);
        expect(await transport.exited).toEqual({ code: 0, signal: null });
      } finally {
        transport.kill('SIGKILL');
        await transport.exited;
      }
    });

    it.each(['graceful', 'forced', 'stdout EOF'] as const)('a stalled control write ends through the session ladder (%s)', async (mode) => {
      const script = `
        process.on('SIGTERM', () => {
          ${mode === 'graceful' ? `process.stdout.write('{"flushed":true}\\n', () => process.exit(0));` : ''}
        });
        ${mode === 'stdout EOF' ? `process.on('SIGUSR1', () => process.stdout.end());` : ''}
        let buffer = '';
        process.stdin.on('data', chunk => {
          buffer += chunk;
          let end;
          while ((end = buffer.indexOf('\\n')) >= 0) {
            const frame = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
            const response = frame.request.subtype === 'initialize' ? ${JSON.stringify(INIT_RESPONSE)} : ${JSON.stringify(ROUTED_STATUS)};
            process.stdout.write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: frame.request_id, response } }) + '\\n');
            if (frame.request.subtype === 'get_status') process.stdin.pause();
          }
        });
        setInterval(() => {}, 1000);
      `;
      const plan = fakeEngine(script);
      const transport = spawnEngine(plan, { maxLineChars: MAX_LINE_CHARS });
      const s = scriptedSession({ session: { plan, spawn: () => transport } });
      try {
        await s.session.start();
        const written = s.session.control!.request('rename_session', { title: 'x'.repeat(4 * 1024 * 1024) }, { timeoutMs: 100 }).catch((error: unknown) => error);
        await new Promise((resolve) => setImmediate(resolve));
        if (mode === 'stdout EOF') process.kill(transport.pid!, 'SIGUSR1');
        expect(await withTimeout(written, 1_000, 'blocked deadline')).toBeInstanceOf(ControlTimeout);
        expect(await withTimeout(s.session.exited, 5_000, 'aborted exit')).toMatchObject(mode === 'graceful' ? { code: 0, signal: null } : { code: null, signal: 'SIGKILL' });
        if (mode !== 'stdout EOF') {
          expect(s.journal.rows).toContainEqual(expect.objectContaining({ direction: 'meta', frame: expect.objectContaining({ event: 'transport_error', code: 'stalled_write', message: expect.stringContaining('stalled control write') }) }));
          expect(JSON.stringify(s.events)).toContain('stalled_write');
        }
        if (mode === 'graceful') expect(s.journal.rows).toContainEqual(expect.objectContaining({ direction: 'in', frame: { flushed: true } }));
        expect(s.session.forcedKill).toBe(mode !== 'graceful');
        await expect(transport.write({ type: 'keep_alive' })).rejects.toThrow(/closed/);
      } finally {
        transport.kill('SIGKILL');
        await s.session.exited;
      }
    }, 10_000);

    it('stdout EOF aborts active and queued writes before reporting failure, even when TERM resumes stdin', async () => {
      const script = `
        process.on('SIGUSR1', () => process.stdout.end());
        process.on('SIGTERM', () => { process.stderr.write('term\\n'); process.stdin.resume(); });
        process.stdin.on('end', () => process.exit(0));
        let buffer = '';
        process.stdin.on('data', chunk => {
          buffer += chunk;
          let end;
          while ((end = buffer.indexOf('\\n')) >= 0) {
            const frame = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
            if (frame.type === 'control_request' && ['initialize', 'get_status'].includes(frame.request.subtype)) {
              const response = frame.request.subtype === 'initialize' ? ${JSON.stringify(INIT_RESPONSE)} : ${JSON.stringify(ROUTED_STATUS)};
              process.stdout.write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: frame.request_id, response } }) + '\\n');
              if (frame.request.subtype === 'get_status') process.stdin.pause();
            } else if (frame.type === 'control_response') process.stderr.write('mutation:' + frame.response.request_id + '\\n');
          }
        });
        setInterval(() => {}, 1000);
      `;
      const plan = fakeEngine(script);
      const transport = spawnEngine(plan, { maxLineChars: MAX_LINE_CHARS });
      const s = scriptedSession({ session: { plan, spawn: () => transport } });
      try {
        await s.session.start();
        // Broker answers have no RPC deadline signal. Both the active frame and the queued one must abort.
        const active = s.session.control!.respond('active' as never, { padding: 'x'.repeat(4 * 1024 * 1024) }).catch((error: unknown) => error);
        const queued = s.session.control!.respond('queued' as never, {}).catch((error: unknown) => error);
        await new Promise((resolve) => setImmediate(resolve));
        process.kill(transport.pid!, 'SIGUSR1');
        expect(await withTimeout(active, 5_000, 'EOF active failure')).toBeInstanceOf(Error);
        expect(await queued).toBeInstanceOf(Error);
        expect(await withTimeout(s.session.exited, 5_000, 'EOF exit')).toMatchObject({ code: 0, signal: null });
        const stderr = s.journal.rows.filter((row) => row.direction === 'stderr').map((row) => (row.frame as { text: string }).text);
        expect(stderr).toContain('term');
        expect(stderr.filter((line) => line.startsWith('mutation:'))).toEqual([]);
        const failed = s.journal.rows.filter((row) => (row.frame as { event?: string }).event === 'write_failed');
        expect(failed.map((row) => (row.frame as { requestId: string }).requestId)).toEqual(['active', 'queued']);
        expect(s.journal.rows.filter((row) => row.direction === 'out' && (row.frame as { type: string }).type === 'control_response')).toEqual([]);
      } finally {
        transport.kill('SIGKILL');
        await s.session.exited;
      }
    }, 10_000);

    it.each(['inherited', 'closed'] as const)('cleans a TERM-ignoring descendant after a stalled-write leader exits (%s stdio)', async (stdio) => {
      const descendantScript = `process.on('SIGTERM', () => {}); process.send('ready'); setInterval(() => {}, 1000);`;
      const script = `
        const { spawn } = require('node:child_process');
        const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendantScript)}], { stdio: ['ignore', '${stdio === 'inherited' ? 'inherit' : 'ignore'}', 'ignore', 'ipc'] });
        child.once('message', () => process.stdout.write(JSON.stringify({ descendant: child.pid }) + '\\n'));
        process.on('SIGTERM', () => process.stdout.write('{"flushed":true}\\n', () => process.exit(0)));
        setInterval(() => {}, 1000);
      `;
      const transport = spawnEngine(fakeEngine(script), { maxLineChars: MAX_LINE_CHARS });
      let descendant: number | undefined;
      const alive = (pid: number) => {
        try { process.kill(pid, 0); return true; } catch { return false; }
      };
      try {
        const first = await withTimeout(firstFrame(transport), 5_000, 'descendant ready');
        descendant = (first.frame as { descendant: number }).descendant;
        const controller = new AbortController();
        const writing = transport.write({ type: 'control_request', request_id: 'blocked', request: { subtype: 'test', padding: 'x'.repeat(4 * 1024 * 1024) } }, controller.signal).catch((error: unknown) => error);
        await new Promise((resolve) => setImmediate(resolve));
        controller.abort();
        expect(await writing).toBeInstanceOf(Error);
        transport.kill('SIGTERM');
        expect(await withTimeout(transport.exited, 5_000, 'leader exit')).toEqual({ code: 0, signal: null });
        expect((await collect(transport.frames)).map((item) => item.frame)).toContainEqual({ flushed: true });
        await vi.waitFor(() => expect(alive(descendant!)).toBe(false), { timeout: 1_000 });
        const signal = vi.spyOn(process, 'kill');
        try {
          transport.kill('SIGTERM');
          transport.kill('SIGKILL');
          expect(signal).not.toHaveBeenCalled();
        } finally { signal.mockRestore(); }
      } finally {
        transport.kill('SIGKILL');
        if (descendant && alive(descendant)) process.kill(descendant, 'SIGKILL');
        await transport.exited;
        if (descendant) await vi.waitFor(() => expect(alive(descendant!)).toBe(false), { timeout: 2_000 });
      }
    }, 10_000);

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
