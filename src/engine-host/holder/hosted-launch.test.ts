// A live launch under a session host, end to end through the engine host's handlers (docs/doperpowers/plans/
// 2026-10-31-p5-o16-holder.md, M2's Proves): the committed session host binary holds the stub engine (a process playing
// the permission fixture over real stdio), and the session journals its records with the host map beside the journal.
// The spawn row names the engine as `bin` and the host as `holder`; SMNS_MEMBER in the engine's environment is the
// host's pid; the acks empty the host's ring; a host that will not start answers `host_unavailable`; a host killed with
// SIGKILL ends the session as a crash with `host_lost`. Runs wherever a prebuild matches the platform.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { LaunchSpecSchema, type LaunchSpec } from '@shared/engine/launch-spec';
import type { EngineSessionStatus } from '@shared/engine/status';
import { HostCommandError, type HostEmit, type HostOn } from '@shared/host/runtime';
import type { CommandInput, CommandName, CommandOutput, EventName } from '@shared/ipc/schema';
import { validateCommandOutput, validateEventPayload } from '@shared/ipc/validate';
import { buildStubEngine, writeStubEngine } from '../../../test/support/stub-engine-bin';
import { TESTED_ENGINE_VERSION } from '../engine-compat';
import { registerEngineIpc, type EngineIpcDeps } from '../ipc';
import { RELAY_URL } from '../launch';
import { signalOrphan } from '../live-ledger';
import { isAlive, procStartOf } from '../supervisor-files';
import { mapFileOf } from './checkpoint';
import { HostConnection } from './client';
import { hostsDirOf, sessionHostBinary } from './files';
import { startSessionHost, type StartedHost } from './transport';

const BINARY = sessionHostBinary(resolve(__dirname, '..', '..', '..', 'out', 'main', 'index.js'));
const PERMISSION = 'spikes/protocol-probe/fixtures/permission-roundtrip.jsonl';
const LONG = 60_000;
const OK_RELAY = { url: RELAY_URL, ok: true, status: 200, latencyMs: 2, checkedAt: '2026-10-31T10:00:00.000Z', error: null };
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

let scratch: string;
let bundle: string;
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'msh-l-'));
  bundle = buildStubEngine(scratch);
}, 60_000);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let userData: string;
const hosts: StartedHost[] = [];
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'msh-u-'));
});
afterEach(async () => {
  for (const host of hosts.splice(0)) {
    try {
      process.kill(host.pid, 'SIGKILL');
    } catch {
      // gone
    }
  }
  await sleep(50);
  rmSync(userData, { recursive: true, force: true });
});

function spec(appSessionId: string): LaunchSpec {
  return LaunchSpecSchema.parse({
    appSessionId, cwd: userData, additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'direct', subagentModel: null,
    resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, inheritGrantsFrom: null, replay: null,
  });
}

// The engine host's handlers over the stub engine, every live launch under a session host of the committed binary.
function engineHost(stub: string, over: { binary?: string } = {}) {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  const emitted: { name: EventName; payload: unknown }[] = [];
  const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
  const emit: HostEmit = (name, payload) => {
    const checked = validateEventPayload(name, payload);
    if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues).slice(0, 400)}`);
    emitted.push({ name, payload });
    return true;
  };
  const holder: EngineIpcDeps['holder'] = {
    gateSocket: join(userData, 'supervisor', 'gate.sock'),
    start: async (launchId) => {
      const host = await startSessionHost(launchId, { hostsDir: hostsDirOf(join(userData, 'supervisor')), binary: over.binary ?? BINARY, userData, tmpdir: tmpdir(), log: () => {}, child: { isAlive, procStartOf, signal: signalOrphan, graceMs: 1_000 } });
      hosts.push(host);
      return host;
    },
  };
  const ipc = registerEngineIpc(on, emit, {
    userData, replayEnabled: false, log: () => {}, holder,
    binaryProbe: async () => ({ path: stub, testedVersion: TESTED_ENGINE_VERSION, version: TESTED_ENGINE_VERSION, ok: true, error: null }),
    checkRelay: async () => OK_RELAY, captureEnv: async () => ({ PATH: '/usr/bin:/bin' }),
  });
  const call = async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> => {
    const value = await handlers.get(name)!(input);
    const checked = validateCommandOutput(name, value);
    if (!checked.ok) throw new Error(`invalid output of ${name}: ${checked.error.message}`);
    return checked.value;
  };
  const events = (id: string): SessionEvent[] =>
    emitted.filter((e) => e.name === 'session.eventBatch' && (e.payload as { appSessionId: string }).appSessionId === id).flatMap((e) => (e.payload as { events: SessionEvent[] }).events);
  const status = (id: string): EngineSessionStatus => ipc.table.get(id as AppSessionId)!.status();
  return { ipc, call, events, status };
}

async function until(check: () => boolean, what: string, ms = 15_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

type Row = { seq: number; direction: string; frame: Record<string, unknown> };
const rowsOf = (journal: string): Row[] => readFileSync(journal, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Row);

function isAliveNow(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!existsSync(BINARY))('a live launch under a session host', () => {
  it('plays the permission round trip; the spawn row names the engine and the host, SMNS_MEMBER is the host, the map names every hosted row and the acks empty the ring', { timeout: LONG }, async () => {
    const stub = writeStubEngine(join(scratch, 'claude-perm'), bundle, { fixture: PERMISSION, printEnv: ['SMNS_MEMBER', 'MAWS_HOLDER_SOCKET'] });
    const host = engineHost(stub);
    const id = 'app-hosted';
    expect(await host.call('session.launch', { spec: spec(id) })).toMatchObject({ status: 'launching', session: { holder: { pid: expect.any(Number), adopted: false } } });
    await until(() => host.status(id).process === 'ready', 'ready');
    const [started] = hosts;
    const status = host.status(id);
    expect(status.holder).toEqual({ pid: started!.pid, holderId: started!.holderId, adopted: false });
    expect(status.pid).not.toBe(started!.pid); // the engine's, the host's child

    await host.call('session.send', { appSessionId: id as AppSessionId, content: 'Use Bash to run exactly git log --oneline. Then say DONE.' });
    await until(() => host.events(id).some((e) => e.kind === 'permission.requested'), 'permission.requested');
    const requested = host.events(id).find((e) => e.kind === 'permission.requested') as Extract<SessionEvent, { kind: 'permission.requested' }>;
    expect(await host.call('session.answer', { appSessionId: id as AppSessionId, requestId: requested.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } })).toEqual({ outcome: 'delivered' });
    await until(() => host.events(id).some((e) => e.kind === 'turn.ended'), 'turn.ended');
    expect(host.events(id).find((e) => e.kind === 'turn.ended')).toMatchObject({ terminalReason: 'completed' });

    // after a quiet moment (the post-turn re-read's answers arrive after turn.ended) the frontier has been acknowledged:
    // the host's ring holds nothing, every record is acked, and only then are the journal and its map read, since a map
    // line is on disk before its record's ack
    await sleep(500);
    const token = readFileSync(started!.paths.token, 'utf8');
    const { connection, hello } = await HostConnection.open(started!.paths.socket, token, { deadline: Date.now() + 5_000, log: () => {} });
    connection.close();
    expect(hello.ring).toMatchObject({ bytes: 0, firstSeq: hello.ring.lastSeq + 1 });

    const journal = status.journalPath;
    const rows = rowsOf(journal);
    expect(rows.find((r) => r.frame.event === 'spawn')?.frame).toMatchObject({ bin: stub, holder: { pid: started!.pid, holderId: started!.holderId, binary: BINARY } });
    const stderr = rows.filter((r) => r.direction === 'stderr').map((r) => r.frame.text);
    expect(stderr).toContain(`stub-engine env SMNS_MEMBER=${started!.pid}`);
    expect(stderr).toContain(`stub-engine env MAWS_HOLDER_SOCKET=${join(userData, 'supervisor', 'gate.sock')}`);

    // every hosted row (each `in` and `stderr` row) is named by exactly one map line, in host order; this fixture writes
    // no blank line (D44: such a record is acked with no row and no line), so the map's last sequence is the ring's last
    const lines = readFileSync(mapFileOf(journal), 'utf8').trim().split('\n').map((line) => line.split(' ').map(Number) as [number, number]);
    const hostedSeqs = rows.filter((r) => r.direction === 'in' || r.direction === 'stderr').map((r) => r.seq);
    expect(lines.map(([, j]) => j)).toEqual(hostedSeqs);
    expect(lines.map(([h]) => h)).toEqual(Array.from({ length: lines.length }, (_, i) => i + 1));
    expect(hello.ring.lastSeq).toBe(lines.at(-1)![0]);

    expect(await host.call('session.stop', { appSessionId: id as AppSessionId, reason: 'stop' })).toEqual({ exited: true, code: 0, signal: null });
    await until(() => !isAliveNow(started!.pid), 'the host released after the exit');
    expect(existsSync(started!.paths.roster)).toBe(false);
  });

  it('a session host that will not start answers the launch host_unavailable naming its log, and nothing is spawned or reserved', { timeout: LONG }, async () => {
    const stub = writeStubEngine(join(scratch, 'claude-none'), bundle, { fixture: PERMISSION });
    const host = engineHost(stub, { binary: '/usr/bin/false' });
    const id = 'app-nohost';
    const failure = await host.call('session.launch', { spec: spec(id) }).then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(HostCommandError);
    expect((failure as HostCommandError).ipcError).toMatchObject({ code: 'host_unavailable', message: expect.stringContaining(join(userData, 'supervisor', 'hosts')) });
    expect(host.ipc.table.get(id as AppSessionId)).toBeUndefined();
  });

  it('a session host killed with SIGKILL ends the session as a crash with host_lost, its engine ended', { timeout: LONG }, async () => {
    const stub = writeStubEngine(join(scratch, 'claude-lost'), bundle, { fixture: PERMISSION });
    const host = engineHost(stub);
    const id = 'app-lost';
    await host.call('session.launch', { spec: spec(id) });
    await until(() => host.status(id).process === 'ready', 'ready');
    const engine = host.status(id).pid!;
    process.kill(hosts[0]!.pid, 'SIGKILL');
    await until(() => host.events(id).some((e) => e.kind === 'process.exited'), 'process.exited');
    expect(host.events(id).find((e) => e.kind === 'process.exited')).toMatchObject({ reason: 'crash', signal: 'SIGKILL' });
    expect(host.events(id).find((e) => e.kind === 'error.raised')).toMatchObject({ code: 'host_lost' });
    await until(() => !isAliveNow(engine), 'the engine ended', 8_000);
  });
});
