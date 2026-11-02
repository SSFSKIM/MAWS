// The host transport over the committed session host binary (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M2's
// tests): a host started and attached, the launch's records handed on with their sequences, writes settled by the host's
// answers, the frontier's acks trimming the ring, the release after the exit, a reconnect while the host lives (D45),
// and a host that dies (`host_lost`, its child ended). Runs wherever a prebuild matches the platform.
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LaunchPlan } from '../launch';
import { signalOrphan } from '../live-ledger';
import { isAlive, procStartOf } from '../supervisor-files';
import type { EngineTransport, StderrItem, TransportItem } from '../transport';
import { HostConnection } from './client';
import { hostsDirOf, sessionHostBinary } from './files';
import { adoptHosted, HostStartFailed, startSessionHost, type SessionHostDeps, type StartedHost } from './transport';

const BINARY = sessionHostBinary(resolve(__dirname, '..', '..', '..', 'out', 'main', 'index.js'));
const LONG = 30_000;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

const scratch: string[] = [];
const started: StartedHost[] = [];
const pids: number[] = [];
afterEach(async () => {
  for (const host of started.splice(0)) {
    try {
      process.kill(host.pid, 'SIGTERM');
    } catch {
      // gone
    }
  }
  for (const pid of pids.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // gone
    }
  }
  await sleep(50);
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function profile(): { userData: string; deps: SessionHostDeps; logs: string[] } {
  const userData = mkdtempSync(join(tmpdir(), 'msh-t-'));
  scratch.push(userData);
  const logs: string[] = [];
  return { userData, logs, deps: { hostsDir: hostsDirOf(join(userData, 'supervisor')), binary: BINARY, userData, tmpdir: tmpdir(), log: (line) => logs.push(line) } };
}

const plan = (argv: string[], over: Partial<LaunchPlan> = {}): LaunchPlan => ({
  bin: argv[0]!, args: argv.slice(1), env: { PATH: '/usr/bin:/bin' }, cwd: '/', flagSettings: {}, launchId: 'unused', sessionId: 'eng-1' as LaunchPlan['sessionId'], gateway: 'direct', engineVersion: 'test', ...over,
});

async function start(deps: SessionHostDeps, launchId = `L${Math.random().toString(36).slice(2, 9)}`): Promise<StartedHost> {
  const host = await startSessionHost(launchId, deps);
  started.push(host);
  return host;
}

// Pulls items from an async iterable as they come, for assertions in order.
function reader<T>(iterable: AsyncIterable<T>): { next(within?: number): Promise<T>; done: Promise<void> } {
  const it = iterable[Symbol.asyncIterator]();
  let finished!: () => void;
  const done = new Promise<void>((resolve) => (finished = resolve));
  return {
    async next(within = 10_000) {
      const result = await Promise.race([it.next(), sleep(within).then(() => null)]);
      if (result === null) throw new Error('no item in time');
      if (result.done) {
        finished();
        throw new Error('the stream ended');
      }
      return result.value;
    },
    done,
  };
}

async function drain<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

// A second, observing connection's view of the host (its hello).
async function helloOf(host: StartedHost) {
  const token = readFileSync(host.paths.token, 'utf8');
  const { connection, hello } = await HostConnection.open(host.paths.socket, token, { deadline: Date.now() + 5_000, log: () => {} });
  connection.close();
  return hello;
}

function frameOf(item: TransportItem): unknown {
  expect(item.error).toBeNull();
  return item.frame;
}

// What a promise settled to within `ms`, or 'pending'.
async function within<T>(promise: Promise<T>, ms: number): Promise<T | 'pending'> {
  return Promise.race([promise, sleep(ms).then(() => 'pending' as const)]);
}

describe.skipIf(!existsSync(BINARY))('the host transport', () => {
  it('starts a host attached as writer, and hands on the launch\'s lines with their sequences, a blank one passing the frontier unseen', { timeout: LONG }, async () => {
    const { deps } = profile();
    const host = await start(deps);
    expect(host.hello).toMatchObject({ protocol: 1, state: 'ready', child: null });
    expect(statSync(host.paths.token).mode & 0o777).toBe(0o600);
    const t = host.transport(plan(['/bin/sh', '-c', 'echo \'{"type":"a"}\'; echo; sleep 0.2; echo warn >&2; sleep 0.2; echo not-json; exit 3']), { appSessionId: 'app-1', maxLineChars: 1024 });
    const frames = drain(t.frames);
    const stderr = drain(t.stderr);
    expect(await t.exited).toEqual({ code: 3, signal: null });
    const items = await frames;
    expect(items.map((i) => [i.hseq, i.error?.kind ?? null, i.frame])).toEqual([[1, null, { type: 'a' }], [4, 'parse_error', null]]);
    expect((await stderr).map((s: StderrItem) => [s.hseq, s.text])).toEqual([[3, 'warn']]);
    expect(t.pid).toEqual(expect.any(Number));
    expect(t.holder).toEqual({ pid: host.pid, holderId: host.holderId, fence: 1 });
    // the roster names the launch's ids
    const roster = JSON.parse(readFileSync(host.paths.roster, 'utf8')) as Record<string, unknown>;
    expect(roster).toMatchObject({ appSessionId: 'app-1', engineSessionId: 'eng-1' });
    // journaled 1, 3, 4 (2 was blank): the frontier reaches the last record and the host is released
    for (const seq of [1, 3, 4]) t.journaled!(seq);
    await expectGone(host.pid);
    expect(existsSync(host.paths.roster)).toBe(false);
  });

  it('writes resolve at the host\'s applied; acks of the journaled frontier trim the ring, and a held record keeps it', { timeout: LONG }, async () => {
    const { deps } = profile();
    const host = await start(deps);
    const t = host.transport(plan(['/bin/cat']), { appSessionId: 'app-1', maxLineChars: 1024 });
    const frames = reader(t.frames);
    await t.write({ type: 'keep_alive' } as never);
    await t.write({ type: 'control_cancel_request', request_id: 'r1' } as never);
    const one = await frames.next();
    const two = await frames.next();
    expect([one.hseq, frameOf(one)]).toEqual([1, { type: 'keep_alive' }]);
    expect(two.hseq).toBe(2);
    t.journaled!(2); // record 1 held (as behind an in-flight write): nothing may be acknowledged
    await sleep(200);
    expect((await helloOf(host)).ring).toMatchObject({ firstSeq: 1, lastSeq: 2 });
    t.journaled!(1);
    await sleep(200);
    const hello = await helloOf(host);
    expect(hello.ring.bytes).toBe(0);
    expect(hello.stdinApplied).toBe(hello.stdinAccepted);
    t.endInput();
    expect(await t.exited).toEqual({ code: 0, signal: null });
  });

  it('honours an abort only before the record is written to a connection; after, the write settles on the host\'s answer', { timeout: LONG }, async () => {
    const { deps } = profile();
    const host = await start(deps);
    const t = host.transport(plan(['/bin/cat']), { appSessionId: 'app-1', maxLineChars: 1024 });
    const controller = new AbortController();
    const early = t.write({ type: 'user', marker: 'never' } as never, controller.signal); // waits for the spawn
    controller.abort();
    await expect(early).rejects.toThrow('write aborted');
    await t.write({ type: 'user', marker: 'first' } as never); // the spawn has settled: the next write goes at once
    const late = new AbortController();
    const sent = t.write({ type: 'user', marker: 'sent' } as never, late.signal);
    await new Promise((done) => setImmediate(done)); // written to the socket, its answer not back
    late.abort();
    await expect(sent).resolves.toBeUndefined();
    t.endInput();
    const items = await drain(t.frames);
    expect(items.map((i) => (i.frame as { marker?: string }).marker)).toEqual(['first', 'sent']);
  });

  it('drops a record aborted while it waits for a reconnect: it is never written, and the next one takes its offset', { timeout: LONG }, async () => {
    const { deps } = profile();
    let first: HostConnection | null = null;
    const host = await start({ ...deps, onConnection: (c) => (first ??= c) });
    const t = host.transport(plan(['/bin/cat']), { appSessionId: 'app-1', maxLineChars: 1024 });
    await t.write({ type: 'n', k: 1 } as never);
    first!.close();
    await new Promise((done) => setImmediate(done)); // the close is seen: the transport is reconnecting
    const controller = new AbortController();
    const waiting = t.write({ type: 'n', k: 'never' } as never, controller.signal);
    for (let i = 0; i < 20; i += 1) await Promise.resolve(); // queued behind the reconnect, not written
    controller.abort();
    await expect(waiting).rejects.toThrow('write aborted');
    await t.write({ type: 'n', k: 3 } as never);
    t.endInput();
    const items = await drain(t.frames);
    expect(items.map((i) => (i.frame as { k?: unknown }).k)).toEqual([1, 3]);
    expect(await t.exited).toEqual({ code: 0, signal: null });
  });

  it('recovers a spawned reply lost with its connection from the reconnect\'s view of the host', { timeout: LONG }, async () => {
    const { deps } = profile();
    let first: HostConnection | null = null;
    const host = await start({ ...deps, onConnection: (c) => (first ??= c) });
    const t = host.transport(plan(['/bin/sh', '-c', 'echo "{\\"pid\\":$$}"; exec cat']), { appSessionId: 'app-1', maxLineChars: 1024 });
    first!.close(); // launch and commit are on the wire; their `spawned` goes to a closed connection
    const frames = reader(t.frames);
    await t.write({ type: 'n', k: 1 } as never); // waits for the spawn's outcome, recovered after the reconnect
    const announced = frameOf(await frames.next()) as { pid: number };
    expect(t.pid).toBe(announced.pid);
    expect(frameOf(await frames.next())).toEqual({ type: 'n', k: 1 });
    t.endInput();
    expect(await t.exited).toEqual({ code: 0, signal: null });
  });

  // fix wave 2: a spawn still under way when the reconnect asks; the host's --spawn-delay-ms holds the fork open
  it('waits out a spawn under way across a reconnect and takes its child once it shows', { timeout: LONG }, async () => {
    const { deps } = profile();
    let first: HostConnection | null = null;
    const host = await start({ ...deps, hostArgs: ['--spawn-delay-ms', '600'], onConnection: (c) => (first ??= c) });
    const t = host.transport(plan(['/bin/sh', '-c', 'echo "{\\"pid\\":$$}"; exec cat']), { appSessionId: 'app-1', maxLineChars: 1024 });
    await sleep(100); // committed: the fork is held open
    first!.close();
    const frames = reader(t.frames);
    await t.write({ type: 'n', k: 1 } as never);
    expect(t.pid).toBe((frameOf(await frames.next()) as { pid: number }).pid);
    expect(frameOf(await frames.next())).toEqual({ type: 'n', k: 1 });
    t.endInput();
    expect(await t.exited).toEqual({ code: 0, signal: null });
  });

  it('a spawn still under way when the reconnect\'s bound passes ends the host through its own shutdown, and no child survives', { timeout: LONG }, async () => {
    const { deps } = profile();
    let first: HostConnection | null = null;
    const host = await start({ ...deps, startMs: 400, hostArgs: ['--spawn-delay-ms', '1500'], onConnection: (c) => (first ??= c) });
    const t = host.transport(plan(['/bin/sleep', '600']), { appSessionId: 'app-1', maxLineChars: 1024 });
    await sleep(100);
    first!.close();
    const items = drain(t.frames);
    await expect(t.write({ type: 'n', k: 1 } as never)).rejects.toThrow();
    // the session ends as a failed spawn, or as a lost host when the bound passed inside the reconnect's own connect
    expect((await items).map((i) => i.error?.kind)).toEqual([expect.stringMatching(/^(spawn_error|host_lost)$/)]);
    expect(t.pid).toBeNull();
    await expectGone(host.pid, 10_000); // SIGTERM: the host waited for its fork (1.5 s), then ended the child's group
    // the fork completed after the SIGTERM (the host waited for it), and its child was ended with the host
    const spawned = /spawned (\d+)/.exec(readFileSync(host.paths.log, 'utf8'));
    expect(spawned).not.toBeNull();
    const child = Number(spawned![1]);
    pids.push(child);
    await expectGone(child, 5_000);
  });

  // D45 under a burst that outruns the ring. The first connection is held unread until the burst is written whole (the
  // marker), so at least one loss is certain. How many reconnects and gaps follow is the runner's speed, not a rule: a
  // runner may notice the held connection's close while the burst still runs (the class 1a pool did: 15 reconnects, 12
  // gaps), and each reconnect then reads on a fresh socket that a 64 KiB ring can outrun again, the host closing it at
  // the loss (D43). So the test pins what holds whatever the count: every loss reported once as a gap at the point the
  // stream reached, the gaps and the survivors covering every sequence once in order, one fence per reconnect, the release.
  it('a reconnect whose replay starts past the ring\'s loss reports each gap at its place before the survivors, and the frontier passes them to the release (D45)', { timeout: LONG }, async () => {
    const { deps, logs } = profile();
    let first: HostConnection | null = null;
    const host = await start({ ...deps, hostArgs: ['--ring-cap-bytes', '65536'], onConnection: (c) => (first ??= c) });
    const lines = 40_000;
    // the burst's end, marked by the shell once its loop has written every line: the first connection is held until
    // then, so the ring has lost what that connection had not read whatever the runner's speed
    const marks = mkdtempSync(join(tmpdir(), 'msh-burst-'));
    scratch.push(marks);
    const written = join(marks, 'written');
    const t = host.transport(plan(['/bin/sh', '-c', `read go; i=0; while [ $i -lt ${lines} ]; do echo "{\\"n\\":$i,\\"pad\\":\\"${'x'.repeat(100)}\\"}"; i=$((i+1)); done; : > '${written}'; read done; exit 0`]), { appSessionId: 'app-1', maxLineChars: 1024 });
    await t.write({ type: 'go' } as never);
    const socket = (first as unknown as { socket: import('node:net').Socket }).socket;
    socket.pause(); // the writer stops reading: the burst (about 5 MB, past any socket buffer) outruns the ring, and the host closes the lagging connection
    for (const until = Date.now() + 20_000; !existsSync(written) && Date.now() < until; ) await sleep(50);
    expect(existsSync(written), 'the burst written whole before the reader resumes').toBe(true);
    socket.resume();
    const items: TransportItem[] = [];
    const all = (async () => {
      for await (const item of t.frames) {
        items.push(item);
        if (item.error?.kind === 'host_gap') for (let seq = item.error.gap!.lostFrom; seq < item.error.gap!.firstSeq; seq += 1) t.journaled!(seq);
        else if (item.hseq !== undefined) t.journaled!(item.hseq);
        if ((item.frame as { n?: number } | null)?.n === lines - 1) t.endInput();
      }
    })();
    await all;
    expect(await t.exited).toEqual({ code: 0, signal: null });
    const gaps = items.filter((i) => i.error?.kind === 'host_gap').map((i) => i.error!.gap!);
    const reconnects = logs.filter((line) => / reconnected as writer at fence \d+, reading from \d+$/.test(line)).length;
    const shape = JSON.stringify({ gaps: gaps.map((g) => [g.lostFrom, g.firstSeq, g.fence]), reconnects }); // the failure's evidence
    expect(gaps.length, shape).toBeGreaterThanOrEqual(1);
    // every sequence once, in order: a gap starts where the stream had reached, its survivors start at its firstSeq
    let next = 1;
    for (const item of items) {
      if (item.error?.kind === 'host_gap') {
        const { lostFrom, firstSeq } = item.error.gap!;
        expect([lostFrom, firstSeq > lostFrom], shape).toEqual([next, true]);
        next = firstSeq;
      } else if (item.hseq !== undefined) {
        expect(item.hseq, shape).toBe(next);
        next += 1;
      }
    }
    expect((items.findLast((i) => i.hseq !== undefined)?.frame as { n?: number } | null)?.n, shape).toBe(lines - 1); // the burst's last line
    // one fence per reconnect, each gap reported at the fence of the read that found it
    expect(reconnects, shape).toBeGreaterThanOrEqual(gaps.length);
    expect(t.holder!.fence, shape).toBe(1 + reconnects);
    const fences = gaps.map((g) => g.fence);
    expect(fences.every((fence, i) => fence >= 2 && fence <= t.holder!.fence && (i === 0 || fence > fences[i - 1]!)), shape).toBe(true);
    await expectGone(host.pid); // every record journaled or lost: the frontier reached the end and the host was released
  });

  it('reconnects as writer at the next fence when its connection closes while the host lives, losing nothing (D45)', { timeout: LONG }, async () => {
    const { deps } = profile();
    let first: HostConnection | null = null;
    const host = await start({ ...deps, onConnection: (c) => (first ??= c) });
    const t = host.transport(plan(['/bin/cat']), { appSessionId: 'app-1', maxLineChars: 1024 });
    const frames = reader(t.frames);
    await t.write({ type: 'n', k: 1 } as never);
    expect(frameOf(await frames.next())).toEqual({ type: 'n', k: 1 });
    first!.close();
    await t.write({ type: 'n', k: 2 } as never); // waits for the reconnect, then goes once
    const next = await frames.next();
    expect([next.hseq, frameOf(next)]).toEqual([2, { type: 'n', k: 2 }]);
    expect(t.holder!.fence).toBe(2);
    t.endInput();
    expect(await t.exited).toEqual({ code: 0, signal: null });
  });

  // O16 panel wave 1 (sweep#1): a handover's detach owns the session from then on; a reconnect already under way
  // neither attaches a writer nor ends the host or its engine
  it('a detach while the writer reconnects attaches no writer: the host keeps its engine for the successor', { timeout: LONG }, async () => {
    const { deps, logs } = profile();
    const signals: string[] = [];
    let t: EngineTransport | null = null;
    const connections: HostConnection[] = [];
    const host = await start({
      ...deps, child: { isAlive, procStartOf, signal: (_pid, name) => void signals.push(name), graceMs: 200 },
      onConnection: (c) => {
        connections.push(c);
        if (connections.length === 2) t!.detach!({ ack: true }); // the handover lands while the reconnect has connected
      },
    });
    t = host.transport(plan(['/bin/cat']), { appSessionId: 'app-1', maxLineChars: 1024 });
    const frames = drain(t.frames);
    await t.write({ type: 'n', k: 1 } as never);
    pids.push(t.pid!);
    connections[0]!.close();
    expect(await within(frames, 5_000)).not.toBe('pending'); // the stream ended at the detach
    await sleep(300);
    expect(connections.length).toBe(2);
    expect(await helloOf(host)).toMatchObject({ state: 'running', fence: 1, writer: false });
    expect(signals).toEqual([]);
    expect(logs.filter((line) => line.includes(' is lost: '))).toEqual([]);
    expect(isAliveNow(t.pid!)).toBe(true);
  });

  it('a detach while the writer reconnects ends nothing when that reconnect then fails', { timeout: LONG }, async () => {
    const { deps, logs } = profile();
    const signals: string[] = [];
    let first: HostConnection | null = null;
    const host = await start({ ...deps, startMs: 1_500, child: { isAlive, procStartOf, signal: (_pid, name) => void signals.push(name), graceMs: 200 }, onConnection: (c) => (first ??= c) });
    const t = host.transport(plan(['/bin/cat']), { appSessionId: 'app-1', maxLineChars: 1024 });
    await t.write({ type: 'n', k: 1 } as never);
    pids.push(t.pid!);
    const moved = `${host.paths.socket}.moved`;
    renameSync(host.paths.socket, moved); // the reconnect finds no socket until its bound passes
    first!.close();
    t.detach!({ ack: true });
    await sleep(2_500);
    renameSync(moved, host.paths.socket);
    expect(logs.some((line) => line.includes('the reconnect after'))).toBe(true); // it ran, and failed
    expect(logs.filter((line) => line.includes(' is lost: '))).toEqual([]);
    expect(signals).toEqual([]);
    expect(isAliveNow(t.pid!)).toBe(true);
    expect(isAliveNow(host.pid)).toBe(true);
  });

  // O16 panel wave 1 (scalpel-5#2): a stop's EOF and signal asked while no connection carries them are sent once the
  // writer is back, not dropped
  it('an end asked while the writer reconnects is sent once the writer is back', { timeout: LONG }, async () => {
    const { deps } = profile();
    let first: HostConnection | null = null;
    const host = await start({ ...deps, onConnection: (c) => (first ??= c) });
    const t = host.transport(plan(['/bin/cat']), { appSessionId: 'app-1', maxLineChars: 1024 });
    const frames = drain(t.frames);
    await t.write({ type: 'n', k: 1 } as never);
    first!.close();
    t.endInput();
    expect(await within(t.exited, 5_000)).toEqual({ code: 0, signal: null });
    expect((await frames).map((i) => (i.frame as { k?: unknown }).k)).toEqual([1]);
  });

  it('a signal asked while the writer reconnects is sent once the writer is back', { timeout: LONG }, async () => {
    const { deps } = profile();
    let first: HostConnection | null = null;
    const host = await start({ ...deps, onConnection: (c) => (first ??= c) });
    const t = host.transport(plan(['/bin/cat']), { appSessionId: 'app-1', maxLineChars: 1024 });
    await t.write({ type: 'n', k: 1 } as never);
    pids.push(t.pid!);
    first!.close();
    t.kill('SIGTERM');
    expect(await within(t.exited, 5_000)).toEqual({ code: null, signal: 'SIGTERM' });
  });

  // O16 panel wave 1 (scalpel-4#1): `exited` is what frees the row's reservation, so it waits for the engine's end
  it('a host killed with SIGKILL ends the session as host_lost, and reads exited only once its child is ended', { timeout: LONG }, async () => {
    const { deps } = profile();
    const host = await start({ ...deps, child: { isAlive, procStartOf, signal: signalOrphan, graceMs: 1_000 } });
    const t = host.transport(plan(['/bin/sh', '-c', 'trap "" TERM; echo up; while :; do sleep 1; done']), { appSessionId: 'app-1', maxLineChars: 1024 });
    const frames = reader(t.frames);
    await frames.next().catch(() => null); // `up` is not JSON: a parse problem item
    const child = t.pid!;
    pids.push(child);
    process.kill(host.pid, 'SIGKILL');
    const lost = await frames.next();
    expect(lost.error?.kind).toBe('host_lost');
    expect(await within(t.exited, 500)).toBe('pending'); // SIGTERM ignored: the child lives through its grace
    expect(isAliveNow(child)).toBe(true);
    expect(await t.exited).toEqual({ code: null, signal: 'SIGKILL' });
    expect(isAliveNow(child)).toBe(false); // SIGKILL to its group after the grace, and its end awaited
  });

  it('fails the start, naming the host\'s log, when the binary cannot run or exits at once', { timeout: LONG }, async () => {
    const { deps } = profile();
    await expect(startSessionHost('Lmissing', { ...deps, binary: join(deps.hostsDir, 'nope') })).rejects.toThrow(HostStartFailed);
    const failed = (await startSessionHost('Lfalse', { ...deps, binary: '/usr/bin/false' }).catch((error: unknown) => error)) as HostStartFailed;
    expect(failed).toBeInstanceOf(HostStartFailed);
    expect(failed.message).toContain(join(deps.hostsDir, 'Lfalse.log'));
    expect(existsSync(join(deps.hostsDir, 'Lfalse.token'))).toBe(false);
  });

  it('an abandoned host, which launched nothing, is released and removes its files', { timeout: LONG }, async () => {
    const { deps } = profile();
    const host = await startSessionHost('Labandon', deps);
    host.abandon();
    await expectGone(host.pid);
    expect(existsSync(host.paths.roster)).toBe(false);
    expect(existsSync(host.paths.socket)).toBe(false);
  });
});

// O16 panel wave 1 (scalpel-5#1): the host tells every connection of its child's exit, one that has attached but not
// yet read too, so an exit can come between a writer's hello and its read, ahead of the ring's replay. A scripted host
// (the host's side of Interfaces §A, as each case directs) puts the exit exactly there.
type ScriptedMessage = { t: string } & Record<string, unknown>;
type Reply = (out: object | Buffer) => void;
const recordOf = (seq: number, line: string): Buffer => Buffer.concat([Buffer.from(`{"t":"out","seq":${seq},"len":${Buffer.byteLength(line)}}\n`), Buffer.from(line)]);
const EXIT = { t: 'exit', code: 0, signal: null, at: '2026-11-01T10:00:00.000Z' };
const helloLine = (over: Record<string, unknown> = {}) => ({
  t: 'hello', protocol: 1, holderId: 'Lscripted', pid: process.pid, procStart: '', appSessionId: 'app-s', engineSessionId: 'eng-s', state: 'running',
  child: { pid: 2_000_000_000, procStart: 'x' }, fence: 1, writer: false, stdinApplied: 0, stdinAccepted: 0, stdinQueued: 0, ring: { firstSeq: 1, lastSeq: 2, bytes: 10 }, exit: null, ...over,
});
const attachedLine = (fence: number) => ({ t: 'attached', fence, stdinApplied: 0, stdinAccepted: 0, ring: { firstSeq: 1, lastSeq: 2, bytes: 10 } });

async function scriptedHost(on: (message: ScriptedMessage, reply: Reply, connection: number) => void): Promise<{ socket: string; connections: Socket[]; received: ScriptedMessage[] }> {
  const dir = mkdtempSync(join(tmpdir(), 'msh-s-'));
  scratch.push(dir);
  const socket = join(dir, 'h.sock');
  const connections: Socket[] = [];
  const received: ScriptedMessage[] = [];
  const server = createServer((s) => {
    connections.push(s);
    const n = connections.length;
    let pending = '';
    s.on('data', (chunk: Buffer) => {
      pending += chunk.toString('utf8');
      for (let at = pending.indexOf('\n'); at !== -1; at = pending.indexOf('\n')) {
        const message = JSON.parse(pending.slice(0, at)) as ScriptedMessage;
        pending = pending.slice(at + 1);
        received.push(message);
        on(message, (out) => s.write(Buffer.isBuffer(out) ? out : `${JSON.stringify(out)}\n`), n);
      }
    });
    s.on('error', () => {});
  });
  await new Promise<void>((done) => server.listen(socket, done));
  servers.push({ server, connections });
  return { socket, connections, received };
}
const servers: { server: ReturnType<typeof createServer>; connections: Socket[] }[] = [];
afterEach(async () => {
  for (const { server, connections } of servers.splice(0)) {
    for (const connection of connections) connection.destroy();
    await new Promise((done) => server.close(done));
  }
});

function adoptDeps(): Parameters<typeof adoptHosted>[1] {
  return { hostsDir: '/nonexistent', binary: '/nonexistent', userData: '/nonexistent', tmpdir: tmpdir(), log: () => {}, token: 't'.repeat(64), checkpoint: { frontier: 0, above: [] }, maxLineChars: 1024 };
}
const entryOf = (socket: string) => ({ holderId: 'Lscripted', pid: process.pid, procStart: '', socket, appSessionId: 'app-s' });

describe('an exit that comes between the hello and the read (scalpel-5#1)', () => {
  it('an adoption hands on the ring\'s replay before the exit ends the streams, and releases once it is journaled', async () => {
    const host = await scriptedHost((m, reply) => {
      if (m.t === 'auth') reply(helloLine());
      else if (m.t === 'attach') {
        reply(EXIT); // the child exits after the hello: told before the attach's answer
        reply(attachedLine(2));
      } else if (m.t === 'read') {
        reply(recordOf(1, '{"n":1}'));
        reply(recordOf(2, '{"n":2}'));
        reply({ t: 'caughtUp', lastSeq: 2, gap: null });
      }
    });
    const { transport: t } = await adoptHosted(entryOf(host.socket), adoptDeps());
    const items = await within(drain(t.frames), 5_000);
    expect(items === 'pending' ? items : items.map((i) => [i.hseq ?? null, i.error?.kind ?? null, i.frame])).toEqual([[1, null, { n: 1 }], [2, null, { n: 2 }]]);
    expect(await t.exited).toEqual({ code: 0, signal: null });
    expect(host.received.some((m) => m.t === 'release')).toBe(false);
    t.journaled!(1);
    t.journaled!(2);
    await sleep(50);
    expect(host.received.filter((m) => m.t === 'release')).toHaveLength(1);
  });

  it('a reconnect hands on its replay, a gap included, before the exit ends the streams', async () => {
    const host = await scriptedHost((m, reply, n) => {
      if (m.t === 'auth') reply(helloLine({ fence: n }));
      else if (m.t === 'attach' && n === 1) reply(attachedLine(2));
      else if (m.t === 'attach') {
        reply(EXIT);
        reply(attachedLine(3));
      } else if (m.t === 'read' && n === 1) {
        reply(recordOf(1, '{"n":1}'));
        reply({ t: 'caughtUp', lastSeq: 1, gap: null });
      } else if (m.t === 'read') {
        reply(recordOf(4, '{"n":4}')); // read from 2: 2 and 3 left the ring meanwhile
        reply({ t: 'caughtUp', lastSeq: 4, gap: 4 });
      }
    });
    const { transport: t } = await adoptHosted(entryOf(host.socket), adoptDeps());
    const frames = reader(t.frames);
    expect(frameOf(await frames.next())).toEqual({ n: 1 });
    expect((await frames.next()).error?.kind).toBe('host_caught_up');
    host.connections[0]!.destroy(); // the writer's connection is lost while the host lives: a reconnect
    const rest: TransportItem[] = [];
    const ended = (async () => {
      for (;;) rest.push(await frames.next(5_000));
    })().catch((error: Error) => error.message);
    expect(await ended).toBe('the stream ended');
    expect(rest.map((i) => [i.hseq ?? null, i.error?.kind ?? null, i.error?.gap ? [i.error.gap.lostFrom, i.error.gap.firstSeq] : i.frame])).toEqual([[null, 'host_gap', [2, 4]], [4, null, { n: 4 }]]);
    expect(await t.exited).toEqual({ code: 0, signal: null });
  });
});

function isAliveNow(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function expectGone(pid: number, within = 5_000): Promise<void> {
  const until = Date.now() + within;
  while (isAliveNow(pid)) {
    if (Date.now() > until) throw new Error(`pid ${pid} still alive`);
    await sleep(50);
  }
}

