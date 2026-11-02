// P5 O16 panel fix wave 1 (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, Interfaces §D): a session host whose
// engine host was lost, as its successor finds it at the start, over the committed binary. A host holding a child refuses
// a release, and the release says so (sweep#3); a host whose launch committed before its manager was lost forks its child
// all the same, and the adoption waits for it rather than read it as empty (sweep#3); a stop-all ends a host held for
// adoption through the host's own shutdown, its child stopped, or killed when it outlives the grace (scalpel-1#1). Runs
// wherever a prebuild matches the platform.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { signalOrphan } from '../live-ledger';
import { isAlive, procStartOf } from '../supervisor-files';
import { MAX_LINE_CHARS } from '../transport';
import { HostConnection } from './client';
import { hostsDirOf, sessionHostBinary } from './files';
import { readRoster, type RosterEntry } from './roster';
import { stopHeldHost } from './stop-held';
import { adoptHosted, releaseHost, startSessionHost, type SessionHostDeps, type StartedHost } from './transport';

const BINARY = sessionHostBinary(resolve(__dirname, '..', '..', '..', 'out', 'main', 'index.js'));
const LONG = 30_000;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

const scratch: string[] = [];
const pids: number[] = [];
afterEach(async () => {
  for (const pid of pids.splice(0)) {
    for (const target of [pid, -pid]) {
      try {
        process.kill(target, 'SIGKILL');
      } catch {
        // gone
      }
    }
  }
  await sleep(50);
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function profile(): SessionHostDeps {
  const userData = mkdtempSync(join(tmpdir(), 'msh-h-'));
  scratch.push(userData);
  return { hostsDir: hostsDirOf(join(userData, 'supervisor')), binary: BINARY, userData, tmpdir: tmpdir(), log: () => {} };
}

// A host launched and committed by a manager that is then lost (its writer connection closed): `spawned` waits for the
// child; otherwise the manager is lost while the fork is held open by `spawnDelayMs`.
async function orphaned(deps: SessionHostDeps, argv: string[], opts: { spawnDelayMs?: number; spawned?: boolean } = {}): Promise<{ host: StartedHost; entry: RosterEntry; token: string }> {
  let writer: HostConnection | null = null;
  const host = await startSessionHost(`L${Math.random().toString(36).slice(2, 9)}`, { ...deps, hostArgs: opts.spawnDelayMs ? ['--spawn-delay-ms', String(opts.spawnDelayMs)] : [], onConnection: (c) => (writer ??= c) });
  pids.push(host.pid);
  writer!.send({ t: 'launch', appSessionId: 'app-held', engineSessionId: 'eng-1', argv, cwd: '/', env: { PATH: '/usr/bin:/bin' } });
  writer!.send({ t: 'commit' });
  if (opts.spawned !== false) {
    const spawned = await writer!.expect('spawned', Date.now() + 5_000);
    pids.push(spawned.pid);
  } else await sleep(150);
  writer!.close();
  const entry = readRoster(deps.hostsDir, () => {}).find((e) => e.holderId === host.holderId)!;
  return { host, entry, token: readFileSync(host.paths.token, 'utf8') };
}

const spawnedChild = (host: StartedHost): number => {
  const spawned = /spawned (\d+)/.exec(readFileSync(host.paths.log, 'utf8'));
  if (spawned === null) throw new Error('no child spawned');
  pids.push(Number(spawned[1]));
  return Number(spawned[1]);
};

const stopDeps = (deps: SessionHostDeps, graceMs?: number) => ({ hostsDir: deps.hostsDir, isAlive, procStartOf, signal: signalOrphan, sleep, log: () => {}, graceMs });

async function expectGone(pid: number, within = 5_000): Promise<void> {
  const until = Date.now() + within;
  while (isAlive(pid)) {
    if (Date.now() > until) throw new Error(`pid ${pid} still alive`);
    await sleep(50);
  }
}

describe.skipIf(!existsSync(BINARY))('a session host whose engine host was lost', () => {
  it('refuses the release of a host holding a running child, which keeps it', { timeout: LONG }, async () => {
    const deps = profile();
    const { host, entry, token } = await orphaned(deps, ['/bin/sleep', '600']);
    expect(entry).toMatchObject({ state: 'running', child: { pid: expect.any(Number) } });
    await expect(releaseHost(entry, { log: () => {}, startMs: 5_000, token })).rejects.toThrow(/refused its release: the child has not exited/);
    await sleep(100);
    expect([isAlive(host.pid), isAlive(entry.child!.pid)]).toEqual([true, true]);
  });

  it('releases a host whose launch never committed: it exits', { timeout: LONG }, async () => {
    const deps = profile();
    let writer: HostConnection | null = null;
    const host = await startSessionHost('Lready01', { ...deps, onConnection: (c) => (writer ??= c) });
    pids.push(host.pid);
    writer!.close();
    const entry = readRoster(deps.hostsDir, () => {}).find((e) => e.holderId === host.holderId)!;
    expect(entry).toMatchObject({ state: 'ready', child: null });
    await releaseHost(entry, { log: () => {}, startMs: 5_000, token: readFileSync(host.paths.token, 'utf8') });
    await expectGone(host.pid);
  });

  it('adopts a host lost while its committed spawn was under way, once its child shows', { timeout: LONG }, async () => {
    const deps = profile();
    const { host, entry, token } = await orphaned(deps, ['/bin/sh', '-c', 'echo "{\\"pid\\":$$}"; exec cat'], { spawnDelayMs: 800, spawned: false });
    expect(entry).toMatchObject({ state: 'committed', child: null });
    const { transport, hello } = await adoptHosted({ ...entry, appSessionId: 'app-held' }, { ...deps, startMs: 5_000, token, checkpoint: { frontier: 0, above: [] }, maxLineChars: MAX_LINE_CHARS });
    expect(hello.child).not.toBeNull();
    expect(transport.pid).toBe(spawnedChild(host));
    transport.endInput();
    expect(await transport.exited).toEqual({ code: 0, signal: null });
  });

  describe('a stop-all of one held for adoption', () => {
    it('ends the host and its child through the host’s own shutdown: stopped', { timeout: LONG }, async () => {
      const deps = profile();
      const { host, entry } = await orphaned(deps, ['/bin/sleep', '600']);
      expect(await stopHeldHost(entry, stopDeps(deps))).toBe('stopped');
      expect([isAlive(host.pid), isAlive(entry.child!.pid)]).toEqual([false, false]);
    });

    it('ends a spawn under way once forked: the host waits for its fork, then ends the child', { timeout: LONG }, async () => {
      const deps = profile();
      const { host, entry } = await orphaned(deps, ['/bin/sleep', '600'], { spawnDelayMs: 800, spawned: false });
      expect(entry).toMatchObject({ state: 'committed', child: null });
      expect(await stopHeldHost(entry, stopDeps(deps))).toBe('stopped');
      expect(isAlive(host.pid)).toBe(false);
      await expectGone(spawnedChild(host), 1_000);
    });

    it('kills a child that outlives the grace: forced', { timeout: LONG }, async () => {
      const deps = profile();
      const { host, entry } = await orphaned(deps, ['/bin/sh', '-c', 'trap "" TERM; while :; do sleep 0.1; done']);
      expect(await stopHeldHost(entry, stopDeps(deps, 1_000))).toBe('forced');
      await expectGone(entry.child!.pid, 2_000);
      await expectGone(host.pid);
    });

    it('a host and child already gone: nothing to stop', { timeout: LONG }, async () => {
      const deps = profile();
      const { host, entry } = await orphaned(deps, ['/bin/sleep', '600']);
      process.kill(-entry.child!.pid, 'SIGKILL');
      process.kill(host.pid, 'SIGKILL');
      await expectGone(host.pid);
      await expectGone(entry.child!.pid);
      expect(await stopHeldHost(entry, stopDeps(deps))).toBe('gone');
    });
  });
});
