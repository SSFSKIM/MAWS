// The live bench's agent on a bench machine (P5 O7 M7, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M7's
// "The live bench" and its Decision Log entries of 2026-11-02): bundled to CommonJS on the MacBook by the live mode
// (e2e/remote-latency-live.spec.ts), copied under the scratch profile by the runner (test/support/remote-bench.ts) and
// run there under the production mawsd's node runtime, which it only reads. Two commands, each given one JSON word of
// `AgentArgs`:
//
//   prepare  the latency stub's wrapper (`<bench>/latency-engine`, the stub from M7's head checkout and its samples file
//            under the bench directory), the scratch engine store's trust of the bench checkout, and the scratch
//            daemon's home, temporary and sminos directories, so nothing the daemon or its engines write leaves the
//            profile;
//   serve    the stub's session started over the scratch daemon's machine.sock (one turn, the history the open shows),
//            `{ready}` printed; on a `{list}` line from stdin, the harness's fake sminos on the scratch RL10 socket
//            (`<profile>/mawsd/endpoint/rl10.json`, never SMINOS_RL10, never a real sminos) lists it for the owners
//            named, `{listed}` printed; every delta the stub writes printed as `{sample}`. It ends when its transport
//            does: stdin's end or its parent's loss stops the session, closes the fake sminos and ends any stub of this
//            bench still running, then exits.
//
// Every path it writes or opens is under the scratch profile (`agentPaths`), except the head checkout's stub, which it
// names for the wrapper and never opens, and the node runtime it runs on. It starts no `claude` (the daemon runs under
// MAWS_E2E, whose engine is MAWS_E2E_ENGINE_BIN and nothing else) and no sminos.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync, fstatSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { daemonPaths } from '@shared/daemon/files';
import { connect } from 'node:net';
import { reachMachine } from '../../src/mawsd/machine-client';
import { goneFrame, helloFrame, memberFrame, projectFrames, restatedFrame } from './sminos-frames';

export interface AgentArgs {
  name: string;
  profile: string;
  bench: string;
  head: string;
  /** the version the stub answers `--version` with (test/support/engine-pin's FIXTURE_ENGINE_VERSION, which this module
   * never imports: importing it runs the installed engine's `--version`) */
  engineVersion: string;
}

export const BENCH_PROJECT = 'maws-remote-bench'; // sminos's project id for the bench checkout
export const FIRST_PROMPT = 'latency bench turn 1';
const MARKERS_PER_TURN = 300; // the stub's (test/support/local-latency.ts's BENCH.markersPerTurn)
const TURN_MS = 60_000;

export function parseAgentArgs(word: string | undefined): AgentArgs {
  const parsed = JSON.parse(word ?? 'null') as Partial<AgentArgs> | null;
  const { name, profile, bench, head, engineVersion } = parsed ?? {};
  if (typeof name !== 'string' || typeof profile !== 'string' || typeof bench !== 'string' || typeof head !== 'string' || typeof engineVersion !== 'string') throw new Error('the agent takes one JSON word {name, profile, bench, head, engineVersion}');
  if (!/^\d+\.\d+\.\d+$/.test(engineVersion)) throw new Error(`${engineVersion} is not an engine version`);
  for (const path of [profile, bench, head]) if (!isAbsolute(path)) throw new Error(`${path} is not absolute`);
  if (bench !== `${profile}/bench`) throw new Error('the bench directory is the profile’s own');
  return { name, profile, bench, head, engineVersion };
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

/** The stub's wrapper, the store's trust and the daemon's directories; `node` is the runtime the wrapper runs the stub on. */
export function prepare(a: AgentArgs, node: string): void {
  const p = agentPaths(a);
  for (const dir of [a.bench, p.checkout, p.claudeConfig, p.home, p.tmp, p.sminosHome, p.shellHome, p.claudeUsage]) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(p.engine, `#!/bin/sh\nMAWS_LATENCY_STUB_VERSION=${quote(a.engineVersion)} exec ${quote(node)} ${quote(p.stub)} ${quote(p.samples)} "$@"\n`, { mode: 0o755 });
  writeFileSync(`${p.claudeConfig}/.claude.json`, `${JSON.stringify({ projects: { [p.checkout]: { hasTrustDialogAccepted: true } } }, null, 2)}\n`);
  writeFileSync(`${p.claudeConfig}/settings.json`, `${JSON.stringify({ permissions: { defaultMode: 'default' } })}\n`);
  // the login shell the daemon's hosts capture reads its startup files here (test/support/shell-home.ts's pattern)
  for (const name of ['.zprofile', '.bash_profile']) writeFileSync(`${p.shellHome}/${name}`, '');
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
  /** Ends every stub of this bench still running (its samples path in its arguments). */
  endStubs(samples: string): void;
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
  #session: { app: string; engine: string } | null = null;
  #ended: Promise<void> | null = null;

  constructor(a: AgentArgs, deps: ServeDeps) {
    this.#a = a;
    this.#deps = deps;
  }

  /** The stub's session started over machine.sock and its first turn over; `{ready}` printed; the samples tailed. */
  async start(): Promise<void> {
    const p = agentPaths(this.#a);
    const machine = (this.#machine = await this.#deps.machine());
    await machine.request('session.list', {}, 120_000); // loads the spine and wakes the engine host
    const { ref } = await machine.request<{ ref: string }>('machine.identity');
    await machine.request('machineSettings.set', { patch: { gateway: { defaultRoute: 'direct' } } });
    const project = await machine.request<{ id: string }>('session.projects.add', { directory: p.checkout });
    const { appSessionId: app } = await machine.request<{ appSessionId: string }>('session.create', { projectId: project.id, location: null });
    await machine.request('session.intent.patch', { appSessionId: app, patch: { gateway: 'direct' } });
    const before = this.#written().length;
    const at = Date.now();
    const started = await machine.request<{ status: string }>('session.start', { appSessionId: app, message: { content: FIRST_PROMPT, display: FIRST_PROMPT }, options: {} });
    if (started.status === 'needs_trust') throw new Error('the scratch engine store does not trust the bench checkout (run prepare first)');
    let engineStartMs: number | null = null;
    let engine: string | null;
    for (const deadline = Date.now() + TURN_MS; ; ) {
      const status = await machine.request<Status>('session.status', { appSessionId: app }).catch(() => null);
      if (status?.process === 'ready') engineStartMs ??= Date.now() - at;
      if (status?.process === 'ready' && status.turn === null && this.#written().length >= before + MARKERS_PER_TURN) {
        engine = status.engineSessionId;
        break;
      }
      if (Date.now() > deadline) throw new Error('the bench session’s first turn did not end within 60 s');
      await this.#deps.sleep(25);
    }
    if (engine === null) throw new Error('the bench session has no engine session id');
    this.#session = { app, engine };
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

  /** One line from the bench: `{list: {owners, title}}` lists the session through the fake sminos. */
  async input(line: string): Promise<void> {
    const message = JSON.parse(line) as { list?: { owners: string[]; title: string } };
    if (message.list === undefined) return;
    const session = this.#session;
    if (session === null || this.#machine === null) throw new Error('the bench session is not started');
    const p = agentPaths(this.#a);
    const info = JSON.parse(this.#deps.readFile(p.rl10)) as { socket: string; token: string };
    if (!info.socket.startsWith(`${this.#a.profile}/`) && !info.socket.startsWith(`${agentPaths(this.#a).tmp}/`)) throw new Error('the RL10 socket is not the scratch profile’s');
    const sminos = (this.#sminos = await this.#deps.sminos(info));
    for (const frame of projectFrames(BENCH_PROJECT, this.#a.name, [p.checkout])) sminos.send(frame);
    for (const deadline = Date.now() + 30_000; ; ) {
      const live = await this.#machine.request<{ appSessionId: string; engineSessionId: string | null }[]>('engine.sessions');
      if (live.some((s) => s.appSessionId === session.app && s.engineSessionId === session.engine)) break;
      if (Date.now() > deadline) throw new Error('the engine host does not run the bench session');
      await this.#deps.sleep(100);
    }
    sminos.send(memberFrame(BENCH_PROJECT, { engine: session.engine, alias: session.app, title: message.list.title, cwd: p.checkout, owners: message.list.owners }));
    this.#deps.out({ listed: { app: session.app } });
  }

  /** The agent's end, once whatever asks: the tail stopped, the listing withdrawn, the session stopped, every stub ended. */
  end(): Promise<void> {
    this.#ended ??= (async () => {
      this.#stopTail?.();
      const session = this.#session;
      if (this.#sminos !== null) {
        if (session !== null) this.#sminos.send(goneFrame(session.engine));
        this.#sminos.close();
      }
      if (session !== null && this.#machine !== null) await this.#machine.request('session.stop', { appSessionId: session.app, reason: 'stop' }, 10_000).catch(() => undefined);
      this.#deps.endStubs(agentPaths(this.#a).samples);
      this.#machine?.close();
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
}): void {
  const parent = io.parent();
  let buffer = '';
  let stopWatch = () => {};
  let finished = false;
  const finish = (code: number) => {
    if (finished) return;
    finished = true;
    stopWatch();
    void agent.end().finally(() => io.exit(code));
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
  stopWatch = io.every(1_000, () => {
    if (io.parent() !== parent) finish(0);
  });
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

/** The bundle's entry: `prepare <args>` or `serve <args>`. */
export async function main(argv: readonly string[]): Promise<void> {
  const [command, word] = argv;
  const a = parseAgentArgs(word);
  const out = (message: object) => void process.stdout.write(`${JSON.stringify(message)}\n`);
  if (command === 'prepare') return prepare(a, process.execPath);
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
    endStubs: (samples) => void spawnSync('pkill', ['-f', '--', escapeRegex(samples)], { stdio: 'ignore' }),
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
  });
  try {
    await agent.start();
  } catch (error) {
    process.stderr.write(`[bench-agent] ${(error as Error).message}\n`);
    out({ failed: { message: (error as Error).message } });
    await agent.end();
    process.exit(1);
  }
}
