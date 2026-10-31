// O16 M5: the verified-empty release end to end inside the engine host (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md,
// M5 and acceptance 2): the process table's idle and budget releases through each row's reap, over a real gate and a
// fake observer on a real Unix socket, with scripted sessions and the table's `ps` stood in by a tree the test writes:
// the observer's arm before any signal and its turn cancelling, a silent observer holding the row, the work under the
// engine read at each sample and again at the step, the registrations (the bridge child by the observer's pid, the MCP
// servers by `mcp_status`), the gate's counts, and the observer seen kept in the state file.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { handshakeResponder, scriptedSession } from '../conformance/session-harness';
import { ProcessTable } from '../process-table';
import { MemorySessionStateStore } from '../store/memory-session-state-store';
import { FakeObserver } from './fake-observer';
import { Gate } from './gate';

const IDLE_MS = 300;
const SILENCE_MS = 200;
const ENGINE = 700;
const PINNED = '33333333-3333-4333-8333-333333333333'; // the harness's pinned engine session id
const SERVER = ['/usr/bin/node', '/tmp/o16-mcp.mjs', 'user'];

let root: string;
let gate: Gate;
let path: string;
let tree: string[];
const observers: FakeObserver[] = [];
const tables: ProcessTable[] = [];

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'maws-release-'));
  path = join(root, 'supervisor', 'gate.sock');
  gate = new Gate({ log: () => {}, silenceMs: SILENCE_MS });
  await gate.listen(path);
  tree = [];
});
afterEach(async () => {
  for (const o of observers.splice(0)) if (!o.isClosed) await o.close();
  for (const t of tables.splice(0)) t.setIdleRelease({ idleMs: null, active: false });
  await gate.close();
  rmSync(root, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (check: () => boolean, what: string, ms = 3_000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
};
const proc = (pid: number, ppid: number, command: string, stat = 'S') => `${pid} ${ppid} 1024 ${stat} ${command}`;

async function rows(names: string[], opts: { mcp?: string[][]; store?: MemorySessionStateStore; psSync?: () => string } = {}) {
  const logs: string[] = [];
  const table = new ProcessTable({ ps: async () => tree.join('\n'), psSync: opts.psSync, sampleMs: 60_000, gate, log: (line) => void logs.push(line) });
  tables.push(table);
  const servers = (opts.mcp ?? []).map(([command, ...args], i) => ({ name: `s${i}`, status: 'connected', config: { type: 'stdio', command, args } }));
  const s = Object.fromEntries(names.map((name, i) => {
    const x = scriptedSession({
      spec: { appSessionId: name as AppSessionId, sessionId: `${PINNED.slice(0, -1)}${i}` as never },
      transport: { pid: ENGINE + i },
      responder: handshakeResponder({ end_session: () => null, mcp_status: () => ({ response: { mcpServers: servers } }) }),
      session: opts.store ? { store: opts.store } : {},
    });
    table.reserve(name as AppSessionId, () => x.session);
    return [name, x];
  }));
  await Promise.all(Object.values(s).map((x) => x.session.start()));
  return { table, s, logs };
}
type Row = Awaited<ReturnType<typeof rows>>['s'][string];
const engineIdOf = (x: Row) => x.session.status().engineSessionId!;
const releasing = (x: Row) => x.transport.requestsOf('end_session').length > 0;

async function observe(x: Row, opts: { childPid?: number; beat?: boolean } = {}): Promise<FakeObserver> {
  const o = await FakeObserver.connect(path);
  observers.push(o);
  o.hello(engineIdOf(x), { pid: x.session.pid, childPid: opts.childPid ?? null });
  await o.next('welcome');
  if (opts.beat !== false) o.beat(50);
  return o;
}

describe('the idle release through the gate', () => {
  it('a row whose observer is healthy is armed first and released only after armed', async () => {
    const { table, s } = await rows(['a']);
    const o = await observe(s.a!);
    await until(() => s.a!.session.status().reap?.observer === 'healthy', 'the observer in the status');
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    const arm = await o.next('arm', IDLE_MS + 1_000);
    expect(arm).toEqual({ t: 'arm', fence: 1, leaseMs: 10_000 });
    expect(s.a!.session.status().reap).toEqual({ state: 'arming', observer: 'healthy' });
    expect(table.gateCounts()).toEqual({ armed: 1, observed: 1, unhealthy: 0, absent: 0 });
    await sleep(50);
    expect(releasing(s.a!)).toBe(false);
    o.send({ t: 'armed', fence: 1 });
    await until(() => releasing(s.a!), 'the reap’s end_session');
    o.send({ t: 'turn', fence: 1, origin: 'cron' });
    expect(await o.next('stop')).toMatchObject({ t: 'stop', fence: 1 });
    s.a!.transport.exit(0);
    await s.a!.session.exited;
    expect(s.a!.session.status().exit).toMatchObject({ reason: 'idle' });
    expect(table.takeReleased('a' as AppSessionId)).toBe(true);
    await o.closed; // the row's channel closed with its process
  });

  it('a turn after the arm is answered proceed: the row is not released and its clock starts again', async () => {
    const { table, s } = await rows(['a']);
    const o = await observe(s.a!);
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await o.next('arm', IDLE_MS + 1_000);
    const turnAt = Date.now();
    o.send({ t: 'turn', fence: 1, origin: 'query' });
    expect(await o.next('proceed')).toEqual({ t: 'proceed', fence: 1 });
    expect(await o.next('disarm')).toEqual({ t: 'disarm', fence: 1 });
    expect(releasing(s.a!)).toBe(false);
    expect(await o.next('arm', IDLE_MS + 1_000)).toEqual({ t: 'arm', fence: 2, leaseMs: 10_000 }); // a whole period later
    expect(Date.now() - turnAt).toBeGreaterThanOrEqual(IDLE_MS - 20);
  });

  it('an observer that went silent holds the row, unhealthy, until it says hello again', async () => {
    const { table, s } = await rows(['a']);
    const o = await observe(s.a!, { beat: false });
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await until(() => s.a!.session.status().reap?.observer === 'unhealthy', 'the silence');
    expect(s.a!.session.status().work?.unknown).toBe('observer_unhealthy');
    expect(table.gateCounts()).toEqual({ armed: 0, observed: 0, unhealthy: 1, absent: 0 });
    await sleep(3 * IDLE_MS);
    expect(releasing(s.a!)).toBe(false);
    expect(o.pending().filter((f) => f.t === 'arm')).toEqual([]);
    o.hello(engineIdOf(s.a!), { pid: ENGINE });
    o.beat(50);
    expect(await o.next('arm', IDLE_MS + 1_000)).toMatchObject({ t: 'arm' }); // heard again: its clock ran from the hello
  });

  it('a row on which no observer was ever seen is released on verified-empty alone; a hello for no row is closed', async () => {
    const { table, s } = await rows(['a']);
    const stray = await FakeObserver.connect(path);
    observers.push(stray);
    stray.hello('another-session');
    await stray.closed;
    expect(table.gateCounts()).toEqual({ armed: 0, observed: 0, unhealthy: 0, absent: 1 });
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await until(() => releasing(s.a!), 'the release');
    expect(s.a!.session.status().reap).toEqual({ state: 'signalled', observer: 'absent' });
  });

  it('the first hello of the launch is kept in the state file', async () => {
    const store = new MemorySessionStateStore();
    const { s } = await rows(['a'], { store });
    await observe(s.a!);
    await until(() => store.observerSeen.get('a' as AppSessionId) === s.a!.session.status().launchId, 'observerSeenLaunch');
  });
});

describe('the work under the engine', () => {
  it('a background job under the engine holds the row from the sample on; once it ends, the row is released', async () => {
    const { table, s } = await rows(['a']);
    tree = [proc(ENGINE, 1, 'claude'), proc(800, ENGINE, '/bin/bash -c source /x/snapshot.sh && eval \'sleep 600\'', 'Ss'), proc(801, 800, 'sleep 600')];
    await table.sampleMemory();
    expect(s.a!.session.status().work?.descendants).toBe(2);
    expect(s.a!.session.status().keepAlive).toContain('background_tasks');
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await sleep(3 * IDLE_MS);
    expect(releasing(s.a!)).toBe(false);
    tree = [proc(ENGINE, 1, 'claude')];
    await table.sampleMemory();
    expect(s.a!.session.status().work?.descendants).toBe(0);
    await until(() => releasing(s.a!), 'the release once the job ended');
  });

  it('the step reads the tree afresh: a job started after the last sample vetoes the release, and the clock starts again', async () => {
    let now = [proc(ENGINE, 1, 'claude')];
    const { table, s, logs } = await rows(['a'], { psSync: () => now.join('\n') });
    tree = [proc(ENGINE, 1, 'claude')];
    await table.sampleMemory();
    expect(s.a!.session.status().work?.descendants).toBe(0);
    const o = await observe(s.a!);
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await o.next('arm', IDLE_MS + 1_000);
    now = [proc(ENGINE, 1, 'claude'), proc(810, ENGINE, 'sleep 300')]; // after the sample, before the step
    o.send({ t: 'armed', fence: 1 });
    expect(await o.next('disarm')).toEqual({ t: 'disarm', fence: 1 });
    expect(releasing(s.a!)).toBe(false);
    expect(s.a!.session.status().work?.descendants).toBe(1); // the step's read, kept in the status
    expect(logs.some((l) => /idle reap of a cancelled at the step: 1 process of its work under the engine/.test(l))).toBe(true);
  });

  it('the bridge child (the observer’s pid) and the launch’s stdio MCP servers (mcp_status, asked once) are not work', async () => {
    const { table, s } = await rows(['a'], { mcp: [SERVER] });
    tree = [proc(ENGINE, 1, 'claude'), proc(820, ENGINE, SERVER.join(' ')), proc(821, ENGINE, 'python3 sminos.py bridge --session x')];
    await table.sampleMemory();
    expect(s.a!.session.status().work?.descendants).toBe(2); // neither is named yet; the server is asked of the engine
    await until(() => s.a!.session.mcpCommands() !== null, 'mcp_status');
    await observe(s.a!, { childPid: 821 });
    await table.sampleMemory();
    expect(s.a!.session.status().work?.descendants).toBe(0);
    await table.sampleMemory();
    expect(s.a!.transport.requestsOf('mcp_status')).toHaveLength(1);
  });

  it('a sample whose ps fails leaves the work unreadable, never zero, until a read succeeds', async () => {
    let fail = false;
    const table = new ProcessTable({ ps: async () => { if (fail) throw new Error('ps: no'); return proc(ENGINE, 1, 'claude'); }, sampleMs: 60_000, log: () => {} });
    tables.push(table);
    const x = scriptedSession({ spec: { appSessionId: 'u' as AppSessionId }, transport: { pid: ENGINE }, responder: handshakeResponder({ end_session: () => null }) });
    table.reserve('u' as AppSessionId, () => x.session);
    await x.session.start();
    fail = true;
    await table.sampleMemory();
    expect(x.session.status().work).toMatchObject({ descendants: null, unknown: 'descendants_unreadable' });
    fail = false;
    await table.sampleMemory();
    expect(x.session.status().work).toMatchObject({ descendants: 0, unknown: null });
  });
});

describe('the budget release through the gate', () => {
  it('is armed the same way; a turn before the signal clears releasing, so the next evaluation may pick another', async () => {
    const { table, s } = await rows(['a', 'b']);
    const o = await observe(s.a!);
    s.a!.session.markUsed(); // a is used before b ...
    await sleep(5);
    s.b!.session.markUsed();
    tree = [proc(ENGINE, 1, 'claude'), proc(ENGINE + 1, 1, 'claude')]; // measured, nothing under either
    table.configure({ enabled: true, limitKiB: 1, statefulMcpServers: [] }); // over; ... but nothing is quiet before a sample
    await table.sampleMemory(); // the baseline
    await table.sampleMemory(); // quiet: a, the least recently used, is picked
    expect(await o.next('arm')).toMatchObject({ t: 'arm', fence: 1 });
    expect(table.budgetState().releasing).toBe('a');
    expect(releasing(s.a!)).toBe(false);
    o.send({ t: 'turn', fence: 1, origin: 'peer', delivery: 'd-1' });
    await o.next('proceed');
    await until(() => table.budgetState().releasing === null, 'releasing cleared');
    expect(table.budgetState().lastRelease).toBeNull(); // nothing was released
  });
});
