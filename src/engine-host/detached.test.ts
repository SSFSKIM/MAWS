import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostEmit } from '@shared/host/runtime';
import { SOCKET_PROTOCOL } from '@shared/host/socket-protocol';
import { wireFingerprint } from '@shared/ipc/wire-fingerprint';
import { connectLines, type LineClient } from '../../test/support/socket-lines';
import { START_EXIT_ABORTED, START_EXIT_HELD, startSupervisor, type DetachedOptions, type RunningSupervisor } from './detached';
import { readLive, writeLive } from './live-ledger';
import { buildIdOf, procStartOf, readLock } from './supervisor-files';

// procStartOf stays the real one unless a case makes one `ps` fail
vi.mock('./supervisor-files', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./supervisor-files')>();
  return { ...actual, procStartOf: vi.fn(actual.procStartOf) };
});

const until = (check: () => boolean, timeout = 3_000) => vi.waitFor(() => expect(check()).toBe(true), { timeout, interval: 5 });

let root: string;
let dir: string;
let modulePath: string;
const running: RunningSupervisor[] = [];
const clients: LineClient[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-det-'));
  dir = join(root, 'supervisor');
  modulePath = join(root, 'engine-host.js');
  writeFileSync(modulePath, '// the engine host bundle');
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.socket.destroy();
  for (const supervisor of running.splice(0)) await supervisor.stop('exit');
  rmSync(root, { recursive: true, force: true });
});

function harness(over: Partial<DetachedOptions> = {}) {
  const counts = { liveSessions: 0, rows: 0 };
  const lines: string[] = [];
  const exit = vi.fn<(code: number) => void>();
  const shutdown = vi.fn<(graceMs: number) => Promise<void>>(async () => {});
  let emit!: HostEmit;
  const options: DetachedOptions = {
    dir,
    modulePath,
    idleExitMs: 60_000,
    log: (line) => void lines.push(line),
    counts: () => ({ ...counts }),
    shutdown,
    ...over,
  };
  const start = async (aborted?: () => boolean) => {
    const supervisor = await startSupervisor(
      'test',
      (on, e) => {
        on('engine.ping', async () => ({ pid: process.pid, uptimeMs: 1, hostVersion: 'test' }));
        emit = e;
      },
      options,
      { exit, aborted },
    );
    if (supervisor) running.push(supervisor);
    return supervisor;
  };
  return { counts, lines, exit, shutdown, start, emit: () => emit('session.brokerItems', { appSessionId: 'app-1', items: [] } as never) };
}

async function connect(): Promise<LineClient> {
  const lock = readLock(dir)!;
  const client = await connectLines(lock.socketPath);
  clients.push(client);
  client.send({ t: 'hello', protocol: SOCKET_PROTOCOL, token: readFileSync(join(dir, 'host.token'), 'utf8'), buildId: buildIdOf(modulePath), wire: wireFingerprint(), appPid: 4321 });
  return client;
}

describe('the detached entry', () => {
  it('takes the lock, writes the token, listens, and serves a client end to end', async () => {
    mkdirSync(dir, { mode: 0o755 });
    chmodSync(dir, 0o755); // a directory left too open is corrected
    const host = harness();
    host.counts.liveSessions = 1;
    host.counts.rows = 2;
    const supervisor = await host.start();
    expect(supervisor).not.toBeNull();

    expect(statSync(dir).mode & 0o777).toBe(0o700);
    const lock = readLock(dir)!;
    expect(lock).toMatchObject({ pid: process.pid, procStart: procStartOf(process.pid), protocol: SOCKET_PROTOCOL, buildId: buildIdOf(modulePath), socketPath: join(dir, 'host.sock') });
    expect(readFileSync(join(dir, 'host.token'), 'utf8')).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(join(dir, 'host.token')).mode & 0o777).toBe(0o600);
    expect(statSync(lock.socketPath).mode & 0o777).toBe(0o600);

    const client = await connect();
    expect(await client.next()).toEqual({ t: 'welcome', protocol: SOCKET_PROTOCOL, buildId: lock.buildId, wire: wireFingerprint(), pid: process.pid, startedAt: lock.startedAt, liveSessions: 1, rows: 2 });
    client.send({ t: 'req', id: '1', name: 'engine.ping', input: undefined });
    expect(await client.next((line) => (line as { t: string }).t === 'res')).toMatchObject({ id: '1', ok: true, value: { pid: process.pid } });
    client.send({ t: 'ready' });
    await until(() => host.emit());
    expect(await client.next((line) => (line as { t: string }).t === 'evt')).toMatchObject({ name: 'session.brokerItems' });
    expect(host.lines.some((line) => line.includes('client connected: appPid 4321'))).toBe(true);
    expect(host.exit).not.toHaveBeenCalled();
  });

  it('exits 3 when a live supervisor holds the lock, touching none of its files', async () => {
    const first = harness();
    await first.start();
    const lockBefore = readFileSync(join(dir, 'host.lock'), 'utf8');
    const tokenBefore = readFileSync(join(dir, 'host.token'), 'utf8');
    const second = harness();
    expect(await second.start()).toBeNull();
    expect(second.exit).toHaveBeenCalledExactlyOnceWith(START_EXIT_HELD);
    expect(readFileSync(join(dir, 'host.lock'), 'utf8')).toBe(lockBefore);
    expect(readFileSync(join(dir, 'host.token'), 'utf8')).toBe(tokenBefore);
    const client = await connect();
    expect(await client.next()).toMatchObject({ t: 'welcome' }); // the first still serves
  });

  it('takes over from a SIGKILLed supervisor: a dead pid’s lock and its leftover socket file', async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'host.lock'), JSON.stringify({ pid: 999_999, procStart: 'gone', protocol: 1, buildId: 'old', socketPath: join(dir, 'host.sock'), startedAt: 'then' }));
    writeFileSync(join(dir, 'host.sock'), ''); // the kernel never removes a socket file
    const host = harness();
    expect(await host.start()).not.toBeNull();
    expect(readLock(dir)?.pid).toBe(process.pid);
    const client = await connect();
    expect(await client.next()).toMatchObject({ t: 'welcome' });
  });

  it('runs the exit order on exit now: server closed, sessions stopped, its ledger, socket and lock removed, client closed, exit 0', async () => {
    const host = harness();
    await host.start();
    const owner = { pid: process.pid, procStart: procStartOf(process.pid)! };
    writeLive(dir, owner, []);
    const client = await connect();
    await client.next();
    client.send({ t: 'exit', when: 'now' });
    await until(() => host.exit.mock.calls.length === 1);
    expect(host.exit).toHaveBeenCalledWith(0);
    expect(host.shutdown).toHaveBeenCalledExactlyOnceWith(3_000);
    await client.closed;
    expect(readLive(dir)).toBeNull();
    expect(existsSync(join(dir, 'host.lock'))).toBe(false);
    expect(existsSync(join(dir, 'host.sock'))).toBe(false);
    await expect(connectLines(join(dir, 'host.sock'))).rejects.toThrow();
    expect(host.lines.some((line) => line.includes('exiting (exit)'))).toBe(true);
  });

  // Node unlinks a listening Unix socket's path itself when the server closes (libuv's pipe close), so the socket file
  // goes at step (1) whoever's lock it is; the ownership check guards the lock and the ledger.
  it('the exit order leaves a successor’s lock and ledger alone', async () => {
    const host = harness();
    const supervisor = (await host.start())!;
    const successor = { pid: 999_998, procStart: 'successor' };
    writeFileSync(join(dir, 'host.lock'), JSON.stringify({ ...successor, protocol: 1, buildId: 'b', socketPath: join(dir, 'host.sock'), startedAt: 'now' }));
    writeLive(dir, successor, []);
    await supervisor.stop('exit');
    expect(host.exit).toHaveBeenCalledWith(0);
    expect(readLock(dir)?.pid).toBe(999_998);
    expect(readLive(dir)?.owner).toEqual(successor);
  });

  it('a clean exit removes its lock even when the one `ps` at its start failed (the owner is read back from the lock)', async () => {
    vi.mocked(procStartOf).mockReturnValueOnce(null); // the lock is written with procStart ''
    const host = harness();
    const supervisor = (await host.start())!;
    expect(readLock(dir)?.procStart).toBe('');
    await supervisor.stop('exit');
    expect(host.exit).toHaveBeenCalledWith(0);
    expect(existsSync(join(dir, 'host.lock'))).toBe(false);
  });

  it('a start aborted by a signal after the lock removes the lock and its temporary and exits non-zero', async () => {
    const host = harness();
    expect(await host.start(() => true)).toBeNull();
    expect(host.exit).toHaveBeenCalledExactlyOnceWith(START_EXIT_ABORTED);
    expect(readdirSync(dir)).toEqual([]);
    expect(host.lines.some((line) => line.includes('start aborted'))).toBe(true);
  });

  it('a start aborted by a signal during listen closes the socket and removes the lock', async () => {
    const host = harness();
    let checks = 0;
    expect(await host.start(() => checks++ > 0)).toBeNull(); // not after the lock, then after listen
    expect(host.exit).toHaveBeenCalledExactlyOnceWith(START_EXIT_ABORTED);
    expect(existsSync(join(dir, 'host.lock'))).toBe(false);
    await until(() => !existsSync(join(dir, 'host.sock')));
    expect(host.shutdown).not.toHaveBeenCalled(); // nothing was served, so nothing to stop
  });

  it('a fatal exit stops the sessions but keeps the lock and the ledger for the successor’s staleness check', async () => {
    const host = harness();
    const supervisor = (await host.start())!;
    writeLive(dir, { pid: process.pid, procStart: procStartOf(process.pid)! }, []);
    await supervisor.stop('fatal', 1);
    expect(host.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(host.shutdown).toHaveBeenCalledOnce();
    expect(readLock(dir)?.pid).toBe(process.pid);
    expect(readLive(dir)).not.toBeNull();
    await supervisor.stop('exit'); // a second stop is the same exit, not another
    expect(host.exit).toHaveBeenCalledOnce();
  });

  it('a socket that cannot be created is fatal: exit 1 with the reason logged', async () => {
    const host = harness();
    mkdirSync(join(dir, 'host.sock'), { recursive: true }); // a directory where the socket must go
    writeFileSync(join(dir, 'host.sock', 'keep'), '');
    expect(await host.start()).toBeNull();
    expect(host.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(host.lines.some((line) => line.includes('cannot listen'))).toBe(true);
  });

  describe('the idle exit', () => {
    it('exits after idleExitMs with no client and no live row', async () => {
      const host = harness({ idleExitMs: 50 });
      await host.start();
      await until(() => host.exit.mock.calls.length === 1);
      expect(host.exit).toHaveBeenCalledWith(0);
      expect(host.lines.some((line) => line.includes('exiting (idle)'))).toBe(true);
      expect(existsSync(join(dir, 'host.lock'))).toBe(false);
    });

    it('waits while a client is connected and starts the clock when it leaves', async () => {
      const host = harness({ idleExitMs: 80 });
      await host.start();
      const client = await connect();
      await client.next();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(host.exit).not.toHaveBeenCalled();
      client.socket.destroy();
      await until(() => host.exit.mock.calls.length === 1);
    });

    it('waits while a row is live', async () => {
      const host = harness({ idleExitMs: 40 });
      host.counts.liveSessions = 1;
      await host.start();
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(host.exit).not.toHaveBeenCalled();
      host.counts.liveSessions = 0;
      await until(() => host.exit.mock.calls.length === 1);
    });
  });

  it('leaves nothing but its own files in the directory', async () => {
    const host = harness();
    await host.start();
    expect(readdirSync(dir).sort()).toEqual(['host.lock', 'host.sock', 'host.token']);
  });
});
