// The endpoint acceptance run's machine in the local proof (P5 O10 M11; apps/desk-hub/deploy/endpoint-acceptance.ts): the
// built `mawsd` (out/main/mawsd.js) as a process on a scratch profile, as M10's process scene runs it
// (src/mawsd/process-endpoint.test.ts), against desk-hub's Worker in Miniflare. What the VM's scene does by its own
// means is done here by the suite's:
// - the direct listener binds only tailnet addresses, so the daemon runs under a preload (`fakeTailnet`) giving it one
//   tailnet-shaped address, listened on through 127.0.0.1; the device dials 127.0.0.1;
// - the endpoint's RL1 socket goes through a TCP proxy (`CuttingProxy`) the suite can cut, as `ss -K` cuts the VM
//   daemon's: the enrollment code's hub is rewritten to the proxy before the daemon reads it (the code's MAC binds no
//   hub), so everything the daemon sends the hub crosses the proxy and nothing else does;
// - `mawsd restart` exits 75 and a supervisor brings it back: here a loop that starts it again on 75 alone;
// - lane A's source is a fake sminos on the endpoint's RL10 socket (`LocalLaneA`) with sminos's ledger semantics (an
//   op runs once, `query`, `tombstone`), whose session writes a row per send and a stretch of rows for a `ticks` send,
//   as the VM's stub-model session does. It has no `SminosProbe`: what only a real sminos shows is the VM's.
// The daemon runs `--private` (Node below the unit's floor here): it exits after 10 idle minutes, which the run's
// status reads keep from coming.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import { decodeEnrollmentCodeV2, encodeEnrollmentCodeV2 } from 'desk-hub/protocol';
import type { EndpointMachine, EndpointStatus, LaneAScene } from '../../../apps/desk-hub/deploy/endpoint-machine';
import { FakeSminos, type Frame } from '../rl10/fake-sminos';

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
export const TAILNET = '100.101.102.104';

async function until<T>(probe: () => T | null | undefined | false | Promise<T | null | undefined | false>, what: string | (() => string), ms = 30_000, every = 100): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`no ${typeof what === 'function' ? what() : what} within ${ms} ms`);
    await sleep(every);
  }
}

/** The preload that gives the daemon one tailnet-shaped interface, listened on through loopback. */
export function writeFakeTailnet(file: string): void {
  writeFileSync(
    file,
    `const os = require('node:os');
const net = require('node:net');
const FAKE = ${JSON.stringify(TAILNET)};
os.networkInterfaces = () => ({ utun99: [{ address: FAKE, netmask: '255.255.255.255', family: 'IPv4', mac: '00:00:00:00:00:00', internal: false, cidr: FAKE + '/32' }] });
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  if (args[0] && typeof args[0] === 'object' && args[0].host === FAKE) args[0] = { ...args[0], host: '127.0.0.1' };
  return listen.apply(this, args);
};
`,
  );
}

/** A TCP proxy to `target` whose connections can all be cut at once (the endpoint's RL1 socket, dropped by force). */
export class CuttingProxy {
  private constructor(
    private readonly server: Server,
    private readonly live: Set<[Socket, Socket]>,
    readonly url: string,
  ) {}

  static async start(target: URL): Promise<CuttingProxy> {
    const live = new Set<[Socket, Socket]>();
    const server = createServer((client) => {
      const upstream = connect(Number(target.port), target.hostname);
      const pair: [Socket, Socket] = [client, upstream];
      live.add(pair);
      const end = () => {
        live.delete(pair);
        client.destroy();
        upstream.destroy();
      };
      client.on('error', end).on('close', end);
      upstream.on('error', end).on('close', end);
      client.pipe(upstream);
      upstream.pipe(client);
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    return new CuttingProxy(server, live, `http://127.0.0.1:${(server.address() as { port: number }).port}`);
  }

  /** Every connection through the proxy destroyed; how many there were. */
  cut(): number {
    const n = this.live.size;
    for (const [a, b] of [...this.live]) {
      a.destroy();
      b.destroy();
    }
    this.live.clear();
    return n;
  }

  close(): Promise<void> {
    this.cut();
    return new Promise((done) => this.server.close(() => done()));
  }
}

type Op = { member: string; device: string; fingerprint: string; session: string; outcome: unknown };

/**
 * sminos on the endpoint's RL10 socket for one lane A session: hello and the session restated at every connection
 * (it reconnects after a restart), its upstream subscriptions answered with a snapshot of the session's rows at n 0
 * and every new row after, and its ledger: an op runs once, its result kept for a repeat; `query` answers what the
 * ledger holds; `tombstone` claims an op not yet received, so its original, released late, is refused.
 */
export class LocalLaneA implements LaneAScene {
  readonly sminos = null;
  /** The session's rows, oldest first: what the producer wrote. */
  readonly rows_: string[] = [];
  /** The texts each send carried that took effect, in order. */
  readonly sends: string[] = [];
  readonly #ops = new Map<string, Op>();
  readonly #tombstoned = new Set<string>();
  #subs = new Map<string, { session: string; n: number }>();
  #socket: FakeSminos | null = null;
  #read = 0;
  #timer: ReturnType<typeof setInterval> | null = null;
  #stopped = false;
  session = '';
  project = '';
  projectName = '';
  readonly launch = 'L1';
  readonly alias = 'o10-m11-lane-a';

  constructor(
    private readonly rl10Json: string,
    readonly checkout: string,
  ) {}

  async up(project: { id: string; name: string }): Promise<{ session: string; launch: string; alias: string; checkout: string }> {
    this.session = randomUUID();
    this.project = project.id;
    this.projectName = project.name;
    for (let i = 0; i < 3; i++) this.#write('assistant');
    await this.#connect();
    this.#timer = setInterval(() => void this.#tick(), 10);
    return { session: this.session, launch: this.launch, alias: this.alias, checkout: this.checkout };
  }

  async ticks(count: number, tag: string, send: (text: string) => Promise<void>): Promise<void> {
    await send(`o10-m11 ticks ${count} ${tag}`);
  }

  async rows(): Promise<string[]> {
    return [...this.rows_];
  }

  /** The fake starts no session of sminos's: the run knows lane A's from `up`. */
  async started(): Promise<string[]> {
    return [];
  }

  async count(_session: string, token: string): Promise<number> {
    return this.sends.filter((text) => text.endsWith(` ${token}`)).length;
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#socket?.close();
  }

  async #connect(): Promise<void> {
    const socket = await until(async () => {
      if (!existsSync(this.rl10Json)) return null;
      const info = JSON.parse(readFileSync(this.rl10Json, 'utf8')) as { socket: string; token: string };
      try {
        const s = await FakeSminos.open(info.socket);
        s.send({ t: 'hello', protocol: { major: 1, minor: 0 }, capabilities: [], token: info.token, sminos: { version: 'o10-m11-local' }, policy: { read_only: false, ceiling: 'settings' } });
        await s.next((x) => x.t === 'welcome', 'welcome', 5000);
        return s;
      } catch {
        return null;
      }
    }, 'the endpoint’s RL10 socket', 120_000, 500);
    this.#socket = socket;
    this.#read = 0;
    this.#subs = new Map();
    // The project's log plane opened on RL1 (sminos's hello), so the hub registers it and takes the session's listing.
    socket.send({ t: 'hello', project: this.project, name: this.projectName, have: {} });
    socket.send({ t: 'session', message: { project: this.project, machine: 'local', session: null, kind: 'machine', sub: null, n: null, body: { online: true, policy: { read_only: false, ceiling: 'settings' }, checkouts: [{ path: this.checkout, branch: 'main' }], desk: {} } } });
    socket.send({ t: 'member', session: this.session, alias: this.alias, project: this.project, lane: 'A', state: 'idle', title: this.alias, cwd: this.checkout, launch: this.launch, owners: ['@machine'], ownersProof: [], origin: { kind: 'terminal' } });
    socket.send({ t: 'restated' });
  }

  #reconnecting = false;
  async #tick(): Promise<void> {
    const s = this.#socket;
    if (s === null || this.#stopped) return;
    if (s.closed) {
      if (this.#reconnecting) return;
      this.#reconnecting = true;
      this.#socket = null;
      try {
        await this.#connect();
      } finally {
        this.#reconnecting = false;
      }
      return;
    }
    for (; this.#read < s.received.length; this.#read++) this.#frame(s, s.received[this.#read]);
  }

  #frame(s: FakeSminos, frame: Frame): void {
    if (frame.t === 'subscribe' && frame.session === this.session) {
      const sub = frame.sub as string;
      this.#subs.set(sub, { session: this.session, n: 0 });
      const rows = [...this.rows_].reverse().map((uuid) => ({ uuid }));
      s.send(this.#plane('snapshot', { rows, more: false, subagents: [], presence: { record: null, bridge: true }, streaming: [], host: [] }, sub, 0));
    } else if (frame.t === 'unsubscribe') this.#subs.delete(frame.sub as string);
    else if (frame.t === 'rpc') this.#rpc(s, frame.rpc as Record<string, unknown>);
    else if (frame.t === 'query') s.send(this.#queried(frame.opId as string));
    else if (frame.t === 'tombstone') {
      const opId = frame.opId as string;
      if (this.#ops.has(opId)) s.send({ t: 'tombstoned', opId, ok: false, state: 'done' });
      else {
        this.#tombstoned.add(opId);
        s.send({ t: 'tombstoned', opId, ok: true });
      }
    }
  }

  #queried(opId: string): Record<string, unknown> {
    const op = this.#ops.get(opId);
    if (op === undefined) return { t: 'queried', opId, state: 'not-received' };
    return { t: 'queried', opId, state: 'done', outcome: op.outcome, member: op.member, device: op.device, fingerprint: op.fingerprint, target: { kind: 'session', session: op.session } };
  }

  #rpc(s: FakeSminos, rpc: Record<string, unknown>): void {
    const opId = rpc.opId as string;
    const result = (outcome: unknown) => s.send({ t: 'rpc-result', project: this.project, opId, nonce: rpc.nonce, outcome });
    const known = this.#ops.get(opId);
    if (known !== undefined) return result(known.outcome);
    if (this.#tombstoned.has(opId)) return result({ state: 'failed', error: { code: 'tombstoned', message: `${opId} was answered not-received and given up: it never runs` } });
    const args = rpc.args as { session: string; text?: string };
    let outcome: unknown = { state: 'done', result: {} };
    if (rpc.rpc === 'send' && typeof args.text === 'string') {
      this.sends.push(args.text);
      const uuid = this.#write('user');
      outcome = { state: 'done', result: { entered: true, uuid } };
      const ticks = /^o10-m11 ticks (\d+) /.exec(args.text);
      if (ticks) void this.#stretch(Number(ticks[1]));
    }
    this.#ops.set(opId, { member: rpc.member as string, device: rpc.device as string, fingerprint: rpc.fingerprint as string, session: args.session, outcome });
    result(outcome);
  }

  /** The session writing `count` rows by itself, one each 100 ms (the stub model's tool loop). */
  async #stretch(count: number): Promise<void> {
    for (let i = 0; i < count && !this.#stopped; i++) {
      await sleep(100);
      this.#write(i % 2 === 0 ? 'assistant' : 'user');
    }
  }

  /** A new row of the session, sent on every upstream subscription. */
  #write(type: string): string {
    const uuid = randomUUID();
    this.rows_.push(uuid);
    const s = this.#socket;
    if (s !== null && !s.closed) for (const [sub, state] of this.#subs) s.send(this.#plane('row', { row: { uuid, type }, agentId: null }, sub, ++state.n));
    return uuid;
  }

  #plane(kind: string, body: unknown, sub: string, n: number): Record<string, unknown> {
    return { t: 'session', message: { project: this.project, machine: 'local', session: this.session, kind, sub, n, body } };
  }
}

/** The built mawsd on a scratch profile, under a loop that starts it again on a requested restart (exit 75). */
export class LocalMachine implements EndpointMachine {
  readonly label = 'a local scratch mawsd';
  readonly directUrl: string;
  readonly laneA: LocalLaneA;
  readonly profile: string;
  readonly env: NodeJS.ProcessEnv;
  #child: ChildProcess | null = null;
  #stopping = false;
  #starts = 0;
  #proxy: CuttingProxy | null = null;
  /** Every exit of the daemon, its status. */
  readonly exits: Array<number | null> = [];

  constructor(
    private readonly options: { scratch: string; mawsd: string; preload: string; hub: string; port: number },
  ) {
    this.profile = join(options.scratch, 'machine');
    for (const dir of ['home', 'sminos', 'work']) mkdirSync(join(this.profile, dir), { recursive: true });
    this.env = {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: join(this.profile, 'home'),
      SMINOS_HOME: join(this.profile, 'sminos'),
      MAWS_USER_DATA: this.profile,
      MAWS_ENDPOINT_DIRECT: '1',
      MAWS_ENDPOINT_PORT: String(options.port),
    };
    this.directUrl = `ws://127.0.0.1:${options.port}`;
    this.laneA = new LocalLaneA(join(this.profile, 'mawsd', 'endpoint', 'rl10.json'), join(this.profile, 'work'));
  }

  log(): string {
    try {
      return readFileSync(join(this.profile, 'mawsd', 'mawsd.log'), 'utf8');
    } catch {
      return '';
    }
  }

  #serving = () => this.log().split('\n').filter((line) => line.includes(' serving;')).length;

  #start(): void {
    const child = spawn(process.execPath, ['--disable-sigusr1', '--require', this.options.preload, this.options.mawsd, 'run', '--private', '--dir', join(this.profile, 'mawsd')], { env: this.env, stdio: ['ignore', 'ignore', 'pipe'] });
    this.#starts++;
    this.#child = child;
    child.stderr!.on('data', () => {});
    child.once('exit', (code) => {
      this.exits.push(code);
      if (this.#child === child) this.#child = null;
      if (code === 75 && !this.#stopping) this.#start();
    });
  }

  async up(): Promise<void> {
    this.#proxy = await CuttingProxy.start(new URL(this.options.hub));
    this.#start();
    await until(() => this.#serving() >= this.#starts, () => `mawsd serving:\n${this.log()}`);
  }

  cli(args: string[], input = ''): Promise<{ status: number | null; stdout: string; stderr: string }> {
    return new Promise((done) => {
      const child = spawn(process.execPath, [this.options.mawsd, ...args], { env: this.env, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => void (stdout += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => void (stderr += chunk.toString()));
      const timer = setTimeout(() => child.kill('SIGKILL'), 330_000);
      child.once('exit', (status) => {
        clearTimeout(timer);
        done({ status, stdout, stderr });
      });
      child.stdin.end(input);
    });
  }

  async #json(args: string[], input = ''): Promise<Record<string, unknown>> {
    const answer = await this.cli(args, input);
    if (answer.status !== 0) throw new Error(`mawsd ${args[0]} exited ${answer.status}: ${(answer.stderr || answer.stdout).slice(-300)}`);
    return JSON.parse(answer.stdout) as Record<string, unknown>;
  }

  enroll(code: string, name: string): Promise<Record<string, unknown>> {
    const through = encodeEnrollmentCodeV2({ ...decodeEnrollmentCodeV2(code), hub: this.#proxy!.url });
    return this.#json(['enroll', '--name', name, '--wait', '300', '--json'], `${through}\n`);
  }

  keys(): Promise<Record<string, unknown>> {
    return this.#json(['keys', '--json']);
  }

  async status(): Promise<EndpointStatus> {
    return (await this.#json(['endpoint', 'status', '--json'])) as unknown as EndpointStatus;
  }

  async restart(): Promise<void> {
    const before = this.#starts;
    const answer = await this.cli(['restart']);
    if (answer.status !== 0) throw new Error(`mawsd restart exited ${answer.status}: ${answer.stderr.slice(-300)}`);
    await until(() => this.#starts > before && this.#serving() >= this.#starts, () => `mawsd serving again:\n${this.log().slice(-2000)}`, 60_000);
  }

  async policy(set: { readOnly?: boolean; ceiling?: string } = {}): Promise<{ read_only: boolean; ceiling: string }> {
    const args = ['endpoint', 'policy', ...(set.readOnly === undefined ? [] : ['--read-only', set.readOnly ? 'on' : 'off']), ...(set.ceiling === undefined ? [] : ['--ceiling', set.ceiling]), '--json'];
    const shown = await this.#json(args);
    return { read_only: shown.read_only as boolean, ceiling: shown.ceiling as string };
  }

  async cutHubSocket(): Promise<string> {
    return `cut ${this.#proxy!.cut()} connection(s) through the hub proxy`;
  }

  async logMark(): Promise<number> {
    return Buffer.byteLength(this.log());
  }

  async logSince(mark: number): Promise<string[]> {
    return Buffer.from(this.log()).subarray(mark).toString('utf8').split('\n');
  }

  /** The addresses the daemon says it bound since its last start, and has not let go. */
  async listening(): Promise<string[]> {
    const lines = this.log().split('\n');
    const start = lines.map((line) => line.includes(' serving;')).lastIndexOf(true);
    const bound = new Set<string>();
    for (const line of lines.slice(Math.max(0, start))) {
      const at = /the direct listener is bound to ws:\/\/(\S+)/.exec(line);
      if (at) bound.add(at[1].replace(/\/$/, ''));
      const gone = /the direct listener let ws:\/\/(\S+) go/.exec(line);
      if (gone) bound.delete(gone[1].replace(/\/$/, ''));
    }
    return [...bound];
  }

  /** Nothing to wait for: the suite's own commands are bounded, and none is cancelled. */
  async settle(): Promise<string[]> {
    return [];
  }

  async down(): Promise<string[]> {
    this.#stopping = true;
    this.laneA.stop();
    const child = this.#child;
    if (child !== null && child.exitCode === null) {
      const exited = new Promise((done) => child.once('exit', done));
      child.kill('SIGTERM');
      await Promise.race([exited, sleep(10_000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    await this.#proxy?.close();
    return this.#child !== null && this.#child.exitCode === null ? ['LEFT the local mawsd still runs'] : [];
  }
}
