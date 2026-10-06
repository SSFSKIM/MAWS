import { EventEmitter } from 'node:events';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HelperEvent } from './backend';
import {
  HELPER_IDLE_MS,
  HELPER_LINE_MAX,
  HELPER_PROBE_CACHE_MS,
  HELPER_PROBE_MS,
  HELPER_READY_MS,
  HelperBackend,
  helperPath,
  isExecutableFile,
  type HelperChild,
} from './helper-backend';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PATH = '/app/build/voice-helper/maws-voice-helper';
const PROBE = { type: 'probe', locales: ['en-US', 'ko-KR'], systemLocale: 'ko-KR', locale: 'ko-KR', supportsOnDevice: true, permission: { microphone: 'authorized', speech: 'notDetermined' } };

// A child process that records what main writes and says what the test makes it say, synchronously.
class FakeChild extends EventEmitter implements HelperChild {
  readonly written: Record<string, unknown>[] = [];
  readonly signals: string[] = [];
  stdinEnded = false;
  readonly stdout = Object.assign(new EventEmitter(), { setEncoding: () => {} });
  readonly stderr = Object.assign(new EventEmitter(), { setEncoding: () => {} });
  readonly stdin = Object.assign(new EventEmitter(), {
    write: (chunk: string) => {
      for (const line of chunk.split('\n').filter(Boolean)) this.written.push(JSON.parse(line) as Record<string, unknown>);
      return true;
    },
    end: () => {
      this.stdinEnded = true;
    },
  });
  say(line: object | string): void {
    this.stdout.emit('data', `${typeof line === 'string' ? line : JSON.stringify(line)}\n`);
  }
  ready(): void {
    this.say({ type: 'ready', protocol: 1 });
  }
  exit(code: number | null = 0, signal: string | null = null): void {
    this.emit('close', code, signal); // what the backend follows: the streams are read, the process is gone
  }
  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    return true;
  }
  commands(): unknown[] {
    return this.written.map((command) => command.cmd);
  }
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setup({ probeOnly = false, executable = true } = {}) {
  const children: FakeChild[] = [];
  const spawn = vi.fn(() => {
    const child = new FakeChild();
    children.push(child);
    return child;
  });
  const backend = new HelperBackend({ path: PATH, probeOnly, spawn, executable: () => executable });
  const events: HelperEvent[] = [];
  const start = (captureId = A, locale: string | null = 'en-US') => backend.start(captureId, locale, (event) => events.push(event));
  const child = () => children.at(-1)!;
  return { backend, spawn, children, child, events, start };
}

// Lets the backend's awaits run (a few promise jobs), without moving the fake clock.
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

// A started capture over a ready helper (spawned for it when none runs).
async function started(h: ReturnType<typeof setup>, captureId = A) {
  const spawned = h.spawn.mock.calls.length;
  const answer = h.start(captureId);
  if (h.spawn.mock.calls.length > spawned) h.child().ready();
  await expect(answer).resolves.toEqual({ accepted: true });
  return h.child();
}

describe('helper backend spawns, times out, and reports a crash', () => {
  describe('the helper path', () => {
    it('takes MAWS_VOICE_HELPER first, then the packaged resources, then the development build', () => {
      const where = (env: NodeJS.ProcessEnv, packaged: boolean) => helperPath({ env, packaged, resourcesPath: '/MAWS.app/Contents/Resources', appRoot: '/repo' });
      expect(where({ MAWS_VOICE_HELPER: '/opt/helper' }, true)).toBe('/opt/helper');
      expect(where({}, true)).toBe('/MAWS.app/Contents/Resources/voice-helper/maws-voice-helper');
      expect(where({}, false)).toBe('/repo/build/voice-helper/maws-voice-helper');
      expect(where({ MAWS_VOICE_HELPER: '' }, false)).toBe('/repo/build/voice-helper/maws-voice-helper');
    });

    it('calls a path missing unless it is an executable file', () => {
      const dir = mkdtempSync(join(tmpdir(), 'maws-voice-'));
      try {
        const file = join(dir, 'maws-voice-helper');
        expect(isExecutableFile(file)).toBe(false);
        writeFileSync(file, '#!/bin/sh\n');
        chmodSync(file, 0o644);
        expect(isExecutableFile(file)).toBe(false);
        chmodSync(file, 0o755);
        expect(isExecutableFile(file)).toBe(true);
        expect(isExecutableFile(dir)).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('answers missing for probe and start without spawning when the helper is not there', async () => {
      const h = setup({ executable: false });
      await expect(h.backend.probe('en-US')).resolves.toEqual({ helper: { state: 'missing', path: PATH }, backend: 'helper', permission: null, systemLocale: null, locale: 'en-US', supportsOnDevice: null, locales: [] });
      await expect(h.start()).resolves.toEqual({ accepted: false, reason: 'helper_missing', path: PATH });
      expect(h.spawn).not.toHaveBeenCalled();
    });
  });

  describe('probe', () => {
    it('spawns lazily, waits for ready, and answers the probe as the status', async () => {
      const h = setup();
      expect(h.spawn).not.toHaveBeenCalled();
      const status = h.backend.probe(null);
      expect(h.spawn).toHaveBeenCalledExactlyOnceWith(PATH);
      expect(h.child().written).toEqual([]); // nothing before ready
      h.child().ready();
      await settle();
      expect(h.child().written).toEqual([{ cmd: 'probe', locale: null }]);
      h.child().say(PROBE);
      await expect(status).resolves.toEqual({ helper: { state: 'ready', path: PATH }, backend: 'helper', permission: PROBE.permission, systemLocale: 'ko-KR', locale: 'ko-KR', supportsOnDevice: true, locales: ['en-US', 'ko-KR'] });
    });

    it('caches a probe per locale for 10 s, and forgets it when a capture reports new permission states', async () => {
      const h = setup();
      const first = h.backend.probe('en-US');
      h.child().ready();
      await settle();
      h.child().say({ ...PROBE, locale: 'en-US' });
      await first;
      await h.backend.probe('en-US');
      expect(h.child().written).toHaveLength(1);
      const other = h.backend.probe('ko-KR'); // another locale is its own probe
      await settle();
      h.child().say(PROBE);
      await other;
      expect(h.child().written).toHaveLength(2);
      vi.advanceTimersByTime(HELPER_PROBE_CACHE_MS);
      const again = h.backend.probe('en-US');
      await settle();
      expect(h.child().written).toHaveLength(3);
      h.child().say({ ...PROBE, locale: 'en-US' });
      await again;

      await started(h);
      h.child().say({ type: 'permission', id: A, microphone: 'authorized', speech: 'authorized' });
      const fresh = h.backend.probe('en-US');
      await settle();
      expect(h.child().commands().at(-1)).toBe('probe');
      h.child().say({ ...PROBE, locale: 'en-US', permission: { microphone: 'authorized', speech: 'authorized' } });
      await expect(fresh).resolves.toMatchObject({ permission: { microphone: 'authorized', speech: 'authorized' } });
    });

    it('answers the helper failed when ready never comes, and kills it', async () => {
      const h = setup();
      const status = h.backend.probe(null);
      vi.advanceTimersByTime(HELPER_READY_MS);
      await expect(status).resolves.toMatchObject({ helper: { state: 'failed', path: PATH, message: expect.stringContaining('ready') }, permission: null, locales: [] });
      expect(h.child().signals).toEqual(['SIGKILL']);
    });

    it('answers the helper failed when the helper exits before answering a probe', async () => {
      const h = setup();
      const status = h.backend.probe(null);
      h.child().ready();
      await settle();
      h.child().exit(1);
      await expect(status).resolves.toMatchObject({ helper: { state: 'failed', path: PATH } });
    });

    it('answers the helper failed when no reply comes within 5 s, kills it, and respawns on the next probe', async () => {
      const h = setup();
      const status = h.backend.probe(null);
      h.child().ready();
      await settle();
      expect(h.child().commands()).toEqual(['probe']);
      vi.advanceTimersByTime(HELPER_PROBE_MS - 1);
      expect(h.child().signals).toEqual([]);
      vi.advanceTimersByTime(1);
      await expect(status).resolves.toMatchObject({ helper: { state: 'failed', path: PATH, message: expect.stringContaining('probe timed out') }, permission: null, locales: [] });
      expect(h.children[0]!.signals).toEqual(['SIGKILL']);
      h.children[0]!.say(PROBE); // a reply after the deadline answers nothing
      const again = h.backend.probe(null);
      expect(h.spawn).toHaveBeenCalledTimes(2);
      h.child().ready();
      await settle();
      h.child().say(PROBE);
      await expect(again).resolves.toMatchObject({ helper: { state: 'ready' } });
      expect(vi.getTimerCount()).toBe(1); // the idle quit only: the answered probe left no deadline behind
    });

    it('answers the helper failed without probing when it closed between ready and the probe', async () => {
      const h = setup();
      const status = h.backend.probe(null);
      h.child().ready();
      h.child().exit(1); // read before the awaiting probe resumes
      await expect(status).resolves.toMatchObject({ helper: { state: 'failed', path: PATH, message: expect.stringContaining('exited') } });
      expect(h.children[0]!.written).toEqual([]);
      expect(vi.getTimerCount()).toBe(0); // no probe deadline, no idle quit for a helper that is gone
      const again = h.backend.probe(null);
      expect(h.spawn).toHaveBeenCalledTimes(2);
      h.child().ready();
      await settle();
      h.child().say(PROBE);
      await expect(again).resolves.toMatchObject({ helper: { state: 'ready' } });
    });
  });

  describe('a capture', () => {
    it('writes start once the helper is ready, answers accepted, and routes the capture’s lines to its sink', async () => {
      const h = setup();
      const answer = h.start(A, null);
      expect(h.child().written).toEqual([]);
      h.child().ready();
      await expect(answer).resolves.toEqual({ accepted: true });
      expect(h.child().written).toEqual([{ cmd: 'start', id: A, locale: null }]);
      h.child().say({ type: 'permission', id: A, microphone: 'authorized', speech: 'authorized' });
      h.child().say({ type: 'started', id: A, locale: 'ko-KR' });
      h.child().say({ type: 'partial', id: B, text: 'another capture' });
      h.child().say({ type: 'partial', id: A, text: 'hello' });
      h.backend.stop(A);
      expect(h.child().written.at(-1)).toEqual({ cmd: 'stop', id: A });
      h.child().say({ type: 'final', id: A, text: 'Hello.', timedOut: false });
      h.child().say({ type: 'partial', id: A, text: 'late' });
      expect(h.events.map((event) => event.type)).toEqual(['permission', 'started', 'partial', 'final']);
    });

    it('keeps the helper warm: a second capture reuses the running helper', async () => {
      const h = setup();
      await started(h, A);
      h.child().say({ type: 'final', id: A, text: '', timedOut: false });
      await expect(h.start(B)).resolves.toEqual({ accepted: true });
      expect(h.spawn).toHaveBeenCalledOnce();
      expect(h.child().commands()).toEqual(['start', 'start']);
    });

    it('skips the start and answers cancelled when cancel arrived during the ready wait', async () => {
      const h = setup();
      const answer = h.start();
      h.backend.cancel(A);
      h.child().ready();
      await expect(answer).resolves.toEqual({ accepted: false, reason: 'cancelled', path: null });
      expect(h.child().written).toEqual([]);
    });

    it('writes cancel when the start line was already written, and drops what the capture says after', async () => {
      const h = setup();
      const child = await started(h);
      h.backend.cancel(A);
      expect(child.written.at(-1)).toEqual({ cmd: 'cancel', id: A });
      child.say({ type: 'started', id: A, locale: 'en-US' });
      child.say({ type: 'cancelled', id: A });
      expect(h.events).toEqual([]);
    });

    it('writes a stop that came during the ready wait right after the start', async () => {
      const h = setup();
      const answer = h.start();
      h.backend.stop(A);
      h.child().ready();
      await answer;
      expect(h.child().written).toEqual([{ cmd: 'start', id: A, locale: 'en-US' }, { cmd: 'stop', id: A }]);
    });

    it('answers helper_failed when ready does not arrive in time, and spawns afresh on the next start', async () => {
      const h = setup();
      const answer = h.start();
      vi.advanceTimersByTime(HELPER_READY_MS - 1);
      expect(h.children[0]!.signals).toEqual([]);
      vi.advanceTimersByTime(1);
      await expect(answer).resolves.toEqual({ accepted: false, reason: 'helper_failed', path: PATH });
      expect(h.children[0]!.signals).toEqual(['SIGKILL']);
      h.children[0]!.exit(null, 'SIGKILL');
      const retry = h.start(B);
      expect(h.spawn).toHaveBeenCalledTimes(2);
      h.child().ready();
      await expect(retry).resolves.toEqual({ accepted: true });
    });

    it('answers helper_failed when the helper cannot be spawned at all', async () => {
      const h = setup();
      const answer = h.start();
      h.child().emit('error', Object.assign(new Error('spawn EACCES'), { code: 'EACCES' }));
      await expect(answer).resolves.toEqual({ accepted: false, reason: 'helper_failed', path: PATH });
    });

    it('reports helper_crashed when the helper exits during a capture, and respawns on the next start', async () => {
      const h = setup();
      const child = await started(h);
      child.say({ type: 'started', id: A, locale: 'en-US' });
      child.exit(null, 'SIGSEGV');
      expect(h.events.at(-1)).toEqual({ type: 'error', id: A, code: 'helper_crashed', message: expect.stringContaining('SIGSEGV') });
      const next = h.start(B);
      expect(h.spawn).toHaveBeenCalledTimes(2);
      h.child().ready();
      await expect(next).resolves.toEqual({ accepted: true });
    });

    it('takes a final the helper wrote before it exited as the final, not a crash', async () => {
      const h = setup();
      const child = await started(h);
      child.say({ type: 'final', id: A, text: 'Hello.', timedOut: false });
      child.exit(0);
      expect(h.events).toEqual([{ type: 'final', id: A, text: 'Hello.', timedOut: false }]);
    });

    it('refuses every start in probe-only mode without spawning, and still probes', async () => {
      const h = setup({ probeOnly: true });
      await expect(h.start()).resolves.toEqual({ accepted: false, reason: 'e2e_refused', path: null });
      expect(h.spawn).not.toHaveBeenCalled();
      const status = h.backend.probe(null);
      h.child().ready();
      await settle();
      h.child().say(PROBE);
      await expect(status).resolves.toMatchObject({ helper: { state: 'ready' }, backend: 'helper' });
    });
  });

  describe('lines', () => {
    it('drops a malformed line, an unknown kind and an overlong line with a warning, and keeps reading', async () => {
      const h = setup();
      const child = await started(h);
      child.say('{"type":"partial","id"');
      child.say({ type: 'stopped', id: A });
      child.say({ type: 'partial', id: A, text: 'x'.repeat(HELPER_LINE_MAX) });
      child.say({ type: 'partial', id: A, text: 'hello' });
      expect(h.events).toEqual([{ type: 'partial', id: A, text: 'hello' }]);
      expect(warn).toHaveBeenCalledTimes(3);
    });

    it('logs an error the helper could not attribute to a capture, and routes it nowhere', async () => {
      const h = setup();
      const child = await started(h);
      child.say({ type: 'error', id: null, code: 'bad_request', message: 'Unparseable command line.' });
      expect(h.events).toEqual([]);
      expect(warn).toHaveBeenCalledOnce();
    });
  });

  describe('lifetime', () => {
    it('quits the helper after 10 idle minutes and respawns on the next use', async () => {
      const h = setup();
      const child = await started(h);
      vi.advanceTimersByTime(HELPER_IDLE_MS * 2);
      expect(child.commands()).toEqual(['start']); // a capture is running: never idle
      child.say({ type: 'final', id: A, text: '', timedOut: false });
      vi.advanceTimersByTime(HELPER_IDLE_MS - 1);
      expect(child.commands()).toEqual(['start']);
      vi.advanceTimersByTime(1);
      expect(child.commands()).toEqual(['start', 'quit']);
      expect(child.stdinEnded).toBe(true);
      expect(child.signals).toEqual(['SIGTERM']);
      expect(vi.getTimerCount()).toBe(0);
      child.exit(null, 'SIGTERM');
      h.start(B);
      expect(h.spawn).toHaveBeenCalledTimes(2);
    });

    it('on dispose writes quit, ends stdin and sends SIGTERM at once, leaving no timer behind', async () => {
      const h = setup();
      const child = await started(h);
      child.say({ type: 'final', id: A, text: '', timedOut: false }); // arms the idle quit
      expect(vi.getTimerCount()).toBe(1);
      h.backend.dispose();
      expect(child.commands()).toEqual(['start', 'quit']);
      expect(child.stdinEnded).toBe(true);
      expect(child.signals).toEqual(['SIGTERM']);
      expect(vi.getTimerCount()).toBe(0);
      child.exit(null, 'SIGTERM');
      expect(h.events).toEqual([{ type: 'final', id: A, text: '', timedOut: false }]); // a disposed backend reports no crash
    });

    it('ends a capture’s helper on dispose without reporting it crashed', async () => {
      const h = setup();
      const child = await started(h);
      h.backend.dispose();
      expect(child.signals).toEqual(['SIGTERM']);
      child.exit(null, 'SIGTERM');
      expect(h.events).toEqual([]);
    });

    it('signals nothing on dispose when the helper already exited', async () => {
      const h = setup();
      const child = await started(h);
      child.exit(null, 'SIGSEGV');
      h.backend.dispose();
      expect(child.commands()).toEqual(['start']);
      expect(child.signals).toEqual([]);
    });

    it('writes no start for a capture still awaiting ready when the backend is disposed', async () => {
      const h = setup();
      const answer = h.start();
      h.backend.dispose();
      h.child().ready();
      await expect(answer).resolves.toEqual({ accepted: false, reason: 'cancelled', path: null });
      expect(h.child().commands()).toEqual(['quit']);
    });

    it('disposes without a helper running', () => {
      const h = setup();
      h.backend.dispose();
      expect(h.spawn).not.toHaveBeenCalled();
    });
  });
});
