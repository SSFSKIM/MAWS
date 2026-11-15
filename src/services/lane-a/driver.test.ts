// The local lane A driver against the fake bridge (P5 O9 M2, "Proves"): discovery, the bridge's states, the state stream
// and its backoff, watches, each control's body, the delivery lane, decisions, and the guard on the owner's sminos. UX
// wave U8d M2: a watched session's subagents, and what they cost, counted (reads, derivations, messages, log lines).
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentId, AppSessionId } from '@shared/graph/ids';
import type { ClientRef } from '@shared/ipc/client';
import { endableClientRef } from '@shared/ipc/client';
import type { SubagentEntry } from '@shared/ipc/schema/fs';
import type { LaneAState, PlaneMessage } from '@shared/ipc/schema/lane-a';
import type { LaneAAgent } from '@shared/lane-a/agents';
import { FULL_CAPABILITIES, startFakeBridge, type FakeBridge, type FakeReply } from '../../../test/support/fake-bridge';
import { GitFixture } from '../../../test/support/git-fixture';
import { createLaneADriver, registerLaneA, type LaneADeps, type LaneADriver, type LaneAView } from './driver';
import { Ledger } from './jobs';

// What the driver costs, as the tests count it: each derivation, and one timeline of every transcript read (by the path
// it read) and every plane payload, in the order they happened. A test can hold the first read of a path once it has
// read the file (`holds`), so that the read stays out.
const counts = vi.hoisted(() => ({ derivations: 0, timeline: [] as string[], holds: new Map<string, Promise<void>>() }));
vi.mock('./jobs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./jobs')>();
  return {
    ...actual,
    derive: (...args: Parameters<typeof actual.derive>) => {
      counts.derivations += 1;
      return actual.derive(...args);
    },
  };
});
vi.mock('./transcript-jobs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./transcript-jobs')>();
  class Counted extends actual.TranscriptJobs {
    private readonly located: { path: string | null };
    constructor(locate: () => Promise<string | null>) {
      const located = { path: null as string | null }; // the path the last read located
      // one locate per read
      super(() =>
        locate().then((path) => {
          counts.timeline.push(`read ${String(path)}`);
          located.path = path;
          return path;
        }),
      );
      this.located = located;
    }
    override read(): Promise<void> {
      return super.read().then(async () => {
        const { path } = this.located;
        const hold = path === null ? undefined : counts.holds.get(path);
        if (hold === undefined) return;
        counts.holds.delete(path!);
        counts.timeline.push(`held ${path}`);
        await hold;
      });
    }
  }
  return { ...actual, TranscriptJobs: Counted };
});

const MACHINE = 'machineref0123456789';
const APP = 'app-1' as AppSessionId;
const ENGINE = 'e5b1c0de-0000-4000-8000-000000000001';
const terminal = { kind: 'terminal' as const, pid: 4242 };

const scratch: string[] = [];
const bridges: FakeBridge[] = [];
const drivers: LaneADriver[] = [];
const tmp = (prefix: string) => {
  const d = mkdtempSync(join('/tmp', prefix)); // short: the socket path must stay under 104 bytes
  scratch.push(d);
  return d;
};

beforeEach(() => {
  counts.derivations = 0;
  counts.timeline.length = 0;
  counts.holds.clear();
  vi.stubEnv('SMINOS_HOME', tmp('o9s-'));
  vi.stubEnv('HOME', tmp('o9h-'));
  vi.stubEnv('CLAUDE_CONFIG_DIR', tmp('o9c-'));
  vi.stubEnv('MAWS_USER_DATA', tmp('o9u-'));
});
afterEach(async () => {
  for (const d of drivers.splice(0)) d.stop();
  for (const b of bridges.splice(0)) await b.close().catch(() => {});
  vi.unstubAllEnvs();
  for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true });
});

type Changed = { appSessionId: string; state: LaneAState | null };
type Plane = { appSessionId: string; watch: string; messages?: PlaneMessage[]; reset?: true; ended?: string };

function harness(home = process.env.SMINOS_HOME!, timing: Record<string, unknown> = {}, transcript: string | null = null, more: Partial<LaneADeps> = {}) {
  const changes: Changed[] = [];
  const planes: Plane[] = [];
  const logs: string[] = [];
  const driver = createLaneADriver({
    machine: MACHINE,
    home,
    userData: process.env.MAWS_USER_DATA!,
    emit: (name, payload) => {
      if (name === 'laneA.changed') return void changes.push(payload as Changed);
      const plane = payload as Plane;
      counts.timeline.push(`plane ${plane.watch} ${(plane.messages ?? []).map((m) => m.kind).join(',')}`);
      planes.push(plane);
    },
    log: (line) => void logs.push(line),
    transcript: async (appId, engine) => (appId === APP && engine === ENGINE ? transcript : null),
    ...more,
    timing: {
      jobsPollMs: 30,
      probeMs: 500, commandWaitMs: 400, requestMs: 500, decisionMs: 500, dirPollMs: 50,
      backoff: { firstMs: 30, maxMs: 120, healthyMs: 60_000 },
      lane: { retryDelaysMs: [20, 40], answerMs: 600, keepMs: 2000, capacity: 8 },
      ...timing,
    },
  });
  drivers.push(driver);
  const state = () => driver.state(APP);
  const live = async () => expect.poll(() => state()?.bridge, { timeout: 3000 }).toBe('live');
  return { driver, changes, planes, logs, state, live, home };
}

async function bridge(options: Partial<Parameters<typeof startFakeBridge>[0]> = {}) {
  const b = await startFakeBridge({ home: process.env.SMINOS_HOME!, session: ENGINE, ...options });
  bridges.push(b);
  return b;
}

const client = (): ClientRef & { end(): void } => endableClientRef(`client-${Math.random()}`);
const messagesOf = (planes: Plane[], watch: string) => planes.filter((p) => p.watch === watch).flatMap((p) => p.messages ?? []);
const readsOf = (path: string, from = 0) => counts.timeline.slice(from).filter((t) => t === `read ${path}`).length;
// Waits until `path` has been read `more` times past now (the driver's ticks go on while a test waits on them).
const readsPast = async (path: string, more: number) => {
  const target = readsOf(path) + more;
  await expect.poll(() => readsOf(path), { timeout: 5000 }).toBeGreaterThanOrEqual(target);
};

describe('discovery', () => {
  it('finds a bridge when the session’s holder becomes a terminal, and keeps its state', async () => {
    const b = await bridge();
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    expect(h.state()).toMatchObject({ appSessionId: APP, engineSessionId: ENGINE, bridge: 'live', reason: null, launch: 'launch-1', sminos: '1.25.0', ops: FULL_CAPABILITIES.ops, controls: FULL_CAPABILITIES.controls });
    expect(h.driver.list()).toHaveLength(1);
    await expect.poll(() => b.subscribers()).toBe(1); // its state stream
  });

  it('finds a bridge whose socket appears after the holder did', async () => {
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await new Promise((r) => setTimeout(r, 100));
    expect(h.state()).toBeNull();
    await bridge();
    await h.live();
  });

  it('leaves a session with no socket, a stale socket, another session’s socket or a path too long without state', async () => {
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    // a stale socket: a file nobody listens on
    mkdirSync(join(process.env.SMINOS_HOME!, 'bridge'), { recursive: true });
    const stale = createServer();
    const path = join(process.env.SMINOS_HOME!, 'bridge', `${ENGINE}.sock`);
    await new Promise<void>((r) => stale.listen(path, () => r()));
    stale.close(); // the file may stay, refusing connections
    writeFileSync(join(process.env.SMINOS_HOME!, 'bridge', `${ENGINE}.json`), '{}'); // a kept file is never probed
    await new Promise((r) => setTimeout(r, 200));
    expect(h.state()).toBeNull();
    rmSync(path, { force: true });
    const other = await startFakeBridge({ home: process.env.SMINOS_HOME!, session: 'another-session' });
    bridges.push(other);
    rmSync(path, { force: true });
    await new Promise((r) => setTimeout(r, 100));
    expect(h.state()).toBeNull();

    const long = tmp(`o9-${'x'.repeat(60)}-`);
    const far = harness(long);
    far.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await new Promise((r) => setTimeout(r, 100));
    expect(far.state()).toBeNull();
  });

  it('is off when the sminos home is refused', async () => {
    await bridge();
    const off = createLaneADriver({ machine: MACHINE, home: Promise.reject(new Error('real home')), userData: process.env.MAWS_USER_DATA!, emit: () => {}, log: () => {} });
    drivers.push(off);
    off.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await new Promise((r) => setTimeout(r, 200));
    expect(off.state(APP)).toBeNull();
    expect(off.list()).toEqual([]);
  });

  it('drops the session, its stream and its state when its holder leaves', async () => {
    const b = await bridge();
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    await expect.poll(() => b.subscribers()).toBe(1);
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: { kind: 'none' } });
    expect(h.changes.at(-1)).toEqual({ appSessionId: APP, state: null });
    await expect.poll(() => b.subscribers()).toBe(0);
    expect(h.state()).toBeNull();
  });
});

describe('the bridge’s states', () => {
  it('is observer for a lane B verdict, none for a sminos with no controls, each with its reason', async () => {
    const b = await bridge({ lane: 'match' });
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await expect.poll(() => h.state()?.bridge).toBe('observer');
    expect(h.state()?.reason).toBe('MAWS controls this session');
    expect(b.subscribers()).toBe(0); // no stream: nothing to drive
    expect(await h.driver.interrupt(APP)).toEqual({ state: 'refused', code: 'no-bridge', message: 'MAWS controls this session' });

    b.setStatus({ lane: undefined, capabilities: { ...FULL_CAPABILITIES, sminos: '1.10.0', controls: undefined } });
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: { kind: 'terminal', pid: 9 } }); // another process: probed again
    await expect.poll(() => h.state()?.bridge).toBe('none');
    expect(h.state()?.reason).toMatch(/sminos \(1\.10\.0\) predates MAWS’s controls: update sminos, then run \/reload-plugins/);
  });

  // The bridge retries an unresolved lane verdict on its own (sminos_bridge.py `settle_lane`); a verdict that resolves
  // reaches its subscribers as a resync, which ends each stream, so the state stream held open re-reads /status.
  it('holds an unresolved verdict as starting, every control closed, and turns live when the verdict resolves to mismatch', async () => {
    const b = await bridge({ lane: 'unresolved' });
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await expect.poll(() => h.state()?.bridge).toBe('starting');
    expect(h.state()?.reason).toBe('the bridge is still deciding whether MAWS controls this session');
    await expect.poll(() => b.subscribers()).toBe(1); // its state stream, held open for the verdict
    expect(await h.driver.interrupt(APP)).toEqual({ state: 'refused', code: 'no-bridge', message: 'the bridge is still deciding whether MAWS controls this session' });
    b.setStatus({ lane: 'mismatch' });
    b.reset(); // the resync the resolved verdict brings ends every stream
    await h.live();
    expect(h.state()?.reason).toBeNull();
  });

  it('turns a starting bridge live through its stream, with no holder or directory change', async () => {
    const b = await bridge({ ready: false, readyWaitMs: 5000 });
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await expect.poll(() => h.state()?.bridge).toBe('starting');
    expect(h.state()?.reason).toBe('the session’s bridge is starting');
    b.setReady(true);
    await h.live();
  });

  it('retries a starting bridge’s refused subscription with backoff until it is ready', async () => {
    const b = await bridge({ ready: false, readyWaitMs: 50 });
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await expect.poll(() => h.state()?.bridge).toBe('starting');
    await new Promise((r) => setTimeout(r, 300)); // several 503s
    b.setReady(true);
    await h.live();
  });

  it('resubscribes with backoff after a refusal cut off mid-body', async () => {
    // a bridge that names itself starting and refuses /events with a 503 whose body never finishes
    mkdirSync(join(process.env.SMINOS_HOME!, 'bridge'), { recursive: true, mode: 0o700 });
    const path = join(process.env.SMINOS_HOME!, 'bridge', `${ENGINE}.sock`);
    let subscriptions = 0;
    const raw = createServer((socket) =>
      socket.once('data', (data) => {
        if (data.toString('utf8').startsWith('GET /events')) {
          subscriptions += 1;
          socket.write('HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"error": "not re');
          socket.destroy();
          return;
        }
        const body = JSON.stringify({ session: ENGINE, pid: 1, protocol: 1, ready: false });
        socket.end(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
      }),
    );
    await new Promise<void>((r) => raw.listen(path, () => r()));
    try {
      const h = harness();
      h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
      await expect.poll(() => h.state()?.bridge).toBe('starting');
      await expect.poll(() => subscriptions, { timeout: 3000 }).toBeGreaterThanOrEqual(3);
    } finally {
      await new Promise<void>((r) => raw.close(() => r()));
    }
  });

  it('resubscribes its state stream after an end, and the fresh snapshot carries on', async () => {
    const b = await bridge();
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    await expect.poll(() => b.subscribers()).toBe(1);
    b.reset();
    b.raise({ request: 'toolu_1', tool: 'Bash', input: { command: 'ls' } }); // raised while no stream holds
    await expect.poll(() => h.state()?.pending.map((p) => p.request), { timeout: 3000 }).toEqual(['toolu_1']);
    await expect.poll(() => b.subscribers()).toBe(1);
  });

  it('follows the main turn, a subagent’s turn leaving it running, and the override', async () => {
    const b = await bridge();
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    await expect.poll(() => b.subscribers()).toBe(1);
    b.emit({ type: 'turn', phase: 'start', turnId: 't1', agentId: null });
    await expect.poll(() => h.state()?.turn.running).toBe(true);
    b.emit({ type: 'turn', phase: 'start', turnId: 't2', agentId: 'a1' });
    b.emit({ type: 'turn', phase: 'complete', turnId: 't2', agentId: 'a1' });
    b.emit({ type: 'model', model: 'claude-haiku-4-5', effort: 'low' });
    await expect.poll(() => h.state()?.override).toEqual({ model: 'claude-haiku-4-5', effort: 'low' });
    expect(h.state()?.turn.running).toBe(true);
    b.emit({ type: 'turn', phase: 'complete', turnId: 't1', agentId: null });
    await expect.poll(() => h.state()?.turn.running).toBe(false);
  });

  // sminos 1.27.14: the heartbeat carries the mode the session last reported; a fresh stream's snapshot carries none
  it('follows the mode its heartbeat reports, kept across a fresh stream until a heartbeat says otherwise', async () => {
    const b = await bridge({ capabilities: { ...FULL_CAPABILITIES, sminos: '1.27.14' } });
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    await expect.poll(() => b.subscribers()).toBe(1);
    expect(h.state()?.mode).toBeNull(); // the session's start reports none
    b.setMode({ mode: 'acceptEdits', at: 1_761_700_000_000, from: 'permission_mode_changed' });
    b.heartbeat();
    await expect.poll(() => h.state()?.mode).toEqual({ mode: 'acceptEdits', at: 1_761_700_000_000, from: 'permission_mode_changed' });
    expect(h.changes.at(-1)?.state?.mode).toEqual({ mode: 'acceptEdits', at: 1_761_700_000_000, from: 'permission_mode_changed' }); // to every page
    b.reset();
    await expect.poll(() => b.subscribers()).toBe(1);
    expect(h.state()?.mode).toMatchObject({ mode: 'acceptEdits' });
    b.setMode(null); // a new process: its bridge holds none
    b.heartbeat();
    await expect.poll(() => h.state()?.mode).toBeNull();
  });

  it('shows no mode from a bridge older than sminos 1.27.14, whatever its heartbeat carries', async () => {
    const b = await bridge(); // sminos 1.25.0
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    await expect.poll(() => b.subscribers()).toBe(1);
    b.setMode({ mode: 'plan', at: 1_761_700_000_000, from: 'UserPromptSubmit' });
    b.heartbeat();
    b.emit({ type: 'model', model: 'claude-haiku-4-5', effort: null }); // after the heartbeat on the stream: once it shows, the heartbeat was read
    await expect.poll(() => h.state()?.override).toEqual({ model: 'claude-haiku-4-5', effort: null });
    expect(h.state()?.mode).toBeNull();
  });
});

describe('watches', () => {
  it('seeds each watch from its own snapshot; a second, opened mid-reply, starts from the streamed text', async () => {
    const b = await bridge();
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    const first = h.driver.watch(APP, client()).watch;
    await expect.poll(() => messagesOf(h.planes, first).map((m) => m.kind)).toEqual(['snapshot']);
    b.emit({ type: 'step', phase: 'start', turnId: 't1', agentId: null, step: 1 });
    b.emit({ type: 'chunk', turnId: 't1', agentId: null, step: 1, chunkIndex: 0, chunk: { index: 0, delta: { text: 'Hello' } } });
    await expect.poll(() => messagesOf(h.planes, first).map((m) => m.kind)).toEqual(['snapshot', 'chunk']);
    const second = h.driver.watch(APP, client()).watch;
    await expect.poll(() => messagesOf(h.planes, second).length).toBe(1);
    const snap = messagesOf(h.planes, second)[0]!;
    expect(snap).toMatchObject({ kind: 'snapshot', sub: second, n: 0, machine: MACHINE, session: ENGINE });
    expect((snap.body as { streaming: { blocks: { text: string }[] }[] }).streaming[0]!.blocks[0]!.text).toBe('Hello');
    // that turn aborts with no step end: the second watch closes the step its snapshot named
    b.emit({ type: 'turn', phase: 'complete', turnId: 't1', agentId: null, reason: 'aborted' });
    await expect.poll(() => messagesOf(h.planes, second).map((m) => m.kind)).toEqual(['snapshot', 'step-end']);
    expect(messagesOf(h.planes, second)[1]!.body).toEqual({ turnId: 't1', agentId: null, step: 1, t: expect.any(Number) }); // the bridge's time of the turn's end
    expect(messagesOf(h.planes, first).map((m) => m.kind)).toEqual(['snapshot', 'chunk', 'step-end']);
  });

  it('announces a reset when a watch’s stream ends, then its fresh snapshot; ends at unwatch and at the page’s end', async () => {
    const b = await bridge();
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    const page = client();
    const { watch } = h.driver.watch(APP, page);
    await expect.poll(() => messagesOf(h.planes, watch).length).toBe(1);
    await expect.poll(() => b.subscribers()).toBe(2);
    b.reset();
    await expect.poll(() => h.planes.filter((p) => p.watch === watch).map((p) => (p.reset ? 'reset' : p.messages?.[0]?.kind))).toEqual(['snapshot', 'reset', 'snapshot']);
    page.end(); // the page's clientGone
    await expect.poll(() => b.subscribers()).toBe(1);
    const other = h.driver.watch(APP, client()).watch;
    await expect.poll(() => b.subscribers()).toBe(2);
    h.driver.unwatch(APP, other);
    await expect.poll(() => b.subscribers()).toBe(1);
  });

  it('ends a watch when its session leaves lane A, and refuses one on a session with no bridge', async () => {
    await bridge();
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    const { watch } = h.driver.watch(APP, client());
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: { kind: 'none' } });
    expect(h.planes.at(-1)).toEqual({ appSessionId: APP, watch, ended: 'the session left the terminal' });
    expect(() => h.driver.watch(APP, client())).toThrow(/no bridge/);
  });
});

describe('jobs', () => {
  const row = (r: unknown) => `${JSON.stringify(r)}\n`;
  const shell = (n: number) =>
    row({ type: 'assistant', uuid: `a${n}`, timestamp: `T${n}`, message: { role: 'assistant', content: [{ type: 'tool_use', id: `toolu_${n}`, name: 'Bash', input: { command: `sleep ${n}`, description: `sleep ${n}` } }] } }) +
    row({ type: 'user', uuid: `u${n}`, timestamp: `T${n}`, toolUseResult: { backgroundTaskId: `bshell00${n}` }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${n}`, content: 'Command running in background' }] } });
  const ended = (n: number, status: string) =>
    row({ type: 'attachment', uuid: `n${n}`, timestamp: `E${n}`, attachment: { type: 'queued_command', commandMode: 'task-notification', prompt: `<task-notification><task-id>bshell00${n}</task-id><status>${status}</status></task-notification>` } });
  const jobsOf = (planes: Plane[], watch: string) =>
    messagesOf(planes, watch).filter((m) => m.kind === 'snapshot' || m.kind === 'subagents').map((m) => (m.body as { jobs: { taskId: string; status: string }[] }).jobs.map((j) => `${j.taskId} ${j.status}`));

  async function watched(transcriptRows: string) {
    const path = join(tmp('o9t-'), 'session.jsonl');
    writeFileSync(path, transcriptRows);
    const b = await bridge();
    const h = harness(undefined, {}, path);
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    const { watch } = h.driver.watch(APP, client());
    await expect.poll(() => jobsOf(h.planes, watch).flat().includes('bshell001 running')).toBe(true);
    return { b, h, path, watch };
  }

  it('carries the transcript’s jobs to a watch, and a subagents message each time they change', async () => {
    const { h, path, watch } = await watched(shell(1));
    appendFileSync(path, shell(2));
    await expect.poll(() => jobsOf(h.planes, watch).at(-1)).toEqual(['bshell001 running', 'bshell002 running']);
    appendFileSync(path, ended(1, 'completed'));
    await expect.poll(() => jobsOf(h.planes, watch).at(-1)).toEqual(['bshell001 completed', 'bshell002 running']);
    const last = messagesOf(h.planes, watch).at(-1)!;
    expect(last).toMatchObject({ kind: 'subagents', sub: watch, body: { subagents: [], mcp: [] } });
    const sent = jobsOf(h.planes, watch).length;
    await new Promise((r) => setTimeout(r, 120)); // polls with nothing new send nothing
    expect(jobsOf(h.planes, watch)).toHaveLength(sent);
  });

  it('says a running job exited when the session’s holder ends, before the watch ends', async () => {
    const { h, watch } = await watched(shell(1) + shell(2) + ended(2, 'failed'));
    await expect.poll(() => jobsOf(h.planes, watch).at(-1)).toEqual(['bshell001 running', 'bshell002 failed']);
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: { kind: 'none' } });
    const mine = h.planes.filter((p) => p.watch === watch);
    expect(mine.at(-1)).toEqual({ appSessionId: APP, watch, ended: 'the session left the terminal' });
    expect(jobsOf(h.planes, watch).at(-1)).toEqual(['bshell001 exited', 'bshell002 failed']);
  });

  it('says a running job exited when the session’s bridge goes', async () => {
    const { b, h, watch } = await watched(shell(1));
    await b.close();
    await expect.poll(() => h.planes.some((p) => p.watch === watch && p.ended !== undefined), { timeout: 3000 }).toBe(true);
    expect(jobsOf(h.planes, watch).at(-1)).toEqual(['bshell001 exited']);
  });

  it('stops only a job the transcript holds running; a task it doesn’t hold is the bridge’s to judge', async () => {
    const { b, h } = await watched(shell(1) + shell(2) + ended(2, 'killed'));
    expect(await h.driver.stopTask(APP, 'bshell002')).toEqual({ state: 'refused', code: 'not-running', message: expect.stringMatching(/not running/) as unknown });
    expect(await h.driver.stopTask(APP, 'bshell001')).toMatchObject({ state: 'done' });
    expect(await h.driver.stopTask(APP, 'b-agents1')).toMatchObject({ state: 'done' }); // a subagent's, say
    expect(b.commands.map((c) => c.body)).toEqual([{ op: 'stop', taskId: 'bshell001' }, { op: 'stop', taskId: 'b-agents1' }]);
  });

  // U8d M2 (F5): the jobs ride the agents' rule, so a transcript that streams with no job row builds no body
  it('builds the jobs’ body only after a row that moved a fact, never on a tick that read nothing of a job', async () => {
    const { h, path, watch } = await watched(shell(1));
    const built = vi.spyOn(Ledger.prototype, 'jobsBody');
    try {
      const sent = jobsOf(h.planes, watch).length;
      for (let i = 0; i < 6; i++) {
        appendFileSync(path, row({ type: 'assistant', uuid: `t${i}`, timestamp: `S${i}`, message: { role: 'assistant', content: [{ type: 'text', text: `still counting, step ${i}` }] } }));
        await readsPast(path, 1);
      }
      await readsPast(path, 2);
      expect(built).not.toHaveBeenCalled();
      expect(jobsOf(h.planes, watch)).toHaveLength(sent);
      appendFileSync(path, ended(1, 'completed'));
      await expect.poll(() => jobsOf(h.planes, watch).at(-1)).toEqual(['bshell001 completed']);
      expect(built).toHaveBeenCalled();
    } finally {
      built.mockRestore();
    }
  });

  it('reads the transcript at a stop no watch follows', async () => {
    const path = join(tmp('o9t-'), 'session.jsonl');
    writeFileSync(path, shell(1) + ended(1, 'completed'));
    const b = await bridge();
    const h = harness(undefined, {}, path);
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    expect(await h.driver.stopTask(APP, 'bshell001')).toMatchObject({ state: 'refused', code: 'not-running' });
    expect(b.commands).toEqual([]);
  });
});

// UX wave U8d M2 (docs/doperpowers/plans/2026-11-15-ux-wave-U8d-terminal-subagents.md, "What it proves"): a watch of a
// terminal session carries the session's subagents with their statuses, from three inputs (the transcripts' rows, the
// engine host's listing of the sidecars, the bridge's agents), derived only when one of them changed. Each sequence is
// held open; what it costs is counted, never timed.
describe('subagents', () => {
  const row = (r: unknown) => `${JSON.stringify(r)}\n`;
  const at = (n: number) => `2026-11-15T10:${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}.000Z`;
  // invented agent ids, a toolUseId for each
  const A1 = 'a0b1c2d3e4f500001';
  const A2 = 'a0b1c2d3e4f500002';
  const P = 'a0b1c2d3e4f5000p1'; // a parent
  const N = 'a0b1c2d3e4f5000n1'; // nested under P
  const tool = (agentId: string) => `toolu_made_up_${agentId.slice(-3)}`;
  const call = (agentId: string, n: number, background = true) =>
    row({ type: 'assistant', uuid: `c-${agentId}`, timestamp: at(n), message: { role: 'assistant', content: [{ type: 'tool_use', id: tool(agentId), name: 'Agent', input: { description: `count the files, part ${agentId.slice(-3)}`, prompt: 'count them', subagent_type: 'general-purpose', ...(background && { run_in_background: 'true' }) } }] } });
  const launch = (agentId: string, n: number) =>
    row({ type: 'user', uuid: `l-${agentId}`, timestamp: at(n), toolUseResult: { status: 'async_launched', agentId, outputFile: `/tmp/made-up/${agentId}.output` }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tool(agentId), content: `Async agent launched successfully.\nagentId: ${agentId}` }] } });
  const launched = (agentId: string, n: number) => call(agentId, n) + launch(agentId, n);
  const block = (agentId: string, status: string) => `<task-notification><task-id>${agentId}</task-id><tool-use-id>${tool(agentId)}</tool-use-id><status>${status}</status><summary>made-up summary</summary></task-notification>`;
  // the main transcript's queue record, and the notification row an agent's own file gets
  const queued = (agentId: string, status: string, n: number) => row({ type: 'queue-operation', operation: 'enqueue', timestamp: at(n), content: block(agentId, status) });
  const told = (agentId: string, status: string, n: number) => row({ type: 'user', uuid: `n-${agentId}-${n}`, timestamp: at(n), origin: { kind: 'task-notification' }, message: { role: 'user', content: block(agentId, status) } });
  const answered = (agentId: string, n: number) =>
    row({ type: 'user', uuid: `r-${agentId}`, timestamp: at(n), toolUseResult: { status: 'completed', agentId, content: [] }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tool(agentId), content: 'there are three files' }] } });
  const chatter = (n: number) => row({ type: 'assistant', uuid: `t-${n}`, timestamp: at(n % 3600), message: { role: 'assistant', content: [{ type: 'text', text: `still counting, step ${n}` }] } });

  // The engine host's listing as main's dependencies reach it: `fs.subagents` (each read counted; a test can fail or
  // hold the next ones), `fs.subagentsChanged`, and the host streaming again.
  class Listing {
    reads = 0;
    private failing = 0;
    private held: { resolve(entries: SubagentEntry[]): void; reject(error: Error): void } | null = null;
    private holding = false;
    private readonly changed = new Set<(appId: AppSessionId, agents: SubagentEntry[]) => void>();
    private readonly streams = new Set<() => void>();
    constructor(public entries: SubagentEntry[]) {}
    readonly deps: Pick<LaneADeps, 'subagents' | 'onSubagentsChanged' | 'onHostStreaming'> = {
      subagents: (appId) => {
        this.reads += 1;
        if (this.failing > 0) {
          this.failing -= 1;
          return Promise.reject(new Error('the engine host is restarting'));
        }
        if (this.holding) return new Promise((resolve, reject) => (this.held = { resolve, reject }));
        return Promise.resolve(appId === APP ? this.entries : []);
      },
      onSubagentsChanged: (listener) => {
        this.changed.add(listener);
        return () => void this.changed.delete(listener);
      },
      onHostStreaming: (listener) => {
        this.streams.add(listener);
        return () => void this.streams.delete(listener);
      },
    };
    fail(times: number): void {
      this.failing = times;
    }
    hold(): void {
      this.holding = true;
    }
    release(answer: SubagentEntry[] | Error): void {
      this.holding = false;
      const held = this.held;
      this.held = null;
      if (answer instanceof Error) held?.reject(answer);
      else held?.resolve(answer);
    }
    change(entries: SubagentEntry[]): void {
      this.entries = entries;
      for (const listener of this.changed) listener(APP, entries);
    }
    streaming(): void {
      for (const listener of this.streams) listener();
    }
    listeners(): number {
      return this.changed.size + this.streams.size;
    }
  }

  const fileOf = (dir: string, agentId: string) => join(dir, 'subagents', `agent-${agentId}.jsonl`);
  const entry = (dir: string, agentId: string, meta: Record<string, unknown> = {}): SubagentEntry => ({
    agentId: agentId as AgentId,
    meta: { agentType: 'general-purpose', description: `count the files, part ${agentId.slice(-3)}`, toolUseId: tool(agentId), requestShape: 'background', ...meta } as SubagentEntry['meta'],
    transcriptPath: fileOf(dir, agentId),
    size: 0,
    mtimeMs: 0,
    runId: null,
  });
  const nested = (dir: string, agentId: string, parent: string, meta: Record<string, unknown> = {}) => entry(dir, agentId, { parentAgentId: parent, spawnDepth: 2, ...meta });

  interface Setup {
    main?: string;
    files?: Record<string, string>; // an agent's own transcript, by agent id
    entries?: (dir: string) => SubagentEntry[];
    timing?: Record<string, unknown>;
    bridge?: Partial<Parameters<typeof startFakeBridge>[0]>;
    before?: (b: FakeBridge) => void; // what the bridge holds before the driver finds it
    prepare?: (listing: Listing) => void; // how the host answers, before the watch starts its follow
    hold?: string[]; // agents whose transcript's first read is held once it has read the file, until `releaseFile`
  }

  async function session(setup: Setup = {}) {
    const dir = tmp('u8d-');
    const path = join(dir, 'session.jsonl');
    writeFileSync(path, setup.main ?? '');
    mkdirSync(join(dir, 'subagents'));
    for (const [id, rows] of Object.entries(setup.files ?? {})) writeFileSync(fileOf(dir, id), rows);
    const listing = new Listing(setup.entries?.(dir) ?? []);
    setup.prepare?.(listing);
    const b = await bridge(setup.bridge);
    setup.before?.(b);
    const held = new Map<string, () => void>();
    for (const id of setup.hold ?? []) counts.holds.set(fileOf(dir, id), new Promise<void>((resolve) => held.set(id, resolve)));
    // the main transcript's location, which a test can hold so that the next read stays in flight (once)
    type Gate = { promise: Promise<void>; open(): void; fail(error: Error): void };
    let pending: Gate | null = null;
    let taken: Gate | null = null;
    let located = 0;
    const transcript = async (appId: AppSessionId, engine: string) => {
      if (appId !== APP || engine !== ENGINE) return null;
      located += 1;
      const gate = pending;
      if (gate !== null) {
        pending = null;
        taken = gate;
        await gate.promise;
      }
      return path;
    };
    const h = harness(undefined, setup.timing ?? {}, path, { ...listing.deps, transcript });
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    const watch = h.driver.watch(APP, client()).watch;
    await expect.poll(() => messagesOf(h.planes, watch).length).toBeGreaterThan(0);
    const hold = () => {
      let open = () => {};
      let fail: (error: Error) => void = () => {};
      const promise = new Promise<void>((resolve, reject) => {
        open = resolve;
        fail = reject;
      });
      pending = { promise, open, fail };
    };
    const release = (error?: Error) => {
      const gate = taken ?? pending;
      taken = pending = null;
      if (error === undefined) gate?.open();
      else gate?.fail(error);
    };
    // a marker after the bridge's events: once the driver's state shows it, it has read every event before it
    let marks = 0;
    const settledStream = async () => {
      marks += 1;
      b.emit({ type: 'model', model: `claude-haiku-mark-${marks}`, effort: null });
      await expect.poll(() => h.state()?.override?.model).toBe(`claude-haiku-mark-${marks}`);
    };
    return { b, h, dir, path, listing, watch, file: (id: string) => fileOf(dir, id), hold, release, releaseFile: (id: string) => held.get(id)?.(), located: () => located, settledStream };
  }

  const bodiesOf = (planes: Plane[], watch: string) =>
    messagesOf(planes, watch).filter((m) => m.kind === 'snapshot' || m.kind === 'subagents').map((m) => (m.body as { subagents?: LaneAAgent[] }).subagents ?? []);
  const agentsOf = (planes: Plane[], watch: string) => bodiesOf(planes, watch).at(-1) ?? [];
  const statusOf = (planes: Plane[], watch: string, agentId: string) => {
    const found = agentsOf(planes, watch).find((a) => a.agentId === agentId);
    return found === undefined ? 'no entry' : `${found.status}/${found.evidence}`;
  };
  // the origin the last body names: the holder whose bridge child its facts came from (the fence review's ruling)
  const originOf = (planes: Plane[], watch: string) =>
    (messagesOf(planes, watch).filter((m) => m.kind === 'snapshot' || m.kind === 'subagents').at(-1)?.body as { origin?: unknown } | undefined)?.origin;
  const messageCount = (planes: Plane[], watch: string) => messagesOf(planes, watch).filter((m) => m.kind === 'subagents').length;
  // the timeline's index of the plane payload that first carried this status
  const whenSaid = (watch: string, h: { planes: Plane[] }, agentId: string, status: string) => {
    let seen = 0;
    for (let i = 0; i < counts.timeline.length; i++) {
      if (!counts.timeline[i]!.startsWith(`plane ${watch} `)) continue;
      const plane = h.planes.filter((p) => p.watch === watch)[seen++]!;
      const said = (plane.messages ?? []).some((m) => (m.kind === 'snapshot' || m.kind === 'subagents') && ((m.body as { subagents?: LaneAAgent[] }).subagents ?? []).some((a) => a.agentId === agentId && `${a.status}/${a.evidence}` === status));
      if (said) return i;
    }
    return -1;
  };

  it('carries each listed agent with its status and when its call was made, in a watch’s snapshot and whenever it changes', async () => {
    const s = await session({
      main: launched(A1, 1) + launched(P, 2),
      files: { [P]: launched(N, 3) },
      entries: (dir) => [entry(dir, A1), entry(dir, P), nested(dir, N, P)],
    });
    await expect.poll(() => agentsOf(s.h.planes, s.watch).map((a) => `${a.agentId} ${a.status}/${a.evidence}`)).toEqual([`${A1} running/rows`, `${P} running/rows`, `${N} running/rows`]);
    const first = agentsOf(s.h.planes, s.watch);
    expect(first.find((a) => a.agentId === A1)).toMatchObject({ meta: { toolUseId: tool(A1), requestShape: 'background' }, outcome: { status: 'running', raw: 'async_launched' }, startedAt: at(1) });
    expect(first.find((a) => a.agentId === N)?.startedAt).toBe(at(3)); // its call is in its parent's transcript
    expect(first.every((a) => !('file' in a))).toBe(true);
    expect(messagesOf(s.h.planes, s.watch).at(-1)).toMatchObject({ kind: 'subagents', body: { jobs: [], mcp: [], origin: 'terminal:4242' } });

    // a second watch of the session gets them in its own snapshot
    const second = s.h.driver.watch(APP, client()).watch;
    await expect.poll(() => messagesOf(s.h.planes, second).length).toBeGreaterThan(0);
    const snapshot = messagesOf(s.h.planes, second)[0]!;
    expect(snapshot).toMatchObject({ kind: 'snapshot', n: 0, body: { jobs: [] } });
    expect((snapshot.body as { subagents: LaneAAgent[] }).subagents).toEqual(first);
    expect(snapshot.body).toMatchObject({ origin: 'terminal:4242' }); // beside the list, the terminal the facts came from

    appendFileSync(s.path, queued(A1, 'completed', 4));
    await expect.poll(() => statusOf(s.h.planes, s.watch, A1)).toBe('completed/rows');
    await expect.poll(() => statusOf(s.h.planes, second, A1)).toBe('completed/rows');
    expect(agentsOf(s.h.planes, s.watch).find((a) => a.agentId === A1)?.outcome).toMatchObject({ status: 'completed', raw: 'completed', summary: 'made-up summary' });
  });

  it.each([
    ['its holder ends', (s: Awaited<ReturnType<typeof session>>) => s.h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: { kind: 'none' } })],
    ['its bridge goes', (s: Awaited<ReturnType<typeof session>>) => void s.b.close()],
  ])('says every agent the rows hold no end for ended with the session when %s, before the watch ends', async (_how, end) => {
    const s = await session({ main: launched(A1, 1) + launched(A2, 2) + queued(A2, 'failed', 3), entries: (dir) => [entry(dir, A1), entry(dir, A2)], before: (b) => b.agentSpawned({ agentId: A1, toolUseId: tool(A1) }) });
    await expect.poll(() => [statusOf(s.h.planes, s.watch, A1), statusOf(s.h.planes, s.watch, A2)]).toEqual(['running/bridge', 'failed/rows']);
    end(s);
    await expect.poll(() => s.h.planes.some((p) => p.watch === s.watch && p.ended !== undefined), { timeout: 3000 }).toBe(true);
    const mine = s.h.planes.filter((p) => p.watch === s.watch);
    expect(mine.at(-1)?.ended).toBeDefined();
    expect(agentsOf(s.h.planes, s.watch).map((a) => [a.agentId, a.status, a.evidence])).toEqual([[A1, 'exited', 'session'], [A2, 'failed', 'rows']]);
    expect(agentsOf(s.h.planes, s.watch).some((a) => a.status === 'running' || a.running !== undefined)).toBe(false);
    expect(agentsOf(s.h.planes, s.watch)[0]?.spawn).toMatchObject({ toolUseId: tool(A1) }); // the bridge's spawn, kept
    expect(originOf(s.h.planes, s.watch)).toBe('terminal:4242');
  });

  // The fence review's first finding, through the driver (its ruling's point 2): the origin is fixed by the probe whose
  // bridge child the body's facts came from, never read from the session's holder when the body is sent. A holder change
  // from one terminal to another reprobes in place, the follow and the watches kept.
  it('names the terminal whose bridge child its facts came from in its final body, heard after the holder moved to another terminal', async () => {
    const s = await session({ main: launched(A1, 1), entries: (dir) => [entry(dir, A1)], before: (b) => b.agentSpawned({ agentId: A1, toolUseId: tool(A1) }) });
    await expect.poll(() => [statusOf(s.h.planes, s.watch, A1), originOf(s.h.planes, s.watch)]).toEqual(['running/bridge', 'terminal:4242']);
    s.h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: { kind: 'terminal', pid: 5151 } }); // reprobed in place
    void s.b.close(); // terminal 4242's bridge child goes, and no other answers
    await expect.poll(() => s.h.planes.some((p) => p.watch === s.watch && p.ended !== undefined), { timeout: 3000 }).toBe(true);
    expect(statusOf(s.h.planes, s.watch, A1)).toBe('exited/session');
    expect(originOf(s.h.planes, s.watch)).toBe('terminal:4242');
  });

  it('names the next terminal once its bridge child’s snapshot replaces the last one’s, sending that body though nothing else changed', async () => {
    const s = await session({ main: launched(A1, 1), entries: (dir) => [entry(dir, A1)] });
    await expect.poll(() => [statusOf(s.h.planes, s.watch, A1), originOf(s.h.planes, s.watch)]).toEqual(['running/rows', 'terminal:4242']);
    const before = agentsOf(s.h.planes, s.watch);
    await bridge({ pid: 5151, launch: 'launch-2' }); // the next terminal's bridge child takes the socket; the last one's streams go on
    s.h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: { kind: 'terminal', pid: 5151 } });
    await s.settledStream(); // the state stream is still the last child's
    expect(originOf(s.h.planes, s.watch)).toBe('terminal:4242');
    s.b.reset(); // the last child's streams end: the state stream opens on the next child, whose snapshot follows
    await expect.poll(() => originOf(s.h.planes, s.watch), { timeout: 3000 }).toBe('terminal:5151');
    expect(agentsOf(s.h.planes, s.watch)).toEqual(before);
    expect(s.h.planes.some((p) => p.watch === s.watch && p.ended !== undefined)).toBe(false);
  });

  // A launch is the engine process a bridge child serves. The next terminal's child can answer a reconnect while the
  // index still names the last terminal: its body names that terminal (the probe's holder) until the holder moves to
  // the next one, and then, with nothing else changed, the next one. This proves the branch where the last terminal's
  // launch was observed first; when the driver's first observation is the next terminal's child, the launch stays tied
  // to the last holder (a tracker row, not built).
  it('names the next terminal once the holder moves to it, when that terminal’s bridge child answered before it did', async () => {
    const s = await session({ main: launched(A1, 1), entries: (dir) => [entry(dir, A1)] });
    await expect.poll(() => originOf(s.h.planes, s.watch)).toBe('terminal:4242');
    const next = await bridge({ pid: 5151, launch: 'launch-2' });
    s.b.reset(); // the last child's streams end, and the next child answers the reconnect under the holder still named
    await expect.poll(() => s.h.state()?.launch, { timeout: 3000 }).toBe('launch-2');
    next.emit({ type: 'model', model: 'claude-haiku-mark-next', effort: null }); // once the state shows it, the next child's stream is read
    await expect.poll(() => s.h.state()?.override?.model, { timeout: 3000 }).toBe('claude-haiku-mark-next');
    expect(originOf(s.h.planes, s.watch)).toBe('terminal:4242');
    s.h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: { kind: 'terminal', pid: 5151 } });
    await expect.poll(() => originOf(s.h.planes, s.watch), { timeout: 3000 }).toBe('terminal:5151');
    expect(statusOf(s.h.planes, s.watch, A1)).toBe('running/rows');
  });

  it('derives once, after it, for a bridge event that arrives while a read is in flight', async () => {
    const s = await session({ main: launched(A1, 1), entries: (dir) => [entry(dir, A1), entry(dir, A2)], timing: { jobsPollMs: 60_000 }, before: (b) => b.agentSpawned({ agentId: A1, toolUseId: tool(A1) }) });
    await expect.poll(() => [statusOf(s.h.planes, s.watch, A1), statusOf(s.h.planes, s.watch, A2)]).toEqual(['running/bridge', 'unknown/none']);
    await s.settledStream();
    const derived = counts.derivations;
    const located = s.located();
    s.hold();
    s.b.agentStopped(A1); // asks for a read, which the held transcript keeps in flight
    await expect.poll(() => s.located()).toBe(located + 1);
    s.b.agentSpawned({ agentId: A2, toolUseId: tool(A2) }); // arrives while that read is out
    await s.settledStream();
    expect(counts.derivations).toBe(derived); // nothing is derived while the read is in flight
    expect(s.located()).toBe(located + 1); // and the second event joined it
    s.release();
    await expect.poll(() => [statusOf(s.h.planes, s.watch, A1), statusOf(s.h.planes, s.watch, A2)]).toEqual(['exited/bridge', 'running/bridge']);
    expect(counts.derivations).toBe(derived + 1);
    expect(s.located()).toBe(located + 1);
  });

  it('makes no entry for a spawn the bridge reports before the listing names the agent; the listing’s change makes it', async () => {
    const s = await session({ entries: () => [] });
    s.b.agentSpawned({ agentId: A1, toolUseId: tool(A1) });
    await s.settledStream();
    await readsPast(s.path, 2);
    expect(agentsOf(s.h.planes, s.watch)).toEqual([]);
    s.listing.change([entry(s.dir, A1)]);
    await expect.poll(() => statusOf(s.h.planes, s.watch, A1)).toBe('running/bridge');
    expect(agentsOf(s.h.planes, s.watch)[0]).toMatchObject({ running: true, spawn: { toolUseId: tool(A1), background: true, parentAgentId: null } });
  });

  // F1: a nested agent ended on the bridge's word alone is provisional, so its parent's file stays read
  it.each([['failed'], ['completed']])('reads the late row after a provisional ending: the bridge stops a nested agent before its row, which then says %s in its parent’s file', async (status) => {
    const s = await session({
      main: launched(P, 1),
      files: { [P]: launched(N, 2) },
      entries: (dir) => [entry(dir, P), nested(dir, N, P)],
      before: (b) => {
        b.agentSpawned({ agentId: P, toolUseId: tool(P) });
        b.agentSpawned({ agentId: N, toolUseId: tool(N), parentAgentId: P });
      },
    });
    await expect.poll(() => [statusOf(s.h.planes, s.watch, P), statusOf(s.h.planes, s.watch, N)]).toEqual(['running/bridge', 'running/bridge']);
    s.b.agentStopped(N);
    await expect.poll(() => statusOf(s.h.planes, s.watch, N)).toBe('exited/bridge');
    // its parent is open: read on each tick, though no meta and no spawn changes
    await readsPast(s.file(P), 3);
    appendFileSync(s.file(P), told(N, status, 9));
    await expect.poll(() => statusOf(s.h.planes, s.watch, N), { timeout: 5000 }).toBe(`${status}/rows`);
    // nothing under the parent is open and the parent has not settled: it leaves the tick
    const said = whenSaid(s.watch, s.h, N, `${status}/rows`);
    await readsPast(s.path, 4);
    expect(readsOf(s.file(P), said)).toBe(0);
  });

  // F1: the parent settles with nothing under it open
  it('reads a parent once more when it settles with nothing under it open, then never; a foreground nested agent then reads ended with its parent', async () => {
    const s = await session({
      main: launched(P, 1),
      files: { [P]: call(N, 2, false) }, // a call its parent waits for: no result yet
      entries: (dir) => [entry(dir, P), nested(dir, N, P, { requestShape: 'foreground' })],
    });
    await expect.poll(() => [statusOf(s.h.planes, s.watch, P), statusOf(s.h.planes, s.watch, N)]).toEqual(['running/rows', 'unknown/none']);
    await readsPast(s.path, 4);
    expect(readsOf(s.file(P))).toBe(1); // read when it became a parent; nothing under it is open
    appendFileSync(s.path, queued(P, 'completed', 5));
    await expect.poll(() => [statusOf(s.h.planes, s.watch, P), statusOf(s.h.planes, s.watch, N)]).toEqual(['completed/rows', 'exited/parent']);
    await expect.poll(() => readsOf(s.file(P))).toBe(2);
    await readsPast(s.path, 4);
    expect(readsOf(s.file(P))).toBe(2);
  });

  // N2: a nested background agent can outlive its parent, so the parent's end does not close its file
  it('keeps reading a settled parent while a background agent under it runs, takes that agent’s row, then reads it once more and closes it', async () => {
    const s = await session({
      main: launched(P, 1),
      files: { [P]: launched(N, 2) },
      entries: (dir) => [entry(dir, P), nested(dir, N, P)],
      before: (b) => b.agentSpawned({ agentId: N, toolUseId: tool(N), parentAgentId: P }),
    });
    await expect.poll(() => [statusOf(s.h.planes, s.watch, P), statusOf(s.h.planes, s.watch, N)]).toEqual(['running/rows', 'running/bridge']);
    appendFileSync(s.path, queued(P, 'completed', 5));
    await expect.poll(() => [statusOf(s.h.planes, s.watch, P), statusOf(s.h.planes, s.watch, N)]).toEqual(['completed/rows', 'running/bridge']);
    await readsPast(s.file(P), 3); // still read on each tick
    appendFileSync(s.file(P), told(N, 'completed', 8));
    await expect.poll(() => statusOf(s.h.planes, s.watch, N), { timeout: 5000 }).toBe('completed/rows');
    const said = whenSaid(s.watch, s.h, N, 'completed/rows');
    await readsPast(s.path, 4);
    expect(readsOf(s.file(P), said)).toBe(1); // one last read, then closed
  });

  // F3: an unknown nested agent never keeps its parent read, nor does an unreadable parent
  it('reads old parents whose nested agents are unknown once each, logs an unreadable one once, and tries it again only when the listing changes its entry', async () => {
    const P2 = 'a0b1c2d3e4f5000p2';
    const P3 = 'a0b1c2d3e4f5000p3'; // its transcript is missing
    const forked = { toolUseId: undefined, requestShape: undefined }; // no call: the rows say nothing of them
    const listed = (dir: string, p3: Record<string, unknown> = {}) => [
      entry(dir, P, forked), entry(dir, P2, forked), entry(dir, P3, { ...forked, ...p3 }),
      nested(dir, 'a0b1c2d3e4f5000n1', P, forked), nested(dir, 'a0b1c2d3e4f5000n2', P2, forked), nested(dir, 'a0b1c2d3e4f5000n3', P3, forked),
    ];
    const s = await session({ main: chatter(1), files: { [P]: chatter(2), [P2]: chatter(3) }, entries: (dir) => listed(dir) });
    await expect.poll(() => agentsOf(s.h.planes, s.watch).map((a) => a.status)).toEqual(['unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown']);
    await readsPast(s.path, 8);
    expect([readsOf(s.file(P)), readsOf(s.file(P2)), readsOf(s.file(P3))]).toEqual([1, 1, 1]);
    expect(s.h.logs.filter((line) => line.includes(P3))).toHaveLength(1);
    expect(s.h.logs.filter((line) => line.includes(P) || line.includes(P2))).toEqual([]);

    // a change of another entry is not a change of its own
    s.listing.change(listed(s.dir).map((e) => (e.agentId === P2 ? { ...e, meta: { ...e.meta!, description: 'count them again' } } : e)));
    await expect.poll(() => agentsOf(s.h.planes, s.watch).find((a) => a.agentId === P2)?.meta.description).toBe('count them again');
    await readsPast(s.path, 3);
    expect(readsOf(s.file(P3))).toBe(1);

    writeFileSync(s.file(P3), chatter(4));
    s.listing.change(listed(s.dir, { description: 'count the rest' }));
    await expect.poll(() => readsOf(s.file(P3))).toBe(2);
    await readsPast(s.path, 4);
    expect([readsOf(s.file(P)), readsOf(s.file(P2)), readsOf(s.file(P3))]).toEqual([1, 1, 2]);
    expect(s.h.logs.filter((line) => line.includes(P3))).toHaveLength(1);
  });

  // F4: the first listing is owed until it is answered
  it('owes the first listing after a failed read: the engine host streaming again brings the running agent to the watch left open', async () => {
    const s = await session({
      main: launched(A1, 1),
      entries: (dir) => [entry(dir, A1)],
      timing: { backoff: { firstMs: 60_000, maxMs: 60_000, healthyMs: 60_000 } }, // the backoff's first step is past this test
      prepare: (listing) => listing.fail(1),
    });
    await expect.poll(() => s.listing.reads).toBe(1);
    await readsPast(s.path, 3);
    expect(agentsOf(s.h.planes, s.watch)).toEqual([]);
    expect(s.h.logs.filter((line) => line.includes('listing'))).toHaveLength(1);
    s.listing.streaming(); // the bridge and the files have not changed
    await expect.poll(() => statusOf(s.h.planes, s.watch, A1)).toBe('running/rows');
    expect(s.listing.reads).toBe(2);
  });

  it('asks a failed first listing again on the backoff’s steps and no faster, logging the run of failures once', async () => {
    const s = await session({
      main: launched(A1, 1),
      entries: (dir) => [entry(dir, A1)],
      timing: { backoff: { firstMs: 1500, maxMs: 1500, healthyMs: 60_000 } },
      prepare: (listing) => listing.fail(2),
    });
    await expect.poll(() => s.listing.reads).toBe(1);
    await readsPast(s.path, 4); // ticks shorter than the first step
    expect(s.listing.reads).toBe(1);
    await expect.poll(() => s.listing.reads, { timeout: 5000 }).toBe(2);
    await readsPast(s.path, 4);
    expect(s.listing.reads).toBe(2);
    await expect.poll(() => statusOf(s.h.planes, s.watch, A1), { timeout: 5000 }).toBe('running/rows');
    expect(s.listing.reads).toBe(3);
    expect(s.h.logs.filter((line) => line.includes('listing'))).toHaveLength(1);
  });

  it.each([
    ['fails', new Error('the engine host is restarting')],
    ['answers', null],
  ])('drops a first listing that %s after the follow ended: nothing is sent and nothing is asked again', async (_how, answer) => {
    const s = await session({ main: launched(A1, 1), entries: (dir) => [entry(dir, A1)], timing: { backoff: { firstMs: 20, maxMs: 40, healthyMs: 60_000 } }, prepare: (listing) => listing.hold() });
    await expect.poll(() => s.listing.reads).toBe(1);
    s.h.driver.unwatch(APP, s.watch);
    const planes = s.h.planes.length;
    s.listing.release(answer ?? s.listing.entries);
    await s.settledStream();
    await new Promise((resolve) => setTimeout(resolve, 200)); // several of the backoff's steps
    expect(s.listing.reads).toBe(1);
    expect(s.h.planes.slice(planes).filter((p) => p.watch === s.watch)).toEqual([]);
    expect(s.h.logs.filter((line) => line.includes('listing'))).toEqual([]);
  });

  it('reads a listing it holds again when the engine host streams again, since a restarted host says changes only for sessions it has read', async () => {
    const s = await session({ main: launched(A1, 1) + launched(A2, 2), entries: (dir) => [entry(dir, A1)] });
    await expect.poll(() => statusOf(s.h.planes, s.watch, A1)).toBe('running/rows');
    expect(s.listing.reads).toBe(1);
    s.listing.entries = [entry(s.dir, A1), entry(s.dir, A2)];
    s.listing.streaming();
    await expect.poll(() => statusOf(s.h.planes, s.watch, A2)).toBe('running/rows');
    expect(s.listing.reads).toBe(2);
  });

  // F5
  it('derives nothing and sends nothing over a transcript that streams rows naming no agent and no job, with many agents listed', async () => {
    const ids = Array.from({ length: 8 }, (_, i) => `a0b1c2d3e4f5001${String(i).padStart(2, '0')}`);
    const s = await session({ main: ids.map((id, i) => launched(id, i + 1)).join(''), entries: (dir) => ids.map((id) => entry(dir, id)) });
    await expect.poll(() => agentsOf(s.h.planes, s.watch).filter((a) => a.status === 'running')).toHaveLength(8);
    await readsPast(s.path, 2);
    const derived = counts.derivations;
    const sent = messageCount(s.h.planes, s.watch);
    for (let i = 0; i < 8; i++) {
      appendFileSync(s.path, chatter(100 + i));
      await readsPast(s.path, 1);
    }
    await readsPast(s.path, 2);
    expect(counts.derivations).toBe(derived);
    expect(messageCount(s.h.planes, s.watch)).toBe(sent);
  });

  it('costs, over idle ticks with two running agents, one main read per tick and nothing else', async () => {
    const s = await session({
      main: launched(A1, 1) + launched(A2, 2),
      entries: (dir) => [entry(dir, A1), entry(dir, A2)],
      before: (b) => {
        b.agentSpawned({ agentId: A1, toolUseId: tool(A1) });
        b.agentSpawned({ agentId: A2, toolUseId: tool(A2) });
      },
    });
    await expect.poll(() => agentsOf(s.h.planes, s.watch).map((a) => `${a.status}/${a.evidence}`)).toEqual(['running/bridge', 'running/bridge']);
    await readsPast(s.path, 2);
    const from = counts.timeline.length;
    const derived = counts.derivations;
    const sent = messageCount(s.h.planes, s.watch);
    await readsPast(s.path, 10);
    const reads = counts.timeline.slice(from).filter((t) => t.startsWith('read '));
    expect(reads.length).toBeGreaterThanOrEqual(10);
    expect(reads.every((t) => t === `read ${s.path}`)).toBe(true); // no parent read
    expect(s.listing.reads).toBe(1);
    expect(counts.derivations).toBe(derived);
    expect(messageCount(s.h.planes, s.watch)).toBe(sent);
  });

  // The window is taken between the test's polls, which run apart from the driver's ticks: a round's reads all start
  // in its tick's own turn, so the window holds whole rounds and the bound is strict.
  it('reads an open parent at most once per tick while it waits for a nested agent, and no other file; its own result row closes it after exactly one more read', async () => {
    const s = await session({
      main: launched(P, 1),
      files: { [P]: call(N, 2, false) },
      entries: (dir) => [entry(dir, P), nested(dir, N, P, { requestShape: 'foreground' })],
      before: (b) => {
        b.agentSpawned({ agentId: P, toolUseId: tool(P) });
        b.agentSpawned({ agentId: N, toolUseId: tool(N), parentAgentId: P, background: false });
      },
    });
    await expect.poll(() => [statusOf(s.h.planes, s.watch, P), statusOf(s.h.planes, s.watch, N)]).toEqual(['running/bridge', 'running/bridge']);
    await readsPast(s.path, 2);
    const from = counts.timeline.length;
    await readsPast(s.path, 10);
    const main = readsOf(s.path, from);
    const parent = readsOf(s.file(P), from);
    expect(parent).toBeGreaterThan(0);
    expect(parent).toBeLessThanOrEqual(main);
    expect(counts.timeline.slice(from).filter((t) => t.startsWith('read ') && t !== `read ${s.path}` && t !== `read ${s.file(P)}`)).toEqual([]);
    appendFileSync(s.path, queued(P, 'completed', 5));
    await expect.poll(() => [statusOf(s.h.planes, s.watch, P), statusOf(s.h.planes, s.watch, N)]).toEqual(['completed/rows', 'exited/parent']);
    const said = whenSaid(s.watch, s.h, N, 'exited/parent');
    await readsPast(s.path, 4);
    expect(readsOf(s.file(P), said)).toBe(1);
  });

  it('answers a bridge agent event with exactly one more round of reads and at most one message', async () => {
    const s = await session({ main: launched(A1, 1), entries: (dir) => [entry(dir, A1)], timing: { jobsPollMs: 60_000 } });
    await expect.poll(() => statusOf(s.h.planes, s.watch, A1)).toBe('running/rows');
    await s.settledStream();
    const reads = readsOf(s.path);
    const sent = messageCount(s.h.planes, s.watch);
    s.b.agentSpawned({ agentId: A1, toolUseId: tool(A1) });
    await expect.poll(() => statusOf(s.h.planes, s.watch, A1)).toBe('running/bridge');
    await s.settledStream();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(readsOf(s.path)).toBe(reads + 1);
    expect(messageCount(s.h.planes, s.watch)).toBe(sent + 1);
  });

  // N10: the bridge's stream says stops for ids that are no agent of the session
  it('makes nothing of a bridge stop for an id with no meta, no spawn and no agent type: no entry, no follower, no log line', async () => {
    const stranger = 'a0b1c2d3e4f5000x9';
    const s = await session({ main: launched(A1, 1), entries: (dir) => [entry(dir, A1)] });
    await expect.poll(() => statusOf(s.h.planes, s.watch, A1)).toBe('running/rows');
    const from = counts.timeline.length;
    s.b.agentStopped(stranger, { agentType: '' });
    await s.settledStream();
    await readsPast(s.path, 3);
    expect(agentsOf(s.h.planes, s.watch).map((a) => a.agentId)).toEqual([A1]);
    expect(counts.timeline.slice(from).filter((t) => t.startsWith('read ') && t !== `read ${s.path}`)).toEqual([]);
    expect(s.h.logs.filter((line) => line.includes(stranger))).toEqual([]);
  });

  it('replaces the bridge’s agents with the fresh snapshot of a reconnected state stream', async () => {
    const s = await session({ entries: (dir) => [entry(dir, A1), entry(dir, A2)], before: (b) => b.agentSpawned({ agentId: A1, toolUseId: tool(A1) }) });
    await expect.poll(() => [statusOf(s.h.planes, s.watch, A1), statusOf(s.h.planes, s.watch, A2)]).toEqual(['running/bridge', 'unknown/none']);
    s.b.resyncAgents([{ agentId: A2, parentAgentId: null, subagentType: 'general-purpose', description: '', name: null, background: true, model: 'claude-haiku-4-5', toolUseId: tool(A2), running: true }]);
    await expect.poll(() => [statusOf(s.h.planes, s.watch, A1), statusOf(s.h.planes, s.watch, A2)], { timeout: 5000 }).toEqual(['unknown/none', 'running/bridge']);
  });

  // "Where the source cannot know" 1: a bridge that reports no agents leaves a waited-for agent to the rows alone
  it('derives from the rows alone with a bridge whose snapshot has no agents: a waited-for agent is unknown until its result row', async () => {
    const s = await session({ main: call(A1, 1, false), entries: (dir) => [entry(dir, A1, { requestShape: 'foreground' })], bridge: { reportsAgents: false } });
    await expect.poll(() => statusOf(s.h.planes, s.watch, A1)).toBe('unknown/none');
    appendFileSync(s.path, answered(A1, 2));
    await expect.poll(() => statusOf(s.h.planes, s.watch, A1)).toBe('completed/rows');
  });

  // M2's review, finding 1: only the latest listing read asked discharges the debt
  it('lets no older listing answer discharge a newer read: the read asked at the host’s streaming signal stays owed until answered', async () => {
    const s = await session({
      main: launched(A1, 1),
      entries: (dir) => [entry(dir, A1)],
      timing: { backoff: { firstMs: 300, maxMs: 300, healthyMs: 60_000 } },
      prepare: (listing) => listing.hold(), // the first read stays out
    });
    await expect.poll(() => s.listing.reads).toBe(1);
    s.listing.fail(1);
    s.listing.streaming(); // the restarted host's read, which fails
    expect(s.listing.reads).toBe(2);
    s.listing.release(s.listing.entries); // the first read answers late
    await expect.poll(() => s.listing.reads, { timeout: 5000 }).toBe(3); // the second read's debt stands: asked again
    await expect.poll(() => statusOf(s.h.planes, s.watch, A1)).toBe('running/rows');
  });

  // M2's review, finding 2: a parent no entry names any more rests, and one an entry names again is read again
  it('lets a parent rest when no entry names it any more, and reads it again when one does', async () => {
    const s = await session({
      main: launched(P, 1),
      files: { [P]: launched(N, 2) },
      entries: (dir) => [entry(dir, P), nested(dir, N, P)],
      before: (b) => b.agentSpawned({ agentId: N, toolUseId: tool(N), parentAgentId: P }),
    });
    await expect.poll(() => [statusOf(s.h.planes, s.watch, P), statusOf(s.h.planes, s.watch, N)]).toEqual(['running/rows', 'running/bridge']);
    await readsPast(s.file(P), 2); // open: read on each tick
    s.listing.change([entry(s.dir, P)]); // the nested agent's entry goes
    const from = counts.timeline.length;
    await expect.poll(() => agentsOf(s.h.planes, s.watch).map((a) => a.agentId)).toEqual([P]);
    await readsPast(s.path, 4);
    expect(readsOf(s.file(P), from)).toBe(0);
    const back = counts.timeline.length;
    s.listing.change([entry(s.dir, P), nested(s.dir, N, P)]); // listed again
    await expect.poll(() => statusOf(s.h.planes, s.watch, N)).toBe('running/bridge');
    await expect.poll(() => readsOf(s.file(P), back)).toBeGreaterThanOrEqual(2); // read again, then open again
  });

  it('follows a nested agent’s new parent when its entry moves, and lets the former parent rest', async () => {
    const P2 = 'a0b1c2d3e4f5000p2';
    const s = await session({
      main: launched(P, 1) + launched(P2, 2),
      files: { [P]: launched(N, 3), [P2]: launched(N, 3) + told(N, 'completed', 4) },
      entries: (dir) => [entry(dir, P), entry(dir, P2), nested(dir, N, P)],
      before: (b) => b.agentSpawned({ agentId: N, toolUseId: tool(N), parentAgentId: P }),
    });
    await expect.poll(() => statusOf(s.h.planes, s.watch, N)).toBe('running/bridge');
    await readsPast(s.file(P), 2);
    expect(readsOf(s.file(P2))).toBe(0); // no parent yet
    s.listing.change([entry(s.dir, P), entry(s.dir, P2), nested(s.dir, N, P2)]);
    const from = counts.timeline.length;
    await expect.poll(() => statusOf(s.h.planes, s.watch, N)).toBe('completed/rows'); // from its new parent's file
    await readsPast(s.path, 4);
    expect(readsOf(s.file(P), from)).toBe(0);
    expect(readsOf(s.file(P2), from)).toBeGreaterThanOrEqual(1);
  });

  // M2's review, finding 3: an agent listed under a parent while the parent's read is out is read for when it lands
  it('reads a parent again for an agent listed under it while its read was out', async () => {
    const N2 = 'a0b1c2d3e4f5000n2';
    const forked = { toolUseId: undefined, requestShape: undefined }; // no call: the rows say nothing of them
    const s = await session({ main: chatter(1), files: { [P]: chatter(2) }, entries: (dir) => [entry(dir, P, forked), nested(dir, N, P, forked)], hold: [P] });
    await expect.poll(() => counts.timeline.includes(`held ${s.file(P)}`)).toBe(true); // its first read has read the file, and is out
    s.listing.change([entry(s.dir, P, forked), nested(s.dir, N, P, forked), nested(s.dir, N2, P)]);
    appendFileSync(s.file(P), launched(N2, 3)); // after that read
    await expect.poll(() => statusOf(s.h.planes, s.watch, N2)).toBe('unknown/none');
    s.releaseFile(P);
    await expect.poll(() => statusOf(s.h.planes, s.watch, N2)).toBe('running/rows');
    expect(readsOf(s.file(P))).toBeGreaterThanOrEqual(2);
  });

  // M2's re-review: the same nested entry goes and comes back while its parent's read is out
  it('reads a parent again when the agent under it is unlisted and listed again while its read was out', async () => {
    const forked = { toolUseId: undefined, requestShape: undefined };
    const s = await session({ main: chatter(1), files: { [P]: '' }, entries: (dir) => [entry(dir, P, forked), nested(dir, N, P)], hold: [P] });
    await expect.poll(() => counts.timeline.includes(`held ${s.file(P)}`)).toBe(true); // its first read has read the empty file, and is out
    s.listing.change([entry(s.dir, P, forked)]);
    await expect.poll(() => agentsOf(s.h.planes, s.watch).map((a) => a.agentId)).toEqual([P]);
    appendFileSync(s.file(P), launched(N, 2)); // after that read
    s.listing.change([entry(s.dir, P, forked), nested(s.dir, N, P)]);
    await expect.poll(() => statusOf(s.h.planes, s.watch, N)).toBe('unknown/none');
    s.releaseFile(P);
    await expect.poll(() => statusOf(s.h.planes, s.watch, N)).toBe('running/rows');
    expect(readsOf(s.file(P))).toBeGreaterThanOrEqual(2);
  });

  // M2's review, finding 5
  it.each([
    ['the session is dropped', (s: Awaited<ReturnType<typeof session>>) => s.h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: { kind: 'none' } })],
    ['its watch is replaced', (s: Awaited<ReturnType<typeof session>>) => {
      s.h.driver.unwatch(APP, s.watch);
      s.h.driver.watch(APP, client());
    }],
  ])('logs nothing for a main read that fails after its follow ended: %s', async (_how, end) => {
    const s = await session({ main: launched(A1, 1), entries: (dir) => [entry(dir, A1)] });
    await expect.poll(() => statusOf(s.h.planes, s.watch, A1)).toBe('running/rows');
    const located = s.located();
    s.hold();
    await expect.poll(() => s.located()).toBeGreaterThan(located); // a tick's read is out
    end(s);
    s.release(new Error('the transcript went away'));
    await new Promise((resolve) => setTimeout(resolve, 150)); // the rejection lands
    expect(s.h.logs.filter((line) => line.includes('could not be read for its jobs'))).toEqual([]);
  });

  it('subscribes to the engine host’s listing once, and lets it go when the driver stops', async () => {
    const listing = new Listing([]);
    const h = harness(undefined, {}, null, listing.deps);
    expect(listing.listeners()).toBe(2);
    h.driver.stop();
    expect(listing.listeners()).toBe(0);
  });
});

describe('controls', () => {
  async function liveBridge(options: Partial<Parameters<typeof startFakeBridge>[0]> = {}) {
    const b = await bridge(options);
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    await expect.poll(() => b.subscribers()).toBe(1);
    return { b, h };
  }

  it('posts each control’s exact body with the launch', async () => {
    const { b, h } = await liveBridge();
    b.answer('command', () => ({ status: 200, body: { ok: true, result: { queued: true, route: 'run', id: 'cmd-x' } } }));
    b.answer('btw', () => ({ status: 200, body: { ok: true, result: { started: true, id: 'cmd-y' } } }));
    b.answer('compact', () => ({ status: 200, body: { ok: true, result: { started: true } } }));
    expect(await h.driver.interrupt(APP)).toMatchObject({ state: 'done' });
    expect(await h.driver.command(APP, 'rename', 'o9')).toEqual({ state: 'done', result: { queued: true, route: 'run', id: 'cmd-x' } });
    expect(await h.driver.btw(APP, 'why?')).toEqual({ state: 'done', result: { started: true, id: 'cmd-y' } });
    const compact = await h.driver.compact(APP, 'keep the file list');
    expect(compact).toMatchObject({ state: 'done', result: { started: true } });
    expect((compact as { result: { id: string } }).result.id).toMatch(/^cmd-/); // the op's id in its later compact messages
    await h.driver.compact(APP);
    await h.driver.stopAgent(APP, 'agent-1');
    await h.driver.tell(APP, 'agent-1', 'stop there');
    await h.driver.stopTask(APP, 'task-1');
    expect(b.commands.map((c) => c.body)).toEqual([
      { op: 'interrupt' },
      { op: 'command', name: 'rename', args: 'o9' },
      { op: 'btw', prompt: 'why?' },
      { op: 'compact', instructions: 'keep the file list' },
      { op: 'compact' },
      { op: 'stop-agent', agentId: 'agent-1' },
      { op: 'tell', agentId: 'agent-1', text: 'stop there' },
      { op: 'stop', taskId: 'task-1' },
    ]);
  });

  it('is refused launch for a session’s earlier process', async () => {
    const { b, h } = await liveBridge();
    b.setStatus({ launch: 'launch-2' }); // the child is another launch now; the driver still holds the first
    expect(await h.driver.interrupt(APP)).toMatchObject({ state: 'refused', code: 'launch' });
  });

  it('answers unknown on a 504 or a lost socket, naming the op’s id when the bridge gave one', async () => {
    const { b, h } = await liveBridge();
    b.answer('interrupt', () => ({ status: 504, body: { error: 'the session did not answer within 10000 ms' } }));
    expect(await h.driver.interrupt(APP)).toMatchObject({ state: 'unknown', why: 'timeout', id: expect.stringMatching(/^cmd-/) as unknown });
    b.answer('btw', () => ({ drop: true }));
    expect(await h.driver.btw(APP, 'q')).toEqual({ state: 'unknown', why: 'gone' });
    expect(b.commands.filter((c) => c.op === 'btw')).toHaveLength(1); // never retried
  });

  it('changes the model alone, keeping the effort read fresh, and the effort alone', async () => {
    const { b, h } = await liveBridge();
    b.emit({ type: 'model', model: null, effort: 'high' }); // set in the terminal meanwhile
    expect(await h.driver.model(APP, { model: 'claude-haiku-4-5' })).toMatchObject({ state: 'done' });
    expect(await h.driver.model(APP, { effort: 'low' })).toMatchObject({ state: 'done' });
    expect(b.commands.map((c) => c.body)).toEqual([
      { op: 'read', what: 'status' },
      { op: 'model', model: 'claude-haiku-4-5', effort: 'high' },
      { op: 'read', what: 'status' },
      { op: 'model', model: 'claude-haiku-4-5', effort: 'low' },
    ]);
  });

  it('reads a kind the bridge serves, and refuses rows locally', async () => {
    const { b, h } = await liveBridge();
    b.answer('read', (body) => ({ status: 200, body: { ok: true, result: { what: body.what } } }));
    expect(await h.driver.read(APP, 'mcp')).toEqual({ ok: true, result: { what: 'mcp' } });
    expect(await h.driver.read(APP, 'rows')).toMatchObject({ ok: false, code: 'unsupported' });
    expect(b.commands.at(-1)?.body).toEqual({ op: 'read', what: 'mcp' });
  });
});

describe('sends', () => {
  async function liveBridge() {
    const b = await bridge();
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    await expect.poll(() => b.subscribers()).toBe(1);
    return { b, h };
  }
  const writer = `maws/${MACHINE}`;

  it('delivers under the next key and answers entered, with the row', async () => {
    const { b, h } = await liveBridge();
    expect(await h.driver.send(APP, 'list the files')).toEqual({ key: { writer, seq: 1 }, state: 'entered', uuid: 'row-1' });
    expect(await h.driver.send(APP, 'and count them')).toEqual({ key: { writer, seq: 2 }, state: 'entered', uuid: 'row-2' });
    expect(b.commands.map((c) => c.body)).toEqual([
      { op: 'deliver', key: { writer, seq: 1 }, text: 'list the files' },
      { op: 'deliver', key: { writer, seq: 2 }, text: 'and count them' },
    ]);
    expect(h.state()?.deliveries.map((d) => [d.key.seq, d.state])).toEqual([[1, 'entered'], [2, 'entered']]);
  });

  it('refuses a slash text, and ends a refused busy append refused with the reason', async () => {
    const { b, h } = await liveBridge();
    expect(await h.driver.send(APP, '/clear')).toEqual({ key: null, state: 'refused', reason: 'a slash command goes as a command, not as words', code: 'bad-args' });
    b.answer('deliver', (body) => {
      b.emit({ type: 'delivered', key: body.key, outcome: 'submitted' });
      b.emit({ type: 'delivered', key: body.key, outcome: 'refused', reason: 'the row was refused: a hook denied it' });
      return { status: 200, body: { ok: true, result: { submitted: true } } };
    });
    expect(await h.driver.send(APP, 'words')).toEqual({ key: { writer, seq: 1 }, state: 'refused', reason: 'the row was refused: a hook denied it' });
  });

  it('makes a send unconfirmed when the state stream is lost while it is submitted', async () => {
    const { b, h } = await liveBridge();
    b.answer('deliver', () => ({ status: 200, body: { ok: true, result: { submitted: true } } })); // the fate never comes
    const answer = h.driver.send(APP, 'words');
    await expect.poll(() => h.state()?.deliveries[0]?.state).toBe('submitted');
    b.reset();
    expect(await answer).toMatchObject({ key: { writer, seq: 1 }, state: 'unconfirmed' });
  });

  it('retries a timed-out deliver under the same key, the retry answered duplicate', async () => {
    const { b, h } = await liveBridge();
    let posts = 0;
    b.answer('deliver', (body) => {
      posts += 1;
      if (posts === 1) return { status: 504, body: { error: 'the session did not answer' } };
      b.emit({ type: 'delivered', key: body.key, outcome: 'entered', uuid: 'row-late' });
      return { status: 200, body: { ok: true, result: { submitted: true } } };
    });
    // the fake's mark took the first copy, so the retry is answered duplicate before the script runs again
    const answer = await h.driver.send(APP, 'words');
    expect(b.commands.map((c) => c.body)).toEqual([
      { op: 'deliver', key: { writer, seq: 1 }, text: 'words' },
      { op: 'deliver', key: { writer, seq: 1 }, text: 'words' },
    ]);
    expect(answer).toMatchObject({ key: { writer, seq: 1 }, state: 'submitted' });
  });
});

describe('decisions', () => {
  async function raised(raise: Parameters<FakeBridge['raise']>[0], options: Partial<Parameters<typeof startFakeBridge>[0]> = {}) {
    const b = await bridge(options);
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    await expect.poll(() => b.subscribers()).toBe(1);
    b.raise(raise);
    await expect.poll(() => h.state()?.pending.map((p) => p.request)).toEqual([raise.request]);
    return { b, h };
  }
  const rule = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' };

  it('posts a scoped allow with the request’s one suggestion, by maws, with the launch, after re-reading the request', async () => {
    const { b, h } = await raised({ request: 'toolu_1', tool: 'Bash', input: { command: 'npm test' }, suggestions: [rule] });
    expect(await h.driver.answer(APP, 'toolu_1', { kind: 'permission', decision: 'allow', scope: 'session' })).toEqual({ outcome: 'delivered' });
    expect(b.requestReads).toEqual(['toolu_1']);
    expect(b.decisions).toEqual([{ request: 'toolu_1', body: { behavior: 'allow', updatedPermissions: [{ ...rule, destination: 'session' }], by: 'maws', launch: 'launch-1' } }]);
  });

  it('answers a decision on a settled request with its settlement, posting nothing', async () => {
    const { b, h } = await raised({ request: 'toolu_1', tool: 'Bash', input: {} });
    b.settle('toolu_1', 'terminal', 'allow');
    await expect.poll(() => h.state()?.pending).toEqual([]);
    expect(await h.driver.answer(APP, 'toolu_1', { kind: 'permission', decision: 'allow', scope: 'once' })).toEqual({
      outcome: 'not_pending', settled: { request: 'toolu_1', winner: 'terminal', outcome: 'allow', by: 'terminal', t: expect.any(Number) as unknown }, message: 'already answered: allow by terminal',
    });
    expect(b.decisions).toEqual([]);
  });

  it('reads the terminal winning the race as its settlement, never an error', async () => {
    const { b, h } = await raised({ request: 'toolu_1', tool: 'Bash', input: {} });
    b.answer('decision', () => ({ status: 409, body: { error: 'the terminal answered it; its settlement follows', winner: 'terminal', by: 'terminal' } }));
    expect(await h.driver.answer(APP, 'toolu_1', { kind: 'permission', decision: 'deny' })).toEqual({
      outcome: 'not_pending', settled: { winner: 'terminal', by: 'terminal' }, message: 'the terminal answered it; its settlement follows',
    });
    b.answer('decision', () => ({ status: 409, body: { error: 'the window closed; the terminal answers it', terminalOnly: true } }));
    expect(await h.driver.answer(APP, 'toolu_1', { kind: 'permission', decision: 'deny' })).toMatchObject({ outcome: 'not_pending', terminalOnly: true });
  });

  it('refuses a variant lane A can’t carry before anything is posted', async () => {
    const { b, h } = await raised({ request: 'toolu_1', tool: 'Bash', input: {}, suggestions: [rule, rule] });
    expect(await h.driver.answer(APP, 'toolu_1', { kind: 'permission', decision: 'allow', scope: 'session' })).toMatchObject({ outcome: 'refused', code: 'unsupported' });
    expect(await h.driver.answer(APP, 'toolu_1', { kind: 'permission', decision: 'deny_and_stop' })).toEqual({ outcome: 'refused', code: 'unsupported', message: 'deny-and-interrupt is answered in the terminal' });
    expect(b.decisions).toEqual([]);
  });

  it('answers a native question with its answers', async () => {
    const { b, h } = await raised({ request: 'toolu_q', tool: 'AskUserQuestion', input: { questions: [{ question: 'Which?' }] } });
    expect(await h.driver.answer(APP, 'toolu_q', { kind: 'question', answers: { 'Which?': 'A' } })).toEqual({ outcome: 'delivered' });
    expect(b.decisions[0]?.body).toEqual({ behavior: 'allow', updatedInput: { answers: { 'Which?': 'A' } }, by: 'maws', launch: 'launch-1' });
  });

  // U1a §G: the bridge's dismissal of an asynchronous question (sminos 1.47.0), and what the driver makes of each answer
  const asyncQ = { request: 'toolu_plugin_1', tool: 'mcp__sminos__AskUserQuestion', input: { questions: [{ question: 'Which?' }] }, async: true as const };
  const DISMISSING = { ...FULL_CAPABILITIES, controls: { ...FULL_CAPABILITIES.controls, 'decide.dismiss': { available: true } } };
  const dismiss = { kind: 'permission', decision: 'deny' } as const;

  it('posts an asynchronous question’s dismissal by maws with the launch and no other key, where the bridge declares it', async () => {
    const { b, h } = await raised(asyncQ, { capabilities: DISMISSING });
    expect(await h.driver.answer(APP, 'toolu_plugin_1', dismiss)).toEqual({ outcome: 'delivered' });
    expect(b.decisions).toEqual([{ request: 'toolu_plugin_1', body: { behavior: 'dismiss', by: 'maws', launch: 'launch-1' } }]);
  });

  it('refuses a dismissal the bridge does not declare before anything is posted', async () => {
    const { b, h } = await raised(asyncQ);
    expect(await h.driver.answer(APP, 'toolu_plugin_1', dismiss)).toEqual({ outcome: 'refused', code: 'unsupported', message: 'dismiss it in the terminal' });
    expect(b.decisions).toEqual([]);
  });

  it('reads a dismissal an older bridge answers 400 as refused with its sentence: the question still waits, nothing is told', async () => {
    const { b, h } = await raised(asyncQ, { capabilities: DISMISSING });
    b.setStatus({ capabilities: FULL_CAPABILITIES }); // replaced by a bridge before 1.47.0; the driver still holds the newer status
    const told: string[] = [];
    h.driver.onAccepted((_appId, request) => void told.push(request));
    expect(await h.driver.answer(APP, 'toolu_plugin_1', dismiss)).toEqual({ outcome: 'refused', code: 'bad-args', message: 'behavior is allow or deny' });
    expect(h.state()?.pending.map((p) => p.request)).toEqual(['toolu_plugin_1']);
    expect(told).toEqual([]);
  });

  it('reads a decision answered 404 as no longer pending, and 503 as unknown', async () => {
    const { b, h } = await raised({ request: 'toolu_1', tool: 'Bash', input: {} });
    b.answer('decision', () => ({ status: 404, body: { error: 'no request toolu_1 is pending in this session' } }));
    expect(await h.driver.answer(APP, 'toolu_1', { kind: 'permission', decision: 'deny' })).toEqual({ outcome: 'not_pending', settled: null, message: 'no request toolu_1 is pending in this session' });
    b.answer('decision', () => ({ status: 503, body: { error: 'the session is gone' } }));
    expect(await h.driver.answer(APP, 'toolu_1', { kind: 'permission', decision: 'deny' })).toEqual({ outcome: 'unknown', why: 'gone' });
  });

  // Decision 8: a 409 that names no winner (the mod refused a relayed answer or dismissal) leaves the request pending at
  // the bridge, so the driver reads the request again before it says anything; each course with the re-read held open
  const reread = [
    ['still pending: refused with the bridge’s sentence', { status: 200, body: { ...asyncQ, session: ENGINE } }, { outcome: 'refused', code: 'refused', message: 'the session refused the dismissal' }],
    ['settled meanwhile: no longer pending, with its settlement', { status: 410, body: { error: 'settled', settled: { request: 'toolu_plugin_1', winner: 'terminal', outcome: 'withdrawn', by: 'terminal' } } },
      { outcome: 'not_pending', settled: { request: 'toolu_plugin_1', winner: 'terminal', outcome: 'withdrawn', by: 'terminal' }, message: 'already answered: withdrawn by terminal' }],
    ['unanswered: unknown', { drop: true }, { outcome: 'unknown', why: 'gone' }],
  ] as const;
  it.each(reread)('reads the request again after a bare 409 and says what it finds: %s', async (_course, reply, outcome) => {
    const { b, h } = await raised(asyncQ, { capabilities: DISMISSING });
    let release: (reply: FakeReply) => void = () => {};
    const held = new Promise<FakeReply>((resolve) => (release = resolve));
    b.answer('decision', () => {
      b.answer('request', () => held); // the re-read, not the read before the decision
      return { status: 409, body: { error: 'the session refused the dismissal' } };
    });
    let said = false;
    const answered = h.driver.answer(APP, 'toolu_plugin_1', dismiss).finally(() => (said = true));
    await expect.poll(() => b.requestReads).toEqual(['toolu_plugin_1', 'toolu_plugin_1']);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(said).toBe(false); // nothing is said while the re-read is out
    release(reply as FakeReply);
    expect(await answered).toEqual(outcome);
    expect(b.decisions).toEqual([]);
  });

  it('reads a bare 409 again for every decision, a permission’s allow too', async () => {
    const { b, h } = await raised({ request: 'toolu_1', tool: 'Bash', input: {} });
    b.answer('decision', () => ({ status: 409, body: { error: 'the session could not take it' } }));
    expect(await h.driver.answer(APP, 'toolu_1', { kind: 'permission', decision: 'allow', scope: 'once' })).toEqual({ outcome: 'refused', code: 'refused', message: 'the session could not take it' });
    expect(b.requestReads).toEqual(['toolu_1', 'toolu_1']);
  });

  it('reads a decision answered 504 as unknown: an async question’s answer may have gone to the mod', async () => {
    const { b, h } = await raised({ request: 'toolu_plugin_1', tool: 'mcp__sminos__AskUserQuestion', input: { questions: [{ question: 'Which?' }] }, async: true });
    b.answer('decision', () => ({ status: 504, body: { id: 'cmd-9', error: 'the session did not answer within 5000 ms' } }));
    expect(await h.driver.answer(APP, 'toolu_plugin_1', { kind: 'question', answers: { 'Which?': 'A' } })).toEqual({ outcome: 'unknown', why: 'timeout' });
  });
});

// UC-1 (U1a's Interfaces §B, "One holder"): the bridge publishes nothing when it takes an answer, so the driver tells its
// listeners (the lane A list) who heard the 200: its own answer, or this machine's endpoint through `laneA.accepted`.
describe('an answer the bridge took', () => {
  async function driving() {
    const b = await bridge();
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    await expect.poll(() => b.subscribers()).toBe(1);
    b.raise({ request: 'toolu_1', tool: 'Bash', input: { command: 'echo made-up' } });
    await expect.poll(() => h.state()?.pending.map((p) => p.request)).toEqual(['toolu_1']);
    const told: Array<[AppSessionId, string]> = [];
    h.driver.onAccepted((appId, request) => void told.push([appId, request]));
    return { b, h, told };
  }

  it('is told once by the driver’s own delivered answer, and never by a refused, settled or unknown one', async () => {
    const { b, h, told } = await driving();
    b.answer('decision', () => ({ status: 409, body: { error: 'the terminal answered it; its settlement follows', winner: 'terminal', by: 'terminal' } }));
    await h.driver.answer(APP, 'toolu_1', { kind: 'permission', decision: 'allow', scope: 'once' });
    b.answer('decision', () => ({ status: 504, body: { error: 'the session did not answer within 5000 ms' } }));
    await h.driver.answer(APP, 'toolu_1', { kind: 'permission', decision: 'allow', scope: 'once' });
    await h.driver.answer(APP, 'toolu_1', { kind: 'permission', decision: 'deny_and_stop' });
    expect(told).toEqual([]);
    b.answer('decision', () => ({ status: 200, body: { accepted: true } }));
    expect(await h.driver.answer(APP, 'toolu_1', { kind: 'permission', decision: 'allow', scope: 'once' })).toEqual({ outcome: 'delivered' });
    expect(told).toEqual([[APP, 'toolu_1']]);
  });

  it('is told by laneA.accepted naming the engine session it drives, and by none naming another', async () => {
    const { h, told } = await driving();
    const handlers = new Map<string, (input: unknown, ctx: unknown) => unknown>();
    registerLaneA(h.driver, ((name: string, handler: (input: unknown, ctx: unknown) => unknown) => void handlers.set(name, handler)) as never);
    handlers.get('laneA.accepted')!({ session: 'e5b1c0de-0000-4000-8000-00000000ffff', request: 'toolu_1' }, {});
    expect(told).toEqual([]);
    handlers.get('laneA.accepted')!({ session: ENGINE, request: 'toolu_1' }, {});
    expect(told).toEqual([[APP, 'toolu_1']]);
  });
});

// Fix wave 1, finding 1: an operation keeps the launch it was admitted under through every post and retry.
describe('the launch an operation was admitted under', () => {
  async function liveBridge() {
    const b = await bridge();
    const h = harness(undefined, { lane: { retryDelaysMs: [300, 300], answerMs: 3000, keepMs: 2000, capacity: 8 } });
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    await expect.poll(() => b.subscribers()).toBe(1);
    return { b, h };
  }
  const writer = `maws/${MACHINE}`;

  it('refuses a send’s retry launch once the session’s process changed, never retargeting it', async () => {
    const { b, h } = await liveBridge();
    b.answer('deliver', () => {
      b.setStatus({ launch: 'launch-2' }); // a new process holds the session; rediscovery reads it before the retry
      b.reset();
      return { status: 504, body: { error: 'the session did not answer' } };
    });
    const answer = h.driver.send(APP, 'words');
    await expect.poll(() => h.state()?.launch).toBe('launch-2');
    expect(await answer).toMatchObject({ key: { writer, seq: 1 }, state: 'refused', code: 'launch' });
    expect(b.commands.filter((c) => c.op === 'deliver')).toHaveLength(1); // the retry was fenced before the mod
  });

  it('recovers a send whose bridge child restarted within the same launch', async () => {
    const { b, h } = await liveBridge();
    let next: FakeBridge | null = null;
    b.answer('deliver', () => {
      setTimeout(() => void b.close().then(async () => (next = await bridge({ launch: 'launch-1' }))), 0);
      return { drop: true };
    });
    const answer = h.driver.send(APP, 'words');
    await expect.poll(() => next?.commands.length ?? 0, { timeout: 3000 }).toBe(1);
    expect(next!.commands[0]!.body).toEqual({ op: 'deliver', key: { writer, seq: 1 }, text: 'words' });
    expect((await answer).state).not.toBe('refused');
  });

  // Fix wave 2: discovery closing an active state stream is a lost stream too.
  it('makes a submitted send unconfirmed when discovery drops its bridge and a replacement comes up under the same launch', async () => {
    const { b, h } = await liveBridge();
    b.answer('deliver', () => ({ status: 200, body: { ok: true, result: { submitted: true } } })); // no fate follows
    const answer = h.driver.send(APP, 'words');
    await expect.poll(() => h.state()?.deliveries[0]?.state).toBe('submitted');
    rmSync(b.socket); // the socket goes while the old stream stays open: discovery finds no bridge and closes it
    await expect.poll(() => h.state(), { timeout: 3000 }).toBeNull();
    await bridge({ launch: 'launch-1' }); // the replacement, under the same launch
    await h.live();
    expect(await answer).toMatchObject({ key: { writer, seq: 1 }, state: 'unconfirmed' });
    expect(h.state()?.deliveries[0]).toMatchObject({ state: 'unconfirmed' });
  });

  it('posts a model change’s read and change under one launch', async () => {
    const { b, h } = await liveBridge();
    b.answer('read', async () => {
      b.setStatus({ launch: 'launch-2' });
      b.reset();
      await expect.poll(() => h.state()?.launch).toBe('launch-2'); // rediscovered between the read and the change
      return { status: 200, body: { ok: true, result: { override: null } } };
    });
    expect(await h.driver.model(APP, { effort: 'low' })).toMatchObject({ state: 'refused', code: 'launch' });
    expect(b.commands.map((c) => c.op)).toEqual(['read']);
  });
});

// P5 O9 M6: what main's attention and digest read of each session.
describe('the view main’s own consumers follow', () => {
  it('tells each change, the stream’s currency and the main loop’s tool, and null when the session leaves', async () => {
    const b = await bridge();
    const h = harness();
    const views: (LaneAView | null)[] = [];
    h.driver.onChange((appId, view) => appId === APP && views.push(view));
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await expect.poll(() => views.at(-1)?.fresh, { timeout: 3000 }).toBe(true);
    b.raise({ request: 'toolu_r1', tool: 'Bash', input: { command: 'ls' } });
    await expect.poll(() => views.at(-1)?.state.pending.map((p) => p.request)).toEqual(['toolu_r1']);
    b.emit({ type: 'turn', phase: 'start', turnId: 't1', agentId: null });
    b.emit({ type: 'tool', phase: 'call', toolUseId: 'u1', tool: 'Read', agentId: null, input: { file_path: '/a/b.ts' } });
    await expect.poll(() => views.at(-1)?.tool).toEqual({ tool: 'Read', input: { file_path: '/a/b.ts' }, running: true });
    b.reset(); // the stream ends: what it said of the requests is no longer current, until its next snapshot
    await expect.poll(() => views.some((v) => v !== null && !v.fresh && v.state.pending.length === 1)).toBe(true);
    await expect.poll(() => views.at(-1)?.fresh, { timeout: 3000 }).toBe(true);
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: { kind: 'none' } });
    expect(views.at(-1)).toBeNull();
  });
});

// P5 O9 M7: an upload through the bridge's `media` op, saved under the session's own directory (a scratch repository).
describe('media', () => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const PDF = Buffer.from('%PDF-1.4\n%%EOF\n').toString('base64');
  const files = [{ name: 'shot.png', mediaType: 'image/png', data: PNG }, { name: 'notes.pdf', mediaType: 'application/pdf', data: PDF }];

  async function liveIn(cwd: string, options: Partial<Parameters<typeof startFakeBridge>[0]> = {}) {
    const b = await bridge({ sessionInfo: { session: ENGINE, cwd, model: 'claude-opus-4-5', version: '2.1.300' }, ...options });
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    return { b, h };
  }

  async function repo(): Promise<GitFixture> {
    const f = await GitFixture.create();
    scratch.push(f.root, f.home);
    return f;
  }

  it('reads where the session works, saves the files there and posts media naming them, the exclude entry added and the root recorded', async () => {
    const f = await repo();
    const { b, h } = await liveIn(f.root);
    const result = await h.driver.media(APP, files);
    const root = join(f.root, '.claude', 'desk-uploads', ENGINE);
    expect(result).toMatchObject({ state: 'done', result: { root } });
    const upload = (result as { result: { upload: string } }).result.upload;
    expect(upload).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(b.commands.map((c) => c.body)).toEqual([
      { op: 'read', what: 'status' },
      {
        op: 'media', upload, root, files: [
          { n: 0, path: join(root, `${upload}.0.png`), name: 'shot.png', mediaType: 'image/png' },
          { n: 1, path: join(root, `${upload}.1.pdf`), name: 'notes.pdf', mediaType: 'application/pdf' },
        ],
      },
    ]);
    expect(readFileSync(join(root, `${upload}.0.png`)).toString('base64')).toBe(PNG);
    expect(readFileSync(join(root, `${upload}.1.pdf`)).toString('base64')).toBe(PDF);
    expect(readFileSync(join(f.root, '.git', 'info', 'exclude'), 'utf8')).toContain('**/.claude/desk-uploads/');
    expect(JSON.parse(readFileSync(join(process.env.MAWS_USER_DATA!, 'lane-a', 'uploads.json'), 'utf8')).roots).toEqual([{ path: root, session: ENGINE, at: expect.any(String) as unknown }]);
  });

  it('refuses what the bridge would not take before anything is written or posted', async () => {
    const f = await repo();
    const { b, h } = await liveIn(f.root);
    expect(await h.driver.media(APP, Array.from({ length: 5 }, () => files[0]!))).toMatchObject({ state: 'refused', code: 'bad-args' });
    expect(await h.driver.media(APP, [{ name: 'fake.png', mediaType: 'image/png', data: PDF }])).toMatchObject({ state: 'refused', code: 'bad-args', message: expect.stringContaining('fake.png') as unknown });
    expect(b.commands).toEqual([]);
    expect(existsSync(join(f.root, '.claude'))).toBe(false);
  });

  it('takes the files back when the bridge refuses the upload', async () => {
    const f = await repo();
    const { b, h } = await liveIn(f.root);
    b.answer('media', () => ({ status: 200, body: { ok: false, error: 'the upload could not be kept in the session state' } }));
    expect(await h.driver.media(APP, files)).toMatchObject({ state: 'refused', message: 'the upload could not be kept in the session state' });
    expect(existsSync(join(f.root, '.claude', 'desk-uploads', ENGINE))).toBe(false);
  });

  it('posts a lost answer again under the same upload, a duplicate meaning the bridge holds it; all lost is unknown and the files stay', async () => {
    const f = await repo();
    const { b, h } = await liveIn(f.root);
    let posts = 0;
    b.answer('media', (body) => (++posts === 1 ? { status: 504, body: { error: 'the session did not answer' } } : { status: 200, body: { ok: true, result: { duplicate: true, upload: body.upload } } }));
    expect(await h.driver.media(APP, files)).toMatchObject({ state: 'done' });
    const sent = b.commands.filter((c) => c.op === 'media').map((c) => c.body.upload);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe(sent[0]);

    b.answer('media', () => ({ drop: true }));
    const lost = await h.driver.media(APP, [files[0]!]);
    expect(lost).toMatchObject({ state: 'unknown', why: 'timeout' });
    const upload = (lost as { id: string }).id;
    expect(b.commands.filter((c) => c.op === 'media' && c.body.upload === upload)).toHaveLength(3);
    expect(existsSync(join(f.root, '.claude', 'desk-uploads', ENGINE, `${upload}.0.png`))).toBe(true);
  });

  it('is refused, with the bridge’s reason, for a session whose bridge closes media', async () => {
    const f = await repo();
    const closed = { ...FULL_CAPABILITIES, controls: { ...FULL_CAPABILITIES.controls, media: { available: false, reason: 'this engine takes no desk uploads' } } };
    const { b, h } = await liveIn(f.root, { capabilities: closed });
    expect(await h.driver.media(APP, files)).toEqual({ state: 'refused', code: 'unsupported', message: 'this engine takes no desk uploads' });
    expect(b.commands).toEqual([]);
  });

  it('fences the read of where the session works by the launch, so nothing is saved for another process', async () => {
    const f = await repo();
    const { b, h } = await liveIn(f.root);
    b.setStatus({ launch: 'launch-2' });
    expect(await h.driver.media(APP, files)).toMatchObject({ state: 'refused', code: 'launch' });
    expect(b.commands).toEqual([]); // the fake fences before it records, as the child does before it acts
    expect(existsSync(join(f.root, '.claude'))).toBe(false);
  });
});

// 2026-11-06 (the remote lane A drill-in): `laneA.watch`'s `agentId` is a remote session's (main's remote adapter, over
// `rl2.agent-scope`); this machine's drill-in reads the agent's transcript from the disk, so the driver refuses one rather
// than watch the main loop in its place.
describe('registration', () => {
  it('refuses a watch of one subagent’s transcript, watching nothing', () => {
    const handlers = new Map<string, (input: unknown, ctx: unknown) => unknown>();
    const watch = vi.fn(() => ({ watch: 'w1' }));
    registerLaneA({ watch } as unknown as LaneADriver, ((name: string, handler: (input: unknown, ctx: unknown) => unknown) => void handlers.set(name, handler)) as never);
    const ctx = { client: endableClientRef('page') };
    expect(() => handlers.get('laneA.watch')!({ appSessionId: 'app-1', agentId: 'ab5e2e00000000001' }, ctx)).toThrow(/subagent/);
    expect(watch).not.toHaveBeenCalled();
    expect(handlers.get('laneA.watch')!({ appSessionId: 'app-1' }, ctx)).toEqual({ watch: 'w1' });
  });
});
