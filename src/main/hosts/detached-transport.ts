// Main's side of a detached engine host, the supervisor (E10 execution document, §Design 1 "Start-or-connect" and its
// state table, §2 the socket layer, §6 the rules at connect). One attempt at a time reaches a supervisor: `connecting`
// (the lock's socket, else the default path), `handshaking` (the token, `hello`, `welcome` or `refuse`), `spawning`
// (the engine-host bundle under the Electron binary as Node, detached, in its own session); every step is bounded by
// one attempt budget. Liveness is a successful hello, never a pid alone; a pid is believed only with its start time.
//
// The transport reports to the host supervisor (supervisor.ts), which owns `HostState`, the held requests, the crash
// ladder, the resync and the `ready` line: `connected` once a welcome is served; `disconnected` the moment a served
// connection closes for a reason main did not ask for, then `lost` with what the close was once the welcomed pid has
// been looked at again; `exited` when a candidate died before any hello succeeded (C1's ladder); `failed` when the
// attempt gave up (`crashed`); `waiting` when an incompatible supervisor still runs sessions (it retries by itself).
// E10 Task 2.3b: what main asks of a supervisor beside `exit` (a stop-all whose close is deliberate, the quit after which
// nothing reconnects, the kill of a holder that never answers).
import { spawn as spawnProcess, type SpawnOptions } from 'node:child_process';
import * as fs from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SocketPort } from '@shared/host/socket-port';
import { HELLO_TIMEOUT_MS } from '@shared/host/socket-server';
import {
  ServerRefuseSchema,
  ServerWelcomeSchema,
  SOCKET_PROTOCOL,
  splitLines,
  type ClientExit,
  type ClientHello,
  type ServerRefuse,
  type ServerWelcome,
} from '@shared/host/socket-protocol';
import type { HostMessage } from '@shared/ipc/host-protocol';
import { wireFingerprint } from '@shared/ipc/wire-fingerprint';
import {
  buildIdOf,
  isAlive,
  isSameProcess,
  PID_POLL_MS,
  procStartOf,
  readLock,
  socketPathFor,
  START_EXIT_HELD,
  SUPERVISOR_FILES,
  type LockFile,
} from '../../engine-host/supervisor-files';

export const CONNECT_TIMEOUT_MS = 1_000;
export const START_TIMEOUT_MS = 15_000; // one budget for the whole attempt, exit-3 loops included
export const WAIT_RETRY_MS = 5_000; // how often an incompatible supervisor that still runs sessions is asked again
export const KILL_GRACE_MS = 2_000; // a candidate that never answered: SIGTERM, this long, then SIGKILL
export { HELLO_TIMEOUT_MS, PID_POLL_MS };

export interface DetachedTiming {
  connectTimeoutMs: number;
  helloTimeoutMs: number;
  startTimeoutMs: number;
  pidPollMs: number;
  waitRetryMs: number;
  killGraceMs: number;
}

export const DETACHED_TIMING: DetachedTiming = {
  connectTimeoutMs: CONNECT_TIMEOUT_MS,
  helloTimeoutMs: HELLO_TIMEOUT_MS,
  startTimeoutMs: START_TIMEOUT_MS,
  pidPollMs: PID_POLL_MS,
  waitRetryMs: WAIT_RETRY_MS,
  killGraceMs: KILL_GRACE_MS,
};

// What the transport uses of node's ChildProcess.
export interface SupervisorChild {
  pid?: number;
  unref(): void;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

export interface DetachedTransportOptions {
  modulePath: string; // the engine-host bundle: the supervisor's script and the source of the build id
  userData(): string; // read at each attempt; the supervisor's files live under `<userData>/supervisor/`
  packaged(): boolean;
  env?(): NodeJS.ProcessEnv; // main's environment at the spawn (default process.env)
  spawn?(command: string, args: string[], options: SpawnOptions): SupervisorChild;
  isAlive?(pid: number): boolean;
  procStartOf?(pid: number): string | null;
  kill?(pid: number, signal: NodeJS.Signals): void;
  timing?: Partial<DetachedTiming>;
  log?(line: string): void;
}

// A served connection as the host supervisor sees it: C1's envelope both ways.
export interface HostLink {
  postMessage(message: HostMessage): void;
  close(): void;
  onMessage(listener: (data: unknown) => void): void;
}

export interface ExitInfo {
  code: number | null; // known only for a supervisor this app run spawned
  signal: string | null;
}

// How a served connection ended, beyond `disconnected`: `quiet` (the welcomed pid lives on: backpressure, a socket
// error; reconnect without a crash count), `deliberate` (main asked the supervisor to exit; a fresh start once it is
// gone), `replaced` (another client took the supervisor; terminal), or a crash (the welcomed pid is dead).
export type DetachedLoss = 'quiet' | 'deliberate' | 'replaced' | { crash: ExitInfo };

// Why an attempt gave up: a live process holds the lock and never answered, or something else (logged).
export type DetachedFailure = 'held_lock' | 'other';

export interface DetachedEvents {
  connected(link: HostLink, welcome: ServerWelcome): void;
  disconnected(): void;
  lost(loss: DetachedLoss): void;
  exited(exit: ExitInfo): void;
  failed(reason: DetachedFailure, message: string): void;
  waiting(liveSessions: number, refused: 'wire' | 'protocol'): void;
}

export interface DetachedTransport {
  launch(): void; // a fresh attempt (after a deliberate close, once the welcomed pid is gone)
  exit(when: ClientExit['when']): boolean; // asks the served supervisor to exit; its close is then deliberate
  // E10 start
  // Main is about to send the served supervisor a command after which it exits whatever its answer (`host.stopAll`):
  // its close is then deliberate. False when nothing is served.
  expectExit(): boolean;
  // The quit: from here nothing reconnects or spawns. A served connection stays open for the quit's stop-all and its
  // close ends the transport; with none served the transport stops at once (false).
  quit(): boolean;
  // The process the lock names, alive with the lock's start time and not the one served: SIGTERM, SIGKILL past the
  // grace; resolves once it is gone or the start budget is spent (true), false when the lock names no such process.
  killHeld(): Promise<boolean>;
  // E10 end
  stop(): void; // terminal: the socket closed with no `exit` sent; the supervisor keeps serving; nothing restarts
}

interface Proc {
  pid: number;
  procStart: string;
}

interface Served {
  port: SocketPort;
  proc: Proc;
  exitAsked: ClientExit['when'] | null; // what main asked of the supervisor, on this connection or an earlier one
  replaced: boolean;
}

type Answer = { kind: 'welcome'; welcome: ServerWelcome; leftover: Buffer } | { kind: 'refuse'; refuse: ServerRefuse } | { kind: 'failed'; why: string };

export function createDetachedTransport(options: DetachedTransportOptions, events: DetachedEvents): DetachedTransport {
  const timing: DetachedTiming = { ...DETACHED_TIMING, ...options.timing };
  const processes = { isAlive: options.isAlive ?? isAlive, procStartOf: options.procStartOf ?? procStartOf };
  const spawn = options.spawn ?? ((command: string, args: string[], spawnOptions: SpawnOptions) => spawnProcess(command, args, spawnOptions));
  const kill = options.kill ?? ((pid: number, signal: NodeJS.Signals) => process.kill(pid, signal));
  const log = options.log ?? ((line: string) => console.log(`[hosts] engine-host: ${line}`));
  const sameProcess = (proc: Proc) => isSameProcess(proc, processes);

  let stopped = false;
  let quitting = false; // E10 Task 2.3b: the quit asked; the served connection's close is terminal
  let generation = 0; // the current attempt; a callback of an older one does nothing
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const attemptSockets = new Set<Socket>();
  let served: Served | null = null;
  let awaitDeath: Proc | null = null; // the next attempt waits for this process to be gone (a deliberate close)
  let idleArmed: Proc | null = null; // the supervisor main asked to exit when idle: remembered across reconnects to it
  let waitingFor: number | null = null; // while waiting, the live count last reported (reported again only if it changes)
  const spawned = new Map<number, ExitInfo | null>(); // candidates this app run started, and how each exited

  function after(ms: number, run: () => void): void {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!stopped) run();
    }, ms);
    timers.add(timer);
  }

  function cancelAttempt(): void {
    generation++;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const socket of attemptSockets) socket.destroy();
    attemptSockets.clear();
  }

  function launch(): void {
    if (stopped || quitting) return;
    cancelAttempt();
    const gen = generation;
    const current = () => gen === generation && !stopped;
    const deadline = Date.now() + timing.startTimeoutMs;
    const pastBudget = () => Date.now() >= deadline;
    const step = (ms: number, run: () => void) => after(ms, () => current() && run());
    const userData = options.userData();
    const dir = join(userData, 'supervisor');
    const defaultSocket = socketPathFor(dir, userData, tmpdir());
    let tokenRetried = false;
    let candidate: { proc: Proc; exit: ExitInfo | null } | null = null;

    const finish = () => cancelAttempt(); // the attempt is over: its timers and sockets go
    const fail = (reason: DetachedFailure, message: string) => {
      if (candidate && candidate.exit === null) stopCandidate(candidate.proc);
      finish();
      waitingFor = null;
      events.failed(reason, message);
    };
    const exited = (exit: ExitInfo) => {
      finish();
      waitingFor = null;
      events.exited(exit);
    };

    const dying = awaitDeath;
    awaitDeath = null;
    if (dying) untilGone(dying, connecting);
    else connecting();

    // Polls a process until it is gone, then goes on; past the budget, a process that will not go holds the lock.
    function untilGone(proc: Proc, then: () => void): void {
      if (!sameProcess(proc)) return then();
      if (pastBudget()) return fail('held_lock', `the supervisor (pid ${proc.pid}) was asked to exit and is still running`);
      step(timing.pidPollMs, () => untilGone(proc, then));
    }

    function connecting(): void {
      const lock = readLock(dir);
      connect(lock?.socketPath ?? defaultSocket, (socket) => handshaking(socket, lock), () => {
        if (lock && sameProcess(lock)) {
          if (pastBudget()) return fail('held_lock', `a supervisor (pid ${lock.pid}) holds the lock and does not answer`);
          return step(timing.pidPollMs, connecting); // between its lock and its listen, or in its exit order
        }
        spawning();
      });
    }

    function spawning(): void {
      if (candidate) {
        if (candidate.exit === null) return awaitCandidate();
        if (candidate.exit.code !== START_EXIT_HELD) return exited(candidate.exit);
        candidate = null; // it exited 3: another supervisor holds the lock
        return connecting();
      }
      if (pastBudget()) return fail('other', 'no supervisor answered within the start budget');
      const started = spawnCandidate();
      if (!started) return exited({ code: null, signal: null });
      candidate = { proc: started, exit: null };
      awaitCandidate();
    }

    // The candidate is starting: try its socket every poll until it answers, exits, or the budget ends. Its exit is
    // read here, at the next poll, so one flow drives the attempt.
    function awaitCandidate(): void {
      const mine = candidate!;
      const exit = spawned.get(mine.proc.pid);
      if (exit) mine.exit = exit;
      if (mine.exit) return spawning();
      if (pastBudget()) return fail('held_lock', `the supervisor it started (pid ${mine.proc.pid}) never answered`);
      const lock = readLock(dir);
      connect(lock?.socketPath ?? defaultSocket, (socket) => handshaking(socket, lock), () => step(timing.pidPollMs, awaitCandidate));
    }

    function handshaking(socket: Socket, lock: LockFile | null): void {
      let token: string;
      try {
        token = fs.readFileSync(join(dir, SUPERVISOR_FILES.token), 'utf8').trim();
      } catch {
        socket.destroy();
        return unanswered(lock, 'no token to present');
      }
      readAnswer(socket, (answer) => {
        if (!current()) return void socket.destroy();
        if (answer.kind === 'failed') {
          socket.destroy();
          return unanswered(lock, answer.why);
        }
        if (answer.kind === 'welcome') return welcomed(socket, answer.welcome, answer.leftover, lock);
        refused(socket, answer.refuse, lock);
      });
      const hello: ClientHello = { t: 'hello', protocol: SOCKET_PROTOCOL, token, buildId: buildIdOf(options.modulePath), wire: wireFingerprint(), appPid: process.pid };
      socket.write(`${JSON.stringify(hello)}\n`);
    }

    // A hello timeout, a close before `welcome`, or an answer that is not one: retry while the lock's pid lives.
    function unanswered(lock: LockFile | null, why: string): void {
      log(`no welcome (${why})`);
      const holder = readLock(dir) ?? lock;
      if (holder && sameProcess(holder)) {
        if (pastBudget()) return fail('held_lock', `a supervisor (pid ${holder.pid}) holds the lock and does not answer`);
        return step(timing.pidPollMs, connecting);
      }
      spawning();
    }

    function welcomed(socket: Socket, welcome: ServerWelcome, leftover: Buffer, lock: LockFile | null): void {
      const proc: Proc = { pid: welcome.pid, procStart: lock?.pid === welcome.pid ? lock.procStart : (processes.procStartOf(welcome.pid) ?? '') };
      // §6: another build with the same wire and nothing live is replaced at once, unseen. (M2's Task 2.4 adds the
      // other rows: exit-when-idle and the banner when sessions are live; until then such a supervisor is served.)
      if (welcome.buildId !== buildIdOf(options.modulePath) && welcome.liveSessions === 0) {
        log(`supervisor pid ${welcome.pid} runs build ${welcome.buildId} with nothing live; replacing it`);
        return replace(socket, proc);
      }
      attemptSockets.delete(socket);
      finish();
      serve(socket, leftover, proc, welcome);
    }

    function refused(socket: Socket, refuse: ServerRefuse, lock: LockFile | null): void {
      if (refuse.reason === 'token') {
        socket.destroy();
        if (tokenRetried) return fail('other', 'the supervisor refused the token twice');
        tokenRetried = true; // a supervisor rotated it while starting: read it again, once
        return connecting();
      }
      if (refuse.reason === 'replaced') {
        socket.destroy();
        return unanswered(lock, 'a refusal no hello asks for');
      }
      // §6: another protocol or wire. With nothing live the old supervisor is asked to exit and a fresh one started;
      // with sessions live it is left to run them, and main waits (the banner's Restart now and Wait are M3's).
      const holder = readLock(dir) ?? lock;
      if (refuse.liveSessions === 0) {
        log(`supervisor ${holder ? `pid ${holder.pid} ` : ''}speaks ${refuse.reason === 'wire' ? `wire ${refuse.wire}` : `protocol ${refuse.protocol}`} with nothing live; replacing it`);
        return replace(socket, holder ? { pid: holder.pid, procStart: holder.procStart } : null);
      }
      socket.destroy();
      finish();
      if (waitingFor !== refuse.liveSessions) {
        waitingFor = refuse.liveSessions;
        log(`supervisor ${holder ? `pid ${holder.pid} ` : ''}is incompatible (${refuse.reason}) and runs ${refuse.liveSessions} sessions; waiting`);
        events.waiting(refuse.liveSessions, refuse.reason);
      }
      after(timing.waitRetryMs, launch);
    }

    // `exit {when: 'now'}`, then a fresh start once the process is gone.
    function replace(socket: Socket, proc: Proc | null): void {
      const exit: ClientExit = { t: 'exit', when: 'now' };
      socket.end(`${JSON.stringify(exit)}\n`);
      if (proc) untilGone(proc, connecting);
      else step(timing.pidPollMs, connecting);
    }

    function connect(path: string, onConnected: (socket: Socket) => void, onRefused: () => void): void {
      const socket = createConnection(path);
      attemptSockets.add(socket);
      socket.once('close', () => attemptSockets.delete(socket));
      socket.on('error', () => {}); // every failure is read through `settle` or the handshake
      let settled = false;
      const timer = setTimeout(() => settle(false), timing.connectTimeoutMs);
      function settle(ok: boolean): void {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!current()) return void socket.destroy();
        if (ok) return onConnected(socket);
        socket.destroy();
        attemptSockets.delete(socket);
        onRefused();
      }
      socket.once('connect', () => settle(true));
      socket.once('error', () => settle(false));
    }

    function spawnCandidate(): Proc | null {
      let logFd: number | null = null;
      try {
        privateDirectory(dir);
        logFd = fs.openSync(join(dir, SUPERVISOR_FILES.log), 'a', 0o600);
        fs.fchmodSync(logFd, 0o600);
        const child = spawn(process.execPath, [options.modulePath, '--detached', dir], {
          detached: true, // its own session and process group: no terminal's SIGHUP or app exit reaches it
          stdio: ['ignore', logFd, logFd], // not connected to main, so it outlives main
          env: supervisorEnv(options.env?.() ?? process.env, { userData, packaged: options.packaged() }),
          cwd: process.cwd(),
          argv0: 'maws-supervisor',
        });
        const pid = child.pid;
        if (pid === undefined) {
          child.on('error', () => {});
          log('the supervisor could not be spawned');
          return null;
        }
        child.on('error', (error) => log(`supervisor pid ${pid}: ${error.message}`));
        child.on('exit', (code, signal) => {
          spawned.set(pid, { code, signal });
          log(`supervisor pid ${pid} exited (${signal ?? `code ${code}`})`);
        });
        child.unref();
        spawned.set(pid, null);
        log(`spawned a supervisor, pid ${pid}`);
        return { pid, procStart: processes.procStartOf(pid) ?? '' };
      } catch (error) {
        log(`the supervisor could not be spawned: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      } finally {
        if (logFd !== null) fs.closeSync(logFd);
      }
    }

    function readAnswer(socket: Socket, onAnswer: (answer: Answer) => void): void {
      let answered: Answer | null = null;
      let done = false;
      const splitter = splitLines(
        (line) => {
          answered = parseAnswer(line);
          return 'stop';
        },
        () => (answered = { kind: 'failed', why: 'an answer over the line cap' }),
      );
      const finishWith = (answer: Answer) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.off('data', onData);
        socket.off('close', onClose);
        onAnswer(answer);
      };
      const onData = (chunk: Buffer) => {
        splitter.push(chunk);
        const answer: Answer | null = answered;
        if (answer === null) return;
        finishWith(answer.kind === 'welcome' ? { ...answer, leftover: splitter.rest() } : answer);
      };
      const onClose = () => finishWith({ kind: 'failed', why: 'closed before answering' });
      const timer = setTimeout(() => finishWith({ kind: 'failed', why: `no answer within ${timing.helloTimeoutMs} ms` }), timing.helloTimeoutMs);
      socket.on('data', onData);
      socket.on('close', onClose);
    }
  }

  // The welcomed connection: C1's envelope through a SocketPort; the layer's own `refuse replaced` is read here.
  function serve(socket: Socket, leftover: Buffer, proc: Proc, welcome: ServerWelcome): void {
    const port = new SocketPort(socket, leftover, { log: (line) => log(`socket: ${line}`) });
    if (idleArmed && !(idleArmed.pid === proc.pid && idleArmed.procStart === proc.procStart)) idleArmed = null;
    const connection: Served = { port, proc, exitAsked: idleArmed ? 'idle' : null, replaced: false };
    served = connection;
    waitingFor = null;
    const listeners: ((data: unknown) => void)[] = [];
    port.on('message', ({ data }) => {
      const refuse = ServerRefuseSchema.safeParse(data);
      if (refuse.success) {
        if (refuse.data.reason === 'replaced') connection.replaced = true;
        return;
      }
      for (const listener of listeners) listener(data);
    });
    port.onClose(() => closed(connection));
    log(`connected to supervisor pid ${welcome.pid} build ${welcome.buildId} (${welcome.liveSessions} live of ${welcome.rows} rows)`);
    events.connected(
      {
        postMessage: (message) => void port.postMessage(message),
        close: () => port.close(),
        onMessage: (listener) => void listeners.push(listener),
      },
      welcome,
    );
    port.start();
  }

  function closed(connection: Served): void {
    if (served !== connection) return;
    served = null;
    if (stopped) return;
    if (quitting) {
      stopped = true; // the quit's stop-all ended the supervisor, or it closed first: either way nothing follows
      return events.disconnected();
    }
    if (connection.replaced) {
      log(`another client replaced this app at supervisor pid ${connection.proc.pid}`);
      return events.lost('replaced');
    }
    if (connection.exitAsked === 'now') {
      awaitDeath = connection.proc;
      return events.lost('deliberate');
    }
    events.disconnected();
    // A supervisor that died closes its socket before its pid is gone (a process still exiting, or a child not yet
    // reaped), so the pid is looked at one poll later.
    after(timing.pidPollMs, () => {
      const exit = spawned.get(connection.proc.pid) ?? null;
      if (exit === null && sameProcess(connection.proc)) {
        log(`the connection to supervisor pid ${connection.proc.pid} closed; it still runs`);
        return events.lost('quiet');
      }
      if (connection.exitAsked === 'idle') return events.lost('deliberate'); // it exited when idle, as asked
      log(`supervisor pid ${connection.proc.pid} is gone`);
      events.lost({ crash: exit ?? { code: null, signal: null } });
    });
  }

  // E10 Task 2.3b: polls until the process is gone or `ms` has passed; whether it is gone.
  async function goneWithin(proc: Proc, ms: number): Promise<boolean> {
    const until = Date.now() + ms;
    while (sameProcess(proc)) {
      if (Date.now() >= until) return false;
      await new Promise((resolve) => setTimeout(resolve, timing.pidPollMs));
    }
    return true;
  }

  function signal(pid: number, name: NodeJS.Signals): boolean {
    try {
      kill(pid, name);
      return true;
    } catch {
      return false; // already gone
    }
  }

  function stopCandidate(proc: Proc): void {
    log(`stopping the supervisor it started (pid ${proc.pid}): it never answered`);
    try {
      kill(proc.pid, 'SIGTERM');
    } catch {
      return; // already gone
    }
    const timer = setTimeout(() => {
      if (!sameProcess(proc)) return;
      try {
        kill(proc.pid, 'SIGKILL');
      } catch {
        // gone meanwhile
      }
    }, timing.killGraceMs);
    timer.unref?.();
  }

  return {
    launch,
    exit(when) {
      if (!served || stopped) return false;
      // remembered only once written: an exit the socket refused was never asked, and the next close is not deliberate
      if (!served.port.postMessage({ t: 'exit', when } satisfies ClientExit)) return false;
      if (served.exitAsked !== 'now') served.exitAsked = when;
      if (when === 'idle') idleArmed = served.proc;
      log(`asked supervisor pid ${served.proc.pid} to exit ${when}`);
      return true;
    },
    // E10 start
    expectExit() {
      if (!served || stopped) return false;
      served.exitAsked = 'now';
      log(`supervisor pid ${served.proc.pid} is asked to stop all and exit`);
      return true;
    },
    quit() {
      if (stopped) return false;
      quitting = true;
      cancelAttempt();
      if (served) return true;
      stopped = true;
      return false;
    },
    async killHeld() {
      if (stopped || quitting) return false;
      const lock = readLock(join(options.userData(), 'supervisor'));
      if (!lock || !sameProcess(lock) || (served && served.proc.pid === lock.pid)) return false;
      const proc: Proc = { pid: lock.pid, procStart: lock.procStart };
      log(`stopping the supervisor that holds the lock and does not answer (pid ${proc.pid})`);
      if (!signal(proc.pid, 'SIGTERM') || (await goneWithin(proc, timing.killGraceMs))) return true;
      if (sameProcess(proc)) signal(proc.pid, 'SIGKILL'); // checked again: the pid is not reused meanwhile
      if (!(await goneWithin(proc, timing.startTimeoutMs))) log(`supervisor pid ${proc.pid} is still running after SIGKILL`);
      return true;
    },
    // E10 end
    stop() {
      if (stopped) return;
      stopped = true;
      cancelAttempt();
      const connection = served;
      served = null;
      connection?.port.close(); // no `exit`: the supervisor keeps serving its sessions
    },
  };
}

// The supervisor's environment, built at the spawn from main's: Node mode for the Electron binary, the profile's data
// directory, nothing that would steer a long-lived process from a dev shell (MAWS_HOST_MODE is main's; NODE_OPTIONS
// would carry an inspector or loader flag into a process that outlives the shell), and no dev relay in a packaged app.
export function supervisorEnv(env: NodeJS.ProcessEnv, opts: { userData: string; packaged: boolean }): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env, ELECTRON_RUN_AS_NODE: '1', MAWS_USER_DATA: opts.userData };
  delete out.MAWS_HOST_MODE;
  delete out.NODE_OPTIONS;
  if (opts.packaged) delete out.MAWS_RELAY_URL; // C11: the dev-only relay override never reaches a packaged host
  return out;
}

function privateDirectory(path: string): void {
  fs.mkdirSync(path, { recursive: true, mode: 0o700 });
  fs.chmodSync(path, 0o700);
}

function parseAnswer(line: string): Answer {
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    return { kind: 'failed', why: 'an answer that is not JSON' };
  }
  const welcome = ServerWelcomeSchema.safeParse(data);
  if (welcome.success) return { kind: 'welcome', welcome: welcome.data, leftover: Buffer.alloc(0) };
  const refuse = ServerRefuseSchema.safeParse(data);
  if (refuse.success) return { kind: 'refuse', refuse: refuse.data };
  return { kind: 'failed', why: 'an answer that is neither welcome nor refuse' };
}
