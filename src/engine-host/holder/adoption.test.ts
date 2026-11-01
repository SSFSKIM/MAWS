// P5 O16 M3 (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3's Proves, acceptance 1 at the unit level): an
// engine host killed with SIGKILL, and its successor adopting what it left, over the committed session host binary
// holding the stub engine (a process playing the permission fixture). The killed manager is a process of its own
// (test/support/hosted-manager.ts); the successor is this process's engine host handlers, adopting through the start's
// own path (the roster read, the rows held, adoptAll and the launcher's adopt). Killed mid-stream, the successor replays
// exactly from the map's frontier: every engine frame of the turn is journaled once, in order, and the journal's
// sequence continues; killed with a permission pending, the card is pending once and its answer completes the turn
// with the same engine process; the killed manager's fence is refused. Runs wherever a prebuild matches the platform.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { LaunchSpecSchema, type LaunchSpec } from '@shared/engine/launch-spec';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { HostEmit, HostOn } from '@shared/host/runtime';
import type { CommandInput, CommandName, CommandOutput } from '@shared/ipc/schema';
import { parseJournalRow, type JournalRow } from '@shared/wire/journal';
import { buildHostedManager, startHostedManager, type HostedManager } from '../../../test/support/hosted-manager-bin';
import { buildStubEngine, writeStubEngine } from '../../../test/support/stub-engine-bin';
import { TESTED_ENGINE_VERSION } from '../engine-compat';
import { slugOf } from '../fs/paths';
import { registerEngineIpc, type EngineIpcDeps } from '../ipc';
import { RELAY_URL } from '../launch';
import { adoptionTestSeams } from '../session';
import { MAX_LINE_CHARS } from '../transport';
import { isAlive, procStartOf } from '../supervisor-files';
import { adoptAll } from './adopt';
import { HostConnection } from './client';
import { hostsDirOf, sessionHostBinary, sessionHostPaths } from './files';
import { launchRows } from './restore';
import { liveHosts, readRoster, type RosterEntry } from './roster';
import { adoptHosted, releaseHost } from './transport';

const BINARY = sessionHostBinary(resolve(__dirname, '..', '..', '..', 'out', 'main', 'index.js'));
const PERMISSION = 'spikes/protocol-probe/fixtures/permission-roundtrip.jsonl';
const LONG = 90_000;
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
  scratch = mkdtempSync(join(tmpdir(), 'msh-a-'));
  stubBundle = buildStubEngine(scratch);
  managerBundle = await buildHostedManager(`o16-adoption-${process.pid}`);
}, 120_000);
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(resolve(managerBundle, '..'), { recursive: true, force: true });
});

let userData: string;
const managers: HostedManager[] = [];
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'msh-au-'));
});
afterEach(async () => {
  adoptionTestSeams.beforeFold = null;
  for (const manager of managers.splice(0)) await manager.kill('SIGKILL').catch(() => {});
  for (const entry of readRoster(hostsDirOf(join(userData, 'supervisor')), () => {})) {
    for (const pid of [entry.pid, entry.child?.pid]) {
      try {
        if (pid !== undefined) process.kill(pid, 'SIGKILL');
      } catch {
        // gone
      }
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
const tokenOf = (holderId: string) => readFileSync(sessionHostPaths(hostsDir(), holderId, { userData, tmpdir: tmpdir() }).token, 'utf8');

// The successor: the engine host's handlers in this process, adopting as index.ts's start does; `env` is captured beside
// PATH.
function successor(stub: string, opts: { env?: Record<string, string> } = {}) {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  const emitted: { name: string; payload: unknown }[] = [];
  const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
  const emit: HostEmit = (name, payload) => {
    emitted.push({ name, payload });
    return true;
  };
  const deps = { hostsDir: hostsDir(), binary: BINARY, userData, tmpdir: tmpdir(), log: () => {} };
  const holder: EngineIpcDeps['holder'] = {
    gateSocket: join(userData, 'supervisor', 'gate.sock'),
    start: () => Promise.reject(new Error('the successor launches nothing here')),
    adopt: async (entry, checkpoint, startMs) => {
      const { transport, fence } = await adoptHosted({ ...entry, appSessionId: entry.appSessionId ?? '' }, { ...deps, startMs, token: tokenOf(entry.holderId), checkpoint, maxLineChars: MAX_LINE_CHARS });
      return { transport, fence };
    },
    release: (entry, startMs) => releaseHost(entry, { log: () => {}, startMs, token: tokenOf(entry.holderId) }),
  };
  const ipc = registerEngineIpc(on, emit, {
    userData, replayEnabled: false, log: () => {}, holder,
    binaryProbe: async () => ({ path: stub, testedVersion: TESTED_ENGINE_VERSION, version: TESTED_ENGINE_VERSION, ok: true, error: null }),
    checkRelay: async () => ({ url: RELAY_URL, ok: true, status: 200, latencyMs: 2, checkedAt: '2026-10-31T10:00:00.000Z', error: null }),
    captureEnv: async () => ({ PATH: '/usr/bin:/bin', ...opts.env }),
  });
  const call = async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> => (await handlers.get(name)!(input)) as CommandOutput<N>;
  const events = (id: string): SessionEvent[] =>
    emitted.filter((e) => e.name === 'session.eventBatch' && (e.payload as { appSessionId: string }).appSessionId === id).flatMap((e) => (e.payload as { events: SessionEvent[] }).events);
  const status = (id: string): EngineSessionStatus => ipc.table.get(id as AppSessionId)!.status();
  // the start's adoption: the roster, the rows held, every live host adopted
  const adopt = async () => {
    const { live } = liveHosts(readRoster(hostsDir(), () => {}), { isAlive, procStartOf });
    ipc.table.holdForAdoption(live.flatMap((entry) => (entry.appSessionId ? [entry.appSessionId as AppSessionId] : [])));
    const outcome = await adoptAll(live, { adopt: (entry) => ipc.adopt(entry), log: () => {} });
    for (const entry of live) if (entry.appSessionId) ipc.table.adoptionEnded(entry.appSessionId as AppSessionId);
    return { live, outcome };
  };
  return { ipc, call, events, status, adopt };
}

const fixtureRows = (): JournalRow[] => readFileSync(resolve(__dirname, '..', '..', '..', PERMISSION), 'utf8').trim().split('\n').map((line) => parseJournalRow(JSON.parse(line)));
// The engine's own frames (not the control traffic, which the handshakes and the stand-in answers add to)
const engineFrames = (rows: readonly JournalRow[]) =>
  rows.filter((r) => r.direction === 'in' && !['control_request', 'control_response'].includes((r.frame as { type: string }).type)).map((r) => JSON.stringify(r.frame));
const ofKind = <K extends SessionEvent['kind']>(events: SessionEvent[], kind: K) => events.filter((e): e is Extract<SessionEvent, { kind: K }> => e.kind === kind);

describe.skipIf(!existsSync(BINARY))('adoption after an engine host is killed with SIGKILL', () => {
  it('mid-stream: the successor adopts the same engine and replays exactly from the frontier; each engine frame is journaled once and the sequence continues', { timeout: LONG }, async () => {
    const stub = writeStubEngine(join(scratch, 'claude-mid'), stubBundle, { fixture: PERMISSION, rowMs: 15 });
    const id = 'app-mid';
    const old = startHostedManager(managerBundle, { userData, stub, binary: BINARY, version: TESTED_ENGINE_VERSION });
    managers.push(old);
    await old.call('session.launch', { spec: spec(id) });
    await until(async () => (await old.status(id))?.process === 'ready', 'ready');
    await old.call('session.send', { appSessionId: id, content: 'Use Bash to run exactly git log --oneline. Then say DONE.' });
    await until(() => old.events(id).some((e) => e.kind === 'permission.requested'), 'permission.requested');
    const requested = ofKind(old.events(id), 'permission.requested')[0]!;
    await old.call('session.answer', { appSessionId: id, requestId: requested.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } });
    const before = (await old.status(id))!;
    const seen = old.events(id).length;
    await until(() => old.events(id).length > seen + 3, 'the turn streaming');
    await old.kill('SIGKILL'); // mid-turn: records in the ring, some journaled and not acknowledged, some not journaled

    const next = successor(stub);
    const { live, outcome } = await next.adopt();
    expect(live.map((entry) => entry.appSessionId)).toEqual([id]);
    expect(outcome).toEqual({ adopted: [id], failed: [] });
    await until(() => next.events(id).some((e) => e.kind === 'turn.ended'), 'the turn ended under the successor');
    await until(() => next.status(id).process === 'ready', 'ready');
    const status = next.status(id);
    expect(status).toMatchObject({ pid: before.pid, launchId: before.launchId, holder: { pid: before.holder!.pid, holderId: before.holder!.holderId, adopted: true } });
    expect(ofKind(next.events(id), 'turn.ended')).toHaveLength(1);
    expect(ofKind(next.events(id), 'turn.ended')[0]).toMatchObject({ terminalReason: 'completed' });

    const rows = [...launchRows(join(userData, 'engine-host', 'journal', id), before.launchId)];
    expect(rows.map((r) => r.seq)).toEqual(rows.map((_, i) => i + 1)); // one sequence across both managers
    const attach = rows.find((r) => (r.frame as { event?: string }).event === 'host_attach')!;
    expect(attach.frame).toMatchObject({ replayed: 'exact', fence: 2 });
    // the ring's replay: the records past the frontier the old manager never journaled, journaled before the attach row
    const reconnect = rows.find((r) => (r.frame as { event?: string; trigger?: string }).event === 'reconnect' && (r.frame as { trigger?: string }).trigger === 'host_restart')!;
    expect(rows.filter((r) => r.seq > reconnect.seq && r.seq < attach.seq && r.direction === 'in').length).toBeGreaterThan(0);
    // the engine's frames through the turn's result, each once and in the fixture's order (the replay names the
    // prompt by the uuid this launch wrote it under, where the fixture has the recorded one)
    const fixture = fixtureRows();
    const firstResult = fixture.findIndex((r) => (r.frame as { type?: string }).type === 'result');
    const promptOf = (of: readonly JournalRow[]) => (of.find((r) => r.direction === 'out' && (r.frame as { type: string }).type === 'user')!.frame as { uuid: string }).uuid;
    const [recorded, written] = [promptOf(fixture), promptOf(rows)];
    const played = engineFrames(fixture.slice(0, firstResult + 1)).map((frame) => frame.replaceAll(recorded, written));
    const journaled = engineFrames(rows);
    expect(journaled.slice(0, played.length)).toEqual(played);
  });

  it('with a permission pending: the card is pending once, its answer completes the turn with the same engine, and the killed manager\'s fence is refused', { timeout: LONG }, async () => {
    const stub = writeStubEngine(join(scratch, 'claude-perm'), stubBundle, { fixture: PERMISSION });
    const id = 'app-perm';
    const old = startHostedManager(managerBundle, { userData, stub, binary: BINARY, version: TESTED_ENGINE_VERSION });
    managers.push(old);
    await old.call('session.launch', { spec: spec(id) });
    await until(async () => (await old.status(id))?.process === 'ready', 'ready');
    await old.call('session.send', { appSessionId: id, content: 'Use Bash to run exactly git log --oneline. Then say DONE.' });
    await until(() => old.events(id).some((e) => e.kind === 'permission.requested'), 'permission.requested');
    const requested = ofKind(old.events(id), 'permission.requested')[0]!;
    const before = (await old.status(id))!;
    await old.kill('SIGKILL');

    const next = successor(stub);
    expect((await next.adopt()).outcome.adopted).toEqual([id]);
    await until(() => next.status(id).process === 'ready', 'ready');
    expect(next.status(id).pid).toBe(before.pid);
    expect(next.ipc.table.get(id as AppSessionId)!.brokerItems().map((item) => [item.request.requestId, item.state])).toEqual([[requested.requestId, 'pending']]);
    expect(await next.call('session.answer', { appSessionId: id as AppSessionId, requestId: requested.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } })).toEqual({ outcome: 'delivered' });
    await until(() => next.events(id).some((e) => e.kind === 'turn.ended'), 'turn.ended');
    expect(ofKind(next.events(id), 'turn.ended')[0]).toMatchObject({ terminalReason: 'completed' });
    expect(ofKind(next.events(id), 'permission.requested')).toEqual([]); // the card was the fold's, never raised again

    // the old manager's writer, back at its fence, is refused
    const entry: RosterEntry = readRoster(hostsDir(), () => {}).find((e) => e.appSessionId === id)!;
    const { connection } = await HostConnection.open(entry.socket, tokenOf(entry.holderId), { deadline: Date.now() + 5_000, log: () => {} });
    connection.send({ t: 'attach', role: 'writer', fence: 1 });
    expect(await connection.expect('refused', Date.now() + 5_000)).toMatchObject({ reason: 'fence' });
    connection.close();
  });

  // M3a fix waves 1 and 2 (D58's condition on the synchronous fold): the engine bursts while the successor's fold holds
  // the event loop, and the session host's small ring overflows under a reader that reads nothing. A rendezvous at the
  // fold's entry (the session's test seam) starts the burst and lets the fold go on only once the host has logged closing
  // the lagging reader (its next record left the ring), so the overflow happens during the fold, whatever the timing.
  // The transport reconnects at the next fence and its read finds the head gone: the D45 gap is journaled, the
  // conversation reseeded from the transcript, the lost range passed by the map (so the frontier advances past it), and
  // the adoption still becomes ready and completes the turn with the same engine. The first read's catch-up may have
  // reached the socket before the burst (an exact `host_attach`, then the gap's) or not (the gap's only).
  // P5 O16 M3b fix wave 4: the ring holds everything the engine writes before the kill (about 39 KB of the fixture's
  // turn up to its permission request, one record near 20 KB), so only the burst can overflow it. At 16 KiB the old
  // manager itself could fall behind during the turn on a loaded runner (class 1a run 41275824193): its own reconnect
  // journaled a gap before the kill, giving gap, exact, gap.
  it('the ring overflowing while the adoption folds: the D45 gap, the reseed, the frontier passed, then ready', { timeout: LONG }, async () => {
    const trigger = join(userData, 'burst-now');
    const stub = writeStubEngine(join(scratch, 'claude-burst'), stubBundle, { fixture: PERMISSION, burst: { file: trigger, lines: 400 } });
    const id = 'app-burst';
    const configDir = join(userData, 'config');
    mkdirSync(configDir);
    const env = { CLAUDE_CONFIG_DIR: configDir };
    const old = startHostedManager(managerBundle, { userData, stub, binary: BINARY, version: TESTED_ENGINE_VERSION, hostArgs: ['--ring-cap-bytes', '65536'], env });
    managers.push(old);
    await old.call('session.launch', { spec: spec(id) });
    await until(async () => (await old.status(id))?.process === 'ready', 'ready');
    await old.call('session.send', { appSessionId: id, content: 'Use Bash to run exactly git log --oneline. Then say DONE.' });
    await until(() => old.events(id).some((e) => e.kind === 'permission.requested'), 'permission.requested');
    const requested = ofKind(old.events(id), 'permission.requested')[0]!;
    const before = (await old.status(id))!;
    await old.kill('SIGKILL');

    // the transcript the engine kept: the journal's last conversation message, then one the gap will have lost
    const dir = join(userData, 'engine-host', 'journal', id);
    const message = [...launchRows(dir, before.launchId)].filter((r) => {
      const f = r.frame as { type?: string; uuid?: unknown; parent_tool_use_id?: unknown };
      return (f.type === 'user' || f.type === 'assistant') && typeof f.uuid === 'string' && (r.direction === 'out' || f.parent_tool_use_id === null || f.parent_tool_use_id === undefined);
    }).at(-1)!.frame as { uuid: string; type: string };
    // where the session reads it: the engine's own cwd (its system/init's, the fixture's recording), else the launch's
    const init = [...launchRows(dir, before.launchId)].map((r) => r.frame as { type?: string; subtype?: string; cwd?: unknown }).filter((f) => f.type === 'system' && f.subtype === 'init' && typeof f.cwd === 'string').at(-1);
    const cwd = (init?.cwd as string | undefined) ?? before.cwd;
    const project = join(configDir, 'projects', slugOf(existsSync(cwd) ? realpathSync(cwd) : cwd));
    mkdirSync(project, { recursive: true });
    const records = [
      { type: message.type, uuid: message.uuid, parentUuid: null, timestamp: '2026-10-31T10:00:00.000Z', sessionId: before.engineSessionId, message: { role: message.type, content: 'as journaled' } },
      { type: 'assistant', uuid: 'a-gap', parentUuid: message.uuid, timestamp: '2026-10-31T10:00:01.000Z', sessionId: before.engineSessionId, message: { id: 'msg_gap', model: 'claude-sonnet-5', role: 'assistant', content: [{ type: 'text', text: 'restored from the transcript' }] } },
    ];
    writeFileSync(join(project, `${before.engineSessionId}.jsonl`), `${records.map((r) => JSON.stringify(r)).join('\n')}\n`);
    // the rendezvous: the fold waits, holding the event loop, until the host has closed its reader for lagging
    const hostLog = sessionHostPaths(hostsDir(), before.launchId, { userData, tmpdir: tmpdir() }).log;
    const closings = () => (existsSync(hostLog) ? readFileSync(hostLog, 'utf8').split('fell behind the ring').length - 1 : 0);
    adoptionTestSeams.beforeFold = (launchId) => {
      if (launchId !== before.launchId) return;
      const seen = closings();
      writeFileSync(trigger, '');
      const deadline = Date.now() + 30_000;
      while (closings() === seen) {
        if (Date.now() > deadline) throw new Error('the session host never closed the lagging reader');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    };
    const next = successor(stub, { env });
    expect((await next.adopt()).outcome).toEqual({ adopted: [id], failed: [] });
    expect(next.status(id)).toMatchObject({ process: 'ready', pid: before.pid });

    const rows = [...launchRows(dir, before.launchId)];
    const attaches = rows.filter((r) => (r.frame as { event?: string }).event === 'host_attach');
    expect([['exact', 'gap'], ['gap']]).toContainEqual(attaches.map((r) => (r.frame as { replayed: string }).replayed));
    const attach = attaches.at(-1)!;
    const gap = attach.frame as { replayed: string; firstSeq: number; frontier: number; fence: number };
    expect(gap.fence).toBe(3); // the reconnect after the host closed the lagging reader
    expect(gap.firstSeq).toBeGreaterThan(gap.frontier + 1);
    const reseed = rows.find((r) => (r.frame as { event?: string }).event === 'transcript_reseed')!;
    expect(reseed.seq).toBeGreaterThan(attach.seq);
    expect((reseed.frame as { rows: { uuid: string }[] }).rows.map((r) => r.uuid)).toEqual(['a-gap']);
    expect(readFileSync(join(dir, `${before.launchId}.hseq`), 'utf8')).toContain(`\n${gap.firstSeq - 1} *\n`); // the lost range passed
    expect(next.events(id).some((e) => e.kind === 'notice.posted' && e.key === 'holder:gap')).toBe(true);
    expect(next.status(id).work!.unknown).toBe('host_gap');

    expect(await next.call('session.answer', { appSessionId: id as AppSessionId, requestId: requested.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } })).toEqual({ outcome: 'delivered' });
    await until(() => next.events(id).some((e) => e.kind === 'turn.ended'), 'turn.ended');
    expect(ofKind(next.events(id), 'turn.ended')[0]).toMatchObject({ terminalReason: 'completed' });
  });
});

// P5 O16 M3b (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3's Proves; D9, D34): the handover over the real
// session host. The old manager (a process) is asked to hand over right after a prompt, before the engine's permission
// request arrives: nothing in flight, so it detaches at once (the final ack, `host_detach`, the connection ended without
// `release`) and exits; the engine's request, read by no one, waits in the ring; the successor adopts the same engine,
// raises the request live (the old manager never did) and its answer completes the turn. One sequence across both.
describe.skipIf(!existsSync(BINARY))('the handover to a successor', () => {
  it('the old manager detaches and exits; a request the engine sent after the freeze reaches the successor, never the old manager', { timeout: LONG }, async () => {
    const stub = writeStubEngine(join(scratch, 'claude-handover'), stubBundle, { fixture: PERMISSION, rowMs: 150 });
    const id = 'app-handover';
    const old = startHostedManager(managerBundle, { userData, stub, binary: BINARY, version: TESTED_ENGINE_VERSION });
    managers.push(old);
    await old.call('session.launch', { spec: spec(id) });
    await until(async () => (await old.status(id))?.process === 'ready', 'ready');
    const before = (await old.status(id))!;
    await old.call('session.send', { appSessionId: id, content: 'Use Bash to run exactly git log --oneline. Then say DONE.' });
    expect(await old.handover(10_000)).toEqual({ state: 'detaching' });
    await old.exited;
    expect(old.events(id).some((e) => e.kind === 'permission.requested')).toBe(false);
    expect(isAlive(before.pid!)).toBe(true); // the engine outlived its manager

    const rowsBefore = [...launchRows(join(userData, 'engine-host', 'journal', id), before.launchId)];
    expect(rowsBefore.at(-1)!.frame).toMatchObject({ event: 'host_detach', reason: 'handover', holderId: before.holder!.holderId });

    const next = successor(stub);
    expect((await next.adopt()).outcome).toEqual({ adopted: [id], failed: [] });
    await until(() => next.events(id).some((e) => e.kind === 'permission.requested'), 'the request raised by the successor', 30_000);
    expect(next.status(id)).toMatchObject({ pid: before.pid, holder: { holderId: before.holder!.holderId, adopted: true } });
    const requested = ofKind(next.events(id), 'permission.requested')[0]!;
    expect(await next.call('session.answer', { appSessionId: id as AppSessionId, requestId: requested.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } })).toEqual({ outcome: 'delivered' });
    await until(() => next.events(id).some((e) => e.kind === 'turn.ended'), 'turn.ended', 30_000);
    expect(ofKind(next.events(id), 'turn.ended')[0]).toMatchObject({ terminalReason: 'completed' });

    const rows = [...launchRows(join(userData, 'engine-host', 'journal', id), before.launchId)];
    expect(rows.map((r) => r.seq)).toEqual(rows.map((_, i) => i + 1)); // one sequence across both managers
    const detach = rows.findIndex((r) => (r.frame as { event?: string }).event === 'host_detach');
    const attach = rows.find((r) => (r.frame as { event?: string }).event === 'host_attach')!;
    expect(attach.seq).toBeGreaterThan(rows[detach]!.seq);
    expect(attach.frame).toMatchObject({ replayed: 'exact' });
    const permissionRows = rows.filter((r) => r.direction === 'in' && (r.frame as { request?: { subtype?: string } }).request?.subtype === 'can_use_tool');
    expect(permissionRows).toHaveLength(1); // journaled once, by the successor
    expect(permissionRows[0]!.seq).toBeGreaterThan(rows[detach]!.seq);
    // the engine's frames through the turn's result, each once and in the fixture's order
    const fixture = fixtureRows();
    const firstResult = fixture.findIndex((r) => (r.frame as { type?: string }).type === 'result');
    const promptOf = (of: readonly JournalRow[]) => (of.find((r) => r.direction === 'out' && (r.frame as { type: string }).type === 'user')!.frame as { uuid: string }).uuid;
    const [recorded, written] = [promptOf(fixture), promptOf(rows)];
    const played = engineFrames(fixture.slice(0, firstResult + 1)).map((frame) => frame.replaceAll(recorded, written));
    expect(engineFrames(rows).slice(0, played.length)).toEqual(played);
  });
});
