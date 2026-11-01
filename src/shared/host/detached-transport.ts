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
//
// P5 O1 M6 (OX1): the hello presents the wire's major (`protocol`), minor and capabilities, and any welcome of that major
// is served, whatever its minor; another build within it takes the other-build path below. The protocol-2 window: a
// supervisor that speaks only protocol 2 (a pre-O1 app left it running) refuses that hello `protocol`; when its
// refusal's fingerprint equals this app's, main reconnects with protocol 2's hello and serves it as protocol 2, which
// carries nothing protocol 2 lacks (main sends a request `client` and `clientGone` only to a `machine` host). Every
// other refusal takes the path it always did. The answers are read tolerantly (@shared/ipc/tolerant).
//
// P5 O2 M3 (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md): the transport left main, so a plain Node process
// (`mawsd`) reaches its hosts with it too, and it reaches any host, not the supervisor alone. Each default is E10's:
// - `files`: the host's directory, lock, token, socket and log (the supervisor's under `<userData>/supervisor/`); given
//   files name the socket to connect to, whatever the lock names, since one lock may cover several sockets (`mawsd`'s);
// - `start`: `spawn` (a command, its arguments, environment and argv0; the engine-host bundle as the supervisor by
//   default), `unit` (launchd or systemd is asked to start it, and the socket is polled), or `none` (polled only);
// - `buildPolicy`: `replace` (E10's: another build with nothing live is replaced, with sessions live it is served and
//   asked to exit when idle) or `serve` (any build of the major is served and never asked to exit);
// - `relayed`: the lock holder is a relay (`mawsd`), not the host its welcome names, so after `exit now` on a refused
//   connection the next attempt follows a poll instead of waiting for the lock holder's death, which never comes.
// P5 O16 M3b (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3; D9, D40, D56): an engine host that lists
// `host.holder` hands its sessions over instead of being waited out. Served, `handover` marks its connection for a
// replacement (so its close, now or after a deferral, spawns the successor and never parks an on-demand host) and asks
// `host.handover`; deferred, it is asked again every WAIT_RETRY_MS, nothing ever killed. M3c fix wave 2 (D63): of another
// build with sessions live, it is served as it is and reported `updatePending`, never asked to exit when idle; the host
// supervisor asks it to hand over at its first quiet status. `waitingOn` holds an attempt's budget while a relay reports
// its host handing over. A close after `exit idle` waits for the pid's death (bounded by `exitWaitMs`)
// before it reads as a quiet close, which a slow exit used to (#413).
// It also gains `recycle` (a draining close, then a fresh attempt at once) and `adopt` (one connect, no start). Every
// local path is checked before it is used (private-path.ts, RL §5.11): the directory before the token is read, the
// socket before a connect; a path that fails is logged and the host is unreachable.
import { spawn as spawnProcess, type SpawnOptions } from 'node:child_process';
import * as fs from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makePrivateDirectory } from './private-listen'; // P5 O2 M3
import { assertPrivateDirectory, assertPrivateSocket, PrivatePathError } from './private-path'; // P5 O2 M3
import { SocketPort } from './socket-port';
import { HELLO_TIMEOUT_MS } from './socket-server';
import {
  ServerRefuseSchema,
  ServerWelcomeSchema,
  ServerWelcomeV2Schema,
  SOCKET_PROTOCOL_V2,
  PTY_FRAMES_CAPABILITY,
  HOLDER_CAPABILITY,
  splitLines,
  type ClientExit,
  type ClientHello,
  type ClientHelloV2,
  type DocumentsClose,
  type DocumentsOpen,
  type ServerRefuse,
} from './socket-protocol';
import type { HostMessage, HostRequest } from '../ipc/host-protocol';
import { readTolerant, tolerantLog } from '../ipc/tolerant'; // P5 O1 M6
import type { WirePeer } from '../ipc/wire'; // P5 O1 M6
import {
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
import { appIdentity, type AppIdentity } from './identity'; // E10 Task 2.4

// P5 O2 M3 start (above)
export type StartStrategy =
  | { kind: 'spawn'; command: string; args: string[]; env: NodeJS.ProcessEnv; argv0: string }
  | { kind: 'unit'; start(): Promise<void> } // asks launchd or systemd to start the daemon
  | { kind: 'none' };
// `dir` is absolute; `lock`, `token` and `log` are names inside it; `socket` is the absolute path connected to.
export interface HostFiles {
  dir: string;
  lock: string;
  token: string;
  socket: string;
  log: string;
}
export type BuildPolicy = 'replace' | 'serve';
// P5 O2 M3 end

export const CONNECT_TIMEOUT_MS = 1_000;
export const START_TIMEOUT_MS = 15_000; // one budget for the whole attempt, exit-3 loops included
export const WAIT_RETRY_MS = 5_000; // how often an incompatible supervisor that still runs sessions is asked again
export const KILL_GRACE_MS = 2_000; // a candidate that never answered: SIGTERM, this long, then SIGKILL
// P5 O16 M3b (#413): how long a host asked to exit when idle may outlive its closed socket before the close reads as quiet
export const EXIT_WAIT_MS = 5_000;
// P5 O16 M3b: how far past its `graceMs` a `host.handover` answer may come before the ask has failed
export const HANDOVER_SLACK_MS = 5_000;
export { HELLO_TIMEOUT_MS, PID_POLL_MS };

export interface DetachedTiming {
  connectTimeoutMs: number;
  helloTimeoutMs: number;
  startTimeoutMs: number;
  pidPollMs: number;
  waitRetryMs: number;
  killGraceMs: number;
  exitWaitMs: number; // P5 O16 M3b
}

export const DETACHED_TIMING: DetachedTiming = {
  connectTimeoutMs: CONNECT_TIMEOUT_MS,
  helloTimeoutMs: HELLO_TIMEOUT_MS,
  startTimeoutMs: START_TIMEOUT_MS,
  pidPollMs: PID_POLL_MS,
  waitRetryMs: WAIT_RETRY_MS,
  killGraceMs: KILL_GRACE_MS,
  exitWaitMs: EXIT_WAIT_MS,
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
  // E10 Task 2.4: the build id and wire main presents in its hello and compares a welcome with (identity.ts; the bundle's
  // own and the wire's unless the e2e seams stand in); told when this run starts a supervisor of its own
  identity?: AppIdentity;
  timing?: Partial<DetachedTiming>;
  log?(line: string): void;
  // P5 O2 M3 start (above)
  files?: HostFiles;
  start?: StartStrategy;
  buildPolicy?: BuildPolicy;
  relayed?: boolean;
  // P5 O2 M3 end
  // P5 O2 (the bundle swap): asked just before each spawn; a reason means the code the spawn would run is no longer this
  // process's build (its bundle was replaced), so nothing is spawned and the attempt ends in `notLaunched`
  beforeSpawn?(): string | null;
  // P5 O16 M3c fix wave 2 (D63; concern 1): the host behind this socket is handing over and its relay holds hellos
  // meanwhile (`mawsd`'s fresh report, main's daemon shape): while true, the attempt's start budget does not run out, so
  // no candidate is stopped and nothing fails `held_lock`; the attempt retries every pidPollMs, and gets a whole budget
  // again once it is false
  waitingOn?(): boolean;
}

// A served connection as the host supervisor sees it: C1's envelope both ways. P3-A M5 (socket protocol 2): and the
// document channels main relays (doc-relay.ts): their lines (`documents.open` and `documents.close` out,
// `documents.closed` in among the messages) and their frames.
export interface HostLink {
  postMessage(message: HostMessage | DocumentsOpen | DocumentsClose): void;
  close(): void;
  onMessage(listener: (data: unknown) => void): void;
  postDoc(channel: number, frame: Uint8Array): boolean; // P3-A M5
  onDoc(listener: (channel: number, frame: Uint8Array) => void): void; // P3-A M5
}

export interface ExitInfo {
  code: number | null; // known only for a supervisor this app run spawned
  signal: string | null;
}

// How a served connection ended, beyond `disconnected`: `quiet` (the welcomed pid lives on: backpressure, a socket
// error; reconnect without a crash count), `deliberate` (main asked the supervisor to exit; a fresh start once it is
// gone), `replaced` (another client took the supervisor; terminal), or a crash (the welcomed pid is dead). P5 O16 M3b:
// `replace`, the close of a host asked to hand over: its successor is spawned at once (the next launch waits for the
// pid's death), whether a request waits or not.
export type DetachedLoss = 'quiet' | 'deliberate' | 'replaced' | 'replace' | { crash: ExitInfo };

// P5 O16 M3b: `host.handover`'s answer as the transport read it; `failed` when none came or it was an error.
export type HandoverAnswer = { state: 'detaching' } | { state: 'deferred'; inFlight: number; tool?: string /* M3c fix wave 2 */ } | { state: 'failed'; why: string };

// Why an attempt gave up: a live process holds the lock and never answered, or something else (logged).
export type DetachedFailure = 'held_lock' | 'other';

// P5 O1 M6: a served supervisor as its welcome described it, in either protocol (protocol 2's: major 2, minor 0, no
// capabilities).
export interface Welcomed {
  pid: number;
  liveSessions: number;
  rows: number;
  peer: WirePeer;
}

// P5 O16 M3c fix wave 2 (D63): what the transport knows of a served connection beyond its welcome: `updatePending`, a
// host of another build that hands its sessions over, served until its calls are quiet, then asked to (host-supervisor.ts)
export interface ServedFacts {
  updatePending: boolean;
}

export interface DetachedEvents {
  connected(link: HostLink, welcome: Welcomed, facts?: ServedFacts): void;
  disconnected(): void;
  lost(loss: DetachedLoss): void;
  exited(exit: ExitInfo): void;
  failed(reason: DetachedFailure, message: string): void;
  // An incompatible supervisor still runs sessions: its refusal, the whole line (P5 O2 M3), for a relay to reflect;
  // refusedOn reads what it named
  waiting(refuse: ServerRefuse): void;
  notLaunched(reason: string): void; // P5 O2: beforeSpawn's reason; nothing ran, so nothing exited
}

// P5 O1 M6: `wire` when the protocol-2 window was refused on the fingerprint (a protocol-2 supervisor of another
// fingerprint, which reaches `waiting` only when its fingerprint is not this app's), `protocol` for any other major.
export function refusedOn(refuse: ServerRefuse): 'wire' | 'protocol' {
  return refuse.reason === 'wire' || (refuse.reason === 'protocol' && refuse.protocol === SOCKET_PROTOCOL_V2) ? 'wire' : 'protocol';
}

export interface DetachedTransport {
  launch(): void; // a fresh attempt (after a deliberate close, once the welcomed pid is gone)
  exit(when: ClientExit['when']): boolean; // asks the served supervisor to exit; its close is then deliberate
  // E10 start
  // The owner's Restart now while waiting: a fresh attempt in which an incompatible supervisor is asked to exit now on
  // its refused connection, sessions live or not, and a fresh one started once it is gone.
  replaceIncompatible(): void;
  // Main is about to send the served supervisor a command after which it exits whatever its answer (`host.stopAll`):
  // its close is then deliberate. False when nothing is served. P5 O16 M3b: `replace`, a handover's: the close spawns
  // the successor instead.
  expectExit(kind?: 'now' | 'replace'): boolean;
  // P5 O16 M3b: the served host asked to hand its sessions over (`host.handover {graceMs}`), its connection marked for a
  // replacement first; deferred, asked again every WAIT_RETRY_MS while it is served. A failed ask unmarks it. `sent`:
  // what the caller waits for before the ask goes (the requests it sent on the link answered), the link marked meanwhile;
  // a link that closes before the ask, or under it unanswered, was the replacement's close: `detaching`.
  handover(graceMs: number, sent?: () => Promise<void>): Promise<HandoverAnswer>;
  // The quit: from here nothing reconnects or spawns. A served connection stays open for the quit's stop-all and its
  // close ends the transport; with none served the transport stops at once (false), and a supervisor whose connection
  // closed quietly, still alive and named by the lock, is sent SIGTERM so its exit order stops every row.
  quit(): boolean;
  // The process the lock names, alive with the lock's start time and not the one served: SIGTERM, SIGKILL past the
  // grace; resolves once it is gone or the start budget is spent (true), false when the lock names no such process.
  killHeld(): Promise<boolean>;
  // E10 end
  // P5 O2 M3 start
  // The served connection's draining close: nothing more is written, what the host wrote before it saw the end is still
  // delivered; once the close has ended (or the socket port's grace ran out), `drained` runs and a fresh attempt starts
  // at once, with no `disconnected` or `lost`. False (nothing done) when nothing is served.
  recycle(drained: () => void): boolean;
  // One connect to a host whose lock names a live process, with no start: true once it is served (`connected` was
  // reported), false otherwise (nothing reported); another attempt started meanwhile answers false.
  adopt(): Promise<boolean>;
  // P5 O2 M3 end
  // P5 O2 M5: the exit-when-idle asked of the served host is taken back (the host was told so by command): its next
  // close is read as any other, not as the idle exit. False when nothing is served.
  disarmIdle(): boolean;
  // P5 O2 M5: the served host was armed to exit when idle by command (`host.exitWhenIdle {armed: true}`, which writes no
  // `exit` line): its close once it is gone is the idle exit, deliberate, as after `exit idle`. False when nothing is served.
  expectIdleExit(): boolean;
  // terminal: the socket closed with no `exit` sent; the supervisor keeps serving; nothing restarts. E11: answers once
  // the draining close has ended (the supervisor closed its side, or the port's grace destroyed the socket), so the
  // quit can wait for the last lines before the process exits; nothing when nothing is served (Decision Log 28)
  stop(): Promise<void> | undefined;
}

interface Proc {
  pid: number;
  procStart: string;
}

interface Served {
  port: SocketPort;
  proc: Proc;
  exitAsked: ClientExit['when'] | 'replace' | null; // what main asked of the supervisor, on this connection or an earlier one (P5 O16 M3b: `replace`, a handover)
  handovers: Map<string, (data: unknown) => void>; // P5 O16 M3b: the `host.handover` asks awaiting their answers
  replaced: boolean;
  recycled: (() => void) | null; // P5 O2 M3: a recycle's draining close, and what runs at its end
}

// P5 O1 M6: the hello main sends, protocol 3 (the wire's major) or protocol 2 (the window's form)
type Form = 'current' | 'v2';
type Answer = { kind: 'welcome'; welcome: Welcomed; leftover: Buffer } | { kind: 'refuse'; refuse: ServerRefuse } | { kind: 'failed'; why: string };

export function createDetachedTransport(options: DetachedTransportOptions, events: DetachedEvents): DetachedTransport {
  const timing: DetachedTiming = { ...DETACHED_TIMING, ...options.timing };
  const processes = { isAlive: options.isAlive ?? isAlive, procStartOf: options.procStartOf ?? procStartOf };
  const spawn = options.spawn ?? ((command: string, args: string[], spawnOptions: SpawnOptions) => spawnProcess(command, args, spawnOptions));
  const kill = options.kill ?? ((pid: number, signal: NodeJS.Signals) => process.kill(pid, signal));
  const log = options.log ?? ((line: string) => console.log(`[hosts] engine-host: ${line}`));
  const sameProcess = (proc: Proc) => isSameProcess(proc, processes);
  const identity = options.identity ?? appIdentity(options.modulePath, {});
  const logDropped = tolerantLog(log); // P5 O1 M6
  const buildPolicy = options.buildPolicy ?? 'replace'; // P5 O2 M3
  // P5 O2 M3: the host's files, read at each attempt (the supervisor's follow userData)
  const filesOf = (): HostFiles => {
    if (options.files) return options.files;
    const userData = options.userData();
    const dir = join(userData, 'supervisor');
    return { dir, lock: SUPERVISOR_FILES.lock, token: SUPERVISOR_FILES.token, socket: socketPathFor(dir, userData, tmpdir()), log: SUPERVISOR_FILES.log };
  };
  const lockOf = (files: HostFiles) => readLock(files.dir, fs, files.lock);
  // the supervisor's socket is the one its lock names; given files name their own (above)
  const socketOf = (files: HostFiles, lock: LockFile | null) => (options.files ? files.socket : (lock?.socketPath ?? files.socket));

  let stopped = false;
  let quitting = false; // E10 Task 2.3b: the quit asked; the served connection's close is terminal
  let generation = 0; // the current attempt; a callback of an older one does nothing
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const attemptSockets = new Set<Socket>();
  let served: Served | null = null;
  let awaitDeath: Proc | null = null; // the next attempt waits for this process to be gone (a deliberate close)
  let idleArmed: Proc | null = null; // the supervisor main asked to exit when idle: remembered across reconnects to it
  let unserved: Proc | null = null; // the welcomed supervisor whose connection closed while it may live on (quiet)
  // while waiting, the refusal last reported, whole (P5 O2 M3: reported again when any field changes, so a relay never
  // reflects a replaced incompatible host's stale line)
  let waitingFor: string | null = null;
  const spawned = new Map<number, ExitInfo | null>(); // candidates this app run started, and how each exited
  let adopting: ((served: boolean) => void) | null = null; // P5 O2 M3: the adoption under way, answered once
  let handoverAsks = 0; // P5 O16 M3b: the ids of `host.handover` requests, apart from any the host supervisor sends

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
    answerAdoption(false); // P5 O2 M3: an adoption that ends without a welcome served nothing
  }

  function answerAdoption(servedIt: boolean): void {
    const answer = adopting;
    adopting = null;
    answer?.(servedIt);
  }

  // `replaceRefused`: the owner asked to restart an incompatible supervisor (replaceIncompatible), for this attempt only.
  // P5 O2 M3: `adopt`: one connect to a live lock holder's socket, nothing started; answered once at the attempt's end.
  function launch(replaceRefused = false, adopt: ((served: boolean) => void) | null = null): void {
    if (stopped || quitting) return adopt?.(false);
    cancelAttempt();
    adopting = adopt;
    const gen = generation;
    const current = () => gen === generation && !stopped;
    let deadline = Date.now() + timing.startTimeoutMs;
    const pastBudget = () => {
      // P5 O16 M3c fix wave 2: a handover the relay reports under way holds the budget (above)
      if (options.waitingOn?.()) {
        deadline = Math.max(deadline, Date.now() + timing.startTimeoutMs);
        return false;
      }
      return Date.now() >= deadline;
    };
    const step = (ms: number, run: () => void) => after(ms, () => current() && run());
    const files = filesOf();
    const { dir } = files;
    const strategy = options.start ?? null; // null: E10's spawn of the supervisor
    let tokenRetried = false;
    let unitAsked = false; // P5 O2 M3
    let candidate: { proc: Proc; exit: ExitInfo | null } | null = null;

    const finish = () => cancelAttempt(); // the attempt is over: its timers and sockets go
    const fail = (reason: DetachedFailure, message: string) => {
      if (adopting) return giveUp(message); // P5 O2 M3: an adoption reports nothing
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
    // P5 O2 M3: an adoption that served nothing leaves the host as it was
    const giveUp = (why: string) => {
      log(`adopted nothing (${why})`);
      finish();
    };
    // P5 O2 M3: a path that is not private (private-path.ts) makes the host unreachable
    const unreachable = (error: PrivatePathError) => {
      log(error.message);
      fail('other', error.message);
    };

    const dying = awaitDeath;
    awaitDeath = null;
    if (adopt) adoptOnce();
    else if (dying) untilGone(dying, connecting);
    else connecting();

    // P5 O2 M3: the adoption's one connect, to the socket of a live lock holder
    function adoptOnce(): void {
      if (dying && sameProcess(dying)) {
        awaitDeath = dying; // still exiting: the next launch waits for it
        return giveUp(`pid ${dying.pid} is still exiting`);
      }
      const lock = lockOf(files);
      if (!lock || !sameProcess(lock)) return giveUp('the lock names no live process');
      connect(socketOf(files, lock), (socket) => handshaking(socket, lock), () => giveUp(`pid ${lock.pid} does not answer`));
    }

    // Polls a process until it is gone, then goes on; past the budget, a process that will not go holds the lock.
    function untilGone(proc: Proc, then: () => void): void {
      if (!sameProcess(proc)) return then();
      if (pastBudget()) return fail('held_lock', `the supervisor (pid ${proc.pid}) was asked to exit and is still running`);
      step(timing.pidPollMs, () => untilGone(proc, then));
    }

    function connecting(): void {
      const lock = lockOf(files);
      connect(socketOf(files, lock), (socket) => handshaking(socket, lock), () => {
        if (lock && sameProcess(lock)) {
          if (pastBudget()) return fail('held_lock', `a supervisor (pid ${lock.pid}) holds the lock and does not answer`);
          return step(timing.pidPollMs, connecting); // between its lock and its listen, or in its exit order
        }
        spawning();
      });
    }

    function spawning(): void {
      if (adopting) return giveUp('nothing answered'); // P5 O2 M3
      // P5 O2 M3: a unit is asked once per attempt and its socket polled within the budget; `none` polls only
      if (strategy && strategy.kind !== 'spawn') {
        if (pastBudget()) return fail('other', strategy.kind === 'unit' ? 'the unit started nothing that answered within the start budget' : 'nothing answered within the start budget');
        if (strategy.kind === 'unit' && !unitAsked) {
          unitAsked = true;
          log('asking the unit to start');
          strategy.start().catch((error: unknown) => {
            if (current()) fail('other', `the unit could not be started: ${error instanceof Error ? error.message : String(error)}`);
          });
        }
        return step(timing.pidPollMs, connecting);
      }
      if (candidate) {
        if (candidate.exit === null) return awaitCandidate();
        if (candidate.exit.code !== START_EXIT_HELD) return exited(candidate.exit);
        candidate = null; // it exited 3: another supervisor holds the lock
        return connecting();
      }
      if (pastBudget()) return fail('other', 'no supervisor answered within the start budget');
      const declined = options.beforeSpawn?.() ?? null; // P5 O2 (the bundle swap)
      if (declined !== null) {
        log(`spawned nothing: ${declined}`);
        finish();
        waitingFor = null;
        return events.notLaunched(declined);
      }
      try {
        makePrivateDirectory(dir); // P5 O2 M3: created 0700 when missing, refused when not private
      } catch (error) {
        if (error instanceof PrivatePathError) return unreachable(error);
        log(`the supervisor could not be spawned: ${error instanceof Error ? error.message : String(error)}`);
        return exited({ code: null, signal: null });
      }
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
      const lock = lockOf(files);
      connect(socketOf(files, lock), (socket) => handshaking(socket, lock), () => step(timing.pidPollMs, awaitCandidate));
    }

    // P5 O1 M6: `form` is the hello sent: the wire's major, or (once a protocol-2 supervisor of this fingerprint refused
    // that) protocol 2's
    function handshaking(socket: Socket, lock: LockFile | null, form: Form = 'current'): void {
      let token: string;
      try {
        assertPrivateDirectory(dir); // P5 O2 M3: before the token is read
        token = fs.readFileSync(join(dir, files.token), 'utf8').trim();
      } catch (error) {
        socket.destroy();
        if (error instanceof PrivatePathError) return unreachable(error);
        return unanswered(lock, 'no token to present');
      }
      readAnswer(socket, form, (answer) => {
        if (!current()) return void socket.destroy();
        if (answer.kind === 'failed') {
          socket.destroy();
          return unanswered(lock, answer.why);
        }
        if (answer.kind === 'welcome') return welcomed(socket, answer.welcome, answer.leftover, lock);
        refused(socket, answer.refuse, lock, form);
      });
      const hello: ClientHello | ClientHelloV2 =
        form === 'v2'
          ? { t: 'hello', protocol: SOCKET_PROTOCOL_V2, token, buildId: identity.buildId(), wire: identity.wire(), appPid: process.pid }
          : { t: 'hello', protocol: identity.major(), token, minor: identity.minor(), build: identity.buildId(), capabilities: [...identity.capabilities()], appPid: process.pid };
      socket.write(`${JSON.stringify(hello)}\n`);
    }

    // A hello timeout, a close before `welcome`, or an answer that is not one: retry while the lock's pid lives.
    function unanswered(lock: LockFile | null, why: string): void {
      log(`no welcome (${why})`);
      if (adopting) return giveUp(why); // P5 O2 M3: one connect
      const holder = lockOf(files) ?? lock;
      if (holder && sameProcess(holder)) {
        if (pastBudget()) return fail('held_lock', `a supervisor (pid ${holder.pid}) holds the lock and does not answer`);
        return step(timing.pidPollMs, connecting);
      }
      spawning();
    }

    function welcomed(socket: Socket, welcome: Welcomed, leftover: Buffer, lock: LockFile | null): void {
      const proc: Proc = { pid: welcome.pid, procStart: lock?.pid === welcome.pid ? lock.procStart : (processes.procStartOf(welcome.pid) ?? '') };
      // §6: another build of the wire's major (P5 O1 M6; through the protocol-2 window, one of the same fingerprint) is
      // replaced at once, unseen, when nothing is live; with sessions live it is served and asked to exit when idle (the
      // update banner reads `matches: 'build'` from its status), so the app moves to its own build once they are idle.
      // P5 O2 M3: under `serve`, any build is served as it is.
      const otherBuild = buildPolicy === 'replace' && welcome.peer.build !== identity.buildId();
      if (otherBuild && welcome.liveSessions === 0) {
        log(`supervisor pid ${welcome.pid} runs build ${welcome.peer.build} with nothing live; replacing it`);
        if (adopting) return replaceLater(socket, proc); // P5 O2 M3: an adoption starts nothing
        return replace(socket, proc);
      }
      // P5 O16 M3c fix wave 2 (D63; M3b's decision 9 reversed for this phase): with sessions live, a host that hands over
      // is served as it is, never asked to exit when idle; the host supervisor asks it to hand over at its first quiet
      // status, so a tool call running on it never holds the app's work (served and ready: #409, #411)
      const updatePending = otherBuild && welcome.peer.capabilities.includes(HOLDER_CAPABILITY);
      attemptSockets.delete(socket);
      const answer = adopting; // P5 O2 M3: answered once served, not by the attempt's end
      adopting = null;
      finish();
      serve(socket, leftover, proc, welcome, otherBuild && !updatePending, updatePending);
      answer?.(true);
    }

    function refused(socket: Socket, refuse: ServerRefuse, lock: LockFile | null, form: Form): void {
      if (adopting) {
        socket.destroy();
        return giveUp(`refused (${refuse.reason})`); // P5 O2 M3: a refusal is the next launch's to handle
      }
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
      // P5 O1 M6: the protocol-2 window. A protocol-2 supervisor whose fingerprint is this app's serves its sessions to
      // protocol 2's hello on a fresh connection (the refused one is good for an exit only).
      const protocol2 = refuse.reason === 'protocol' && refuse.protocol === SOCKET_PROTOCOL_V2;
      if (form === 'current' && protocol2 && refuse.wire === identity.wire()) {
        log(`supervisor ${lock ? `pid ${lock.pid} ` : ''}speaks protocol ${SOCKET_PROTOCOL_V2} with this app's wire ${refuse.wire}; speaking protocol ${SOCKET_PROTOCOL_V2} to it`);
        socket.destroy();
        return connect(socketOf(files, lock), (next) => handshaking(next, lock, 'v2'), () => unanswered(lock, 'the protocol-2 supervisor closed its socket'));
      }
      // §6: another protocol or wire. With nothing live (or at the owner's Restart now) the old supervisor is asked to
      // exit now and a fresh one started once it is gone; with sessions live it is left to run them, asked once per
      // process to exit when idle (Decision Log b2e4a1b1: the banner's Wait only acknowledges), and main waits.
      // P5 O1 M6: a protocol-2 supervisor of another fingerprint is refused on its wire, as protocol 2 refused it.
      // P5 O2 M3: under `serve` it is never asked to exit when idle (a relay's own clocks decide).
      const on = refusedOn(refuse);
      const holder = lockOf(files) ?? lock;
      const speaks = on === 'wire' ? `wire ${refuse.wire}` : `protocol ${refuse.protocol}`;
      if (refuse.liveSessions === 0 || replaceRefused) {
        log(`supervisor ${holder ? `pid ${holder.pid} ` : ''}speaks ${speaks} with ${refuse.liveSessions === 0 ? 'nothing live' : `${refuse.liveSessions} sessions live, restarted as asked`}; replacing it`);
        return replace(socket, holder ? { pid: holder.pid, procStart: holder.procStart } : null);
      }
      const armed = holder !== null && idleArmed !== null && idleArmed.pid === holder.pid && idleArmed.procStart === holder.procStart;
      if (armed || buildPolicy === 'serve') socket.destroy();
      else {
        // the refused connection stays open for this one line; it closes by itself once the supervisor has read it
        attemptSockets.delete(socket);
        socket.end(`${JSON.stringify({ t: 'exit', when: 'idle' } satisfies ClientExit)}\n`);
        socket.setTimeout(timing.helloTimeoutMs, () => socket.destroy());
        if (holder) idleArmed = { pid: holder.pid, procStart: holder.procStart };
        // E11: with no holder to remember it by, the arming is written at every retry (idempotent in the supervisor) and
        // logged once per wait: only the wait's first refusal finds `waitingFor` unset
        if (holder || waitingFor === null) log(`asked the incompatible supervisor ${holder ? `pid ${holder.pid} ` : ''}to exit when idle`);
      }
      finish();
      const line = JSON.stringify(refuse);
      if (waitingFor !== line) {
        waitingFor = line;
        log(`supervisor ${holder ? `pid ${holder.pid} ` : ''}is incompatible (${on}) and runs ${refuse.liveSessions} sessions; waiting`);
        events.waiting(refuse);
      }
      after(timing.waitRetryMs, launch);
    }

    // `exit {when: 'now'}`, then a fresh start once the process is gone. P5 O2 M3: relayed, the lock holder is the relay
    // and stays up while it replaces its host, so the next connect follows a poll, and the relay holds that hello.
    function replace(socket: Socket, proc: Proc | null): void {
      const exit: ClientExit = { t: 'exit', when: 'now' };
      socket.end(`${JSON.stringify(exit)}\n`);
      if (proc && !options.relayed) untilGone(proc, connecting);
      else step(timing.pidPollMs, connecting);
    }

    // P5 O2 M3: an adoption's replacement: `exit now` written, and the next launch waits for the process to be gone.
    function replaceLater(socket: Socket, proc: Proc): void {
      attemptSockets.delete(socket);
      socket.end(`${JSON.stringify({ t: 'exit', when: 'now' } satisfies ClientExit)}\n`);
      socket.setTimeout(timing.helloTimeoutMs, () => socket.destroy());
      awaitDeath = proc;
      giveUp(`asked pid ${proc.pid}, of another build with nothing live, to exit`);
    }

    function connect(path: string, onConnected: (socket: Socket) => void, onRefused: () => void): void {
      // P5 O2 M3: the socket and its directory are checked first; a path that does not exist is nothing listening
      try {
        assertPrivateSocket(path);
      } catch (error) {
        if (error instanceof PrivatePathError) return unreachable(error);
        return onRefused();
      }
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
        logFd = fs.openSync(join(dir, files.log), 'a', 0o600);
        fs.fchmodSync(logFd, 0o600);
        // `--disable-sigusr1`: a same-user SIGUSR1 opens no Node inspector in the supervisor from exec on, before its
        // entry's listener runs (cua spec 2026-10-09-maws-socket-peer-auth-design.md, Decision Log 2026-10-10)
        const how =
          strategy?.kind === 'spawn'
            ? strategy
            : {
                command: process.execPath,
                args: ['--disable-sigusr1', options.modulePath, '--detached', dir],
                env: supervisorEnv(options.env?.() ?? process.env, { userData: options.userData(), packaged: options.packaged() }),
                argv0: 'maws-supervisor',
              };
        const child = spawn(how.command, how.args, {
          detached: true, // its own session and process group: no terminal's SIGHUP or app exit reaches it
          stdio: ['ignore', logFd, logFd], // not connected to main, so it outlives main
          env: how.env,
          cwd: process.cwd(),
          argv0: how.argv0,
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
        identity.startedOwn(); // what this run starts is of its build
        log(`spawned a supervisor, pid ${pid}`);
        return { pid, procStart: processes.procStartOf(pid) ?? '' };
      } catch (error) {
        log(`the supervisor could not be spawned: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      } finally {
        if (logFd !== null) fs.closeSync(logFd);
      }
    }

    function readAnswer(socket: Socket, form: Form, onAnswer: (answer: Answer) => void): void {
      let answered: Answer | null = null;
      let done = false;
      const splitter = splitLines(
        (line) => {
          answered = parseAnswer(line, form, form === 'v2' ? SOCKET_PROTOCOL_V2 : identity.major(), logDropped);
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
  // `otherBuild`: a supervisor of another build still running sessions, asked to exit when idle unless already asked.
  // `updatePending` (P5 O16 M3c fix wave 2): one of another build that hands over, told to the host supervisor.
  function serve(socket: Socket, leftover: Buffer, proc: Proc, welcome: Welcomed, otherBuild: boolean, updatePending = false): void {
    const port = new SocketPort(socket, leftover, { log: (line) => log(`socket: ${line}`), ptyFrames: welcome.peer.capabilities.includes(PTY_FRAMES_CAPABILITY) }); // P5 O2 M4: the welcome's capability gate, as the server's
    if (idleArmed && !(idleArmed.pid === proc.pid && idleArmed.procStart === proc.procStart)) idleArmed = null;
    const connection: Served = { port, proc, exitAsked: idleArmed ? 'idle' : null, handovers: new Map(), replaced: false, recycled: null };
    served = connection;
    unserved = null;
    waitingFor = null;
    if (otherBuild && connection.exitAsked === null) {
      log(`supervisor pid ${welcome.pid} runs build ${welcome.peer.build} with ${welcome.liveSessions} sessions live; serving it until they are idle`);
      askExit(connection, 'idle');
    }
    if (updatePending) log(`supervisor pid ${welcome.pid} runs build ${welcome.peer.build} with ${welcome.liveSessions} sessions live; serving it until its calls are quiet, then asking it to hand them over`);
    const listeners: ((data: unknown) => void)[] = [];
    port.on('message', ({ data }) => {
      const refuse = readTolerant(ServerRefuseSchema, data);
      if (refuse.ok) {
        logDropped('socket refuse', refuse.dropped);
        if (refuse.value.reason === 'replaced') connection.replaced = true;
        return;
      }
      if (routeHandoverAnswer(connection.handovers, data)) return; // P5 O16 M3b: the transport's own ask
      for (const listener of listeners) listener(data);
    });
    port.onClose(() => closed(connection));
    const { peer } = welcome;
    log(`connected to supervisor pid ${welcome.pid} build ${peer.build} wire ${peer.major}.${peer.minor} capabilities [${peer.capabilities.join(', ')}] (${welcome.liveSessions} live of ${welcome.rows} rows)`);
    events.connected(
      {
        postMessage: (message) => void port.postMessage(message),
        close: () => port.close(),
        onMessage: (listener) => void listeners.push(listener),
        postDoc: (channel, frame) => port.postDoc(channel, frame), // P3-A M5
        onDoc: (listener) => port.onDoc(listener), // P3-A M5
      },
      welcome,
      { updatePending },
    );
    port.start();
  }

  function closed(connection: Served): void {
    failHandoverAsks(connection.handovers, connection.exitAsked === 'replace'); // P5 O16 M3b
    if (served !== connection) return;
    served = null;
    if (stopped) return;
    if (quitting) {
      stopped = true; // the quit's stop-all ended the supervisor, or it closed first: either way nothing follows
      return events.disconnected();
    }
    // P5 O2 M3: a recycle's drain has ended: a fresh attempt at once, with nothing reported. P5 O2 M5: unless the host
    // was asked to exit now (a stop-all, `exit now`): its close stays deliberate, so an on-demand host parks
    if (connection.recycled) {
      connection.recycled();
      if (connection.exitAsked === null || connection.replaced) return launch();
      // armed to exit when idle: reconnected while the process still runs (it may be working yet); once it has exited
      // (looked at one poll later, as below), that was the idle exit asked for, and no successor starts
      if (connection.exitAsked === 'idle') {
        return after(timing.pidPollMs, () => {
          if ((spawned.get(connection.proc.pid) ?? null) === null && sameProcess(connection.proc)) return launch();
          events.lost('deliberate');
        });
      }
    }
    if (connection.replaced) {
      log(`another client replaced this app at supervisor pid ${connection.proc.pid}`);
      return events.lost('replaced');
    }
    if (connection.exitAsked === 'now') {
      awaitDeath = connection.proc;
      return events.lost('deliberate');
    }
    // P5 O16 M3b (D40): a host asked to hand over: its successor is spawned once it is gone, never parked
    if (connection.exitAsked === 'replace') {
      log(`supervisor pid ${connection.proc.pid} closed its connection after handing over; starting its successor`);
      awaitDeath = connection.proc;
      return events.lost('replace');
    }
    unserved = connection.proc;
    events.disconnected();
    // A supervisor that died closes its socket before its pid is gone (a process still exiting, or a child not yet
    // reaped), so the pid is looked at one poll later. P5 O16 M3b (#413): one asked to exit when idle is looked at again
    // every poll until it is gone, within `exitWaitMs`, so a slow exit is not read as a quiet close and relaunched.
    const until = Date.now() + timing.exitWaitMs;
    const look = () => {
      const exit = spawned.get(connection.proc.pid) ?? null;
      if (exit === null && sameProcess(connection.proc)) {
        if (connection.exitAsked === 'idle' && Date.now() < until) return after(timing.pidPollMs, look);
        log(`the connection to supervisor pid ${connection.proc.pid} closed; it still runs`);
        return events.lost('quiet');
      }
      if (connection.exitAsked === 'idle') return events.lost('deliberate'); // it exited when idle, as asked
      log(`supervisor pid ${connection.proc.pid} is gone`);
      events.lost({ crash: exit ?? { code: null, signal: null } });
    };
    after(timing.pidPollMs, look);
  }

  // P5 O16 M3b: `host.handover` on a port, answered through `answers` (routeHandoverAnswer, from the port's messages);
  // failed when no answer comes within its grace and HANDOVER_SLACK_MS, or the port closes first.
  function askHandover(port: SocketPort, answers: Map<string, (data: unknown) => void>, graceMs: number): Promise<HandoverAnswer> {
    const id = `transport-handover-${++handoverAsks}`;
    return new Promise((resolve) => {
      const settle = (answer: HandoverAnswer) => {
        clearTimeout(timer);
        answers.delete(id);
        resolve(answer);
      };
      const timer = setTimeout(() => settle({ state: 'failed', why: `no answer within ${(graceMs + HANDOVER_SLACK_MS) / 1000} s` }), graceMs + HANDOVER_SLACK_MS);
      answers.set(id, (data) => settle(readHandoverAnswer(data)));
      const request: HostRequest = { t: 'req', id, name: 'host.handover', input: { graceMs } };
      if (!port.postMessage(request)) settle({ state: 'failed', why: 'the socket refused the request' });
    });
  }

  // A served host's deferral, asked again every WAIT_RETRY_MS while it is still the one served and marked for its
  // replacement (its exit, once the drain settles, needs no ask: the first armed it).
  function askAgain(connection: Served): void {
    after(timing.waitRetryMs, () => {
      if (served !== connection || connection.exitAsked !== 'replace') return;
      void askHandover(connection.port, connection.handovers, 0).then((answer) => {
        if (answer.state !== 'deferred') return;
        log(`engine host pid ${connection.proc.pid} defers its handover: ${answer.inFlight} calls in flight`);
        askAgain(connection);
      });
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

  // The quit with nothing served: the supervisor whose connection closed quietly still runs the sessions the owner
  // chose to stop, so it is sent SIGTERM (its exit order stops every row), once the lock still names that process.
  function stopUnserved(): void {
    const proc = unserved;
    unserved = null;
    if (!proc) return;
    const lock = lockOf(filesOf());
    if (!lock || lock.pid !== proc.pid || !sameProcess(lock) || !sameProcess(proc)) return;
    log(`stopping supervisor pid ${proc.pid} for the quit: its connection closed and it still runs`);
    signal(proc.pid, 'SIGTERM');
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

  // Remembered only once written: an exit the socket refused was never asked, and the next close is not deliberate.
  // P5 O16 M3b: an idle exit asked of a host handing over (the park clock's) leaves its close the replacement's.
  function askExit(connection: Served, when: ClientExit['when']): boolean {
    if (!connection.port.postMessage({ t: 'exit', when } satisfies ClientExit)) return false;
    if (connection.exitAsked !== 'now' && !(connection.exitAsked === 'replace' && when === 'idle')) connection.exitAsked = when;
    if (when === 'idle') idleArmed = connection.proc;
    log(`asked supervisor pid ${connection.proc.pid} to exit ${when}`);
    return true;
  }

  return {
    launch: () => launch(),
    exit(when) {
      if (!served || stopped) return false;
      return askExit(served, when);
    },
    // E10 start
    replaceIncompatible: () => launch(true),
    expectExit(kind = 'now') {
      if (!served || stopped) return false;
      if (kind === 'now') {
        served.exitAsked = 'now';
        log(`supervisor pid ${served.proc.pid} is asked to stop all and exit`);
      } else if (served.exitAsked !== 'now') served.exitAsked = 'replace'; // P5 O16 M3b
      return true;
    },
    // P5 O16 M3b
    handover(graceMs, sent = () => Promise.resolve()) {
      if (!served || stopped || quitting) return Promise.resolve({ state: 'failed', why: 'nothing is served' });
      const connection = served;
      const before = connection.exitAsked;
      if (connection.exitAsked !== 'now') connection.exitAsked = 'replace';
      const ask = (): Promise<HandoverAnswer> => {
        if (served !== connection) return Promise.resolve({ state: 'detaching' }); // it closed meanwhile: its successor follows
        log(`asking supervisor pid ${connection.proc.pid} to hand its sessions over`);
        return askHandover(connection.port, connection.handovers, graceMs);
      };
      return sent().then(ask).then((answer) => {
        if (answer.state === 'failed') {
          if (connection.exitAsked === 'replace') connection.exitAsked = before;
          log(`supervisor pid ${connection.proc.pid} did not hand over: ${answer.why}`);
        } else if (answer.state === 'deferred') {
          log(`engine host pid ${connection.proc.pid} defers its handover: ${answer.inFlight} calls in flight`);
          askAgain(connection);
        } else log(`supervisor pid ${connection.proc.pid} is handing its sessions over; its successor follows its exit`);
        return answer;
      });
    },
    quit() {
      if (stopped) return false;
      quitting = true;
      cancelAttempt();
      if (served) return true;
      stopped = true;
      stopUnserved();
      return false;
    },
    async killHeld() {
      if (stopped || quitting) return false;
      const lock = lockOf(filesOf());
      if (!lock || !sameProcess(lock) || (served && served.proc.pid === lock.pid)) return false;
      const proc: Proc = { pid: lock.pid, procStart: lock.procStart };
      log(`stopping the supervisor that holds the lock and does not answer (pid ${proc.pid})`);
      if (!signal(proc.pid, 'SIGTERM') || (await goneWithin(proc, timing.killGraceMs))) return true;
      if (sameProcess(proc)) signal(proc.pid, 'SIGKILL'); // checked again: the pid is not reused meanwhile
      if (!(await goneWithin(proc, timing.startTimeoutMs))) log(`supervisor pid ${proc.pid} is still running after SIGKILL`);
      return true;
    },
    // E10 end
    // P5 O2 M3 start
    recycle(drained) {
      if (!served || stopped || quitting || served.recycled) return false;
      const connection = served;
      connection.recycled = drained;
      log(`recycling the connection to pid ${connection.proc.pid}`);
      connection.port.close({ drain: true });
      return true;
    },
    adopt() {
      if (served) return Promise.resolve(true);
      return new Promise((resolve) => launch(false, resolve));
    },
    // P5 O2 M3 end
    expectIdleExit() {
      if (!served || stopped) return false;
      if (served.exitAsked !== 'now' && served.exitAsked !== 'replace') served.exitAsked = 'idle';
      idleArmed = served.proc;
      log(`supervisor pid ${served.proc.pid} is armed to exit when idle`);
      return true;
    },
    disarmIdle() {
      if (!served || stopped) return false;
      idleArmed = null;
      if (served.exitAsked === 'idle') served.exitAsked = null;
      log(`supervisor pid ${served.proc.pid} is no longer asked to exit when idle`);
      return true;
    },
    stop() {
      if (stopped) return undefined;
      stopped = true;
      cancelAttempt();
      const connection = served;
      served = null;
      if (!connection) return undefined;
      const drained = new Promise<void>((resolve) => connection.port.onClose(() => resolve())); // E11
      connection.port.close({ drain: true }); // no `exit`: the supervisor keeps serving its sessions; what it wrote before it saw the end is still read (E11)
      return drained;
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


// P5 O16 M3b: the default grace a handover's ask names (the host's own default too); M3c fix wave 2: the host
// supervisor's quiet ask names it too
export const HANDOVER_GRACE_MS = 10_000;

// P5 O16 M3b: a `res` naming one of `answers`' ids is handed to it (true); anything else is not this ask's (false).
function routeHandoverAnswer(answers: Map<string, (data: unknown) => void>, data: unknown): boolean {
  const record = typeof data === 'object' && data !== null ? (data as { t?: unknown; id?: unknown }) : null;
  if (record?.t !== 'res' || typeof record.id !== 'string') return false;
  const take = answers.get(record.id);
  if (!take) return false;
  take(data);
  return true;
}

// A link's close with asks unanswered: under a replacement's mark (`replaced`), the close is the replacement's, and the
// successor follows it whatever the host did first (a park's idle exit, a crash), so each ask reads `detaching`.
function failHandoverAsks(answers: Map<string, (data: unknown) => void>, replaced = false): void {
  const answer = replaced ? { t: 'res', ok: true, value: { state: 'detaching' } } : { t: 'res', ok: false, error: { message: 'the connection closed before it answered' } };
  for (const take of [...answers.values()]) take(answer);
}

// `host.handover`'s answer, read loosely: its two states, else what failed.
function readHandoverAnswer(data: unknown): HandoverAnswer {
  const res = data as { ok?: unknown; value?: { state?: unknown; inFlight?: unknown; tool?: unknown }; error?: { message?: unknown } };
  if (res.ok !== true) return { state: 'failed', why: typeof res.error?.message === 'string' ? res.error.message : 'an error answer' };
  if (res.value?.state === 'detaching') return { state: 'detaching' };
  if (res.value?.state === 'deferred' && typeof res.value.inFlight === 'number') return { state: 'deferred', inFlight: res.value.inFlight, ...(typeof res.value.tool === 'string' && { tool: res.value.tool }) };
  return { state: 'failed', why: 'an answer that is neither detaching nor deferred' };
}

// P5 O1 M6: a welcome in the hello's own form and of its major (`major`), read tolerantly.
function parseAnswer(line: string, form: Form, major: number, logDropped: (message: string, dropped: readonly string[]) => void): Answer {
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    return { kind: 'failed', why: 'an answer that is not JSON' };
  }
  const welcome = (welcomed: Welcomed): Answer =>
    welcomed.peer.major === major ? { kind: 'welcome', welcome: welcomed, leftover: Buffer.alloc(0) } : { kind: 'failed', why: `a welcome of protocol ${welcomed.peer.major} to a hello of ${major}` };
  if (form === 'v2') {
    const v2 = readTolerant(ServerWelcomeV2Schema, data);
    if (v2.ok) {
      logDropped('socket v2.welcome', v2.dropped);
      const { pid, liveSessions, rows, protocol, buildId } = v2.value;
      return welcome({ pid, liveSessions, rows, peer: { major: protocol, minor: 0, build: buildId, capabilities: [] } });
    }
  } else {
    const current = readTolerant(ServerWelcomeSchema, data);
    if (current.ok) {
      logDropped('socket welcome', current.dropped);
      const { pid, liveSessions, rows, protocol, minor, build, capabilities } = current.value;
      return welcome({ pid, liveSessions, rows, peer: { major: protocol, minor, build, capabilities } });
    }
  }
  const refuse = readTolerant(ServerRefuseSchema, data);
  if (refuse.ok) {
    logDropped('socket refuse', refuse.dropped);
    return { kind: 'refuse', refuse: refuse.value };
  }
  return { kind: 'failed', why: 'an answer that is neither welcome nor refuse' };
}
