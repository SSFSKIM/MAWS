// The pty host's socket mode (P5 O2 M4; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md): its lock, token and listen
// over real Unix sockets and the real pty table (real node-pty, over a scratch shell home), the capability-gated pty
// frames, `exit now` ending a live pty through its ladder, a second candidate's exit 3, and a wrong token closed with
// nothing written.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostRegister } from '@shared/host/runtime';
import { START_EXIT_HELD, type SocketHost } from '@shared/host/socket-host';
import { SocketPort } from '@shared/host/socket-port';
import { PTY_FRAMES_CAPABILITY, PTY_MARK, SOCKET_PROTOCOL, splitLines } from '@shared/host/socket-protocol';
import { WIRE_MINOR } from '@shared/ipc/wire';
import { writeScratchShellHome } from '../../test/support/shell-home';
import { buildIdOf, isAlive, readLock } from '../engine-host/supervisor-files';
import { startPtyHost } from './detached';
import { terminalEnvironment } from './env';
import { PTY_HOST_FILES, ptyHostSocketPath } from './files';
import { createPtyTable, type PtyTable } from './table';

vi.setConfig({ testTimeout: 20_000 }); // real shells, as table.test.ts waits on them
const until = (check: () => boolean, timeout = 15_000) => vi.waitFor(() => expect(check()).toBe(true), { timeout, interval: 10 });
const SHELL_HOME = writeScratchShellHome(mkdtempSync(join(tmpdir(), 'maws-ptyd-home-')));
const ENVIRONMENT = terminalEnvironment({ ...process.env, HOME: SHELL_HOME.dir, ...SHELL_HOME.env }, { appVersion: '9.9.9' });
afterAll(() => rmSync(SHELL_HOME.dir, { recursive: true, force: true }));

let root: string;
let dir: string;
let modulePath: string;
const hosts: SocketHost[] = [];
const sockets: Socket[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-ptyd-'));
  dir = join(root, 'pty-host');
  modulePath = join(root, 'pty-host.js');
  writeFileSync(modulePath, '// the pty host bundle');
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const host of hosts.splice(0)) await host.stop('exit');
  rmSync(root, { recursive: true, force: true });
});

// One pty host in this process, its table the real one.
async function start() {
  const lines: string[] = [];
  const exit = vi.fn<(code: number) => void>();
  let table: PtyTable | null = null;
  const register: HostRegister = (on, emit) => {
    const ptys = createPtyTable({ emit, environment: Promise.resolve(ENVIRONMENT) });
    table = ptys;
    on('pty.spawn', (input) => ptys.spawn(input));
    on('pty.list', async () => ptys.list());
  };
  const host = await startPtyHost('test', register, { dir, modulePath, log: (line) => void lines.push(line), table: () => table! }, { exit });
  if (host) hosts.push(host);
  return { host, lines, exit, table: () => table! };
}

// A client's connection: the raw bytes after the hello, the welcome, and then a SocketPort reading the envelope.
async function connect(options: { capabilities?: string[]; token?: string } = {}) {
  const socket = createConnection(ptyHostSocketPath(dir));
  sockets.push(socket);
  await new Promise((resolve) => socket.once('connect', resolve));
  const raw: Buffer[] = [];
  socket.on('data', (chunk: Buffer) => void raw.push(chunk));
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  const token = options.token ?? readFileSync(join(dir, PTY_HOST_FILES.token), 'utf8');
  const answered = new Promise<{ welcome: unknown; leftover: Buffer } | null>((resolve) => {
    let welcome: unknown = null;
    const splitter = splitLines((line) => ((welcome = JSON.parse(line)), 'stop'), () => {});
    socket.on('data', function onData(chunk: Buffer) {
      splitter.push(chunk);
      if (welcome === null) return;
      socket.off('data', onData);
      resolve({ welcome, leftover: splitter.rest() });
    });
    void closed.then(() => resolve(null));
  });
  socket.write(`${JSON.stringify({ t: 'hello', protocol: SOCKET_PROTOCOL, token, minor: WIRE_MINOR, build: buildIdOf(modulePath), capabilities: options.capabilities ?? [PTY_FRAMES_CAPABILITY], appPid: 4321 })}\n`);
  const answer = await answered;
  if (!answer) return { socket, raw, closed, welcome: null, port: null, messages: [] as Record<string, unknown>[] };
  const port = new SocketPort(socket, answer.leftover, { log: () => {} });
  const messages: Record<string, unknown>[] = [];
  port.on('message', ({ data }) => void messages.push(data as Record<string, unknown>));
  port.start();
  let ids = 0;
  const request = async (name: string, input: unknown) => {
    const id = `r${++ids}`;
    port.postMessage({ t: 'req', id, name, input });
    await until(() => messages.some((m) => m.t === 'res' && m.id === id));
    return messages.find((m) => m.t === 'res' && m.id === id) as { ok: boolean; value?: unknown };
  };
  const output = (ptyId: string) => Buffer.concat(messages.filter((m) => m.t === 'evt' && m.name === 'pty.data' && (m.payload as { ptyId: string }).ptyId === ptyId).map((m) => (m.payload as { data: Uint8Array }).data)).toString('utf8');
  return { socket, raw, closed, welcome: answer.welcome, port, messages, request, output };
}

describe('the pty host in socket mode', () => {
  it('takes the lock, writes the token, listens privately, and spawns a pty through the socket, its output in pty frames', async () => {
    const pty = await start();
    expect(pty.host).not.toBeNull();
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(readdirSync(dir).sort()).toEqual(['host.lock', 'host.sock', 'host.token']);
    expect(readLock(dir)).toMatchObject({ pid: process.pid, protocol: SOCKET_PROTOCOL, buildId: buildIdOf(modulePath), socketPath: join(dir, 'host.sock') });
    expect(statSync(join(dir, 'host.token')).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, 'host.sock')).mode & 0o777).toBe(0o600);

    const client = await connect();
    expect(client.welcome).toMatchObject({ t: 'welcome', protocol: SOCKET_PROTOCOL, minor: WIRE_MINOR, capabilities: [PTY_FRAMES_CAPABILITY], pid: process.pid, liveSessions: 0, rows: 0 }); // P5 O3-D: its own list
    client.port!.postMessage({ t: 'ready' });
    const spawned = await client.request!('pty.spawn', { appSessionId: 'app-1', label: 't1', cwd: '/tmp', cols: 80, rows: 24, shell: '/bin/sh', args: ['-c', 'printf "through the socket\\n"; sleep 30'] });
    expect(spawned.ok).toBe(true);
    const { ptyId } = spawned.value as { ptyId: string };
    await until(() => client.output!(ptyId).includes('through the socket'));
    expect(Buffer.concat(client.raw).includes(PTY_MARK)).toBe(true); // pty.data crossed as frames
    const listed = await client.request!('pty.list', undefined);
    expect((listed.value as { ptys: { ptyId: string; alive: boolean }[] }).ptys).toEqual([expect.objectContaining({ ptyId, alive: true })]);
  });

  it('writes pty.data as JSON lines to a client that did not list the capability', async () => {
    await start();
    const client = await connect({ capabilities: [] });
    client.port!.postMessage({ t: 'ready' });
    const spawned = await client.request!('pty.spawn', { appSessionId: 'app-1', label: 't1', cwd: '/tmp', cols: 80, rows: 24, shell: '/bin/sh', args: ['-c', 'printf "as lines\\n"; sleep 30'] });
    const { ptyId } = spawned.value as { ptyId: string };
    await until(() => client.output!(ptyId).includes('as lines'));
    expect(Buffer.concat(client.raw).includes(PTY_MARK)).toBe(false);
  });

  it('exit now ends a live pty through its ladder, then removes its socket and lock and exits 0', async () => {
    const pty = await start();
    const client = await connect();
    client.port!.postMessage({ t: 'ready' });
    const spawned = await client.request!('pty.spawn', { appSessionId: 'app-1', label: 't1', cwd: '/tmp', cols: 80, rows: 24, shell: '/bin/sh', args: ['-c', 'sleep 30'] });
    const { ptyId, pid } = spawned.value as { ptyId: string; pid: number };
    expect(isAlive(pid)).toBe(true);
    const welcomed = await connect(); // a live pty counts in a welcome (this one replaces the first client)
    expect(welcomed.welcome).toMatchObject({ liveSessions: 1, rows: 1 });
    welcomed.port!.postMessage({ t: 'ready' });
    welcomed.port!.postMessage({ t: 'exit', when: 'now' });
    await until(() => pty.exit.mock.calls.length === 1);
    expect(pty.exit).toHaveBeenCalledWith(0);
    expect(isAlive(pid)).toBe(false);
    expect(welcomed.messages).toContainEqual({ t: 'evt', name: 'pty.exit', payload: { ptyId, exitCode: 0, signal: 1 } }); // SIGHUP, the ladder's first rung
    await welcomed.closed;
    expect(existsSync(join(dir, 'host.lock'))).toBe(false);
    expect(existsSync(join(dir, 'host.sock'))).toBe(false);
    expect(pty.lines.some((line) => line.includes('exiting (exit)'))).toBe(true);
  });

  it('ignores exit when idle: its client decides when it is idle', async () => {
    const pty = await start();
    const client = await connect();
    client.port!.postMessage({ t: 'exit', when: 'idle' });
    await until(() => pty.lines.some((line) => line.includes('exit idle asked by the client')));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(pty.exit).not.toHaveBeenCalled();
    expect(pty.host!.stopping()).toBe(false);
  });

  it('a second candidate exits 3 while the first holds the lock, touching none of its files', async () => {
    await start();
    const lock = readFileSync(join(dir, 'host.lock'), 'utf8');
    const token = readFileSync(join(dir, 'host.token'), 'utf8');
    const second = await start();
    expect(second.host).toBeNull();
    expect(second.exit).toHaveBeenCalledExactlyOnceWith(START_EXIT_HELD);
    expect(second.lines.some((line) => line.includes('another pty host'))).toBe(true);
    expect(readFileSync(join(dir, 'host.lock'), 'utf8')).toBe(lock);
    expect(readFileSync(join(dir, 'host.token'), 'utf8')).toBe(token);
    expect((await connect()).welcome).toMatchObject({ t: 'welcome' }); // the first still serves
  });

  it('closes a hello with a wrong token, writing nothing', async () => {
    await start();
    const stranger = await connect({ token: 'not the token' });
    await stranger.closed;
    expect(stranger.welcome).toBeNull();
    expect(Buffer.concat(stranger.raw)).toHaveLength(0);
  });

  it('refuses a directory more open than 0700, never correcting it (acceptance 9)', async () => {
    mkdirSync(dir, { mode: 0o700 });
    chmodSync(dir, 0o755);
    await expect(start()).rejects.toThrow(`${dir} is mode 0755, more open than 0700`);
    expect(statSync(dir).mode & 0o777).toBe(0o755);
    expect(existsSync(join(dir, 'host.lock'))).toBe(false);
  });

  it('falls back to its own tmpdir directory for a path past sun_path, never the engine host’s', () => {
    const long = join(root, 'p'.repeat(100), 'mawsd', 'pty-host');
    expect(ptyHostSocketPath(long, '/tmp/x')).toMatch(/^\/tmp\/x\/maws-pty-host-[0-9a-f]{12}\/host\.sock$/);
    expect(ptyHostSocketPath(dir)).toBe(join(dir, 'host.sock'));
  });
});
