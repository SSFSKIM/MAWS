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

async function rows(names: string[], opts: { mcp?: string[][]; servers?: Record<string, unknown>[]; store?: MemorySessionStateStore; psSync?: () => string; ps?: () => Promise<string>; hosted?: boolean } = {}) {
  const logs: string[] = [];
  const table = new ProcessTable({ ps: opts.ps ?? (async () => tree.join('\n')), psSync: opts.psSync, sampleMs: 60_000, gate, log: (line) => void logs.push(line) });
  tables.push(table);
  const servers = opts.servers ?? (opts.mcp ?? []).map(([command, ...args], i) => ({ name: `s${i}`, status: 'connected', config: { type: 'stdio', command, args } }));
  const s = Object.fromEntries(names.map((name, i) => {
    const x = scriptedSession({
      spec: { appSessionId: name as AppSessionId, sessionId: `${PINNED.slice(0, -1)}${i}` as never },
      transport: { pid: ENGINE + i, ...(opts.hosted && { holder: { pid: 4100 + i, holderId: `L-${name}`, fence: 1 } }) }, // P5 O16 M3b fix wave 1: under a session host
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
  // P5 O16 M3b fix wave 1: the handover's freeze cancels the row's reap and retires its gate channel, so no fence armed
  // by the old host can stop a turn the engine runs under the successor, and the closed idle release holds every row
  it('a freeze for the handover disarms an armed reap and closes its channel; nothing is signalled and the release holds', async () => {
    const { table, s } = await rows(['a'], { hosted: true });
    const o = await observe(s.a!);
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    expect(await o.next('arm', IDLE_MS + 1_000)).toEqual({ t: 'arm', fence: 1, leaseMs: 10_000 });
    expect(table.freezeForHandover()).toEqual([s.a!.session]);
    expect(await o.next('disarm')).toEqual({ t: 'disarm', fence: 1 });
    await o.closed; // the row's channel retired: its observer says hello to the successor's gate
    expect(s.a!.session.status().reap?.state).toBe('idle');
    await sleep(IDLE_MS * 2);
    expect(releasing(s.a!)).toBe(false);
    expect(table.gateCounts().armed).toBe(0);
  });

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

  it('the step’s final health read is against the clock: a slow tree read that outlasts the silence window holds the row', async () => {
    let slow = false;
    const { table, s, logs } = await rows(['a'], {
      psSync: () => {
        if (slow) {
          const until = Date.now() + SILENCE_MS + 60; // the event loop blocked: no heartbeat read, no silence timer run
          while (Date.now() < until) { /* a slow ps */ }
        }
        return proc(ENGINE, 1, 'claude');
      },
    });
    const o = await observe(s.a!);
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await o.next('arm', IDLE_MS + 1_000);
    slow = true;
    o.send({ t: 'armed', fence: 1 });
    expect(await o.next('disarm')).toEqual({ t: 'disarm', fence: 1 });
    expect(releasing(s.a!)).toBe(false);
    expect(logs.some((l) => /idle reap of a cancelled at the step: the observer is unhealthy/.test(l))).toBe(true);
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

  it('a sample whose ps began before a newer read bound the bridge, applied after it, changes nothing: 0 stays 0', async () => {
    const live = [proc(ENGINE, 1, 'claude'), proc(821, ENGINE, 'python3 sminos.py bridge --session x')];
    let late: ((output: string) => void) | null = null;
    const { table, s } = await rows(['a'], {
      ps: () => (late === null && tree.length === 0 ? new Promise((resolve) => (late = resolve)) : Promise.resolve(tree.join('\n'))),
      psSync: () => live.join('\n'),
    });
    const o = await observe(s.a!, { childPid: 821 });
    const older = table.sampleMemory(); // its ps under way
    await until(() => late !== null, 'the older sample’s ps');
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await o.next('arm', IDLE_MS + 1_000); // the due's fresh read bound the bridge: nothing of its work
    expect(s.a!.session.status().work?.descendants).toBe(0);
    late!([proc(ENGINE, 1, 'claude'), proc(830, ENGINE, 'node --startup-probe')].join('\n')); // from before the bridge
    await older;
    expect(s.a!.session.status().work?.descendants).toBe(0);
    tree = live;
    await table.sampleMemory();
    expect(s.a!.session.status().work?.descendants).toBe(0); // the bridge still bound
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

// The plan's D69: the registration after landing, over the owner's server shapes as the veto probe recorded them
// (spikes/protocol-probe/fixtures/p5/p5-o16-veto-mcp[-installed].jsonl) and the live MacBook's tree: cua's bare `node`,
// ptc's launcher exec'd into its venv's python (no configured command line matches it), a configured absolute path, and
// sminos's bridge child with no observer hello (sminos 1.31.0 has none yet). Each is claude's direct child, spawned in the
// same second as claude; a background Bash is claude's Bash wrapper with its command under it.
describe('D69: the owner’s server shapes on a fresh launch', () => {
  const BORN = 'Mon Nov  2 14:26:56 2026';
  const HOUR = 'Mon Nov  2 15:31:40 2026';
  const at = (pid: number, ppid: number, start: string, command: string) => `${pid} ${ppid} 1024 S ${start} ${command}`;
  const CUA = ['--disable-sigusr1', '/u/.claude/plugins/cache/cua/cua/0.21.0/cua-shim.mjs'];
  const PTC = '/u/.claude/plugins/cache/ptc-tool/ptc/0.6.1/bin/ptc-launch';
  const ABS = ['/x/server.mjs', 'flag'];
  const SERVERS = [
    { name: 'plugin:cua:cua_repl', status: 'connected', scope: 'dynamic', source: 'plugin', transport: 'stdio', config: { type: 'stdio', command: 'node', args: CUA } },
    { name: 'plugin:ptc:ptc', status: 'connected', scope: 'dynamic', source: 'plugin', transport: 'stdio', config: { type: 'stdio', command: PTC, args: [] } },
    { name: 'flag', status: 'connected', scope: 'dynamic', source: 'dynamic', transport: 'stdio', config: { type: 'stdio', command: '/usr/bin/node', args: ABS } },
    { name: 'notion', status: 'connected', scope: 'dynamic', config: { type: 'http', url: 'https://mcp.notion.com/mcp' } },
    { name: 'maws', status: 'connected', scope: 'dynamic', transport: 'sdk' },
  ];
  const SESSION = `${PINNED.slice(0, -1)}0`; // row a's engine session id
  const resting = () => [
    at(ENGINE, 1, BORN, '/u/.local/share/claude/versions/2.1.316 -p --input-format stream-json'),
    at(820, ENGINE, BORN, `node ${CUA.join(' ')}`),
    at(821, ENGINE, BORN, '/u/.ptc/venvs/4c410075651a/bin/python -m ptc.mcp'),
    at(822, ENGINE, BORN, `/usr/bin/node ${ABS.join(' ')}`),
    at(823, ENGINE, BORN, `/Library/Frameworks/Python.framework/Versions/3.12/Resources/Python.app/Contents/MacOS/Python /u/.claude/plugins/cache/doperpowers/sminos/1.31.0/skills/sminos/scripts/sminos.py bridge --session ${SESSION} --launch=k9vHeE6YTaP3bkSm5E93tw`),
  ];
  const BASH = [at(830, ENGINE, HOUR, "/opt/homebrew/bin/bash -c source /u/.claude/shell-snapshots/snapshot-bash-1793629565532-co9nny.sh 2>/dev/null || true && eval 'sleep 600'"), at(831, 830, HOUR, 'sleep 600')];
  const work = (x: Row) => x.session.status().work?.descendants;

  it('nothing under the engine is its work once mcp_status names the servers, and the idle release takes the row', async () => {
    const { table, s } = await rows(['a'], { servers: SERVERS });
    tree = resting();
    await table.sampleMemory();
    await until(() => work(s.a!) === 0, 'the servers bound');
    expect(s.a!.transport.requestsOf('mcp_status')).toHaveLength(1);
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await until(() => releasing(s.a!), 'the idle release');
  });

  it('the budget release takes the row as well', async () => {
    const { table, s } = await rows(['a'], { servers: SERVERS });
    tree = resting();
    await table.sampleMemory();
    await until(() => work(s.a!) === 0, 'the servers bound');
    table.configure({ enabled: true, limitKiB: 1, statefulMcpServers: [] });
    await table.sampleMemory();
    await table.sampleMemory();
    await until(() => releasing(s.a!), 'the budget release');
    expect(table.budgetState().releasing).toBe('a');
  });

  it('a background Bash is still work under either release, until it ends', async () => {
    const { table, s } = await rows(['a'], { servers: SERVERS });
    tree = [...resting(), ...BASH];
    await table.sampleMemory();
    await until(() => work(s.a!) === 2, 'the servers bound, the Bash counted');
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    table.configure({ enabled: true, limitKiB: 1, statefulMcpServers: [] });
    await table.sampleMemory();
    await sleep(3 * IDLE_MS);
    expect(releasing(s.a!)).toBe(false);
    tree = resting();
    await table.sampleMemory();
    expect(work(s.a!)).toBe(0);
    await until(() => releasing(s.a!), 'a release once the Bash ended');
  });

  it('the probe’s d: a server killed stays connected, and a child the engine starts after it is work, not its replacement', async () => {
    const { table, s } = await rows(['a'], { servers: SERVERS });
    tree = resting();
    await table.sampleMemory();
    await until(() => work(s.a!) === 0, 'the servers bound');
    tree = [...resting().filter((l) => !l.startsWith('821 ')), at(840, ENGINE, HOUR, '/u/.local/bin/claude --teammate')];
    await table.sampleMemory();
    await sleep(20);
    await table.sampleMemory();
    expect(work(s.a!)).toBe(1);
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await sleep(3 * IDLE_MS);
    expect(releasing(s.a!)).toBe(false);
  });

  it('the probe’s d after the first turn: a child born after it, even in the engine’s first minute, is work, never a dead server’s replacement', async () => {
    const { table, s } = await rows(['a'], { servers: SERVERS });
    s.a!.transport.push({ type: 'system', subtype: 'init', timestamp: '2026-11-02T14:27:01.400Z', cwd: '/w', session_id: SESSION, tools: [], mcp_servers: [], model: 'm', permissionMode: 'default', slash_commands: [], claude_code_version: '2.1.316', output_style: 'default', uuid: 'i-1' });
    await until(() => s.a!.session.firstTurnAt === '2026-11-02T14:27:01.400Z', 'the first turn');
    tree = resting();
    await table.sampleMemory();
    await until(() => work(s.a!) === 0, 'the servers bound');
    tree = [...resting().filter((l) => !l.startsWith('821 ')), at(840, ENGINE, 'Mon Nov  2 14:27:26 2026', '/u/.local/bin/claude --teammate')];
    await table.sampleMemory();
    await sleep(20);
    await table.sampleMemory();
    expect(work(s.a!)).toBe(1);
  });

  it('an answer counted against a tree with a passing helper in it is asked again once the helper is gone; so is one whose tree could not be read', async () => {
    for (const failure of ['helper', 'ps'] as const) {
      const list = SERVERS.map((server) => (server.name === 'plugin:ptc:ptc' ? { ...server, status: 'pending' } : { ...server }));
      const helper = at(850, ENGINE, BORN, '/bin/sh -c "${CLAUDE_PLUGIN_ROOT}/hooks/smns-record.sh"');
      let reads = 0;
      const { table, s } = await rows(['a'], {
        servers: list,
        psSync: () => {
          reads += 1;
          if (reads === 2 && failure === 'ps') throw new Error('ps: no');
          return [...resting(), ...(reads === 2 && failure === 'helper' ? [helper] : [])].join('\n');
        },
      });
      const asks = () => s.a!.transport.requestsOf('mcp_status').length;
      tree = resting();
      await table.sampleMemory(); // asked: ptc pending, so nothing by count
      await until(() => reads === 1, 'the first answer counted');
      list[1]!.status = 'connected';
      await table.sampleMemory(); // asked again (a server was pending), counted against the helper's tree, or none read
      await until(() => reads === 2, 'the second answer counted');
      await sleep(10);
      expect(work(s.a!)).not.toBe(0);
      await table.sampleMemory(); // the helper gone: asked again, and bound
      await until(() => work(s.a!) === 0, `the servers bound (${failure})`);
      expect(asks()).toBe(3);
      tables.splice(tables.indexOf(table), 1)[0]!.setIdleRelease({ idleMs: null, active: false });
    }
  });

  it('the bridge bound by its argv stays bound when its observer’s hello names it, and the bindings are kept for an adopter', async () => {
    const store = new MemorySessionStateStore();
    const { table, s } = await rows(['a'], { servers: SERVERS, store });
    tree = resting();
    await table.sampleMemory();
    await until(() => work(s.a!) === 0, 'the servers bound');
    await until(() => (store.infrastructure.get('a' as AppSessionId)?.processes.length ?? 0) === 4, 'the bindings saved');
    expect(store.infrastructure.get('a' as AppSessionId)).toEqual({ launch: s.a!.session.status().launchId, processes: expect.arrayContaining([
      { pid: 820, start: BORN, kind: 'server' }, { pid: 821, start: BORN, kind: 'server' }, { pid: 822, start: BORN, kind: 'server' }, { pid: 823, start: BORN, kind: 'bridge' },
    ]) });
    await observe(s.a!, { childPid: 823 });
    await table.sampleMemory();
    expect(work(s.a!)).toBe(0);
    await until(() => store.infrastructure.get('a' as AppSessionId)?.processes.length === 3, 'the bridge left to its hello');
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

  it('a row whose idle reap is under way is not marked releasing; once that reap ends, the budget may pick it', async () => {
    const { table, s } = await rows(['a']);
    const o = await observe(s.a!);
    table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    expect(await o.next('arm', IDLE_MS + 1_000)).toEqual({ t: 'arm', fence: 1, leaseMs: 10_000 }); // the idle reap's
    tree = [proc(ENGINE, 1, 'claude')];
    table.configure({ enabled: true, limitKiB: 1, statefulMcpServers: [] });
    await table.sampleMemory();
    await table.sampleMemory(); // the budget picks a: its reap is the idle one, under way
    expect(table.budgetState().releasing).toBeNull();
    expect(o.pending().filter((f) => f.t === 'arm')).toEqual([]);
    o.send({ t: 'turn', fence: 1, origin: 'cron' }); // the idle reap ends without a signal
    await o.next('disarm');
    await table.sampleMemory();
    expect(await o.next('arm')).toEqual({ t: 'arm', fence: 2, leaseMs: 10_000 }); // the budget's own
    expect(table.budgetState().releasing).toBe('a');
    o.send({ t: 'turn', fence: 2, origin: 'cron' });
    await o.next('disarm');
    await until(() => table.budgetState().releasing === null, 'the budget reap’s marker cleared');
  });
});
