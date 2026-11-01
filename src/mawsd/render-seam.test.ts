// The render seam (P5 O5 M4; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, M4's Proves, Interfaces §B) over a
// fake spawn, a fake front and a fake engine host: it starts the render host at the first request and not before; a
// request held through a start is handed over once, in order, after the client's ready; a start that fails twice
// answers every request with the reason and tries again a window later; a runtime reported absent answers at once and
// never spawns; the host is ended after the quiet period and a request after that starts it again; its stop answers the
// table and ends the host; the answers reach the asker in its own shape (an undelivered inspection's file removed, a
// library refusal with its IPC error).
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostCommandError } from '@shared/host/runtime';
import type { MawsArtifactCapture, MawsArtifactExport } from '@shared/ipc/schema/maws';
import type { RenderRequest } from '@shared/ipc/schema/render';
import { COMMAND_BUDGETS_MS } from '../services/command-budgets';
import { CAPTURE_ANSWER_MS } from '@shared/maws/panes';
import { EXPORT_ANSWER_MS } from '@shared/maws/tools';
import { EXPORT_BUDGET_MS } from '../render/export';
import { until } from '../../test/support/mawsd-scene';
import { ANSWER_DEADLINE_MS, createRenderSeam, exitReason, KILL_SETTLE_MS, renderAuthors, renderCommand, spawnRenderHost, START_DEADLINE_MS, START_WATCHDOG_MS, type RenderChild, type RenderRuntime, type RenderSeam, type RenderSeamOptions } from './render-seam';

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const ARTIFACT = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f';
const PNG = { ok: true, png: 'iVBORw0KGgo=', width: 640, height: 480, consoleErrors: [] };
const capture = (requestId: string): MawsArtifactCapture => ({ appSessionId: 'app-1' as never, requestId: requestId as never, artifactId: ARTIFACT, revision: 2, width: 640, height: 480 });
const exportOf = (requestId: string, extra: Partial<MawsArtifactExport> = {}): MawsArtifactExport => ({ appSessionId: 'app-1' as never, requestId: requestId as never, artifactId: ARTIFACT, kind: 'document', format: 'pdf', revision: 2, path: `/p/artifacts/${ARTIFACT}/exports/2.pdf`, ...extra });

class FakeChild implements RenderChild {
  readonly killed: string[] = [];
  line: string | null = null;
  private readonly listeners: ((code: number | null, signal: string | null) => void)[] = [];
  constructor(readonly pid: number) {}
  kill(signal: NodeJS.Signals): void {
    this.killed.push(signal);
  }
  onExit(listener: (code: number | null, signal: string | null) => void): void {
    this.listeners.push(listener);
  }
  lastLine(): string | null {
    return this.line;
  }
  exit(code: number | null, signal: string | null = null): void {
    for (const listener of this.listeners) listener(code, signal);
  }
}

interface Scene {
  seam: RenderSeam;
  children: FakeChild[];
  posted: RenderRequest[];
  exits: { count: number };
  engine: { name: string; input: unknown }[];
  holds: { taken: number; released: number };
  removed: string[];
  logs: string[];
  runtime: { value: RenderRuntime };
  outcome: { value: 'delivered' | 'not_pending' | null };
  failSpawn: { value: string | null };
  renders: { engineHost: boolean; app: boolean };
}

function scene(extra: Partial<RenderSeamOptions> = {}): Scene {
  const s = {
    children: [] as FakeChild[],
    posted: [] as RenderRequest[],
    exits: { count: 0 },
    engine: [] as { name: string; input: unknown }[],
    holds: { taken: 0, released: 0 },
    removed: [] as string[],
    logs: [] as string[],
    runtime: { value: { available: true } as RenderRuntime },
    outcome: { value: 'delivered' as 'delivered' | 'not_pending' | null },
    failSpawn: { value: null as string | null },
    renders: { engineHost: true, app: false },
  };
  const seam = createRenderSeam({
    machine: 'mini',
    spawn: () => {
      if (s.failSpawn.value !== null) throw new Error(s.failSpawn.value);
      const child = new FakeChild(1000 + s.children.length);
      s.children.push(child);
      return child;
    },
    post: (request) => (s.posted.push(request), true),
    postExit: () => (s.exits.count++, true),
    answerEngine: async (name, input) => (s.engine.push({ name, input }), s.outcome.value),
    quietMs: () => 30_000,
    runtime: () => s.runtime.value,
    engineHostRenders: () => s.renders.engineHost,
    appAttached: () => s.renders.app,
    hold: () => {
      s.holds.taken += 1;
      return () => void (s.holds.released += 1);
    },
    removeFile: async (path) => void s.removed.push(path),
    log: (line) => void s.logs.push(line),
    restartBackoffMs: [500, 2_000, 5_000],
    ...extra,
  });
  return { seam, ...s };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('the render seam (P5 O5 M4)', () => {
  it('starts the render host at the first request and not before, and hands requests over once, in order, after its ready', async () => {
    const s = scene();
    expect(s.children).toEqual([]);
    expect(s.seam.state()).toBe('off');
    s.seam.capture(capture('cap-1'));
    expect(s.children).toHaveLength(1);
    expect(s.seam.state()).toBe('starting');
    s.seam.export(exportOf('exp-1'));
    s.seam.capture(capture('cap-2'));
    expect(s.children, 'one host for the three').toHaveLength(1);
    expect(s.posted).toEqual([]);
    s.seam.clientReady();
    expect(s.seam.state()).toBe('ready');
    expect(s.posted.map((request) => [request.kind, (request.request as { requestId: string }).requestId])).toEqual([['capture', 'cap-1'], ['export', 'exp-1'], ['capture', 'cap-2']]);
    for (const request of s.posted) expect(s.seam.answer({ id: request.id, answer: request.kind === 'capture' ? PNG : { ok: true, revision: 2, path: '/p/x.pdf' } })).toBe(true);
    expect(s.seam.answer({ id: s.posted[0]!.id, answer: PNG }), 'answered once').toBe(false);
    await flush();
    expect(s.engine.map((call) => [call.name, (call.input as { requestId: string }).requestId])).toEqual([['maws.artifact.captured', 'cap-1'], ['maws.artifact.exported', 'exp-1'], ['maws.artifact.captured', 'cap-2']]);
    expect(s.engine[0]!.input).toEqual({ appSessionId: 'app-1', requestId: 'cap-1', result: PNG });
    expect(s.logs).toContain('[render] starting the render host for artifact_screenshot (pid 1000)');
  });

  it('refuses an answer for an id it did not post, and one for a request still waiting for the host', () => {
    const s = scene();
    s.seam.capture(capture('cap-1'));
    expect(s.seam.answer({ id: 'capture-1', answer: PNG }), 'not handed over yet').toBe(false);
    expect(s.seam.answer({ id: 'nobody', answer: PNG })).toBe(false);
  });

  it('holds the daemon while a request is in its table, and releases it when the table empties', async () => {
    const s = scene();
    s.seam.capture(capture('cap-1'));
    s.seam.capture(capture('cap-2'));
    expect(s.holds).toEqual({ taken: 1, released: 0 });
    s.seam.clientReady();
    s.seam.answer({ id: s.posted[0]!.id, answer: PNG });
    expect(s.holds.released).toBe(0);
    s.seam.answer({ id: s.posted[1]!.id, answer: PNG });
    expect(s.holds).toEqual({ taken: 1, released: 1 });
  });

  it('ends the host after the quiet period with render.exit, SIGTERM after the grace, and a request after that starts it again', async () => {
    const s = scene();
    s.seam.capture(capture('cap-1'));
    s.seam.clientReady();
    s.seam.answer({ id: s.posted[0]!.id, answer: PNG });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(s.exits.count).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.exits.count).toBe(1);
    expect(s.seam.state()).toBe('ending');
    expect(s.logs).toContain('[render] quiet for 30 s: ending the render host');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(s.children[0]!.killed).toEqual(['SIGTERM']);
    s.children[0]!.exit(null, 'SIGTERM');
    expect(s.seam.state()).toBe('off');
    s.seam.capture(capture('cap-2'));
    expect(s.children).toHaveLength(2);
    expect(s.seam.status()).toMatchObject({ state: 'starting', pid: 1001, starts: 2, requests: 1 });
  });

  it('a request arriving while the host ends waits for its exit and starts a new one', async () => {
    const s = scene();
    s.seam.capture(capture('cap-1'));
    s.seam.clientReady();
    s.seam.answer({ id: s.posted[0]!.id, answer: PNG });
    await vi.advanceTimersByTimeAsync(30_000);
    s.seam.capture(capture('cap-2'));
    expect(s.children).toHaveLength(1);
    s.children[0]!.exit(0);
    expect(s.children).toHaveLength(2);
    expect(s.logs.some((line) => line.includes('unasked'))).toBe(false);
    s.seam.clientReady();
    expect(s.posted.map((request) => (request.request as { requestId: string }).requestId)).toEqual(['cap-1', 'cap-2']);
  });

  it('a start that fails twice answers every request with the reason, and tries again a window later', async () => {
    const s = scene();
    s.seam.capture(capture('cap-1'));
    s.children[0]!.line = '[render-host] failed: Error: no display';
    s.children[0]!.exit(70);
    expect(s.seam.state()).toBe('starting'); // waiting the backoff
    await vi.advanceTimersByTimeAsync(500);
    expect(s.children).toHaveLength(2);
    s.children[1]!.line = '[render-host] failed: Error: no display';
    s.children[1]!.exit(70);
    expect(s.seam.state()).toBe('unavailable');
    await flush();
    const reason = 'the render service could not start on mini: the render host failed: Error: no display';
    expect(s.engine).toEqual([{ name: 'maws.artifact.captured', input: { appSessionId: 'app-1', requestId: 'cap-1', result: { ok: false, error: reason } } }]);
    s.seam.capture(capture('cap-2'));
    await flush();
    expect(s.children, 'no spawn while unavailable').toHaveLength(2);
    expect(s.engine.at(-1)!.input).toMatchObject({ requestId: 'cap-2', result: { ok: false, error: reason } });
    await expect(s.seam.exportForLibrary({ artifactId: ARTIFACT, format: 'pdf' })).rejects.toMatchObject({ ipcError: { code: 'host_unavailable', message: reason } });
    expect(s.seam.capabilities().artifact_screenshot).toEqual({ available: false, reason: 'the render service is unavailable on mini: the render host failed: Error: no display' });
    await vi.advanceTimersByTimeAsync(60_000);
    s.seam.capture(capture('cap-3'));
    expect(s.children, 'tried again a window later').toHaveLength(3);
    expect(s.seam.state()).toBe('starting');
  });

  it('a spawn refused (a replaced bundle) is a failure with its reason', async () => {
    const s = scene();
    s.failSpawn.value = 'mawsd’s bundle was replaced';
    s.seam.capture(capture('cap-1'));
    await vi.advanceTimersByTimeAsync(500);
    expect(s.seam.state()).toBe('unavailable');
    await flush();
    expect(s.engine[0]!.input).toMatchObject({ result: { ok: false, error: 'the render service could not start on mini: mawsd’s bundle was replaced' } });
  });

  it('a runtime reported absent answers every request with its reason at once and never spawns', async () => {
    const s = scene();
    s.runtime.value = { available: false, reason: 'the render runtime 44.4.5 is not installed on mini: run mawsd render install' };
    s.seam.capture(capture('cap-1'));
    s.seam.export(exportOf('exp-1'));
    await flush();
    expect(s.children).toEqual([]);
    expect(s.engine.map((call) => call.input)).toEqual([
      { appSessionId: 'app-1', requestId: 'cap-1', result: { ok: false, error: 'the render runtime 44.4.5 is not installed on mini: run mawsd render install' } },
      { appSessionId: 'app-1', requestId: 'exp-1', answer: { ok: false, error: 'the render runtime 44.4.5 is not installed on mini: run mawsd render install' } },
    ]);
    expect(s.holds.taken).toBe(0);
    expect(s.seam.capabilities().artifact_export).toEqual({ available: false, reason: 'the render service is unavailable on mini: the render runtime 44.4.5 is not installed on mini: run mawsd render install' });
  });

  it('answers a request still waiting for the host at its start deadline, inside the bridge’s, and drops it', async () => {
    const s = scene({ startWatchdogMs: 120_000 }); // the deadline alone, before the watchdog's
    s.seam.capture(capture('cap-1'));
    s.seam.export(exportOf('exp-1'));
    await vi.advanceTimersByTimeAsync(40_000);
    expect(s.engine.map((call) => call.input)).toEqual([{ appSessionId: 'app-1', requestId: 'cap-1', result: { ok: false, error: 'the render service on mini did not start within 40 s' } }]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(s.engine).toHaveLength(2);
    expect(s.seam.status().requests).toBe(0);
    s.seam.clientReady();
    expect(s.posted, 'nothing left to hand over').toEqual([]);
  });

  it('ends a host that has not said ready at the start watchdog, keeps it until its exit, counts a failed start, and a second start serves what waits', async () => {
    const s = scene();
    s.seam.capture(capture('cap-1'));
    await vi.advanceTimersByTimeAsync(START_WATCHDOG_MS - 1);
    expect(s.children[0]!.killed).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.children[0]!.killed, 'the hung host is ended').toEqual(['SIGTERM']);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(s.children, 'no successor beside a live predecessor').toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.children[0]!.killed, 'SIGKILL when SIGTERM did not end it').toEqual(['SIGTERM', 'SIGKILL']);
    s.children[0]!.exit(null, 'SIGKILL');
    expect(s.logs).toContain('[render] the render service could not start on mini: the render host did not say ready within 30 s');
    await vi.advanceTimersByTimeAsync(500); // the backoff, from its exit
    expect(s.children).toHaveLength(2);
    s.seam.clientReady();
    expect(s.posted.map((request) => (request.request as { requestId: string }).requestId)).toEqual(['cap-1']);
    s.seam.answer({ id: s.posted[0]!.id, answer: PNG });
    await flush();
    expect(s.engine).toEqual([{ name: 'maws.artifact.captured', input: { appSessionId: 'app-1', requestId: 'cap-1', result: PNG } }]);
  });

  it('a timed-out host’s late ready and its departure are not taken: no work goes to it, and the successor after its exit is served', async () => {
    const s = scene();
    s.seam.capture(capture('cap-1'));
    await vi.advanceTimersByTimeAsync(START_WATCHDOG_MS);
    s.seam.clientReady(); // its connection's ready, after the watchdog
    expect(s.seam.state()).toBe('starting');
    expect(s.posted, 'nothing handed to the host being ended').toEqual([]);
    expect(s.logs).toContain('[render] a render client said ready after its host’s start watchdog: not taken (it is being ended)');
    s.seam.clientGone(); // and its connection's end
    s.children[0]!.exit(null, 'SIGTERM');
    await vi.advanceTimersByTimeAsync(500);
    expect(s.children).toHaveLength(2);
    s.seam.clientReady();
    expect(s.seam.state()).toBe('ready');
    expect(s.posted).toHaveLength(1);
    expect(s.children[1]!.killed, 'the successor is not ended by its predecessor’s departure').toEqual([]);
  });

  it('two hung starts make the seam unavailable, and what waits is answered with the reason', async () => {
    const s = scene();
    s.seam.export(exportOf('exp-1'));
    await vi.advanceTimersByTimeAsync(START_WATCHDOG_MS);
    s.children[0]!.exit(null, 'SIGTERM');
    await vi.advanceTimersByTimeAsync(500 + START_WATCHDOG_MS);
    s.children[1]!.exit(null, 'SIGTERM');
    expect(s.seam.state()).toBe('unavailable');
    await flush();
    expect(s.engine.map((call) => call.input)).toEqual([{ appSessionId: 'app-1', requestId: 'exp-1', answer: { ok: false, error: 'the render service could not start on mini: the render host did not say ready within 30 s' } }]);
  });

  it('stop while a timed-out host is being ended waits for its exit, SIGKILLs it at the grace, and starts nothing after', async () => {
    const s = scene();
    s.seam.capture(capture('cap-1'));
    await vi.advanceTimersByTimeAsync(START_WATCHDOG_MS);
    let done = false;
    const stopped = s.seam.stop().then(() => void (done = true));
    await flush();
    expect(done, 'the hung host is still the seam’s').toBe(false);
    expect(s.exits.count, 'a host that never said ready is not asked').toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(s.children[0]!.killed).toContain('SIGKILL');
    s.children[0]!.exit(null, 'SIGKILL');
    await stopped;
    expect(s.children).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.children, 'nothing starts after the stop').toHaveLength(1);
  });

  it('stop during the backoff after a timed-out host’s exit starts nothing', async () => {
    const s = scene();
    s.seam.capture(capture('cap-1'));
    await vi.advanceTimersByTimeAsync(START_WATCHDOG_MS);
    s.children[0]!.exit(null, 'SIGTERM');
    await s.seam.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.children).toHaveLength(1);
    expect(s.engine.at(-1)!.input).toMatchObject({ requestId: 'cap-1', result: { ok: false, error: 'the render service is restarting on mini' } });
  });

  it('a capture handed over just before its start deadline is answered with a sentence inside the bridge’s 45 s, and the host’s late answer is taken', async () => {
    const s = scene({ startWatchdogMs: 120_000 });
    s.seam.capture(capture('cap-1'));
    await vi.advanceTimersByTimeAsync(START_DEADLINE_MS.capture - 1_000);
    s.seam.clientReady();
    expect(s.posted).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(ANSWER_DEADLINE_MS.capture - (START_DEADLINE_MS.capture - 1_000) - 1);
    expect(s.engine).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.engine.map((call) => call.input)).toEqual([{ appSessionId: 'app-1', requestId: 'cap-1', result: { ok: false, error: 'the render service on mini did not finish the capture within 43 s' } }]);
    expect(s.seam.status().requests).toBe(0);
    expect(s.seam.answer({ id: s.posted[0]!.id, answer: PNG }), 'the late answer is taken, not refused').toBe(true);
    await flush();
    expect(s.engine, 'answered once').toHaveLength(1);
  });

  it('an export rendering past the bridge’s remaining time is answered with a sentence at 58 s, and a late inspection file is removed', async () => {
    const s = scene();
    s.seam.export(exportOf('exp-1', { inspection: true }));
    s.seam.clientReady();
    await vi.advanceTimersByTimeAsync(ANSWER_DEADLINE_MS.export - 1);
    expect(s.engine).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.engine.map((call) => call.input)).toEqual([{ appSessionId: 'app-1', requestId: 'exp-1', answer: { ok: false, error: 'the render service on mini did not finish the export within 58 s' } }]);
    expect(s.seam.answer({ id: s.posted[0]!.id, answer: { ok: true, revision: 2, path: '/p/inspect-late.png' } })).toBe(true);
    await flush();
    expect(s.removed).toEqual(['/p/inspect-late.png']);
  });

  it('the library’s Export has its own longer allowance: the start’s and the library’s export budget', async () => {
    const s = scene({ startWatchdogMs: 120_000 });
    const asked = s.seam.exportForLibrary({ artifactId: ARTIFACT, format: 'pdf' }).catch((thrown: unknown) => thrown);
    await vi.advanceTimersByTimeAsync(START_DEADLINE_MS.libraryExport - 1_000);
    s.seam.clientReady();
    await vi.advanceTimersByTimeAsync(ANSWER_DEADLINE_MS.libraryExport - (START_DEADLINE_MS.libraryExport - 1_000) - 1);
    expect(s.seam.status().requests).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(((await asked) as HostCommandError).ipcError).toMatchObject({ code: 'host_unavailable', message: 'the render service on mini did not finish the export within 110 s' });
  });

  it('a stop’s refusal leaves no inspection file behind: the host’s late successful answer during its exit is taken and its file removed', async () => {
    const s = scene();
    s.seam.export(exportOf('exp-1', { inspection: true }));
    s.seam.clientReady();
    const stopped = s.seam.stop();
    await flush();
    expect(s.engine.map((call) => call.input)).toEqual([{ appSessionId: 'app-1', requestId: 'exp-1', answer: { ok: false, error: 'the render service is restarting on mini' } }]);
    expect(s.seam.answer({ id: s.posted[0]!.id, answer: { ok: true, revision: 2, path: '/p/inspect-stop.png' } }), 'taken during the graceful exit').toBe(true);
    s.children[0]!.exit(0);
    await stopped;
    expect(s.removed).toEqual(['/p/inspect-stop.png']);
    expect(s.seam.answer({ id: s.posted[0]!.id, answer: { ok: true, revision: 2, path: '/p/x.png' } }), 'forgotten once the host exited').toBe(false);
  });

  it('stop with no host left still waits for an inspection file’s removal in flight (bounded)', async () => {
    let finish!: () => void;
    const removing: string[] = [];
    const s = scene({ removeFile: (path) => (removing.push(path), new Promise<void>((resolve) => (finish = resolve))) });
    s.outcome.value = 'not_pending';
    s.seam.export(exportOf('exp-1', { inspection: true }));
    s.seam.clientReady();
    s.seam.answer({ id: s.posted[0]!.id, answer: { ok: true, revision: 2, path: '/p/inspect-1.png' } });
    await flush();
    expect(removing).toEqual(['/p/inspect-1.png']);
    s.children[0]!.exit(70); // no host left
    let done = false;
    const stopped = s.seam.stop().then(() => void (done = true));
    await flush();
    expect(done, 'the removal is awaited').toBe(false);
    finish();
    await stopped;
    expect(done).toBe(true);
  });

  it('logs a file it could not remove', async () => {
    const s = scene({ removeFile: async () => Promise.reject(new Error('EACCES: permission denied')) });
    s.outcome.value = 'not_pending';
    s.seam.export(exportOf('exp-1', { inspection: true }));
    s.seam.clientReady();
    s.seam.answer({ id: s.posted[0]!.id, answer: { ok: true, revision: 2, path: '/p/inspect-1.png' } });
    await flush();
    expect(s.logs).toContain('[render] could not remove /p/inspect-1.png: EACCES: permission denied');
  });

  it('a host that ends unasked answers what it held, counts a failure, and starts again after the backoff for what waits', async () => {
    const s = scene();
    s.seam.capture(capture('cap-1'));
    s.seam.clientReady();
    s.seam.clientGone();
    s.seam.capture(capture('cap-2')); // waits: nothing is handed over while the host goes
    s.children[0]!.exit(70);
    await flush();
    expect(s.engine[0]!.input).toMatchObject({ requestId: 'cap-1', result: { ok: false, error: 'the render service ended on mini' } });
    expect(s.logs.some((line) => line.includes('ended unasked'))).toBe(true);
    expect(s.children).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(s.children).toHaveLength(2);
    s.seam.clientReady();
    expect(s.posted.at(-1)!.request).toMatchObject({ requestId: 'cap-2' });
  });

  it('a render host whose connection ended and that does not exit is sent SIGTERM after the grace', async () => {
    const s = scene();
    s.seam.capture(capture('cap-1'));
    s.seam.clientReady();
    s.seam.clientGone();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(s.children[0]!.killed).toEqual(['SIGTERM']);
  });

  it('removes an inspection export’s file when its answer is not delivered, and keeps it when it is', async () => {
    const s = scene();
    s.outcome.value = 'not_pending';
    s.seam.export(exportOf('exp-1', { inspection: true }));
    s.seam.clientReady();
    s.seam.answer({ id: s.posted[0]!.id, answer: { ok: true, revision: 2, path: '/p/inspect-1.png' } });
    await flush();
    expect(s.removed).toEqual(['/p/inspect-1.png']);
    s.outcome.value = 'delivered';
    s.seam.export(exportOf('exp-2', { inspection: true }));
    s.seam.answer({ id: s.posted[1]!.id, answer: { ok: true, revision: 2, path: '/p/inspect-2.png' } });
    s.outcome.value = null; // the link closed
    s.seam.export(exportOf('exp-3', { inspection: true }));
    s.seam.answer({ id: s.posted[2]!.id, answer: { ok: true, revision: 2, path: '/p/inspect-3.png' } });
    await flush();
    expect(s.removed).toEqual(['/p/inspect-1.png', '/p/inspect-3.png']);
  });

  it('answers the bridges in their own shape: a render host’s failure without its ipcError', async () => {
    const s = scene();
    s.seam.capture(capture('cap-1'));
    s.seam.export(exportOf('exp-1'));
    s.seam.clientReady();
    s.seam.answer({ id: s.posted[0]!.id, answer: { ok: false, error: 'boom', ipcError: { code: 'internal', message: 'boom' } } });
    s.seam.answer({ id: s.posted[1]!.id, answer: { ok: false, error: 'boom', ipcError: { code: 'internal', message: 'boom' } } });
    await flush();
    expect(s.engine.map((call) => call.input)).toEqual([
      { appSessionId: 'app-1', requestId: 'cap-1', result: { ok: false, error: 'boom' } },
      { appSessionId: 'app-1', requestId: 'exp-1', answer: { ok: false, error: 'boom' } },
    ]);
  });

  it('the library’s Export answers the command’s output, or rejects with the render host’s IPC error, and carries the authors and the dialect', async () => {
    const authors = { human: 'Kim Min', sessions: { 'app-1': 'Review agent' } };
    const s = scene({ authors: () => authors });
    const done = s.seam.exportForLibrary({ artifactId: ARTIFACT, format: 'md', dialect: 'notion' });
    const refused = s.seam.exportForLibrary({ artifactId: ARTIFACT, format: 'docx' });
    s.seam.clientReady();
    expect(s.posted.map((request) => request)).toEqual([
      { id: expect.any(String), kind: 'libraryExport', request: { artifactId: ARTIFACT, format: 'md', dialect: 'notion' }, authors },
      { id: expect.any(String), kind: 'libraryExport', request: { artifactId: ARTIFACT, format: 'docx' }, authors },
    ]);
    const output = { path: '/p/x.md', revision: 3, exportId: '3f1c3c5e-6b9a-4e3e-8f43-6f6a4b6c7d8e' };
    s.seam.answer({ id: s.posted[0]!.id, answer: output });
    const ipc = { code: 'invalid_input', message: 'MAWS cannot export a html artifact as docx yet', issues: { reason: 'exportUnavailable', data: { kind: 'html', format: 'docx' } } };
    s.seam.answer({ id: s.posted[1]!.id, answer: { ok: false, error: ipc.message, ipcError: ipc } });
    await expect(done).resolves.toEqual(output);
    const error = await refused.catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(HostCommandError);
    expect((error as HostCommandError).ipcError).toEqual(ipc);
  });

  it('an export waits for authors resolved on demand before it is handed over, the host starting meanwhile; a failed resolution sends none', async () => {
    let resolve!: (authors: { sessions: Record<string, string> }) => void;
    const s = scene({ authors: () => new Promise((done) => (resolve = done)) });
    s.seam.export(exportOf('exp-1'));
    s.seam.capture(capture('cap-1'));
    expect(s.children, 'the host starts while the authors resolve').toHaveLength(1);
    s.seam.clientReady();
    expect(s.posted.map((request) => request.kind), 'the capture goes ahead; the export waits').toEqual(['capture']);
    resolve({ sessions: { 'app-1': 'Review agent' } });
    await flush();
    expect(s.posted.at(-1)).toMatchObject({ kind: 'export', authors: { sessions: { 'app-1': 'Review agent' } } });

    const failing = scene({ authors: () => Promise.reject(new Error('the spine is refused')) });
    failing.seam.export(exportOf('exp-2'));
    failing.seam.clientReady();
    await flush();
    expect(failing.posted).toHaveLength(1);
    expect(failing.posted[0]).not.toHaveProperty('authors');
    expect(failing.logs).toContain("[render] the export's comment authors could not be resolved: the spine is refused");
  });

  it('a bridge export carries the authors too; a capture none', () => {
    const authors = { human: 'Kim Min' };
    const s = scene({ authors: () => authors });
    s.seam.capture(capture('cap-1'));
    s.seam.export(exportOf('exp-1'));
    s.seam.clientReady();
    expect(s.posted[0]).not.toHaveProperty('authors');
    expect(s.posted[1]).toMatchObject({ kind: 'export', authors });
  });

  it('stop closes admission, answers every request in the table over the live link, then ends the host (render.exit, SIGTERM after the grace)', async () => {
    const s = scene();
    s.seam.capture(capture('cap-1'));
    s.seam.clientReady();
    s.seam.capture(capture('cap-2'));
    const library = s.seam.exportForLibrary({ artifactId: ARTIFACT, format: 'pdf' }).catch((thrown: unknown) => thrown);
    const stopped = s.seam.stop();
    await flush();
    expect(s.engine.map((call) => call.input)).toEqual([
      { appSessionId: 'app-1', requestId: 'cap-1', result: { ok: false, error: 'the render service is restarting on mini' } },
      { appSessionId: 'app-1', requestId: 'cap-2', result: { ok: false, error: 'the render service is restarting on mini' } },
    ]);
    expect(((await library) as HostCommandError).ipcError).toMatchObject({ code: 'host_unavailable', message: 'the render service is restarting on mini' });
    expect(s.exits.count).toBe(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(s.children[0]!.killed).toEqual(['SIGTERM']);
    s.children[0]!.exit(null, 'SIGTERM');
    await stopped;
    expect(s.seam.state()).toBe('off');
    s.seam.capture(capture('cap-3'));
    await flush();
    expect(s.children, 'admission closed').toHaveLength(1);
    expect(s.engine.at(-1)!.input).toMatchObject({ requestId: 'cap-3', result: { ok: false, error: 'the render service is restarting on mini' } });
  });

  it('stop with no host ends at once', async () => {
    const s = scene();
    await s.seam.stop();
    expect(s.exits.count).toBe(0);
  });

  it('the render entries of a session’s capabilities: an older engine host with no app reads unavailable with why', () => {
    const s = scene();
    expect(s.seam.capabilities()).toEqual({ artifact_screenshot: { available: true }, artifact_export: { available: true } });
    s.renders.engineHost = false;
    expect(s.seam.capabilities().artifact_screenshot).toEqual({ available: false, reason: 'the engine host on mini predates the render service; it is replaced when idle' });
    s.renders.app = true; // its events reach the seam while an app is attached
    expect(s.seam.capabilities().artifact_screenshot).toEqual({ available: true });
  });
});

// PR #428's panel (scalpel-3): a Linux render host's process group under fake time, through spawnRenderHost's injected
// spawn and signal. The wrapper (xvfb-run's shell) exits at the group's SIGTERM; one member ignores it and dies only at
// SIGKILL. `zombies` keeps the group answering `kill(-pgid, 0)` after the SIGKILL, as orphans no subreaper reaps do.
describe('the render host’s process group (Linux) under the seam', () => {
  const WRAPPER = 4242;
  class FakeWrapper extends EventEmitter {
    readonly pid = WRAPPER;
    readonly stdout = null;
    readonly stderr = null;
  }
  const esrch = () => Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
  const groupScene = ({ zombies = false } = {}) => {
    const events: string[] = [];
    const logs: string[] = [];
    const wrappers: FakeWrapper[] = [];
    const group = { members: 0, killed: false };
    const signal = (pid: number, sent: NodeJS.Signals | 0) => {
      expect(pid, 'every signal addresses the group').toBe(-WRAPPER);
      if (sent === 0) {
        if (group.members === 0 && !(zombies && group.killed)) throw esrch();
        return;
      }
      if (group.members === 0) throw esrch();
      events.push(sent);
      if (sent === 'SIGKILL') {
        group.members = 0;
        group.killed = true;
      } else if (sent === 'SIGTERM' && group.members === 2) {
        group.members = 1; // the wrapper goes; the member that ignores TERM stays
        const wrapper = wrappers.at(-1)!;
        queueMicrotask(() => wrapper.emit('exit', null, 'SIGTERM'));
      }
    };
    const spawn = () => {
      const wrapper = new FakeWrapper();
      wrappers.push(wrapper);
      group.members = 2;
      group.killed = false;
      return wrapper as unknown as ChildProcess;
    };
    const command = { command: '/usr/bin/xvfb-run', args: [], env: {}, cwd: '/p', group: true };
    const seam = createRenderSeam({
      machine: 'linux-box',
      spawn: () => {
        const child = spawnRenderHost(command, (line) => void logs.push(line), { spawn, signal });
        child.onExit((code, sig) => void events.push(`exit ${code ?? sig}`));
        return child;
      },
      post: () => true,
      postExit: () => true,
      answerEngine: async () => 'delivered',
      quietMs: () => 30_000,
      runtime: () => ({ available: true }),
      engineHostRenders: () => true,
      appAttached: () => false,
      hold: () => () => undefined,
      log: (line) => void logs.push(line),
      restartBackoffMs: [500, 2_000, 5_000],
    });
    return { seam, events, logs, wrappers, group };
  };

  it('stop with a member that ignores SIGTERM resolves only after the SIGKILL and the host’s exit', async () => {
    const g = groupScene();
    g.seam.capture(capture('cap-1'));
    g.seam.clientReady();
    let done = false;
    const stopped = g.seam.stop().then(() => void (done = true));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(g.events, 'the group is sent SIGTERM at the grace; its wrapper exits, the rest is sent SIGTERM again').toEqual(['SIGTERM', 'SIGTERM']);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(done, 'the TERM-ignoring member is still there').toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    await stopped;
    expect(g.events, 'SIGKILL, then the exit, before stop returns').toEqual(['SIGTERM', 'SIGTERM', 'SIGKILL', 'exit SIGTERM']);
    expect(g.group.members).toBe(0);
    expect(g.seam.state()).toBe('off');
  });

  it('a group left with zombies after its SIGKILL still reports its exit within a bounded settle, and a replacement starts', async () => {
    const g = groupScene({ zombies: true });
    g.seam.capture(capture('cap-1'));
    expect(g.wrappers).toHaveLength(1);
    g.group.members = 1;
    g.wrappers[0]!.emit('exit', 70, null); // the wrapper exits before its ready, a member left behind
    await vi.advanceTimersByTimeAsync(5_000);
    expect(g.events).toEqual(['SIGTERM', 'SIGKILL']);
    await vi.advanceTimersByTimeAsync(KILL_SETTLE_MS);
    expect(g.events.at(-1), 'the exit is reported though the group still answers').toBe('exit 70');
    expect(g.logs).toContain(`[render] the render host's process group still answered ${KILL_SETTLE_MS / 1000} s after SIGKILL (members nobody reaped): its exit reported`);
    await vi.advanceTimersByTimeAsync(500); // the failed start's backoff
    expect(g.wrappers, 'a replacement host started').toHaveLength(2);
  });
});

describe('the e2e capture (daemon.e2eRender)', () => {
  it('goes through the seam as a bridge capture does, and returns the answer instead of sending it to the engine host', async () => {
    const s = scene();
    const answered = s.seam.captureForE2e(capture('e2e-1'));
    expect(s.children).toHaveLength(1);
    s.seam.clientReady();
    expect(s.posted.map((request) => request.kind)).toEqual(['capture']);
    s.seam.answer({ id: s.posted[0]!.id, answer: PNG });
    await expect(answered).resolves.toEqual(PNG);
    expect(s.engine).toEqual([]);
  });
});

describe('the Word comment authors sent with each export (renderAuthors)', () => {
  let dir: string;
  beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'maws-render-authors-'))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const sessions = [
    { appId: 'app-1', title: { text: 'Quarterly review' } },
    { appId: 'app-2', title: { text: '   ' } },
  ];

  it('names the saved export name and each titled session, as the embedded root resolves them', () => {
    const path = join(dir, 'settings.json');
    writeFileSync(path, JSON.stringify({ version: 1, artifacts: { exportAuthorName: '  K. Min  ' } }));
    expect(renderAuthors(path, sessions)).toEqual({ human: 'K. Min', sessions: { 'app-1': 'Quarterly review' } });
  });

  it('sends nothing for a profile with no saved name and no spine loaded, and no human for an unreadable file', () => {
    expect(renderAuthors(join(dir, 'missing.json'), null)).toBeUndefined();
    const path = join(dir, 'settings.json');
    writeFileSync(path, '{not json');
    expect(renderAuthors(path, sessions)).toEqual({ sessions: { 'app-1': 'Quarterly review' } });
  });
});

// main's machine host waits this long for the library's Export (and the e2e's capture) on the daemon shape
describe('the render commands’ budgets (src/services/command-budgets.ts)', () => {
  it('cover the render host’s start and the export after it, whose library budget is inside the bridge’s EXPORT_ANSWER_MS', () => {
    expect(COMMAND_BUDGETS_MS['artifacts.export']).toBeGreaterThan(START_DEADLINE_MS.libraryExport + EXPORT_ANSWER_MS);
    expect(COMMAND_BUDGETS_MS['daemon.e2eRender']).toBeGreaterThan(START_DEADLINE_MS.capture + CAPTURE_ANSWER_MS);
  });

  it('the seam answers a session’s tool inside its bridge, and the library’s Export inside its command budget', () => {
    expect(ANSWER_DEADLINE_MS.capture).toBeLessThan(CAPTURE_ANSWER_MS);
    expect(ANSWER_DEADLINE_MS.export).toBeLessThan(EXPORT_ANSWER_MS);
    expect(START_DEADLINE_MS.capture).toBeLessThan(ANSWER_DEADLINE_MS.capture);
    expect(START_DEADLINE_MS.export).toBeLessThan(ANSWER_DEADLINE_MS.export);
    expect(ANSWER_DEADLINE_MS.libraryExport, 'the start’s, then the render library’s own budget').toBe(START_DEADLINE_MS.libraryExport + EXPORT_BUDGET_MS);
    expect(COMMAND_BUDGETS_MS['artifacts.export']).toBeGreaterThan(ANSWER_DEADLINE_MS.libraryExport);
    expect(START_WATCHDOG_MS).toBeLessThan(Math.min(...Object.values(START_DEADLINE_MS)));
  });
});

describe('the render host’s exit before its ready (exitReason)', () => {
  it('reads the render host’s exit codes and its own line', () => {
    expect(exitReason(70, null, '[render-host] failed: Error: no display')).toBe('the render host failed: Error: no display');
    expect(exitReason(1, null, '[render-host] cannot start: no mawsd serves /p')).toBe('the render host could not reach mawsd: no mawsd serves /p');
    expect(exitReason(2, null, null)).toBe('the render host was started without a profile');
    expect(exitReason(null, 'SIGKILL', null)).toBe('the render host was ended by SIGKILL');
    expect(exitReason(0, null, null)).toBe('the render host exited before it was ready');
    // P5 O5 M6: 3 is the render host's refusal to run without Chromium's sandbox (src/render-host/host.ts)
    expect(exitReason(3, null, '[render-host] cannot start: --no-sandbox was passed')).toBe('the render host refused to run without Chromium’s sandbox: --no-sandbox was passed');
  });
});

describe('the render host’s command line on a Mac (Interfaces §E)', () => {
  const env = { ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--inspect', MAWS_E2E: '1', PATH: '/usr/bin' };
  it('packaged: the app’s binary with no script argument; a checkout: its Electron with the app root; never as Node', () => {
    const packaged = renderCommand({ platform: 'darwin', packaged: true, execPath: '/Applications/MAWS.app/Contents/MacOS/MAWS', appRoot: '/x/app.asar', profile: '/p', env });
    expect(packaged).toEqual({ command: '/Applications/MAWS.app/Contents/MacOS/MAWS', args: ['--render-host', '/p'], env: { MAWS_E2E: '1', PATH: '/usr/bin', MAWS_USER_DATA: '/p' }, cwd: '/p', argv0: 'maws-render-host' });
    const checkout = renderCommand({ platform: 'darwin', packaged: false, execPath: '/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', appRoot: '/repo', profile: '/p', env });
    expect(checkout.args).toEqual(['/repo', '--render-host', '/p']);
    expect(checkout.env).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
  });

  it('refuses on a platform with no render runtime, and on Linux without the cache’s Electron', () => {
    expect(() => renderCommand({ platform: 'win32', packaged: false, execPath: '/node', appRoot: '/repo', profile: '/p', env })).toThrow(/not installed/);
    expect(() => renderCommand({ platform: 'linux', packaged: false, execPath: '/node', appRoot: '/repo', profile: '/p', env })).toThrow(/not installed/);
  });
});

// P5 O5 M6 (Interfaces §E, FINDINGS §1.2, §1.3): on Linux the release's entry under the render cache's Electron, inside a
// virtual display of its own, Chromium compositing in software, never without its sandbox; in a process group of its
// own, which every kill addresses whole (a SIGTERM to xvfb-run's shell does not reliably reach Electron)
describe('the render host’s command line on Linux (Interfaces §E)', () => {
  const env = { ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--max-old-space-size=64', PATH: '/usr/bin:/bin', MAWS_USER_DATA: '/old' };
  const linux = { electron: '/home/u/.local/share/maws/mawsd/render/44.4.5-04586a0ec46c/electron', xvfbRun: '/usr/bin/xvfb-run' };
  beforeEach(() => vi.useRealTimers()); // real processes, real waits

  it('runs the release’s out/main/index.js under the cache’s Electron in xvfb-run, --headless and --hide-scrollbars, never --no-sandbox, as a group', () => {
    const command = renderCommand({ platform: 'linux', packaged: false, execPath: '/release/runtime/bin/node', appRoot: '/release', profile: '/home/u/.config/MAWS', env, linux });
    expect(command).toEqual({
      command: '/usr/bin/xvfb-run',
      args: ['-a', '-s', '-screen 0 1280x800x24 -nolisten tcp', linux.electron, '--headless', '--hide-scrollbars', '/release/out/main/index.js', '--render-host', '/home/u/.config/MAWS'],
      env: { PATH: '/usr/bin:/bin', MAWS_USER_DATA: '/home/u/.config/MAWS' },
      cwd: '/home/u/.config/MAWS',
      group: true,
    });
    expect(command.args).not.toContain('--no-sandbox');
  });

  it('kills the whole group: Electron, its helpers and the Xvfb beside it', async () => {
    const at = mkdtempSync(join(tmpdir(), 'maws-render-group-'));
    try {
      // a shell standing in for xvfb-run: a child of its own (the display) beside the command it runs, which ignores TERM
      // the way a shell waiting on its child does not pass it on
      const script = join(at, 'xvfb-run');
      writeFileSync(script, `#!/bin/sh\nsleep 60 &\necho $! > ${join(at, 'display.pid')}\n"$@"\n`, { mode: 0o755 });
      const lines: string[] = [];
      const child = spawnRenderHost({ command: script, args: ['sh', '-c', 'echo "[render-host] ready: stand-in"; exec sleep 60'], env: { PATH: process.env.PATH }, cwd: at, group: true }, (line) => lines.push(line));
      await until(() => existsSync(join(at, 'display.pid')) && lines.length > 0, 5_000, 'the stand-in started');
      const display = Number(readFileSync(join(at, 'display.pid'), 'utf8'));
      const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => child.onExit((code, signal) => resolve({ code, signal })));
      child.kill('SIGTERM');
      await exited;
      await until(() => !isAlive(display), 5_000, 'the display ended with the group');
      expect(lines).toContain('[render-host] ready: stand-in');
    } finally {
      rmSync(at, { recursive: true, force: true });
    }
  });

  // Fix wave 1: the wrapper's exit is not the group's. A member that ignores SIGTERM (the stand-in's `trap '' TERM`)
  // outlives the wrapper; the exit is reported only once it is gone, SIGKILLed at the grace, so the seam's escalation and
  // its successor never run beside a survivor
  const survivorScene = (at: string, command: string[]) => {
    const script = join(at, 'xvfb-run');
    writeFileSync(script, `#!/bin/sh\n(trap '' TERM; exec sleep 60) &\necho $! > ${join(at, 'member.pid')}\n"$@"\n`, { mode: 0o755 });
    const lines: string[] = [];
    const child = spawnRenderHost({ command: script, args: command, env: { PATH: process.env.PATH }, cwd: at, group: true }, (line) => lines.push(line), { groupGraceMs: 300 });
    const exit = new Promise<{ memberAliveAtExit: boolean; at: number }>((resolve) => child.onExit(() => resolve({ memberAliveAtExit: isAlive(Number(readFileSync(join(at, 'member.pid'), 'utf8'))), at: Date.now() })));
    return { child, lines, exit, member: () => Number(readFileSync(join(at, 'member.pid'), 'utf8')) };
  };

  it('a group member ignoring SIGTERM: the kill’s exit is reported only after it is SIGKILLed at the grace', async () => {
    const at = mkdtempSync(join(tmpdir(), 'maws-render-survivor-'));
    try {
      const scene = survivorScene(at, ['sh', '-c', 'echo "[render-host] ready: stand-in"; exec sleep 60']);
      await until(() => existsSync(join(at, 'member.pid')) && scene.lines.length > 0, 5_000, 'the stand-in started');
      const member = scene.member();
      const killedAt = Date.now();
      scene.child.kill('SIGTERM');
      const exited = await scene.exit;
      expect(exited.memberAliveAtExit, 'no member of the group is left when the exit is reported').toBe(false);
      expect(exited.at - killedAt).toBeGreaterThanOrEqual(300);
      expect(isAlive(member)).toBe(false);
      expect(scene.lines).toContain("[render] the render host's process group outlived its wrapper by 0.3 s: SIGKILL");
    } finally {
      rmSync(at, { recursive: true, force: true });
    }
  });

  it('a wrapper that exits by itself leaving a member: the group is retired before its exit is reported', async () => {
    const at = mkdtempSync(join(tmpdir(), 'maws-render-survivor-'));
    try {
      const scene = survivorScene(at, ['sh', '-c', 'echo "[render-host] ready: stand-in"; exit 0']);
      const exited = await scene.exit;
      expect(exited.memberAliveAtExit).toBe(false);
      expect(isAlive(scene.member())).toBe(false);
    } finally {
      rmSync(at, { recursive: true, force: true });
    }
  });
});
