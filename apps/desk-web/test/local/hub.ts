// DC3's local hub, as the browser suites meet it: `pnpm --filter desk-hub local` (wrangler dev with the Worker, its
// Durable Objects, and the web app's built assets, behind the stand-in for Access), started on a free port and stopped
// with its whole process group. A request with no identity is the org's admin, owner@example.com, as the command's
// default. Each start keeps its state in a fresh directory of its own (the command's `--state`), removed at stop or
// when the start fails, so every run meets an org with no key and no machines, and nothing piles up between runs.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../../..');

/** The machine stream's heartbeat this suite runs the local hub with: the local command's own default, passed
 * explicitly so the suites can derive DX2's local close latency (a close is seen within one heartbeat) from it. */
const HEARTBEAT_MS = 2000;

async function free(port: number): Promise<boolean> {
  return new Promise((done) => {
    const server = createServer();
    server.once('error', () => done(false));
    server.listen(port, '127.0.0.1', () => server.close(() => done(true)));
  });
}

/** A port whose successor is also free (the command takes both), drawn from 20000-32000, below the ephemeral ranges of Linux and macOS, so no outgoing connection is handed the successor before the command binds it. */
async function freePair(): Promise<number> {
  for (;;) {
    const port = 20_000 + Math.floor(Math.random() * 12_000);
    if ((await free(port)) && (await free(port + 1))) return port;
  }
}

export class LocalHub {
  private constructor(
    readonly url: string,
    private readonly child: ChildProcess,
    private readonly output: string[],
    private readonly state: string,
  ) {}

  /** The machine stream's heartbeat (`HEARTBEAT_MS`) the hub runs with. */
  readonly heartbeatMs = HEARTBEAT_MS;

  /** The hub's origin as `localhost` (WebAuthn admits `localhost` as a relying party; an IP address it refuses). */
  get localhost(): string {
    return this.url.replace('127.0.0.1', 'localhost');
  }

  static async start(): Promise<LocalHub> {
    const port = await freePair();
    const output: string[] = [];
    const state = mkdtempSync(join(tmpdir(), 'desk-local-hub-'));
    const child = spawn('pnpm', ['--filter', 'desk-hub', 'local', '--port', String(port), '--state', state, '--heartbeat-ms', String(HEARTBEAT_MS)], { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [child.stdout!, child.stderr!]) stream.on('data', (chunk: Buffer) => output.push(chunk.toString()));
    const hub = new LocalHub(`http://127.0.0.1:${port}`, child, output, state);
    const deadline = Date.now() + 120_000;
    try {
      for (;;) {
        if (hub.exited) throw new Error(`the local hub exited (${child.exitCode ?? child.signalCode}):\n${output.join('')}`);
        const me = await fetch(`${hub.url}/api/me`).catch(() => null);
        if (me?.status === 200) return hub;
        if (Date.now() > deadline) throw new Error(`the local hub did not answer /api/me within 120 s:\n${output.join('')}`);
        await new Promise((done) => setTimeout(done, 500));
      }
    } catch (error) {
      await hub.stop(); // a failed start leaves no process group and no state directory behind
      throw error;
    }
  }

  /** Whether the command has ended, by its own exit or by a signal (which leaves `exitCode` null). */
  private get exited(): boolean {
    return this.child.exitCode !== null || this.child.signalCode !== null;
  }

  async stop(): Promise<void> {
    if (!this.exited && this.child.pid !== undefined) {
      const exited = new Promise((done) => this.child.once('exit', done));
      process.kill(-this.child.pid, 'SIGTERM');
      const timeout = setTimeout(() => this.child.pid !== undefined && process.kill(-this.child.pid, 'SIGKILL'), 10_000);
      await exited;
      clearTimeout(timeout);
    }
    rmSync(this.state, { recursive: true, force: true });
  }
}
