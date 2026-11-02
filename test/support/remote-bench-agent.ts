// The live bench's agent on a bench machine (P5 O7 M7, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M7's
// "The live bench" and its Decision Log entries of 2026-11-02): bundled to CommonJS on the MacBook by the live mode
// (e2e/remote-latency-live.spec.ts), copied under the scratch profile by the runner (test/support/remote-bench.ts) and
// run there under the production mawsd's node runtime, which it only reads. Three commands, each given one JSON word of
// `AgentArgs`:
//
//   prepare  the latency stub's wrapper (`<bench>/latency-engine`, the stub from M7's head checkout and its samples file
//            under the bench directory), the scratch engine store's trust of the bench checkout, and the scratch
//            daemon's home, temporary and sminos directories, so nothing the daemon or its engines write leaves the
//            profile;
//   serve    the stub's session started over the scratch daemon's machine.sock (one turn, the history the open shows),
//            `{ready}` printed; on a `{list}` line from stdin, the harness's fake sminos on the scratch RL10 socket
//            (`<profile>/mawsd/endpoint/rl10.json`, never SMINOS_RL10, never a real sminos) lists it for the owners
//            named, `{listed}` printed; on a `{turn}` line, the session sent that turn (the live resume's turn, written
//            while the app's link is held down), `{sent}` printed; every delta the stub writes printed as `{sample}`. It
//            ends when its transport does: stdin's end or its parent's loss cancels a start still running, waits for it
//            and for any input in hand, stops the session (recorded once it is created, so a start cut short at any step
//            still stops it), closes the fake sminos and ends any stub of this bench still running (killed when it
//            outlives that, then checked), then exits;
//   stop-hosts  the scratch daemon's engine host and pty host, as their own locks name them, told to exit now through
//            their own sockets under the profile (the hello with the host's token, its answer, `{t: 'exit', when: 'now'}`),
//            each waited for; `{hostsLeft}` printed, exit 1 when one is left (the runner then ends it by its pid and start
//            time, and checks).
//
// Every path it writes or opens is under the scratch profile (`agentPaths`), except the head checkout's stub, which it
// names for the wrapper and never opens, and the node runtime it runs on. It starts no `claude` (the daemon runs under
// MAWS_E2E, whose engine is MAWS_E2E_ENGINE_BIN and nothing else) and no sminos.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync, fstatSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { daemonPaths } from '@shared/daemon/files';
import { connect } from 'node:net';
import { reachMachine } from '../../src/mawsd/machine-client';
import { isAlive, isSameProcess, procStartOf, readLock } from '../../src/engine-host/supervisor-files';
import { SOCKET_PROTOCOL } from '@shared/host/socket-protocol';
import { WIRE_MINOR } from '@shared/ipc/wire';
import { goneFrame, helloFrame, memberFrame, projectFrames, restatedFrame } from './sminos-frames';

export interface AgentArgs {
  name: string;
  profile: string;
  bench: string;
  head: string;
  /** the version the stub answers `--version` with (test/support/engine-pin's FIXTURE_ENGINE_VERSION, which this module
   * never imports: importing it runs the installed engine's `--version`) */
  engineVersion: string;
  /** serve's absolute deadline (this Mac's epoch ms): the agent ends itself, its cleanup done, AGENT_CLEANUP_MS before it */
  deadline?: number;
}

/** How long before its deadline the agent begins its end, so its cleanup is done by then. */
export const AGENT_CLEANUP_MS = 60_000;

export const BENCH_PROJECT = 'maws-remote-bench'; // sminos's project id for the bench checkout
export const FIRST_PROMPT = 'latency bench turn 1';
const MARKERS_PER_TURN = 300; // the stub's (test/support/local-latency.ts's BENCH.markersPerTurn)
const TURN_MS = 60_000;

export function parseAgentArgs(word: string | undefined): AgentArgs {
  const parsed = JSON.parse(word ?? 'null') as Partial<AgentArgs> | null;
  const { name, profile, bench, head, engineVersion, deadline } = parsed ?? {};
  if (typeof name !== 'string' || typeof profile !== 'string' || typeof bench !== 'string' || typeof head !== 'string' || typeof engineVersion !== 'string') throw new Error('the agent takes one JSON word {name, profile, bench, head, engineVersion}');
  if (!/^\d+\.\d+\.\d+$/.test(engineVersion)) throw new Error(`${engineVersion} is not an engine version`);
  for (const path of [profile, bench, head]) if (!isAbsolute(path)) throw new Error(`${path} is not absolute`);
  if (bench !== `${profile}/bench`) throw new Error('the bench directory is the profile’s own');
  if (deadline !== undefined && !Number.isSafeInteger(deadline)) throw new Error('the deadline is an epoch in milliseconds');
  return { name, profile, bench, head, engineVersion, ...(deadline === undefined ? {} : { deadline }) };
}

/** Everything the agent and the daemon it serves write or open, each under the scratch profile; `stub` is only named. */
export function agentPaths(a: AgentArgs) {
  return {
    engine: `${a.bench}/latency-engine`,
    samples: `${a.bench}/samples.jsonl`,
    checkout: `${a.bench}/checkout`,
    claudeConfig: `${a.profile}/claude-config`,
    rl10: `${a.profile}/mawsd/endpoint/rl10.json`,
    home: `${a.profile}/home`,
    tmp: `${a.profile}/tmp`,
    sminosHome: `${a.profile}/sminos`,
    shellHome: `${a.profile}/shell-home`,
    claudeUsage: `${a.profile}/claude-usage`,
    stub: `${a.head}/test/support/latency-engine-stub.mjs`,
  };
}

const quote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

/** A file written under a fresh name (exclusive: never an existing one, a symlink included) and renamed into place, so no symlink at `path` is followed. */
function writeFresh(path: string, content: string, mode = 0o644): void {
  const fresh = `${path}.tmp-${process.pid}`;
  writeFileSync(fresh, content, { mode, flag: 'wx' });
  renameSync(fresh, path);
}

/**
 * The stub's wrapper, the store's trust and the daemon's directories; `node` is the runtime the wrapper runs the stub
 * on, an Electron run as Node as production runs its mawsd when `electron` (the mini's MAWS binary).
 */
export function prepare(a: AgentArgs, node: string, electron: boolean): void {
  const p = agentPaths(a);
  for (const dir of [a.bench, p.checkout, p.claudeConfig, p.home, p.tmp, p.sminosHome, p.shellHome, p.claudeUsage]) mkdirSync(dir, { recursive: true, mode: 0o700 });
  // the runner checked the profile's path before it wrote; what this writes goes through no symlink either
  for (const dir of [a.profile, a.bench, p.claudeConfig, p.shellHome]) if (realpathSync(dir) !== dir) throw new Error(`${dir} goes through a symlink (it is ${realpathSync(dir)}): nothing is written`);
  writeFresh(p.engine, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 MAWS_LATENCY_STUB_VERSION=${quote(a.engineVersion)} exec ${quote(node)}${electron ? ' --disable-sigusr1' : ''} ${quote(p.stub)} ${quote(p.samples)} "$@"\n`, 0o755);
  writeFresh(`${p.claudeConfig}/.claude.json`, `${JSON.stringify({ projects: { [p.checkout]: { hasTrustDialogAccepted: true } } }, null, 2)}\n`);
  writeFresh(`${p.claudeConfig}/settings.json`, `${JSON.stringify({ permissions: { defaultMode: 'default' } })}\n`);
  // the login shell the daemon's hosts capture reads its startup files here (test/support/shell-home.ts's pattern)
  for (const name of ['.zprofile', '.bash_profile']) writeFresh(`${p.shellHome}/${name}`, '');
}

// --- serve ---------------------------------------------------------------------------------------------------------------

export interface MachineClient {
  request<T>(name: string, input?: unknown, timeoutMs?: number): Promise<T>;
  close(): void;
}
export interface SminosLine {
  send(frame: object): void;
  close(): void;
}
export interface ServeDeps {
  machine(): Promise<MachineClient>;
  /** The fake sminos's connection to the scratch RL10 socket `info` names, welcomed. */
  sminos(info: { socket: string; token: string }): Promise<SminosLine>;
  readFile(path: string): string;
  /** One line to the bench, on stdout. */
  out(message: object): void;
  /** Ends every stub of this bench still running (its samples path in its arguments), by SIGTERM or SIGKILL. */
  endStubs(samples: string, signal?: 'SIGTERM' | 'SIGKILL'): void;
  /** How many stubs of this bench still run. */
  stubsLeft(samples: string): number;
  sleep(ms: number): Promise<void>;
  /** Calls `onLine` with each complete line appended to `path` from its start, until the returned stop. */
  tail(path: string, onLine: (line: string) => void): () => void;
}

type Status = { process: string; turn: unknown; engineSessionId: string | null };

/** The bench agent's `serve`: its session, its listing, its samples, and its end with its transport. */
export class BenchAgent {
  readonly #a: AgentArgs;
  readonly #deps: ServeDeps;
  #machine: MachineClient | null = null;
  #sminos: SminosLine | null = null;
  #stopTail: (() => void) | null = null;
  /** recorded as soon as the session is created, its engine id once the first turn names it */
  #session: { app: string; engine: string | null } | null = null;
  #starting: Promise<void> | null = null;
  readonly #inputs = new Set<Promise<void>>();
  #cancelled = false;
  #ended: Promise<void> | null = null;

  constructor(a: AgentArgs, deps: ServeDeps) {
    this.#a = a;
    this.#deps = deps;
  }

  /** The stub's session started over machine.sock and its first turn over; `{ready}` printed; the samples tailed. Once. */
  start(): Promise<void> {
    this.#starting ??= this.#start();
    return this.#starting;
  }

  /** Throws once the agent is ending: a start still running stops at its next step. */
  #live(): void {
    if (this.#cancelled) throw new Error('the bench agent is ending: its start is cancelled');
  }

  async #start(): Promise<void> {
    const p = agentPaths(this.#a);
    this.#live();
    const machine = (this.#machine = await this.#deps.machine());
    this.#live();
    await machine.request('session.list', {}, 120_000); // loads the spine and wakes the engine host
    this.#live();
    const { ref } = await machine.request<{ ref: string }>('machine.identity');
    this.#live();
    await machine.request('machineSettings.set', { patch: { gateway: { defaultRoute: 'direct' } } });
    this.#live();
    const project = await machine.request<{ id: string }>('session.projects.add', { directory: p.checkout });
    this.#live();
    const { appSessionId: app } = await machine.request<{ appSessionId: string }>('session.create', { projectId: project.id, location: null });
    const session: { app: string; engine: string | null } = { app, engine: null };
    this.#session = session; // before anything else can fail: the end stops it from here on
    this.#live();
    await machine.request('session.intent.patch', { appSessionId: app, patch: { gateway: 'direct' } });
    this.#live();
    const before = this.#written().length;
    const at = Date.now();
    const started = await machine.request<{ status: string }>('session.start', { appSessionId: app, message: { content: FIRST_PROMPT, display: FIRST_PROMPT }, options: {} });
    if (started.status === 'needs_trust') throw new Error('the scratch engine store does not trust the bench checkout (run prepare first)');
    let engineStartMs: number | null = null;
    for (const deadline = Date.now() + TURN_MS; ; ) {
      this.#live();
      const status = await machine.request<Status>('session.status', { appSessionId: app }).catch(() => null);
      if (status?.engineSessionId) session.engine = status.engineSessionId;
      if (status?.process === 'ready') engineStartMs ??= Date.now() - at;
      if (status?.process === 'ready' && status.turn === null && this.#written().length >= before + MARKERS_PER_TURN) break;
      if (Date.now() > deadline) throw new Error('the bench session’s first turn did not end within 60 s');
      await this.#deps.sleep(25);
    }
    this.#live();
    const engine = session.engine;
    if (engine === null) throw new Error('the bench session has no engine session id');
    this.#deps.out({ ready: { ref, app, engine, engineStartMs } });
    this.#stopTail = this.#deps.tail(p.samples, (line) => {
      try {
        this.#deps.out({ sample: JSON.parse(line) as unknown });
      } catch {
        // a line the stub is still writing is read whole on the next pass
      }
    });
  }

  #written(): string[] {
    try {
      return this.#deps.readFile(agentPaths(this.#a).samples).split('\n').filter(Boolean);
    } catch {
      return []; // none written yet
    }
  }

  /**
   * One line from the bench: `{list: {owners, title}}` lists the session through the fake sminos; `{turn: {content}}`
   * sends the session that turn. Each is waited for by the end.
   */
  input(line: string): Promise<void> {
    const handled = this.#input(line);
    this.#inputs.add(handled);
    void handled.finally(() => this.#inputs.delete(handled)).catch(() => undefined);
    return handled;
  }

  async #input(line: string): Promise<void> {
    if (this.#cancelled) throw new Error('the bench agent is ending');
    const message = JSON.parse(line) as { list?: { owners: string[]; title: string }; turn?: { content: string } };
    const session = this.#session;
    if (message.turn !== undefined) {
      if (session?.engine == null || this.#machine === null) throw new Error('the bench session is not started');
      await this.#machine.request('session.send', { appSessionId: session.app, content: message.turn.content });
      this.#deps.out({ sent: { app: session.app } });
      return;
    }
    if (message.list === undefined) return;
    if (session?.engine == null || this.#machine === null) throw new Error('the bench session is not started');
    const engine = session.engine;
    const p = agentPaths(this.#a);
    const info = JSON.parse(this.#deps.readFile(p.rl10)) as { socket: string; token: string };
    if (!info.socket.startsWith(`${this.#a.profile}/`) && !info.socket.startsWith(`${agentPaths(this.#a).tmp}/`)) throw new Error('the RL10 socket is not the scratch profile’s');
    const sminos = (this.#sminos = await this.#deps.sminos(info));
    for (const frame of projectFrames(BENCH_PROJECT, this.#a.name, [p.checkout])) sminos.send(frame);
    for (const deadline = Date.now() + 30_000; ; ) {
      const live = await this.#machine.request<{ appSessionId: string; engineSessionId: string | null }[]>('engine.sessions');
      if (live.some((s) => s.appSessionId === session.app && s.engineSessionId === engine)) break;
      if (Date.now() > deadline) throw new Error('the engine host does not run the bench session');
      await this.#deps.sleep(100);
    }
    sminos.send(memberFrame(BENCH_PROJECT, { engine, alias: session.app, title: message.list.title, cwd: p.checkout, owners: message.list.owners }));
    this.#deps.out({ listed: { app: session.app } });
  }

  /**
   * The agent's end, once whatever asks: a start still running cancelled and waited for, with every input in hand; the
   * tail stopped, the listing withdrawn, the session stopped (whatever step its start reached once it was created), every
   * stub ended, killed if one outlives that, and checked. Throws when a stub is left even then.
   */
  end(): Promise<void> {
    this.#ended ??= (async () => {
      this.#cancelled = true;
      await Promise.allSettled([this.#starting, ...this.#inputs]);
      this.#stopTail?.();
      const session = this.#session;
      if (this.#sminos !== null) {
        if (session?.engine != null) this.#sminos.send(goneFrame(session.engine));
        this.#sminos.close();
      }
      if (session !== null && this.#machine !== null) await this.#machine.request('session.stop', { appSessionId: session.app, reason: 'stop' }, 10_000).catch(() => undefined);
      const samples = agentPaths(this.#a).samples;
      this.#deps.endStubs(samples);
      this.#machine?.close();
      for (let i = 0; i < 10 && this.#deps.stubsLeft(samples) > 0; i += 1) await this.#deps.sleep(200);
      if (this.#deps.stubsLeft(samples) > 0) {
        this.#deps.endStubs(samples, 'SIGKILL');
        await this.#deps.sleep(200);
        const left = this.#deps.stubsLeft(samples);
        if (left > 0) throw new Error(`${left} stub${left === 1 ? '' : 's'} of the bench still run after SIGKILL`);
      }
    })();
    return this.#ended;
  }
}

/** Binds the agent's life to its transport: stdin's end, or its parent's loss (the ssh gone), ends it. */
export function bindLifetime(agent: { end(): Promise<void>; input(line: string): Promise<void> }, io: {
  stdin: NodeJS.EventEmitter;
  parent(): number;
  every(ms: number, run: () => void): () => void;
  exit(code: number): void;
  error(message: string): void;
  /** serve's absolute deadline, with the clock and timer it is kept by */
  deadline?: number;
  now?(): number;
  after?(ms: number, run: () => void): () => void;
}): void {
  const parent = io.parent();
  let buffer = '';
  let stopWatch = () => {};
  let finished = false;
  const finish = (code: number) => {
    if (finished) return;
    finished = true;
    stopWatch();
    agent.end().then(
      () => io.exit(code),
      (error: unknown) => {
        io.error(`end failed: ${(error as Error).message}`);
        io.exit(1);
      },
    );
  };
  io.stdin.on('data', (chunk: Buffer | string) => {
    buffer += chunk.toString();
    for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (line) void agent.input(line).catch((error: unknown) => {
        io.error(`input failed: ${(error as Error).message}`);
        finish(1);
      });
    }
  });
  io.stdin.on('end', () => finish(0));
  io.stdin.on('close', () => finish(0));
  const stopParent = io.every(1_000, () => {
    if (io.parent() !== parent) finish(0);
  });
  // the deadline: the end begun AGENT_CLEANUP_MS ahead of it, so the cleanup is done and the agent gone by then
  const stopDeadline = io.deadline === undefined || io.after === undefined ? () => undefined : io.after(Math.max(0, io.deadline - (io.now ?? Date.now)() - AGENT_CLEANUP_MS), () => {
    io.error('the serve’s deadline is near: ending');
    finish(0);
  });
  stopWatch = () => {
    stopParent();
    stopDeadline();
  };
}

// --- stop-hosts ----------------------------------------------------------------------------------------------------------

/** A detached host of the scratch daemon's as its lock names it (src/engine-host/supervisor-files.ts's LockFile). */
export interface HostLock {
  pid: number;
  procStart: string;
  socketPath: string;
}
export interface StopHostsDeps {
  lock(dir: string): HostLock | null;
  token(dir: string): string;
  /** whether the lock's process is still that process: its pid alive with the start it recorded */
  alive(lock: HostLock): boolean;
  askExit(socket: string, token: string): Promise<void>;
  sleep(ms: number): Promise<void>;
}

/** The scratch daemon's detached hosts, each in its own directory under the profile (its lock, token and socket there). */
export const scratchHosts = (a: AgentArgs) => [
  { name: 'the engine host', dir: `${a.profile}/supervisor` },
  { name: 'the pty host', dir: `${a.profile}/mawsd/pty-host` },
];
const HOST_EXIT_MS = 20_000;

/**
 * Each host its lock names still running told to exit now through its own socket, and waited for up to `waitMs`; a lock
 * whose socket is not under the profile is never connected to. The names of those still running.
 */
export async function stopHosts(a: AgentArgs, deps: StopHostsDeps, waitMs = HOST_EXIT_MS): Promise<string[]> {
  const asked: { name: string; lock: HostLock }[] = [];
  const left: string[] = [];
  for (const { name, dir } of scratchHosts(a)) {
    const lock = deps.lock(dir);
    if (lock === null || !deps.alive(lock)) continue;
    if (!lock.socketPath.startsWith(`${a.profile}/`)) {
      left.push(name);
      continue;
    }
    try {
      await deps.askExit(lock.socketPath, deps.token(dir));
      asked.push({ name, lock });
    } catch {
      left.push(name); // unreachable, or its token refused: the runner's reap decides
    }
  }
  for (const until = Date.now() + waitMs; asked.some(({ lock }) => deps.alive(lock)) && Date.now() < until; ) await deps.sleep(100);
  for (const { name, lock } of asked) if (deps.alive(lock)) left.push(name);
  return scratchHosts(a).map((host) => host.name).filter((name) => left.includes(name));
}

/**
 * A host told to exit now through its socket: the hello with its token, its answer waited for (a welcome, or a refusal
 * of the wire, after which the host still honours one exit), then `{t: 'exit', when: 'now'}`, resolved once it is written
 * (the host's exit is the caller's to wait for). A refused token rejects.
 */
export function askExit(socket: string, token: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const connection = connect(socket);
    let buffer = '';
    let answered = false;
    const deadline = setTimeout(() => {
      connection.destroy();
      reject(new Error(`no answer on ${socket} within 10 s`));
    }, 10_000);
    connection.on('error', (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    connection.on('close', () => {
      clearTimeout(deadline);
      if (!answered) reject(new Error(`${socket} closed before its answer`));
    });
    connection.once('connect', () => void connection.write(`${JSON.stringify({ t: 'hello', protocol: SOCKET_PROTOCOL, token, minor: WIRE_MINOR, build: 'remote-bench-agent', capabilities: [], appPid: process.pid })}\n`));
    connection.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const at = buffer.indexOf('\n');
      if (answered || at < 0) return;
      const answer = JSON.parse(buffer.slice(0, at)) as { t?: string; reason?: string };
      if (answer.t === 'refuse' && answer.reason === 'token') {
        clearTimeout(deadline);
        connection.destroy();
        return reject(new Error(`${socket} refused its token`));
      }
      answered = true;
      connection.end(`${JSON.stringify({ t: 'exit', when: 'now' })}\n`, () => {
        clearTimeout(deadline);
        resolve();
      });
    });
  });
}

/** stop-hosts' deps over the hosts' own files and this machine's processes. */
export function hostDeps(): StopHostsDeps {
  return {
    lock: (dir) => readLock(dir),
    token: (dir) => readFileSync(`${dir}/host.token`, 'utf8').trim(),
    alive: (lock) => isSameProcess(lock, { isAlive, procStartOf }),
    askExit,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

// --- the process ---------------------------------------------------------------------------------------------------------

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function tailFile(path: string, onLine: (line: string) => void): () => void {
  let offset = 0;
  let partial = '';
  const timer = setInterval(() => {
    if (!existsSync(path)) return;
    const fd = openSync(path, 'r');
    try {
      const size = fstatSync(fd).size;
      if (size <= offset) return;
      const chunk = Buffer.alloc(size - offset);
      readSync(fd, chunk, 0, chunk.length, offset);
      offset = size;
      partial += chunk.toString('utf8');
      for (let at = partial.indexOf('\n'); at >= 0; at = partial.indexOf('\n')) {
        onLine(partial.slice(0, at));
        partial = partial.slice(at + 1);
      }
    } finally {
      closeSync(fd);
    }
  }, 25);
  return () => clearInterval(timer);
}

// sminos's side of the scratch RL10 socket, newline-delimited JSON (src/endpoint/rl10/server.ts), as the endpoint
// harness's fake speaks it (test/endpoint/rl10/fake-sminos.ts, which only the endpoint's own suites import): the hello,
// the welcome waited for, the restatement closed; what the endpoint says after is read and dropped.
export function openSminos(info: { socket: string; token: string }): Promise<SminosLine> {
  return new Promise((resolve, reject) => {
    const socket = connect(info.socket);
    let buffer = '';
    let welcomed = false;
    const deadline = setTimeout(() => {
      socket.destroy();
      reject(new Error('no welcome from the scratch endpoint’s RL10 socket within 15 s'));
    }, 15_000);
    const send = (frame: object) => void socket.write(`${JSON.stringify(frame)}\n`);
    socket.on('error', (error) => {
      clearTimeout(deadline);
      if (!welcomed) reject(error);
    });
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (welcomed || !line.includes('"welcome"')) continue;
        if ((JSON.parse(line) as { t?: string }).t !== 'welcome') continue;
        welcomed = true;
        clearTimeout(deadline);
        send(restatedFrame());
        resolve({ send, close: () => void socket.end() });
      }
    });
    socket.once('connect', () => send(helloFrame(info.token, 'remote-bench')));
  });
}

/** The bundle's entry: `prepare <args>`, `serve <args>` or `stop-hosts <args>`. */
export async function main(argv: readonly string[]): Promise<void> {
  const [command, word] = argv;
  const a = parseAgentArgs(word);
  const out = (message: object) => void process.stdout.write(`${JSON.stringify(message)}\n`);
  if (command === 'prepare') return prepare(a, process.execPath, process.versions.electron !== undefined);
  if (command === 'stop-hosts') {
    const left = await stopHosts(a, hostDeps());
    out({ hostsLeft: left });
    process.exitCode = left.length === 0 ? 0 : 1;
    return;
  }
  if (command !== 'serve') throw new Error(`the agent has no command ${command}`);
  const agent = new BenchAgent(a, {
    async machine() {
      const reached = await reachMachine(daemonPaths(a.profile, agentPaths(a).tmp), { build: 'remote-bench-agent' });
      if (!reached.ok) throw new Error(`the scratch machine.sock: ${reached.state}: ${reached.why}`);
      const link = reached.link;
      return {
        async request<T>(name: string, input?: unknown, timeoutMs?: number) {
          const answer = await link.request(name, input, timeoutMs);
          if (!answer.ok) throw new Error(`${name}: ${answer.error.code}: ${answer.error.message}`);
          return answer.value as T;
        },
        close: () => link.close(),
      };
    },
    sminos: openSminos,
    readFile: (path) => readFileSync(path, 'utf8'),
    out,
    endStubs: (samples, signal = 'SIGTERM') => void spawnSync('pkill', [signal === 'SIGKILL' ? '-KILL' : '-TERM', '-f', '--', escapeRegex(samples)], { stdio: 'ignore' }),
    stubsLeft: (samples) => {
      // pgrep's exit 1 is no match; anything else is no answer, counted as one left so the end does not pass it
      const found = spawnSync('pgrep', ['-f', '--', escapeRegex(samples)], { encoding: 'utf8' });
      if (found.status === 1) return 0;
      return found.status === 0 ? found.stdout.split('\n').filter((line) => /^\d+$/.test(line.trim())).length : 1;
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    tail: tailFile,
  });
  bindLifetime(agent, {
    stdin: process.stdin,
    parent: () => process.ppid,
    every: (ms, run) => {
      const timer = setInterval(run, ms);
      return () => clearInterval(timer);
    },
    exit: (code) => process.exit(code),
    error: (message) => void process.stderr.write(`[bench-agent] ${message}\n`),
    ...(a.deadline === undefined ? {} : { deadline: a.deadline }),
    now: Date.now,
    after: (ms, run) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
  });
  try {
    await agent.start();
  } catch (error) {
    process.stderr.write(`[bench-agent] ${(error as Error).message}\n`);
    out({ failed: { message: (error as Error).message } });
    await agent.end().catch((ended: unknown) => void process.stderr.write(`[bench-agent] end failed: ${(ended as Error).message}\n`));
    process.exit(1);
  }
}
