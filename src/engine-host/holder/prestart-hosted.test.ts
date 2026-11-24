// Ticket 851, M2 (docs/doperpowers/plans/2026-11-24-prestart-engine.md, R4-1, R4-2): a prestart under the committed
// session host binary holding the stub engine (the permission fixture over real stdio). Hidden, its launch writes nothing
// to the journal directory and its roster entry is marked; adopted, the stage is written whole (the map line before its
// row, the original sequences), the host promotes the entry, and the frontier the map gives a successor is every record
// acknowledged; ended, its files and its entry go. An engine host killed between the staging and the promotion leaves a
// marked host its successor discards with the staged files (M1's rule); one killed right after the promotion leaves an
// ordinary launch its successor adopts, replaying with no gap and no duplicate. Runs wherever a prebuild matches.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { LaunchSpecSchema, type LaunchSpec } from '@shared/engine/launch-spec';
import type { HostEmit, HostOn } from '@shared/host/runtime';
import type { ClientRef, HandlerContext } from '@shared/ipc/client';
import type { CommandInput, CommandName, CommandOutput } from '@shared/ipc/schema';
import { parseJournalRow, type JournalRow } from '@shared/wire/journal';
import { buildHostedManager, startHostedManager, type HostedManager } from '../../../test/support/hosted-manager-bin';
import { buildStubEngine, writeStubEngine } from '../../../test/support/stub-engine-bin';
import { TESTED_ENGINE_VERSION } from '../engine-compat';
import { registerEngineIpc, type EngineIpcDeps } from '../ipc';
import { RELAY_URL } from '../launch';
import { signalOrphan } from '../live-ledger';
import { MAX_LINE_CHARS } from '../transport';
import { isAlive, procStartOf } from '../supervisor-files';
import { adoptAll, clearDeadHost, clearEndedPrestart, endPrestart, type PrestartFiles } from './adopt';
import { mapFileOf, readCheckpoint } from './checkpoint';
import { hostsDirOf, sessionHostBinary, sessionHostPaths } from './files';
import { launchRows } from './restore';
import { liveHosts, readRoster, removeHostFiles, type RosterEntry } from './roster';
import { adoptHosted, discardHost, releaseHost, startSessionHost, type StartedHost } from './transport';

const BINARY = sessionHostBinary(resolve(__dirname, '..', '..', '..', 'out', 'main', 'index.js'));
const PERMISSION = 'spikes/protocol-probe/fixtures/permission-roundtrip.jsonl';
const LONG = 90_000;
const PROMPT = 'Use Bash to run exactly git log --oneline. Then say DONE.';
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function until(check: () => boolean | Promise<boolean>, what: string, ms = 20_000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

let scratch: string;
let stubBundle: string;
let managerBundle: string;
beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'msh-p-'));
  stubBundle = buildStubEngine(scratch);
  managerBundle = await buildHostedManager(`prestart-${process.pid}`);
}, 120_000);
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(resolve(managerBundle, '..'), { recursive: true, force: true });
});

let userData: string;
const managers: HostedManager[] = [];
const started: StartedHost[] = [];
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'msh-pu-'));
});
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.kill('SIGKILL').catch(() => {});
  for (const pid of [...started.splice(0).map((host) => host.pid), ...readRoster(hostsDir(), () => {}).flatMap((entry) => [entry.pid, entry.child?.pid ?? -1])]) {
    try {
      if (pid > 0) process.kill(pid, 'SIGKILL');
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

const hostsDir = () => hostsDirOf(join(userData, 'supervisor'));
const journalDir = (id: string) => join(userData, 'engine-host', 'journal', id);
const filesOf = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir) : []);
const tokenOf = (holderId: string) => readFileSync(sessionHostPaths(hostsDir(), holderId, { userData, tmpdir: tmpdir() }).token, 'utf8');
const entryOf = (holderId: string): RosterEntry | undefined => readRoster(hostsDir(), () => {}).find((entry) => entry.holderId === holderId);
const CLIENT = { id: 'conn', onGone: () => () => {} } as unknown as ClientRef;
const rowsOf = (path: string): JournalRow[] => readFileSync(path, 'utf8').trim().split('\n').map((line) => parseJournalRow(JSON.parse(line)));

// This process's engine host over the real session host, as index.ts wires it (the prestart's end included)
function engineHost(stub: string) {
  const handlers = new Map<string, (input: unknown, ctx: HandlerContext) => Promise<unknown>>();
  const emitted: { name: string; payload: unknown }[] = [];
  const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown, ctx: HandlerContext) => Promise<unknown>);
  const emit: HostEmit = (name, payload) => {
    emitted.push({ name, payload });
    return true;
  };
  const holder: EngineIpcDeps['holder'] = {
    gateSocket: join(userData, 'supervisor', 'gate.sock'),
    start: async (launchId) => {
      const host = await startSessionHost(launchId, { hostsDir: hostsDir(), binary: BINARY, userData, tmpdir: tmpdir(), log: () => {}, child: { isAlive, procStartOf, signal: signalOrphan, graceMs: 1_000 } });
      started.push(host);
      return host;
    },
    endPrestart: async (host) => void (await clearEndedPrestart(hostsDir(), host, { isAlive })),
  };
  const ipc = registerEngineIpc(on, emit, {
    userData, replayEnabled: false, log: () => {}, holder,
    binaryProbe: async () => ({ path: stub, testedVersion: TESTED_ENGINE_VERSION, version: TESTED_ENGINE_VERSION, ok: true, error: null }),
    checkRelay: async () => ({ url: RELAY_URL, ok: true, status: 200, latencyMs: 2, checkedAt: '2026-11-24T10:00:00.000Z', error: null }),
    captureEnv: async () => ({ PATH: '/usr/bin:/bin' }),
  });
  const call = async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> => (await handlers.get(name)!(input, { client: CLIENT })) as CommandOutput<N>;
  const events = (id: string): SessionEvent[] =>
    emitted.filter((e) => e.name === 'session.eventBatch' && (e.payload as { appSessionId: string }).appSessionId === id).flatMap((e) => (e.payload as { events: SessionEvent[] }).events);
  return { ipc, call, events };
}

// The successor: the start's path of index.ts (`adoptAtStart`): a dead host's files cleared (a marked one's staged files
// first), every live one adopted, a marked one discarded
function successor(stub: string) {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  const emitted: { name: string; payload: unknown }[] = [];
  const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
  const emit: HostEmit = (name, payload) => {
    emitted.push({ name, payload });
    return true;
  };
  const deps = { hostsDir: hostsDir(), binary: BINARY, userData, tmpdir: tmpdir(), log: () => {} };
  const ipc = registerEngineIpc(on, emit, {
    userData, replayEnabled: false, log: () => {},
    holder: {
      gateSocket: join(userData, 'supervisor', 'gate.sock'),
      start: () => Promise.reject(new Error('the successor launches nothing here')),
      adopt: async (entry, checkpoint, startMs) => adoptHosted({ ...entry, appSessionId: entry.appSessionId ?? '' }, { ...deps, startMs, token: tokenOf(entry.holderId), checkpoint, maxLineChars: MAX_LINE_CHARS }),
      release: (entry, startMs) => releaseHost(entry, { log: () => {}, startMs, token: tokenOf(entry.holderId) }),
    },
    binaryProbe: async () => ({ path: stub, testedVersion: TESTED_ENGINE_VERSION, version: TESTED_ENGINE_VERSION, ok: true, error: null }),
    checkRelay: async () => ({ url: RELAY_URL, ok: true, status: 200, latencyMs: 2, checkedAt: '2026-11-24T10:00:00.000Z', error: null }),
    captureEnv: async () => ({ PATH: '/usr/bin:/bin' }),
  });
  const files: PrestartFiles = { stagedDir: (entry) => (entry.appSessionId === null ? null : journalDir(entry.appSessionId)), removeEntry: (entry) => removeHostFiles(hostsDir(), entry), log: () => {}, stateDir: join(userData, 'engine-host', 'state') };
  const start = async () => {
    const { live, dead } = liveHosts(readRoster(hostsDir(), () => {}), { isAlive, procStartOf });
    for (const entry of dead) clearDeadHost(entry, files);
    ipc.table.holdForAdoption(live.flatMap((entry) => (entry.appSessionId ? [entry.appSessionId as AppSessionId] : [])));
    const outcome = await adoptAll(live, {
      adopt: (entry) => ipc.adopt(entry),
      end: (entry) => endPrestart(entry, { ...files, discard: (e) => discardHost(e, { log: () => {}, token: tokenOf(e.holderId) }) }),
      log: () => {},
    });
    for (const entry of live) if (entry.appSessionId) ipc.table.adoptionEnded(entry.appSessionId as AppSessionId);
    return { live, dead, outcome };
  };
  const events = (id: string): SessionEvent[] =>
    emitted.filter((e) => e.name === 'session.eventBatch' && (e.payload as { appSessionId: string }).appSessionId === id).flatMap((e) => (e.payload as { events: SessionEvent[] }).events);
  return { ipc, start, events, call: (name: string, input: unknown) => handlers.get(name)!(input) };
}

const ofKind = <K extends SessionEvent['kind']>(events: SessionEvent[], kind: K) => events.filter((e): e is Extract<SessionEvent, { kind: K }> => e.kind === kind);

describe.skipIf(!existsSync(BINARY))('a prestart under a session host', () => {
  it('hidden, writes nothing and its entry is marked; adopted, the journal and its map are whole, the entry promoted and the frontier every acknowledged record', { timeout: LONG }, async () => {
    const stub = writeStubEngine(join(scratch, 'claude-p1'), stubBundle, { fixture: PERMISSION });
    const host = engineHost(stub);
    const id = 'app-pre';
    expect(await host.call('session.prestart', { spec: spec(id), key: 'k', owner: 'root' })).toEqual({ status: 'started', generation: 1 });
    await until(() => host.ipc.table.getAny(id as AppSessionId)?.lifecycle === 'ready', 'the hidden row ready');
    const status = host.ipc.table.getAny(id as AppSessionId)!.status();
    expect(entryOf(status.holder!.holderId)).toMatchObject({ prestart: true, appSessionId: id });
    expect(filesOf(journalDir(id))).toEqual([]);
    expect(filesOf(join(userData, 'engine-host', 'state'))).toEqual([]);

    const answer = await host.call('session.launch', { spec: spec(id), adopt: { key: 'k' } });
    expect(answer).toMatchObject({ status: 'launching', session: { launchId: status.launchId, pid: status.pid } });
    expect(entryOf(status.holder!.holderId)?.prestart).toBeUndefined();
    const journal = join(journalDir(id), `${status.launchId}.jsonl`);
    const rows = rowsOf(journal);
    expect(rows.map((row) => row.seq)).toEqual(rows.map((_, i) => i + 1));
    const map = readFileSync(mapFileOf(journal), 'utf8').trim().split('\n').map((line) => line.split(' ').map(Number) as [number, number]);
    expect(map.length).toBeGreaterThan(0);
    expect(map.map(([hostSeq]) => hostSeq)).toEqual(map.map((_, i) => i + 1)); // every record, in order
    for (const [, journalSeq] of map) expect(rows[journalSeq - 1]!.direction).not.toBe('out'); // each names its own hosted row
    expect(readCheckpoint(journalDir(id), status.launchId, rows.at(-1)!.seq).frontier).toBe(map.at(-1)![0]);
    expect(existsSync(join(userData, 'engine-host', 'state', `${id}.json`))).toBe(true);

    // the launch goes on as any: a turn, its rows after the staged ones in the same file
    await host.call('session.send', { appSessionId: id as AppSessionId, content: PROMPT });
    await until(() => host.events(id).some((e) => e.kind === 'permission.requested'), 'permission.requested');
    const requested = ofKind(host.events(id), 'permission.requested')[0]!;
    await host.call('session.answer', { appSessionId: id as AppSessionId, requestId: requested.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } });
    await until(() => host.events(id).some((e) => e.kind === 'turn.ended'), 'turn.ended');
    const after = rowsOf(journal);
    expect(after.map((row) => row.seq)).toEqual(after.map((_, i) => i + 1));
  });

  it('ended by its withdraw: the engine and its host exit, and neither a file nor the entry is left', { timeout: LONG }, async () => {
    const stub = writeStubEngine(join(scratch, 'claude-p2'), stubBundle, { fixture: PERMISSION });
    const host = engineHost(stub);
    const id = 'app-gone';
    const { generation } = await host.call('session.prestart', { spec: spec(id), key: 'k', owner: 'root' });
    await until(() => host.ipc.table.getAny(id as AppSessionId)?.lifecycle === 'ready', 'the hidden row ready');
    const status = host.ipc.table.getAny(id as AppSessionId)!.status();
    await host.call('session.prestart.withdraw', { appSessionId: id as AppSessionId, generation });
    await until(() => !isAlive(status.pid!) && !isAlive(status.holder!.pid), 'the engine and its host gone');
    await until(() => entryOf(status.holder!.holderId) === undefined, 'the entry removed');
    expect(filesOf(journalDir(id))).toEqual([]);
    expect(filesOf(join(userData, 'engine-host', 'state'))).toEqual([]);
  });

  it('its engine host killed between the staging and the promotion: the successor discards it and removes the staged files, then the entry', { timeout: LONG }, async () => {
    const stub = writeStubEngine(join(scratch, 'claude-p3'), stubBundle, { fixture: PERMISSION });
    const id = 'app-staged';
    const old = startHostedManager(managerBundle, { userData, stub, binary: BINARY, version: TESTED_ENGINE_VERSION });
    managers.push(old);
    await old.call('session.prestart', { spec: spec(id), key: 'k', owner: 'root' });
    await until(async () => (await old.status(id))?.process === 'ready', 'the hidden row ready');
    const status = (await old.status(id))!;
    const launchId = await old.stage(id);
    expect(filesOf(journalDir(id)).sort()).toEqual([`${launchId}.hseq`, `${launchId}.jsonl`]);
    expect(filesOf(join(userData, 'engine-host', 'state'))).toContain(`${id}.json`); // the held writes landed (M2's review, finding 2)
    expect(entryOf(status.holder!.holderId)).toMatchObject({ prestart: true });
    await old.kill('SIGKILL');
    // its writer lost, the marked host ends its engine and exits, keeping its entry (M1); the staged files stay with it
    await until(() => !isAlive(status.pid!) && !isAlive(status.holder!.pid), 'the engine and its host ended');
    expect(entryOf(status.holder!.holderId)).toMatchObject({ prestart: true });
    expect(filesOf(journalDir(id)).length).toBe(2);

    const next = successor(stub);
    const { outcome, dead } = await next.start();
    expect(dead.map((entry) => entry.holderId)).toEqual([status.holder!.holderId]);
    expect(outcome).toEqual({ adopted: [], failed: [], ended: [] });
    expect(filesOf(journalDir(id))).toEqual([]); // the staged files, then the entry
    expect(filesOf(join(userData, 'engine-host', 'state'))).toEqual([]); // M2's review, finding 2: no earlier state, so none left
    expect(entryOf(status.holder!.holderId)).toBeUndefined();
    expect(next.ipc.table.getAny(id as AppSessionId)).toBeUndefined();
  });

  it('its engine host killed right after the promotion: the successor adopts the launch and replays it with no gap and no duplicate', { timeout: LONG }, async () => {
    const stub = writeStubEngine(join(scratch, 'claude-p4'), stubBundle, { fixture: PERMISSION, rowMs: 15 });
    const id = 'app-promoted';
    const old = startHostedManager(managerBundle, { userData, stub, binary: BINARY, version: TESTED_ENGINE_VERSION });
    managers.push(old);
    await old.call('session.prestart', { spec: spec(id), key: 'k', owner: 'root' });
    await until(async () => (await old.status(id))?.process === 'ready', 'the hidden row ready');
    expect(await old.call('session.launch', { spec: spec(id), adopt: { key: 'k' } })).toMatchObject({ status: 'launching' });
    const before = (await old.status(id))!;
    expect(entryOf(before.holder!.holderId)?.prestart).toBeUndefined();
    await old.call('session.send', { appSessionId: id, content: PROMPT });
    await until(() => old.events(id).some((e) => e.kind === 'permission.requested'), 'permission.requested');
    const requested = ofKind(old.events(id), 'permission.requested')[0]!;
    await old.call('session.answer', { appSessionId: id, requestId: requested.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } });
    const seen = old.events(id).length;
    await until(() => old.events(id).length > seen + 3, 'the turn streaming');
    await old.kill('SIGKILL');

    const next = successor(stub);
    const { outcome } = await next.start();
    expect(outcome).toEqual({ adopted: [id], failed: [], ended: [] });
    await until(() => next.events(id).some((e) => e.kind === 'turn.ended'), 'the turn ended under the successor');
    expect(next.ipc.table.get(id as AppSessionId)!.status()).toMatchObject({ pid: before.pid, launchId: before.launchId, holder: { adopted: true } });
    const rows = [...launchRows(journalDir(id), before.launchId)];
    expect(rows.map((r) => r.seq)).toEqual(rows.map((_, i) => i + 1)); // the staged rows, the old manager's and the successor's: one sequence
    const fixture = readFileSync(resolve(__dirname, '..', '..', '..', PERMISSION), 'utf8').trim().split('\n').map((line) => parseJournalRow(JSON.parse(line)));
    const engineFrames = (of: readonly JournalRow[]) => of.filter((r) => r.direction === 'in' && !['control_request', 'control_response'].includes((r.frame as { type: string }).type)).map((r) => JSON.stringify(r.frame));
    const firstResult = fixture.findIndex((r) => (r.frame as { type?: string }).type === 'result');
    const promptOf = (of: readonly JournalRow[]) => (of.find((r) => r.direction === 'out' && (r.frame as { type: string }).type === 'user')!.frame as { uuid: string }).uuid;
    const played = engineFrames(fixture.slice(0, firstResult + 1)).map((frame) => frame.replaceAll(promptOf(fixture), promptOf(rows)));
    expect(engineFrames(rows).slice(0, played.length)).toEqual(played);
  });
});
