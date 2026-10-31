// The committed session host binary, driven over its real socket with /bin/cat (and a few other stock tools) as the
// child (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M1's tests). Runs wherever a prebuild matches the
// platform: darwin-arm64 under `unit:darwin`, linux-x64 and linux-arm64 under the pool's unit job; skipped elsewhere.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hostsDirOf, sessionHostBinary, sessionHostPaths, type SessionHostPaths } from './files';
import { HostMessageSchema, HostStreamDecoder, RING_RECORD_OVERHEAD, SESSION_HOST_PROTOCOL, SESSION_HOST_VERSION, controlLine, stdinRecord, type ClientMessage, type HostItem } from './protocol';

const BINARY = sessionHostBinary(resolve(__dirname, '..', '..', '..', 'out', 'main', 'index.js'));
const HAVE_BINARY = existsSync(BINARY);
const MiB = 1024 * 1024;
const LONG = 30_000; // real processes; a loaded runner is slow

type Control = { t: string } & Record<string, unknown>;

class Client {
  private readonly decoder = new HostStreamDecoder();
  private readonly items: HostItem[] = [];
  private waiter: (() => void) | null = null;
  closed = false;
  bytesRead = 0;

  constructor(readonly socket: Socket) {
    socket.on('data', (chunk: Buffer) => {
      this.bytesRead += chunk.length;
      this.items.push(...this.decoder.push(chunk));
      this.waiter?.();
    });
    socket.on('close', () => {
      this.closed = true;
      this.waiter?.();
    });
    socket.on('error', () => {});
  }

  send(message: ClientMessage | Record<string, unknown>): void {
    this.socket.write(controlLine(message as ClientMessage));
  }

  stdin(offset: number, data: Buffer | string): void {
    this.socket.write(stdinRecord(offset, Buffer.isBuffer(data) ? data : Buffer.from(data)));
  }

  // The first item matching `pick`, in arrival order; `never` fails on a control line of those types before it.
  async next<T>(pick: (item: HostItem) => T | undefined, what: string, never: string[] = [], within = 10_000): Promise<T> {
    const deadline = Date.now() + within;
    for (;;) {
      for (let i = 0; i < this.items.length; i++) {
        const item = this.items[i]!;
        if (item.kind === 'control' && never.includes(item.message.t)) throw new Error(`got ${JSON.stringify(item.message)} while waiting for ${what}`);
        const picked = pick(item);
        if (picked !== undefined) {
          this.items.splice(i, 1); // what it passed over stays for a later wait
          return picked;
        }
      }
      if (this.closed) throw new Error(`the connection closed while waiting for ${what}`);
      if (Date.now() > deadline) throw new Error(`no ${what} within ${within} ms`);
      await new Promise<void>((done) => {
        const timer = setTimeout(done, Math.max(0, deadline - Date.now()));
        this.waiter = () => {
          clearTimeout(timer);
          done();
        };
      });
      this.waiter = null;
    }
  }

  expect(t: string, never: string[] = []): Promise<Control> {
    return this.next((item) => (item.kind === 'control' && item.message.t === t ? item.message : undefined), t, never);
  }

  record(): Promise<{ stream: 'out' | 'err'; seq: number; text: string }> {
    return this.next((item) => (item.kind === 'record' ? { stream: item.stream, seq: item.seq, text: item.data.toString('utf8') } : undefined), 'a record');
  }

  async closedWithin(ms: number): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (!this.closed && Date.now() < deadline) await sleep(20);
    return this.closed;
  }
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

interface Host {
  proc: ChildProcess;
  paths: SessionHostPaths;
  hostsDir: string;
  token: string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  connect(): Promise<Client>;
  auth(): Promise<{ client: Client; hello: Control }>;
  writer(fence?: number): Promise<Client>;
}

const scratch: string[] = [];
const hosts: Host[] = [];
const childPids: number[] = [];

afterEach(async () => {
  for (const host of hosts.splice(0)) {
    if (host.proc.exitCode === null && host.proc.signalCode === null) {
      host.proc.kill('SIGTERM');
      await Promise.race([host.exited, sleep(8_000)]);
      if (host.proc.exitCode === null && host.proc.signalCode === null) host.proc.kill('SIGKILL');
    }
  }
  for (const pid of childPids.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // gone
    }
  }
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(under: string = tmpdir()): string {
  const dir = mkdtempSync(join(under, 'msh-'));
  scratch.push(dir);
  return dir;
}

async function startHost(opts: { flags?: string[]; userData?: string; tmp?: string } = {}): Promise<Host> {
  const userData = opts.userData ?? tempDir();
  const hostsDir = hostsDirOf(join(userData, 'supervisor'));
  mkdirSync(hostsDir, { recursive: true, mode: 0o700 });
  const launchId = 'T' + randomBytes(4).toString('hex').toUpperCase().slice(0, 7);
  const paths = sessionHostPaths(hostsDir, launchId, { userData, tmpdir: opts.tmp ?? tmpdir() });
  const token = randomBytes(32).toString('hex');
  writeFileSync(paths.token, token, { mode: 0o600 });
  const proc = spawn(BINARY, [paths.socket, '--hosts', hostsDir, ...(opts.flags ?? [])], { detached: true, stdio: ['pipe', 'ignore', 'ignore'] });
  proc.stdin!.end(token);
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) => proc.on('exit', (code, signal) => done({ code, signal })));
  const host: Host = {
    proc,
    paths,
    hostsDir,
    token,
    exited,
    async connect() {
      const deadline = Date.now() + 5_000;
      for (;;) {
        try {
          const socket = await new Promise<Socket>((done, fail) => {
            const s = connect(paths.socket);
            s.once('connect', () => done(s));
            s.once('error', fail);
          });
          return new Client(socket);
        } catch (error) {
          if (Date.now() > deadline) throw error;
          await sleep(20);
        }
      }
    },
    async auth() {
      const client = await host.connect();
      client.send({ t: 'auth', token });
      return { client, hello: await client.expect('hello') };
    },
    async writer(fence = 1) {
      const { client } = await host.auth();
      client.send({ t: 'attach', role: 'writer', fence });
      await client.expect('attached');
      return client;
    },
  };
  hosts.push(host);
  return host;
}

async function launch(w: Client, argv: string[], extra: { cwd?: string; env?: Record<string, string>; read?: boolean } = {}): Promise<Control> {
  if (extra.read ?? true) {
    w.send({ t: 'read', fromSeq: 1 });
    await w.expect('caughtUp');
  }
  w.send({ t: 'launch', appSessionId: 'app-1', engineSessionId: 'eng-1', argv, cwd: extra.cwd ?? '/', env: extra.env ?? { PATH: '/usr/bin:/bin' } });
  w.send({ t: 'commit' });
  const spawned = await w.expect('spawned', ['spawnFailed', 'error']);
  childPids.push(spawned.pid as number);
  return spawned;
}

describe.skipIf(!HAVE_BINARY)('the session host binary', () => {
  it('prints its version and protocol', () => {
    expect(execFileSync(BINARY, ['--version'], { encoding: 'utf8' }).trim()).toBe(`maws-session-host ${SESSION_HOST_VERSION} protocol ${SESSION_HOST_PROTOCOL}`);
  });

  it('writes no byte before auth, nothing to a wrong token, and hello after the right one', { timeout: LONG }, async () => {
    const host = await startHost();
    const silent = await host.connect();
    await sleep(300);
    expect(silent.bytesRead).toBe(0); // nothing before auth
    const wrong = await host.connect();
    wrong.send({ t: 'auth', token: 'f'.repeat(64) });
    expect(await wrong.closedWithin(5_000)).toBe(true);
    expect(wrong.bytesRead).toBe(0);
    expect(await silent.closedWithin(5_000)).toBe(true); // the auth window closed it, still silent
    expect(silent.bytesRead).toBe(0);
    const { hello } = await host.auth();
    expect(HostMessageSchema.parse(hello)).toMatchObject({ t: 'hello', protocol: 1, pid: host.proc.pid, state: 'ready', child: null, fence: 0, writer: false, exit: null });
    const roster = JSON.parse(readFileSync(host.paths.roster, 'utf8')) as Record<string, unknown>;
    expect(roster).toMatchObject({ protocol: 1, pid: host.proc.pid, state: 'ready', socket: host.paths.socket, binary: BINARY, child: null, fence: 0 });
    expect(roster.procStart).toBe(hello.procStart);
  });

  it('keeps its files private: 0700 directory, 0600 socket, roster, token and log', { timeout: LONG }, async () => {
    const host = await startHost();
    await host.auth();
    expect(statSync(host.hostsDir).mode & 0o777).toBe(0o700);
    for (const path of [host.paths.socket, host.paths.roster, host.paths.token, host.paths.log]) expect(lstatSync(path).mode & 0o777, path).toBe(0o600);
  });

  it('spawns the launch with its argv, cwd and exactly its environment', { timeout: LONG }, async () => {
    const host = await startHost();
    const w = await host.writer();
    const cwd = realpathSync(tempDir()); // what pwd prints
    await launch(w, ['/usr/bin/env'], { cwd, env: { MAWS_TEST_A: 'one two', PATH: '/usr/bin:/bin' } });
    const lines = [(await w.record()).text, (await w.record()).text].sort();
    expect(lines).toEqual(['MAWS_TEST_A=one two', 'PATH=/usr/bin:/bin']);
    expect(await w.expect('exit')).toMatchObject({ code: 0, signal: null });

    const h2 = await startHost();
    const w2 = await h2.writer();
    await launch(w2, ['/bin/sh', '-c', 'pwd; echo "$0|$1"', 'zero', 'one'], { cwd });
    expect((await w2.record()).text).toBe(cwd);
    expect((await w2.record()).text).toBe('zero|one');
  });

  it('sequences stdout and stderr from 1 in one sequence', { timeout: LONG }, async () => {
    const host = await startHost();
    const w = await host.writer();
    await launch(w, ['/bin/sh', '-c', 'echo a; sleep 0.2; echo b >&2; sleep 0.2; echo c']);
    expect(await w.record()).toEqual({ stream: 'out', seq: 1, text: 'a' });
    expect(await w.record()).toEqual({ stream: 'err', seq: 2, text: 'b' });
    expect(await w.record()).toEqual({ stream: 'out', seq: 3, text: 'c' });
    expect(await w.expect('exit')).toMatchObject({ code: 0 });
  });

  it('applies stdin once by offset: duplicate on a resend, gap past the accepted offset', { timeout: LONG }, async () => {
    const host = await startHost();
    const w = await host.writer();
    await launch(w, ['/bin/cat']);
    w.stdin(0, 'one\n');
    expect(await w.expect('applied')).toMatchObject({ offset: 4 });
    w.stdin(0, 'one\n');
    expect(await w.expect('duplicate')).toMatchObject({ accepted: 4, applied: 4 });
    w.stdin(9, 'x\n');
    expect(await w.expect('gap')).toMatchObject({ accepted: 4 });
    w.stdin(4, 'two\n');
    expect(await w.expect('applied')).toMatchObject({ offset: 8 });
    expect(await w.record()).toEqual({ stream: 'out', seq: 1, text: 'one' });
    expect(await w.record()).toEqual({ stream: 'out', seq: 2, text: 'two' });
    const { hello } = await host.auth();
    expect(hello).toMatchObject({ stdinApplied: 8, stdinAccepted: 8, stdinQueued: 0, state: 'running', writer: true, fence: 1 });
  });

  it('takes a 48 MiB record into an empty queue, answers busy past the cap, and a blocked pipe never blocks the reader', { timeout: 60_000 }, async () => {
    const host = await startHost();
    const w = await host.writer();
    await launch(w, ['/bin/sleep', '60']); // never reads its stdin: the pipe blocks after its buffer
    w.stdin(0, Buffer.alloc(48 * MiB, 0x61));
    w.stdin(0, 'resend\n'); // answered while the first record sits in a blocked pipe
    expect(await w.expect('duplicate', ['busy', 'applied'])).toMatchObject({ accepted: 48 * MiB, applied: 0 });
    w.stdin(48 * MiB, Buffer.alloc(20 * MiB, 0x62));
    expect(await w.expect('busy', ['applied'])).toMatchObject({ queued: 48 * MiB });
    w.send({ t: 'hb' });
    const { hello } = await host.auth();
    expect(hello).toMatchObject({ stdinAccepted: 48 * MiB, stdinApplied: 0, stdinQueued: 48 * MiB });
  });

  it('a second writer at fence + 1 supersedes the first once its queued record is applied', { timeout: LONG }, async () => {
    const host = await startHost();
    const first = await host.writer(1);
    await launch(first, ['/bin/sh', '-c', 'sleep 1; exec cat'], { read: false });
    const record = Buffer.alloc(MiB, 0x63); // past the pipe's buffer: queued until cat reads it
    first.stdin(0, record);
    for (;;) {
      const { hello } = await host.auth(); // the record is queued, not yet applied
      if (hello.stdinAccepted === MiB) {
        expect(hello).toMatchObject({ stdinApplied: 0, stdinQueued: MiB });
        break;
      }
      await sleep(10);
    }
    const { client: second } = await host.auth();
    second.send({ t: 'attach', role: 'writer', fence: 1 });
    expect(await second.expect('refused')).toMatchObject({ reason: 'fence' });
    second.send({ t: 'attach', role: 'writer', fence: 2 });
    expect(await first.expect('applied', ['fenced'])).toMatchObject({ offset: MiB });
    expect(await first.expect('fenced')).toMatchObject({ fence: 2 });
    expect(await second.expect('attached')).toMatchObject({ fence: 2, stdinApplied: MiB, stdinAccepted: MiB });
    first.stdin(MiB, 'late\n');
    expect(await first.expect('fenced', ['applied'])).toMatchObject({ fence: 2 });
    second.stdin(MiB, 'next\n');
    expect(await second.expect('applied')).toMatchObject({ offset: MiB + 5 });
    expect(JSON.parse(readFileSync(host.paths.roster, 'utf8'))).toMatchObject({ fence: 2, state: 'running' });
  });

  it('answers stdinClosed with the partial bytes when the child closes stdin mid-record', { timeout: LONG }, async () => {
    const host = await startHost();
    const w = await host.writer();
    await launch(w, ['/usr/bin/head', '-c', '100000'], { read: false });
    const size = 4 * MiB;
    w.stdin(0, Buffer.alloc(size, 0x64));
    const closed = await w.expect('stdinClosed', ['applied']);
    expect(closed.applied).toBe(size);
    expect(closed.partial).toBeGreaterThan(0);
    expect(closed.partial).toBeLessThan(size);
    w.stdin(size, 'more\n');
    expect(await w.expect('stdinClosed', ['applied'])).toMatchObject({ applied: size + 5, partial: 0 });
  });

  it('signals the child on request and records its exit; release removes the files and ends the host', { timeout: LONG }, async () => {
    const host = await startHost();
    const w = await host.writer();
    const spawned = await launch(w, ['/bin/cat']);
    w.send({ t: 'signal', name: 'SIGTERM', group: false });
    const exit = await w.expect('exit');
    expect(exit).toMatchObject({ code: null, signal: 'SIGTERM' });
    // the linger: a client after the exit still reads hello and the exit
    const { hello } = await host.auth();
    expect(hello).toMatchObject({ state: 'exited', child: { pid: spawned.pid }, exit: { signal: 'SIGTERM' } });
    expect(JSON.parse(readFileSync(host.paths.roster, 'utf8'))).toMatchObject({ state: 'exited', exit: { signal: 'SIGTERM' } });
    w.send({ t: 'release' });
    expect(await host.exited).toEqual({ code: 0, signal: null });
    for (const path of [host.paths.socket, host.paths.token, host.paths.roster]) expect(existsSync(path), path).toBe(false);
    expect(existsSync(host.paths.log)).toBe(true);
  });

  it('signals the whole process group when asked', { timeout: LONG }, async () => {
    const host = await startHost();
    const w = await host.writer();
    await launch(w, ['/bin/sh', '-c', 'sleep 60 & echo $!; wait']);
    const grandchild = Number((await w.record()).text);
    childPids.push(grandchild);
    w.send({ t: 'signal', name: 'SIGTERM', group: true });
    await w.expect('exit');
    await sleep(200);
    expect(() => process.kill(grandchild, 0)).toThrow();
  });

  it('keeps the ring bounded under a flood of blank lines', { timeout: LONG }, async () => {
    const host = await startHost({ flags: ['--ring-cap-bytes', String(100 * RING_RECORD_OVERHEAD)] });
    const w = await host.writer();
    await launch(w, ['/bin/cat'], { read: false });
    w.stdin(0, '\n'.repeat(50_000));
    await w.expect('applied');
    let ring: { firstSeq: number; lastSeq: number; bytes: number };
    do {
      ring = (await host.auth()).hello.ring as typeof ring;
    } while (ring.lastSeq < 50_000 && (await sleep(20), true));
    expect(ring.lastSeq - ring.firstSeq + 1).toBe(100);
    expect(ring.bytes).toBe(0);
  });

  it('sends nothing after exit, even while a descendant holds the output pipe', { timeout: LONG }, async () => {
    const host = await startHost();
    const w = await host.writer();
    await launch(w, ['/bin/sh', '-c', '(sleep 1.6; echo late) & echo early']); // the subshell outlives sh and the 1 s drain
    expect((await w.record()).text).toBe('early');
    await w.expect('exit');
    await sleep(2_000);
    expect(await w.next((item) => (item.kind === 'record' ? item : undefined), 'a record', [], 1).catch(() => null)).toBeNull();
    const { hello } = await host.auth();
    expect(hello.ring).toMatchObject({ lastSeq: 1 });
  });

  it('ends the host when the linger after the exit ends', { timeout: LONG }, async () => {
    const host = await startHost({ flags: ['--linger-ms', '500'] });
    const w = await host.writer();
    await launch(w, ['/bin/cat']);
    w.send({ t: 'end' });
    expect(await w.expect('exit')).toMatchObject({ code: 0 });
    expect(await host.exited).toEqual({ code: 0, signal: null });
    expect(existsSync(host.paths.roster)).toBe(false);
  });

  it("takes cat down on the host's own SIGTERM, then exits", { timeout: LONG }, async () => {
    const host = await startHost();
    const w = await host.writer();
    const spawned = await launch(w, ['/bin/cat']);
    host.proc.kill('SIGTERM');
    expect(await host.exited).toEqual({ code: 0, signal: null });
    expect(() => process.kill(spawned.pid as number, 0)).toThrow();
    expect(existsSync(host.paths.roster)).toBe(false);
  });

  it('exits with no child once its writer has left', { timeout: LONG }, async () => {
    const host = await startHost({ flags: ['--no-child-ms', '300'] });
    const w = await host.writer();
    await sleep(600);
    expect(host.proc.exitCode).toBeNull(); // a writer holds it
    w.socket.destroy();
    expect(await host.exited).toEqual({ code: 0, signal: null });
    expect(existsSync(host.paths.socket)).toBe(false);
  });

  it('replays exactly from a sequence, and answers a gap below what the cap kept', { timeout: LONG }, async () => {
    const perRecord = 4 + RING_RECORD_OVERHEAD; // what each 4-byte line costs against the cap
    const host = await startHost({ flags: ['--ring-cap-bytes', String(6 * perRecord)] });
    const w = await host.writer(); // it reads nothing: the ring alone keeps the output
    await launch(w, ['/bin/cat'], { read: false });
    for (let i = 1; i <= 30; i++) w.stdin((i - 1) * 5, `l${String(i).padStart(3, '0')}\n`); // 4-byte records
    for (let i = 1; i <= 30; i++) await w.expect('applied');
    let hello: Control;
    for (;;) {
      ({ hello } = await host.auth());
      if ((hello.ring as { lastSeq: number }).lastSeq === 30) break;
      await sleep(20);
    }
    const ring = hello.ring as { firstSeq: number; lastSeq: number; bytes: number };
    expect(ring).toEqual({ firstSeq: 25, lastSeq: 30, bytes: 6 * 4 }); // six records fit, payload bytes reported

    const exact = await host.writer(2);
    exact.send({ t: 'read', fromSeq: 28 });
    expect((await exact.record()).seq).toBe(28);
    expect((await exact.record()).seq).toBe(29);
    expect((await exact.record()).seq).toBe(30);
    expect(await exact.expect('caughtUp')).toMatchObject({ lastSeq: 30, gap: null });
    exact.send({ t: 'ack', seq: 29 });
    exact.send({ t: 'signal', name: 'SIGINT', group: false }); // any answer after the ack: the ack is applied
    await exact.expect('exit');
    const behind = await host.auth();
    expect(behind.hello.ring).toMatchObject({ firstSeq: 30, lastSeq: 30 });

    behind.client.send({ t: 'attach', role: 'observer' });
    await behind.client.expect('attached');
    behind.client.send({ t: 'read', fromSeq: 1 });
    expect((await behind.client.record()).seq).toBe(30);
    expect(await behind.client.expect('caughtUp')).toMatchObject({ lastSeq: 30, gap: 30 });
  });

  it('closes a connection that falls behind the ring', { timeout: LONG }, async () => {
    const host = await startHost({ flags: ['--ring-cap-bytes', '4096'] });
    const w = await host.writer();
    await launch(w, ['/bin/cat'], { read: false });
    const { client: lagging } = await host.auth();
    lagging.send({ t: 'attach', role: 'observer' });
    await lagging.expect('attached');
    lagging.send({ t: 'read', fromSeq: 1 });
    await lagging.expect('caughtUp');
    lagging.socket.pause(); // it reads nothing more
    const line = `${'x'.repeat(999)}\n`;
    w.stdin(0, line.repeat(4096)); // 4 MiB of output past a 4 KiB ring and the socket's buffers
    await w.expect('applied');
    lagging.socket.resume();
    expect(await lagging.closedWithin(10_000)).toBe(true);
  });

  it('listens again when its socket file is removed', { timeout: LONG }, async () => {
    const host = await startHost({ flags: ['--socket-check-ms', '100'] });
    await host.auth();
    unlinkSync(host.paths.socket);
    await sleep(500);
    expect(lstatSync(host.paths.socket).isSocket()).toBe(true);
    const { hello } = await host.auth();
    expect(hello.pid).toBe(host.proc.pid);
  });

  it("listens under the tmpdir fallback when the hosts directory's path is too long", { timeout: LONG }, async () => {
    const userData = join(tempDir(), 'p'.repeat(100));
    mkdirSync(userData);
    const tmp = tempDir('/tmp'); // short, so the fallback fits sun_path
    const host = await startHost({ userData, tmp });
    expect(host.paths.socket.startsWith(tmp)).toBe(true);
    const { hello } = await host.auth();
    expect(hello.state).toBe('ready');
    expect(statSync(join(host.paths.socket, '..')).mode & 0o777).toBe(0o700);
    expect(JSON.parse(readFileSync(host.paths.roster, 'utf8'))).toMatchObject({ socket: host.paths.socket });
  });

  // macOS: the darwin prebuild links the system library alone (Interfaces §H), what `otool` reads.
  it.skipIf(process.platform !== 'darwin')('links libSystem and libresolv alone on macOS', () => {
    const libraries = execFileSync('/usr/bin/otool', ['-L', BINARY], { encoding: 'utf8' })
      .split('\n')
      .slice(1)
      .map((line) => line.trim().split(' ')[0])
      .filter(Boolean);
    expect(libraries.sort()).toEqual(['/usr/lib/libSystem.B.dylib', '/usr/lib/libresolv.9.dylib']);
  });
});
