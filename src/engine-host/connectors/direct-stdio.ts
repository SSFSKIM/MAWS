// P3-HD M2: the stdio transport of MAWS's own instance of a verified server (docs/doperpowers/plans/2026-10-17-p3-hd-
// direct-route.md, "Actual-write authority"; Decision Log 4). The SDK's stock StdioClientTransport is not used: its close
// signals only the immediate child, so a wrapper's server (npx's node, a shell's child) would outlive it, and its write
// is the SDK's, not MAWS's.
//
// - The entry is spawned directly, exactly as ./source-entry.ts materialized it: the resolved executable, its args as
//   separate argv entries, the attested cwd and the SDK-minimal launch environment plus the configured env. Nothing is
//   inherited from this process and nothing passes through a shell.
// - It leads a process group of its own (`detached`), which this transport owns until the group is empty: close ends
//   stdin, then SIGTERM to the group, then SIGKILL, and resolves once no member remains (or at the give-up, inside
//   5 s). The server exiting on its own takes the same path, so a grandchild it left dies too.
// - A host that dies without closing (killed, crashed) cannot do that, so each group has a lifeline: the system shell
//   (`/bin/sh`, no Node, no app file) blocked reading a pipe only this process writes to. Its end, which is this
//   process's end however it came, makes the lifeline signal the group: SIGTERM, then SIGKILL. Nothing polls, and the
//   lifeline knows only the group's id. A normal close kills the lifeline itself, after the group is gone.
// - stderr is not read (ignored at the spawn, so it can never fill a pipe); stdout is always drained.
// - Inbound frames are bounded: a line past `maxMessageBytes` with no newline closes the connection and fails its
//   written requests as too large. An unparseable line is reported and skipped, as the SDK's own transport does.
// - `send` performs the wire's final check and the write in one synchronous step, and settles with the write itself.
//   P3-F: a write the server's input refused (EPIPE: it closed its stdin yet lives on) fails its send and closes the
//   connection, ending its group, rather than leaving the request to its deadline on a connection still leased.
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage, MessageExtraInfo } from '@modelcontextprotocol/sdk/types.js';
import type { ConnectorLaunchEntry } from './source-entry';
import { DirectWireRefusal, type DirectWire } from './direct-wire';

export type StdioLaunch = Extract<ConnectorLaunchEntry, { transport: 'stdio' }>;

// From close: stdin's end, SIGTERM to the group, SIGKILL, and the give-up, all inside the 5 s shutdown bound.
export const STDIO_STOP = { termAfterMs: 1_000, killAfterMs: 3_000, giveUpAfterMs: 4_500, pollMs: 50 } as const;

// `$1` is the group's id. `read` returns at the pipe's end (nothing is ever written to it).
export const LIFELINE_SCRIPT = 'read -r _; kill -s TERM -- "-$1" 2>/dev/null; sleep 2; kill -s KILL -- "-$1" 2>/dev/null; exit 0';
export const LIFELINE_SHELL = '/bin/sh';

// What one instance starts: the server, then its group's lifeline. Exported so the remote host-death scene starts exactly
// this from a process it then kills.
export function stdioSpawnPlan(entry: StdioLaunch): { server: { command: string; args: string[]; options: SpawnOptions }; lifeline(group: number): { command: string; args: string[]; options: SpawnOptions } } {
  return {
    server: { command: entry.executable, args: [...entry.args], options: { cwd: entry.cwd, env: { ...entry.env }, stdio: ['pipe', 'pipe', 'ignore'], detached: true, shell: false, windowsHide: true } },
    lifeline: (group) => ({ command: LIFELINE_SHELL, args: ['-c', LIFELINE_SCRIPT, 'maws-lifeline', String(group)], options: { cwd: '/', env: { PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'ignore', 'ignore'], detached: true, shell: false, windowsHide: true } }),
  };
}

export interface DirectStdioOptions {
  maxMessageBytes: number;
  spawn?: typeof nodeSpawn;
  kill?: (pid: number, signal: NodeJS.Signals | 0) => void;
}

export class OwnedStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;

  private child: ChildProcess | null = null;
  private lifeline: ChildProcess | null = null;
  private leaderExited = false;
  private stopped: Promise<void> | null = null;
  private readonly buffer: ReadBuffer;
  private readonly spawn: typeof nodeSpawn;
  private readonly kill: (pid: number, signal: NodeJS.Signals | 0) => void;

  constructor(
    private readonly entry: StdioLaunch,
    private readonly wire: DirectWire,
    options: DirectStdioOptions,
  ) {
    this.buffer = new ReadBuffer({ maxBufferSize: options.maxMessageBytes });
    this.spawn = options.spawn ?? nodeSpawn;
    this.kill = options.kill ?? ((pid, signal) => process.kill(pid, signal));
  }

  // The server's, which is its group's.
  get pid(): number | undefined {
    return this.child?.pid;
  }

  // Ready once both the server and its group's lifeline started; either failing to start fails the start and ends
  // the group.
  start(): Promise<void> {
    if (this.child || this.stopped) return Promise.reject(new DirectWireRefusal('the direct connection was already started'));
    const plan = stdioSpawnPlan(this.entry);
    let failed!: (error: Error) => void;
    const fail = new Promise<never>((_resolve, reject) => (failed = reject));
    void fail.catch(() => {});
    const failing = (words: string) => () => {
      failed(new DirectWireRefusal(words));
      void this.close();
    };
    const child = this.spawn(plan.server.command, plan.server.args, plan.server.options);
    this.child = child;
    const server = new Promise<void>((resolve) => child.once('spawn', () => resolve()));
    child.once('error', failing('the server could not be started'));
    child.once('exit', () => {
      this.leaderExited = true;
      void this.close();
    });
    child.stdin?.on('error', () => void this.close()); // P3-F: a pipe that cannot be written any more closes the connection
    child.stdout?.on('error', () => {});
    child.stdout?.on('data', (chunk: Buffer) => this.read(chunk));
    if (child.pid === undefined) return Promise.race([server, fail]);
    let lifelineUp: Promise<void>;
    try {
      lifelineUp = this.watch(plan.lifeline(child.pid), failing('the server could not be given its lifeline'));
    } catch {
      failing('the server could not be given its lifeline')();
      return fail;
    }
    return Promise.race([Promise.all([server, lifelineUp]).then(() => {}), fail]);
  }

  // No await before the write: the wire's check and stdin's write are one step. Its completion is awaited after.
  async send(message: JSONRPCMessage): Promise<void> {
    const stdin = this.child?.stdin;
    if (!stdin || this.stopped) throw new DirectWireRefusal('the direct connection is closed');
    this.wire.writing(message);
    const written = new Promise<Error | null | undefined>((resolve) => stdin.write(serializeMessage(message), resolve));
    if (await written) {
      void this.close();
      throw new Error('the server stopped reading its input');
    }
  }

  close(): Promise<void> {
    if (!this.stopped) {
      this.stopped = this.stop();
      this.onclose?.();
    }
    return this.stopped;
  }

  // Held open, never written, for as long as the group is owned. Its failing to start, or its going while the group
  // is still owned, is `lost`: the group no longer has its host-death cover, so it is ended now.
  private watch(plan: { command: string; args: string[]; options: SpawnOptions }, lost: () => void): Promise<void> {
    const lifeline = this.spawn(plan.command, plan.args, plan.options);
    this.lifeline = lifeline;
    const up = new Promise<void>((resolve) => lifeline.once('spawn', () => resolve()));
    lifeline.once('error', () => {
      if (this.lifeline === lifeline) lost();
    });
    lifeline.once('exit', () => {
      if (this.lifeline === lifeline) lost();
    });
    lifeline.stdin?.on('error', () => {});
    return up;
  }

  private read(chunk: Buffer): void {
    if (this.stopped) return; // drained, not delivered
    try {
      this.buffer.append(chunk);
    } catch {
      this.wire.faultPending('tooLarge');
      void this.close();
      return;
    }
    for (;;) {
      let message: JSONRPCMessage | null;
      try {
        message = this.buffer.readMessage();
      } catch {
        this.onerror?.(new Error('the server wrote a line that is not a JSON-RPC message'));
        continue;
      }
      if (message === null || this.stopped) return;
      this.onmessage?.(message);
    }
  }

  private stop(): Promise<void> {
    const child = this.child;
    const pid = child?.pid;
    if (!child || pid === undefined) return Promise.resolve();
    try {
      child.stdin?.end();
    } catch {
      // already gone
    }
    return new Promise<void>((resolve) => {
      const timers: ReturnType<typeof setTimeout>[] = [];
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        for (const timer of timers) clearTimeout(timer);
        this.release();
        resolve();
      };
      timers.push(setTimeout(() => this.signal(child, pid, 'SIGTERM'), STDIO_STOP.termAfterMs));
      timers.push(setTimeout(() => this.signal(child, pid, 'SIGKILL'), STDIO_STOP.killAfterMs));
      timers.push(setTimeout(finish, STDIO_STOP.giveUpAfterMs));
      const poll = () => {
        if (done) return;
        if (this.hasMembers(pid)) timers.push(setTimeout(poll, STDIO_STOP.pollMs));
        else finish();
      };
      poll();
    });
  }

  // The group is gone (or given up on): the lifeline goes without signalling it, then its pipe.
  private release(): void {
    const lifeline = this.lifeline;
    this.lifeline = null;
    if (!lifeline) return;
    try {
      lifeline.kill('SIGKILL');
    } catch {
      // already gone
    }
    lifeline.stdin?.destroy();
  }

  private signal(child: ChildProcess, pid: number, signal: NodeJS.Signals): void {
    try {
      this.kill(-pid, signal); // the group: the server and whatever it started
    } catch {
      try {
        child.kill(signal);
      } catch {
        // the leader is gone too
      }
    }
  }

  // The unreaped leader, or any member left in the group.
  private hasMembers(pid: number): boolean {
    if (!this.leaderExited) return true;
    try {
      this.kill(-pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  }
}
