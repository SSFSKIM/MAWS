// The host transport (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M2 and Interfaces §C; D6, D8, D30, D43 to
// D45, D51): an EngineTransport over a session host's socket instead of a child's pipes, so EngineSession, its
// OutboundWriter, ControlClient, the ladder and the normaliser run unchanged over a process the engine host does not hold.
//
// Two steps (D51). `startSessionHost`, run by the launcher before a row is reserved: the token file, the binary spawned
// detached with the token on its stdin (never argv or an environment), a connect polled for up to HOST_START_MS, the
// host's `hello`, and the attach as writer at fence 1; a host that does not come up fails the launch (`host_unavailable`,
// D8), never a direct spawn. `hostedTransport` (the session's `spawn`): `read` from 1, then `launch` and `commit`, so
// the engine's first lines wait in the ring for a connection that already reads.
//
// Output: each `out` and `err` record is one raw line (D43), cleaned by the direct transport's rule and handed on with
// its host sequence (`hseq`); a blank line makes no row, so it is marked journaled here (D44). The session reports each
// row as journaled (`journaled`), and the contiguous frontier is acknowledged coalesced (checkpoint.ts).
// Input (D30): one record in flight at a time, at the offset the host has accepted; a write resolves at its `applied`
// (the bytes reached the pipe), rejects with TransportClosed on `gap`, `fenced` or `stdinClosed`, and retries a `busy`.
// An abort is honoured only before the record is handed to the socket; after, it settles on the host's answer.
// The writer's connection closed while the host lives is a reconnect at the next fence, read from the last delivered
// sequence + 1 (D45); a dead host, or a reconnect that fails in time, is `host_lost`: the session ends as a crash and
// the child is signalled here (SIGTERM, the sweep's grace, SIGKILL to its group). After the child's exit the host is
// released once every record it sent is journaled, so its ring outlives nothing it still owes.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { makePrivateDirectory } from '@shared/host/private-listen';
import type { StdinFrame } from '@shared/wire/frames';
import type { LaunchPlan } from '../launch';
import { signalOrphan, SWEEP_GRACE_MS } from '../live-ledger';
import { isAlive, procStartOf } from '../supervisor-files';
import { AsyncQueue, cleanLine, parseStdoutLine, TransportClosed, type EngineTransport, type StderrItem, type TransportItem } from '../transport';
import { Frontier } from './checkpoint';
import { HostConnection, type HostEvent } from './client';
import { sessionHostPaths, type SessionHostPaths } from './files';
import { stdinRecord, type Hello, type HostMessage } from './protocol';

export const HOST_START_MS = 5_000; // a session host's time to answer `hello` after its spawn, and a reconnect's
const BUSY_RETRY_MS = 100;

export class HostStartFailed extends Error {
  constructor(message: string, readonly logPath: string) {
    super(message);
    this.name = 'HostStartFailed';
  }
}

export interface SessionHostDeps {
  hostsDir: string;
  binary: string;
  userData: string;
  tmpdir: string;
  log(line: string): void;
  startMs?: number; // HOST_START_MS
  // what the transport signals a lost host's child with (the orphan sweep's own in production)
  child?: { isAlive(pid: number): boolean; procStartOf(pid: number): string | null; signal(pid: number, signal: 'SIGTERM' | 'SIGKILL'): void; graceMs?: number };
  onConnection?(connection: HostConnection): void; // tests: each writer connection as it is made
}

export interface StartedHost {
  readonly holderId: string;
  readonly pid: number;
  readonly binary: string; // what was spawned (the spawn row's `holder.binary`)
  readonly paths: SessionHostPaths;
  readonly hello: Hello;
  // The launch's transport: `launch` with the plan's argv, cwd and environment, then `commit`. Once.
  transport(plan: LaunchPlan, opts: { appSessionId: string; maxLineChars: number }): EngineTransport;
  // A host that will launch nothing (the launch was refused or stopped first): released, so it removes its files.
  abandon(): void;
}

// The session host for `launchId`, up and attached as its writer.
export async function startSessionHost(launchId: string, deps: SessionHostDeps): Promise<StartedHost> {
  const paths = sessionHostPaths(deps.hostsDir, launchId, { userData: deps.userData, tmpdir: deps.tmpdir });
  const fail = (why: string): HostStartFailed => new HostStartFailed(`the session host for launch ${launchId} did not start: ${why}; its log is ${paths.log}`, paths.log);
  const token = randomBytes(32).toString('hex');
  let hostGone: string | null = null;
  let child;
  try {
    makePrivateDirectory(deps.hostsDir);
    writeFileSync(paths.token, token, { mode: 0o600, flag: 'wx' });
    const logFd = openSync(paths.log, 'a', 0o600);
    try {
      child = spawn(deps.binary, [paths.socket, '--hosts', deps.hostsDir], { detached: true, stdio: ['pipe', logFd, logFd] });
    } finally {
      closeSync(logFd);
    }
  } catch (error) {
    rmSync(paths.token, { force: true });
    throw fail((error as Error).message);
  }
  child.on('error', (error) => (hostGone ??= `the binary could not run (${error.message})`));
  child.on('exit', (code, signal) => (hostGone ??= `it exited (${signal ?? `code ${code}`})`));
  child.stdin!.on('error', () => {}); // a host that exits before reading its token: the exit says so
  child.stdin!.end(token);
  child.unref();
  const deadline = Date.now() + (deps.startMs ?? HOST_START_MS);
  let opened: { connection: HostConnection; hello: Hello };
  try {
    opened = await HostConnection.open(paths.socket, token, { deadline, gone: () => hostGone, log: deps.log });
    deps.onConnection?.(opened.connection);
    opened.connection.send({ t: 'attach', role: 'writer', fence: 1 });
    await opened.connection.expect('attached', deadline);
  } catch (error) {
    if (hostGone === null) child.kill('SIGTERM');
    rmSync(paths.token, { force: true });
    throw fail((error as Error).message);
  }
  const { connection, hello } = opened;
  let used = false;
  return {
    holderId: hello.holderId,
    pid: hello.pid,
    binary: deps.binary,
    paths,
    hello,
    transport(plan, opts) {
      if (used) throw new Error('a session host launches once');
      used = true;
      return new HostedTransport(connection, { plan, appSessionId: opts.appSessionId, token, paths, holderId: hello.holderId, hostPid: hello.pid, hostProcStart: hello.procStart, hostGone: () => hostGone, deps, maxLineChars: opts.maxLineChars }).transport;
    },
    abandon() {
      if (used) return;
      used = true;
      connection.send({ t: 'release' });
      connection.end();
    },
  };
}

interface InFlight {
  offset: number;
  end: number;
  data: Buffer;
  resolve(): void;
  reject(error: Error): void;
  retry: ReturnType<typeof setTimeout> | null;
}

type Exit = { code: number | null; signal: NodeJS.Signals | null };

class HostedTransport {
  readonly transport: EngineTransport;
  private connection: HostConnection | null;
  private fence = 1;
  private readonly frames = new AsyncQueue<TransportItem>();
  private readonly stderr = new AsyncQueue<StderrItem>();
  private readonly frontier: Frontier;
  private lastDelivered = 0; // the highest host sequence handed on (or marked journaled)
  private child: { pid: number; procStart: string } | null = null;
  private spawnOutcome: Promise<void>;
  private settleSpawn!: (error: Error | null) => void;
  private chain: Promise<void> = Promise.resolve();
  private inFlight: InFlight | null = null;
  private nextOffset = 0;
  private ended = false;
  private exitRecorded = false; // the host's `exit`: release once every record is journaled
  private pendingExit: Exit | null = null; // a reconnect's hello carried the exit
  private released = false;
  private endSent = false;
  private reconnecting = false;
  private resolveExited!: (exit: Exit) => void;

  constructor(
    connection: HostConnection,
    private readonly o: { plan: LaunchPlan; appSessionId: string; token: string; paths: SessionHostPaths; holderId: string; hostPid: number; hostProcStart: string; hostGone: () => string | null; deps: SessionHostDeps; maxLineChars: number },
  ) {
    this.connection = connection;
    this.frontier = new Frontier({ ack: (seq) => this.connection?.send({ t: 'ack', seq }) });
    this.spawnOutcome = new Promise<void>((resolve, reject) => {
      this.settleSpawn = (error) => (error ? reject(error) : resolve());
    });
    this.spawnOutcome.catch(() => {});
    const exited = new Promise<Exit>((resolve) => (this.resolveExited = resolve));
    const pid = () => this.child?.pid ?? null;
    const fence = () => this.fence;
    this.transport = {
      get pid() {
        return pid();
      },
      frames: this.frames,
      stderr: this.stderr,
      write: (frame, signal) => this.write(frame, signal),
      endInput: () => this.endInput(),
      kill: (name) => this.kill(name),
      exited,
      get holder() {
        return { pid: o.hostPid, holderId: o.holderId, fence: fence() };
      },
      journaled: (seq) => this.journaled(seq),
    };
    this.attachListeners(connection);
    const { plan } = o;
    connection.send({ t: 'read', fromSeq: 1 });
    connection.send({ t: 'launch', appSessionId: o.appSessionId, engineSessionId: plan.sessionId, argv: [plan.bin, ...plan.args], cwd: plan.cwd, env: plan.env });
    connection.send({ t: 'commit' });
  }

  private attachListeners(connection: HostConnection): void {
    connection.listen((event) => this.onEvent(event));
    connection.onClose((why) => {
      if (this.connection === connection) void this.lost(why);
    });
  }

  // ---- the host's stream -------------------------------------------------------------------------------------------

  private onEvent(event: HostEvent): void {
    if (event.kind === 'record') {
      if (event.seq <= this.lastDelivered) return; // a reconnect's replay of what was already handed on
      this.lastDelivered = event.seq;
      const line = cleanLine(event.data.toString('utf8'));
      if (line === null) this.journaled(event.seq); // D44: no row, and the frontier passes it
      else if (event.stream === 'out') this.frames.push({ ...parseStdoutLine(line), hseq: event.seq });
      else this.stderr.push({ text: line, hseq: event.seq });
      return;
    }
    this.onControl(event.message);
  }

  private onControl(message: HostMessage): void {
    switch (message.t) {
      case 'spawned':
        this.child = { pid: message.pid, procStart: message.procStart };
        this.settleSpawn(null);
        return;
      case 'spawnFailed':
        this.frames.push({ frame: null, raw: '', error: { kind: 'spawn_error', message: message.message, length: 0, typeGuess: null } });
        this.settleSpawn(new TransportClosed(`the engine did not start: ${message.message}`));
        this.finish({ code: null, signal: null });
        this.exitRecorded = true;
        this.maybeRelease();
        return;
      case 'applied':
        this.answered((w) => {
          if (message.offset < w.end) return false;
          this.nextOffset = w.end;
          return true;
        }, null);
        return;
      case 'duplicate':
        this.answered((w) => message.applied >= w.end, null);
        return;
      case 'busy': {
        const w = this.inFlight;
        if (w && w.retry === null) w.retry = setTimeout(() => this.resend(w), BUSY_RETRY_MS);
        return;
      }
      case 'gap':
        this.answered(() => true, new TransportClosed(`the session host expected input at offset ${message.accepted}`));
        return;
      case 'fenced':
        this.answered(() => true, new TransportClosed(`another writer holds the session host (fence ${message.fence})`));
        return;
      case 'stdinClosed': {
        const w = this.inFlight;
        if (w) this.nextOffset = w.end;
        this.answered(() => true, new TransportClosed('the engine closed its input'));
        if (message.partial > 0) this.frames.push({ frame: null, raw: '', error: { kind: 'stalled_write', message: 'The engine closed its input under a write; ending the engine because its input is incomplete.', length: 0, typeGuess: null } });
        return;
      }
      case 'caughtUp':
        if (message.gap !== null && message.gap > this.lastDelivered + 1) {
          const lostFrom = this.lastDelivered + 1;
          this.lastDelivered = message.gap - 1;
          this.frames.push({ frame: null, raw: '', error: { kind: 'host_gap', message: `output ${lostFrom} to ${message.gap - 1} left the session host's ring before it was read`, length: 0, typeGuess: null, gap: { holderId: this.o.holderId, fence: this.fence, frontier: this.frontier.value, firstSeq: message.gap, lostFrom } } });
        }
        if (this.pendingExit) {
          const exit = this.pendingExit;
          this.pendingExit = null;
          this.recordExit(exit);
        }
        return;
      case 'exit':
        this.recordExit({ code: message.code, signal: message.signal as NodeJS.Signals | null });
        return;
      case 'problem':
        if (message.kind === 'line_budget' && message.stream !== 'err') {
          this.frames.push({ frame: null, raw: '', error: { kind: 'line_budget', message: `line budget exceeded: a stdout line of ${message.length ?? '?'} bytes was dropped by the session host (budget ${this.o.maxLineChars})`, length: message.length ?? 0, typeGuess: null } });
        } else if (message.kind === 'roster') this.o.deps.log(`session host ${this.o.holderId}: its roster entry could not be written (${message.message ?? 'no detail'}); it retries at its next state change`); // D47: a warning
        else this.o.deps.log(`session host ${this.o.holderId}: ${message.kind} problem${message.stream ? ` on ${message.stream}` : ''}`);
        return;
      case 'error':
        this.o.deps.log(`session host ${this.o.holderId}: ${message.message}`);
        return;
      default:
        return; // hello, attached, refused: a handshake's
    }
  }

  private recordExit(exit: Exit): void {
    this.exitRecorded = true;
    this.finish(exit);
    this.maybeRelease();
  }

  private finish(exit: Exit): void {
    if (this.ended) return;
    this.ended = true;
    this.frontier.flush();
    this.frames.end();
    this.stderr.end();
    this.settleSpawn(new TransportClosed('the process exited'));
    this.answered(() => true, new TransportClosed('the process exited'));
    this.resolveExited(exit);
  }

  // ---- the frontier --------------------------------------------------------------------------------------------------

  private journaled(seq: number): void {
    this.frontier.journaled(seq);
    if (this.exitRecorded) this.maybeRelease();
  }

  // Once the child has exited and every record it wrote is journaled: the final ack, then `release`.
  private maybeRelease(): void {
    if (this.released || !this.exitRecorded || !this.frontier.reached(this.lastDelivered) || this.connection === null) return;
    this.released = true;
    this.frontier.flush();
    this.frontier.dispose();
    const connection = this.connection;
    this.connection = null;
    connection.send({ t: 'release' });
    connection.end();
  }

  // ---- input ---------------------------------------------------------------------------------------------------------

  private write(frame: StdinFrame, signal?: AbortSignal): Promise<void> {
    const data = Buffer.from(`${JSON.stringify(frame)}\n`, 'utf8');
    return new Promise<void>((resolve, reject) => {
      let handed = false;
      const onAbort = () => {
        if (!handed) reject(new TransportClosed('write aborted')); // a record handed to the socket settles on the host's answer
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      const turn = this.chain.then(async () => {
        await this.spawnOutcome;
        if (signal?.aborted) throw new TransportClosed('write aborted');
        if (this.ended || (this.connection === null && !this.reconnecting)) throw new TransportClosed('the session host is gone');
        handed = true;
        await new Promise<void>((done, fail) => {
          this.inFlight = { offset: this.nextOffset, end: this.nextOffset + data.length, data, resolve: done, reject: fail, retry: null };
          this.hand(this.inFlight);
        });
      });
      this.chain = turn.catch(() => {});
      void turn.then(
        () => {
          signal?.removeEventListener('abort', onAbort);
          this.frontier.flush(); // one ack at each write's settle
          resolve();
        },
        (error: unknown) => {
          signal?.removeEventListener('abort', onAbort);
          reject(error instanceof TransportClosed ? error : new TransportClosed(String((error as Error)?.message ?? error)));
        },
      );
    });
  }

  private hand(w: InFlight): void {
    if (this.connection !== null && !this.reconnecting) this.connection.write(stdinRecord(w.offset, w.data)); // else the reconnect resends it
  }

  private resend(w: InFlight): void {
    w.retry = null;
    if (this.inFlight === w) this.hand(w);
  }

  // Settles the record in flight when `done` says the answer is its (null error: resolved).
  private answered(done: (w: InFlight) => boolean, error: Error | null): void {
    const w = this.inFlight;
    if (!w || !done(w)) return;
    this.inFlight = null;
    if (w.retry !== null) clearTimeout(w.retry);
    if (error) w.reject(error);
    else w.resolve();
  }

  private endInput(): void {
    if (this.endSent || this.ended) return;
    this.endSent = true;
    void this.chain.then(() => this.connection?.send({ t: 'end' }));
  }

  private kill(name: 'SIGTERM' | 'SIGKILL'): void {
    if (this.ended || this.child === null) return;
    this.connection?.send({ t: 'signal', name, group: name === 'SIGKILL' });
  }

  // ---- the connection's loss -----------------------------------------------------------------------------------------

  private async lost(why: string): Promise<void> {
    this.connection = null;
    if (this.released || this.ended) return; // after the exit nothing is owed but the release, which the host's linger covers
    this.frontier.dispose();
    const alive = isAlive(this.o.hostPid) && (this.o.hostProcStart === '' || procStartOf(this.o.hostPid) === this.o.hostProcStart);
    const gone = this.o.hostGone() ?? (alive ? null : 'its process is gone');
    if (gone === null) {
      this.reconnecting = true;
      try {
        await this.reconnect();
        return;
      } catch (error) {
        this.o.deps.log(`session host ${this.o.holderId}: the reconnect after "${why}" failed: ${(error as Error).message}`);
      } finally {
        this.reconnecting = false;
      }
    }
    this.hostLost(gone ?? 'it did not take the writer back');
  }

  // D45: the writer at the next fence, its in-flight record settled by the host's offsets, the stream read from the
  // last delivered sequence + 1.
  private async reconnect(): Promise<void> {
    const deadline = Date.now() + (this.o.deps.startMs ?? HOST_START_MS);
    const { connection, hello } = await HostConnection.open(this.o.paths.socket, this.o.token, { deadline, gone: () => this.o.hostGone(), log: this.o.deps.log });
    this.o.deps.onConnection?.(connection);
    this.fence = Math.max(this.fence, hello.fence) + 1;
    connection.send({ t: 'attach', role: 'writer', fence: this.fence });
    const attached = await connection.expect('attached', deadline).catch((error: unknown) => {
      connection.close();
      throw error;
    });
    this.o.deps.log(`session host ${this.o.holderId}: reconnected as writer at fence ${this.fence}, reading from ${this.lastDelivered + 1}`);
    this.connection = connection;
    if (this.frontier.value > 0) connection.send({ t: 'ack', seq: this.frontier.value }); // an ack the closed connection may have dropped
    if (hello.exit) this.pendingExit = { code: hello.exit.code, signal: hello.exit.signal as NodeJS.Signals | null };
    this.attachListeners(connection);
    connection.send({ t: 'read', fromSeq: this.lastDelivered + 1 });
    const w = this.inFlight;
    this.nextOffset = attached.stdinAccepted;
    if (w) {
      if (w.end <= attached.stdinApplied) this.answered(() => true, null);
      else if (w.offset >= attached.stdinAccepted) {
        w.offset = attached.stdinAccepted;
        w.end = w.offset + w.data.length;
        connection.write(stdinRecord(w.offset, w.data));
      } else this.answered(() => true, new TransportClosed('the session host lost track of a record across the reconnect'));
    }
  }

  // The host is gone with the session's pipes: a crash, `host_lost`, and the child ended here rather than left to a
  // successor's sweep.
  private hostLost(why: string): void {
    this.o.deps.log(`session host ${this.o.holderId} (pid ${this.o.hostPid}) is lost: ${why}`);
    this.frames.push({ frame: null, raw: '', error: { kind: 'host_lost', message: `The session host (pid ${this.o.hostPid}) stopped: ${why}.`, length: 0, typeGuess: null } });
    this.finish({ code: null, signal: 'SIGKILL' });
    void this.endChild();
  }

  private async endChild(): Promise<void> {
    const child = this.child;
    if (child === null) return;
    const deps = this.o.deps.child ?? { isAlive, procStartOf, signal: signalOrphan };
    const same = () => deps.isAlive(child.pid) && deps.procStartOf(child.pid) === child.procStart;
    try {
      if (!same()) return;
      deps.signal(child.pid, 'SIGTERM');
      const until = Date.now() + (deps.graceMs ?? SWEEP_GRACE_MS);
      while (Date.now() < until && deps.isAlive(child.pid)) await new Promise((resolve) => setTimeout(resolve, 100));
      if (same()) deps.signal(child.pid, 'SIGKILL');
    } catch (error) {
      this.o.deps.log(`the engine pid ${child.pid} of the lost session host could not be signalled: ${(error as Error).message}`);
    }
  }
}
